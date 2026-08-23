import * as path from 'path';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { createKerasTemplateVariables } from './utils/kerasTemplate';
import { parseKerasInWorker } from './utils/kerasWorkerClient';
import {
    configureWebview,
    createReadonlyDocument,
    refreshCancellationToken,
    registerRefreshableViewer,
    renderErrorHtml,
    rerouteIfNeeded
} from './viewerProviderUtils';

export class KerasViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.kerasViewer';

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
        registerRefreshableViewer(document.uri, KerasViewerProvider.viewType, webviewPanel, async () => {
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
            if (await rerouteIfNeeded(document.uri, KerasViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const model = await parseKerasInWorker(filePath, abort.signal);
            if (abort.signal.aborted) {
                return;
            }

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(
                this.context,
                'keras/kerasViewer.html',
                createKerasTemplateVariables(
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
            console.error('Error setting up Keras viewer:', error);
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load Keras file',
                message: 'Unable to inspect the Keras model due to an error:',
                icon: 'Keras'
            });
        } finally {
            cancellationListener.dispose();
            disposeListener.dispose();
        }
    }
}
