import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class ExcelViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.excelViewer';

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
        registerRefreshableViewer(document.uri, ExcelViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const excelUri = document.uri;
        const excelPath = excelUri.fsPath;
        const excelFileName = path.basename(excelPath);

        try {
            if (await rerouteIfNeeded(excelUri, ExcelViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const excelContent = await FileUtils.readExcelFile(excelPath);
            const excelData = JSON.stringify(excelContent);

            const html = await TemplateUtils.loadTemplate(this.context, 'excel/excelViewer.html', {
                fileName: excelFileName,
                excelData: excelData
            });

            webviewPanel.webview.html = html;

            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up Excel viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(excelFileName, errorMessage, {
                title: 'Failed to load Excel file',
                message: 'Unable to load the Excel file due to an error:',
                icon: '📊'
            });
        }
    }
}
