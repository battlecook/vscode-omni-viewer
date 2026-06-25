import * as fs from 'fs';

export interface AutomotiveSummaryItem {
    label: string;
    value: string | number;
}

export interface AutomotiveTable {
    title: string;
    headers: string[];
    rows: Array<Array<string | number>>;
}

export interface AutomotiveViewerModel {
    format: string;
    title: string;
    fileSize: string;
    summary: AutomotiveSummaryItem[];
    tables: AutomotiveTable[];
    rawPreview?: string;
    warnings: string[];
}

export class AutomotiveParsers {
    private static readonly SQLITE_HEADER = 'SQLite format 3\0';

    public static parseArxml(source: string, fileSize: string): AutomotiveViewerModel {
        const packageNames = this.collectTagText(source, 'AR-PACKAGE', 'SHORT-NAME');
        const elements = this.collectNamedElements(source, [
            'CAN-CLUSTER',
            'CAN-PHYSICAL-CHANNEL',
            'CAN-FRAME-TRIGGERING',
            'FRAME',
            'I-SIGNAL',
            'I-PDU',
            'SIGNAL-I-PDU',
            'ECU-INSTANCE'
        ]);
        const refs = this.collectRefs(source);

        return {
            format: 'ARXML',
            title: 'AUTOSAR XML',
            fileSize,
            summary: [
                { label: 'Packages', value: packageNames.length },
                { label: 'Named elements', value: elements.length },
                { label: 'References', value: refs.length },
                { label: 'XML namespace', value: this.extractXmlNamespace(source) || '-' }
            ],
            tables: [
                {
                    title: 'Packages',
                    headers: ['#', 'Short name'],
                    rows: packageNames.map((name, index) => [index + 1, name])
                },
                {
                    title: 'Named elements',
                    headers: ['Type', 'Short name'],
                    rows: elements.slice(0, 1000).map(element => [element.type, element.name])
                },
                {
                    title: 'References',
                    headers: ['Tag', 'Dest', 'Target'],
                    rows: refs.slice(0, 1000).map(ref => [ref.tag, ref.dest || '-', ref.target])
                }
            ],
            rawPreview: this.preview(source),
            warnings: elements.length > 1000 || refs.length > 1000
                ? ['Large ARXML file: tables are limited to the first 1,000 elements/references.']
                : []
        };
    }

    public static parseA2l(source: string, fileSize: string): AutomotiveViewerModel {
        const blocks = this.collectA2lBlocks(source);
        const blockCounts = new Map<string, number>();
        blocks.forEach(block => blockCounts.set(block.type, (blockCounts.get(block.type) || 0) + 1));
        const focusTypes = ['PROJECT', 'MODULE', 'IF_DATA', 'MEASUREMENT', 'CHARACTERISTIC', 'COMPU_METHOD', 'RECORD_LAYOUT', 'EVENT'];
        const focusRows = blocks
            .filter(block => focusTypes.includes(block.type))
            .slice(0, 1000)
            .map(block => [block.type, block.name || '-', block.line]);

        return {
            format: 'A2L',
            title: 'ASAM MCD-2 MC / ASAP2',
            fileSize,
            summary: [
                { label: 'Blocks', value: blocks.length },
                { label: 'Measurements', value: blockCounts.get('MEASUREMENT') || 0 },
                { label: 'Characteristics', value: blockCounts.get('CHARACTERISTIC') || 0 },
                { label: 'IF_DATA', value: blockCounts.get('IF_DATA') || 0 }
            ],
            tables: [
                {
                    title: 'Important blocks',
                    headers: ['Type', 'Name', 'Line'],
                    rows: focusRows
                },
                {
                    title: 'Block counts',
                    headers: ['Type', 'Count'],
                    rows: Array.from(blockCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => [type, count])
                }
            ],
            rawPreview: this.preview(source),
            warnings: blocks.length > 1000 ? ['Large A2L file: important block table is limited to the first 1,000 entries.'] : []
        };
    }

    public static parseAsc(source: string, fileSize: string): AutomotiveViewerModel {
        const lines = source.split(/\r?\n/);
        const headers: string[] = [];
        const events: Array<Array<string | number>> = [];
        let canFdCount = 0;
        let classicCanCount = 0;

        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }

            if (!/^\d+(?:\.\d+)?\s+/.test(trimmed)) {
                if (headers.length < 20) {
                    headers.push(trimmed);
                }
                return;
            }

            const event = this.parseAscEvent(trimmed, index + 1);
            if (event) {
                if (event.type === 'CANFD') {
                    canFdCount++;
                } else {
                    classicCanCount++;
                }
                if (events.length < 5000) {
                    events.push([event.time, event.type, event.channel, event.direction, event.id, event.dlc, event.data, event.line]);
                }
            }
        });

        return {
            format: 'ASC',
            title: 'Vector ASCII CAN log',
            fileSize,
            summary: [
                { label: 'Parsed events', value: canFdCount + classicCanCount },
                { label: 'CAN FD events', value: canFdCount },
                { label: 'Classic CAN events', value: classicCanCount },
                { label: 'Header lines', value: headers.length }
            ],
            tables: [
                {
                    title: 'Header',
                    headers: ['#', 'Line'],
                    rows: headers.map((line, index) => [index + 1, line])
                },
                {
                    title: 'CAN events',
                    headers: ['Time', 'Type', 'Channel', 'Dir', 'ID', 'DLC', 'Data', 'Line'],
                    rows: events
                }
            ],
            rawPreview: this.preview(source),
            warnings: canFdCount + classicCanCount > events.length
                ? ['Large ASC file: event table is limited to the first 5,000 parsed events.']
                : []
        };
    }

    public static async parseBlf(filePath: string, fileSize: string): Promise<AutomotiveViewerModel> {
        const buffer = await fs.promises.readFile(filePath);
        const signature = buffer.subarray(0, 4).toString('ascii');
        const headerSize = buffer.length >= 8 ? buffer.readUInt32LE(4) : 0;
        const applicationId = buffer.length >= 40 ? buffer.readUInt32LE(32) : 0;
        const objectCount = buffer.length >= 136 ? this.readUInt64LEAsNumber(buffer, 128) : 0;
        const previewRows = this.hexRows(buffer, 0, Math.min(buffer.length, 256));

        return {
            format: 'BLF',
            title: 'Vector Binary Logging Format',
            fileSize,
            summary: [
                { label: 'Signature', value: signature || '-' },
                { label: 'Header size', value: headerSize },
                { label: 'Application ID', value: applicationId },
                { label: 'Object count hint', value: objectCount || '-' }
            ],
            tables: [
                {
                    title: 'Header preview',
                    headers: ['Offset', 'Hex', 'ASCII'],
                    rows: previewRows
                }
            ],
            warnings: signature === 'LOGG'
                ? ['BLF binary payload preview is available. Full object decoding will require a dedicated BLF object parser.']
                : ['The file does not start with the expected BLF LOGG signature.']
        };
    }

    public static async parseMf4(filePath: string, fileSize: string): Promise<AutomotiveViewerModel> {
        const buffer = await fs.promises.readFile(filePath);
        const magic = buffer.subarray(0, 8).toString('ascii').trim();
        const version = buffer.subarray(8, 16).toString('ascii').trim();
        const program = buffer.subarray(16, 24).toString('ascii').replace(/\0/g, '').trim();
        const blockCounts = this.countMdfBlocks(buffer);

        return {
            format: 'MF4',
            title: 'ASAM MDF 4 measurement data',
            fileSize,
            summary: [
                { label: 'Magic', value: magic || '-' },
                { label: 'Version', value: version || '-' },
                { label: 'Program ID', value: program || '-' },
                { label: 'Known block markers', value: blockCounts.reduce((sum, row) => sum + Number(row[1]), 0) }
            ],
            tables: [
                {
                    title: 'MDF block markers',
                    headers: ['Block', 'Count'],
                    rows: blockCounts
                },
                {
                    title: 'Header preview',
                    headers: ['Offset', 'Hex', 'ASCII'],
                    rows: this.hexRows(buffer, 0, Math.min(buffer.length, 256))
                }
            ],
            warnings: magic === 'MDF'
                ? ['MF4 metadata and header preview are available. Full sample decoding will require an MDF block graph reader.']
                : ['The file does not start with the expected MDF signature.']
        };
    }

    public static async parseAvro(filePath: string, fileSize: string): Promise<AutomotiveViewerModel> {
        const buffer = await fs.promises.readFile(filePath);
        const isObjectContainer = buffer.length >= 4 && buffer.subarray(0, 4).toString('binary') === 'Obj\x01';
        const metadata = isObjectContainer ? this.readAvroMetadata(buffer) : [];
        const schema = metadata.find(row => row[0] === 'avro.schema')?.[1] as string | undefined;
        const codec = metadata.find(row => row[0] === 'avro.codec')?.[1] as string | undefined;
        const syncMarker = buffer.length >= 16 ? buffer.subarray(Math.max(0, buffer.length - 16)).toString('hex') : '-';

        return {
            format: 'AVRO',
            title: 'Apache Avro object container',
            fileSize,
            summary: [
                { label: 'Magic', value: isObjectContainer ? 'Obj\\x01' : '-' },
                { label: 'Metadata entries', value: metadata.length },
                { label: 'Codec', value: codec || 'null' },
                { label: 'Sync marker hint', value: syncMarker }
            ],
            tables: [
                {
                    title: 'Metadata',
                    headers: ['Key', 'Value'],
                    rows: metadata.length > 0 ? metadata : [['-', 'No Avro metadata map could be decoded from the header preview.']]
                },
                {
                    title: 'Header preview',
                    headers: ['Offset', 'Hex', 'ASCII'],
                    rows: this.hexRows(buffer, 0, Math.min(buffer.length, 256))
                }
            ],
            rawPreview: schema ? this.prettyJsonPreview(schema) : undefined,
            warnings: isObjectContainer
                ? ['Avro container metadata and header preview are available. Full block decoding will require Avro schema-based record decoding.']
                : ['The file does not start with the expected Avro object container magic bytes.']
        };
    }

    public static async parseBag(filePath: string, fileSize: string): Promise<AutomotiveViewerModel> {
        const buffer = await fs.promises.readFile(filePath);
        const headerLine = this.firstAsciiLine(buffer);
        const isRosBag = headerLine.startsWith('#ROSBAG V2.');
        const opCounts = this.countRosBagOps(buffer);

        return {
            format: 'BAG',
            title: 'ROS bag',
            fileSize,
            summary: [
                { label: 'Header', value: headerLine || '-' },
                { label: 'Connection records', value: opCounts.connection },
                { label: 'Chunk records', value: opCounts.chunk },
                { label: 'Message data records', value: opCounts.messageData }
            ],
            tables: [
                {
                    title: 'Record op hints',
                    headers: ['Record type', 'Count'],
                    rows: [
                        ['Bag header', opCounts.bagHeader],
                        ['Connection', opCounts.connection],
                        ['Chunk', opCounts.chunk],
                        ['Index data', opCounts.indexData],
                        ['Chunk info', opCounts.chunkInfo],
                        ['Message data', opCounts.messageData]
                    ].filter(row => Number(row[1]) > 0)
                },
                {
                    title: 'Header preview',
                    headers: ['Offset', 'Hex', 'ASCII'],
                    rows: this.hexRows(buffer, 0, Math.min(buffer.length, 256))
                }
            ],
            warnings: isRosBag
                ? ['ROS bag structure hints and binary preview are available. Full topic/message decoding will require a ROS bag record reader.']
                : ['The file does not start with the expected ROS bag header.']
        };
    }

    public static async parseStp(filePath: string, fileSize: string): Promise<AutomotiveViewerModel> {
        const source = await fs.promises.readFile(filePath, 'utf8');
        const header = this.extractStepHeader(source);
        const entities = this.collectStepEntities(source);
        const entityCounts = new Map<string, number>();
        entities.forEach(entity => entityCounts.set(entity.type, (entityCounts.get(entity.type) || 0) + 1));

        return {
            format: 'STP',
            title: 'ISO 10303 STEP model',
            fileSize,
            summary: [
                { label: 'Schema', value: header.schema || '-' },
                { label: 'Name', value: header.name || '-' },
                { label: 'Entity lines', value: entities.length },
                { label: 'Entity types', value: entityCounts.size }
            ],
            tables: [
                {
                    title: 'Header',
                    headers: ['Field', 'Value'],
                    rows: [
                        ['Name', header.name || '-'],
                        ['Timestamp', header.timestamp || '-'],
                        ['Author', header.author || '-'],
                        ['Organization', header.organization || '-'],
                        ['Preprocessor', header.preprocessor || '-'],
                        ['Originating system', header.originatingSystem || '-'],
                        ['Authorization', header.authorization || '-'],
                        ['Schema', header.schema || '-']
                    ]
                },
                {
                    title: 'Top entity types',
                    headers: ['Entity', 'Count'],
                    rows: Array.from(entityCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 100)
                        .map(([type, count]) => [type, count])
                },
                {
                    title: 'Entity preview',
                    headers: ['ID', 'Type', 'Line'],
                    rows: entities.slice(0, 1000).map(entity => [entity.id, entity.type, entity.line])
                }
            ],
            rawPreview: this.preview(source),
            warnings: entities.length > 1000 ? ['Large STEP file: entity preview is limited to the first 1,000 entities.'] : []
        };
    }

    public static async parseDb3(filePath: string, fileSize: string): Promise<AutomotiveViewerModel> {
        const buffer = await fs.promises.readFile(filePath);
        const header = buffer.subarray(0, this.SQLITE_HEADER.length).toString('binary');
        const isSqlite = header === this.SQLITE_HEADER;
        const pageSize = buffer.length >= 18 ? this.readSqlitePageSize(buffer) : 0;
        const pageCount = buffer.length >= 32 ? buffer.readUInt32BE(28) : 0;
        const schemaRows = this.extractSqliteSchemaHints(buffer);

        return {
            format: 'DB3',
            title: 'SQLite 3 database',
            fileSize,
            summary: [
                { label: 'Signature', value: isSqlite ? 'SQLite format 3' : '-' },
                { label: 'Page size', value: pageSize || '-' },
                { label: 'Page count hint', value: pageCount || '-' },
                { label: 'Schema text hints', value: schemaRows.length }
            ],
            tables: [
                {
                    title: 'Schema hints',
                    headers: ['#', 'SQL'],
                    rows: schemaRows.length > 0
                        ? schemaRows.map((sql, index) => [index + 1, sql])
                        : [[1, 'No CREATE TABLE/INDEX statements were found in the binary preview.']]
                },
                {
                    title: 'Header preview',
                    headers: ['Offset', 'Hex', 'ASCII'],
                    rows: this.hexRows(buffer, 0, Math.min(buffer.length, 256))
                }
            ],
            warnings: isSqlite
                ? ['SQLite header and schema text hints are available. Full table browsing will require SQLite query support in the extension host.']
                : ['The file does not start with the expected SQLite 3 database header.']
        };
    }

    public static parseReqif(source: string, fileSize: string): AutomotiveViewerModel {
        const header = this.extractReqifHeader(source);
        const specObjects = this.collectReqifElements(source, 'SPEC-OBJECT');
        const specifications = this.collectReqifElements(source, 'SPECIFICATION');
        const specRelations = this.collectReqifElements(source, 'SPEC-RELATION');
        const datatypes = this.collectReqifElements(source, 'DATATYPE-DEFINITION-[A-Z-]+');
        const specTypes = this.collectReqifElements(source, 'SPEC-[A-Z-]*TYPE');

        return {
            format: 'REQIF',
            title: 'Requirements Interchange Format',
            fileSize,
            summary: [
                { label: 'Title', value: header.title || '-' },
                { label: 'Spec objects', value: specObjects.length },
                { label: 'Specifications', value: specifications.length },
                { label: 'Spec relations', value: specRelations.length }
            ],
            tables: [
                {
                    title: 'Header',
                    headers: ['Field', 'Value'],
                    rows: [
                        ['Title', header.title || '-'],
                        ['Identifier', header.identifier || '-'],
                        ['Source tool ID', header.sourceToolId || '-'],
                        ['ReqIF tool ID', header.reqifToolId || '-'],
                        ['Creation time', header.creationTime || '-'],
                        ['Comment', header.comment || '-']
                    ]
                },
                {
                    title: 'Specifications',
                    headers: ['Identifier', 'Long name', 'Type'],
                    rows: specifications.slice(0, 1000).map(item => [item.identifier, item.longName, item.type])
                },
                {
                    title: 'Spec objects',
                    headers: ['Identifier', 'Long name', 'Type'],
                    rows: specObjects.slice(0, 1000).map(item => [item.identifier, item.longName, item.type])
                },
                {
                    title: 'Spec relations',
                    headers: ['Identifier', 'Long name', 'Type'],
                    rows: specRelations.slice(0, 1000).map(item => [item.identifier, item.longName, item.type])
                },
                {
                    title: 'Definitions',
                    headers: ['Kind', 'Identifier', 'Long name'],
                    rows: [
                        ...datatypes.slice(0, 500).map(item => [item.type, item.identifier, item.longName]),
                        ...specTypes.slice(0, 500).map(item => [item.type, item.identifier, item.longName])
                    ]
                }
            ],
            rawPreview: this.preview(source),
            warnings: specObjects.length > 1000 || specifications.length > 1000 || specRelations.length > 1000
                ? ['Large ReqIF file: object, specification, and relation tables are limited to the first 1,000 entries.']
                : []
        };
    }

    private static collectTagText(source: string, parentTag: string, childTag: string): string[] {
        const results: string[] = [];
        const parentPattern = new RegExp(`<${parentTag}\\b[^>]*>([\\s\\S]*?)<\\/${parentTag}>`, 'g');
        let parentMatch: RegExpExecArray | null;
        while ((parentMatch = parentPattern.exec(source)) !== null) {
            const childPattern = new RegExp(`<${childTag}\\b[^>]*>([\\s\\S]*?)<\\/${childTag}>`);
            const childMatch = childPattern.exec(parentMatch[1]);
            if (childMatch) {
                results.push(this.decodeXml(childMatch[1].trim()));
            }
        }
        return results;
    }

    private static collectNamedElements(source: string, tags: string[]): Array<{ type: string; name: string }> {
        const elements: Array<{ type: string; name: string }> = [];
        for (const tag of tags) {
            const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(source)) !== null) {
                const nameMatch = /<SHORT-NAME\b[^>]*>([\s\S]*?)<\/SHORT-NAME>/.exec(match[1]);
                if (nameMatch) {
                    elements.push({ type: tag, name: this.decodeXml(nameMatch[1].trim()) });
                }
            }
        }
        return elements;
    }

    private static collectRefs(source: string): Array<{ tag: string; dest: string; target: string }> {
        const refs: Array<{ tag: string; dest: string; target: string }> = [];
        const pattern = /<([A-Z0-9-]*REF)\b([^>]*)>([\s\S]*?)<\/\1>/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
            const destMatch = /\bDEST="([^"]+)"/.exec(match[2]);
            refs.push({
                tag: match[1],
                dest: destMatch ? destMatch[1] : '',
                target: this.decodeXml(match[3].trim())
            });
        }
        return refs;
    }

    private static extractXmlNamespace(source: string): string | null {
        const match = /<AUTOSAR\b[^>]*\sxmlns="([^"]+)"/.exec(source);
        return match ? match[1] : null;
    }

    private static extractReqifHeader(source: string): {
        title: string;
        identifier: string;
        sourceToolId: string;
        reqifToolId: string;
        creationTime: string;
        comment: string;
    } {
        const headerMatch = /<REQ-IF-HEADER\b[^>]*>([\s\S]*?)<\/REQ-IF-HEADER>/i.exec(source);
        const header = headerMatch ? headerMatch[1] : '';
        return {
            title: this.extractFirstTagText(header, 'TITLE'),
            identifier: this.extractAttribute(headerMatch?.[0] || '', 'IDENTIFIER'),
            sourceToolId: this.extractFirstTagText(header, 'SOURCE-TOOL-ID'),
            reqifToolId: this.extractFirstTagText(header, 'REQ-IF-TOOL-ID'),
            creationTime: this.extractFirstTagText(header, 'CREATION-TIME'),
            comment: this.extractFirstTagText(header, 'COMMENT')
        };
    }

    private static collectReqifElements(source: string, tagPattern: string): Array<{ identifier: string; longName: string; type: string }> {
        const elements: Array<{ identifier: string; longName: string; type: string }> = [];
        const pattern = new RegExp(`<(${tagPattern})(?!-)\\b([^>]*)>`, 'gi');
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(source)) !== null) {
            elements.push({
                type: match[1].toUpperCase(),
                identifier: this.extractAttribute(match[2], 'IDENTIFIER') || '-',
                longName: this.decodeXml(this.extractAttribute(match[2], 'LONG-NAME') || '-')
            });
        }

        return elements;
    }

    private static extractFirstTagText(source: string, tagName: string): string {
        const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(source);
        return match ? this.decodeXml(match[1].trim()) : '';
    }

    private static extractAttribute(source: string, attributeName: string): string {
        const match = new RegExp(`\\b${attributeName}="([^"]*)"`, 'i').exec(source);
        return match ? match[1] : '';
    }

    private static collectA2lBlocks(source: string): Array<{ type: string; name: string; line: number }> {
        const blocks: Array<{ type: string; name: string; line: number }> = [];
        source.split(/\r?\n/).forEach((line, index) => {
            const match = /^\s*\/begin\s+([A-Za-z0-9_]+)(?:\s+("[^"]+"|\S+))?/.exec(line);
            if (match) {
                blocks.push({
                    type: match[1].toUpperCase(),
                    name: match[2] ? match[2].replace(/^"|"$/g, '') : '',
                    line: index + 1
                });
            }
        });
        return blocks;
    }

    private static parseAscEvent(line: string, lineNumber: number): {
        time: string;
        type: string;
        channel: string;
        direction: string;
        id: string;
        dlc: string;
        data: string;
        line: number;
    } | null {
        const parts = line.split(/\s+/);
        if (parts.length < 5) {
            return null;
        }

        if (parts[1] === 'CANFD') {
            const idIndex = parts.findIndex(part => /^[0-9A-Fa-f]+x?$/.test(part) && part !== parts[2]);
            return {
                time: parts[0],
                type: 'CANFD',
                channel: parts[2] || '-',
                direction: parts[3] || '-',
                id: idIndex >= 0 ? parts[idIndex] : '-',
                dlc: idIndex >= 2 ? parts[idIndex + 1] || '-' : '-',
                data: idIndex >= 0 ? parts.slice(idIndex + 5).join(' ') : '',
                line: lineNumber
            };
        }

        const classicMatch = /^(\d+(?:\.\d+)?)\s+(\d+)\s+([0-9A-Fa-f]+x?)\s+(Rx|Tx)\s+d\s+(\d+)\s*(.*)$/.exec(line);
        if (classicMatch) {
            return {
                time: classicMatch[1],
                type: 'CAN',
                channel: classicMatch[2],
                direction: classicMatch[4],
                id: classicMatch[3],
                dlc: classicMatch[5],
                data: classicMatch[6].trim(),
                line: lineNumber
            };
        }

        return null;
    }

    private static countMdfBlocks(buffer: Buffer): Array<Array<string | number>> {
        const blockNames = ['##HD', '##DG', '##CG', '##CN', '##TX', '##MD', '##CC', '##SI', '##DT', '##DZ'];
        return blockNames.map(name => [name, this.countAscii(buffer, name)]).filter(row => Number(row[1]) > 0);
    }

    private static countAscii(buffer: Buffer, needle: string): number {
        let count = 0;
        let index = 0;
        while ((index = buffer.indexOf(needle, index, 'ascii')) !== -1) {
            count++;
            index += needle.length;
        }
        return count;
    }

    private static readAvroMetadata(buffer: Buffer): Array<Array<string>> {
        const rows: Array<Array<string>> = [];
        let offset = 4;
        const maxOffset = Math.min(buffer.length, 64 * 1024);

        try {
            while (offset < maxOffset) {
                const countResult = this.readAvroLong(buffer, offset);
                offset = countResult.offset;
                let count = countResult.value;
                if (count === BigInt(0)) {
                    break;
                }
                if (count < BigInt(0)) {
                    const blockSize = this.readAvroLong(buffer, offset);
                    offset = blockSize.offset;
                    count = -count;
                }
                if (count > BigInt(64)) {
                    break;
                }

                for (let i = BigInt(0); i < count && offset < maxOffset; i++) {
                    const key = this.readAvroBytes(buffer, offset);
                    offset = key.offset;
                    const value = this.readAvroBytes(buffer, offset);
                    offset = value.offset;
                    rows.push([
                        key.bytes.toString('utf8'),
                        this.printableMetadataValue(key.bytes.toString('utf8'), value.bytes)
                    ]);
                }
            }
        } catch (error) {
            return rows;
        }

        return rows;
    }

    private static readAvroLong(buffer: Buffer, offset: number): { value: bigint; offset: number } {
        let result = BigInt(0);
        let shift = BigInt(0);
        let currentOffset = offset;

        while (currentOffset < buffer.length) {
            const byte = buffer[currentOffset++];
            result |= BigInt(byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) {
                const value = result >> BigInt(1) ^ -(result & BigInt(1));
                return { value, offset: currentOffset };
            }
            shift += BigInt(7);
            if (shift > BigInt(63)) {
                break;
            }
        }

        throw new Error('Invalid Avro long value.');
    }

    private static readAvroBytes(buffer: Buffer, offset: number): { bytes: Buffer; offset: number } {
        const lengthResult = this.readAvroLong(buffer, offset);
        const length = Number(lengthResult.value);
        if (!Number.isFinite(length) || length < 0 || lengthResult.offset + length > buffer.length) {
            throw new Error('Invalid Avro bytes value.');
        }
        return {
            bytes: buffer.subarray(lengthResult.offset, lengthResult.offset + length),
            offset: lengthResult.offset + length
        };
    }

    private static printableMetadataValue(key: string, value: Buffer): string {
        if (key === 'avro.schema') {
            return this.compactJson(value.toString('utf8'));
        }
        return value.every(byte => byte >= 32 && byte <= 126 || byte === 9 || byte === 10 || byte === 13)
            ? value.toString('utf8')
            : value.toString('hex');
    }

    private static compactJson(value: string): string {
        try {
            return JSON.stringify(JSON.parse(value));
        } catch (error) {
            return value;
        }
    }

    private static prettyJsonPreview(value: string): string {
        try {
            return JSON.stringify(JSON.parse(value), null, 2);
        } catch (error) {
            return value;
        }
    }

    private static firstAsciiLine(buffer: Buffer): string {
        const end = buffer.indexOf(0x0A);
        const sliceEnd = end === -1 ? Math.min(buffer.length, 256) : end;
        return buffer.subarray(0, sliceEnd).toString('ascii').trim();
    }

    private static countRosBagOps(buffer: Buffer): Record<string, number> {
        return {
            bagHeader: this.countAscii(buffer, 'op=\x03'),
            chunk: this.countAscii(buffer, 'op=\x05'),
            connection: this.countAscii(buffer, 'op=\x07'),
            indexData: this.countAscii(buffer, 'op=\x04'),
            chunkInfo: this.countAscii(buffer, 'op=\x06'),
            messageData: this.countAscii(buffer, 'op=\x02')
        };
    }

    private static extractStepHeader(source: string): {
        name: string;
        timestamp: string;
        author: string;
        organization: string;
        preprocessor: string;
        originatingSystem: string;
        authorization: string;
        schema: string;
    } {
        const description = this.matchStepHeaderValue(source, 'FILE_DESCRIPTION');
        const name = this.matchStepHeaderValue(source, 'FILE_NAME');
        const schema = this.matchStepHeaderValue(source, 'FILE_SCHEMA');
        const nameFields = this.splitStepArguments(name);

        return {
            name: nameFields[0] || '',
            timestamp: nameFields[1] || '',
            author: nameFields[2] || '',
            organization: nameFields[3] || '',
            preprocessor: nameFields[4] || '',
            originatingSystem: nameFields[5] || '',
            authorization: nameFields[6] || description || '',
            schema: this.splitStepArguments(schema).join(', ')
        };
    }

    private static matchStepHeaderValue(source: string, keyword: string): string {
        const match = new RegExp(`${keyword}\\s*\\(([^;]*)\\);`, 'i').exec(source);
        return match ? match[1].trim() : '';
    }

    private static splitStepArguments(value: string): string[] {
        const args: string[] = [];
        let current = '';
        let inString = false;
        let depth = 0;

        for (let i = 0; i < value.length; i++) {
            const char = value[i];
            if (char === "'") {
                inString = !inString;
                continue;
            }
            if (!inString && char === '(') {
                depth++;
                continue;
            }
            if (!inString && char === ')') {
                depth = Math.max(0, depth - 1);
                continue;
            }
            if (!inString && depth === 0 && char === ',') {
                args.push(this.cleanStepValue(current));
                current = '';
                continue;
            }
            current += char;
        }
        if (current.trim()) {
            args.push(this.cleanStepValue(current));
        }
        return args;
    }

    private static cleanStepValue(value: string): string {
        return value.replace(/^\s*\$?\s*|\s*$/g, '').replace(/^'(.*)'$/s, '$1').trim();
    }

    private static collectStepEntities(source: string): Array<{ id: string; type: string; line: number }> {
        const entities: Array<{ id: string; type: string; line: number }> = [];
        source.split(/\r?\n/).forEach((line, index) => {
            const match = /^\s*#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/i.exec(line);
            if (match) {
                entities.push({ id: `#${match[1]}`, type: match[2].toUpperCase(), line: index + 1 });
            }
        });
        return entities;
    }

    private static readSqlitePageSize(buffer: Buffer): number {
        const value = buffer.readUInt16BE(16);
        return value === 1 ? 65536 : value;
    }

    private static extractSqliteSchemaHints(buffer: Buffer): string[] {
        const text = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)).toString('latin1');
        const matches = text.match(/CREATE\s+(?:TABLE|INDEX|VIEW|TRIGGER)[\s\S]{0,400}?(?=\0|$)/gi) || [];
        return matches
            .map(value => value.replace(/[^\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 100);
    }

    private static hexRows(buffer: Buffer, start: number, end: number): Array<Array<string>> {
        const rows: Array<Array<string>> = [];
        for (let offset = start; offset < end; offset += 16) {
            const slice = buffer.subarray(offset, Math.min(offset + 16, end));
            const hex = Array.from(slice).map(byte => byte.toString(16).padStart(2, '0')).join(' ');
            const ascii = Array.from(slice).map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('');
            rows.push([`0x${offset.toString(16).padStart(4, '0')}`, hex, ascii]);
        }
        return rows;
    }

    private static readUInt64LEAsNumber(buffer: Buffer, offset: number): number {
        if (offset + 8 > buffer.length) {
            return 0;
        }
        const value = buffer.readBigUInt64LE(offset);
        return value > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(value);
    }

    private static preview(source: string): string {
        return source.length > 20000 ? `${source.slice(0, 20000)}\n\n... preview truncated ...` : source;
    }

    private static decodeXml(value: string): string {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, '\'')
            .replace(/&amp;/g, '&');
    }
}
