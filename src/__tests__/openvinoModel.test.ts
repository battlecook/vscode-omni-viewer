import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockParseOpenVino = jest.fn();
jest.mock('omni-viewer-core/parsers/openvino', () => ({
    parseOpenVino: mockParseOpenVino
}), { virtual: true });

import {
    MAX_OPENVINO_BIN_READ_BYTES,
    MAX_OPENVINO_XML_BYTES,
    openVinoWeightsPath,
    readOpenVinoDocument
} from '../utils/openvinoModel';
import { createOpenVinoTemplateVariables, describeSkippedWeights } from '../utils/openvinoTemplate';

const TINY_IR = [
    '<?xml version="1.0"?>',
    '<net name="tiny" version="11">',
    '<layers>',
    '<layer id="0" name="x" type="Parameter" version="opset1"><data shape="1,4" element_type="f32"/>',
    '<output><port id="0" precision="FP32" names="x"><dim>1</dim><dim>4</dim></port></output></layer>',
    '<layer id="1" name="w" type="Const" version="opset1"><data element_type="f32" shape="1,4" offset="0" size="16"/>',
    '<output><port id="0" precision="FP32"><dim>1</dim><dim>4</dim></port></output></layer>',
    '<layer id="2" name="add" type="Add" version="opset1">',
    '<input><port id="0"><dim>1</dim><dim>4</dim></port><port id="1"><dim>1</dim><dim>4</dim></port></input>',
    '<output><port id="2" precision="FP32"><dim>1</dim><dim>4</dim></port></output></layer>',
    '<layer id="3" name="out" type="Result" version="opset1"><input><port id="0"><dim>1</dim><dim>4</dim></port></input></layer>',
    '</layers>',
    '<edges>',
    '<edge from-layer="0" from-port="0" to-layer="2" to-port="0"/>',
    '<edge from-layer="1" from-port="0" to-layer="2" to-port="1"/>',
    '<edge from-layer="2" from-port="2" to-layer="3" to-port="0"/>',
    '</edges>',
    '</net>'
].join('\n');

function weights(): Buffer {
    const bytes = Buffer.alloc(16);
    [1, 2, 3, 4].forEach((value, index) => bytes.writeFloatLE(value, index * 4));
    return bytes;
}

describe('OpenVINO IR integration', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-openvino-'));
        mockParseOpenVino.mockReset();
        mockParseOpenVino.mockReturnValue({ format: 'openvino' });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('finds the weights beside the topology by base name', () => {
        expect(openVinoWeightsPath(path.join('models', 'resnet.v2.xml'))).toBe(path.join('models', 'resnet.v2.bin'));
    });

    it('passes the topology and the same-named .bin to the core parser', async () => {
        const filePath = path.join(tempDir, 'model.xml');
        fs.writeFileSync(filePath, TINY_IR);
        fs.writeFileSync(path.join(tempDir, 'model.bin'), weights());

        await expect(readOpenVinoDocument(filePath)).resolves.toEqual({ model: { format: 'openvino' }, skippedWeights: null });
        const [xml, options] = mockParseOpenVino.mock.calls[0];
        expect(Buffer.from(xml).toString('utf8')).toBe(TINY_IR);
        expect(Buffer.from(options.weights)).toEqual(weights());
    });

    it('parses the topology alone when no .bin sits beside it', async () => {
        const filePath = path.join(tempDir, 'model.xml');
        fs.writeFileSync(filePath, TINY_IR);

        await expect(readOpenVinoDocument(filePath)).resolves.toMatchObject({ skippedWeights: null });

        expect(mockParseOpenVino.mock.calls[0][1].weights).toBeUndefined();
    });

    it('ignores a directory named like the weights', async () => {
        const filePath = path.join(tempDir, 'model.xml');
        fs.writeFileSync(filePath, TINY_IR);
        fs.mkdirSync(path.join(tempDir, 'model.bin'));

        await readOpenVinoDocument(filePath);

        expect(mockParseOpenVino.mock.calls[0][1].weights).toBeUndefined();
    });

    it('leaves a .bin beyond the memory budget on disk and still renders the topology', async () => {
        const filePath = path.join(tempDir, 'model.xml');
        const binPath = path.join(tempDir, 'model.bin');
        fs.writeFileSync(filePath, TINY_IR);
        fs.writeFileSync(binPath, Buffer.alloc(1));
        fs.truncateSync(binPath, MAX_OPENVINO_BIN_READ_BYTES + 1);

        const result = await readOpenVinoDocument(filePath);

        expect(mockParseOpenVino).toHaveBeenCalledTimes(1);
        expect(mockParseOpenVino.mock.calls[0][1].weights).toBeUndefined();
        expect(result.skippedWeights).toEqual({
            fileName: 'model.bin',
            reason: 'tooLarge',
            size: MAX_OPENVINO_BIN_READ_BYTES + 1
        });
    });

    it('still renders the topology when the .bin cannot be read', async () => {
        const filePath = path.join(tempDir, 'model.xml');
        const binPath = path.join(tempDir, 'model.bin');
        fs.writeFileSync(filePath, TINY_IR);
        fs.writeFileSync(binPath, weights());
        const readFile = fs.promises.readFile;
        const spy = jest.spyOn(fs.promises, 'readFile').mockImplementation(((target: fs.PathLike, options?: unknown) => {
            if (String(target) === binPath) {
                return Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
            }
            return (readFile as (...args: unknown[]) => Promise<Buffer>)(target, options);
        }) as typeof fs.promises.readFile);

        try {
            const result = await readOpenVinoDocument(filePath);

            expect(mockParseOpenVino.mock.calls[0][1].weights).toBeUndefined();
            expect(result.skippedWeights).toEqual({ fileName: 'model.bin', reason: 'unreadable', size: 16 });
        } finally {
            spy.mockRestore();
        }
    });

    it('leaves a {{weightsNotice}} lookalike inside the model JSON untouched', () => {
        const skipped = { fileName: 'model.bin', reason: 'unreadable' as const, size: 16 };
        const fileName = '{{weightsNotice}}.xml';
        const variables = createOpenVinoTemplateVariables(
            fileName,
            'en',
            { layers: [{ name: '{{weightsNotice}}' }] },
            'vscode-webview://test',
            skipped,
            'fixed-nonce'
        );
        const templatePath = path.resolve(__dirname, '../templates/openvino/openvinoViewer.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const [key, value] of Object.entries(variables)) {
            html = html.split(`{{${key}}}`).join(value);
        }

        const json = /<script[^>]*id="openvino-data"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
        const data = JSON.parse(json);
        expect(data.fileName).toBe(fileName);
        expect(data.model.layers[0].name).toBe('{{weightsNotice}}');
        expect(html).toContain('model.bin could not be read');
    });

    it('explains a skipped .bin in the viewer shell, escaped', () => {
        const skipped = { fileName: '<b>.bin', reason: 'tooLarge' as const, size: 600 * 1024 * 1024 };
        const variables = createOpenVinoTemplateVariables('m.xml', 'en', {}, 'vscode-webview://test', skipped, 'fixed-nonce');

        expect(describeSkippedWeights(skipped)).toContain('600.0MB');
        expect(variables.weightsNotice).toContain('&lt;b&gt;.bin (600.0MB) was not loaded');
        expect(variables.weightsNotice).not.toContain('<b>');
        expect(createOpenVinoTemplateVariables('m.xml', 'en', {}, 'vscode-webview://test', null, 'fixed-nonce').weightsNotice).toBe('');
    });

    it('rejects a topology beyond the XML budget before reading', async () => {
        const filePath = path.join(tempDir, 'large.xml');
        fs.writeFileSync(filePath, Buffer.alloc(1));
        fs.truncateSync(filePath, MAX_OPENVINO_XML_BYTES + 1);

        await expect(readOpenVinoDocument(filePath)).rejects.toThrow('256MB OpenVINO XML inspection limit');
        expect(mockParseOpenVino).not.toHaveBeenCalled();
    });

    it('honors an already-aborted read signal', async () => {
        const filePath = path.join(tempDir, 'cancelled.xml');
        fs.writeFileSync(filePath, TINY_IR);
        const abort = new AbortController();
        abort.abort();

        await expect(readOpenVinoDocument(filePath, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockParseOpenVino).not.toHaveBeenCalled();
    });

    it('parses a minimal IR and previews its weights with the installed core package', () => {
        const script = [
            "import { parseOpenVino } from 'omni-viewer-core/parsers/openvino';",
            `const xml = new TextEncoder().encode(${JSON.stringify(TINY_IR)});`,
            `const model = parseOpenVino(xml, { weights: Buffer.from('${weights().toString('hex')}', 'hex') });`,
            'process.stdout.write(JSON.stringify({ name: model.name, irVersion: model.irVersion, layers: model.layers.length, constants: model.constants.map(c => [c.status, c.preview]), warnings: model.warnings }));'
        ].join('\n');

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve(__dirname, '../..'),
            encoding: 'utf8'
        });

        expect(JSON.parse(output)).toEqual({
            name: 'tiny',
            irVersion: '11',
            layers: 4,
            constants: [['available', ['1', '2', '3', '4']]],
            warnings: []
        });
    });

    it('ships matching template, entry, and generated browser bundle paths', () => {
        const templateRoot = path.resolve(__dirname, '../templates/openvino');
        const html = fs.readFileSync(path.join(templateRoot, 'openvinoViewer.html'), 'utf8');
        const entry = fs.readFileSync(path.join(templateRoot, 'js/openvinoViewerMain.js'), 'utf8');

        expect(html).toContain('{{openvinoData}}');
        expect(html).toContain('js/openvinoViewer.js');
        expect(entry).toContain('mountOpenVinoDocument');
        expect(fs.statSync(path.join(templateRoot, 'js/openvinoViewer.js')).size).toBeGreaterThan(0);
    });

    it('escapes an attacker-controlled filename in the successful webview', () => {
        const fileName = '</title><script>alert(1)</script>.xml';
        const variables = createOpenVinoTemplateVariables(
            fileName,
            'en',
            { format: 'openvino' },
            'vscode-webview://test',
            null,
            'fixed-nonce'
        );
        const templatePath = path.resolve(__dirname, '../templates/openvino/openvinoViewer.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const [key, value] of Object.entries(variables)) {
            html = html.split(`{{${key}}}`).join(value);
        }

        expect(html).not.toContain('</title><script>alert(1)</script>');
        expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;.xml');
        expect(html).toContain("script-src 'nonce-fixed-nonce'");
        expect(JSON.parse(variables.openvinoData).fileName).toBe(fileName);
    });
});
