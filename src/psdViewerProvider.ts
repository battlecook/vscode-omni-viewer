import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class PsdViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.psdViewer';

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
        registerRefreshableViewer(document.uri, PsdViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const psdUri = document.uri;
        const psdPath = psdUri.fsPath;
        const fileName = path.basename(psdPath);

        try {
            if (await rerouteIfNeeded(psdUri, PsdViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const buffer = await fs.promises.readFile(psdPath);
            const psdBase64 = buffer.toString('base64');
            const fileSize = await FileUtils.getFileSize(psdPath);

            const agPsdScriptUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'ag-psd', 'dist', 'bundle.js'))
            );

            const html = await TemplateUtils.loadTemplate(this.context, 'psd/psdViewer.html', {
                fileName,
                psdBase64,
                fileSize,
                agPsdScriptUri: agPsdScriptUri.toString()
            });

            webviewPanel.webview.html = html;

            MessageHandler.setupMessageListener(webviewPanel.webview);
        } catch (error) {
            console.error('Error setting up PSD viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, errorMessage, {
                title: 'Failed to load PSD file',
                message: 'Unable to load the PSD file due to an error:',
                icon: '🖼️'
            });
        }
    }
}
