import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AutomotiveParsers } from './utils/automotiveParsers';
import { FileUtils } from './utils/fileUtils';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class A2lViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.a2lViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return createReadonlyDocument(uri);
    }

    public async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        configureWebview(this.context, webviewPanel);
        registerRefreshableViewer(document.uri, A2lViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        try {
            if (await rerouteIfNeeded(document.uri, A2lViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const source = await fs.promises.readFile(filePath, 'utf8');
            const model = AutomotiveParsers.parseA2l(source, await FileUtils.getFileSize(filePath));
            webviewPanel.webview.html = await TemplateUtils.loadTemplate(this.context, 'automotive/automotiveViewer.html', {
                fileName,
                viewerData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
            });
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load A2L file',
                message: 'Unable to parse the A2L file due to an error:',
                icon: 'A2L'
            });
        }
    }
}
