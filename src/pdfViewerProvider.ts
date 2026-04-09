import * as vscode from 'vscode';
import * as path from 'path';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class PdfViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.pdfViewer';

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

        const pdfUri = document.uri;
        const pdfPath = pdfUri.fsPath;
        const pdfFileName = path.basename(pdfPath);

        try {
            if (await rerouteIfNeeded(pdfUri, PdfViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const pdfBytes = await vscode.workspace.fs.readFile(pdfUri);
            const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
            const pdfJsScriptUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'pdfjs-dist', 'build', 'pdf.min.mjs'))
            );
            const pdfJsWorkerUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'))
            );

            const html = await TemplateUtils.loadTemplate(this.context, 'pdf/pdfViewer.html', {
                fileName: pdfFileName,
                pdfBase64: pdfBase64,
                pdfJsScriptUri: pdfJsScriptUri.toString(),
                pdfJsWorkerUri: pdfJsWorkerUri.toString()
            });

            webviewPanel.webview.html = html;

            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up PDF viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(pdfFileName, errorMessage, {
                title: 'Failed to load PDF file',
                message: 'Unable to load the PDF file due to an error:',
                icon: '📄'
            });
        }
    }
}
