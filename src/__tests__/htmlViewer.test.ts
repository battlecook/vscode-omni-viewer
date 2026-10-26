import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
    env: { language: 'ko' },
    Uri: { file: (filePath: string) => ({ toString: () => filePath }) }
}), { virtual: true });
jest.mock('../viewerProviderUtils', () => ({
    configureWebview: jest.fn(),
    createReadonlyDocument: (uri: unknown) => ({ uri, dispose: jest.fn() }),
    refreshCancellationToken: {},
    registerRefreshableViewer: jest.fn(),
    renderErrorHtml: (_fileName: string, message: string) => message,
    rerouteIfNeeded: jest.fn().mockResolvedValue(false)
}));
jest.mock('../utils/messageHandler', () => ({
    MessageHandler: { setupMessageListener: jest.fn() }
}));

import { HtmlViewerProvider } from '../htmlViewerProvider';
import { MessageHandler } from '../utils/messageHandler';
import { createHtmlTemplateVariables } from '../utils/htmlTemplate';
import { MAX_HTML_READ_BYTES } from '../utils/htmlLimits';
import { registerRefreshableViewer } from '../viewerProviderUtils';

describe('HTML viewer', () => {
    let tempDir: string;
    let filePath: string;
    const postMessage = jest.fn().mockResolvedValue(true);

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-html-'));
        filePath = path.join(tempDir, 'page.html');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function openViewer() {
        const provider = new HtmlViewerProvider({ extensionPath: path.resolve(__dirname, '../..') } as never);
        const document = { uri: { fsPath: filePath } };
        const panel = { webview: {
            html: '', cspSource: 'https://webview.test', postMessage,
            asWebviewUri: (uri: unknown) => uri
        } };
        await provider.resolveCustomEditor(document as never, panel as never, {} as never);
        return panel;
    }

    async function requestSource() {
        const calls = jest.mocked(MessageHandler.setupMessageListener).mock.calls;
        const handlers = calls[calls.length - 1][2]!;
        handlers.htmlReady({ command: 'htmlReady' });
        // The host read and postMessage are asynchronous; wait for the reply.
        for (let attempt = 0; attempt < 100 && !postMessage.mock.calls.length; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        expect(postMessage).toHaveBeenCalledTimes(1);
        return postMessage.mock.calls[0][0];
    }

    it('loads the shell, preserves encoded bytes, and reads fresh data on reload', async () => {
        const data = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<h1>안녕하세요</h1>', 'utf16le')]);
        fs.writeFileSync(filePath, data);
        const panel = await openViewer();

        expect(panel.webview.html).toContain('id="html-root"');
        expect(panel.webview.html).toContain('frame-src \'self\'');
        expect(panel.webview.html).not.toContain('{{');
        expect(panel.webview.html).toContain('data-omni-action="share"');
        expect(registerRefreshableViewer).toHaveBeenCalledWith(
            expect.anything(), HtmlViewerProvider.viewType, panel, expect.any(Function)
        );
        expect(await requestSource()).toEqual({ type: 'htmlSource', data: new Uint8Array(data) });

        postMessage.mockClear();
        fs.writeFileSync(filePath, '<p>Changed</p>');
        expect(await requestSource()).toEqual({
            type: 'htmlSource', data: new Uint8Array(Buffer.from('<p>Changed</p>'))
        });
    });

    it('reports a file removed after the shell loads', async () => {
        fs.writeFileSync(filePath, '<p>hello</p>');
        await openViewer();
        fs.unlinkSync(filePath);

        expect(await requestSource()).toMatchObject({ type: 'htmlSourceError', message: expect.stringContaining('ENOENT') });
    });

    it('checks the host read limit again when the webview reloads', async () => {
        fs.writeFileSync(filePath, '<p>hello</p>');
        await openViewer();
        fs.truncateSync(filePath, MAX_HTML_READ_BYTES + 1);

        expect(await requestSource()).toEqual({
            type: 'htmlSourceError', message: 'The document exceeds the 64 MiB HTML viewer limit.'
        });
    });

    it('escapes shell metadata independently of the HTML document', () => {
        const fileName = '</script><img src=x onerror=alert(1)>.html';
        const variables = createHtmlTemplateVariables(fileName, 'ko', 'https://webview.test', 'testnonce');

        expect(variables.fileName).not.toContain('<');
        expect(variables.htmlData).not.toContain('</script>');
        expect(JSON.parse(variables.htmlData)).toEqual({ fileName, locale: 'ko' });
    });
});
