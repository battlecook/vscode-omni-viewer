import * as fs from 'fs';
import type { AutomotiveTable, AutomotiveViewerModel } from './automotiveParsers';
import { Hdf5Parser } from './hdf5Parser';

const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const MAT_V5_HEADER_BYTES = 128;
const MAX_VARIABLES = 5000;
const MAX_PREVIEW_VALUES = 24;

const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_INT16 = 3;
const MI_UINT16 = 4;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_SINGLE = 7;
const MI_DOUBLE = 9;
const MI_INT64 = 12;
const MI_UINT64 = 13;
const MI_MATRIX = 14;
const MI_UTF8 = 16;
const MI_UTF16 = 17;
const MI_UTF32 = 18;

const MX_CLASSES: Record<number, string> = {
    1: 'cell',
    2: 'struct',
    3: 'object',
    4: 'char',
    5: 'sparse',
    6: 'double',
    7: 'single',
    8: 'int8',
    9: 'uint8',
    10: 'int16',
    11: 'uint16',
    12: 'int32',
    13: 'uint32',
    14: 'int64',
    15: 'uint64'
};

const MI_TYPES: Record<number, string> = {
    [MI_INT8]: 'miINT8',
    [MI_UINT8]: 'miUINT8',
    [MI_INT16]: 'miINT16',
    [MI_UINT16]: 'miUINT16',
    [MI_INT32]: 'miINT32',
    [MI_UINT32]: 'miUINT32',
    [MI_SINGLE]: 'miSINGLE',
    [MI_DOUBLE]: 'miDOUBLE',
    [MI_INT64]: 'miINT64',
    [MI_UINT64]: 'miUINT64',
    [MI_MATRIX]: 'miMATRIX',
    [MI_UTF8]: 'miUTF8',
    [MI_UTF16]: 'miUTF16',
    [MI_UTF32]: 'miUTF32'
};

type Endian = 'LE' | 'BE';

interface DataElement {
    type: number;
    size: number;
    dataOffset: number;
    nextOffset: number;
    small: boolean;
}

interface MatVariable {
    name: string;
    className: string;
    dimensions: number[];
    dataType: string;
    bytes: number;
    preview: string;
    attributes: string[];
}

export class MatParser {
    public static parseFile(filePath: string, fileSize: string): AutomotiveViewerModel {
        const header = Buffer.alloc(512);
        const fd = fs.openSync(filePath, 'r');
        let bytesRead = 0;
        try {
            bytesRead = fs.readSync(fd, header, 0, header.length, 0);
        } finally {
            fs.closeSync(fd);
        }

        const signature = header.subarray(0, bytesRead);
        if (matchesBytes(signature, HDF5_SIGNATURE)) {
            return this.parseHdf5Mat(filePath, fileSize);
        }

        const buffer = fs.readFileSync(filePath);
        return this.parse(buffer, fileSize);
    }

    public static parse(buffer: Buffer, fileSize: string): AutomotiveViewerModel {
        if (matchesBytes(buffer, HDF5_SIGNATURE)) {
            const model = Hdf5Parser.parse(buffer, fileSize);
            return this.decorateHdf5Model(model);
        }

        if (this.isLevel5(buffer)) {
            return this.parseLevel5(buffer, fileSize);
        }

        return this.parseLevel4(buffer, fileSize);
    }

    private static parseHdf5Mat(filePath: string, fileSize: string): AutomotiveViewerModel {
        return this.decorateHdf5Model(Hdf5Parser.parseFile(filePath, fileSize));
    }

    private static decorateHdf5Model(model: AutomotiveViewerModel): AutomotiveViewerModel {
        const warnings = [
            ...model.warnings,
            'MAT v7.3 files are HDF5 containers. Variables are shown from HDF5 metadata; large dataset payloads are not loaded.'
        ];
        return {
            ...model,
            format: 'MAT v7.3',
            title: 'MATLAB MAT-file (HDF5)',
            summary: [
                { label: 'MAT version', value: '7.3' },
                ...model.summary.filter(item => item.label !== 'Format')
            ],
            warnings
        };
    }

    private static parseLevel5(buffer: Buffer, fileSize: string): AutomotiveViewerModel {
        const endian = buffer.subarray(126, 128).toString('ascii') === 'IM' ? 'LE' : 'BE';
        const headerText = cleanText(buffer.subarray(0, 116).toString('latin1'));
        const version = readUInt16(buffer, 124, endian);
        const variables: MatVariable[] = [];
        const warnings: string[] = [];
        let offset = MAT_V5_HEADER_BYTES;
        let skipped = 0;

        while (offset + 8 <= buffer.length && variables.length < MAX_VARIABLES) {
            const element = readElement(buffer, offset, endian);
            if (!element || element.size < 0 || element.nextOffset <= offset) {
                warnings.push(`Stopped at byte ${offset}: invalid data element tag.`);
                break;
            }

            if (element.type === MI_MATRIX) {
                try {
                    variables.push(this.parseMatrix(buffer, element, endian, ''));
                } catch (error) {
                    warnings.push(`Unable to decode matrix at byte ${offset}: ${error instanceof Error ? error.message : 'unknown error'}.`);
                }
            } else if (element.type !== 0 || element.size !== 0) {
                skipped++;
            }

            offset = element.nextOffset;
        }

        if (variables.length >= MAX_VARIABLES && offset < buffer.length) {
            warnings.push(`Variable table is limited to the first ${MAX_VARIABLES} entries.`);
        }
        if (skipped > 0) {
            warnings.push(`${skipped} non-matrix top-level data element(s) were skipped.`);
        }

        return {
            format: 'MAT v5/v6/v7',
            title: 'MATLAB MAT-file',
            fileSize,
            summary: [
                { label: 'MAT version', value: this.versionLabel(headerText) },
                { label: 'Header version', value: version },
                { label: 'Endian', value: endian === 'LE' ? 'little' : 'big' },
                { label: 'Variables', value: variables.length }
            ],
            tables: [
                {
                    title: `Variables (${variables.length})`,
                    headers: ['Name', 'Class', 'Size', 'Storage', 'Bytes', 'Attributes', 'Preview'],
                    rows: variables.map(variable => [
                        variable.name || '<unnamed>',
                        variable.className,
                        formatDimensions(variable.dimensions),
                        variable.dataType,
                        variable.bytes,
                        variable.attributes.join(', ') || '-',
                        variable.preview || '-'
                    ])
                },
                this.headerPreviewTable(buffer)
            ],
            rawPreview: headerText,
            warnings
        };
    }

    private static parseMatrix(buffer: Buffer, element: DataElement, endian: Endian, fallbackName: string): MatVariable {
        let cursor = element.dataOffset;
        const end = Math.min(element.dataOffset + element.size, buffer.length);
        const flags = nextElement(buffer, cursor, endian, end);
        if (!flags) {
            throw new Error('missing array flags');
        }
        cursor = flags.nextOffset;
        const flagValue = flags.size >= 4 ? readUInt32(buffer, flags.dataOffset, endian) : 0;
        const classId = flagValue & 0xff;
        const attributes = matrixAttributes(flagValue);

        const dimensionsElement = nextElement(buffer, cursor, endian, end);
        if (!dimensionsElement) {
            throw new Error('missing dimensions');
        }
        cursor = dimensionsElement.nextOffset;
        const dimensions: number[] = [];
        for (let i = 0; i + 4 <= dimensionsElement.size; i += 4) {
            dimensions.push(readInt32(buffer, dimensionsElement.dataOffset + i, endian));
        }

        const nameElement = nextElement(buffer, cursor, endian, end);
        if (!nameElement) {
            throw new Error('missing variable name');
        }
        cursor = nameElement.nextOffset;
        const name = decodeElementText(buffer, nameElement, endian) || fallbackName;

        const dataElement = nextElement(buffer, cursor, endian, end);
        const preview = dataElement
            ? previewElement(buffer, dataElement, endian, classId, dimensions)
            : '';
        const dataType = dataElement ? MI_TYPES[dataElement.type] || `miTYPE${dataElement.type}` : '-';

        return {
            name,
            className: MX_CLASSES[classId] || `mxCLASS${classId}`,
            dimensions,
            dataType,
            bytes: element.size,
            preview,
            attributes
        };
    }

    private static parseLevel4(buffer: Buffer, fileSize: string): AutomotiveViewerModel {
        const variants: Array<{ endian: Endian; variables: MatVariable[]; warnings: string[]; score: number }> = ['LE', 'BE']
            .map(endian => {
                const result = this.tryParseLevel4(buffer, endian as Endian);
                return { ...result, endian: endian as Endian, score: scoreLevel4(result.variables, result.warnings) };
            });
        const best = variants.sort((a, b) => b.score - a.score)[0];
        const warnings = [...best.warnings];
        if (best.variables.length === 0) {
            warnings.push('No MAT v4 matrix records were decoded. The file may be corrupt or use an unsupported private extension.');
        }

        return {
            format: 'MAT v4',
            title: 'MATLAB Level 4 MAT-file',
            fileSize,
            summary: [
                { label: 'MAT version', value: '4' },
                { label: 'Endian', value: best.endian === 'LE' ? 'little' : 'big' },
                { label: 'Variables', value: best.variables.length }
            ],
            tables: [
                {
                    title: `Variables (${best.variables.length})`,
                    headers: ['Name', 'Class', 'Size', 'Storage', 'Bytes', 'Attributes', 'Preview'],
                    rows: best.variables.map(variable => [
                        variable.name || '<unnamed>',
                        variable.className,
                        formatDimensions(variable.dimensions),
                        variable.dataType,
                        variable.bytes,
                        variable.attributes.join(', ') || '-',
                        variable.preview || '-'
                    ])
                },
                this.headerPreviewTable(buffer)
            ],
            rawPreview: hexPreview(buffer),
            warnings
        };
    }

    private static tryParseLevel4(buffer: Buffer, endian: Endian): { variables: MatVariable[]; warnings: string[] } {
        const variables: MatVariable[] = [];
        const warnings: string[] = [];
        let offset = 0;

        while (offset + 20 <= buffer.length && variables.length < MAX_VARIABLES) {
            const type = readInt32(buffer, offset, endian);
            const rows = readInt32(buffer, offset + 4, endian);
            const cols = readInt32(buffer, offset + 8, endian);
            const imagf = readInt32(buffer, offset + 12, endian);
            const nameLength = readInt32(buffer, offset + 16, endian);

            if (rows < 0 || cols < 0 || nameLength <= 0 || nameLength > 4096 || imagf < 0 || imagf > 1) {
                if (offset === 0) {
                    warnings.push('Header values did not look like MAT v4 records.');
                }
                break;
            }

            const nameOffset = offset + 20;
            const dataOffset = nameOffset + nameLength;
            if (dataOffset > buffer.length) {
                warnings.push(`Stopped at byte ${offset}: variable name extends beyond the file.`);
                break;
            }

            const name = buffer.subarray(nameOffset, dataOffset).toString('latin1').replace(/\0+$/g, '');
            const numericType = type % 10;
            const bytesPerValue = level4BytesPerValue(numericType);
            const valueCount = rows * cols * (imagf ? 2 : 1);
            const dataBytes = valueCount * bytesPerValue;
            const nextOffset = dataOffset + dataBytes;
            if (!Number.isFinite(valueCount) || valueCount < 0 || nextOffset > buffer.length) {
                warnings.push(`Stopped at byte ${offset}: matrix payload extends beyond the file.`);
                break;
            }

            variables.push({
                name,
                className: level4ClassName(numericType),
                dimensions: [rows, cols],
                dataType: `MOPT ${type}`,
                bytes: 20 + nameLength + dataBytes,
                attributes: imagf ? ['complex'] : [],
                preview: previewLevel4(buffer, dataOffset, Math.min(rows * cols, MAX_PREVIEW_VALUES), numericType, endian)
            });
            offset = nextOffset;
        }

        return { variables, warnings };
    }

    private static isLevel5(buffer: Buffer): boolean {
        if (buffer.length < MAT_V5_HEADER_BYTES) {
            return false;
        }
        const header = buffer.subarray(0, 116).toString('latin1');
        const endian = buffer.subarray(126, 128).toString('ascii');
        return /^MATLAB\s+(?:5\.0|7\.)\s+MAT-file/i.test(header) || endian === 'IM' || endian === 'MI';
    }

    private static versionLabel(headerText: string): string {
        const match = headerText.match(/MATLAB\s+([0-9.]+)\s+MAT-file/i);
        if (!match) {
            return '5/6/7';
        }
        return match[1].startsWith('7') ? match[1].replace(/\.0$/, '') : match[1];
    }

    private static headerPreviewTable(buffer: Buffer): AutomotiveTable {
        const preview = buffer.subarray(0, Math.min(buffer.length, 256));
        return {
            title: 'Header preview',
            headers: ['Offset', 'Hex', 'ASCII'],
            rows: hexRows(preview)
        };
    }
}

function readElement(buffer: Buffer, offset: number, endian: Endian): DataElement | null {
    if (offset + 4 > buffer.length) {
        return null;
    }

    const raw = readUInt32(buffer, offset, endian);
    const smallType = raw & 0xffff;
    const smallSize = raw >>> 16;
    if (smallSize > 0 && offset + 8 <= buffer.length) {
        return {
            type: smallType,
            size: smallSize,
            dataOffset: offset + 4,
            nextOffset: offset + 8,
            small: true
        };
    }

    if (offset + 8 > buffer.length) {
        return null;
    }

    const type = raw;
    const size = readUInt32(buffer, offset + 4, endian);
    return {
        type,
        size,
        dataOffset: offset + 8,
        nextOffset: align8(offset + 8 + size),
        small: false
    };
}

function nextElement(buffer: Buffer, offset: number, endian: Endian, end: number): DataElement | null {
    const element = readElement(buffer, offset, endian);
    if (!element || element.dataOffset + element.size > buffer.length || element.dataOffset > end) {
        return null;
    }
    return element.nextOffset <= end + 8 ? element : null;
}

function previewElement(buffer: Buffer, element: DataElement, endian: Endian, classId: number, dimensions: number[]): string {
    if (classId === 4) {
        return quotePreview(decodeElementText(buffer, element, endian));
    }

    if (classId === 1 || classId === 2 || classId === 3) {
        return `${formatDimensions(dimensions)} ${MX_CLASSES[classId]}`;
    }

    if (classId === 5) {
        return 'sparse matrix';
    }

    const values = previewNumericValues(buffer, element, endian);
    return values.length > 0 ? values.join(', ') : `${element.size} bytes`;
}

function previewNumericValues(buffer: Buffer, element: DataElement, endian: Endian): string[] {
    const values: string[] = [];
    const end = Math.min(element.dataOffset + element.size, buffer.length);
    const width = bytesPerMiType(element.type);
    if (width <= 0) {
        return values;
    }

    for (let offset = element.dataOffset; offset + width <= end && values.length < MAX_PREVIEW_VALUES; offset += width) {
        values.push(readNumeric(buffer, offset, element.type, endian));
    }
    if ((end - element.dataOffset) / width > values.length) {
        values.push('...');
    }
    return values;
}

function decodeElementText(buffer: Buffer, element: DataElement, endian: Endian): string {
    const bytes = buffer.subarray(element.dataOffset, Math.min(element.dataOffset + element.size, buffer.length));
    if (element.type === MI_UTF16 || element.type === MI_UINT16) {
        if (endian === 'LE') {
            return cleanText(bytes.toString('utf16le'));
        }
        const swapped = Buffer.from(bytes);
        swapped.swap16();
        return cleanText(swapped.toString('utf16le'));
    }
    if (element.type === MI_UTF32) {
        const chars: string[] = [];
        for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
            const codePoint = readUInt32(bytes, offset, endian);
            if (codePoint > 0) {
                chars.push(String.fromCodePoint(codePoint));
            }
        }
        return cleanText(chars.join(''));
    }
    return cleanText(bytes.toString(element.type === MI_UTF8 ? 'utf8' : 'latin1'));
}

function matrixAttributes(flags: number): string[] {
    const attributes: string[] = [];
    if (flags & 0x0800) {
        attributes.push('complex');
    }
    if (flags & 0x0400) {
        attributes.push('global');
    }
    if (flags & 0x0200) {
        attributes.push('logical');
    }
    return attributes;
}

function level4BytesPerValue(type: number): number {
    switch (type) {
    case 0:
        return 8;
    case 1:
        return 4;
    case 2:
        return 4;
    case 3:
        return 2;
    case 4:
        return 2;
    case 5:
        return 1;
    default:
        return 8;
    }
}

function level4ClassName(type: number): string {
    switch (type) {
    case 0:
        return 'double';
    case 1:
        return 'single';
    case 2:
        return 'int32';
    case 3:
        return 'int16';
    case 4:
        return 'uint16';
    case 5:
        return 'uint8';
    default:
        return `type ${type}`;
    }
}

function previewLevel4(buffer: Buffer, offset: number, count: number, type: number, endian: Endian): string {
    const values: string[] = [];
    const width = level4BytesPerValue(type);
    for (let i = 0; i < count && offset + width <= buffer.length; i++) {
        values.push(readLevel4Numeric(buffer, offset + i * width, type, endian));
    }
    if (count >= MAX_PREVIEW_VALUES) {
        values.push('...');
    }
    return values.join(', ');
}

function readLevel4Numeric(buffer: Buffer, offset: number, type: number, endian: Endian): string {
    switch (type) {
    case 0:
        return formatNumber(endian === 'LE' ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset));
    case 1:
        return formatNumber(endian === 'LE' ? buffer.readFloatLE(offset) : buffer.readFloatBE(offset));
    case 2:
        return String(readInt32(buffer, offset, endian));
    case 3:
        return String(endian === 'LE' ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset));
    case 4:
        return String(readUInt16(buffer, offset, endian));
    case 5:
        return String(buffer.readUInt8(offset));
    default:
        return '?';
    }
}

function readNumeric(buffer: Buffer, offset: number, type: number, endian: Endian): string {
    switch (type) {
    case MI_INT8:
        return String(buffer.readInt8(offset));
    case MI_UINT8:
        return String(buffer.readUInt8(offset));
    case MI_INT16:
        return String(endian === 'LE' ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset));
    case MI_UINT16:
        return String(readUInt16(buffer, offset, endian));
    case MI_INT32:
        return String(readInt32(buffer, offset, endian));
    case MI_UINT32:
        return String(readUInt32(buffer, offset, endian));
    case MI_SINGLE:
        return formatNumber(endian === 'LE' ? buffer.readFloatLE(offset) : buffer.readFloatBE(offset));
    case MI_DOUBLE:
        return formatNumber(endian === 'LE' ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset));
    case MI_INT64:
        return String(endian === 'LE' ? buffer.readBigInt64LE(offset) : buffer.readBigInt64BE(offset));
    case MI_UINT64:
        return String(endian === 'LE' ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset));
    default:
        return '?';
    }
}

function bytesPerMiType(type: number): number {
    switch (type) {
    case MI_INT8:
    case MI_UINT8:
    case MI_UTF8:
        return 1;
    case MI_INT16:
    case MI_UINT16:
    case MI_UTF16:
        return 2;
    case MI_INT32:
    case MI_UINT32:
    case MI_SINGLE:
    case MI_UTF32:
        return 4;
    case MI_DOUBLE:
    case MI_INT64:
    case MI_UINT64:
        return 8;
    default:
        return 0;
    }
}

function readUInt16(buffer: Buffer, offset: number, endian: Endian): number {
    return endian === 'LE' ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readInt32(buffer: Buffer, offset: number, endian: Endian): number {
    return endian === 'LE' ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset);
}

function readUInt32(buffer: Buffer, offset: number, endian: Endian): number {
    return endian === 'LE' ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function align8(value: number): number {
    return (value + 7) & ~7;
}

function formatDimensions(dimensions: number[]): string {
    return dimensions.length > 0 ? dimensions.join(' × ') : 'scalar';
}

function formatNumber(value: number): string {
    return Number.isFinite(value) ? Number(value.toPrecision(8)).toString() : String(value);
}

function quotePreview(value: string): string {
    if (!value) {
        return '';
    }
    const singleLine = value.replace(/\s+/g, ' ').trim();
    return singleLine.length > 120 ? `"${singleLine.slice(0, 120)}..."` : `"${singleLine}"`;
}

function cleanText(value: string): string {
    return value.replace(/\0+$/g, '').trim();
}

function scoreLevel4(variables: MatVariable[], warnings: string[]): number {
    return variables.length * 100 - warnings.length * 10;
}

function matchesBytes(buffer: Buffer, signature: number[]): boolean {
    return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
}

function hexPreview(buffer: Buffer): string {
    return hexRows(buffer.subarray(0, Math.min(buffer.length, 256)))
        .map(row => `${row[0]}  ${row[1]}  ${row[2]}`)
        .join('\n');
}

function hexRows(buffer: Buffer): Array<Array<string>> {
    const rows: Array<Array<string>> = [];
    for (let offset = 0; offset < buffer.length; offset += 16) {
        const slice = buffer.subarray(offset, Math.min(offset + 16, buffer.length));
        const hex = Array.from(slice).map(byte => byte.toString(16).padStart(2, '0')).join(' ');
        const ascii = Array.from(slice).map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('');
        rows.push([`0x${offset.toString(16).padStart(4, '0')}`, hex, ascii]);
    }
    return rows;
}
