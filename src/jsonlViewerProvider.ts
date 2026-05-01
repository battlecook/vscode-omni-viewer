import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler, WebviewMessage } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class JsonlViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.jsonlViewer';
    private static readonly PREVIEW_LIMIT_BYTES = 1 * 1024 * 1024;

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
        registerRefreshableViewer(document.uri, JsonlViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const jsonlUri = document.uri;
        const jsonlPath = jsonlUri.fsPath;
        const jsonlFileName = path.basename(jsonlPath);

        try {
            if (await rerouteIfNeeded(jsonlUri, JsonlViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const jsonlContent = await FileUtils.readJsonlFilePreview(jsonlPath, JsonlViewerProvider.PREVIEW_LIMIT_BYTES);
            let loadedBytes = jsonlContent.loadedBytes;
            const html = await TemplateUtils.loadTemplate(this.context, 'jsonl/jsonlViewer.html', {
                fileName: jsonlFileName,
                jsonlData: JSON.stringify(jsonlContent)
            });

            webviewPanel.webview.html = html;
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri, {
                loadMoreJsonl: async (_message: WebviewMessage) => {
                    const nextPreviewBytes = Math.min(loadedBytes + JsonlViewerProvider.PREVIEW_LIMIT_BYTES, jsonlContent.totalBytes);
                    const nextJsonlContent = await FileUtils.readJsonlFilePreview(jsonlPath, nextPreviewBytes);
                    loadedBytes = nextJsonlContent.loadedBytes;
                    await webviewPanel.webview.postMessage({
                        type: 'updateData',
                        data: nextJsonlContent
                    });
                },
                loadAllJsonl: async (_message: WebviewMessage) => {
                    const fullJsonlContent = await FileUtils.readJsonlFile(jsonlPath);
                    loadedBytes = jsonlContent.totalBytes;
                    await webviewPanel.webview.postMessage({
                        type: 'updateData',
                        data: {
                            ...fullJsonlContent,
                            isPreview: false,
                            previewBytes: JsonlViewerProvider.PREVIEW_LIMIT_BYTES,
                            loadedBytes,
                            totalBytes: jsonlContent.totalBytes,
                            hasMoreContent: false
                        }
                    });
                }
            });
        } catch (error) {
            console.error('Error setting up JSONL viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(jsonlFileName, errorMessage, {
                title: 'Failed to load JSONL file',
                message: 'Unable to load the JSONL file due to an error:',
                icon: '📄'
            });
        }
    }
}
