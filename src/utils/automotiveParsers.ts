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

interface PacketDissection {
    protocol: string;
    source: string;
    destination: string;
    info: string;
}

interface SqliteSchemaEntry {
    type: string;
    name: string;
    tableName: string;
    rootPage: number;
    sql: string;
}

interface SqliteRecord {
    rowid: number | string;
    values: Array<string | number>;
}

interface SqliteParseResult {
    schema: SqliteSchemaEntry[];
    previews: Array<{
        tableName: string;
        columns: string[];
        rows: SqliteRecord[];
        truncated: boolean;
    }>;
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
                ? []
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
                ? []
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
                ? []
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
                ? []
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
        const sqlite = isSqlite && pageSize > 0
            ? this.parseSqliteDatabase(buffer, pageSize)
            : { schema: [], previews: [], warnings: [] };
        const schemaRows = sqlite.schema.length > 0
            ? sqlite.schema.map(entry => [entry.type, entry.name, entry.tableName, entry.rootPage, entry.sql])
            : this.extractSqliteSchemaHints(buffer).map((sql, index) => ['hint', `schema-${index + 1}`, '-', '-', sql]);
        const userTables = sqlite.schema.filter(entry => entry.type === 'table' && !entry.name.startsWith('sqlite_'));
        const ros2Tables = ['topics', 'messages', 'schemas', 'metadata']
            .filter(name => userTables.some(entry => entry.name === name));

        return {
            format: 'DB3',
            title: 'SQLite 3 database',
            fileSize,
            summary: [
                { label: 'Signature', value: isSqlite ? 'SQLite format 3' : '-' },
                { label: 'Page size', value: pageSize || '-' },
                { label: 'Page count hint', value: pageCount || '-' },
                { label: 'Tables', value: userTables.length }
            ],
            tables: [
                {
                    title: 'Database header',
                    headers: ['Field', 'Value'],
                    rows: [
                        ['Page size', pageSize || '-'],
                        ['Page count hint', pageCount || '-'],
                        ['Schema entries', sqlite.schema.length],
                        ['ROS2 tables detected', ros2Tables.length > 0 ? ros2Tables.join(', ') : '-']
                    ]
                },
                {
                    title: 'Schema',
                    headers: ['Type', 'Name', 'Table', 'Root page', 'SQL'],
                    rows: schemaRows.length > 0
                        ? schemaRows
                        : [['-', '-', '-', '-', 'No sqlite_master schema rows could be decoded.']]
                },
                ...sqlite.previews.map(preview => ({
                    title: `Rows: ${preview.tableName}`,
                    headers: ['rowid', ...preview.columns],
                    rows: preview.rows.map(row => [row.rowid, ...row.values])
                })),
                {
                    title: 'Header preview',
                    headers: ['Offset', 'Hex', 'ASCII'],
                    rows: this.hexRows(buffer, 0, Math.min(buffer.length, 256))
                }
            ],
            warnings: isSqlite
                ? [...sqlite.warnings]
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

    public static async parsePcap(filePath: string, fileSize: string): Promise<AutomotiveViewerModel> {
        const buffer = await fs.promises.readFile(filePath);
        const header = this.detectPcapHeader(buffer);
        const packets = header
            ? this.collectPcapPackets(buffer, header.littleEndian, header.network)
            : { rows: [], count: 0, truncated: false, invalidOffset: 0 };
        const version = header ? `${header.versionMajor}.${header.versionMinor}` : '-';

        return {
            format: 'PCAP',
            title: 'Packet Capture',
            fileSize,
            summary: [
                { label: 'Magic', value: header?.magic || '-' },
                { label: 'Byte order', value: header ? (header.littleEndian ? 'little endian' : 'big endian') : '-' },
                { label: 'Version', value: version },
                { label: 'Packets parsed', value: packets.count }
            ],
            tables: [
                {
                    title: 'Global header',
                    headers: ['Field', 'Value'],
                    rows: [
                        ['Timestamp resolution', header?.timestampResolution || '-'],
                        ['Timezone offset', header?.thisZone ?? '-'],
                        ['Timestamp accuracy', header?.sigFigs ?? '-'],
                        ['Snapshot length', header?.snapLen ?? '-'],
                        ['Link type', header ? this.describePcapLinkType(header.network) : '-']
                    ]
                },
                {
                    title: 'Packet records',
                    headers: ['#', 'Timestamp', 'Protocol', 'Source', 'Destination', 'Captured length', 'Original length', 'Offset', 'Info'],
                    rows: packets.rows
                },
                {
                    title: 'Header preview',
                    headers: ['Offset', 'Hex', 'ASCII'],
                    rows: this.hexRows(buffer, 0, Math.min(buffer.length, 256))
                }
            ],
            warnings: [
                ...(header ? [] : ['The file does not start with a supported PCAP magic value.']),
                ...(packets.truncated ? [`Packet parsing stopped near offset 0x${packets.invalidOffset.toString(16)} because a record was truncated or invalid.`] : [])
            ]
        };
    }

    public static async parsePcapng(filePath: string, fileSize: string): Promise<AutomotiveViewerModel> {
        const buffer = await fs.promises.readFile(filePath);
        const blocks = this.collectPcapngBlocks(buffer);
        const blockCounts = new Map<string, number>();
        blocks.rows.forEach(row => blockCounts.set(String(row[1]), (blockCounts.get(String(row[1])) || 0) + 1));
        const firstSection = blocks.sections[0];

        return {
            format: 'PCAPNG',
            title: 'Packet Capture Next Generation',
            fileSize,
            summary: [
                { label: 'Sections', value: blocks.sections.length },
                { label: 'Interfaces', value: blockCounts.get('Interface Description') || 0 },
                { label: 'Enhanced packets', value: blockCounts.get('Enhanced Packet') || 0 },
                { label: 'Byte order', value: firstSection ? (firstSection.littleEndian ? 'little endian' : 'big endian') : '-' }
            ],
            tables: [
                {
                    title: 'Sections',
                    headers: ['#', 'Byte order', 'Version', 'Section length', 'Offset'],
                    rows: blocks.sections.map((section, index) => [
                        index + 1,
                        section.littleEndian ? 'little endian' : 'big endian',
                        `${section.major}.${section.minor}`,
                        section.sectionLength,
                        `0x${section.offset.toString(16)}`
                    ])
                },
                {
                    title: 'Blocks',
                    headers: ['#', 'Type', 'Length', 'Captured length', 'Original length', 'Offset'],
                    rows: blocks.rows
                },
                {
                    title: 'Interfaces',
                    headers: ['#', 'Link type', 'Snap length', 'Name', 'Description', 'Timestamp resolution'],
                    rows: blocks.interfaceRows
                },
                {
                    title: 'Packet summaries',
                    headers: ['#', 'Timestamp', 'Protocol', 'Source', 'Destination', 'Captured length', 'Original length', 'Offset', 'Info'],
                    rows: blocks.packetRows
                },
                {
                    title: 'Header preview',
                    headers: ['Offset', 'Hex', 'ASCII'],
                    rows: this.hexRows(buffer, 0, Math.min(buffer.length, 256))
                }
            ],
            warnings: [
                ...(blocks.isPcapng ? [] : ['The file does not start with the expected PCAPNG Section Header Block.']),
                ...(blocks.truncated ? [`Block parsing stopped near offset 0x${blocks.invalidOffset.toString(16)} because a block was truncated or invalid.`] : []),
                ...(blocks.totalBlocks > blocks.rows.length ? ['Large PCAPNG file: block table is limited to the first 5,000 blocks.'] : [])
            ]
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

    private static parseSqliteDatabase(buffer: Buffer, pageSize: number): SqliteParseResult {
        const warnings: string[] = [];
        const schemaRecords = this.readSqliteTableRecords(buffer, pageSize, 1, 500, warnings);
        const schema = schemaRecords
            .map(record => this.toSqliteSchemaEntry(record))
            .filter((entry): entry is SqliteSchemaEntry => entry !== null);
        const tableEntries = schema
            .filter(entry => entry.type === 'table' && entry.rootPage > 0 && !entry.name.startsWith('sqlite_'))
            .slice(0, 12);
        const previews = tableEntries.map(entry => {
            const columns = this.extractSqliteColumnNames(entry.sql);
            const rows = this.readSqliteTableRecords(buffer, pageSize, entry.rootPage, 100, warnings);
            return {
                tableName: entry.name,
                columns,
                rows: rows.map(row => ({
                    rowid: row.rowid,
                    values: this.alignSqliteRowValues(columns, row)
                })),
                truncated: rows.length >= 100
            };
        });

        if (schemaRecords.length === 0) {
            warnings.push('Could not decode sqlite_master rows from page 1.');
        }
        if (schema.length > 500) {
            warnings.push('Large schema: sqlite_master decoding is limited to the first 500 rows.');
        }
        previews
            .filter(preview => preview.truncated)
            .forEach(preview => warnings.push(`Table ${preview.tableName} preview is limited to the first 100 rows.`));

        return { schema, previews, warnings: Array.from(new Set(warnings)) };
    }

    private static toSqliteSchemaEntry(record: SqliteRecord): SqliteSchemaEntry | null {
        if (record.values.length < 5) {
            return null;
        }

        const [type, name, tableName, rootPage, sql] = record.values;
        return {
            type: String(type || ''),
            name: String(name || ''),
            tableName: String(tableName || ''),
            rootPage: Number(rootPage) || 0,
            sql: String(sql || '')
        };
    }

    private static readSqliteTableRecords(
        buffer: Buffer,
        pageSize: number,
        rootPage: number,
        limit: number,
        warnings: string[],
        visited = new Set<number>()
    ): SqliteRecord[] {
        if (rootPage <= 0 || visited.has(rootPage) || visited.size > 512) {
            return [];
        }
        visited.add(rootPage);

        const page = this.getSqlitePage(buffer, pageSize, rootPage);
        if (!page) {
            warnings.push(`Could not read SQLite page ${rootPage}.`);
            return [];
        }

        const headerOffset = rootPage === 1 ? 100 : 0;
        if (page.length < headerOffset + 8) {
            warnings.push(`SQLite page ${rootPage} is too small to contain a b-tree header.`);
            return [];
        }

        const pageType = page[headerOffset];
        const cellCount = page.readUInt16BE(headerOffset + 3);
        const records: SqliteRecord[] = [];

        if (pageType === 0x0D) {
            for (let i = 0; i < cellCount && records.length < limit; i++) {
                const pointerOffset = headerOffset + 8 + i * 2;
                if (pointerOffset + 2 > page.length) {
                    break;
                }
                const cellOffset = page.readUInt16BE(pointerOffset);
                const record = this.readSqliteTableLeafCell(buffer, page, pageSize, cellOffset, rootPage, warnings);
                if (record) {
                    records.push(record);
                }
            }
            return records;
        }

        if (pageType === 0x05) {
            for (let i = 0; i < cellCount && records.length < limit; i++) {
                const pointerOffset = headerOffset + 12 + i * 2;
                if (pointerOffset + 2 > page.length) {
                    break;
                }
                const cellOffset = page.readUInt16BE(pointerOffset);
                if (cellOffset + 4 > page.length) {
                    continue;
                }
                const childPage = page.readUInt32BE(cellOffset);
                records.push(...this.readSqliteTableRecords(buffer, pageSize, childPage, limit - records.length, warnings, visited));
            }

            if (records.length < limit && headerOffset + 12 <= page.length) {
                const rightMostPage = page.readUInt32BE(headerOffset + 8);
                records.push(...this.readSqliteTableRecords(buffer, pageSize, rightMostPage, limit - records.length, warnings, visited));
            }
            return records;
        }

        warnings.push(`SQLite page ${rootPage} has unsupported b-tree page type 0x${pageType.toString(16)}.`);
        return [];
    }

    private static getSqlitePage(buffer: Buffer, pageSize: number, pageNumber: number): Buffer | null {
        const offset = (pageNumber - 1) * pageSize;
        if (pageNumber <= 0 || offset < 0 || offset >= buffer.length) {
            return null;
        }
        return buffer.subarray(offset, Math.min(offset + pageSize, buffer.length));
    }

    private static readSqliteTableLeafCell(
        database: Buffer,
        page: Buffer,
        pageSize: number,
        cellOffset: number,
        pageNumber: number,
        warnings: string[]
    ): SqliteRecord | null {
        if (cellOffset <= 0 || cellOffset >= page.length) {
            return null;
        }

        try {
            const payloadSizeResult = this.readSqliteVarint(page, cellOffset);
            const rowidResult = this.readSqliteVarint(page, payloadSizeResult.offset);
            const payloadStart = rowidResult.offset;
            const payload = this.readSqlitePayload(database, page, pageSize, payloadStart, Number(payloadSizeResult.value), warnings);
            return {
                rowid: this.displaySqliteInteger(rowidResult.value),
                values: this.decodeSqliteRecord(payload)
            };
        } catch (error) {
            warnings.push(`Could not decode SQLite table cell on page ${pageNumber} at offset 0x${cellOffset.toString(16)}.`);
            return null;
        }
    }

    private static readSqlitePayload(
        database: Buffer,
        page: Buffer,
        pageSize: number,
        payloadStart: number,
        payloadSize: number,
        warnings: string[]
    ): Buffer {
        if (payloadSize <= 0) {
            return Buffer.alloc(0);
        }

        const usableSize = pageSize;
        const maxLocal = usableSize - 35;
        let localSize = payloadSize;
        let overflowPointerOffset = -1;

        if (payloadSize > maxLocal) {
            const minLocal = Math.floor((usableSize - 12) * 32 / 255) - 23;
            localSize = minLocal + (payloadSize - minLocal) % (usableSize - 4);
            if (localSize > maxLocal) {
                localSize = minLocal;
            }
            overflowPointerOffset = payloadStart + localSize;
        }

        const chunks: Buffer[] = [];
        chunks.push(page.subarray(payloadStart, Math.min(payloadStart + localSize, page.length)));

        if (overflowPointerOffset >= 0 && overflowPointerOffset + 4 <= page.length) {
            let nextPage = page.readUInt32BE(overflowPointerOffset);
            let remaining = payloadSize - localSize;
            let guard = 0;

            while (nextPage > 0 && remaining > 0 && guard < 256) {
                const overflowPage = this.getSqlitePage(database, pageSize, nextPage);
                if (!overflowPage || overflowPage.length < 4) {
                    warnings.push(`SQLite overflow page ${nextPage} could not be read.`);
                    break;
                }
                nextPage = overflowPage.readUInt32BE(0);
                const chunk = overflowPage.subarray(4, Math.min(4 + remaining, overflowPage.length));
                chunks.push(chunk);
                remaining -= chunk.length;
                guard++;
            }

            if (remaining > 0) {
                warnings.push('A SQLite record uses overflow pages that could not be fully reconstructed.');
            }
        }

        return Buffer.concat(chunks).subarray(0, payloadSize);
    }

    private static decodeSqliteRecord(payload: Buffer): Array<string | number> {
        if (payload.length === 0) {
            return [];
        }

        const headerSizeResult = this.readSqliteVarint(payload, 0);
        const headerSize = Number(headerSizeResult.value);
        const serialTypes: bigint[] = [];
        let headerOffset = headerSizeResult.offset;

        while (headerOffset < headerSize && headerOffset < payload.length) {
            const serialType = this.readSqliteVarint(payload, headerOffset);
            serialTypes.push(serialType.value);
            headerOffset = serialType.offset;
        }

        let bodyOffset = headerSize;
        return serialTypes.map(serialType => {
            const decoded = this.decodeSqliteValue(payload, bodyOffset, serialType);
            bodyOffset += decoded.bytesRead;
            return decoded.value;
        });
    }

    private static decodeSqliteValue(
        payload: Buffer,
        offset: number,
        serialType: bigint
    ): { value: string | number; bytesRead: number } {
        const type = Number(serialType);
        switch (type) {
        case 0:
            return { value: 'NULL', bytesRead: 0 };
        case 1:
            return { value: payload.readInt8(offset), bytesRead: 1 };
        case 2:
            return { value: payload.readInt16BE(offset), bytesRead: 2 };
        case 3:
            return { value: this.readSqliteSignedInteger(payload, offset, 3), bytesRead: 3 };
        case 4:
            return { value: payload.readInt32BE(offset), bytesRead: 4 };
        case 5:
            return { value: this.readSqliteSignedInteger(payload, offset, 6), bytesRead: 6 };
        case 6:
            return { value: this.displaySqliteInteger(payload.readBigInt64BE(offset)), bytesRead: 8 };
        case 7:
            return { value: payload.readDoubleBE(offset), bytesRead: 8 };
        case 8:
            return { value: 0, bytesRead: 0 };
        case 9:
            return { value: 1, bytesRead: 0 };
        default:
            if (type >= 12) {
                const length = type % 2 === 0 ? (type - 12) / 2 : (type - 13) / 2;
                const bytes = payload.subarray(offset, Math.min(offset + length, payload.length));
                if (type % 2 === 0) {
                    return { value: this.formatSqliteBlob(bytes, length), bytesRead: length };
                }
                return { value: bytes.toString('utf8'), bytesRead: length };
            }
            return { value: `reserved(${type})`, bytesRead: 0 };
        }
    }

    private static readSqliteVarint(buffer: Buffer, offset: number): { value: bigint; offset: number } {
        let value = BigInt(0);
        for (let i = 0; i < 9; i++) {
            if (offset + i >= buffer.length) {
                throw new Error('SQLite varint exceeds buffer bounds.');
            }
            const byte = buffer[offset + i];
            if (i === 8) {
                value = (value << BigInt(8)) | BigInt(byte);
                return { value, offset: offset + 9 };
            }
            value = (value << BigInt(7)) | BigInt(byte & 0x7F);
            if ((byte & 0x80) === 0) {
                return { value, offset: offset + i + 1 };
            }
        }
        throw new Error('Invalid SQLite varint.');
    }

    private static readSqliteSignedInteger(buffer: Buffer, offset: number, byteLength: number): number {
        let value = BigInt(0);
        for (let i = 0; i < byteLength; i++) {
            value = (value << BigInt(8)) | BigInt(buffer[offset + i]);
        }
        const signBit = BigInt(1) << BigInt(byteLength * 8 - 1);
        if ((value & signBit) !== BigInt(0)) {
            value -= BigInt(1) << BigInt(byteLength * 8);
        }
        return Number(value);
    }

    private static displaySqliteInteger(value: bigint): number | string {
        return value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)
            ? value.toString()
            : Number(value);
    }

    private static formatSqliteBlob(bytes: Buffer, expectedLength: number): string {
        const preview = bytes.subarray(0, 24).toString('hex');
        const suffix = expectedLength > 24 ? '...' : '';
        return `BLOB(${expectedLength} bytes) ${preview}${suffix}`;
    }

    private static extractSqliteColumnNames(sql: string): string[] {
        const open = sql.indexOf('(');
        const close = sql.lastIndexOf(')');
        if (open === -1 || close <= open) {
            return [];
        }

        return this.splitSqliteDefinitions(sql.slice(open + 1, close))
            .map(definition => this.extractSqliteColumnName(definition))
            .filter((name): name is string => Boolean(name));
    }

    private static splitSqliteDefinitions(source: string): string[] {
        const definitions: string[] = [];
        let current = '';
        let depth = 0;
        let quote: string | null = null;

        for (let i = 0; i < source.length; i++) {
            const char = source[i];
            if (quote) {
                current += char;
                if (char === quote) {
                    quote = null;
                }
                continue;
            }
            if (char === '\'' || char === '"' || char === '`' || char === '[') {
                quote = char === '[' ? ']' : char;
                current += char;
                continue;
            }
            if (char === '(') {
                depth++;
            } else if (char === ')') {
                depth = Math.max(0, depth - 1);
            } else if (char === ',' && depth === 0) {
                definitions.push(current.trim());
                current = '';
                continue;
            }
            current += char;
        }
        if (current.trim()) {
            definitions.push(current.trim());
        }
        return definitions;
    }

    private static extractSqliteColumnName(definition: string): string | null {
        const trimmed = definition.trim();
        if (!trimmed || /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|KEY)\b/i.test(trimmed)) {
            return null;
        }

        const quoted = /^"([^"]+)"|^`([^`]+)`|^\[([^\]]+)\]|^'([^']+)'/.exec(trimmed);
        if (quoted) {
            return quoted[1] || quoted[2] || quoted[3] || quoted[4] || null;
        }

        const match = /^([^\s,]+)/.exec(trimmed);
        return match ? match[1] : null;
    }

    private static alignSqliteRowValues(columns: string[], row: SqliteRecord): Array<string | number> {
        const values = [...row.values];
        if (values.length < columns.length) {
            values.push(...Array(columns.length - values.length).fill(''));
        }
        return values.slice(0, Math.max(columns.length, values.length));
    }

    private static detectPcapHeader(buffer: Buffer): {
        magic: string;
        littleEndian: boolean;
        timestampResolution: string;
        versionMajor: number;
        versionMinor: number;
        thisZone: number;
        sigFigs: number;
        snapLen: number;
        network: number;
    } | null {
        if (buffer.length < 24) {
            return null;
        }

        const variants = [
            { bytes: [0xD4, 0xC3, 0xB2, 0xA1], littleEndian: true, timestampResolution: 'microseconds', magic: '0xA1B2C3D4' },
            { bytes: [0xA1, 0xB2, 0xC3, 0xD4], littleEndian: false, timestampResolution: 'microseconds', magic: '0xA1B2C3D4' },
            { bytes: [0x4D, 0x3C, 0xB2, 0xA1], littleEndian: true, timestampResolution: 'nanoseconds', magic: '0xA1B23C4D' },
            { bytes: [0xA1, 0xB2, 0x3C, 0x4D], littleEndian: false, timestampResolution: 'nanoseconds', magic: '0xA1B23C4D' }
        ];
        const variant = variants.find(item => item.bytes.every((byte, index) => buffer[index] === byte));
        if (!variant) {
            return null;
        }

        return {
            magic: variant.magic,
            littleEndian: variant.littleEndian,
            timestampResolution: variant.timestampResolution,
            versionMajor: this.readUInt16(buffer, 4, variant.littleEndian),
            versionMinor: this.readUInt16(buffer, 6, variant.littleEndian),
            thisZone: this.readInt32(buffer, 8, variant.littleEndian),
            sigFigs: this.readUInt32(buffer, 12, variant.littleEndian),
            snapLen: this.readUInt32(buffer, 16, variant.littleEndian),
            network: this.readUInt32(buffer, 20, variant.littleEndian)
        };
    }

    private static collectPcapPackets(buffer: Buffer, littleEndian: boolean, linkType: number): {
        rows: Array<Array<string | number>>;
        count: number;
        truncated: boolean;
        invalidOffset: number;
    } {
        const rows: Array<Array<string | number>> = [];
        let offset = 24;
        let count = 0;

        while (offset + 16 <= buffer.length) {
            const recordOffset = offset;
            const timestampSeconds = this.readUInt32(buffer, offset, littleEndian);
            const timestampFraction = this.readUInt32(buffer, offset + 4, littleEndian);
            const capturedLength = this.readUInt32(buffer, offset + 8, littleEndian);
            const originalLength = this.readUInt32(buffer, offset + 12, littleEndian);
            offset += 16;

            if (capturedLength > buffer.length - offset) {
                return { rows, count, truncated: true, invalidOffset: recordOffset };
            }

            count++;
            if (rows.length < 5000) {
                const dissection = this.dissectPacket(buffer.subarray(offset, offset + capturedLength), linkType);
                rows.push([
                    count,
                    `${timestampSeconds}.${String(timestampFraction).padStart(6, '0')}`,
                    dissection.protocol,
                    dissection.source,
                    dissection.destination,
                    capturedLength,
                    originalLength,
                    `0x${recordOffset.toString(16)}`,
                    dissection.info
                ]);
            }
            offset += capturedLength;
        }

        return { rows, count, truncated: offset !== buffer.length, invalidOffset: offset };
    }

    private static collectPcapngBlocks(buffer: Buffer): {
        isPcapng: boolean;
        rows: Array<Array<string | number>>;
        packetRows: Array<Array<string | number>>;
        interfaceRows: Array<Array<string | number>>;
        sections: Array<{ offset: number; littleEndian: boolean; major: number; minor: number; sectionLength: string }>;
        totalBlocks: number;
        truncated: boolean;
        invalidOffset: number;
    } {
        const isPcapng = buffer.length >= 12 && this.readUInt32(buffer, 0, true) === 0x0A0D0D0A;
        const rows: Array<Array<string | number>> = [];
        const packetRows: Array<Array<string | number>> = [];
        const interfaceRows: Array<Array<string | number>> = [];
        const sections: Array<{ offset: number; littleEndian: boolean; major: number; minor: number; sectionLength: string }> = [];
        const interfaceLinkTypes: number[] = [];
        let offset = 0;
        let littleEndian = true;
        let totalBlocks = 0;

        while (offset + 12 <= buffer.length) {
            const blockOffset = offset;
            const rawBlockType = this.readUInt32(buffer, offset, littleEndian);
            if (rawBlockType === 0x0A0D0D0A) {
                if (offset + 28 > buffer.length) {
                    return { isPcapng, rows, packetRows, interfaceRows, sections, totalBlocks, truncated: true, invalidOffset: blockOffset };
                }
                const byteOrderMagic = buffer.subarray(offset + 8, offset + 12);
                if (byteOrderMagic.equals(Buffer.from([0x4D, 0x3C, 0x2B, 0x1A]))) {
                    littleEndian = true;
                } else if (byteOrderMagic.equals(Buffer.from([0x1A, 0x2B, 0x3C, 0x4D]))) {
                    littleEndian = false;
                }
            }

            const blockType = this.readUInt32(buffer, offset, littleEndian);
            const blockLength = this.readUInt32(buffer, offset + 4, littleEndian);
            if (blockLength < 12 || offset + blockLength > buffer.length) {
                return { isPcapng, rows, packetRows, interfaceRows, sections, totalBlocks, truncated: true, invalidOffset: blockOffset };
            }

            totalBlocks++;
            const typeName = this.describePcapngBlockType(blockType);
            let capturedLength: string | number = '-';
            let originalLength: string | number = '-';
            let timestamp = '-';
            let packetPayload: Buffer | null = null;
            let linkType = interfaceLinkTypes[0] ?? 1;
            if (blockType === 0x00000006 && blockLength >= 32) {
                const interfaceId = this.readUInt32(buffer, offset + 8, littleEndian);
                const timestampHigh = this.readUInt32(buffer, offset + 12, littleEndian);
                const timestampLow = this.readUInt32(buffer, offset + 16, littleEndian);
                capturedLength = this.readUInt32(buffer, offset + 20, littleEndian);
                originalLength = this.readUInt32(buffer, offset + 24, littleEndian);
                timestamp = `${(BigInt(timestampHigh) << BigInt(32)) + BigInt(timestampLow)}`;
                linkType = interfaceLinkTypes[interfaceId] ?? 1;
                packetPayload = buffer.subarray(offset + 28, offset + 28 + Number(capturedLength));
            } else if (blockType === 0x00000003 && blockLength >= 16) {
                capturedLength = this.readUInt32(buffer, offset + 8, littleEndian);
                originalLength = capturedLength;
                packetPayload = buffer.subarray(offset + 12, offset + 12 + Number(capturedLength));
            }

            if (rows.length < 5000) {
                rows.push([totalBlocks, typeName, blockLength, capturedLength, originalLength, `0x${blockOffset.toString(16)}`]);
            }

            if (blockType === 0x0A0D0D0A) {
                const sectionLength = offset + 24 <= buffer.length
                    ? this.readInt64AsDisplay(buffer, offset + 16, littleEndian)
                    : '-';
                sections.push({
                    offset: blockOffset,
                    littleEndian,
                    major: this.readUInt16(buffer, offset + 12, littleEndian),
                    minor: this.readUInt16(buffer, offset + 14, littleEndian),
                    sectionLength
                });
            } else if (blockType === 0x00000001 && blockLength >= 20) {
                const linkType = this.readUInt16(buffer, offset + 8, littleEndian);
                const snapLength = this.readUInt32(buffer, offset + 12, littleEndian);
                const options = this.readPcapngOptions(buffer, offset + 16, offset + blockLength - 4, littleEndian);
                interfaceLinkTypes.push(linkType);
                interfaceRows.push([
                    interfaceRows.length + 1,
                    this.describePcapLinkType(linkType),
                    snapLength,
                    options.get(2) || '-',
                    options.get(3) || '-',
                    options.get(9) || 'microseconds'
                ]);
            }

            if (packetPayload && packetRows.length < 5000) {
                const dissection = this.dissectPacket(packetPayload, linkType);
                packetRows.push([
                    packetRows.length + 1,
                    timestamp,
                    dissection.protocol,
                    dissection.source,
                    dissection.destination,
                    capturedLength,
                    originalLength,
                    `0x${blockOffset.toString(16)}`,
                    dissection.info
                ]);
            }

            offset += blockLength;
        }

        return { isPcapng, rows, packetRows, interfaceRows, sections, totalBlocks, truncated: offset !== buffer.length, invalidOffset: offset };
    }

    private static describePcapLinkType(value: number): string {
        const names: Record<number, string> = {
            0: 'BSD loopback',
            1: 'Ethernet',
            6: 'IEEE 802.5 Token Ring',
            7: 'ARCNET',
            8: 'SLIP',
            9: 'PPP',
            101: 'Raw IP',
            105: 'IEEE 802.11',
            113: 'Linux cooked capture',
            127: 'Radiotap',
            147: 'User0',
            228: 'IPv4',
            229: 'IPv6'
        };
        return names[value] ? `${value} (${names[value]})` : String(value);
    }

    private static describePcapngBlockType(value: number): string {
        const names: Record<number, string> = {
            0x0A0D0D0A: 'Section Header',
            0x00000001: 'Interface Description',
            0x00000002: 'Packet',
            0x00000003: 'Simple Packet',
            0x00000004: 'Name Resolution',
            0x00000005: 'Interface Statistics',
            0x00000006: 'Enhanced Packet',
            0x0000000A: 'Decryption Secrets'
        };
        return names[value] || `Unknown 0x${value.toString(16).padStart(8, '0')}`;
    }

    private static dissectPacket(packet: Buffer, linkType: number): PacketDissection {
        if (packet.length === 0) {
            return { protocol: '-', source: '-', destination: '-', info: 'Empty packet' };
        }

        if (linkType === 1) {
            return this.dissectEthernet(packet);
        }

        if (linkType === 101 || linkType === 228 || linkType === 229) {
            return this.dissectIpPacket(packet);
        }

        if (linkType === 113 && packet.length >= 16) {
            const protocol = packet.readUInt16BE(14);
            return this.dissectEtherTypePayload(packet.subarray(16), protocol, 'Linux cooked');
        }

        return {
            protocol: `Link ${linkType}`,
            source: '-',
            destination: '-',
            info: `Unsupported link type (${this.describePcapLinkType(linkType)})`
        };
    }

    private static dissectEthernet(packet: Buffer): PacketDissection {
        if (packet.length < 14) {
            return { protocol: 'Ethernet', source: '-', destination: '-', info: 'Truncated Ethernet frame' };
        }

        const destinationMac = this.formatMac(packet.subarray(0, 6));
        const sourceMac = this.formatMac(packet.subarray(6, 12));
        let etherType = packet.readUInt16BE(12);
        let payloadOffset = 14;
        const vlanTags: number[] = [];

        while ((etherType === 0x8100 || etherType === 0x88A8) && packet.length >= payloadOffset + 4) {
            const tagControlInformation = packet.readUInt16BE(payloadOffset);
            const vlanId = tagControlInformation & 0x0FFF;
            const priority = (tagControlInformation >> 13) & 0x07;
            vlanTags.push(vlanId);
            etherType = packet.readUInt16BE(payloadOffset + 2);
            payloadOffset += 4;
            if (priority > 0) {
                vlanTags[vlanTags.length - 1] = Number(`${vlanId}.${priority}`);
            }
        }

        const result = this.dissectEtherTypePayload(packet.subarray(payloadOffset), etherType, 'Ethernet');
        const vlanInfo = vlanTags.length > 1
            ? ` QinQ VLAN ${vlanTags.join('/')}`
            : vlanTags.length === 1 ? ` VLAN ${vlanTags[0]}` : '';
        if (result.source === '-' && result.destination === '-') {
            return {
                ...result,
                source: sourceMac,
                destination: destinationMac,
                info: `${result.info}${vlanInfo}`
            };
        }

        return {
            ...result,
            info: `${result.info}${vlanInfo}`
        };
    }

    private static dissectEtherTypePayload(payload: Buffer, etherType: number, prefix: string): PacketDissection {
        switch (etherType) {
        case 0x0800:
            return this.dissectIpv4(payload);
        case 0x86DD:
            return this.dissectIpv6(payload);
        case 0x0806:
            return this.dissectArp(payload);
        default:
            return {
                protocol: prefix,
                source: '-',
                destination: '-',
                info: `EtherType 0x${etherType.toString(16).padStart(4, '0')}, ${payload.length} byte payload`
            };
        }
    }

    private static dissectIpPacket(packet: Buffer): PacketDissection {
        const version = packet.length > 0 ? packet[0] >> 4 : 0;
        if (version === 4) {
            return this.dissectIpv4(packet);
        }
        if (version === 6) {
            return this.dissectIpv6(packet);
        }
        return { protocol: 'IP', source: '-', destination: '-', info: 'Unknown IP version' };
    }

    private static dissectIpv4(packet: Buffer): PacketDissection {
        if (packet.length < 20) {
            return { protocol: 'IPv4', source: '-', destination: '-', info: 'Truncated IPv4 packet' };
        }

        const headerLength = (packet[0] & 0x0F) * 4;
        if (headerLength < 20 || packet.length < headerLength) {
            return { protocol: 'IPv4', source: '-', destination: '-', info: 'Invalid IPv4 header length' };
        }

        const protocol = packet[9];
        const source = this.formatIpv4(packet, 12);
        const destination = this.formatIpv4(packet, 16);
        const totalLength = packet.readUInt16BE(2);
        const flagsAndOffset = packet.readUInt16BE(6);
        const fragmentOffset = (flagsAndOffset & 0x1FFF) * 8;
        const moreFragments = (flagsAndOffset & 0x2000) !== 0;
        const fragmentInfo = moreFragments || fragmentOffset > 0 ? ` fragment offset=${fragmentOffset}${moreFragments ? ', more fragments' : ''};` : '';
        const payloadLength = Math.max(0, Math.min(packet.length, totalLength || packet.length) - headerLength);
        const transport = this.dissectTransport(protocol, packet.subarray(headerLength, headerLength + payloadLength), source, destination, 'IPv4');
        if (transport) {
            return fragmentInfo ? { ...transport, info: `${fragmentInfo} ${transport.info}` } : transport;
        }
        return {
            protocol: `IPv4/${protocol}`,
            source,
            destination,
            info: `${fragmentInfo} ${payloadLength} byte payload`.trim()
        };
    }

    private static dissectIpv6(packet: Buffer): PacketDissection {
        if (packet.length < 40) {
            return { protocol: 'IPv6', source: '-', destination: '-', info: 'Truncated IPv6 packet' };
        }

        const nextHeader = packet[6];
        const source = this.formatIpv6(packet.subarray(8, 24));
        const destination = this.formatIpv6(packet.subarray(24, 40));
        const payloadLength = packet.readUInt16BE(4);
        const transport = this.dissectTransport(nextHeader, packet.subarray(40, 40 + payloadLength), source, destination, 'IPv6');
        return transport || {
            protocol: `IPv6/${nextHeader}`,
            source,
            destination,
            info: `${payloadLength} byte payload`
        };
    }

    private static dissectArp(packet: Buffer): PacketDissection {
        if (packet.length < 28) {
            return { protocol: 'ARP', source: '-', destination: '-', info: 'Truncated ARP packet' };
        }

        const operation = packet.readUInt16BE(6);
        const senderMac = this.formatMac(packet.subarray(8, 14));
        const senderIp = this.formatIpv4(packet, 14);
        const targetMac = this.formatMac(packet.subarray(18, 24));
        const targetIp = this.formatIpv4(packet, 24);
        const opName = operation === 1 ? 'Request' : operation === 2 ? 'Reply' : `Op ${operation}`;

        return {
            protocol: 'ARP',
            source: `${senderIp} (${senderMac})`,
            destination: `${targetIp} (${targetMac})`,
            info: operation === 1 ? `Who has ${targetIp}? Tell ${senderIp}` : `${senderIp} is at ${senderMac} (${opName})`
        };
    }

    private static dissectTransport(protocol: number, payload: Buffer, sourceIp: string, destinationIp: string, ipVersion: string): PacketDissection | null {
        if (protocol === 6) {
            return this.dissectTcp(payload, sourceIp, destinationIp, ipVersion);
        }
        if (protocol === 17) {
            return this.dissectUdp(payload, sourceIp, destinationIp, ipVersion);
        }
        if (protocol === 1 || protocol === 58) {
            return this.dissectIcmp(payload, sourceIp, destinationIp, protocol === 58 ? 'ICMPv6' : 'ICMP');
        }
        return null;
    }

    private static dissectTcp(payload: Buffer, sourceIp: string, destinationIp: string, ipVersion: string): PacketDissection {
        if (payload.length < 20) {
            return { protocol: `${ipVersion}/TCP`, source: sourceIp, destination: destinationIp, info: 'Truncated TCP segment' };
        }

        const sourcePort = payload.readUInt16BE(0);
        const destinationPort = payload.readUInt16BE(2);
        const seq = payload.readUInt32BE(4);
        const ack = payload.readUInt32BE(8);
        const dataOffset = (payload[12] >> 4) * 4;
        const flags = this.describeTcpFlags(payload[13]);
        const window = payload.readUInt16BE(14);
        const appPayload = dataOffset <= payload.length ? payload.subarray(dataOffset) : Buffer.alloc(0);
        const app = this.describeApplicationPayload(sourcePort, destinationPort, appPayload, true);

        return {
            protocol: app.protocol || `${ipVersion}/TCP`,
            source: `${sourceIp}:${sourcePort}`,
            destination: `${destinationIp}:${destinationPort}`,
            info: app.info || `TCP ${flags || 'no flags'}, seq=${seq}, ack=${ack}, win=${window}, ${appPayload.length} byte payload${this.payloadPreview(appPayload)}`
        };
    }

    private static dissectUdp(payload: Buffer, sourceIp: string, destinationIp: string, ipVersion: string): PacketDissection {
        if (payload.length < 8) {
            return { protocol: `${ipVersion}/UDP`, source: sourceIp, destination: destinationIp, info: 'Truncated UDP datagram' };
        }

        const sourcePort = payload.readUInt16BE(0);
        const destinationPort = payload.readUInt16BE(2);
        const length = payload.readUInt16BE(4);
        const appPayload = payload.subarray(8, Math.min(payload.length, length || payload.length));
        const app = this.describeApplicationPayload(sourcePort, destinationPort, appPayload, false);

        return {
            protocol: app.protocol || `${ipVersion}/UDP`,
            source: `${sourceIp}:${sourcePort}`,
            destination: `${destinationIp}:${destinationPort}`,
            info: app.info || `UDP ${appPayload.length} byte payload${this.payloadPreview(appPayload)}`
        };
    }

    private static dissectIcmp(payload: Buffer, sourceIp: string, destinationIp: string, protocol: string): PacketDissection {
        if (payload.length < 2) {
            return { protocol, source: sourceIp, destination: destinationIp, info: `Truncated ${protocol} message` };
        }
        return {
            protocol,
            source: sourceIp,
            destination: destinationIp,
            info: `Type ${payload[0]}, code ${payload[1]}`
        };
    }

    private static describeApplicationPayload(sourcePort: number, destinationPort: number, payload: Buffer, isTcp: boolean): { protocol: string; info: string } {
        const lowerPort = Math.min(sourcePort, destinationPort);
        const higherPort = Math.max(sourcePort, destinationPort);
        if (!isTcp && sourcePort === 5353 || !isTcp && destinationPort === 5353) {
            return { protocol: 'mDNS', info: this.describeDns(payload) };
        }

        if (sourcePort === 53 || destinationPort === 53) {
            const dnsPayload = isTcp && payload.length >= 2 ? payload.subarray(2) : payload;
            return { protocol: 'DNS', info: this.describeDns(dnsPayload) };
        }

        if (!isTcp && (sourcePort === 67 || sourcePort === 68 || destinationPort === 67 || destinationPort === 68)) {
            return { protocol: 'DHCP', info: this.describeDhcp(payload) };
        }

        if (!isTcp && (sourcePort === 123 || destinationPort === 123)) {
            return { protocol: 'NTP', info: this.describeNtp(payload) };
        }

        if (!isTcp && (sourcePort === 1900 || destinationPort === 1900)) {
            const ssdp = this.describeSsdp(payload);
            if (ssdp) {
                return { protocol: 'SSDP', info: ssdp };
            }
        }

        if (!isTcp && (sourcePort === 5683 || destinationPort === 5683 || sourcePort === 5684 || destinationPort === 5684)) {
            return { protocol: 'CoAP', info: this.describeCoap(payload) };
        }

        if (isTcp && ([80, 8080, 8000, 8008, 8888].includes(lowerPort) || higherPort === 80)) {
            const http = this.describeHttp(payload);
            if (http) {
                return { protocol: 'HTTP', info: http };
            }
        }

        if (isTcp && (sourcePort === 1883 || destinationPort === 1883)) {
            return { protocol: 'MQTT', info: this.describeMqtt(payload) };
        }

        if (isTcp && (sourcePort === 443 || destinationPort === 443)) {
            return { protocol: 'TLS', info: this.describeTls(payload) };
        }

        return { protocol: '', info: '' };
    }

    private static describeDns(payload: Buffer): string {
        if (payload.length < 12) {
            return 'Truncated DNS message';
        }
        const id = payload.readUInt16BE(0);
        const flags = payload.readUInt16BE(2);
        const qdCount = payload.readUInt16BE(4);
        const anCount = payload.readUInt16BE(6);
        const isResponse = (flags & 0x8000) !== 0;
        const responseCode = flags & 0x000F;
        const questionData = qdCount > 0 ? this.readDnsQuestion(payload, 12) : null;
        const answers = questionData ? this.readDnsAnswers(payload, questionData.offset, anCount) : [];
        const question = questionData ? `${questionData.name} ${questionData.type}` : '';
        return `${isResponse ? 'Response' : 'Query'} id=0x${id.toString(16).padStart(4, '0')}, rcode=${this.describeDnsRcode(responseCode)}, questions=${qdCount}, answers=${anCount}${question ? `, ${question}` : ''}${answers.length > 0 ? `, ${answers.join('; ')}` : ''}`;
    }

    private static readDnsName(payload: Buffer, offset: number): { name: string; offset: number } {
        const labels: string[] = [];
        let currentOffset = offset;
        let jumps = 0;

        while (currentOffset < payload.length && jumps < 16) {
            const length = payload[currentOffset];
            if (length === 0) {
                return { name: labels.join('.'), offset: currentOffset + 1 };
            }
            if ((length & 0xC0) === 0xC0) {
                if (currentOffset + 1 >= payload.length) {
                    break;
                }
                const pointer = ((length & 0x3F) << 8) | payload[currentOffset + 1];
                currentOffset = pointer;
                jumps++;
                continue;
            }
            currentOffset++;
            if (currentOffset + length > payload.length) {
                break;
            }
            labels.push(payload.subarray(currentOffset, currentOffset + length).toString('ascii'));
            currentOffset += length;
        }

        return { name: labels.join('.') || '-', offset: currentOffset };
    }

    private static readDnsQuestion(payload: Buffer, offset: number): { name: string; type: string; offset: number } | null {
        const name = this.readDnsName(payload, offset);
        if (name.offset + 4 > payload.length) {
            return null;
        }
        return {
            name: name.name,
            type: this.describeDnsType(payload.readUInt16BE(name.offset)),
            offset: name.offset + 4
        };
    }

    private static readDnsAnswers(payload: Buffer, offset: number, answerCount: number): string[] {
        const answers: string[] = [];
        let currentOffset = offset;

        for (let index = 0; index < answerCount && index < 3 && currentOffset < payload.length; index++) {
            const name = this.readDnsName(payload, currentOffset);
            currentOffset = name.offset;
            if (currentOffset + 10 > payload.length) {
                break;
            }
            const type = payload.readUInt16BE(currentOffset);
            const dataLength = payload.readUInt16BE(currentOffset + 8);
            const dataOffset = currentOffset + 10;
            if (dataOffset + dataLength > payload.length) {
                break;
            }

            answers.push(`${name.name} ${this.describeDnsType(type)} ${this.describeDnsRdata(payload, type, dataOffset, dataLength)}`);
            currentOffset = dataOffset + dataLength;
        }

        return answers;
    }

    private static describeDnsType(type: number): string {
        const names: Record<number, string> = {
            1: 'A',
            2: 'NS',
            5: 'CNAME',
            12: 'PTR',
            15: 'MX',
            16: 'TXT',
            28: 'AAAA',
            33: 'SRV',
            65: 'HTTPS'
        };
        return names[type] || `TYPE${type}`;
    }

    private static describeDnsRcode(code: number): string {
        const names: Record<number, string> = {
            0: 'NOERROR',
            1: 'FORMERR',
            2: 'SERVFAIL',
            3: 'NXDOMAIN',
            4: 'NOTIMP',
            5: 'REFUSED'
        };
        return names[code] || String(code);
    }

    private static describeDnsRdata(payload: Buffer, type: number, offset: number, length: number): string {
        if (type === 1 && length === 4) {
            return this.formatIpv4(payload, offset);
        }
        if (type === 28 && length === 16) {
            return this.formatIpv6(payload.subarray(offset, offset + length));
        }
        if ([2, 5, 12].includes(type)) {
            return this.readDnsName(payload, offset).name;
        }
        return `${length} bytes`;
    }

    private static describeDhcp(payload: Buffer): string {
        if (payload.length < 240) {
            return 'Truncated DHCP/BOOTP message';
        }

        const op = payload[0] === 1 ? 'Request' : payload[0] === 2 ? 'Reply' : `Op ${payload[0]}`;
        const xid = payload.readUInt32BE(4).toString(16).padStart(8, '0');
        const clientIp = this.formatIpv4(payload, 12);
        const yourIp = this.formatIpv4(payload, 16);
        const clientMac = this.formatMac(payload.subarray(28, 34));
        const messageType = this.describeDhcpMessageType(this.readDhcpOption(payload, 53)?.[0] || 0);

        return `${messageType || op}, xid=0x${xid}, client=${clientMac}, ciaddr=${clientIp}, yiaddr=${yourIp}`;
    }

    private static readDhcpOption(payload: Buffer, optionCode: number): Buffer | null {
        let offset = 240;
        while (offset + 1 < payload.length) {
            const code = payload[offset++];
            if (code === 255) {
                break;
            }
            if (code === 0) {
                continue;
            }
            if (offset >= payload.length) {
                break;
            }
            const length = payload[offset++];
            if (offset + length > payload.length) {
                break;
            }
            if (code === optionCode) {
                return payload.subarray(offset, offset + length);
            }
            offset += length;
        }
        return null;
    }

    private static describeDhcpMessageType(value: number): string {
        const names: Record<number, string> = {
            1: 'Discover',
            2: 'Offer',
            3: 'Request',
            4: 'Decline',
            5: 'Ack',
            6: 'Nak',
            7: 'Release',
            8: 'Inform'
        };
        return names[value] ? `DHCP ${names[value]}` : '';
    }

    private static describeNtp(payload: Buffer): string {
        if (payload.length < 48) {
            return 'Truncated NTP message';
        }
        const leap = payload[0] >> 6;
        const version = (payload[0] >> 3) & 0x07;
        const mode = payload[0] & 0x07;
        const stratum = payload[1];
        const transmitSeconds = payload.readUInt32BE(40);
        return `LI=${leap}, version=${version}, mode=${this.describeNtpMode(mode)}, stratum=${stratum}, tx=${transmitSeconds}`;
    }

    private static describeNtpMode(mode: number): string {
        const names: Record<number, string> = {
            1: 'symmetric active',
            2: 'symmetric passive',
            3: 'client',
            4: 'server',
            5: 'broadcast'
        };
        return names[mode] || String(mode);
    }

    private static describeSsdp(payload: Buffer): string {
        const text = payload.subarray(0, Math.min(payload.length, 1024)).toString('utf8');
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const firstLine = lines[0] || '';
        if (!/^(M-SEARCH|NOTIFY|HTTP\/1\.)/i.test(firstLine)) {
            return '';
        }
        const host = lines.find(line => /^host:/i.test(line));
        const target = lines.find(line => /^(st|nt):/i.test(line));
        const location = lines.find(line => /^location:/i.test(line));
        return [firstLine, host, target, location].filter(Boolean).join(' | ');
    }

    private static describeMqtt(payload: Buffer): string {
        if (payload.length < 2) {
            return 'Truncated MQTT packet';
        }
        const type = payload[0] >> 4;
        const typeName = this.describeMqttType(type);
        const remaining = this.readMqttRemainingLength(payload, 1);
        if (!remaining) {
            return `${typeName}, invalid remaining length`;
        }

        let detail = '';
        if (type === 1 && remaining.offset + 2 <= payload.length) {
            const protocolNameLength = payload.readUInt16BE(remaining.offset);
            const nameStart = remaining.offset + 2;
            const protocolName = nameStart + protocolNameLength <= payload.length
                ? payload.subarray(nameStart, nameStart + protocolNameLength).toString('utf8')
                : '';
            detail = protocolName ? `, protocol=${protocolName}` : '';
        } else if ((type === 3 || type === 8 || type === 10) && remaining.offset + 2 <= payload.length) {
            const topicLength = payload.readUInt16BE(remaining.offset);
            const topicStart = remaining.offset + 2;
            const topic = topicStart + topicLength <= payload.length
                ? payload.subarray(topicStart, topicStart + topicLength).toString('utf8')
                : '';
            detail = topic ? `, topic=${topic}` : '';
        }

        return `${typeName}, remaining=${remaining.length}${detail}`;
    }

    private static readMqttRemainingLength(payload: Buffer, offset: number): { length: number; offset: number } | null {
        let multiplier = 1;
        let value = 0;
        let currentOffset = offset;

        for (let index = 0; index < 4 && currentOffset < payload.length; index++) {
            const byte = payload[currentOffset++];
            value += (byte & 0x7F) * multiplier;
            if ((byte & 0x80) === 0) {
                return { length: value, offset: currentOffset };
            }
            multiplier *= 128;
        }

        return null;
    }

    private static describeMqttType(type: number): string {
        const names: Record<number, string> = {
            1: 'CONNECT',
            2: 'CONNACK',
            3: 'PUBLISH',
            4: 'PUBACK',
            5: 'PUBREC',
            6: 'PUBREL',
            7: 'PUBCOMP',
            8: 'SUBSCRIBE',
            9: 'SUBACK',
            10: 'UNSUBSCRIBE',
            11: 'UNSUBACK',
            12: 'PINGREQ',
            13: 'PINGRESP',
            14: 'DISCONNECT',
            15: 'AUTH'
        };
        return names[type] || `Type ${type}`;
    }

    private static describeCoap(payload: Buffer): string {
        if (payload.length < 4) {
            return 'Truncated CoAP message';
        }
        const version = payload[0] >> 6;
        const type = (payload[0] >> 4) & 0x03;
        const tokenLength = payload[0] & 0x0F;
        const codeClass = payload[1] >> 5;
        const codeDetail = payload[1] & 0x1F;
        const messageId = payload.readUInt16BE(2);
        return `v${version}, ${this.describeCoapType(type)}, code=${codeClass}.${String(codeDetail).padStart(2, '0')}, mid=${messageId}, tokenLen=${tokenLength}`;
    }

    private static describeCoapType(type: number): string {
        const names: Record<number, string> = {
            0: 'Confirmable',
            1: 'Non-confirmable',
            2: 'Acknowledgement',
            3: 'Reset'
        };
        return names[type] || String(type);
    }

    private static describeHttp(payload: Buffer): string {
        const text = payload.subarray(0, Math.min(payload.length, 1024)).toString('utf8');
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const firstLine = lines[0] || '';
        if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s|^HTTP\/\d/.test(firstLine)) {
            return '';
        }
        const host = lines.find(line => /^host:/i.test(line));
        const contentType = lines.find(line => /^content-type:/i.test(line));
        return [firstLine, host, contentType].filter(Boolean).join(' | ');
    }

    private static describeTls(payload: Buffer): string {
        if (payload.length < 5) {
            return 'TLS/SSL encrypted payload';
        }
        const contentTypes: Record<number, string> = {
            20: 'ChangeCipherSpec',
            21: 'Alert',
            22: 'Handshake',
            23: 'Application Data'
        };
        const contentType = contentTypes[payload[0]] || `Type ${payload[0]}`;
        const version = `0x${payload.readUInt16BE(1).toString(16)}`;
        const length = payload.readUInt16BE(3);
        const sni = payload[0] === 22 ? this.extractTlsSni(payload) : '';
        return `${contentType}, version ${version}, ${length} byte record${sni ? `, SNI ${sni}` : ''}`;
    }

    private static extractTlsSni(payload: Buffer): string {
        if (payload.length < 9 || payload[0] !== 22 || payload[5] !== 1) {
            return '';
        }

        let offset = 9;
        offset += 2 + 32;
        if (offset >= payload.length) return '';
        const sessionIdLength = payload[offset++];
        offset += sessionIdLength;
        if (offset + 2 > payload.length) return '';
        const cipherSuitesLength = payload.readUInt16BE(offset);
        offset += 2 + cipherSuitesLength;
        if (offset >= payload.length) return '';
        const compressionMethodsLength = payload[offset++];
        offset += compressionMethodsLength;
        if (offset + 2 > payload.length) return '';
        const extensionsEnd = offset + 2 + payload.readUInt16BE(offset);
        offset += 2;

        while (offset + 4 <= payload.length && offset + 4 <= extensionsEnd) {
            const extensionType = payload.readUInt16BE(offset);
            const extensionLength = payload.readUInt16BE(offset + 2);
            offset += 4;
            if (extensionType === 0 && offset + extensionLength <= payload.length) {
                return this.readTlsServerName(payload.subarray(offset, offset + extensionLength));
            }
            offset += extensionLength;
        }

        return '';
    }

    private static readTlsServerName(extension: Buffer): string {
        if (extension.length < 5) {
            return '';
        }
        let offset = 2;
        while (offset + 3 <= extension.length) {
            const nameType = extension[offset++];
            const nameLength = extension.readUInt16BE(offset);
            offset += 2;
            if (nameType === 0 && offset + nameLength <= extension.length) {
                return extension.subarray(offset, offset + nameLength).toString('utf8');
            }
            offset += nameLength;
        }
        return '';
    }

    private static describeTcpFlags(value: number): string {
        const flags: string[] = [];
        if (value & 0x01) flags.push('FIN');
        if (value & 0x02) flags.push('SYN');
        if (value & 0x04) flags.push('RST');
        if (value & 0x08) flags.push('PSH');
        if (value & 0x10) flags.push('ACK');
        if (value & 0x20) flags.push('URG');
        if (value & 0x40) flags.push('ECE');
        if (value & 0x80) flags.push('CWR');
        return flags.join(',');
    }

    private static firstPrintableLine(payload: Buffer): string {
        const text = payload.subarray(0, Math.min(payload.length, 160)).toString('utf8');
        const line = text.split(/\r?\n/)[0]?.trim();
        return line && /^[\x20-\x7E]+$/.test(line) ? line : '';
    }

    private static payloadPreview(payload: Buffer): string {
        if (payload.length === 0) {
            return '';
        }
        const preview = payload.subarray(0, Math.min(payload.length, 16));
        const hex = Array.from(preview).map(byte => byte.toString(16).padStart(2, '0')).join(' ');
        const ascii = Array.from(preview).map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('');
        return `, payload ${hex} | ${ascii}`;
    }

    private static readPcapngOptions(buffer: Buffer, start: number, end: number, littleEndian: boolean): Map<number, string> {
        const options = new Map<number, string>();
        let offset = start;

        while (offset + 4 <= end) {
            const code = this.readUInt16(buffer, offset, littleEndian);
            const length = this.readUInt16(buffer, offset + 2, littleEndian);
            offset += 4;
            if (code === 0) {
                break;
            }
            if (offset + length > end) {
                break;
            }
            const value = buffer.subarray(offset, offset + length);
            options.set(code, this.printablePcapngOption(code, value));
            offset += length + ((4 - length % 4) % 4);
        }

        return options;
    }

    private static printablePcapngOption(code: number, value: Buffer): string {
        if (code === 9 && value.length > 0) {
            const raw = value[0];
            if ((raw & 0x80) !== 0) {
                return `2^-${raw & 0x7F}`;
            }
            return `10^-${raw}`;
        }
        return value.every(byte => byte >= 32 && byte <= 126 || byte === 9)
            ? value.toString('utf8')
            : value.toString('hex');
    }

    private static formatMac(bytes: Buffer): string {
        return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join(':');
    }

    private static formatIpv4(buffer: Buffer, offset: number): string {
        if (offset + 4 > buffer.length) {
            return '-';
        }
        return `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
    }

    private static formatIpv6(bytes: Buffer): string {
        if (bytes.length < 16) {
            return '-';
        }
        const groups: string[] = [];
        for (let offset = 0; offset < 16; offset += 2) {
            groups.push(bytes.readUInt16BE(offset).toString(16));
        }
        return groups.join(':');
    }

    private static readUInt16(buffer: Buffer, offset: number, littleEndian: boolean): number {
        return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    }

    private static readUInt32(buffer: Buffer, offset: number, littleEndian: boolean): number {
        return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    }

    private static readInt32(buffer: Buffer, offset: number, littleEndian: boolean): number {
        return littleEndian ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset);
    }

    private static readInt64AsDisplay(buffer: Buffer, offset: number, littleEndian: boolean): string {
        if (offset + 8 > buffer.length) {
            return '-';
        }
        const value = littleEndian ? buffer.readBigInt64LE(offset) : buffer.readBigInt64BE(offset);
        return value === BigInt(-1) ? 'unspecified' : value.toString();
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
