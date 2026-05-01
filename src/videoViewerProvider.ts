import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class VideoViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.videoViewer';

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
        registerRefreshableViewer(document.uri, VideoViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const videoUri = document.uri;
        const videoPath = videoUri.fsPath;
        const videoFileName = path.basename(videoPath);

        try {
            if (await rerouteIfNeeded(videoUri, VideoViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const mimeType = FileUtils.getVideoMimeType(videoPath);
            const videoData = await FileUtils.fileToDataUrl(videoPath, mimeType);
            
            const fileSize = await FileUtils.getFileSize(videoPath);

            const html = await TemplateUtils.loadTemplate(this.context, 'videoViewer.html', {
                fileName: videoFileName,
                videoSrc: videoData,
                mimeType: mimeType,
                fileSize: fileSize
            });

            webviewPanel.webview.html = html;

            MessageHandler.setupMessageListener(webviewPanel.webview);

        } catch (error) {
            console.error('Error setting up video viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(videoFileName, errorMessage, {
                title: 'Failed to load video file',
                message: 'Unable to load the video file due to an error:',
                icon: '🎬'
            });
        }
    }
}
