import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class ArchiveViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.archiveViewer';

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

        const archiveUri = document.uri;
        const archivePath = archiveUri.fsPath;
        const archiveFileName = path.basename(archivePath);

        try {
            if (await rerouteIfNeeded(archiveUri, ArchiveViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const archiveContent = await FileUtils.readArchiveFile(archivePath);
            const html = await TemplateUtils.loadTemplate(this.context, 'archive/archiveViewer.html', {
                fileName: archiveFileName,
                archiveData: JSON.stringify(archiveContent)
            });

            webviewPanel.webview.html = html;
            webviewPanel.webview.onDidReceiveMessage(async (message) => {
                if (!message || message.type !== 'requestEntryPreview' || typeof message.path !== 'string') {
                    return;
                }

                const selectedEntry = archiveContent.entries.find((entry) => entry.path === message.path);
                if (!selectedEntry) {
                    await webviewPanel.webview.postMessage({
                        type: 'entryPreview',
                        path: message.path,
                        status: 'error',
                        message: 'The selected entry is no longer available in the preview list.'
                    });
                    return;
                }

                if (selectedEntry.kind === 'directory') {
                    await webviewPanel.webview.postMessage({
                        type: 'entryPreview',
                        path: selectedEntry.path,
                        status: 'unsupported',
                        message: 'Directory entries do not have inline content to preview.'
                    });
                    return;
                }

                const preview = await FileUtils.readArchiveEntryPreview(archivePath, selectedEntry.path);
                await webviewPanel.webview.postMessage({
                    type: 'entryPreview',
                    ...preview
                });
            });
        } catch (error) {
            console.error('Error setting up archive viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(archiveFileName, errorMessage, {
                title: 'Failed to load archive file',
                message: 'Unable to inspect the archive contents due to an error:',
                icon: '🗜️'
            });
        }
    }
}
