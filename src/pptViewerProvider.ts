import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';

export class PptViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.pptViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = TemplateUtils.getWebviewOptions(this.context);

        const pptUri = document.uri;
        const pptPath = pptUri.fsPath;
        const pptFileName = path.basename(pptPath);

        try {
            const pptContent = await FileUtils.readPresentationFile(pptPath);

            const html = await TemplateUtils.loadTemplate(this.context, 'ppt/pptViewer.html', {
                fileName: pptFileName,
                fileSize: pptContent.fileSize,
                totalSlides: String(pptContent.totalSlides),
                presentationData: JSON.stringify(pptContent)
            });

            webviewPanel.webview.html = html;
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up PPT viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = this.getErrorHtml(pptFileName, errorMessage);
        }
    }

    private getErrorHtml(fileName: string, errorMessage: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PPT Viewer Error - ${fileName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            text-align: center;
            padding: 20px;
            min-height: 100vh;
        }
        .error-container { max-width: 560px; }
        .error-icon { font-size: 48px; margin-bottom: 20px; }
        .error-title { font-size: 24px; font-weight: 600; margin-bottom: 10px; color: var(--vscode-errorForeground); }
        .error-message { font-size: 14px; line-height: 1.5; margin-bottom: 20px; }
        .file-name {
            font-family: 'Monaco', 'Menlo', monospace;
            background: var(--vscode-textBlockQuote-background);
            padding: 8px 12px;
            border-radius: 4px;
            margin: 10px 0;
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">📽️</div>
        <div class="error-title">Failed to load PowerPoint file</div>
        <div class="error-message">Unable to parse and render the file:</div>
        <div class="file-name">${fileName}</div>
        <div class="error-message">${errorMessage}</div>
    </div>
</body>
</html>`;
    }
}
