import * as path from 'path';
import * as vscode from 'vscode';
import { MessageHandler } from './utils/messageHandler';
import { TemplateUtils } from './utils/templateUtils';
import { assertCorePreviewSize, CorePreviewKind, CORE_PREVIEW_VIEWERS, createCorePreviewVariables, readCorePreview } from './utils/corePreview';
import { WebviewMessage } from './utils/messageHandlers/types';
import { safeEmlFileName } from 'omni-viewer-core/parsers/eml';
import { MAX_MESH_ASSET_TOTAL_BYTES, readCoreMeshAsset } from './utils/coreMeshAssets';
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
        let assetBytes = 0;
        let assetCount = 0;
        let assetQueue = Promise.resolve();
        const abort = new AbortController();
        const cancellation = token.onCancellationRequested?.(() => abort.abort());
        replacePanelDisposable(panel, 'corePreviewSession', { dispose: () => {
            active = false;
            abort.abort();
            cancellation?.dispose();
        } });
        const post = async (message: unknown) => {
            if (active && !abort.signal.aborted && !token.isCancellationRequested) await panel.webview.postMessage(message);
        };
        const hostRequest = (message: WebviewMessage) => {
            if (active && !abort.signal.aborted && !token.isCancellationRequested) {
                void this.handleHostRequest(message, document.uri, post, abort.signal);
            }
        };
        try {
            if (await rerouteIfNeeded(document.uri, viewType, panel)) return;
            await assertCorePreviewSize(document.uri.fsPath, this.kind);
            if (!active || token.isCancellationRequested) return;
            const listener = MessageHandler.setupMessageListener(panel.webview, document.uri, {
                corePreviewReady: () => {
                    if (!active || reading || token.isCancellationRequested) return;
                    reading = true;
                    void readCorePreview(document.uri.fsPath, this.kind, abort.signal)
                        .then(data => post({ type: 'corePreviewSource', data }))
                        .catch(error => post({ type: 'corePreviewError', message: error instanceof Error ? error.message : String(error) }))
                        .finally(() => { reading = false; });
                },
                corePreviewClipboard: hostRequest,
                corePreviewSave: hostRequest,
                corePreviewAttachmentSave: hostRequest,
                corePreviewAsset: message => {
                    if (this.kind !== 'mesh' || !active || typeof message.requestId !== 'string') return;
                    assetQueue = assetQueue.then(async () => {
                        if (!active || abort.signal.aborted) return;
                        const asset = typeof message.url === 'string' && ++assetCount <= 1024 && assetBytes < MAX_MESH_ASSET_TOTAL_BYTES
                            ? await readCoreMeshAsset(document.uri.fsPath, message.url, abort.signal, MAX_MESH_ASSET_TOTAL_BYTES - assetBytes) : null;
                        if (asset) assetBytes += asset.data.byteLength;
                        await post({ type: 'corePreviewResponse', requestId: message.requestId, ok: true,
                            result: assetBytes <= MAX_MESH_ASSET_TOTAL_BYTES ? asset : null });
                    }).catch(async error => {
                        await post({ type: 'corePreviewResponse', requestId: message.requestId, ok: false, error: String(error) });
                    });
                }
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

    private async handleHostRequest(message: WebviewMessage, uri: vscode.Uri, post: (message: unknown) => Promise<void>, signal: AbortSignal): Promise<void> {
        if (typeof message.requestId !== 'string' || signal.aborted) return;
        const action = message.type || message.command;
        const config = CORE_PREVIEW_VIEWERS[this.kind];
        try {
            let result: unknown;
            if (action === 'corePreviewClipboard' && config.clipboard) {
                const maxBytes = config.clipboardMaxBytes ?? MAX_ARROW_CLIPBOARD_BYTES;
                if (typeof message.text !== 'string' || Buffer.byteLength(message.text, 'utf8') > maxBytes) throw new Error(`Clipboard data exceeds the ${maxBytes / 1024 / 1024} MiB limit.`);
                await vscode.env.clipboard.writeText(message.text);
            } else {
                let bytes: Uint8Array;
                let name: string;
                let filters: Record<string, string[]> | undefined;
                if (action === 'corePreviewSave' && config.save === 'json') {
                    if (typeof message.content !== 'string' || Buffer.byteLength(message.content, 'utf8') > MAX_ARROW_EXPORT_BYTES) throw new Error('Export exceeds the 512 MiB limit.');
                    bytes = Buffer.from(message.content, 'utf8');
                    name = `${path.basename(uri.fsPath, path.extname(uri.fsPath))}-export.json`;
                    filters = { JSON: ['json'] };
                } else if (action === 'corePreviewAttachmentSave' && config.save === 'attachment') {
                    if (!(message.data instanceof Uint8Array) && !Array.isArray(message.data)) throw new Error('Missing attachment bytes.');
                    if (message.data.length > config.maxBytes) throw new Error(`Attachment exceeds the ${config.title} viewer limit.`);
                    bytes = new Uint8Array(message.data);
                    name = safeEmlFileName(typeof message.name === 'string' ? message.name : 'attachment.bin');
                } else throw new Error('This service is unavailable for the current viewer.');
                const target = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(path.dirname(uri.fsPath), name)),
                    ...(filters ? { filters } : {})
                });
                if (signal.aborted) return;
                if (target) {
                    if (target.toString() === uri.toString()) throw new Error('Choose a new file for the export.');
                    await vscode.workspace.fs.writeFile(target, bytes);
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
