import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectCore023Signature, detectCore023OpenApi } from '../utils/core023Detection';
import { MAX_MESH_ASSET_BYTES, readCoreMeshAsset } from '../utils/coreMeshAssets';
import { readBoundedPreviewFile, readCorePreview } from '../utils/corePreview';
import { parseText } from 'omni-viewer-core/parsers/text';
import { parseJUnit } from 'omni-viewer-core/parsers/junit';
import { parseOpenApi } from 'omni-viewer-core/parsers/openapi';
import { parseSelfLoadingOpenApi } from 'omni-viewer-core/parsers/openapi/self-loading';

describe('0.23 core viewer routing and resources', () => {
    let directory: string;
    beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-023-')); });
    afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

    it.each(['.txt', '.dcm', '.dicom', '.eml', '.mcap', '.glb', '.gltf', '.stl', '.obj'])('routes empty/new format %s to its viewer', ext => {
        const kind = ext === '.txt' ? 'text' : ['.dcm', '.dicom'].includes(ext) ? 'dicom' : ['.glb', '.gltf', '.stl', '.obj'].includes(ext) ? 'mesh' : ext.slice(1);
        expect(detectCore023Signature(Buffer.alloc(0), ext)?.viewType).toBe(`omni-viewer.${kind}Viewer`);
    });
    it('detects DICOM even with another signature in its arbitrary Part 10 preamble', () => {
        const bytes = Buffer.alloc(132); bytes.write('%PDF-1.7'); bytes.write('DICM', 128);
        expect(detectCore023Signature(bytes, '')).toMatchObject({ viewType: 'omni-viewer.dicomViewer', matchedBySignature: true });
    });
    it('detects MCAP and GLB content without filename hints', () => {
        expect(detectCore023Signature(Buffer.from([0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 13, 10]), '')?.viewType).toBe('omni-viewer.mcapViewer');
        expect(detectCore023Signature(Buffer.from('glTF'), '.bin')?.viewType).toBe('omni-viewer.meshViewer');
    });
    it('honors an explicit Text editor without reinterpreting its literal content', () => {
        expect(detectCore023Signature(Buffer.from('graph TD\nA-->B'), '.txt', true)?.viewType).toBe('omni-viewer.textViewer');
        expect(detectCore023Signature(Buffer.from('graph TD\nA-->B'), '.txt')).toBeNull();
    });
    it.each(['', '<?xml version="1.0"?><!-- suite -->', '<!DOCTYPE testsuite [<!ENTITY literal "a > b">]>'])('uses the core JUnit root detector past a prologue (%s)', prologue => {
        const bytes = Buffer.from(prologue + '<testsuite tests="1"><testcase name="one"/></testsuite>');
        expect(detectCore023Signature(bytes, '.xml')?.viewType).toBe('omni-viewer.junitViewer');
        expect(detectCore023Signature(bytes, '')?.viewType).toBe('omni-viewer.junitViewer');
    });
    it('recognizes UTF-16 JUnit while leaving unrelated XML dialects alone', () => {
        const report = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<testsuites/>', 'utf16le')]);
        expect(detectCore023Signature(report, '.xml')?.viewType).toBe('omni-viewer.junitViewer');
        for (const xml of ['<root><testsuites/></root>', '<testsuite><node_order>1</node_order></testsuite>', '<net version="11"><layers/></net>', '<AUTOSAR/>', '<REQ-IF/>']) {
            expect(detectCore023Signature(Buffer.from(xml), '.xml')).toBeNull();
        }
    });
    it.each(['LE', 'BE'])('routes BOM-less UTF-16%s JUnit using the same decoding as its parser', byteOrder => {
        const source = `<?xml version="1.0" encoding="UTF-16${byteOrder}"?><testsuite tests="1"><testcase name="pass"/></testsuite>`;
        const data = Buffer.from(source, 'utf16le');
        if (byteOrder === 'BE') data.swap16();
        const result = parseJUnit(new Uint8Array(data)).result;
        expect(result.status).toBe('ok');
        if (result.status !== 'failed') expect(result.document.cases).toHaveLength(1);
        expect(detectCore023Signature(data, '.xml')?.viewType).toBe('omni-viewer.junitViewer');
        expect(detectCore023Signature(data, '')?.viewType).toBe('omni-viewer.junitViewer');
    });
    it('uses the core XML decoder for declared legacy report encodings', () => {
        const data = Buffer.from('<?xml version="1.0" encoding="windows-1252"?><testsuite tests="1" name="caf\xe9"><testcase name="pass"/></testsuite>', 'latin1');
        expect(parseJUnit(new Uint8Array(data)).result.status).toBe('ok');
        expect(detectCore023Signature(data, '.xml')?.viewType).toBe('omni-viewer.junitViewer');
    });
    it('detects extensionless email conservatively', () => {
        expect(detectCore023Signature(Buffer.from('From: a@example.test\r\nTo: b@example.test\r\nSubject: Test\r\n\r\nBody'), '')?.viewType).toBe('omni-viewer.emlViewer');
        expect(detectCore023Signature(Buffer.from('from: config\nsubject: config'), '')).toBeNull();
    });
    async function openApi(source: string, ext: string) {
        const filePath = path.join(directory, `api${ext}`); fs.writeFileSync(filePath, source);
        return detectCore023OpenApi(filePath, fs.readFileSync(filePath).subarray(0, 65536), ext);
    }
    it.each(['.json', ''])('refines valid OpenAPI JSON using a full bounded read (%s)', async ext => {
        const source = JSON.stringify({ padding: 'x'.repeat(70000), openapi: '3.2.0', info: { title: 'Pets', version: '1' }, paths: {} });
        expect((await openApi(source, ext))?.viewType).toBe('omni-viewer.openapiViewer');
    });
    it.each(['.yaml', '.yml', ''])('recognizes block and flow YAML Swagger (%s)', async ext => {
        expect((await openApi('swagger: "2.0"\ninfo:\n  title: Pets\n  version: "1"\npaths: {}\n', ext))?.viewType).toBe('omni-viewer.openapiViewer');
        expect((await openApi('{openapi: 3.1.0, info: {title: Pets, version: "1"}, paths: {}}', ext))?.viewType).toBe('omni-viewer.openapiViewer');
    });
    it('keeps nested version fields, invalid documents, and YAML in .json out of OpenAPI', async () => {
        expect(await openApi('{"nested":{"openapi":"3.0.0"},"info":{},"paths":{}}', '.json')).toBeNull();
        expect(await openApi('openapi: 3.1.0\ninfo: {title: Pets, version: "1"}\npaths: {}', '.json')).toBeNull();
        expect(await openApi('{"openapi":"4.0.0","info":{"title":"Pets","version":"1"},"paths":{}}', '.json')).toBeNull();
    });
    it('routes alias-heavy flow YAML by the original bounded document, not expanded JSON size', async () => {
        const entries = Array.from({ length: 12 }, (_, i) => `"/p${i}": {get: {description: *desc, responses: {"200": {description: OK}}}}`).join(',');
        const source = `{openapi: 3.1.0, info: {title: Test, version: "1"}, "x-description": &desc "${'a'.repeat(1024 * 1024)}", paths: {${entries}}}`;
        const result = (await parseSelfLoadingOpenApi(source)).result;
        expect(result.status).toBe('ok');
        if (result.status !== 'failed') expect(result.document.operations).toHaveLength(12);
        expect((await openApi(source, '.yaml'))?.viewType).toBe('omni-viewer.openapiViewer');
    });
    it.each(['le', 'be'])('normalizes detected UTF-16%s OpenAPI to bytes the core can parse', async byteOrder => {
        const source = JSON.stringify({ openapi: '3.1.0', info: { title: '한글 API', version: '1' }, paths: {} });
        const body = Buffer.from(source, 'utf16le');
        if (byteOrder === 'be') body.swap16();
        const data = Buffer.concat([Buffer.from(byteOrder === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]), body]);
        const filePath = path.join(directory, 'utf16.json'); fs.writeFileSync(filePath, data);
        expect((await detectCore023OpenApi(filePath, data, '.json'))?.viewType).toBe('omni-viewer.openapiViewer');
        const normalized = await readCorePreview(filePath, 'openapi');
        expect(new TextDecoder().decode(normalized)).toBe(source);
        expect(parseOpenApi(normalized, { format: 'json' }).result.status).toBe('ok');
    });
    it('resolves glTF resources with exact bytes and refuses traversal, remote URLs and escaping symlinks', async () => {
        fs.mkdirSync(path.join(directory, 'model'));
        const model = path.join(directory, 'model', 'scene.gltf'); fs.writeFileSync(model, '{}');
        fs.writeFileSync(path.join(directory, 'model', 'mesh data.bin'), Buffer.from([0, 255, 128]));
        expect(await readCoreMeshAsset(model, 'mesh%20data.bin')).toEqual({ data: new Uint8Array([0, 255, 128]), mimeType: 'application/octet-stream' });
        fs.writeFileSync(path.join(directory, 'outside.bin'), 'secret');
        fs.symlinkSync(path.join(directory, 'outside.bin'), path.join(directory, 'model', 'link.bin'));
        for (const uri of ['../outside.bin', '%2e%2e/outside.bin', '/etc/passwd', 'https://example.test/data.bin', 'link.bin', '%252e%252e/outside.bin', 'missing.bin']) {
            expect(await readCoreMeshAsset(model, uri)).toBeNull();
        }
    });
    it('rejects oversized/cancelled glTF assets before sending their bytes', async () => {
        const model = path.join(directory, 'scene.gltf'); fs.writeFileSync(model, '{}');
        const large = path.join(directory, 'large.bin'); fs.writeFileSync(large, ''); fs.truncateSync(large, MAX_MESH_ASSET_BYTES + 1);
        expect(await readCoreMeshAsset(model, 'large.bin')).toBeNull();
        fs.writeFileSync(path.join(directory, 'small.bin'), 'abcd');
        expect(await readCoreMeshAsset(model, 'small.bin', undefined, 3)).toBeNull();
        const controller = new AbortController(); controller.abort();
        expect(await readCoreMeshAsset(model, 'small.bin', controller.signal)).toBeNull();
        await expect(readBoundedPreviewFile(model, 10, controller.signal)).rejects.toThrow('cancelled');
    });
    it('decodes text literally and parses JUnit failures through the published core', () => {
        const text = '\t<svg> literal & text\r\n  spaces  ';
        const result = parseText(new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))).result;
        expect(result.status).toBe('ok');
        if (result.status !== 'failed') expect(result.document).toMatchObject({ text, encoding: 'utf-16le' });
        const report = parseJUnit('<testsuite tests="2"><testcase name="ok"/><testcase name="bad"><failure message="Oops">trace</failure></testcase></testsuite>').result;
        expect(report.status).toBe('ok');
        if (report.status !== 'failed') expect(report.document.cases).toHaveLength(2);
    });
});
