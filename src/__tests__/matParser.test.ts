import { MatParser } from '../utils/matParser';

const MI_INT8 = 1;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_DOUBLE = 9;
const MI_MATRIX = 14;
const MI_UTF8 = 16;

const MX_CHAR = 4;
const MX_DOUBLE = 6;

function pad8(buffer: Buffer): Buffer {
    const padding = (8 - (buffer.length % 8)) % 8;
    return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding)]);
}

function element(type: number, payload: Buffer): Buffer {
    if (payload.length <= 4) {
        const tag = Buffer.alloc(4);
        tag.writeUInt16LE(type, 0);
        tag.writeUInt16LE(payload.length, 2);
        return Buffer.concat([tag, payload, Buffer.alloc(4 - payload.length)]);
    }
    const tag = Buffer.alloc(8);
    tag.writeUInt32LE(type, 0);
    tag.writeUInt32LE(payload.length, 4);
    return Buffer.concat([tag, pad8(payload)]);
}

function matrix(name: string, classId: number, dimensions: number[], dataType: number, data: Buffer): Buffer {
    const flags = Buffer.alloc(8);
    flags.writeUInt32LE(classId, 0);
    const dims = Buffer.alloc(dimensions.length * 4);
    dimensions.forEach((dimension, index) => dims.writeInt32LE(dimension, index * 4));
    const payload = Buffer.concat([
        element(MI_UINT32, flags),
        element(MI_INT32, dims),
        element(MI_INT8, Buffer.from(name, 'ascii')),
        element(dataType, data)
    ]);
    return element(MI_MATRIX, payload);
}

function createLevel5Mat(): Buffer {
    const header = Buffer.alloc(128, 0x20);
    header.write('MATLAB 5.0 MAT-file, Platform: omni-viewer, Created for tests', 0, 'ascii');
    header.writeUInt16LE(0x0100, 124);
    header.write('IM', 126, 'ascii');

    const values = Buffer.alloc(3 * 8);
    [1.5, 2.5, 3.5].forEach((value, index) => values.writeDoubleLE(value, index * 8));
    const numeric = matrix('answer', MX_DOUBLE, [1, 3], MI_DOUBLE, values);
    const text = matrix('label', MX_CHAR, [1, 5], MI_UTF8, Buffer.from('hello', 'utf8'));
    return Buffer.concat([header, numeric, text]);
}

function createLevel4Mat(): Buffer {
    const name = Buffer.from('legacy\0', 'ascii');
    const values = Buffer.alloc(2 * 2 * 8);
    [10, 20, 30, 40].forEach((value, index) => values.writeDoubleLE(value, index * 8));
    const header = Buffer.alloc(20);
    header.writeInt32LE(0, 0);
    header.writeInt32LE(2, 4);
    header.writeInt32LE(2, 8);
    header.writeInt32LE(0, 12);
    header.writeInt32LE(name.length, 16);
    return Buffer.concat([header, name, values]);
}

describe('MatParser', () => {
    it('parses MATLAB v5/v6/v7 matrix variables', () => {
        const buffer = createLevel5Mat();
        const model = MatParser.parse(buffer, `${buffer.length} bytes`);

        expect(model.format).toBe('MAT v5/v6/v7');
        expect(model.summary).toContainEqual({ label: 'Variables', value: 2 });

        const variables = model.tables.find(table => table.title.startsWith('Variables'));
        expect(variables?.rows).toContainEqual(['answer', 'double', '1 × 3', 'miDOUBLE', expect.any(Number), '-', '1.5, 2.5, 3.5']);
        expect(variables?.rows).toContainEqual(['label', 'char', '1 × 5', 'miUTF8', expect.any(Number), '-', '"hello"']);
    });

    it('parses MATLAB level 4 matrix records', () => {
        const buffer = createLevel4Mat();
        const model = MatParser.parse(buffer, `${buffer.length} bytes`);

        expect(model.format).toBe('MAT v4');
        expect(model.summary).toContainEqual({ label: 'Variables', value: 1 });

        const variables = model.tables.find(table => table.title.startsWith('Variables'));
        expect(variables?.rows[0]).toEqual(['legacy', 'double', '2 × 2', 'MOPT 0', buffer.length, '-', '10, 20, 30, 40']);
    });

    it('labels HDF5-backed files as MAT v7.3', () => {
        const buffer = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
        const model = MatParser.parse(buffer, `${buffer.length} bytes`);

        expect(model.format).toBe('MAT v7.3');
        expect(model.title).toBe('MATLAB MAT-file (HDF5)');
        expect(model.warnings.join(' ')).toContain('MAT v7.3 files are HDF5 containers');
    });
});
