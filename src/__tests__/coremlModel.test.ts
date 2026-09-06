import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockParseCoreml = jest.fn();
jest.mock('omni-viewer-core/parsers/coreml', () => ({
    parseCoreml: mockParseCoreml
}), { virtual: true });

import { MAX_COREML_READ_BYTES, readCoremlDocument } from '../utils/coremlModel';
import { createCoremlTemplateVariables } from '../utils/coremlTemplate';

function varint(value: number): Buffer {
    const bytes: number[] = [];
    let rest = value;
    do {
        let byte = rest & 0x7f;
        rest >>>= 7;
        if (rest) {
            byte |= 0x80;
        }
        bytes.push(byte);
    } while (rest);
    return Buffer.from(bytes);
}

function tag(field: number, wireType: number): Buffer {
    return varint((field << 3) | wireType);
}

function protoInt(field: number, value: number): Buffer {
    return Buffer.concat([tag(field, 0), varint(value)]);
}

function protoString(field: number, value: string): Buffer {
    const body = Buffer.from(value, 'utf8');
    return Buffer.concat([tag(field, 2), varint(body.length), body]);
}

function protoMessage(field: number, body: Buffer): Buffer {
    return Buffer.concat([tag(field, 2), varint(body.length), body]);
}

/** A minimal `CoreML.Specification.Model`: a spec version, a description with
 *  one input and one output, its metadata, and an empty `neuralNetwork` arm.
 *  Field numbers follow `Model.proto` — 65568 is the `FLOAT32` array data type. */
function minimalCoremlSpec(): Buffer {
    const multiArray = (shape: number[]): Buffer => protoMessage(
        5,
        Buffer.concat([...shape.map(dim => protoInt(1, dim)), protoInt(2, 65568)])
    );
    const input = protoMessage(1, Buffer.concat([
        protoString(1, 'image'),
        protoString(2, 'Input image'),
        protoMessage(3, multiArray([1, 3, 224, 224]))
    ]));
    const output = protoMessage(10, Buffer.concat([
        protoString(1, 'scores'),
        protoMessage(3, multiArray([1000]))
    ]));
    const metadata = protoMessage(100, Buffer.concat([
        protoString(1, 'Tiny test classifier'),
        protoString(2, '1.0'),
        protoString(3, 'omni'),
        protoString(4, 'MIT')
    ]));

    return Buffer.concat([
        protoInt(1, 7),
        protoMessage(2, Buffer.concat([input, output, metadata])),
        protoMessage(500, Buffer.alloc(0))
    ]);
}

describe('Core ML model integration', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-coreml-'));
        mockParseCoreml.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('reads the model bytes and passes them to the core parser', async () => {
        const filePath = path.join(tempDir, 'model.mlmodel');
        const bytes = minimalCoremlSpec();
        const parsed = { format: 'coreml', modelType: 'neuralNetwork' };
        fs.writeFileSync(filePath, bytes);
        mockParseCoreml.mockResolvedValue(parsed);

        await expect(readCoremlDocument(filePath)).resolves.toBe(parsed);
        expect(mockParseCoreml).toHaveBeenCalledTimes(1);
        expect(Buffer.from(mockParseCoreml.mock.calls[0][0])).toEqual(bytes);
    });

    it('rejects files beyond the extension-host memory budget before reading', async () => {
        const filePath = path.join(tempDir, 'large.mlpackage');
        fs.writeFileSync(filePath, Buffer.alloc(1));
        fs.truncateSync(filePath, MAX_COREML_READ_BYTES + 1);

        await expect(readCoremlDocument(filePath)).rejects.toThrow('512MB in-memory Core ML inspection limit');
        expect(mockParseCoreml).not.toHaveBeenCalled();
    });

    it('honors an already-aborted read signal', async () => {
        const filePath = path.join(tempDir, 'cancelled.mlmodel');
        fs.writeFileSync(filePath, minimalCoremlSpec());
        const abort = new AbortController();
        abort.abort();

        await expect(readCoremlDocument(filePath, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockParseCoreml).not.toHaveBeenCalled();
    });

    it('parses a minimal specification with the installed core package', () => {
        const hex = minimalCoremlSpec().toString('hex');
        const script = [
            "import { parseCoreml } from 'omni-viewer-core/parsers/coreml';",
            `const model = await parseCoreml(new Uint8Array(Buffer.from('${hex}', 'hex')));`,
            'process.stdout.write(JSON.stringify({',
            '  format: model.format,',
            '  modelType: model.modelType,',
            '  specificationVersion: model.specificationVersion,',
            '  title: model.title,',
            '  author: model.author,',
            '  packaged: model.packaged,',
            '  inputs: model.functions[0].inputs.map(feature => feature.name + \': \' + feature.type),',
            '  outputs: model.functions[0].outputs.map(feature => feature.name + \': \' + feature.type)',
            '}));'
        ].join('\n');

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve(__dirname, '../..'),
            encoding: 'utf8'
        });

        expect(JSON.parse(output)).toEqual({
            format: 'coreml',
            modelType: 'neuralNetwork',
            specificationVersion: 7,
            title: 'Tiny test classifier',
            author: 'omni',
            packaged: false,
            inputs: ['image: multiArray FLOAT32[1, 3, 224, 224]'],
            outputs: ['scores: multiArray FLOAT32[1000]']
        });
    });

    it('ships matching template, entry, and generated browser bundle paths', () => {
        const templateRoot = path.resolve(__dirname, '../templates/coreml');
        const html = fs.readFileSync(path.join(templateRoot, 'coremlViewer.html'), 'utf8');
        const entry = fs.readFileSync(path.join(templateRoot, 'js/coremlViewerMain.js'), 'utf8');

        expect(html).toContain('{{coremlData}}');
        expect(html).toContain('js/coremlViewer.js');
        expect(entry).toContain('mountCoremlDocument');
        expect(fs.statSync(path.join(templateRoot, 'js/coremlViewer.js')).size).toBeGreaterThan(0);
    });

    it('escapes an attacker-controlled filename in the successful webview', () => {
        const fileName = '</title><script>alert(1)</script>.mlmodel';
        const variables = createCoremlTemplateVariables(
            fileName,
            'en',
            { format: 'coreml' },
            'vscode-webview://test',
            'fixed-nonce'
        );
        const templatePath = path.resolve(__dirname, '../templates/coreml/coremlViewer.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const [key, value] of Object.entries(variables)) {
            html = html.split(`{{${key}}}`).join(value);
        }

        expect(html).not.toContain('</title><script>alert(1)</script>');
        expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;.mlmodel');
        expect(html).toContain("script-src 'nonce-fixed-nonce'");
        expect(JSON.parse(variables.coremlData).fileName).toBe(fileName);
    });
});
