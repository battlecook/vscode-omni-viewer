import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';

export class VideoViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.videoViewer';

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
        // 웹뷰 옵션 설정
        webviewPanel.webview.options = TemplateUtils.getWebviewOptions(this.context);

        const videoUri = document.uri;
        const videoPath = videoUri.fsPath;
        const videoFileName = path.basename(videoPath);

        try {
            // 비디오 파일을 data URL로 변환
            const mimeType = FileUtils.getVideoMimeType(videoPath);
            const videoData = await FileUtils.fileToDataUrl(videoPath, mimeType);

            // HTML 템플릿 로드 및 변수 치환
            const html = await TemplateUtils.loadTemplate(this.context, 'videoViewer.html', {
                fileName: videoFileName,
                videoSrc: videoData
            });

            // 웹뷰에 HTML 설정
            webviewPanel.webview.html = html;

            // 메시지 리스너 설정
            MessageHandler.setupMessageListener(webviewPanel.webview);

        } catch (error) {
            console.error('Error setting up video viewer:', error);
            
            // 에러 페이지 표시
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = this.getErrorHtml(videoFileName, errorMessage);
        }
    }

    /**
     * 에러 발생 시 표시할 HTML을 생성합니다.
     */
    private getErrorHtml(fileName: string, errorMessage: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Video Viewer Error - ${fileName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
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
        <div class="error-icon">🎬</div>
        <div class="error-title">Failed to load video file</div>
        <div class="error-message">
            Unable to load the video file due to an error:
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
