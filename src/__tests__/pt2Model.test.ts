import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockParsePt2 = jest.fn();
jest.mock('omni-viewer-core/parsers/pt2', () => ({
    parsePt2: mockParsePt2
}), { virtual: true });

import { MAX_PT2_READ_BYTES, readPt2Document } from '../utils/pt2Model';
import { createPt2TemplateVariables } from '../utils/pt2Template';

describe('PyTorch Export package integration', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pt2-'));
        mockParsePt2.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('reads the package bytes and passes them to the core parser', async () => {
        const filePath = path.join(tempDir, 'model.pt2');
        const bytes = Buffer.from('PK\x03\x04package', 'latin1');
        const parsed = { layout: 'pt2', models: [] };
        fs.writeFileSync(filePath, bytes);
        mockParsePt2.mockResolvedValue(parsed);

        await expect(readPt2Document(filePath)).resolves.toBe(parsed);
        expect(mockParsePt2).toHaveBeenCalledTimes(1);
        expect(Buffer.from(mockParsePt2.mock.calls[0][0])).toEqual(bytes);
    });

    it('rejects packages beyond the extension-host memory budget before reading', async () => {
        const filePath = path.join(tempDir, 'large.pt2');
        fs.writeFileSync(filePath, Buffer.alloc(1));
        fs.truncateSync(filePath, MAX_PT2_READ_BYTES + 1);

        await expect(readPt2Document(filePath)).rejects.toThrow('512MB in-memory PyTorch Export inspection limit');
        expect(mockParsePt2).not.toHaveBeenCalled();
    });

    it('honors an already-aborted read signal', async () => {
        const filePath = path.join(tempDir, 'cancelled.pt2');
        fs.writeFileSync(filePath, Buffer.from('PK\x03\x04', 'latin1'));
        const abort = new AbortController();
        abort.abort();

        await expect(readPt2Document(filePath, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockParsePt2).not.toHaveBeenCalled();
    });

    it('parses a minimal stored package with the installed core package', () => {
        const program = {
            graph_module: {
                graph: {
                    inputs: [{ as_tensor: { name: 'x' } }],
                    outputs: [{ as_tensor: { name: 'relu' } }],
                    nodes: [{
                        target: 'torch.ops.aten.relu.default',
                        inputs: [{ name: 'input', arg: { as_tensor: { name: 'x' } }, kind: 1 }],
                        outputs: [{ as_tensor: { name: 'relu' } }],
                        metadata: {}
                    }],
                    tensor_values: {},
                    sym_int_values: {},
                    sym_bool_values: {},
                    sym_float_values: {},
                    custom_obj_values: {},
                    is_single_tensor_return: true
                },
                signature: {
                    input_specs: [{ user_input: { arg: { as_tensor: { name: 'x' } } } }],
                    output_specs: [{ user_output: { arg: { as_tensor: { name: 'relu' } } } }]
                },
                module_call_graph: []
            },
            opset_version: { aten: 10 },
            range_constraints: {},
            schema_version: { major: 8, minor: 0 },
            verifiers: [],
            torch_version: '2.6.0'
        };
        const script = [
            "import JSZip from 'jszip';",
            "import { parsePt2 } from 'omni-viewer-core/parsers/pt2';",
            'const zip = new JSZip();',
            "zip.file('model/archive_format', 'pt2');",
            "zip.file('model/archive_version', '0');",
            "zip.file('model/byteorder', 'little');",
            `zip.file('model/models/model.json', ${JSON.stringify(JSON.stringify(program))});`,
            "const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });",
            'const pkg = await parsePt2(bytes);',
            'const [model] = pkg.models;',
            'process.stdout.write(JSON.stringify({ layout: pkg.layout, prefix: pkg.prefix, name: model.name, ops: model.operators, warnings: pkg.warnings }));'
        ].join('\n');

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve(__dirname, '../..'),
            encoding: 'utf8'
        });

        expect(JSON.parse(output)).toEqual({
            layout: 'pt2',
            prefix: 'model',
            name: 'model',
            ops: [{ op: 'aten.relu.default', count: 1 }],
            warnings: []
        });
    });

    it('ships matching template, entry, and generated browser bundle paths', () => {
        const templateRoot = path.resolve(__dirname, '../templates/pt2');
        const html = fs.readFileSync(path.join(templateRoot, 'pt2Viewer.html'), 'utf8');
        const entry = fs.readFileSync(path.join(templateRoot, 'js/pt2ViewerMain.js'), 'utf8');

        expect(html).toContain('{{pt2Data}}');
        expect(html).toContain('js/pt2Viewer.js');
        expect(entry).toContain('mountPt2Document');
        expect(fs.statSync(path.join(templateRoot, 'js/pt2Viewer.js')).size).toBeGreaterThan(0);
    });

    it('escapes an attacker-controlled filename in the successful webview', () => {
        const fileName = '</title><script>alert(1)</script>.pt2';
        const variables = createPt2TemplateVariables(
            fileName,
            'en',
            { layout: 'pt2' },
            'vscode-webview://test',
            'fixed-nonce'
        );
        const templatePath = path.resolve(__dirname, '../templates/pt2/pt2Viewer.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const [key, value] of Object.entries(variables)) {
            html = html.split(`{{${key}}}`).join(value);
        }

        expect(html).not.toContain('</title><script>alert(1)</script>');
        expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;.pt2');
        expect(html).toContain("script-src 'nonce-fixed-nonce'");
        expect(JSON.parse(variables.pt2Data).fileName).toBe(fileName);
    });
});
