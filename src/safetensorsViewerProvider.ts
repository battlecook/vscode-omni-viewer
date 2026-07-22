import * as fs from 'fs';
import * as path from 'path';
import { parseSafetensorsSource } from 'omni-viewer-core/parsers/safetensors';
import * as vscode from 'vscode';
import { FileUtils } from './utils/fileUtils';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import {
    configureWebview,
    createReadonlyDocument,
    registerRefreshableViewer,
    renderErrorHtml,
    rerouteIfNeeded
} from './viewerProviderUtils';

export class SafetensorsViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.safetensorsViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return createReadonlyDocument(uri);
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        configureWebview(this.context, webviewPanel);
        registerRefreshableViewer(document.uri, SafetensorsViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel);
        });

        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        try {
            if (await rerouteIfNeeded(document.uri, SafetensorsViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const handle = await fs.promises.open(filePath, 'r');
            let model;
            try {
                const stats = await handle.stat();
                model = await parseSafetensorsSource({
                    size: stats.size,
                    async read(offset, length) {
                        const buffer = Buffer.alloc(length);
                        const { bytesRead } = await handle.read(buffer, 0, length, offset);
                        return buffer.subarray(0, bytesRead);
                    }
                }, {
                    fileSize: await FileUtils.getFileSize(filePath)
                });
            } finally {
                await handle.close();
            }
            webviewPanel.webview.html = await TemplateUtils.loadTemplate(
                this.context,
                'automotive/automotiveViewer.html',
                {
                    fileName,
                    viewerData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
                }
            );
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load Safetensors file',
                message: 'Unable to inspect the Safetensors file due to an error:',
                icon: 'ST'
            });
        }
    }
}
