import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { createHtmlTemplateVariables } from './utils/htmlTemplate';
import { MAX_HTML_READ_BYTES } from './utils/htmlLimits';
import { TemplateUtils } from './utils/templateUtils';
import {
    configureWebview,
    createReadonlyDocument,
    refreshCancellationToken,
    registerRefreshableViewer,
    renderErrorHtml,
    rerouteIfNeeded
} from './viewerProviderUtils';

async function assertHtmlSize(filePath: string): Promise<void> {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_HTML_READ_BYTES) {
        throw new Error(`The document exceeds the ${MAX_HTML_READ_BYTES / 1024 / 1024} MiB HTML viewer limit.`);
    }
}

export class HtmlViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.htmlViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return createReadonlyDocument(uri);
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        configureWebview(this.context, webviewPanel);
        registerRefreshableViewer(document.uri, HtmlViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        try {
            if (await rerouteIfNeeded(document.uri, HtmlViewerProvider.viewType, webviewPanel)) {
                return;
            }
            await assertHtmlSize(filePath);

            // Register before loading the page so its ready message cannot race
            // the listener. Refresh replaces the previous listener.
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri, {
                htmlReady: () => {
                    // Keep the raw bytes: the core honors BOMs and HTML charset
                    // declarations. Re-read on reload rather than capturing data.
                    void (async () => {
                        await assertHtmlSize(filePath);
                        const data = new Uint8Array(await fs.promises.readFile(filePath));
                        await webviewPanel.webview.postMessage({ type: 'htmlSource', data });
                    })().catch(error => webviewPanel.webview.postMessage({
                        type: 'htmlSourceError',
                        message: error instanceof Error ? error.message : String(error)
                    }));
                }
            });

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(
                this.context,
                'html/htmlViewer.html',
                createHtmlTemplateVariables(fileName, vscode.env.language || 'en', webviewPanel.webview.cspSource),
                webviewPanel.webview
            );
        } catch (error) {
            console.error('Error setting up HTML viewer:', error);
            webviewPanel.webview.html = renderErrorHtml(
                fileName,
                error instanceof Error ? error.message : 'Unknown error occurred',
                { title: 'Failed to load HTML file', message: 'Unable to open the HTML document due to an error:', icon: 'HTML' }
            );
        }
    }
}
