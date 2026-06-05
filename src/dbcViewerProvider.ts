import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DbcParser } from './utils/dbcParser';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class DbcViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.dbcViewer';

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
        registerRefreshableViewer(document.uri, DbcViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const dbcUri = document.uri;
        const dbcPath = dbcUri.fsPath;
        const dbcFileName = path.basename(dbcPath);

        try {
            if (await rerouteIfNeeded(dbcUri, DbcViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const source = await fs.promises.readFile(dbcPath, 'utf8');
            const model = DbcParser.parse(source);
            const html = await TemplateUtils.loadTemplate(this.context, 'dbc/dbcViewer.html', {
                fileName: dbcFileName,
                dbcSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
                dbcModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
            });

            webviewPanel.webview.html = html;
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up DBC viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(dbcFileName, errorMessage, {
                title: 'Failed to load DBC file',
                message: 'Unable to parse the DBC file due to an error:',
                icon: 'DBC'
            });
        }
    }
}
