import * as path from 'path';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { createPt2TemplateVariables } from './utils/pt2Template';
import { parsePt2InWorker } from './utils/pt2WorkerClient';
import {
    configureWebview,
    createReadonlyDocument,
    refreshCancellationToken,
    registerRefreshableViewer,
    renderErrorHtml,
    rerouteIfNeeded
} from './viewerProviderUtils';

export class Pt2ViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.pt2Viewer';

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
        token: vscode.CancellationToken
    ): Promise<void> {
        configureWebview(this.context, webviewPanel);
        registerRefreshableViewer(document.uri, Pt2ViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);
        const abort = new AbortController();
        const cancellationListener = token.onCancellationRequested(() => abort.abort());
        const disposeListener = webviewPanel.onDidDispose(() => abort.abort());
        if (token.isCancellationRequested) {
            abort.abort();
        }

        try {
            if (await rerouteIfNeeded(document.uri, Pt2ViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const model = await parsePt2InWorker(filePath, abort.signal);
            if (abort.signal.aborted) {
                return;
            }

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(
                this.context,
                'pt2/pt2Viewer.html',
                createPt2TemplateVariables(
                    fileName,
                    vscode.env.language || 'en',
                    model,
                    webviewPanel.webview.cspSource
                ),
                webviewPanel.webview
            );

            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            if (abort.signal.aborted) {
                return;
            }
            console.error('Error setting up PyTorch Export viewer:', error);
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load PyTorch Export file',
                message: 'Unable to inspect the PyTorch Export package due to an error:',
                icon: 'PT2'
            });
        } finally {
            cancellationListener.dispose();
            disposeListener.dispose();
        }
    }
}
