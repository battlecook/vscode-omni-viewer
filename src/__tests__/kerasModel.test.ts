import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockParseKeras = jest.fn();
jest.mock('omni-viewer-core/parsers/keras', () => ({
    parseKeras: mockParseKeras
}), { virtual: true });

import { MAX_KERAS_READ_BYTES, readKerasDocument } from '../utils/kerasModel';
import { createKerasTemplateVariables } from '../utils/kerasTemplate';

/** A stored-member ZIP holding the two JSON members a `.keras` archive carries. */
function minimalKerasArchive(): Buffer {
    const members: Array<{ name: string; content: Buffer }> = [
        { name: 'metadata.json', content: Buffer.from('{"keras_version":"3.5.0"}', 'utf8') },
        { name: 'config.json', content: Buffer.from('{"class_name":"Sequential","config":{"name":"sequential","layers":[]}}', 'utf8') }
    ];

    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    for (const member of members) {
        const name = Buffer.from(member.name, 'ascii');
        const crc = crc32(member.content);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 8); // stored
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(member.content.length, 18);
        local.writeUInt32LE(member.content.length, 22);
        local.writeUInt16LE(name.length, 26);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 10); // stored
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(member.content.length, 20);
        central.writeUInt32LE(member.content.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);

        locals.push(local, name, member.content);
        centrals.push(central, name);
        offset += local.length + name.length + member.content.length;
    }

    const centralDirectory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(members.length, 8);
    end.writeUInt16LE(members.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...locals, centralDirectory, end]);
}

function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

describe('Keras model integration', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-keras-'));
        mockParseKeras.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('reads the model bytes and passes them to the core parser with the file name', async () => {
        const filePath = path.join(tempDir, 'model.keras');
        const bytes = minimalKerasArchive();
        const parsed = { format: 'Keras v3', modelClass: 'Sequential' };
        fs.writeFileSync(filePath, bytes);
        mockParseKeras.mockResolvedValue(parsed);

        await expect(readKerasDocument(filePath)).resolves.toBe(parsed);
        expect(mockParseKeras).toHaveBeenCalledTimes(1);
        expect(Buffer.from(mockParseKeras.mock.calls[0][0])).toEqual(bytes);
        expect(mockParseKeras.mock.calls[0][1]).toBe('model.keras');
    });

    it('rejects files beyond the extension-host memory budget before reading', async () => {
        const filePath = path.join(tempDir, 'large.keras');
        fs.writeFileSync(filePath, Buffer.alloc(1));
        fs.truncateSync(filePath, MAX_KERAS_READ_BYTES + 1);

        await expect(readKerasDocument(filePath)).rejects.toThrow('512MB in-memory Keras inspection limit');
        expect(mockParseKeras).not.toHaveBeenCalled();
    });

    it('honors an already-aborted read signal', async () => {
        const filePath = path.join(tempDir, 'cancelled.keras');
        fs.writeFileSync(filePath, minimalKerasArchive());
        const abort = new AbortController();
        abort.abort();

        await expect(readKerasDocument(filePath, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockParseKeras).not.toHaveBeenCalled();
    });

    it('parses a minimal archive with the installed core package', () => {
        const hex = minimalKerasArchive().toString('hex');
        const script = [
            "import { parseKeras } from 'omni-viewer-core/parsers/keras';",
            `const model = await parseKeras(new Uint8Array(Buffer.from('${hex}', 'hex')), 'model.keras');`,
            "process.stdout.write(JSON.stringify({ format: model.format, modelClass: model.modelClass, kerasVersion: model.kerasVersion, files: model.files.map(file => file.name) }));"
        ].join('\n');

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve(__dirname, '../..'),
            encoding: 'utf8'
        });

        expect(JSON.parse(output)).toEqual({
            format: 'Keras v3',
            modelClass: 'Sequential',
            kerasVersion: '3.5.0',
            files: ['metadata.json', 'config.json']
        });
    });

    it('ships matching template, entry, and generated browser bundle paths', () => {
        const templateRoot = path.resolve(__dirname, '../templates/keras');
        const html = fs.readFileSync(path.join(templateRoot, 'kerasViewer.html'), 'utf8');
        const entry = fs.readFileSync(path.join(templateRoot, 'js/kerasViewerMain.js'), 'utf8');

        expect(html).toContain('{{kerasData}}');
        expect(html).toContain('js/kerasViewer.js');
        expect(entry).toContain('mountKerasDocument');
        expect(fs.statSync(path.join(templateRoot, 'js/kerasViewer.js')).size).toBeGreaterThan(0);
    });

    it('escapes an attacker-controlled filename in the successful webview', () => {
        const fileName = '</title><script>alert(1)</script>.keras';
        const variables = createKerasTemplateVariables(
            fileName,
            'en',
            { format: 'Keras v3' },
            'vscode-webview://test',
            'fixed-nonce'
        );
        const templatePath = path.resolve(__dirname, '../templates/keras/kerasViewer.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const [key, value] of Object.entries(variables)) {
            html = html.split(`{{${key}}}`).join(value);
        }

        expect(html).not.toContain('</title><script>alert(1)</script>');
        expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;.keras');
        expect(html).toContain("script-src 'nonce-fixed-nonce'");
        expect(JSON.parse(variables.kerasData).fileName).toBe(fileName);
    });
});
