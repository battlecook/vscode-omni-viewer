import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class JsonViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.jsonViewer';

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
        registerRefreshableViewer(document.uri, JsonViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const jsonUri = document.uri;
        const jsonPath = jsonUri.fsPath;
        const jsonFileName = path.basename(jsonPath);

        try {
            if (await rerouteIfNeeded(jsonUri, JsonViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const jsonContent = await FileUtils.readJsonFile(jsonPath);
            const html = await TemplateUtils.loadTemplate(this.context, 'json/jsonViewer.html', {
                fileName: jsonFileName,
                formattedJson: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(jsonContent.formattedJson))
            });

            webviewPanel.webview.html = html;
        } catch (error) {
            console.error('Error setting up JSON viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(jsonFileName, errorMessage, {
                title: 'Failed to load JSON file',
                message: 'Unable to parse the JSON file due to an error:',
                icon: '🧾'
            });
        }
    }
}
