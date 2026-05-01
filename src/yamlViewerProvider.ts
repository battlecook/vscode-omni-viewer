import * as path from 'path';
import * as vscode from 'vscode';
import { buildYamlViewerModel } from './utils/yamlNodeBuilder';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, replacePanelDisposable, rerouteIfNeeded } from './viewerProviderUtils';

export class YamlViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.yamlViewer';

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
        registerRefreshableViewer(document.uri, YamlViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const yamlUri = document.uri;
        const yamlPath = yamlUri.fsPath;
        const yamlFileName = path.basename(yamlPath);

        const selectionSubscription = vscode.window.onDidChangeTextEditorSelection((event) => {
            if (event.textEditor.document.uri.toString() !== yamlUri.toString()) {
                return;
            }

            const position = event.selections[0]?.active;
            if (!position) {
                return;
            }

            webviewPanel.webview.postMessage({
                type: 'editorSelectionChanged',
                line: position.line + 1,
                column: position.character + 1
            });
        });
        replacePanelDisposable(webviewPanel, 'yamlSelection', selectionSubscription);

        replacePanelDisposable(webviewPanel, 'yamlMessages', webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message?.type === 'revealSource') {
                await this.revealSource(yamlUri, message.range);
            }
        }));

        try {
            if (await rerouteIfNeeded(yamlUri, YamlViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const [yamlContent, fileSize] = await Promise.all([
                vscode.workspace.fs.readFile(yamlUri),
                FileUtils.getFileSize(yamlPath)
            ]);
            const source = Buffer.from(yamlContent).toString('utf8');
            const model = buildYamlViewerModel(source, fileSize);
            const html = await TemplateUtils.loadTemplate(this.context, 'yaml/yamlViewer.html', {
                fileName: yamlFileName,
                yamlModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
            });

            webviewPanel.webview.html = html;
        } catch (error) {
            console.error('Error setting up YAML viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(yamlFileName, errorMessage, {
                title: 'Failed to load YAML file',
                message: 'Unable to parse the YAML file due to an error:',
                icon: 'YAML'
            });
        }
    }

    private async revealSource(uri: vscode.Uri, range: unknown): Promise<void> {
        const sourceRange = this.toVsCodeRange(range);
        const visibleEditor = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri.toString());
        if (!visibleEditor) {
            return;
        }

        visibleEditor.selection = new vscode.Selection(sourceRange.start, sourceRange.end);
        visibleEditor.revealRange(sourceRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private toVsCodeRange(range: unknown): vscode.Range {
        if (!range || typeof range !== 'object') {
            return new vscode.Range(0, 0, 0, 0);
        }

        const start = (range as { start?: { line?: number; column?: number } }).start;
        const end = (range as { end?: { line?: number; column?: number } }).end;
        return new vscode.Range(
            Math.max((start?.line ?? 1) - 1, 0),
            Math.max((start?.column ?? 1) - 1, 0),
            Math.max((end?.line ?? start?.line ?? 1) - 1, 0),
            Math.max((end?.column ?? start?.column ?? 1) - 1, 0)
        );
    }
}
