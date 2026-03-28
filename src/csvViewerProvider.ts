import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class CsvViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.csvViewer';

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

        const csvUri = document.uri;
        const csvPath = csvUri.fsPath;
        const csvFileName = path.basename(csvPath);

        try {
            if (await rerouteIfNeeded(csvUri, CsvViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const csvContent = await FileUtils.readCsvFile(csvPath);
            const csvData = JSON.stringify(csvContent);

            const html = await TemplateUtils.loadTemplate(this.context, 'csv/csvViewer.html', {
                fileName: csvFileName,
                csvData: csvData
            });

            webviewPanel.webview.html = html;

            // Setup message listener with document URI for saving
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);

        } catch (error) {
            console.error('Error setting up CSV viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(csvFileName, errorMessage, {
                title: 'Failed to load CSV file',
                message: 'Unable to load the CSV file due to an error:',
                icon: '📊'
            });
        }
    }
}
