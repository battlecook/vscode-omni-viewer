import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class ParquetViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.parquetViewer';

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

        const parquetUri = document.uri;
        const parquetPath = parquetUri.fsPath;
        const parquetFileName = path.basename(parquetPath);

        try {
            if (await rerouteIfNeeded(parquetUri, ParquetViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const parquetContent = await FileUtils.readParquetFile(parquetPath);
            const parquetData = JSON.stringify(parquetContent);

            const html = await TemplateUtils.loadTemplate(this.context, 'parquet/parquetViewer.html', {
                fileName: parquetFileName,
                parquetData: parquetData
            });

            webviewPanel.webview.html = html;

            // Setup message listener with document URI for saving
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);

        } catch (error) {
            console.error('Error setting up Parquet viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(parquetFileName, errorMessage, {
                title: 'Failed to load Parquet file',
                message: 'Unable to load the Parquet file due to an error:',
                icon: '📊'
            });
        }
    }
}
