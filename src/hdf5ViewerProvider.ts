import * as path from 'path';
import * as vscode from 'vscode';
import { FileUtils } from './utils/fileUtils';
import { Hdf5Parser } from './utils/hdf5Parser';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, refreshCancellationToken, registerRefreshableViewer, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class Hdf5ViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.hdf5Viewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return createReadonlyDocument(uri);
    }

    public async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        configureWebview(this.context, webviewPanel);
        registerRefreshableViewer(document.uri, Hdf5ViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        try {
            if (await rerouteIfNeeded(document.uri, Hdf5ViewerProvider.viewType, webviewPanel)) {
                return;
            }

            // Only metadata is read on demand (via fd), so multi-GB/TB files open without
            // loading the whole file into memory.
            const model = Hdf5Parser.parseFile(filePath, await FileUtils.getFileSize(filePath));
            webviewPanel.webview.html = await TemplateUtils.loadTemplate(this.context, 'automotive/automotiveViewer.html', {
                fileName,
                viewerData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
            });
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load HDF5 file',
                message: 'Unable to inspect the HDF5 file due to an error:',
                icon: 'HDF5'
            });
        }
    }
}
