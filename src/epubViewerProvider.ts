import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MAX_EPUB_READ_BYTES } from './utils/epubLimits';
import { createEpubTemplateVariables } from './utils/epubTemplate';
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

/**
 * The book travels to the webview by postMessage once it asks for it, not
 * inlined into the HTML: the core viewer inflates chapters and images out of
 * the archive on demand, so it needs the raw bytes, and base64 would grow them
 * by a third.
 */
async function readEpubBytes(epubPath: string): Promise<Uint8Array> {
    await assertEpubSize(epubPath);
    return new Uint8Array(await fs.promises.readFile(epubPath));
}

async function assertEpubSize(epubPath: string): Promise<void> {
    const stat = await fs.promises.stat(epubPath);
    if (stat.size > MAX_EPUB_READ_BYTES) {
        throw new Error(
            `The book is ${(stat.size / 1024 / 1024).toFixed(1)} MiB, past the `
            + `${MAX_EPUB_READ_BYTES / 1024 / 1024} MiB EPUB limit. Open it with the Archive viewer to list its contents.`
        );
    }
}

export class EpubViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.epubViewer';

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
        registerRefreshableViewer(document.uri, EpubViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const epubUri = document.uri;
        const epubPath = epubUri.fsPath;
        const epubFileName = path.basename(epubPath);

        try {
            if (await rerouteIfNeeded(epubUri, EpubViewerProvider.viewType, webviewPanel)) {
                return;
            }

            // Checked up front too, so an oversized book gets the error page
            // instead of a viewer that fails after loading.
            await assertEpubSize(epubPath);

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(
                this.context,
                'epub/epubViewer.html',
                createEpubTemplateVariables(
                    epubFileName,
                    vscode.env.language || 'en',
                    webviewPanel.webview.cspSource
                ),
                webviewPanel.webview
            );

            MessageHandler.setupMessageListener(webviewPanel.webview, epubUri, {
                // Read on every request rather than captured here, so a webview
                // reload shows the file as it is now and the host does not
                // hold the bytes for the panel's lifetime.
                epubReady: () => {
                    void readEpubBytes(epubPath).then(
                        data => webviewPanel.webview.postMessage({ type: 'epubSource', data }),
                        error => webviewPanel.webview.postMessage({
                            type: 'epubSourceError',
                            message: error instanceof Error ? error.message : String(error)
                        })
                    );
                }
            });
        } catch (error) {
            console.error('Error setting up EPUB viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(epubFileName, errorMessage, {
                title: 'Failed to load EPUB file',
                message: 'Unable to open the book due to an error:',
                icon: 'EPUB'
            });
        }
    }
}
