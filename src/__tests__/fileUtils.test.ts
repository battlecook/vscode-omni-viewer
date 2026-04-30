import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('music-metadata', () => ({}), { virtual: true });
const mockParquetMetadataAsync = jest.fn();
const mockParquetReadObjects = jest.fn();
const mockParquetSchema = jest.fn();
const mockAsyncBufferFromFile = jest.fn();
jest.mock('hyparquet', () => ({
    asyncBufferFromFile: mockAsyncBufferFromFile,
    parquetMetadataAsync: mockParquetMetadataAsync,
    parquetReadObjects: mockParquetReadObjects,
    parquetSchema: mockParquetSchema
}), { virtual: true });
jest.mock('hwp.js', () => ({}), { virtual: true });
jest.mock('xlsx', () => ({}), { virtual: true });
jest.mock('jszip', () => ({}), { virtual: true });

import { FileUtils } from '../utils/fileUtils';

describe('FileUtils delimited formats', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-viewer-'));
        mockAsyncBufferFromFile.mockReset();
        mockParquetMetadataAsync.mockReset();
        mockParquetReadObjects.mockReset();
        mockParquetSchema.mockReset();
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
