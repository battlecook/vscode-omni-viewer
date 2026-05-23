import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileUtils } from './utils/fileUtils';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class PlantumlViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.plantumlViewer';

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
        registerRefreshableViewer(document.uri, PlantumlViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const plantumlUri = document.uri;
        const plantumlPath = plantumlUri.fsPath;
        const plantumlFileName = path.basename(plantumlPath);

        try {
            if (await rerouteIfNeeded(plantumlUri, PlantumlViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const templateBaseUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'templates', 'plantuml'))
            );
            const [source, fileSize] = await Promise.all([
                fs.promises.readFile(plantumlPath, 'utf8'),
                FileUtils.getFileSize(plantumlPath)
            ]);
            const html = await TemplateUtils.loadTemplate(this.context, 'plantuml/plantumlViewer.html', {
                fileName: plantumlFileName,
                fileNameJson: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(plantumlFileName)),
                fileSize,
                fileSizeJson: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(fileSize)),
                plantumlSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
                plantumlTemplateBase: templateBaseUri.toString().replace(/\/?$/, '/')
            });

            webviewPanel.webview.html = html;
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up PlantUML viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(plantumlFileName, errorMessage, {
                title: 'Failed to load PlantUML file',
                message: 'Unable to render the PlantUML diagram due to an error:',
                icon: 'P'
            });
        }
    }
}
