import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler, WebviewMessage } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class ParquetViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.parquetViewer';
    private static readonly PREVIEW_ROW_COUNT = 10000;

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
            const parquetData = TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(parquetContent));
            let loadedRows = parquetContent.totalRows;

            const html = await TemplateUtils.loadTemplate(this.context, 'parquet/parquetViewer.html', {
                fileName: parquetFileName,
                parquetData: parquetData
            });

            webviewPanel.webview.html = html;

            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri, {
                loadMoreParquet: async (_message: WebviewMessage) => {
                    const nextParquetContent = await FileUtils.readParquetFile(parquetPath, {
                        rowStart: loadedRows,
                        rowEnd: loadedRows + ParquetViewerProvider.PREVIEW_ROW_COUNT
                    });

                    loadedRows += nextParquetContent.totalRows;
                    await webviewPanel.webview.postMessage({
                        type: 'appendData',
                        data: nextParquetContent
                    });
                }
            });

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
