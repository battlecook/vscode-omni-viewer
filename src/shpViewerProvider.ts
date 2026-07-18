import * as path from 'path';
import * as vscode from 'vscode';
import { FileUtils } from './utils/fileUtils';
import { MessageHandler, WebviewMessage } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class ShpViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.shpViewer';
    private static readonly PREVIEW_FEATURE_COUNT = 10000;

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return createReadonlyDocument(uri);
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        configureWebview(this.context, webviewPanel);
        registerRefreshableViewer(document.uri, ShpViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        try {
            if (await rerouteIfNeeded(document.uri, ShpViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const shpData = await FileUtils.readShapefile(filePath, {
                featureLimit: ShpViewerProvider.PREVIEW_FEATURE_COUNT
            });
            let loadedFeatures = shpData.metadata.nextFeatureStart;

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(this.context, 'shp/shpViewer.html', {
                fileName,
                shpData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(shpData))
            });

            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri, {
                loadMoreShapefile: async (_message: WebviewMessage) => {
                    const nextData = await FileUtils.readShapefile(filePath, {
                        featureStart: loadedFeatures,
                        featureLimit: ShpViewerProvider.PREVIEW_FEATURE_COUNT
                    });

                    loadedFeatures = nextData.metadata.nextFeatureStart;
                    await webviewPanel.webview.postMessage({
                        type: 'appendShapefileData',
                        data: nextData
                    });
                }
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load Shapefile',
                message: 'Unable to inspect the Shapefile due to an error:',
                icon: 'SHP'
            });
        }
    }
}
