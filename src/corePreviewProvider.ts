import * as path from 'path';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { assertCorePreviewSize, CorePreviewKind, CORE_PREVIEW_VIEWERS, createCorePreviewVariables, readCorePreview } from './utils/corePreview';
import { WebviewMessage } from './utils/messageHandlers/types';
import {
    configureWebview, createReadonlyDocument, refreshCancellationToken,
    registerRefreshableViewer, renderErrorHtml, replacePanelDisposable, rerouteIfNeeded
} from './viewerProviderUtils';

const MAX_ARROW_CLIPBOARD_BYTES = 16 * 1024 * 1024;
// Core bounds retained data to 16 MiB, but pretty JSON can be much larger
// when the data contains nested lists/maps. Keep save admission independent.
const MAX_ARROW_EXPORT_BYTES = 512 * 1024 * 1024;

/** Platform services only; parsing, rendering and interaction belong to core. */
export class CorePreviewProvider implements vscode.CustomReadonlyEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext, private readonly kind: CorePreviewKind) {}

    public async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return createReadonlyDocument(uri);
    }

    public async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
        const viewType = `omni-viewer.${this.kind}Viewer` as const;
        configureWebview(this.context, panel);
        registerRefreshableViewer(document.uri, viewType, panel, () => this.resolveCustomEditor(document, panel, refreshCancellationToken));
        const fileName = path.basename(document.uri.fsPath);
        let active = true;
        let reading = false;
        replacePanelDisposable(panel, 'corePreviewSession', { dispose: () => { active = false; } });
        const post = async (message: unknown) => {
            if (active && !token.isCancellationRequested) await panel.webview.postMessage(message);
        };
        try {
            if (await rerouteIfNeeded(document.uri, viewType, panel)) return;
            await assertCorePreviewSize(document.uri.fsPath, this.kind);
            if (!active || token.isCancellationRequested) return;
            const listener = MessageHandler.setupMessageListener(panel.webview, document.uri, {
                corePreviewReady: () => {
                    if (!active || reading || token.isCancellationRequested) return;
                    reading = true;
                    void readCorePreview(document.uri.fsPath, this.kind)
                        .then(data => post({ type: 'corePreviewSource', data }))
                        .catch(error => post({ type: 'corePreviewError', message: error instanceof Error ? error.message : String(error) }))
                        .finally(() => { reading = false; });
                },
                corePreviewClipboard: message => { void this.handleArrowRequest(message, document.uri, post); },
                corePreviewSave: message => { void this.handleArrowRequest(message, document.uri, post); }
            });
            replacePanelDisposable(panel, 'corePreviewMessages', listener);
            const script = vscode.Uri.file(path.join(this.context.extensionPath, 'src/templates/corePreview/js', `${this.kind}Viewer.js`));
            const html = await TemplateUtils.loadTemplate(this.context, 'corePreview/corePreview.html',
                createCorePreviewVariables(fileName, vscode.env.language || 'en', panel.webview.cspSource,
                    panel.webview.asWebviewUri(script).toString(), this.kind), panel.webview);
            if (active && !token.isCancellationRequested) panel.webview.html = html;
        } catch (error) {
            if (!active || token.isCancellationRequested) return;
            panel.webview.html = renderErrorHtml(fileName, error instanceof Error ? error.message : String(error), {
                title: `Failed to load ${CORE_PREVIEW_VIEWERS[this.kind].title} file`,
                message: 'Unable to open the file:', icon: CORE_PREVIEW_VIEWERS[this.kind].title
            });
        }
    }

    private async handleArrowRequest(message: WebviewMessage, uri: vscode.Uri, post: (message: unknown) => Promise<void>): Promise<void> {
        if (this.kind !== 'arrow' || typeof message.requestId !== 'string') return;
        try {
            const text = message.type === 'corePreviewClipboard' ? message.text : message.content;
            const maxBytes = message.type === 'corePreviewClipboard' ? MAX_ARROW_CLIPBOARD_BYTES : MAX_ARROW_EXPORT_BYTES;
            if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) {
                throw new Error(`Missing export data or export exceeds the ${maxBytes / 1024 / 1024} MiB limit.`);
            }
            let result: unknown;
            if (message.type === 'corePreviewClipboard') {
                await vscode.env.clipboard.writeText(text);
            } else {
                const name = `${path.basename(uri.fsPath, path.extname(uri.fsPath))}-export.json`;
                const target = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(path.dirname(uri.fsPath), name)),
                    filters: { JSON: ['json'] }
                });
                if (target) {
                    if (target.toString() === uri.toString()) throw new Error('Choose a new file for the JSON export.');
                    await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
                    result = { status: 'saved', fileName: path.basename(target.fsPath), uri: target.toString() };
                } else result = { status: 'cancelled' };
            }
            await post({ type: 'corePreviewResponse', requestId: message.requestId, ok: true, result });
        } catch (error) {
            await post({ type: 'corePreviewResponse', requestId: message.requestId, ok: false,
                error: error instanceof Error ? error.message : String(error) });
        }
    }
}
