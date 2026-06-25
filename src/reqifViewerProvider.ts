import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AutomotiveParsers } from './utils/automotiveParsers';
import { FileUtils } from './utils/fileUtils';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class ReqifViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.reqifViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return createReadonlyDocument(uri);
    }

    public async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        configureWebview(this.context, webviewPanel);
        registerRefreshableViewer(document.uri, ReqifViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        try {
            if (await rerouteIfNeeded(document.uri, ReqifViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const source = await fs.promises.readFile(filePath, 'utf8');
            const model = AutomotiveParsers.parseReqif(source, await FileUtils.getFileSize(filePath));
            webviewPanel.webview.html = await TemplateUtils.loadTemplate(this.context, 'automotive/automotiveViewer.html', {
                fileName,
                viewerData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
            });
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load ReqIF file',
                message: 'Unable to inspect the ReqIF file due to an error:',
                icon: 'REQIF'
            });
        }
    }
}
