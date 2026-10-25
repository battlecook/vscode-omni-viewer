import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('music-metadata', () => ({}), { virtual: true });
const mockParquetMetadataAsync = jest.fn();
const mockParquetReadObjects = jest.fn();
const mockParquetSchema = jest.fn();
const mockAsyncBufferFromFile = jest.fn();
const mockCompressors = {
    ZSTD: jest.fn()
};
jest.mock('hyparquet', () => ({
    asyncBufferFromFile: mockAsyncBufferFromFile,
    parquetMetadataAsync: mockParquetMetadataAsync,
    parquetReadObjects: mockParquetReadObjects,
    parquetSchema: mockParquetSchema
}), { virtual: true });
jest.mock('hyparquet-compressors', () => ({
    compressors: mockCompressors
}), { virtual: true });
jest.mock('hwp.js', () => ({}), { virtual: true });
jest.mock('xlsx', () => ({}), { virtual: true });
const mockZipLoadAsync = jest.fn();
jest.mock('jszip', () => ({
    loadAsync: mockZipLoadAsync
}), { virtual: true });

import { FileUtils } from '../utils/fileUtils';
import { MAX_KERAS_READ_BYTES } from '../utils/kerasLimits';
import { MAX_COREML_READ_BYTES } from '../utils/coremlLimits';
import { MAX_HAR_READ_BYTES } from '../utils/harLimits';
import { MAX_NUMPY_READ_BYTES } from '../utils/numpyLimits';
import { MAX_PT2_READ_BYTES } from '../utils/pt2Limits';
import { MAX_EPUB_READ_BYTES } from '../utils/epubLimits';
import { MAX_XML_READ_BYTES } from '../utils/xmlLimits';

/** A ZIP local file header for OCF's stored `mimetype` first member. */
function epubHeader(mimetype = 'application/epub+zip'): Buffer {
    const header = Buffer.alloc(30);
    header.write('PK\x03\x04', 0, 'latin1');
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE('mimetype'.length, 26);
    header.writeUInt16LE(0, 28);
    return Buffer.concat([header, Buffer.from('mimetype' + mimetype, 'latin1'), Buffer.alloc(64)]);
}

function hdf5Header(): Buffer {
    const header = Buffer.alloc(512);
    Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
    return header;
}

/** The root attribute names `save_model_to_hdf5` writes next to each other. */
function kerasHdf5Header(): Buffer {
    const header = hdf5Header();
    header.write('model_config', 64, 'latin1');
    header.write('keras_version', 96, 'latin1');
    header.write('backend', 128, 'latin1');
    return header;
}

describe('FileUtils delimited formats', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-viewer-'));
        mockAsyncBufferFromFile.mockReset();
        mockParquetMetadataAsync.mockReset();
        mockParquetReadObjects.mockReset();
        mockParquetSchema.mockReset();
        mockZipLoadAsync.mockReset();
        mockZipLoadAsync.mockResolvedValue({ files: {} });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('parses TSV files with tab delimiters', async () => {
        const filePath = path.join(tempDir, 'sample.tsv');
        fs.writeFileSync(filePath, 'name\trole\nAlice\tEngineer\nBob\tProduct\n', 'utf8');

        const result = await FileUtils.readCsvFile(filePath);

        expect(result.delimiter).toBe('\t');
        expect(result.headers).toEqual(['name', 'role']);
        expect(result.rows).toEqual([
            ['Alice', 'Engineer'],
            ['Bob', 'Product']
        ]);
    });

    it('keeps quoted tab content inside a single TSV cell', async () => {
        const filePath = path.join(tempDir, 'quoted.tsv');
        fs.writeFileSync(filePath, 'title\tnote\nReport\t"Line A\tLine B"\n', 'utf8');

        const result = await FileUtils.readCsvFile(filePath);

        expect(result.rows).toEqual([['Report', 'Line A\tLine B']]);
    });

    it('preserves quotes that appear inside an unquoted TSV cell', async () => {
        const filePath = path.join(tempDir, 'literal-quote.tsv');
        fs.writeFileSync(filePath, 'name\tsize\textra\npipe\t4"\tkept\nitem\t"leading\tkept\n', 'utf8');

        const result = await FileUtils.readCsvFile(filePath);

        expect(result.delimiter).toBe('\t');
        expect(result.rows).toEqual([
            ['pipe', '4"', 'kept'],
            ['item', '"leading', 'kept']
        ]);
    });

    it('preserves escaped quotes inside a quoted TSV cell', async () => {
        const filePath = path.join(tempDir, 'escaped-quote.tsv');
        fs.writeFileSync(filePath, 'name\tnote\nitem\t"""quoted"""\n', 'utf8');

        const result = await FileUtils.readCsvFile(filePath);

        expect(result.rows).toEqual([['item', '"quoted"']]);
    });

    it('continues delimiter detection after an unmatched opening quote', () => {
        const filePath = path.join(tempDir, 'unmatched-quote.txt');
        const lines = ['a,b,"c,d', '1,2,3,4'];

        expect(FileUtils.getDelimitedFileDelimiter(filePath, lines)).toBe(',');
    });

    it('parses quoted CSV fields after a BOM or field padding', async () => {
        const filePath = path.join(tempDir, 'padded-quotes.csv');
        fs.writeFileSync(
            filePath,
            '\uFEFF"name,part",note,status\nitem, "a,b",kept\n',
            'utf8'
        );

        const result = await FileUtils.readCsvFile(filePath);

        expect(result.headers).toEqual(['name,part', 'note', 'status']);
        expect(result.rows).toEqual([['item', 'a,b', 'kept']]);
    });

    it('detects semicolon-delimited CSV files', async () => {
        const filePath = path.join(tempDir, 'email.csv');
        fs.writeFileSync(
            filePath,
            'Login email;Identifier;First name;Last name\nlaura@example.com;2070;Laura;Grey\ncraig@example.com;4081;Craig;Johnson\n',
            'utf8'
        );

        const result = await FileUtils.readCsvFile(filePath);

        expect(result.delimiter).toBe(';');
        expect(result.headers).toEqual(['Login email', 'Identifier', 'First name', 'Last name']);
        expect(result.rows).toEqual([
            ['laura@example.com', '2070', 'Laura', 'Grey'],
            ['craig@example.com', '4081', 'Craig', 'Johnson']
        ]);
    });

    it('ignores quoted commas when detecting a semicolon delimiter', async () => {
        const filePath = path.join(tempDir, 'quoted-names.csv');
        fs.writeFileSync(
            filePath,
            'id;"last, first"\n1;"Doe, John"\n',
            'utf8'
        );

        const result = await FileUtils.readCsvFile(filePath);

        expect(result.delimiter).toBe(';');
        expect(result.headers).toEqual(['id', 'last, first']);
        expect(result.rows).toEqual([['1', 'Doe, John']]);
    });

    it('reads large parquet files through asyncBufferFromFile and limits the first chunk', async () => {
        const filePath = path.join(tempDir, 'sample.parquet');
        fs.writeFileSync(filePath, '');
        fs.truncateSync(filePath, 60 * 1024 * 1024);

        const asyncBuffer = { byteLength: 60 * 1024 * 1024, slice: jest.fn() };
        mockAsyncBufferFromFile.mockResolvedValue(asyncBuffer);
        mockParquetMetadataAsync.mockResolvedValue({ num_rows: 25000 });
        mockParquetSchema.mockReturnValue({
            children: [
                { element: { name: 'id' }, path: ['id'] },
                { element: { name: 'name' }, path: ['name'] }
            ]
        });
        mockParquetReadObjects.mockResolvedValue([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' }
        ]);

        const result = await FileUtils.readParquetFile(filePath);

        expect(mockAsyncBufferFromFile).toHaveBeenCalledWith(filePath);
        expect(mockParquetMetadataAsync).toHaveBeenCalledWith(asyncBuffer);
        expect(mockParquetReadObjects).toHaveBeenCalledWith(expect.objectContaining({
            file: asyncBuffer,
            compressors: mockCompressors,
            metadata: { num_rows: 25000 },
            rowStart: 0,
            rowEnd: 10000
        }));
        expect(result.isLimited).toBe(true);
        expect(result.hasMoreRows).toBe(true);
        expect(result.nextRowStart).toBe(2);
        expect(result.previewRowCount).toBe(10000);
        expect(result.actualTotalRows).toBe(25000);
        expect(result.headers).toEqual(['id', 'name']);
        expect(result.rows).toEqual([
            [1, 'Alice'],
            [2, 'Bob']
        ]);
    });

    it('reads additional parquet chunks from the requested row range', async () => {
        const filePath = path.join(tempDir, 'sample.parquet');
        fs.writeFileSync(filePath, '');
        fs.truncateSync(filePath, 60 * 1024 * 1024);

        const asyncBuffer = { byteLength: 60 * 1024 * 1024, slice: jest.fn() };
        mockAsyncBufferFromFile.mockResolvedValue(asyncBuffer);
        mockParquetMetadataAsync.mockResolvedValue({ num_rows: 25000 });
        mockParquetSchema.mockReturnValue({
            children: [
                { element: { name: 'id' }, path: ['id'] }
            ]
        });
        mockParquetReadObjects.mockResolvedValue([
            { id: 10001 },
            { id: 10002 }
        ]);

        const result = await FileUtils.readParquetFile(filePath, { rowStart: 10000, rowEnd: 20000 });

        expect(mockParquetReadObjects).toHaveBeenCalledWith(expect.objectContaining({
            file: asyncBuffer,
            compressors: mockCompressors,
            metadata: { num_rows: 25000 },
            rowStart: 10000,
            rowEnd: 20000
        }));
        expect(result.totalRows).toBe(2);
        expect(result.hasMoreRows).toBe(true);
        expect(result.nextRowStart).toBe(10002);
        expect(result.rows).toEqual([
            [10001],
            [10002]
        ]);
    });

    it('serializes parquet DATE columns as displayable date strings', async () => {
        const filePath = path.join(tempDir, 'dated.parquet');
        fs.writeFileSync(filePath, 'PAR1');

        const asyncBuffer = { byteLength: 4, slice: jest.fn() };
        mockAsyncBufferFromFile.mockResolvedValue(asyncBuffer);
        mockParquetMetadataAsync.mockResolvedValue({ num_rows: 1 });
        mockParquetSchema.mockReturnValue({
            children: [
                {
                    element: {
                        name: 'date',
                        converted_type: 'DATE',
                        logical_type: { type: 'DATE' }
                    },
                    path: ['date']
                },
                {
                    element: {
                        name: 'updated_at',
                        logical_type: { type: 'TIMESTAMP' }
                    },
                    path: ['updated_at']
                }
            ]
        });
        mockParquetReadObjects.mockResolvedValue([
            {
                date: new Date('2021-01-07T00:00:00.000Z'),
                updated_at: new Date('2021-01-07T12:34:56.000Z')
            }
        ]);

        const result = await FileUtils.readParquetFile(filePath);

        expect(result.headers).toEqual(['date', 'updated_at']);
        expect(result.rows).toEqual([
            ['2021-01-07', '2021-01-07T12:34:56.000Z']
        ]);
    });

    it('previews parquet files larger than the former maximum size instead of rejecting them', async () => {
        const filePath = path.join(tempDir, 'huge.parquet');
        fs.writeFileSync(filePath, '');
        fs.truncateSync(filePath, 200 * 1024 * 1024);

        const asyncBuffer = { byteLength: 200 * 1024 * 1024, slice: jest.fn() };
        mockAsyncBufferFromFile.mockResolvedValue(asyncBuffer);
        mockParquetMetadataAsync.mockResolvedValue({ num_rows: 50000 });
        mockParquetSchema.mockReturnValue({
            children: [
                { element: { name: 'id' }, path: ['id'] }
            ]
        });
        mockParquetReadObjects.mockResolvedValue([
            { id: 1 }
        ]);

        const result = await FileUtils.readParquetFile(filePath);

        expect(mockParquetReadObjects).toHaveBeenCalledWith(expect.objectContaining({
            file: asyncBuffer,
            compressors: mockCompressors,
            metadata: { num_rows: 50000 },
            rowStart: 0,
            rowEnd: 10000
        }));
        expect(result.isLimited).toBe(true);
        expect(result.hasMoreRows).toBe(true);
        expect(result.nextRowStart).toBe(1);
        expect(result.limitMessage).toContain('Large file (200.0MB)');
        expect(result.rows).toEqual([[1]]);
    });

    it('detects PDF files by signature even with the wrong extension', async () => {
        const filePath = path.join(tempDir, 'mislabeled.jpg');
        fs.writeFileSync(filePath, Buffer.from('%PDF-1.7\n'));

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.imageViewer');

        expect(result.viewType).toBe('omni-viewer.pdfViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects PNG files by signature', async () => {
        const filePath = path.join(tempDir, 'mislabeled.bin');
        fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.imageViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects Avro object containers by signature', async () => {
        const filePath = path.join(tempDir, 'mislabeled.bin');
        fs.writeFileSync(filePath, Buffer.from([0x4F, 0x62, 0x6A, 0x01]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.avroViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects ROS bag files by header', async () => {
        const filePath = path.join(tempDir, 'mislabeled.bin');
        fs.writeFileSync(filePath, '#ROSBAG V2.0\n', 'ascii');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.bagViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects SQLite DB3 files by header', async () => {
        const filePath = path.join(tempDir, 'mislabeled.bin');
        fs.writeFileSync(filePath, 'SQLite format 3\0', 'binary');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.db3Viewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects classic PCAP files by magic bytes', async () => {
        const filePath = path.join(tempDir, 'mislabeled.bin');
        fs.writeFileSync(filePath, Buffer.from([0xD4, 0xC3, 0xB2, 0xA1, 0x02, 0x00, 0x04, 0x00]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.pcapViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects PCAPNG files by section header block', async () => {
        const filePath = path.join(tempDir, 'mislabeled.bin');
        fs.writeFileSync(filePath, Buffer.from([0x0A, 0x0D, 0x0D, 0x0A, 0x1C, 0x00, 0x00, 0x00]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.pcapngViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects STEP files by extension', async () => {
        const filePath = path.join(tempDir, 'part.stp');
        fs.writeFileSync(filePath, [
            'ISO-10303-21;',
            'HEADER;',
            "FILE_SCHEMA(('AP214'));",
            'ENDSEC;'
        ].join('\n'), 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.stpViewer');
        expect(result.matchedBySignature).toBe(false);
    });

    it('detects Safetensors files by extension', async () => {
        const filePath = path.join(tempDir, 'model.safetensors');
        const header = Buffer.from(JSON.stringify({
            weight: { dtype: 'F32', shape: [2], data_offsets: [0, 8] }
        }), 'utf8');
        const prefix = Buffer.alloc(8);
        prefix.writeBigUInt64LE(BigInt(header.length));
        fs.writeFileSync(filePath, Buffer.concat([prefix, header, Buffer.alloc(8)]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.safetensorsViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('Safetensors extension');
    });

    it('detects ONNX files by extension', async () => {
        const filePath = path.join(tempDir, 'model.onnx');
        // Minimal ModelProto: field 1 (ir_version) varint, field 2 (producer_name) string.
        fs.writeFileSync(filePath, Buffer.from([
            0x08, 0x08,
            0x12, 0x05, 0x6f, 0x6d, 0x6e, 0x69, 0x21
        ]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.onnxViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('ONNX extension');
    });

    it('detects TFLite models by FlatBuffer identifier', async () => {
        // FlatBuffers place their four-byte file identifier at bytes 4-7.
        const filePath = path.join(tempDir, 'model.bin');
        const header = Buffer.alloc(12);
        header.writeUInt32LE(8, 0);
        header.write('TFL3', 4, 'ascii');
        fs.writeFileSync(filePath, header);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.tfliteViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('TFLite FlatBuffer identifier');
    });

    it('detects LiteRT .lite models by extension', async () => {
        const filePath = path.join(tempDir, 'model.lite');
        fs.writeFileSync(filePath, Buffer.from('not-enough-data-for-a-flatbuffer'));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.tfliteViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('TFLite/LiteRT extension');
    });

    it('detects ExecuTorch programs by FlatBuffer identifier', async () => {
        // Named .bin on purpose: the ET12 identifier alone must route the file.
        const filePath = path.join(tempDir, 'program.bin');
        const header = Buffer.alloc(12);
        header.writeUInt32LE(8, 0);
        header.write('ET12', 4, 'ascii');
        fs.writeFileSync(filePath, header);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.pteViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('ExecuTorch FlatBuffer identifier');
    });

    it('routes .pte files without the identifier to the ExecuTorch viewer by extension', async () => {
        const filePath = path.join(tempDir, 'program.pte');
        fs.writeFileSync(filePath, Buffer.from('not-enough-data-for-a-flatbuffer'));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.pteViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('ExecuTorch extension');
    });

    it('keeps text whose bytes 4-7 spell ET12 away from the ExecuTorch viewer', async () => {
        // `OFFSET12` puts "ET12" at offset 4, but "OFFS" is no FlatBuffer root offset.
        const filePath = path.join(tempDir, 'registers.csv');
        fs.writeFileSync(filePath, 'OFFSET12,LENGTH\n1,2\n3,4\n');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.csvViewer');
    });

    it('does not claim an ET12 header whose root offset points past the end of the file', async () => {
        const filePath = path.join(tempDir, 'truncated.bin');
        const header = Buffer.alloc(12);
        header.writeUInt32LE(64, 0);
        header.write('ET12', 4, 'ascii');
        fs.writeFileSync(filePath, header);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).not.toBe('omni-viewer.pteViewer');
    });

    it('detects GGUF files by signature', async () => {
        // Named .bin on purpose: the magic bytes alone must route the file.
        const filePath = path.join(tempDir, 'model.bin');
        const header = Buffer.alloc(24);
        header.write('GGUF', 0, 'ascii');
        header.writeUInt32LE(3, 4);
        header.writeBigUInt64LE(0n, 8);
        header.writeBigUInt64LE(0n, 16);
        fs.writeFileSync(filePath, header);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.ggufViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('GGUF magic bytes');
    });

    it('routes .har archives to the HAR viewer', async () => {
        const filePath = path.join(tempDir, 'session.har');
        fs.writeFileSync(filePath, '{"log":{"version":"1.2","entries":[]}}');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.harViewer');
        expect(result.reason).toContain('HAR extension fallback');
    });

    it('claims a HAR archive saved as .json before the JSON viewer', async () => {
        const filePath = path.join(tempDir, 'network.json');
        fs.writeFileSync(filePath, '\uFEFF{\n  "log": {\n    "version": "1.2",\n    "creator": {"name": "Firefox"},\n    "entries": [\n');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.harViewer');
        expect(result.reason).toContain('HTTP Archive');
    });

    it('sends a HAR saved as .json to the HAR viewer when the JSON viewer was requested', async () => {
        // Both runtime callers pass the requested viewer, and "Open With
        // OmniViewer" on a `.json` always requests the JSON viewer.
        const filePath = path.join(tempDir, 'network.json');
        fs.writeFileSync(filePath, '{"log":{"version":"1.2","entries":[]}}');

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');

        expect(result.viewType).toBe('omni-viewer.harViewer');
    });

    it('keeps an NDJSON log with a log key in the JSONL viewer', async () => {
        const filePath = path.join(tempDir, 'app.ndjson');
        fs.writeFileSync(filePath, '{"log":{"level":"info"},"entries":[1]}\n{"log":{"level":"warn"},"entries":[]}\n');

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonlViewer');

        expect(result.viewType).toBe('omni-viewer.jsonlViewer');
    });

    it('does not claim JSON whose entries array sits outside log', async () => {
        const filePath = path.join(tempDir, 'outside.json');
        fs.writeFileSync(filePath, '{"log":{"level":"info","note":"\\"entries\\": ["},"entries":[]}');

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');

        expect(result.viewType).toBe('omni-viewer.jsonViewer');
    });

    it('claims a pretty-printed multi-page HAR whose entries start past 16 KB', async () => {
        const filePath = path.join(tempDir, 'session.json');
        const pages = Array.from({ length: 80 }, (_, index) => ({
            startedDateTime: '2026-10-09T01:02:03.000Z',
            id: `page_${index}`,
            title: `https://example.com/step/${index}`,
            pageTimings: { onContentLoad: 120, onLoad: 340 }
        }));
        const text = JSON.stringify({
            // No `creator`, so only the `entries` key itself can claim it.
            log: { version: '1.2', pages, entries: [] }
        }, null, 2);
        expect(text.indexOf('"entries"')).toBeGreaterThan(16 * 1024);
        fs.writeFileSync(filePath, text);

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');

        expect(result.viewType).toBe('omni-viewer.harViewer');
    });

    it('claims a HAR whose pages array outruns the signature buffer', async () => {
        const filePath = path.join(tempDir, 'long-session.json');
        const pages = Array.from({ length: 2000 }, (_, index) => ({ id: `page_${index}`, title: 'x'.repeat(40) }));
        fs.writeFileSync(filePath, JSON.stringify({
            log: { version: '1.2', creator: { name: 'Firefox', version: '131' }, pages, entries: [] }
        }));

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');

        expect(result.viewType).toBe('omni-viewer.harViewer');
    });

    it('skips a string value equal to "entries" before the real key', async () => {
        const filePath = path.join(tempDir, 'commented.json');
        fs.writeFileSync(filePath, '{"log":{"version":"1.2","comment":"entries","entries":[]}}');

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');

        expect(result.viewType).toBe('omni-viewer.harViewer');
    });

    it('does not claim a log with a pages array but no HAR creator', async () => {
        const filePath = path.join(tempDir, 'book.json');
        fs.writeFileSync(filePath, '{"log":{"pages":[1,2,3]}}');

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');

        expect(result.viewType).toBe('omni-viewer.jsonViewer');
    });

    it('does not claim JSON whose entries array is nested below log', async () => {
        const filePath = path.join(tempDir, 'nested.json');
        fs.writeFileSync(filePath, '{"log":{"meta":{"entries":[]}}}');

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');

        expect(result.viewType).toBe('omni-viewer.jsonViewer');
    });

    it('leaves JSON with an unrelated log key to the JSON viewer', async () => {
        const filePath = path.join(tempDir, 'config.json');
        fs.writeFileSync(filePath, '{"name":"app","log":{"level":"debug"}}');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.jsonViewer');
    });

    it('keeps an over-budget pretty-printed .har in the HAR viewer to report the limit', async () => {
        // Pretty-printed lines like `"name": "x",` would otherwise satisfy the
        // CSV delimiter probe once the HAR claim stepped aside.
        const filePath = path.join(tempDir, 'huge.har');
        const entry = '    {\n      "name": "x",\n      "value": "y",\n      "size": 1,\n      "time": 2\n    },\n';
        fs.writeFileSync(filePath, '{\n  "log": {\n    "version": "1.2",\n    "entries": [\n' + entry.repeat(2000));
        fs.truncateSync(filePath, MAX_HAR_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.harViewer');

        expect(result.viewType).toBe('omni-viewer.harViewer');
    });

    it('keeps a UTF-16LE .har in the HAR viewer instead of the MP3 probe', async () => {
        // `FF FE` is a UTF-16LE byte-order mark and also an MPEG frame sync.
        const filePath = path.join(tempDir, 'powershell.har');
        fs.writeFileSync(filePath, Buffer.concat([
            Buffer.from([0xFF, 0xFE]),
            Buffer.from('{"log":{"version":"1.2","entries":[]}}', 'utf16le')
        ]));

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.harViewer');

        expect(result.viewType).toBe('omni-viewer.harViewer');
    });

    it('leaves an over-budget HAR saved as .json to the JSON viewer', async () => {
        const filePath = path.join(tempDir, 'huge.json');
        fs.writeFileSync(filePath, '{"log":{"version":"1.2","entries":[');
        fs.truncateSync(filePath, MAX_HAR_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');

        expect(result.viewType).not.toBe('omni-viewer.harViewer');
    });

    it('detects bare .mlmodel specifications by extension', async () => {
        // A `.mlmodel` is a raw protobuf with no magic bytes, so only the
        // extension can route it.
        const filePath = path.join(tempDir, 'model.mlmodel');
        fs.writeFileSync(filePath, Buffer.from([0x08, 0x07, 0x12, 0x00]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.coremlViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('Core ML extension fallback');
    });

    it('routes an .mlpackage archive to the Core ML viewer instead of the archive viewer', async () => {
        const filePath = path.join(tempDir, 'model.mlpackage');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.coremlViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('Core ML package extension');
    });

    it('routes a mislabeled Core ML package by its spec member', async () => {
        const filePath = path.join(tempDir, 'export.zip');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        mockZipLoadAsync.mockResolvedValue({
            files: {
                'Manifest.json': {},
                'Data/com.apple.CoreML/model.mlmodel': {},
                'Data/com.apple.CoreML/weights/weight.bin': {}
            }
        });

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.coremlViewer');
        expect(result.reason).toContain('Core ML package members');
    });

    it('leaves an oversized Core ML package with the archive viewer', async () => {
        const filePath = path.join(tempDir, 'huge.mlpackage');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        fs.truncateSync(filePath, MAX_COREML_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.reason).toContain('too large to inspect as a model');
    });

    it('does not claim a Core ML file past the memory budget', async () => {
        const filePath = path.join(tempDir, 'huge.mlmodel');
        fs.writeFileSync(filePath, Buffer.from([0x08, 0x07]));
        fs.truncateSync(filePath, MAX_COREML_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBeNull();
    });

    it('detects NumPy arrays by the NPY magic string', async () => {
        // Named .bin on purpose: the magic alone must route the file.
        const filePath = path.join(tempDir, 'array.bin');
        fs.writeFileSync(filePath, Buffer.concat([
            Buffer.from([0x93]),
            Buffer.from("NUMPY\x01\x00v\x00{'descr': '<f4', 'fortran_order': False, 'shape': (1,), }", 'latin1')
        ]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.numpyViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('NumPy NPY magic');
    });

    it('routes .npy files without the magic to the NumPy viewer by extension', async () => {
        const filePath = path.join(tempDir, 'broken.npy');
        fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.numpyViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('NumPy extension fallback');
    });

    it('routes an .npz archive to the NumPy viewer without inflating it', async () => {
        const filePath = path.join(tempDir, 'arrays.npz');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.numpyViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('NumPy NPZ extension');
        expect(mockZipLoadAsync).not.toHaveBeenCalled();
    });

    it('leaves an oversized .npz with the archive viewer', async () => {
        const filePath = path.join(tempDir, 'huge.npz');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        fs.truncateSync(filePath, MAX_NUMPY_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.reason).toContain('too large to inspect as arrays');
    });

    it('keeps a plain ZIP of .npy files with the archive viewer', async () => {
        const filePath = path.join(tempDir, 'dataset.zip');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        mockZipLoadAsync.mockResolvedValue({ files: { 'x.npy': {}, 'y.npy': {} } });

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
    });

    it('keeps an explicit Archive viewer request for .npz and .pt2 so the listing stays reachable', async () => {
        for (const name of ['arrays.npz', 'model.pt2']) {
            const filePath = path.join(tempDir, name);
            const zip = Buffer.alloc(64);
            zip.write('PK\x03\x04', 0, 'latin1');
            fs.writeFileSync(filePath, zip);

            const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.archiveViewer');

            expect(result.viewType).toBe('omni-viewer.archiveViewer');
            expect(result.reason).toContain('preserved the requested Archive viewer');
        }
    });

    it('keeps an explicit Archive viewer request for a mislabeled PyTorch Export package', async () => {
        const filePath = path.join(tempDir, 'export.zip');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        mockZipLoadAsync.mockResolvedValue({ files: { 'model/archive_format': {} } });

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.archiveViewer');

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
    });

    it('does not claim a ZIP whose PyTorch Export package is nested deeper than one folder', async () => {
        const filePath = path.join(tempDir, 'project.zip');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        mockZipLoadAsync.mockResolvedValue({
            files: {
                'README.md': {},
                'exports/model/archive_format': {},
                'exports/model/models/model.json': {}
            }
        });

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
    });

    it('routes a .pt2 package to the PyTorch Export viewer without inflating it', async () => {
        const filePath = path.join(tempDir, 'model.pt2');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.pt2Viewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('PyTorch Export extension');
        expect(mockZipLoadAsync).not.toHaveBeenCalled();
    });

    it('routes a mislabeled PyTorch Export package by its archive_format marker', async () => {
        const filePath = path.join(tempDir, 'export.zip');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        mockZipLoadAsync.mockResolvedValue({
            files: {
                'model/archive_format': {},
                'model/models/model.json': {}
            }
        });

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.pt2Viewer');
        expect(result.reason).toContain('PyTorch Export package members');
    });

    it('routes a legacy torch.export.save archive by its program file', async () => {
        const filePath = path.join(tempDir, 'legacy.zip');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        mockZipLoadAsync.mockResolvedValue({
            files: {
                'serialized_exported_program.json': {},
                'serialized_state_dict.pt': {}
            }
        });

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.pt2Viewer');
    });

    it('leaves an oversized .pt2 with the archive viewer', async () => {
        const filePath = path.join(tempDir, 'huge.pt2');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        fs.truncateSync(filePath, MAX_PT2_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.reason).toContain('too large to inspect as a model');
    });

    it('routes a .pt2 that is not a readable ZIP to the PyTorch Export viewer by extension', async () => {
        const filePath = path.join(tempDir, 'broken.pt2');
        fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.pt2Viewer');
        expect(result.reason).toContain('PyTorch Export extension fallback');
    });

    it('detects an OpenVINO IR topology by its <net> root and layers', async () => {
        const filePath = path.join(tempDir, 'model.xml');
        fs.writeFileSync(filePath, [
            '\uFEFF<?xml version="1.0"?>',
            '<!-- exported by ovc -->',
            '<net name="tiny" version="11">',
            '\t<layers>',
            '\t\t<layer id="0" name="x" type="Parameter" version="opset1"/>',
            '\t</layers>',
            '</net>'
        ].join('\n'));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.openvinoViewer');
        expect(result.reason).toContain('OpenVINO IR');
    });

    it('leaves ordinary XML to the other viewers', async () => {
        const filePath = path.join(tempDir, 'pom.xml');
        fs.writeFileSync(filePath, '<?xml version="1.0"?>\n<project><modelVersion>4.0.0</modelVersion></project>\n');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).not.toBe('omni-viewer.openvinoViewer');
    });

    it('does not claim a <net> root without a numeric version or layers', async () => {
        const unversioned = path.join(tempDir, 'unversioned.xml');
        fs.writeFileSync(unversioned, '<net name="a">\n<layers>\n</layers>\n</net>');
        const layerless = path.join(tempDir, 'layerless.xml');
        fs.writeFileSync(layerless, '<net name="a" version="11">\n<edges/>\n</net>');
        const uppercase = path.join(tempDir, 'uppercase.xml');
        fs.writeFileSync(uppercase, '<NET version="11">\n<layers>\n</layers>\n</NET>');

        for (const filePath of [unversioned, layerless, uppercase]) {
            const result = await FileUtils.detectViewerType(filePath);
            expect(result.viewType).not.toBe('omni-viewer.openvinoViewer');
        }
    });

    it('keeps AUTOSAR XML with the ARXML viewer', async () => {
        const filePath = path.join(tempDir, 'system.xml');
        fs.writeFileSync(filePath, '<?xml version="1.0"?>\n<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>A</SHORT-NAME></AR-PACKAGE></AR-PACKAGES></AUTOSAR>');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.arxmlViewer');
    });

    it('routes ordinary XML and its dialects to the XML viewer', async () => {
        const files: Array<[string, string]> = [
            ['pom.xml', '<?xml version="1.0"?>\n<project><modelVersion>4.0.0</modelVersion></project>\n'],
            ['App.csproj', '<Project Sdk="Microsoft.NET.Sdk">\n<PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n</Project>\n'],
            ['track.gpx', '<gpx version="1.1" creator="a,b,c"><trk><name>x,y,z</name></trk></gpx>']
        ];

        for (const [name, content] of files) {
            const filePath = path.join(tempDir, name);
            fs.writeFileSync(filePath, content);

            const result = await FileUtils.detectViewerType(filePath);

            expect(result.viewType).toBe('omni-viewer.xmlViewer');
            expect(result.reason).toContain('XML extension');
        }
    });

    it('detects extensionless XML by its declaration', async () => {
        const filePath = path.join(tempDir, 'feed');
        fs.writeFileSync(filePath, '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel/></rss>\n');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.xmlViewer');
        expect(result.reason).toContain('XML declaration');
    });

    it('keeps OpenVINO IR and ReqIF ahead of the generic XML viewer', async () => {
        const openvino = path.join(tempDir, 'ir.xml');
        fs.writeFileSync(openvino, '<?xml version="1.0"?>\n<net name="m" version="11">\n<layers>\n</layers>\n</net>');
        const reqif = path.join(tempDir, 'spec.xml');
        fs.writeFileSync(reqif, '<?xml version="1.0"?>\n<REQ-IF><THE-HEADER><REQ-IF-HEADER IDENTIFIER="h"/></THE-HEADER></REQ-IF>');

        expect((await FileUtils.detectViewerType(openvino)).viewType).toBe('omni-viewer.openvinoViewer');
        expect((await FileUtils.detectViewerType(reqif)).viewType).toBe('omni-viewer.reqifViewer');
    });

    it('keeps a UTF-16LE XML file with a BOM out of the audio probe', async () => {
        const filePath = path.join(tempDir, 'task.xml');
        fs.writeFileSync(filePath, Buffer.concat([
            Buffer.from([0xFF, 0xFE]),
            Buffer.from('<?xml version="1.0" encoding="UTF-16"?>\n<Task><Actions/></Task>\n', 'utf16le')
        ]));

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.xmlViewer');

        expect(result.viewType).toBe('omni-viewer.xmlViewer');
    });

    it('keeps an XSLT that emits SVG with the XML viewer', async () => {
        const filePath = path.join(tempDir, 'chart.xslt');
        fs.writeFileSync(filePath, [
            '<?xml version="1.0"?>',
            '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">',
            '<xsl:template match="/"><svg xmlns="http://www.w3.org/2000/svg"/></xsl:template>',
            '</xsl:stylesheet>'
        ].join('\n'));

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.xmlViewer');

        expect(result.viewType).toBe('omni-viewer.xmlViewer');
    });

    it('does not take a declared file with another viewer\'s extension for generic XML', async () => {
        const svg = path.join(tempDir, 'logo.svg');
        fs.writeFileSync(svg, '<?xml version="1.0"?>\n<!-- ' + 'x'.repeat(4096) + ' -->\n<svg xmlns="http://www.w3.org/2000/svg"/>\n');
        const puml = path.join(tempDir, 'diagram.puml');
        fs.writeFileSync(puml, '<?xml version="1.0"?>\n@startuml\nA -> B\n@enduml\n');

        expect((await FileUtils.detectViewerType(svg, 'omni-viewer.imageViewer')).viewType).not.toBe('omni-viewer.xmlViewer');
        expect((await FileUtils.detectViewerType(puml)).viewType).not.toBe('omni-viewer.xmlViewer');
    });

    it('keeps the EPUB and XML read limits in step with the core parsers', () => {
        // The core is ESM and mocked under Jest, so its published constants are read as text.
        const coreDist = path.join(__dirname, '..', '..', 'node_modules', 'omni-viewer-core', 'dist', 'parsers');
        const readMiB = (file: string, pattern: RegExp): number => {
            const match = pattern.exec(fs.readFileSync(path.join(coreDist, file), 'utf8'));
            expect(match).not.toBeNull();
            return Number(match![1]) * 1024 * 1024;
        };

        expect(MAX_EPUB_READ_BYTES).toBe(readMiB('types.js', /maxInputBytes:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/));
        expect(MAX_XML_READ_BYTES).toBe(readMiB('xml/index.js', /XML_DEFAULT_MAX_INPUT_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/));
    });

    it('detects an EPUB by its stored mimetype member even with the wrong extension', async () => {
        const filePath = path.join(tempDir, 'book.zip');
        fs.writeFileSync(filePath, epubHeader());

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.epubViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('EPUB OCF mimetype');
        expect(mockZipLoadAsync).not.toHaveBeenCalled();
    });

    it('routes an .epub ZIP to the EPUB viewer by extension', async () => {
        const filePath = path.join(tempDir, 'novel.epub');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.epubViewer');
        expect(result.reason).toContain('EPUB extension');
    });

    it('does not take an ODF mimetype member for an EPUB', async () => {
        const filePath = path.join(tempDir, 'sheet.zip');
        fs.writeFileSync(filePath, epubHeader('application/vnd.oasis.opendocument.spreadsheet'));
        mockZipLoadAsync.mockResolvedValue({ files: { mimetype: {}, 'content.xml': {} } });

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
    });

    it('leaves an oversized EPUB, or an explicit Archive request, with the archive viewer', async () => {
        const large = path.join(tempDir, 'huge.epub');
        fs.writeFileSync(large, epubHeader());
        fs.truncateSync(large, MAX_EPUB_READ_BYTES + 1);

        const oversized = await FileUtils.detectViewerType(large);
        expect(oversized.viewType).toBe('omni-viewer.archiveViewer');
        expect(oversized.reason).toContain('too large to open as a book');

        const small = path.join(tempDir, 'small.epub');
        fs.writeFileSync(small, epubHeader());

        const requested = await FileUtils.detectViewerType(small, 'omni-viewer.archiveViewer');
        expect(requested.viewType).toBe('omni-viewer.archiveViewer');
        expect(requested.reason).toContain('preserved the requested Archive viewer');
    });

    it('routes a Keras v3 archive to the Keras viewer instead of the archive viewer', async () => {
        const filePath = path.join(tempDir, 'model.keras');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.kerasViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('Keras v3 extension');
    });

    it('routes a mislabeled Keras archive by its weight store member', async () => {
        const filePath = path.join(tempDir, 'export.zip');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        mockZipLoadAsync.mockResolvedValue({
            files: { 'metadata.json': {}, 'config.json': {}, 'model.weights.h5': {} }
        });

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.kerasViewer');
        expect(result.reason).toContain('Keras v3 archive members');
    });

    it('leaves an ordinary ZIP carrying config and metadata JSON with the archive viewer', async () => {
        const filePath = path.join(tempDir, 'bundle.zip');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        mockZipLoadAsync.mockResolvedValue({
            files: { 'metadata.json': {}, 'config.json': {}, 'README.md': {} }
        });

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.reason).toContain('ZIP archive signature');
    });

    it('leaves an oversized Keras archive with the archive viewer', async () => {
        const filePath = path.join(tempDir, 'huge.keras');
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        fs.writeFileSync(filePath, zip);
        fs.truncateSync(filePath, MAX_KERAS_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.reason).toContain('too large to inspect as a model');
    });

    it('keeps a corrupt Keras archive on the Keras viewer, which reports what is wrong', async () => {
        const filePath = path.join(tempDir, 'truncated.keras');
        fs.writeFileSync(filePath, Buffer.from('not a zip and not an hdf5 file'));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.kerasViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('Keras extension fallback');
    });

    it('does not claim a corrupt Keras file past the memory budget', async () => {
        const filePath = path.join(tempDir, 'truncated-huge.keras');
        fs.writeFileSync(filePath, Buffer.from('not a zip and not an hdf5 file'));
        fs.truncateSync(filePath, MAX_KERAS_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBeNull();
    });

    it('routes a Keras HDF5 model to the Keras viewer', async () => {
        const filePath = path.join(tempDir, 'legacy.h5');
        const header = kerasHdf5Header();
        fs.writeFileSync(filePath, header);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.kerasViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('Keras model attributes');
    });

    it('leaves a Keras HDF5 model past the memory budget with the paged HDF5 viewer', async () => {
        const filePath = path.join(tempDir, 'huge.h5');
        fs.writeFileSync(filePath, kerasHdf5Header());
        fs.truncateSync(filePath, MAX_KERAS_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.hdf5Viewer');
        expect(result.reason).toContain('HDF5 signature');
    });

    it('leaves a Keras weights-only HDF5 file with the HDF5 viewer', async () => {
        // `save_weights` writes `keras_version` to a file that holds no model,
        // so that attribute alone must not claim the file for the Keras viewer.
        const filePath = path.join(tempDir, 'weights.h5');
        const header = hdf5Header();
        header.write('keras_version', 64, 'latin1');
        header.write('backend', 96, 'latin1');
        fs.writeFileSync(filePath, header);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.hdf5Viewer');
        expect(result.reason).toContain('HDF5 signature');
    });

    it('leaves an HDF5 file that merely mentions model_config with the HDF5 viewer', async () => {
        // The probe scans bytes, so a lone `model_config` string can come from a
        // dataset name or value in a file Keras never wrote.
        const filePath = path.join(tempDir, 'experiment.h5');
        const header = hdf5Header();
        header.write('model_config', 64, 'latin1');
        fs.writeFileSync(filePath, header);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.hdf5Viewer');
        expect(result.reason).toContain('HDF5 signature');
    });

    it('leaves a plain HDF5 file with the HDF5 viewer', async () => {
        const filePath = path.join(tempDir, 'data.h5');
        fs.writeFileSync(filePath, hdf5Header());

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.hdf5Viewer');
        expect(result.reason).toContain('HDF5 signature');
    });

    it('keeps an explicit Keras request on an HDF5 model file', async () => {
        const filePath = path.join(tempDir, 'model.hdf5');
        fs.writeFileSync(filePath, hdf5Header());

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.kerasViewer');

        expect(result.viewType).toBe('omni-viewer.kerasViewer');
        expect(result.reason).toContain('preserved the requested Keras viewer');
    });

    it('sends an explicit Keras request on an oversized HDF5 file to the HDF5 viewer', async () => {
        // Honouring it would only produce the size-cap error page, and the tree
        // viewer reads a file that large without loading it.
        const filePath = path.join(tempDir, 'huge.hdf5');
        fs.writeFileSync(filePath, kerasHdf5Header());
        fs.truncateSync(filePath, MAX_KERAS_READ_BYTES + 1);

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.kerasViewer');

        expect(result.viewType).toBe('omni-viewer.hdf5Viewer');
        expect(result.reason).toContain('HDF5 signature');
    });

    it('detects LaTeX files by extension', async () => {
        const filePath = path.join(tempDir, 'paper.tex');
        fs.writeFileSync(filePath, [
            '\\documentclass[12pt]{article}',
            '\\begin{document}',
            '\\section{Introduction}',
            'Energy is $E = mc^2$.',
            '\\end{document}'
        ].join('\n'), 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.latexViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('LaTeX extension');
    });

    it('keeps a LaTeX preamble away from the TOML and DBC text probes', async () => {
        // `key = value` lines and `%` comments are exactly what those probes
        // look for, so extension order decides the outcome here.
        const filePath = path.join(tempDir, 'settings.ltx');
        fs.writeFileSync(filePath, [
            '% geometry setup',
            '\\documentclass{report}',
            '\\usepackage[margin = 1in]{geometry}',
            'BO_ 100 Message: 8 Vector__XXX',
            '\\begin{document}',
            '\\chapter{Setup}',
            '\\end{document}'
        ].join('\n'), 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.latexViewer');
    });

    it('routes Jupyter notebooks ahead of the JSON probes', async () => {
        const filePath = path.join(tempDir, 'analysis.ipynb');
        fs.writeFileSync(filePath, JSON.stringify({
            nbformat: 4,
            nbformat_minor: 5,
            metadata: {},
            cells: [{ cell_type: 'markdown', metadata: {}, source: ['# Title'] }]
        }, null, 1), 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.notebookViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('Jupyter notebook extension');
    });

    it('detects ReqIF files by extension', async () => {
        const filePath = path.join(tempDir, 'requirements.reqif');
        fs.writeFileSync(filePath, [
            '<?xml version="1.0"?>',
            '<REQ-IF>',
            '<THE-HEADER><REQ-IF-HEADER IDENTIFIER="hdr"><TITLE>Requirements</TITLE></REQ-IF-HEADER></THE-HEADER>',
            '<CORE-CONTENT><REQ-IF-CONTENT><SPEC-OBJECTS><SPEC-OBJECT IDENTIFIER="obj"/></SPEC-OBJECTS></REQ-IF-CONTENT></CORE-CONTENT>',
            '</REQ-IF>'
        ].join('\n'), 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.reqifViewer');
        expect(result.matchedBySignature).toBe(false);
    });

    it('detects Mermaid files by extension', async () => {
        const filePath = path.join(tempDir, 'diagram.mmd');
        fs.writeFileSync(filePath, 'flowchart LR\n  A[Start] --> B[Done]\n', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.mermaidViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('Mermaid extension');
    });

    it('detects Mermaid content without a Mermaid extension', async () => {
        const filePath = path.join(tempDir, 'diagram.txt');
        fs.writeFileSync(filePath, 'sequenceDiagram\n  Alice->>Bob: Hello\n', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.mermaidViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('Mermaid diagram content');
    });

    it('detects PlantUML files by extension', async () => {
        const filePath = path.join(tempDir, 'diagram.puml');
        fs.writeFileSync(filePath, '@startuml\nBob -> Alice: Hello\n@enduml\n', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.plantumlViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('PlantUML extension');
    });

    it('detects PlantUML content without a PlantUML extension', async () => {
        const filePath = path.join(tempDir, 'diagram.txt');
        fs.writeFileSync(filePath, '@startmindmap\n* Root\n** Branch\n@endmindmap\n', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.plantumlViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('PlantUML diagram content');
    });

    it('detects AIFF files by FORM signature', async () => {
        const filePath = path.join(tempDir, 'sample.bin');
        fs.writeFileSync(filePath, Buffer.from([
            0x46, 0x4F, 0x52, 0x4D,
            0x00, 0x00, 0x00, 0x12,
            0x41, 0x49, 0x46, 0x46
        ]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.audioViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('AIFF');
    });

    it('detects AC3 files by sync word', async () => {
        const filePath = path.join(tempDir, 'sample.bin');
        fs.writeFileSync(filePath, Buffer.from([0x0B, 0x77, 0x00, 0x00]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.audioViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('AC-3');
    });

    it('returns MIME types for AIFF and AC3 extensions', () => {
        expect(FileUtils.getAudioMimeType(path.join(tempDir, 'track.aiff'))).toBe('audio/aiff');
        expect(FileUtils.getAudioMimeType(path.join(tempDir, 'track.aif'))).toBe('audio/aiff');
        expect(FileUtils.getAudioMimeType(path.join(tempDir, 'track.aifc'))).toBe('audio/aiff');
        expect(FileUtils.getAudioMimeType(path.join(tempDir, 'track.ac3'))).toBe('audio/ac3');
        expect(FileUtils.getAudioMimeType(path.join(tempDir, 'voice.pcm'))).toBe('audio/wav');
    });

    it('detects AMR files by header signature', async () => {
        const filePath = path.join(tempDir, 'sample.bin');
        fs.writeFileSync(filePath, Buffer.from('#!AMR\n', 'ascii'));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.audioViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('AMR');
    });

    it('detects MPEG transport streams by sync packets', async () => {
        const filePath = path.join(tempDir, 'sample.bin');
        const packetSize = 188;
        const buffer = Buffer.alloc(packetSize * 3, 0);
        buffer[0] = 0x47;
        buffer[packetSize] = 0x47;
        buffer[packetSize * 2] = 0x47;
        fs.writeFileSync(filePath, buffer);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.videoViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('transport stream');
    });

    it('returns MIME types for AMR and MPEG transport stream extensions', () => {
        expect(FileUtils.getAudioMimeType(path.join(tempDir, 'voice.amr'))).toBe('audio/amr');
        expect(FileUtils.getAudioMimeType(path.join(tempDir, 'voice.awb'))).toBe('audio/amr-wb');
        expect(FileUtils.getVideoMimeType(path.join(tempDir, 'clip.ts'))).toBe('video/mp2t');
        expect(FileUtils.getVideoMimeType(path.join(tempDir, 'clip.mts'))).toBe('video/mp2t');
        expect(FileUtils.getVideoMimeType(path.join(tempDir, 'clip.m2ts'))).toBe('video/mp2t');
    });

    it('reports default metadata for raw PCM files', async () => {
        const filePath = path.join(tempDir, 'voice.pcm');
        fs.writeFileSync(filePath, Buffer.alloc(32000));

        const metadata = await FileUtils.getAudioMetadata(filePath);

        expect(metadata.sampleRate).toBe(16000);
        expect(metadata.channels).toBe(1);
        expect(metadata.bitDepth).toBe(16);
        expect(metadata.duration).toBe(1);
        expect(metadata.format).toBe('PCM (s16le)');
    });

    it('keeps raw PCM files on the audio viewer instead of text sniffing', async () => {
        const filePath = path.join(tempDir, 'sample.pcm');
        fs.writeFileSync(filePath, Buffer.from([
            0x78, 0xff, 0x9b, 0xfe, 0x29, 0xfe, 0x9e, 0xff,
            0xc7, 0xff, 0x92, 0x00, 0x8c, 0x01, 0x48, 0x01,
            0x48, 0x01, 0x2a, 0x00, 0xee, 0x00, 0xea, 0xff
        ]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.audioViewer');
        expect(result.reason).toContain('raw audio extension fallback');
        expect(result.matchedBySignature).toBe(false);
    });

    it('detects ZIP files as archive previews when they are not Office documents', async () => {
        const filePath = path.join(tempDir, 'bundle.dat');
        fs.writeFileSync(filePath, Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects TAR files by signature', async () => {
        const filePath = path.join(tempDir, 'archive.bin');
        const buffer = Buffer.alloc(512, 0);
        buffer.write('ustar', 257, 'ascii');
        fs.writeFileSync(filePath, buffer);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects 7z files by signature', async () => {
        const filePath = path.join(tempDir, 'archive.bin');
        fs.writeFileSync(filePath, Buffer.from([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('7-Zip');
    });

    it('detects RAR v4 files by signature', async () => {
        const filePath = path.join(tempDir, 'archive.bin');
        fs.writeFileSync(filePath, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('RAR v4');
    });

    it('detects RAR v5 files by signature', async () => {
        const filePath = path.join(tempDir, 'archive.bin');
        fs.writeFileSync(filePath, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('RAR v5');
    });

    it('detects BZIP2 files by signature', async () => {
        const filePath = path.join(tempDir, 'archive.bin');
        fs.writeFileSync(filePath, Buffer.from('BZh9', 'ascii'));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('BZIP2');
    });

    it('detects XZ files by signature', async () => {
        const filePath = path.join(tempDir, 'archive.bin');
        fs.writeFileSync(filePath, Buffer.from([0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('XZ');
    });

    it('falls back to the archive viewer for DMG files by extension', async () => {
        const filePath = path.join(tempDir, 'disk.dmg');
        fs.writeFileSync(filePath, Buffer.from('not-a-real-dmg'));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.archiveViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('archive extension fallback');
    });

    it('detects Parquet files by header and footer signatures', async () => {
        const filePath = path.join(tempDir, 'sample.bin');
        fs.writeFileSync(filePath, Buffer.concat([
            Buffer.from('PAR1'),
            Buffer.from([0x00, 0x01, 0x02, 0x03]),
            Buffer.from('PAR1')
        ]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.parquetViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('keeps HDF5-backed .mat files on the MAT viewer', async () => {
        const filePath = path.join(tempDir, 'sample.mat');
        fs.writeFileSync(filePath, Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.matViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects classic MAT files by extension fallback', async () => {
        const filePath = path.join(tempDir, 'legacy.mat');
        const header = Buffer.alloc(20);
        header.writeInt32LE(0, 0);
        header.writeInt32LE(0, 4);
        header.writeInt32LE(0, 8);
        header.writeInt32LE(0, 12);
        header.writeInt32LE(1, 16);
        fs.writeFileSync(filePath, Buffer.concat([header, Buffer.from([0])]));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.matViewer');
        expect(result.matchedBySignature).toBe(false);
    });

    it('falls back to JSONL content sniffing for text files', async () => {
        const filePath = path.join(tempDir, 'records.txt');
        fs.writeFileSync(filePath, '{"id":1}\n{"id":2}\n', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.jsonlViewer');
        expect(result.matchedBySignature).toBe(false);
    });

    it('detects JSON documents by extension and content', async () => {
        const filePath = path.join(tempDir, 'sample.json');
        fs.writeFileSync(filePath, '{"id":1,"name":"demo"}', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.jsonViewer');
        expect(result.matchedBySignature).toBe(false);
    });

    it('detects Markdown documents by extension', async () => {
        const filePath = path.join(tempDir, 'readme.md');
        fs.writeFileSync(filePath, '# Title\n\n- item\n', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.markdownViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('Markdown extension');
    });

    it('keeps JSON-looking Markdown files on the Markdown viewer', async () => {
        const filePath = path.join(tempDir, 'notes.markdown');
        fs.writeFileSync(filePath, '{"example":true}', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.markdownViewer');
        expect(result.matchedBySignature).toBe(false);
    });

    it('detects DBC files by extension and CAN database content', async () => {
        const filePath = path.join(tempDir, 'network.dbc');
        fs.writeFileSync(filePath, [
            'VERSION "demo"',
            'BU_: ECM Tester',
            'BO_ 100 EngineData: 8 ECM',
            ' SG_ Speed : 0|16@1+ (0.01,0) [0|250] "km/h" Tester'
        ].join('\n'), 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.dbcViewer');
        expect(result.matchedBySignature).toBe(false);
        expect(result.reason).toContain('DBC extension');
    });

    it('detects ARXML files by extension', async () => {
        const filePath = path.join(tempDir, 'network.arxml');
        fs.writeFileSync(filePath, '<AUTOSAR><AR-PACKAGE><SHORT-NAME>Demo</SHORT-NAME></AR-PACKAGE></AUTOSAR>', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.arxmlViewer');
        expect(result.matchedBySignature).toBe(false);
    });

    it('detects A2L files by extension', async () => {
        const filePath = path.join(tempDir, 'ecu.a2l');
        fs.writeFileSync(filePath, '/begin PROJECT Demo ""\n/begin MODULE ECU ""\n/end MODULE\n/end PROJECT', 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.a2lViewer');
        expect(result.matchedBySignature).toBe(false);
    });

    it('detects ASC files by extension', async () => {
        const filePath = path.join(tempDir, 'trace.asc');
        fs.writeFileSync(filePath, [
            'date Sam Sep 30 15:06:13.191 2017',
            'base hex  timestamps absolute',
            '  30.300981 CANFD 3 Tx 50005x 0 1 5 0 140000'
        ].join('\n'), 'utf8');

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.ascViewer');
        expect(result.matchedBySignature).toBe(false);
    });

    it('detects BLF files by LOGG signature', async () => {
        const filePath = path.join(tempDir, 'trace.bin');
        fs.writeFileSync(filePath, Buffer.from('LOGG................', 'ascii'));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.blfViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects MF4 files by MDF signature', async () => {
        const filePath = path.join(tempDir, 'measurement.bin');
        fs.writeFileSync(filePath, Buffer.from('MDF     4.10    ', 'ascii'));

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.mf4Viewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('detects SHP files by shapefile header', async () => {
        const filePath = path.join(tempDir, 'roads.shp');
        const header = Buffer.alloc(100);
        header.writeInt32BE(9994, 0);
        header.writeInt32BE(50, 24);
        header.writeInt32LE(1000, 28);
        header.writeInt32LE(3, 32);
        fs.writeFileSync(filePath, header);

        const result = await FileUtils.detectViewerType(filePath);

        expect(result.viewType).toBe('omni-viewer.shpViewer');
        expect(result.matchedBySignature).toBe(true);
    });

    it('keeps .doc files on the Word viewer even when embedded workbook metadata exists', async () => {
        const filePath = path.join(tempDir, 'embedded-chart.doc');
        const header = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
        const body = Buffer.from('WordDocument Workbook PowerPoint Document', 'latin1');
        fs.writeFileSync(filePath, Buffer.concat([header, body]));

        const result = await FileUtils.detectViewerType(filePath, 'omni-viewer.wordViewer');

        expect(result.viewType).toBe('omni-viewer.wordViewer');
        expect(result.matchedBySignature).toBe(true);
        expect(result.reason).toContain('.doc');
    });
});
