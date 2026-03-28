import * as vscode from 'vscode';
import * as path from 'path';
import { HwpDocumentParser } from './utils/hwpDocumentParser';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

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
        configureWebview(this.context, webviewPanel);

        const hwpUri = document.uri;
        const hwpPath = hwpUri.fsPath;
        const hwpFileName = path.basename(hwpPath);

        try {
            if (await rerouteIfNeeded(hwpUri, HwpViewerProvider.viewType, webviewPanel)) {
                return;
            }

            console.log('[HWP Viewer] Loading file:', hwpPath);
            const hwpDocument = await HwpDocumentParser.parseFile(hwpPath);
            console.log('[HWP Viewer] Document parsed, pages:', hwpDocument.pages.length);
            console.log('[HWP Viewer] Source format:', hwpDocument.format);

            const html = await TemplateUtils.loadTemplate(this.context, 'hwp/hwpViewer.html', {
                fileName: hwpFileName,
                hwpPayload: JSON.stringify({
                    document: hwpDocument
                }),
                fileSize: hwpDocument.fileSize || ''
            });

            console.log('[HWP Viewer] Template loaded, length:', html?.length);
            webviewPanel.webview.html = html;

            // Setup message listener
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
