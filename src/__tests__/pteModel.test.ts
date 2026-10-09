import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockParsePte = jest.fn();
jest.mock('omni-viewer-core/parsers/pte', () => ({
    parsePte: mockParsePte
}), { virtual: true });

import { MAX_PTE_READ_BYTES, readPteDocument } from '../utils/pteModel';
import { createPteTemplateVariables } from '../utils/pteTemplate';

function minimalPteBuffer(): Buffer {
    const bytes = Buffer.alloc(24);
    bytes.writeUInt32LE(16, 0);
    bytes.write('ET12', 4, 'ascii');
    bytes.writeUInt16LE(6, 8);
    bytes.writeUInt16LE(8, 10);
    bytes.writeUInt16LE(4, 12);
    bytes.writeInt32LE(8, 16);
    bytes.writeUInt32LE(0, 20);
    return bytes;
}

describe('ExecuTorch program integration', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pte-'));
        mockParsePte.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('reads the model bytes and passes them to the core parser', async () => {
        const filePath = path.join(tempDir, 'model.pte');
        const bytes = minimalPteBuffer();
        const parsed = { format: 'pte', version: '0' };
        fs.writeFileSync(filePath, bytes);
        mockParsePte.mockReturnValue(parsed);

        await expect(readPteDocument(filePath)).resolves.toBe(parsed);
        expect(mockParsePte).toHaveBeenCalledTimes(1);
        expect(Buffer.from(mockParsePte.mock.calls[0][0])).toEqual(bytes);
    });

    it('rejects files beyond the extension-host memory budget before reading', async () => {
        const filePath = path.join(tempDir, 'large.pte');
        fs.writeFileSync(filePath, Buffer.alloc(1));
        fs.truncateSync(filePath, MAX_PTE_READ_BYTES + 1);

        await expect(readPteDocument(filePath)).rejects.toThrow('512MB in-memory ExecuTorch inspection limit');
        expect(mockParsePte).not.toHaveBeenCalled();
    });

    it('honors an already-aborted read signal', async () => {
        const filePath = path.join(tempDir, 'cancelled.pte');
        fs.writeFileSync(filePath, minimalPteBuffer());
        const abort = new AbortController();
        abort.abort();

        await expect(readPteDocument(filePath, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockParsePte).not.toHaveBeenCalled();
    });

    it('parses a minimal valid FlatBuffer with the installed core package', () => {
        const hex = minimalPteBuffer().toString('hex');
        const script = [
            "import { parsePte } from 'omni-viewer-core/parsers/pte';",
            `const model = parsePte(Buffer.from('${hex}', 'hex'));`,
            "process.stdout.write(JSON.stringify({ format: model.format, version: model.version, identifier: model.identifier }));"
        ].join('\n');

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve(__dirname, '../..'),
            encoding: 'utf8'
        });

        expect(JSON.parse(output)).toEqual({ format: 'pte', version: '0', identifier: 'ET12' });
    });

    it('ships matching template, entry, and generated browser bundle paths', () => {
        const templateRoot = path.resolve(__dirname, '../templates/pte');
        const html = fs.readFileSync(path.join(templateRoot, 'pteViewer.html'), 'utf8');
        const entry = fs.readFileSync(path.join(templateRoot, 'js/pteViewerMain.js'), 'utf8');

        expect(html).toContain('{{pteData}}');
        expect(html).toContain('js/pteViewer.js');
        expect(entry).toContain('mountPteDocument');
        expect(fs.statSync(path.join(templateRoot, 'js/pteViewer.js')).size).toBeGreaterThan(0);
    });

    it('escapes an attacker-controlled filename in the successful webview', () => {
        const fileName = '</title><script>alert(1)</script>.pte';
        const variables = createPteTemplateVariables(
            fileName,
            'en',
            { format: 'pte' },
            'vscode-webview://test',
            'fixed-nonce'
        );
        const templatePath = path.resolve(__dirname, '../templates/pte/pteViewer.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const [key, value] of Object.entries(variables)) {
            html = html.split(`{{${key}}}`).join(value);
        }

        expect(html).not.toContain('</title><script>alert(1)</script>');
        expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;.pte');
        expect(html).toContain("script-src 'nonce-fixed-nonce'");
        expect(JSON.parse(variables.pteData).fileName).toBe(fileName);
    });
});
