import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockParseNumpy = jest.fn();
jest.mock('omni-viewer-core/parsers/numpy', () => ({
    parseNumpy: mockParseNumpy
}), { virtual: true });

import { MAX_NUMPY_READ_BYTES, readNumpyDocument } from '../utils/numpyModel';
import { createNumpyTemplateVariables } from '../utils/numpyTemplate';

/** A one-element little-endian float32 `.npy` holding 1.5. */
function minimalNpyBuffer(): Buffer {
    let header = "{'descr': '<f4', 'fortran_order': False, 'shape': (1,), }";
    header += ' '.repeat(128 - 10 - header.length - 1) + '\n';
    const preamble = Buffer.alloc(10);
    Buffer.from([0x93]).copy(preamble);
    preamble.write('NUMPY', 1, 'latin1');
    preamble.writeUInt8(1, 6);
    preamble.writeUInt8(0, 7);
    preamble.writeUInt16LE(header.length, 8);
    const value = Buffer.alloc(4);
    value.writeFloatLE(1.5, 0);
    return Buffer.concat([preamble, Buffer.from(header, 'latin1'), value]);
}

describe('NumPy array integration', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-numpy-'));
        mockParseNumpy.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('reads the file bytes and passes them to the core parser with the file name', async () => {
        const filePath = path.join(tempDir, 'weights.npy');
        const bytes = minimalNpyBuffer();
        const parsed = { format: 'NumPy NPY', arrays: [] };
        fs.writeFileSync(filePath, bytes);
        mockParseNumpy.mockResolvedValue(parsed);

        await expect(readNumpyDocument(filePath)).resolves.toBe(parsed);
        expect(mockParseNumpy).toHaveBeenCalledTimes(1);
        expect(Buffer.from(mockParseNumpy.mock.calls[0][0])).toEqual(bytes);
        expect(mockParseNumpy.mock.calls[0][1]).toBe('weights.npy');
    });

    it('rejects files beyond the extension-host memory budget before reading', async () => {
        const filePath = path.join(tempDir, 'large.npy');
        fs.writeFileSync(filePath, Buffer.alloc(1));
        fs.truncateSync(filePath, MAX_NUMPY_READ_BYTES + 1);

        await expect(readNumpyDocument(filePath)).rejects.toThrow('512MB in-memory NumPy inspection limit');
        expect(mockParseNumpy).not.toHaveBeenCalled();
    });

    it('honors an already-aborted read signal', async () => {
        const filePath = path.join(tempDir, 'cancelled.npy');
        fs.writeFileSync(filePath, minimalNpyBuffer());
        const abort = new AbortController();
        abort.abort();

        await expect(readNumpyDocument(filePath, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockParseNumpy).not.toHaveBeenCalled();
    });

    it('parses a minimal array with the installed core package', () => {
        const hex = minimalNpyBuffer().toString('hex');
        const script = [
            "import { parseNumpy } from 'omni-viewer-core/parsers/numpy';",
            `const model = await parseNumpy(Buffer.from('${hex}', 'hex'), 'weights.npy');`,
            'const [array] = model.arrays;',
            'process.stdout.write(JSON.stringify({ format: model.format, name: array.name, dtype: array.dtype, shape: array.shape, values: array.values }));'
        ].join('\n');

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve(__dirname, '../..'),
            encoding: 'utf8'
        });

        expect(JSON.parse(output)).toEqual({
            format: 'NumPy NPY',
            name: 'weights',
            dtype: '<f4',
            shape: [1],
            values: [1.5]
        });
    });

    it('keeps NaN, infinities, and negative zero instead of letting JSON null them', () => {
        const variables = createNumpyTemplateVariables(
            'a.npy',
            'en',
            { arrays: [{ values: [NaN, Infinity, -Infinity, -0, 1.5, 'text', true] }] },
            'vscode-webview://test',
            'fixed-nonce'
        );

        expect(JSON.parse(variables.numpyData).model.arrays[0].values)
            .toEqual(['NaN', 'Infinity', '-Infinity', '-0', 1.5, 'text', true]);
    });

    it('ships matching template, entry, and generated browser bundle paths', () => {
        const templateRoot = path.resolve(__dirname, '../templates/numpy');
        const html = fs.readFileSync(path.join(templateRoot, 'numpyViewer.html'), 'utf8');
        const entry = fs.readFileSync(path.join(templateRoot, 'js/numpyViewerMain.js'), 'utf8');

        expect(html).toContain('{{numpyData}}');
        expect(html).toContain('js/numpyViewer.js');
        expect(entry).toContain('mountNumpyDocument');
        expect(fs.statSync(path.join(templateRoot, 'js/numpyViewer.js')).size).toBeGreaterThan(0);
    });

    it('escapes an attacker-controlled filename in the successful webview', () => {
        const fileName = '</title><script>alert(1)</script>.npy';
        const variables = createNumpyTemplateVariables(
            fileName,
            'en',
            { format: 'NumPy NPY' },
            'vscode-webview://test',
            'fixed-nonce'
        );
        const templatePath = path.resolve(__dirname, '../templates/numpy/numpyViewer.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const [key, value] of Object.entries(variables)) {
            html = html.split(`{{${key}}}`).join(value);
        }

        expect(html).not.toContain('</title><script>alert(1)</script>');
        expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;.npy');
        expect(html).toContain("script-src 'nonce-fixed-nonce'");
        expect(JSON.parse(variables.numpyData).fileName).toBe(fileName);
    });
});
