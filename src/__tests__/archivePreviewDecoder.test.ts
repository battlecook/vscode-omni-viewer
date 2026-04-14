import { tryDecodeArchiveEntryPreview } from '../utils/fileUtils/archivePreviewDecoder';

describe('archive preview decoder', () => {
    it('falls back for plain text files', () => {
        const result = tryDecodeArchiveEntryPreview('notes.txt', Buffer.from('hello', 'utf8'));

        expect(result).toBeNull();
    });

    it('decodes Android binary XML into readable text', () => {
        const result = tryDecodeArchiveEntryPreview('AndroidManifest.xml', createBinaryXmlFixture());

        expect(result).not.toBeNull();
        expect(result?.description).toContain('Android binary XML');
        expect(result?.content).toContain('<manifest');
        expect(result?.content).toContain('package="com.example.app"');
        expect(result?.content).toContain('</manifest>');
    });
});

function createBinaryXmlFixture(): Buffer {
    const manifestName = encodeUtf8PoolString('manifest');
    const packageName = encodeUtf8PoolString('package');
    const packageValue = encodeUtf8PoolString('com.example.app');
    const stringData = alignTo4(Buffer.concat([manifestName, packageName, packageValue]));
    const stringOffsets = Buffer.alloc(12);
    stringOffsets.writeUInt32LE(0, 0);
    stringOffsets.writeUInt32LE(manifestName.length, 4);
    stringOffsets.writeUInt32LE(manifestName.length + packageName.length, 8);

    const stringPoolChunkSize = 28 + stringOffsets.length + stringData.length;
    const stringPoolChunk = Buffer.concat([
        createChunkHeader(0x0001, 28, stringPoolChunkSize),
        writeU32(3),
        writeU32(0),
        writeU32(0x00000100),
        writeU32(28 + stringOffsets.length),
        writeU32(0),
        stringOffsets,
        stringData
    ]);

    const startElementChunk = Buffer.concat([
        createChunkHeader(0x0102, 36, 56),
        writeU32(1),
        writeU32(0xFFFFFFFF),
        writeU32(0xFFFFFFFF),
        writeU32(0),
        writeU16(20),
        writeU16(20),
        writeU16(1),
        writeU16(0),
        writeU16(0),
        writeU16(0),
        writeU32(0xFFFFFFFF),
        writeU32(1),
        writeU32(2),
        writeU16(8),
        Buffer.from([0x00, 0x03]),
        writeU32(2)
    ]);

    const endElementChunk = Buffer.concat([
        createChunkHeader(0x0103, 24, 24),
        writeU32(1),
        writeU32(0xFFFFFFFF),
        writeU32(0xFFFFFFFF),
        writeU32(0)
    ]);

    const body = Buffer.concat([stringPoolChunk, startElementChunk, endElementChunk]);
    const xmlHeader = createChunkHeader(0x0003, 8, 8 + body.length);
    return Buffer.concat([xmlHeader, body]);
}

function createChunkHeader(type: number, headerSize: number, size: number): Buffer {
    return Buffer.concat([writeU16(type), writeU16(headerSize), writeU32(size)]);
}

function encodeUtf8PoolString(value: string): Buffer {
    const utf8 = Buffer.from(value, 'utf8');
    return Buffer.concat([Buffer.from([value.length, utf8.length]), utf8, Buffer.from([0x00])]);
}

function alignTo4(buffer: Buffer): Buffer {
    const remainder = buffer.length % 4;
    if (remainder === 0) {
        return buffer;
    }

    return Buffer.concat([buffer, Buffer.alloc(4 - remainder)]);
}

function writeU16(value: number): Buffer {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16LE(value, 0);
    return buffer;
}

function writeU32(value: number): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value >>> 0, 0);
    return buffer;
}
