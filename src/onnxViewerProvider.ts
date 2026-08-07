import * as fs from 'fs';
import * as path from 'path';
import { parseOnnx } from 'omni-viewer-core/parsers/onnx';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import {
    configureWebview,
    createReadonlyDocument,
    refreshCancellationToken,
    registerRefreshableViewer,
    renderErrorHtml,
    rerouteIfNeeded
} from './viewerProviderUtils';

export class OnnxViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.onnxViewer';

    // ONNX is protobuf all the way down: there is no index to seek to, so the
    // whole file has to be in one buffer. Node cannot read past this, and the
    // raw ERR_FS_FILE_TOO_LARGE says nothing useful about ONNX.
    private static readonly MAX_READ_BYTES = 2 * 1024 * 1024 * 1024;

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
        registerRefreshableViewer(document.uri, OnnxViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        try {
            if (await rerouteIfNeeded(document.uri, OnnxViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const { size } = await fs.promises.stat(filePath);
            if (size > OnnxViewerProvider.MAX_READ_BYTES) {
                throw new Error(
                    `The model is ${(size / 1024 / 1024 / 1024).toFixed(1)}GB, above the 2GB limit for reading an ONNX file. `
                    + 'Models this large normally store their weights alongside the graph as external data — '
                    + 'export the graph with external data and open that .onnx file instead.'
                );
            }

            // parseOnnx walks the protobuf but deliberately skips tensor payloads,
            // so what reaches the webview is graph topology and metadata only.
            const bytes = await fs.promises.readFile(filePath);
            const model = parseOnnx(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(this.context, 'onnx/onnxViewer.html', {
                fileName,
                onnxData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify({
                    fileName,
                    locale: vscode.env.language || 'en',
                    model
                }))
            }, webviewPanel.webview);

            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);
        } catch (error) {
            console.error('Error setting up ONNX viewer:', error);
            const message = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(fileName, message, {
                title: 'Failed to load ONNX file',
                message: 'Unable to inspect the ONNX model due to an error:',
                icon: 'ONNX'
            });
        }
    }
}
