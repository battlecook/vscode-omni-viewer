import * as path from 'path';
import { parseGgufFile } from 'omni-viewer-core/parsers/gguf/node';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import {
    configureWebview,
    createReadonlyDocument,
    refreshCancellationToken,
    registerRefreshableViewer,
    renderErrorHtml,
    rerouteIfNeeded
} from './viewerProviderUtils';

export class GgufViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.ggufViewer';

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
        registerRefreshableViewer(document.uri, GgufViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        // Range reads keep running after the tab closes unless they are cancelled.
        const abort = new AbortController();
        const disposeListener = webviewPanel.onDidDispose(() => abort.abort());

        try {
            if (await rerouteIfNeeded(document.uri, GgufViewerProvider.viewType, webviewPanel)) {
                return;
            }

            // parseGgufFile range-reads the metadata and tensor-index prefix only;
            // the file size label is left to the core so it matches every other
            // GGUF entry point.
            const model = await parseGgufFile(filePath, undefined, abort.signal);

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(this.context, 'gguf/ggufViewer.html', {
                fileName,
                ggufData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify({
                    fileName,
                    locale: vscode.env.language || 'en',
                    model
                }))
            }, webviewPanel.webview);

            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up GGUF viewer:', error);
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load GGUF file',
                message: 'Unable to inspect the GGUF model due to an error:',
                icon: 'GGUF'
            });
        } finally {
            disposeListener.dispose();
        }
    }
}
