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
