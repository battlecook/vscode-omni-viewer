import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';

export class HwpViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.hwpViewer';

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

        const hwpUri = document.uri;
        const hwpPath = hwpUri.fsPath;
        const hwpFileName = path.basename(hwpPath);

        try {
            console.log('[HWP Viewer] Loading file:', hwpPath);
            const hwpContent = await FileUtils.readHwpFile(hwpPath);
            console.log('[HWP Viewer] Content loaded, html length:', hwpContent.html?.length);
            console.log('[HWP Viewer] Content type:', typeof hwpContent.html);

            const html = await TemplateUtils.loadTemplate(this.context, 'hwp/hwpViewer.html', {
                fileName: hwpFileName,
                hwpContent: hwpContent.html || '',
                fileSize: hwpContent.fileSize || ''
            });

            console.log('[HWP Viewer] Template loaded, length:', html?.length);
            webviewPanel.webview.html = html;

            // Setup message listener
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);

        } catch (error) {
            console.error('[HWP Viewer] Error setting up HWP viewer:', error);
            
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = this.getErrorHtml(hwpFileName, errorMessage);
        }
    }

    private getErrorHtml(fileName: string, errorMessage: string): string {
        return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HWP Viewer Error - ${fileName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            text-align: center;
            padding: 20px;
        }
        .error-container {
            max-width: 500px;
        }
        .error-icon {
            font-size: 48px;
            margin-bottom: 20px;
        }
        .error-title {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 10px;
            color: var(--vscode-errorForeground);
        }
        .error-message {
            font-size: 14px;
            line-height: 1.5;
            margin-bottom: 20px;
        }
        .file-name {
            font-family: 'Monaco', 'Menlo', monospace;
            background: var(--vscode-textBlockQuote-background);
            padding: 8px 12px;
            border-radius: 4px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">📄</div>
        <div class="error-title">HWP 파일을 불러올 수 없습니다</div>
        <div class="error-message">
            파일을 로드하는 중 오류가 발생했습니다:
        </div>
        <div class="file-name">${fileName}</div>
        <div class="error-message">
            ${errorMessage}
        </div>
    </div>
</body>
</html>`;
    }
}
