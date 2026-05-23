import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileUtils } from './utils/fileUtils';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, replacePanelDisposable, rerouteIfNeeded } from './viewerProviderUtils';

export class MermaidViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.mermaidViewer';

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
        registerRefreshableViewer(document.uri, MermaidViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const mermaidUri = document.uri;
        const mermaidPath = mermaidUri.fsPath;
        const mermaidFileName = path.basename(mermaidPath);

        replacePanelDisposable(webviewPanel, 'mermaidMessages', webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (!message) {
                return;
            }

            if (message?.type !== 'saveSource' || typeof message.source !== 'string') {
                await MessageHandler.handleWebviewMessage(message, mermaidUri, webviewPanel.webview);
                return;
            }

            try {
                await vscode.workspace.fs.writeFile(mermaidUri, Buffer.from(message.source, 'utf8'));
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
            if (await rerouteIfNeeded(mermaidUri, MermaidViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const [source, fileSize] = await Promise.all([
                fs.promises.readFile(mermaidPath, 'utf8'),
                FileUtils.getFileSize(mermaidPath)
            ]);
            const html = await TemplateUtils.loadTemplate(this.context, 'mermaid/mermaidViewer.html', {
                fileName: mermaidFileName,
                fileSize,
                mermaidSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source))
            }, webviewPanel.webview);

            webviewPanel.webview.html = html;
        } catch (error) {
            console.error('Error setting up Mermaid viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(mermaidFileName, errorMessage, {
                title: 'Failed to load Mermaid file',
                message: 'Unable to render the Mermaid diagram due to an error:',
                icon: 'M'
            });
        }
    }
}
