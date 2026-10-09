import * as path from 'path';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { createPteTemplateVariables } from './utils/pteTemplate';
import { parsePteInWorker } from './utils/pteWorkerClient';
import {
    configureWebview,
    createReadonlyDocument,
    refreshCancellationToken,
    registerRefreshableViewer,
    renderErrorHtml,
    rerouteIfNeeded
} from './viewerProviderUtils';

export class PteViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.pteViewer';

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
        registerRefreshableViewer(document.uri, PteViewerProvider.viewType, webviewPanel, async () => {
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
            if (await rerouteIfNeeded(document.uri, PteViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const model = await parsePteInWorker(filePath, abort.signal);
            if (abort.signal.aborted) {
                return;
            }

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(
                this.context,
                'pte/pteViewer.html',
                createPteTemplateVariables(
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
            console.error('Error setting up ExecuTorch viewer:', error);
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load ExecuTorch file',
                message: 'Unable to inspect the ExecuTorch program due to an error:',
                icon: 'ExecuTorch'
            });
        } finally {
            cancellationListener.dispose();
            disposeListener.dispose();
        }
    }
}
