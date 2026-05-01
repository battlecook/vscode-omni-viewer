import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class HwpViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.hwpViewer';

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
        const hwpUri = document.uri;
        const hwpPath = hwpUri.fsPath;
        const hwpFileName = path.basename(hwpPath);
        registerRefreshableViewer(document.uri, HwpViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        try {
            if (await rerouteIfNeeded(hwpUri, HwpViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const baseWebviewOptions = TemplateUtils.getWebviewOptions(this.context);
            webviewPanel.webview.options = {
                ...baseWebviewOptions,
                localResourceRoots: [
                    ...(baseWebviewOptions.localResourceRoots ?? []),
                    vscode.Uri.file(path.dirname(hwpPath))
                ]
            };

            const stats = await fs.promises.stat(hwpPath);
            const payload = TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify({
                fileName: hwpFileName,
                fileSize: formatFileSize(stats.size),
                documentUri: webviewPanel.webview.asWebviewUri(hwpUri).toString(),
                rhwpModuleUri: webviewPanel.webview.asWebviewUri(
                    vscode.Uri.joinPath(this.context.extensionUri, 'src', 'templates', 'hwp', 'vendor', 'rhwp', 'rhwp.js')
                ).toString(),
                rhwpWasmUri: webviewPanel.webview.asWebviewUri(
                    vscode.Uri.joinPath(this.context.extensionUri, 'src', 'templates', 'hwp', 'vendor', 'rhwp', 'rhwp_bg.wasm')
                ).toString()
            }));

            const html = await TemplateUtils.loadTemplate(this.context, 'hwp/hwpViewer.html', {
                fileName: hwpFileName,
                hwpPayload: payload,
                fileSize: formatFileSize(stats.size)
            });

            webviewPanel.webview.html = html;
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('[HWP Viewer] Error setting up HWP viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(hwpFileName, errorMessage, {
                title: 'HWP 파일을 불러올 수 없습니다',
                message: '파일을 로드하는 중 오류가 발생했습니다:',
                icon: '📄',
                lang: 'ko'
            });
        }
    }
}

function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const precision = size >= 100 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
}
