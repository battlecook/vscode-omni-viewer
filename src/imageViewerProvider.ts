import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class ImageViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.imageViewer';

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
        registerRefreshableViewer(document.uri, ImageViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const imageUri = document.uri;
        const imagePath = imageUri.fsPath;
        const imageFileName = path.basename(imagePath);

        try {
            if (await rerouteIfNeeded(imageUri, ImageViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const mimeType = FileUtils.getImageMimeType(imagePath);
            const imageData = await FileUtils.fileToDataUrl(imagePath, mimeType);
            
            const fileSize = await FileUtils.getFileSize(imagePath);

            // Get workspace folder path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const workspacePath = workspaceFolders && workspaceFolders.length > 0 
                ? workspaceFolders[0].uri.fsPath 
                : '';

            const html = await TemplateUtils.loadTemplate(this.context, 'image/imageViewer.html', {
                fileName: imageFileName,
                imageSrc: imageData,
                fileSize: fileSize,
                workspacePath: workspacePath
            });

            webviewPanel.webview.html = html;

            MessageHandler.setupMessageListener(webviewPanel.webview);

        } catch (error) {
            console.error('Error setting up image viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(imageFileName, errorMessage, {
                title: 'Failed to load image file',
                message: 'Unable to load the image file due to an error:',
                icon: '🖼️'
            });
        }
    }
}
