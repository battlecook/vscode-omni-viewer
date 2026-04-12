import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TemplateUtils } from './utils/templateUtils';
import { TomlParser } from './utils/tomlParser';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class TomlViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.tomlViewer';

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

        const tomlUri = document.uri;
        const tomlPath = tomlUri.fsPath;
        const tomlFileName = path.basename(tomlPath);

        try {
            if (await rerouteIfNeeded(tomlUri, TomlViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const source = await fs.promises.readFile(tomlPath, 'utf8');
            const parsed = TomlParser.parse(source);
            const html = await TemplateUtils.loadTemplate(this.context, 'toml/tomlViewer.html', {
                fileName: tomlFileName,
                tomlSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
                tomlModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(parsed))
            });

            webviewPanel.webview.html = html;
        } catch (error) {
            console.error('Error setting up TOML viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(tomlFileName, errorMessage, {
                title: 'Failed to load TOML file',
                message: 'Unable to parse the TOML file due to an error:',
                icon: 'T'
            });
        }
    }
}
