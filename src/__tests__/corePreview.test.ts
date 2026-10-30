import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import * as vscode from 'vscode';
import { tableFromArrays, tableToIPC } from 'apache-arrow';

jest.mock('vscode', () => ({
    env: { language: 'ko', clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } },
    window: { showSaveDialog: jest.fn() },
    workspace: { fs: { writeFile: jest.fn().mockResolvedValue(undefined) } },
    Uri: { file: (fsPath: string) => ({ fsPath, toString: () => fsPath }) }
}), { virtual: true });
jest.mock('../viewerProviderUtils', () => ({
    configureWebview: jest.fn(),
    createReadonlyDocument: (uri: unknown) => ({ uri, dispose: jest.fn() }),
    refreshCancellationToken: {},
    registerRefreshableViewer: jest.fn(),
    replacePanelDisposable: jest.fn(),
    renderErrorHtml: (_fileName: string, message: string) => message,
    rerouteIfNeeded: jest.fn().mockResolvedValue(false)
}));
jest.mock('../utils/messageHandler', () => ({ MessageHandler: { setupMessageListener: jest.fn().mockReturnValue({ dispose: jest.fn() }) } }));

import { CorePreviewProvider } from '../corePreviewProvider';
import { MessageHandler } from '../utils/messageHandler';
import { replacePanelDisposable } from '../viewerProviderUtils';
import { CorePreviewKind, CORE_PREVIEW_VIEWERS, createCorePreviewVariables, readCorePreview } from '../utils/corePreview';
import { detectCorePreview } from '../utils/corePreviewDetection';
import { WebviewMessage } from '../utils/messageHandlers/types';

describe('Core preview detection', () => {
    it.each(['ttf', 'otf', 'woff', 'arrow', 'feather', 'geojson'])('routes empty or malformed .%s files to their diagnostic viewer', extension => {
        const kind = ['ttf', 'otf', 'woff'].includes(extension) ? 'font' : extension === 'feather' ? 'arrow' : extension;
        expect(detectCorePreview(Buffer.alloc(0), `.${extension}`)?.viewType).toBe(`omni-viewer.${kind}Viewer`);
    });
    it.each([0x00010000, 0x4f54544f, 0x74727565, 0x774f4646])('detects a font from its binary header and table directory (%s)', signature => {
        const woff = signature === 0x774f4646;
        const header = woff ? 44 : 12;
        const data = Buffer.alloc(header + (woff ? 20 : 16));
        data.writeUInt32BE(signature, 0);
        if (woff) { data.writeUInt32BE(0x00010000, 4); data.writeUInt32BE(data.length, 8); }
        data.writeUInt16BE(1, woff ? 12 : 4);
        data.write('head', header);
        data.writeUInt32BE(data.length, header + (woff ? 4 : 8));
        expect(detectCorePreview(data, '.dat')).toMatchObject({ viewType: 'omni-viewer.fontViewer', matchedBySignature: true });
    });
    it.each(['true', 'true_value = 1', 'true story', 'OTTO is a name', 'wOFFsets'])('does not mistake ordinary text for an sfnt header (%s)', source => {
        expect(detectCorePreview(Buffer.from(source), '', true)).toBeNull();
    });
    it.each(['file', 'stream'] as const)('detects actual Arrow IPC %s bytes without an extension', format => {
        const data = Buffer.from(tableToIPC(tableFromArrays({ id: [3, 1, 2] }), format));
        expect(detectCorePreview(data, '')).toMatchObject({ viewType: 'omni-viewer.arrowViewer', matchedBySignature: true });
    });
    it('does not mistake an arbitrary continuation marker for an Arrow schema', () => {
        const data = Buffer.alloc(128, 0xff);
        expect(detectCorePreview(data, '')).toBeNull();
    });
    it('recognizes GeoJSON only at the top level and keeps JSONL with its own viewer', () => {
        const data = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [] }));
        expect(detectCorePreview(data, '.json')?.viewType).toBe('omni-viewer.geojsonViewer');
        expect(detectCorePreview(data, '')?.viewType).toBe('omni-viewer.geojsonViewer');
        expect(detectCorePreview(data, '.jsonl')).toBeNull();
        expect(detectCorePreview(Buffer.from(JSON.stringify({ nested: JSON.parse(data.toString()) })), '.json')).toBeNull();
        expect(detectCorePreview(Buffer.from('{"type":"Point","label":"example"}'), '.json')).toBeNull();
        expect(detectCorePreview(Buffer.from('{"type":"Feature","geometry":[],"properties":[]}'), '.json')).toBeNull();
    });
});

describe('Core preview host', () => {
    let tempDir: string;
    let filePath: string;
    const postMessage = jest.fn().mockResolvedValue(true);

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-preview-'));
        filePath = path.join(tempDir, 'sample.feather');
        fs.writeFileSync(filePath, Buffer.from([0, 1, 0, 0]));
    });
    afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

    async function open(kind: CorePreviewKind = 'arrow', cancelled = false) {
        const uri = vscode.Uri.file(filePath);
        const panel = { webview: { html: '', cspSource: 'https://webview.test', postMessage, asWebviewUri: (value: unknown) => value } };
        const provider = new CorePreviewProvider({ extensionPath: path.resolve(__dirname, '../..') } as never, kind);
        await provider.resolveCustomEditor({ uri } as never, panel as never, { isCancellationRequested: cancelled } as never);
        const calls = jest.mocked(MessageHandler.setupMessageListener).mock.calls;
        return { panel, handlers: calls.at(-1)?.[2] };
    }
    async function send(handlers: NonNullable<Awaited<ReturnType<typeof open>>['handlers']>, type: string, payload: Partial<WebviewMessage> = {}) {
        postMessage.mockClear();
        handlers[type]({ command: type, type, requestId: 'request-1', ...payload });
        for (let i = 0; i < 100 && !postMessage.mock.calls.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
        expect(postMessage).toHaveBeenCalledTimes(1);
        return postMessage.mock.calls[0][0];
    }

    it.each(['font', 'arrow', 'geojson'] as const)('loads the %s bundle and raw bytes, rereading after reload', async kind => {
        const { panel, handlers } = await open(kind);
        expect(panel.webview.html).toContain(`${kind}Viewer.js`);
        expect(panel.webview.html).toContain('font-src blob: data:');
        expect(panel.webview.html).toContain('data-omni-action="share"');
        expect(panel.webview.html).not.toContain('{{');
        const metadata = /id="preview-data"[^>]*>([\s\S]*?)<\/script>/.exec(panel.webview.html)![1];
        expect(JSON.parse(metadata)).toMatchObject({ locale: 'ko', maxBytes: CORE_PREVIEW_VIEWERS[kind].maxBytes });
        expect(await send(handlers!, 'corePreviewReady')).toEqual({ type: 'corePreviewSource', data: new Uint8Array([0, 1, 0, 0]) });
        fs.writeFileSync(filePath, 'fresh data');
        expect(await send(handlers!, 'corePreviewReady')).toEqual({ type: 'corePreviewSource', data: new Uint8Array(Buffer.from('fresh data')) });
    });
    it.each(['font', 'arrow', 'geojson'] as const)('rejects oversized %s files both on open and reload', async kind => {
        const { handlers } = await open(kind);
        fs.truncateSync(filePath, CORE_PREVIEW_VIEWERS[kind].maxBytes + 1);
        expect(await send(handlers!, 'corePreviewReady')).toMatchObject({ type: 'corePreviewError', message: expect.stringContaining('viewer limit') });
        expect((await open(kind)).panel.webview.html).toContain('viewer limit');
    });
    it('reports a file removed after the webview loads', async () => {
        const { handlers } = await open();
        fs.unlinkSync(filePath);
        expect(await send(handlers!, 'corePreviewReady')).toMatchObject({ type: 'corePreviewError', message: expect.stringContaining('ENOENT') });
    });
    it('does not install a source listener for an already cancelled open', async () => {
        await open('font', true);
        expect(MessageHandler.setupMessageListener).not.toHaveBeenCalled();
    });
    it('suppresses messages from a disposed session', async () => {
        const { handlers } = await open();
        const disposables = jest.mocked(replacePanelDisposable).mock.calls;
        disposables.find(call => call[1] === 'corePreviewSession')![2].dispose();
        handlers!.corePreviewReady({ command: 'corePreviewReady' });
        expect(postMessage).not.toHaveBeenCalled();
    });
    it('copies Arrow text through the host clipboard and rejects oversized requests', async () => {
        const { handlers } = await open();
        expect(await send(handlers!, 'corePreviewClipboard', { text: 'id\tname\n1\talpha' })).toMatchObject({ ok: true });
        expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('id\tname\n1\talpha');
        expect(await send(handlers!, 'corePreviewClipboard', { text: 'x'.repeat(16 * 1024 * 1024 + 1) })).toMatchObject({ ok: false });
        expect(vscode.env.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    it('exports JSON to a selected path, reports cancellation, and protects the source', async () => {
        const { handlers } = await open();
        const target = vscode.Uri.file(path.join(tempDir, 'chosen.json'));
        jest.mocked(vscode.window.showSaveDialog).mockResolvedValueOnce(target);
        expect(await send(handlers!, 'corePreviewSave', { content: '[[1]]', name: '../../ignored.json' })).toMatchObject({ ok: true, result: { status: 'saved', fileName: 'chosen.json' } });
        expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(target, Buffer.from('[[1]]'));
        expect(vscode.window.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultUri: expect.objectContaining({ fsPath: path.join(tempDir, 'sample-export.json') }) }));
        jest.mocked(vscode.window.showSaveDialog).mockResolvedValueOnce(undefined);
        expect(await send(handlers!, 'corePreviewSave', { content: '[]' })).toMatchObject({ ok: true, result: { status: 'cancelled' } });
        jest.mocked(vscode.window.showSaveDialog).mockResolvedValueOnce(vscode.Uri.file(filePath));
        expect(await send(handlers!, 'corePreviewSave', { content: '[]' })).toMatchObject({ ok: false });
        expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    });
    it('saves deeply nested Arrow JSON above the parser preview budget', async () => {
        const { handlers } = await open();
        const output = JSON.stringify({ rows: Array.from({ length: 10000 }, () => {
            let value: unknown = 0;
            for (let depth = 0; depth < 40; depth++) value = [value];
            return [value];
        }) }, null, 2);
        expect(Buffer.byteLength(output)).toBeGreaterThan(16 * 1024 * 1024);
        const target = vscode.Uri.file(path.join(tempDir, 'nested.json'));
        jest.mocked(vscode.window.showSaveDialog).mockResolvedValueOnce(target);
        expect(await send(handlers!, 'corePreviewSave', { content: output })).toMatchObject({ ok: true, result: { status: 'saved' } });
        const [savedTarget, savedBytes] = jest.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
        expect(savedTarget).toBe(target);
        expect(Buffer.from(savedBytes).equals(Buffer.from(output))).toBe(true);
    });
    it('bounds a file that grows during the read and closes its handle on failure', async () => {
        const close = jest.fn().mockResolvedValue(undefined);
        const read = jest.fn().mockImplementation(async (buffer: Buffer) => {
            expect(buffer.length).toBe(5);
            return { bytesRead: 5 };
        });
        const open = jest.spyOn(fs.promises, 'open').mockResolvedValue({ stat: async () => ({ size: 4 }), read, close } as never);
        try {
            await expect(readCorePreview(filePath, 'font')).rejects.toThrow('file changed');
            expect(read).toHaveBeenCalledTimes(1);
            expect(close).toHaveBeenCalledTimes(1);
        } finally { open.mockRestore(); }
    });
    it('escapes the filename, configuration and script URL', () => {
        const fileName = '</script><img src=x onerror=alert(1)>.ttf';
        const variables = createCorePreviewVariables(fileName, 'ko', '" onerror="oops', '" onerror="oops', 'font');
        expect(variables.fileName).not.toContain('<');
        expect(variables.viewerScriptUri).not.toContain('"');
        expect(variables.previewData).not.toContain('</script>');
        expect(JSON.parse(variables.previewData).fileName).toBe(fileName);
    });
});

describe('Core preview webview bridge', () => {
    function start(arrow = false) {
        const events: Record<string, (event: { data?: unknown }) => void> = {};
        const root = { append: jest.fn(), shadowRoot: null };
        const postMessage = jest.fn();
        const dispose = jest.fn();
        const mount = jest.fn().mockResolvedValue({ dispose });
        const source = fs.readFileSync(path.resolve(__dirname, '../templates/corePreview/js/corePreviewMain.js'), 'utf8')
            .replace(/^import .*;\n/, '').replace('export function', 'function');
        vm.runInNewContext(`${source}\nstartCorePreview(mount, arrow);`, {
            mount, arrow, AbortController, Uint8Array, TextDecoder, console,
            createCatalogI18n: jest.fn(),
            document: { getElementById: (id: string) => id === 'preview-root' ? root : { textContent: JSON.stringify({ fileName: 'sample.arrow', locale: 'ko', maxBytes: 256 }) },
                createElement: () => ({ setAttribute: jest.fn() }) },
            window: { __omniVsCode__: { postMessage }, addEventListener: (name: string, fn: typeof events[string]) => { events[name] = fn; }, removeEventListener: jest.fn() }
        });
        return { events, postMessage, mount, dispose };
    }
    it('mounts once with an abort signal and disposes the core viewer on unload', async () => {
        const { events, postMessage, mount, dispose } = start();
        expect(postMessage).toHaveBeenCalledWith({ type: 'corePreviewReady' });
        events.message({ data: { type: 'corePreviewSource', data: new Uint8Array([1, 2]) } });
        events.message({ data: { type: 'corePreviewSource', data: new Uint8Array([3]) } });
        await new Promise(resolve => setImmediate(resolve));
        expect(mount).toHaveBeenCalledTimes(1);
        const options = mount.mock.calls[0][3];
        expect(options).toMatchObject({ styleIsolation: 'shadow', limits: { maxInputBytes: 256 } });
        events.unload({});
        expect(options.signal.aborted).toBe(true);
        expect(dispose).toHaveBeenCalledTimes(1);
    });
    it('correlates Arrow host replies and passes the parser input budget', async () => {
        const { events, postMessage, mount } = start(true);
        events.message({ data: { type: 'corePreviewSource', data: new Uint8Array([1]) } });
        await new Promise(resolve => setImmediate(resolve));
        const ctx = mount.mock.calls[0][2];
        expect(mount.mock.calls[0][3].parse.limits.maxInputBytes).toBe(256);
        const copied = ctx.clipboard.writeText('hello');
        const request = postMessage.mock.calls.at(-1)![0];
        expect(request).toMatchObject({ type: 'corePreviewClipboard', text: 'hello' });
        events.message({ data: { type: 'corePreviewResponse', requestId: request.requestId, ok: true } });
        await expect(copied).resolves.toBeUndefined();
        const saved = ctx.save.saveFile('ignored.json', new Uint8Array(Buffer.from('[]')));
        const saveRequest = postMessage.mock.calls.at(-1)![0];
        events.message({ data: { type: 'corePreviewResponse', requestId: saveRequest.requestId, ok: true, result: { status: 'cancelled' } } });
        await expect(saved).resolves.toEqual({ status: 'cancelled' });
    });
});
