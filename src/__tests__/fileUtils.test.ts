import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('music-metadata', () => ({}), { virtual: true });
jest.mock('hyparquet', () => ({}), { virtual: true });
jest.mock('hwp.js', () => ({}), { virtual: true });
jest.mock('xlsx', () => ({}), { virtual: true });
jest.mock('jszip', () => ({}), { virtual: true });

import { FileUtils } from '../utils/fileUtils';

describe('FileUtils delimited formats', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-viewer-'));
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
