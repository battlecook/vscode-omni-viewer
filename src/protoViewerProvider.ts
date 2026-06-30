import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { parseProto } from './utils/protoParser';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class ProtoViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.protoViewer';

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
        registerRefreshableViewer(document.uri, ProtoViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const protoUri = document.uri;
        const protoPath = protoUri.fsPath;
        const protoFileName = path.basename(protoPath);

        try {
            if (await rerouteIfNeeded(protoUri, ProtoViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const source = await fs.promises.readFile(protoPath, 'utf8');
            const model = parseProto(source, protoFileName);
            const html = await TemplateUtils.loadTemplate(this.context, 'proto/protoViewer.html', {
                fileName: protoFileName,
                protoSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
                protoModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
            });

            webviewPanel.webview.html = html;
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up Proto viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(protoFileName, errorMessage, {
                title: 'Failed to load Proto file',
                message: 'Unable to parse the proto file due to an error:',
                icon: '{}'
            });
        }
    }
}
