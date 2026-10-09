import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { MAX_NOTEBOOK_READ_BYTES } from './utils/notebookAssets';
import { createNotebookTemplateVariables } from './utils/notebookTemplate';
import {
    configureWebview,
    createReadonlyDocument,
    refreshCancellationToken,
    registerRefreshableViewer,
    renderErrorHtml,
    rerouteIfNeeded
} from './viewerProviderUtils';

/**
 * The bytes travel to the webview by postMessage once it asks for them, not
 * inlined into the HTML: escaping a notebook into a JSON string literal roughly
 * doubles it (HTML outputs grow more), and the raw bytes leave encoding to the
 * core parser.
 */
async function readNotebookBytes(notebookPath: string): Promise<Uint8Array> {
    await assertNotebookSize(notebookPath);
    return new Uint8Array(await fs.promises.readFile(notebookPath));
}

async function assertNotebookSize(notebookPath: string): Promise<void> {
    const stat = await fs.promises.stat(notebookPath);
    if (stat.size > MAX_NOTEBOOK_READ_BYTES) {
        throw new Error(
            `The notebook is ${(stat.size / 1024 / 1024).toFixed(1)} MiB, past the `
            + `${MAX_NOTEBOOK_READ_BYTES / 1024 / 1024} MiB preview limit.`
        );
    }
}

export class NotebookViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.notebookViewer';

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
        registerRefreshableViewer(document.uri, NotebookViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const notebookUri = document.uri;
        const notebookPath = notebookUri.fsPath;
        const notebookFileName = path.basename(notebookPath);

        try {
            if (await rerouteIfNeeded(notebookUri, NotebookViewerProvider.viewType, webviewPanel)) {
                return;
            }

            // Checked up front too, so an oversized file gets the error page
            // instead of a viewer that fails after loading.
            await assertNotebookSize(notebookPath);

            // KaTeX's stylesheet stays on disk so its relative font URLs resolve
            // against it; the webview links it into the viewer's shadow root.
            const katexCssUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'katex', 'dist', 'katex.min.css'))
            );

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(
                this.context,
                'notebook/notebookViewer.html',
                createNotebookTemplateVariables(
                    notebookFileName,
                    vscode.env.language || 'en',
                    katexCssUri.toString(),
                    webviewPanel.webview.cspSource
                ),
                webviewPanel.webview
            );

            MessageHandler.setupMessageListener(webviewPanel.webview, notebookUri, {
                // Read on every request rather than captured here, so a webview
                // reload shows the file as it is now and the host does not
                // hold the bytes for the panel's lifetime.
                notebookReady: () => {
                    void readNotebookBytes(notebookPath).then(
                        data => webviewPanel.webview.postMessage({ type: 'notebookSource', data }),
                        error => webviewPanel.webview.postMessage({
                            type: 'notebookSourceError',
                            message: error instanceof Error ? error.message : String(error)
                        })
                    );
                }
            });
        } catch (error) {
            console.error('Error setting up Jupyter notebook viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(notebookFileName, errorMessage, {
                title: 'Failed to load Jupyter notebook',
                message: 'Unable to render the notebook due to an error:',
                icon: 'IPYNB'
            });
        }
    }
}
