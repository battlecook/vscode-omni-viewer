import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { MAX_XML_READ_BYTES } from './utils/xmlLimits';
import { createXmlTemplateVariables } from './utils/xmlTemplate';
import {
    configureWebview,
    createReadonlyDocument,
    refreshCancellationToken,
    registerRefreshableViewer,
    renderErrorHtml,
    rerouteIfNeeded
} from './viewerProviderUtils';

/**
 * The document travels to the webview by postMessage once it asks for it, not
 * inlined into the HTML: the raw bytes leave encoding detection (BOM, the
 * `encoding` declaration, UTF-16) to the core parser, which is also what keeps
 * every node's source range exact.
 */
async function readXmlBytes(xmlPath: string): Promise<Uint8Array> {
    await assertXmlSize(xmlPath);
    return new Uint8Array(await fs.promises.readFile(xmlPath));
}

async function assertXmlSize(xmlPath: string): Promise<void> {
    const stat = await fs.promises.stat(xmlPath);
    if (stat.size > MAX_XML_READ_BYTES) {
        throw new Error(
            `The document is ${(stat.size / 1024 / 1024).toFixed(1)} MiB, past the `
            + `${MAX_XML_READ_BYTES / 1024 / 1024} MiB XML viewer limit.`
        );
    }
}

export class XmlViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.xmlViewer';

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
        registerRefreshableViewer(document.uri, XmlViewerProvider.viewType, webviewPanel, async () => {
            await this.resolveCustomEditor(document, webviewPanel, refreshCancellationToken);
        });

        const xmlUri = document.uri;
        const xmlPath = xmlUri.fsPath;
        const xmlFileName = path.basename(xmlPath);

        try {
            // An OpenVINO IR, ARXML or ReqIF document opened here moves to its
            // dedicated viewer.
            if (await rerouteIfNeeded(xmlUri, XmlViewerProvider.viewType, webviewPanel)) {
                return;
            }

            // Checked up front too, so an oversized file gets the error page
            // instead of a viewer that fails after loading.
            await assertXmlSize(xmlPath);

            webviewPanel.webview.html = await TemplateUtils.loadTemplate(
                this.context,
                'xml/xmlViewer.html',
                createXmlTemplateVariables(
                    xmlFileName,
                    vscode.env.language || 'en',
                    webviewPanel.webview.cspSource
                ),
                webviewPanel.webview
            );

            MessageHandler.setupMessageListener(webviewPanel.webview, xmlUri, {
                // Read on every request rather than captured here, so a webview
                // reload shows the file as it is now.
                xmlReady: () => {
                    void readXmlBytes(xmlPath).then(
                        data => webviewPanel.webview.postMessage({ type: 'xmlSource', data }),
                        error => webviewPanel.webview.postMessage({
                            type: 'xmlSourceError',
                            message: error instanceof Error ? error.message : String(error)
                        })
                    );
                }
            });
        } catch (error) {
            console.error('Error setting up XML viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(xmlFileName, errorMessage, {
                title: 'Failed to load XML file',
                message: 'Unable to open the XML document due to an error:',
                icon: 'XML'
            });
        }
    }
}
