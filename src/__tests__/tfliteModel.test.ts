import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockParseTflite = jest.fn();
jest.mock('omni-viewer-core/parsers/tflite', () => ({
    parseTflite: mockParseTflite
}), { virtual: true });

import { MAX_TFLITE_READ_BYTES, readTfliteDocument } from '../utils/tfliteModel';
import { createTfliteTemplateVariables } from '../utils/tfliteTemplate';

function minimalTfliteBuffer(): Buffer {
    const bytes = Buffer.alloc(24);
    bytes.writeUInt32LE(16, 0);
    bytes.write('TFL3', 4, 'ascii');
    bytes.writeUInt16LE(6, 8);
    bytes.writeUInt16LE(8, 10);
    bytes.writeUInt16LE(4, 12);
    bytes.writeInt32LE(8, 16);
    bytes.writeUInt32LE(3, 20);
    return bytes;
}

describe('TFLite model integration', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-tflite-'));
        mockParseTflite.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('reads the model bytes and passes them to the core parser', async () => {
        const filePath = path.join(tempDir, 'model.tflite');
        const bytes = minimalTfliteBuffer();
        const parsed = { format: 'tflite', version: '3' };
        fs.writeFileSync(filePath, bytes);
        mockParseTflite.mockReturnValue(parsed);

        await expect(readTfliteDocument(filePath)).resolves.toBe(parsed);
        expect(mockParseTflite).toHaveBeenCalledTimes(1);
        expect(Buffer.from(mockParseTflite.mock.calls[0][0])).toEqual(bytes);
    });

    it('rejects files beyond the extension-host memory budget before reading', async () => {
        const filePath = path.join(tempDir, 'large.tflite');
        fs.writeFileSync(filePath, Buffer.alloc(1));
        fs.truncateSync(filePath, MAX_TFLITE_READ_BYTES + 1);

        await expect(readTfliteDocument(filePath)).rejects.toThrow('512MB in-memory TFLite inspection limit');
        expect(mockParseTflite).not.toHaveBeenCalled();
    });

    it('honors an already-aborted read signal', async () => {
        const filePath = path.join(tempDir, 'cancelled.tflite');
        fs.writeFileSync(filePath, minimalTfliteBuffer());
        const abort = new AbortController();
        abort.abort();

        await expect(readTfliteDocument(filePath, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockParseTflite).not.toHaveBeenCalled();
    });

    it('parses a minimal valid FlatBuffer with the installed core package', () => {
        const hex = minimalTfliteBuffer().toString('hex');
        const script = [
            "import { parseTflite } from 'omni-viewer-core/parsers/tflite';",
            `const model = parseTflite(Buffer.from('${hex}', 'hex'));`,
            "process.stdout.write(JSON.stringify({ format: model.format, version: model.version, identifier: model.identifier }));"
        ].join('\n');

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve(__dirname, '../..'),
            encoding: 'utf8'
        });

        expect(JSON.parse(output)).toEqual({ format: 'tflite', version: '3', identifier: 'TFL3' });
    });

    it('ships matching template, entry, and generated browser bundle paths', () => {
        const templateRoot = path.resolve(__dirname, '../templates/tflite');
        const html = fs.readFileSync(path.join(templateRoot, 'tfliteViewer.html'), 'utf8');
        const entry = fs.readFileSync(path.join(templateRoot, 'js/tfliteViewerMain.js'), 'utf8');

        expect(html).toContain('{{tfliteData}}');
        expect(html).toContain('js/tfliteViewer.js');
        expect(entry).toContain('mountTfliteDocument');
        expect(fs.statSync(path.join(templateRoot, 'js/tfliteViewer.js')).size).toBeGreaterThan(0);
    });

    it('escapes an attacker-controlled filename in the successful webview', () => {
        const fileName = '</title><script>alert(1)</script>.tflite';
        const variables = createTfliteTemplateVariables(
            fileName,
            'en',
            { format: 'tflite' },
            'vscode-webview://test',
            'fixed-nonce'
        );
        const templatePath = path.resolve(__dirname, '../templates/tflite/tfliteViewer.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const [key, value] of Object.entries(variables)) {
            html = html.split(`{{${key}}}`).join(value);
        }

        expect(html).not.toContain('</title><script>alert(1)</script>');
        expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;.tflite');
        expect(html).toContain("script-src 'nonce-fixed-nonce'");
        expect(JSON.parse(variables.tfliteData).fileName).toBe(fileName);
    });
});
