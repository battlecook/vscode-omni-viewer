import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockParseHar = jest.fn();
jest.mock('omni-viewer-core/parsers/har', () => ({
    parseHar: mockParseHar
}), { virtual: true });

import { MAX_HAR_READ_BYTES, readHarDocument } from '../utils/harModel';
import { createHarTemplateVariables } from '../utils/harTemplate';

/** A two-request archive: a JSON API call that failed with a 500, and a
 *  stylesheet that never got a response (status 0, the shape of a blocked or
 *  aborted request). */
function sampleHar(): string {
    return JSON.stringify({
        log: {
            version: '1.2',
            creator: { name: 'WebInspector', version: '537.36' },
            pages: [],
            entries: [
                {
                    startedDateTime: '2026-10-09T01:02:03.000Z',
                    time: 120,
                    request: {
                        method: 'POST',
                        url: 'https://API.example.com/v1/orders?id=7',
                        httpVersion: 'HTTP/2',
                        headers: [{ name: 'content-type', value: 'application/json' }],
                        queryString: [{ name: 'id', value: '7' }],
                        cookies: [],
                        headersSize: -1,
                        bodySize: 13,
                        postData: { mimeType: 'application/json', text: '{"qty":1}' }
                    },
                    response: {
                        status: 500,
                        statusText: 'Internal Server Error',
                        httpVersion: 'HTTP/2',
                        headers: [],
                        cookies: [],
                        content: { size: 18, mimeType: 'application/json', text: '{"error":"boom"}' },
                        redirectURL: '',
                        headersSize: -1,
                        bodySize: 18
                    },
                    cache: {},
                    timings: { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 1, wait: 110, receive: 8 }
                },
                {
                    startedDateTime: '2026-10-09T01:02:03.050Z',
                    time: -1,
                    request: {
                        method: 'GET',
                        url: 'https://cdn.example.com/site.css',
                        httpVersion: '',
                        headers: [],
                        queryString: [],
                        cookies: [],
                        headersSize: -1,
                        bodySize: 0
                    },
                    response: {
                        status: 0,
                        statusText: '',
                        httpVersion: '',
                        headers: [],
                        cookies: [],
                        content: { size: 0, mimeType: 'text/css' },
                        redirectURL: '',
                        headersSize: -1,
                        bodySize: -1,
                        _error: 'net::ERR_BLOCKED_BY_CLIENT'
                    },
                    cache: {},
                    timings: { send: 0, wait: 0, receive: 0 }
                }
            ]
        }
    });
}

describe('HAR model reader', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-viewer-har-'));
        mockParseHar.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('reads the archive bytes and returns the core parse result', async () => {
        const filePath = path.join(tempDir, 'session.har');
        const text = sampleHar();
        const result = { status: 'ok', document: { entries: [] }, diagnostics: [] };
        fs.writeFileSync(filePath, text);
        mockParseHar.mockReturnValue({ result, execution: {} });

        await expect(readHarDocument(filePath)).resolves.toBe(result);
        expect(mockParseHar).toHaveBeenCalledTimes(1);
        expect(Buffer.from(mockParseHar.mock.calls[0][0]).toString('utf8')).toBe(text);
        expect(mockParseHar.mock.calls[0][1]).toMatchObject({
            limits: { maxInputBytes: MAX_HAR_READ_BYTES }
        });
    });

    it('rejects archives beyond the extension-host memory budget before reading', async () => {
        const filePath = path.join(tempDir, 'large.har');
        fs.writeFileSync(filePath, Buffer.alloc(1));
        fs.truncateSync(filePath, MAX_HAR_READ_BYTES + 1);

        await expect(readHarDocument(filePath)).rejects.toThrow('100MB in-memory HAR inspection limit');
        expect(mockParseHar).not.toHaveBeenCalled();
    });

    it('honors an already-aborted read signal', async () => {
        const filePath = path.join(tempDir, 'cancelled.har');
        fs.writeFileSync(filePath, sampleHar());
        const abort = new AbortController();
        abort.abort();

        await expect(readHarDocument(filePath, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockParseHar).not.toHaveBeenCalled();
    });

    it('parses an archive with the installed core package', () => {
        const encoded = Buffer.from(sampleHar(), 'utf8').toString('base64');
        const script = [
            "import { parseHar } from 'omni-viewer-core/parsers/har';",
            `const { result } = parseHar(new Uint8Array(Buffer.from('${encoded}', 'base64')));`,
            'const doc = result.document;',
            'process.stdout.write(JSON.stringify({',
            '  status: result.status,',
            '  version: doc.version,',
            '  hosts: doc.hosts,',
            '  errorCount: doc.errorCount,',
            '  entries: doc.entries.map(entry => [entry.method, entry.host, entry.status, entry.statusClass, entry.resourceType, entry.error])',
            '}));'
        ].join('\n');

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve(__dirname, '../..'),
            encoding: 'utf8'
        });

        const parsed = JSON.parse(output);
        expect(parsed.status).toBe('ok');
        expect(parsed.version).toBe('1.2');
        expect(parsed.hosts).toEqual(expect.arrayContaining(['api.example.com', 'cdn.example.com']));
        expect(parsed.errorCount).toBeGreaterThanOrEqual(1);
        expect(parsed.entries[0].slice(0, 4)).toEqual(['POST', 'api.example.com', 500, '5xx']);
        expect(parsed.entries[1]).toEqual(['GET', 'cdn.example.com', 0, 'none', 'stylesheet', 'net::ERR_BLOCKED_BY_CLIENT']);
    });

    it('ships matching template, entry, and generated browser bundle paths', () => {
        const templateRoot = path.resolve(__dirname, '../templates/har');
        const html = fs.readFileSync(path.join(templateRoot, 'harViewer.html'), 'utf8');
        const entry = fs.readFileSync(path.join(templateRoot, 'js/harViewerMain.js'), 'utf8');

        expect(html).toContain('{{harData}}');
        expect(html).toContain('js/harViewer.js');
        expect(html).toContain('id="har-data"');
        expect(html).toContain('id="har-root"');
        expect(entry).toContain("from 'omni-viewer-core/viewers/har'");
        expect(entry).toContain('mountHarDocument');
        expect(entry).toContain("getElementById('har-data')");
        expect(entry).toContain("getElementById('har-root')");
        // A failed parse keeps the diagnostic's location (`@<offset>`).
        expect(entry).toContain('diagnostic.location');
        expect(fs.statSync(path.join(templateRoot, 'js/harViewer.js')).size).toBeGreaterThan(0);
    });

    it('escapes an attacker-controlled filename in the successful webview', () => {
        const fileName = '</title><script>alert(1)</script>.har';
        const variables = createHarTemplateVariables(
            fileName,
            'en',
            { status: 'ok', document: {}, diagnostics: [] },
            'vscode-webview://test',
            'fixed-nonce'
        );
        const templatePath = path.resolve(__dirname, '../templates/har/harViewer.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const [key, value] of Object.entries(variables)) {
            html = html.split(`{{${key}}}`).join(value);
        }

        expect(html).not.toContain('</title><script>alert(1)</script>');
        expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;.har');
        expect(html).toContain("script-src 'nonce-fixed-nonce'");
        expect(JSON.parse(variables.harData).fileName).toBe(fileName);
    });

    it('keeps an archive body from closing the data script tag', () => {
        const variables = createHarTemplateVariables(
            '<session>.har',
            'ko',
            { status: 'ok', document: { body: '</script><script>alert(1)</script>' }, diagnostics: [] },
            'vscode-resource:',
            'nonce'
        );

        expect(variables.fileName).toBe('&lt;session&gt;.har');
        expect(variables.harData).not.toContain('</script>');
        expect(JSON.parse(variables.harData)).toMatchObject({
            fileName: '<session>.har',
            locale: 'ko',
            result: { document: { body: '</script><script>alert(1)</script>' } }
        });
    });
});
