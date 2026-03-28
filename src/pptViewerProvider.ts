import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class PptViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.pptViewer';

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

        const pptUri = document.uri;
        const pptPath = pptUri.fsPath;
        const pptFileName = path.basename(pptPath);

        try {
            if (await rerouteIfNeeded(pptUri, PptViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const pptContent = await FileUtils.readPresentationFile(pptPath);
            const pdfJsScriptUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'pdfjs-dist', 'build', 'pdf.min.js'))
            );
            const pdfJsWorkerUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.js'))
            );

            const html = await TemplateUtils.loadTemplate(this.context, 'ppt/pptViewer.html', {
                fileName: pptFileName,
                fileSize: pptContent.fileSize,
                totalSlides: String(pptContent.totalSlides),
                presentationData: JSON.stringify(pptContent),
                pdfJsScriptUri: pdfJsScriptUri.toString(),
                pdfJsWorkerUri: pdfJsWorkerUri.toString()
            });

            webviewPanel.webview.html = html;
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up PPT viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(pptFileName, errorMessage, {
                title: 'Failed to load PowerPoint file',
                message: 'Unable to parse and render the file:',
                icon: '📽️'
            });
        }
    }
}
