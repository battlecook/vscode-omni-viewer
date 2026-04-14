import * as path from 'path';

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_START_NAMESPACE_TYPE = 0x0100;
const RES_XML_END_NAMESPACE_TYPE = 0x0101;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const NO_INDEX = 0xFFFFFFFF;

interface DecodedArchivePreview {
    content: string;
    description: string;
}

interface BinaryXmlAttribute {
    namespaceUri: string | null;
    name: string;
    value: string;
}

interface BinaryXmlElement {
    namespaceUri: string | null;
    name: string;
    attributes: BinaryXmlAttribute[];
}

interface StringPool {
    strings: string[];
}

interface ChunkHeader {
    type: number;
    headerSize: number;
    size: number;
}

export function tryDecodeArchiveEntryPreview(entryPath: string, buffer: Buffer): DecodedArchivePreview | null {
    const decodedBinaryXml = decodeAndroidBinaryXml(entryPath, buffer);
    if (decodedBinaryXml) {
        return decodedBinaryXml;
    }

    return null;
}

function decodeAndroidBinaryXml(entryPath: string, buffer: Buffer): DecodedArchivePreview | null {
    if (!looksLikeAndroidBinaryXml(entryPath, buffer)) {
        return null;
    }

    const stringPool = parseAndroidStringPool(buffer);
    if (!stringPool) {
        return null;
    }

    const namespaceStack = new Map<string, string[]>();
    const prefixByUri = new Map<string, string>();
    const pendingNamespaceDecls = new Map<string, string>();
    const elementStack: BinaryXmlElement[] = [];
    const lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];
    let offset = readChunkHeader(buffer, 0)?.headerSize ?? 8;

    while (offset + 8 <= buffer.length) {
        const chunk = readChunkHeader(buffer, offset);
        if (!chunk || chunk.size <= 0 || offset + chunk.size > buffer.length) {
            return null;
        }

        switch (chunk.type) {
        case RES_XML_START_NAMESPACE_TYPE:
            parseNamespaceChunk(buffer, offset, stringPool, namespaceStack, prefixByUri, pendingNamespaceDecls, true);
            break;
        case RES_XML_END_NAMESPACE_TYPE:
            parseNamespaceChunk(buffer, offset, stringPool, namespaceStack, prefixByUri, pendingNamespaceDecls, false);
            break;
        case RES_XML_START_ELEMENT_TYPE: {
            const element = parseStartElementChunk(buffer, offset, chunk, stringPool);
            if (!element) {
                return null;
            }

            const indent = '  '.repeat(elementStack.length);
            const qualifiedName = qualifyName(element.namespaceUri, element.name, prefixByUri);
            const attrText = element.attributes
                .map((attribute) => `${qualifyName(attribute.namespaceUri, attribute.name, prefixByUri)}="${escapeXml(attribute.value)}"`)
                .join(' ');

            const namespaceDecls = Array.from(pendingNamespaceDecls.entries())
                .map(([uri, prefix]) => {
                    const escapedUri = escapeXml(uri);
                    return prefix.length > 0
                        ? `xmlns:${prefix}="${escapedUri}"`
                        : `xmlns="${escapedUri}"`;
                })
                .join(' ');
            pendingNamespaceDecls.clear();

            const parts = [qualifiedName];
            if (namespaceDecls) {
                parts.push(namespaceDecls);
            }
            if (attrText) {
                parts.push(attrText);
            }
            lines.push(`${indent}<${parts.join(' ')}>`);
            elementStack.push(element);
            break;
        }
        case RES_XML_END_ELEMENT_TYPE: {
            const element = parseEndElementChunk(buffer, offset, stringPool);
            if (!element) {
                return null;
            }

            const current = elementStack.pop();
            const depth = Math.max(elementStack.length, 0);
            const indent = '  '.repeat(depth);
            const qualifiedName = qualifyName(element.namespaceUri, element.name, prefixByUri);
            if (current && (current.name !== element.name || current.namespaceUri !== element.namespaceUri)) {
                return null;
            }
            lines.push(`${indent}</${qualifiedName}>`);
            break;
        }
        default:
            break;
        }

        offset += chunk.size;
    }

    if (lines.length === 1) {
        return null;
    }

    return {
        content: lines.join('\n'),
        description: `Decoded from Android binary XML (${path.extname(entryPath) || 'entry'}).`
    };
}

function looksLikeAndroidBinaryXml(entryPath: string, buffer: Buffer): boolean {
    if (!entryPath.toLowerCase().endsWith('.xml')) {
        return false;
    }

    const xmlChunk = readChunkHeader(buffer, 0);
    if (!xmlChunk) {
        return false;
    }

    if (xmlChunk.type !== RES_XML_TYPE || xmlChunk.headerSize < 8 || xmlChunk.size > buffer.length) {
        return false;
    }

    const nextChunk = readChunkHeader(buffer, xmlChunk.headerSize);
    return nextChunk?.type === RES_STRING_POOL_TYPE;
}

function parseAndroidStringPool(buffer: Buffer): StringPool | null {
    const header = readChunkHeader(buffer, 8);
    if (!header || header.type !== RES_STRING_POOL_TYPE || header.headerSize < 28 || header.size > buffer.length) {
        return null;
    }

    const chunkStart = 8;
    const stringCount = buffer.readUInt32LE(chunkStart + 8);
    const flags = buffer.readUInt32LE(chunkStart + 16);
    const stringsStart = buffer.readUInt32LE(chunkStart + 20);
    const isUtf8 = (flags & 0x00000100) !== 0;
    const offsetsStart = chunkStart + header.headerSize;
    const stringsBase = chunkStart + stringsStart;
    const strings: string[] = [];

    for (let index = 0; index < stringCount; index += 1) {
        const offsetPosition = offsetsStart + (index * 4);
        if (offsetPosition + 4 > chunkStart + header.size) {
            return null;
        }

        const stringOffset = buffer.readUInt32LE(offsetPosition);
        const absoluteOffset = stringsBase + stringOffset;
        if (absoluteOffset >= chunkStart + header.size) {
            return null;
        }

        strings.push(isUtf8 ? readUtf8String(buffer, absoluteOffset) : readUtf16String(buffer, absoluteOffset));
    }

    return { strings };
}

function readUtf8String(buffer: Buffer, offset: number): string {
    const [, charLengthBytes] = readLength8(buffer, offset);
    const [byteLength, byteLengthBytes] = readLength8(buffer, offset + charLengthBytes);
    const start = offset + charLengthBytes + byteLengthBytes;
    return buffer.toString('utf8', start, start + byteLength);
}

function readUtf16String(buffer: Buffer, offset: number): string {
    const [charLength, lengthBytes] = readLength16(buffer, offset);
    const start = offset + lengthBytes;
    const byteLength = charLength * 2;
    return buffer.toString('utf16le', start, start + byteLength);
}

function readLength8(buffer: Buffer, offset: number): [number, number] {
    const first = buffer[offset];
    if ((first & 0x80) === 0) {
        return [first, 1];
    }

    return [((first & 0x7F) << 8) | buffer[offset + 1], 2];
}

function readLength16(buffer: Buffer, offset: number): [number, number] {
    const first = buffer.readUInt16LE(offset);
    if ((first & 0x8000) === 0) {
        return [first, 2];
    }

    const second = buffer.readUInt16LE(offset + 2);
    return [((first & 0x7FFF) << 16) | second, 4];
}

function parseNamespaceChunk(
    buffer: Buffer,
    chunkOffset: number,
    stringPool: StringPool,
    namespaceStack: Map<string, string[]>,
    prefixByUri: Map<string, string>,
    pendingNamespaceDecls: Map<string, string>,
    isStart: boolean
): void {
    const prefixIndex = buffer.readUInt32LE(chunkOffset + 16);
    const uriIndex = buffer.readUInt32LE(chunkOffset + 20);
    const prefix = getStringAt(stringPool, prefixIndex) ?? '';
    const uri = getStringAt(stringPool, uriIndex);
    if (!uri) {
        return;
    }

    if (isStart) {
        const prefixes = namespaceStack.get(uri) ?? [];
        prefixes.push(prefix);
        namespaceStack.set(uri, prefixes);
        prefixByUri.set(uri, prefix);
        pendingNamespaceDecls.set(uri, prefix);
        return;
    }

    const prefixes = namespaceStack.get(uri);
    if (!prefixes || prefixes.length === 0) {
        prefixByUri.delete(uri);
        pendingNamespaceDecls.delete(uri);
        return;
    }

    prefixes.pop();
    if (prefixes.length === 0) {
        namespaceStack.delete(uri);
        prefixByUri.delete(uri);
    } else {
        prefixByUri.set(uri, prefixes[prefixes.length - 1]);
    }
}

function parseStartElementChunk(
    buffer: Buffer,
    chunkOffset: number,
    header: ChunkHeader,
    stringPool: StringPool
): BinaryXmlElement | null {
    if (header.headerSize < 16) {
        return null;
    }

    const namespaceUri = getStringAt(stringPool, buffer.readUInt32LE(chunkOffset + 16));
    const name = getStringAt(stringPool, buffer.readUInt32LE(chunkOffset + 20));
    if (!name) {
        return null;
    }

    const attributeStart = buffer.readUInt16LE(chunkOffset + 24);
    const attributeSize = buffer.readUInt16LE(chunkOffset + 26);
    const attributeCount = buffer.readUInt16LE(chunkOffset + 28);
    if (attributeSize < 20) {
        return null;
    }

    const attributes: BinaryXmlAttribute[] = [];
    let attributeOffset = chunkOffset + 16 + attributeStart;

    for (let index = 0; index < attributeCount; index += 1) {
        if (attributeOffset + attributeSize > chunkOffset + header.size) {
            return null;
        }

        const attributeNamespaceUri = getStringAt(stringPool, buffer.readUInt32LE(attributeOffset));
        const attributeName = getStringAt(stringPool, buffer.readUInt32LE(attributeOffset + 4));
        if (!attributeName) {
            return null;
        }

        const rawValueIndex = buffer.readUInt32LE(attributeOffset + 8);
        const dataType = buffer[attributeOffset + 15];
        const data = buffer.readUInt32LE(attributeOffset + 16);
        const rawValue = getStringAt(stringPool, rawValueIndex);
        attributes.push({
            namespaceUri: attributeNamespaceUri,
            name: attributeName,
            value: formatTypedValue(dataType, data, rawValue, stringPool)
        });

        attributeOffset += attributeSize;
    }

    return {
        namespaceUri,
        name,
        attributes
    };
}

function parseEndElementChunk(buffer: Buffer, chunkOffset: number, stringPool: StringPool): BinaryXmlElement | null {
    const namespaceUri = getStringAt(stringPool, buffer.readUInt32LE(chunkOffset + 16));
    const name = getStringAt(stringPool, buffer.readUInt32LE(chunkOffset + 20));
    if (!name) {
        return null;
    }

    return {
        namespaceUri,
        name,
        attributes: []
    };
}

function formatTypedValue(dataType: number, data: number, rawValue: string | null, stringPool: StringPool): string {
    if (rawValue) {
        return rawValue;
    }

    switch (dataType) {
    case 0x00:
        return '';
    case 0x01:
        return `@0x${data.toString(16).padStart(8, '0')}`;
    case 0x02:
        return `?0x${data.toString(16).padStart(8, '0')}`;
    case 0x03:
        return getStringAt(stringPool, data) ?? '';
    case 0x04:
        return String(bufferToFloat(data));
    case 0x05:
        return formatComplexUnit(data, ['px', 'dp', 'sp', 'pt', 'in', 'mm']);
    case 0x06:
        return formatComplexUnit(data, ['%', '%p']);
    case 0x10:
        return String(data | 0);
    case 0x11:
        return `0x${data.toString(16)}`;
    case 0x12:
        return data !== 0 ? 'true' : 'false';
    case 0x1C:
    case 0x1D:
    case 0x1E:
    case 0x1F:
        return `#${data.toString(16).padStart(8, '0')}`;
    default:
        return `0x${data.toString(16)}`;
    }
}

function bufferToFloat(data: number): number {
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeUInt32LE(data, 0);
    return buffer.readFloatLE(0);
}

function formatComplexUnit(data: number, units: string[]): string {
    const mantissa = (data & 0xFFFFFF00) >> 8;
    const radix = (data >> 4) & 0x03;
    const unit = data & 0x0F;
    const multipliers = [1 / (1 << 23), 1 / (1 << 15), 1 / (1 << 7), 1];
    const value = mantissa * (multipliers[radix] ?? 1);
    return `${value}${units[unit] ?? ''}`;
}

function qualifyName(namespaceUri: string | null, name: string, prefixByUri: Map<string, string>): string {
    if (!namespaceUri) {
        return name;
    }

    const prefix = prefixByUri.get(namespaceUri);
    return prefix ? `${prefix}:${name}` : name;
}

function getStringAt(stringPool: StringPool, index: number): string | null {
    if (index === NO_INDEX) {
        return null;
    }

    return stringPool.strings[index] ?? null;
}

function readChunkHeader(buffer: Buffer, offset: number): ChunkHeader | null {
    if (offset + 8 > buffer.length) {
        return null;
    }

    return {
        type: buffer.readUInt16LE(offset),
        headerSize: buffer.readUInt16LE(offset + 2),
        size: buffer.readUInt32LE(offset + 4)
    };
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&apos;');
}
