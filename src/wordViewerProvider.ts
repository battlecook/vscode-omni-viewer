import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class WordViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.wordViewer';

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

        const wordUri = document.uri;
        const wordPath = wordUri.fsPath;
        const wordFileName = path.basename(wordPath);

        try {
            if (await rerouteIfNeeded(wordUri, WordViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const wordContent = await FileUtils.readWordFile(wordPath);
            const html = await TemplateUtils.loadTemplate(this.context, 'word/wordViewer.html', {
                fileName: wordFileName,
                wordContent: wordContent.renderer === 'legacy-html' ? (wordContent.htmlContent || '') : '',
                fileSize: wordContent.fileSize || '',
                wordConfigJson: JSON.stringify({
                    renderer: wordContent.renderer,
                    docxBase64: wordContent.docxBase64,
                    htmlContent: wordContent.htmlContent,
                    sourceFormat: wordContent.sourceFormat,
                    wasConverted: wordContent.wasConverted
                })
            });
            webviewPanel.webview.html = html;
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up Word viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(wordFileName, errorMessage, {
                title: 'Failed to load Word file',
                message: 'Unable to load the file:',
                icon: '📄'
            });
        }
    }
}
