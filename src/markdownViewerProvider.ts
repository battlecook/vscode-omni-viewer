import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileUtils } from './utils/fileUtils';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, replacePanelDisposable, rerouteIfNeeded } from './viewerProviderUtils';

export class MarkdownViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.markdownViewer';

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
        registerRefreshableViewer(document.uri, MarkdownViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const markdownUri = document.uri;
        const markdownPath = markdownUri.fsPath;
        const markdownFileName = path.basename(markdownPath);

        replacePanelDisposable(webviewPanel, 'markdownMessages', webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (!message) {
                return;
            }

            if (message?.type !== 'saveSource' || typeof message.source !== 'string') {
                await MessageHandler.handleWebviewMessage(message, markdownUri, webviewPanel.webview);
                return;
            }

            try {
                await vscode.workspace.fs.writeFile(markdownUri, Buffer.from(message.source, 'utf8'));
                await webviewPanel.webview.postMessage({ type: 'saveSourceResult', ok: true });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                await webviewPanel.webview.postMessage({
                    type: 'saveSourceResult',
                    ok: false,
                    message: errorMessage
                });
            }
        }));

        try {
            if (await rerouteIfNeeded(markdownUri, MarkdownViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const [source, fileSize] = await Promise.all([
                fs.promises.readFile(markdownPath, 'utf8'),
                FileUtils.getFileSize(markdownPath)
            ]);
            const html = await TemplateUtils.loadTemplate(this.context, 'markdown/markdownViewer.html', {
                fileName: markdownFileName,
                fileSize,
                markdownSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source))
            }, webviewPanel.webview);

            webviewPanel.webview.html = html;
        } catch (error) {
            console.error('Error setting up Markdown viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(markdownFileName, errorMessage, {
                title: 'Failed to load Markdown file',
                message: 'Unable to render the Markdown file due to an error:',
                icon: 'MD'
            });
        }
    }
}
