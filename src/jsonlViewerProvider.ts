import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class JsonlViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.jsonlViewer';

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

        const jsonlUri = document.uri;
        const jsonlPath = jsonlUri.fsPath;
        const jsonlFileName = path.basename(jsonlPath);

        try {
            if (await rerouteIfNeeded(jsonlUri, JsonlViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const jsonlContent = await FileUtils.readJsonlFile(jsonlPath);
            const html = await TemplateUtils.loadTemplate(this.context, 'jsonl/jsonlViewer.html', {
                fileName: jsonlFileName,
                jsonlData: JSON.stringify(jsonlContent)
            });

            webviewPanel.webview.html = html;
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up JSONL viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(jsonlFileName, errorMessage, {
                title: 'Failed to load JSONL file',
                message: 'Unable to load the JSONL file due to an error:',
                icon: '📄'
            });
        }
    }
}
