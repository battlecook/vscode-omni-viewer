import * as fs from 'fs';
import * as path from 'path';
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

export class LatexViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.latexViewer';

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
        registerRefreshableViewer(document.uri, LatexViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const latexUri = document.uri;
        const latexPath = latexUri.fsPath;
        const latexFileName = path.basename(latexPath);

        try {
            if (await rerouteIfNeeded(latexUri, LatexViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const source = await fs.promises.readFile(latexPath, 'utf8');
            // KaTeX's stylesheet stays on disk so its relative font URLs resolve
            // against it; the webview links it into the viewer's shadow root.
            const katexCssUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'katex', 'dist', 'katex.min.css'))
            );

            const html = await TemplateUtils.loadTemplate(this.context, 'latex/latexViewer.html', {
                fileName: latexFileName,
                latexData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify({
                    fileName: latexFileName,
                    locale: vscode.env.language || 'en',
                    katexCssUri: katexCssUri.toString(),
                    source
                }))
            }, webviewPanel.webview);

            webviewPanel.webview.html = html;

            MessageHandler.setupMessageListener(webviewPanel.webview, latexUri);
        } catch (error) {
            console.error('Error setting up LaTeX viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(latexFileName, errorMessage, {
                title: 'Failed to load LaTeX file',
                message: 'Unable to render the LaTeX file due to an error:',
                icon: 'TeX'
            });
        }
    }
}
