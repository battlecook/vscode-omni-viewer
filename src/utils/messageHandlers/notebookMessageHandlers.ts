import * as vscode from 'vscode';
import { resolveNotebookAsset } from '../notebookAssets';
import { WebviewMessage } from './types';

/**
 * Host-side services for the omni-viewer-core Jupyter notebook viewer.
 *
 * The viewer is read-only and renders entirely in the webview; the host only
 * resolves images a Markdown cell references relative to the notebook, opens
 * external links, and backs the clipboard. Each request carries a
 * `requestId`; the reply is posted back as `notebookHostResponse`.
 */
export class NotebookMessageHandlers {
    private static reply(
        webview: vscode.Webview | undefined,
        requestId: string | undefined,
        ok: boolean,
        result?: unknown,
        error?: string
    ): void {
        if (!webview || !requestId) {
            return;
        }
        void webview.postMessage({ type: 'notebookHostResponse', requestId, ok, result, error });
    }

    /** DocumentAssetsService.resolve — a missing or refused asset resolves to null. */
    public static async handleHostResolveAsset(
        message: WebviewMessage,
        documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        const requestId = message.requestId;
        try {
            if (!documentUri || typeof message.url !== 'string') {
                this.reply(webview, requestId, true, null);
                return;
            }
            this.reply(webview, requestId, true, await resolveNotebookAsset(documentUri.fsPath, message.url));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.reply(webview, requestId, false, undefined, errorMessage);
        }
    }

    /** ClipboardService.writeText — fallback when the webview clipboard is blocked. */
    public static async handleHostClipboard(
        message: WebviewMessage,
        _documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        const requestId = message.requestId;
        try {
            await vscode.env.clipboard.writeText(String(message.text ?? ''));
            this.reply(webview, requestId, true, undefined);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.reply(webview, requestId, false, undefined, errorMessage);
        }
    }

    /** NavigationService.openExternalUrl — the core checks the scheme allow-list
     *  before asking; this is a second, host-side gate. */
    public static async handleHostOpenExternal(
        message: WebviewMessage,
        _documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        const requestId = message.requestId;
        try {
            const url = String(message.url ?? '');
            const parsed = vscode.Uri.parse(url, true);
            if (parsed.scheme !== 'http' && parsed.scheme !== 'https' && parsed.scheme !== 'mailto') {
                throw new Error(`Blocked link scheme: ${parsed.scheme}`);
            }

            await vscode.env.openExternal(parsed);
            this.reply(webview, requestId, true, undefined);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to open link: ${errorMessage}`);
            this.reply(webview, requestId, false, undefined, errorMessage);
        }
    }
}
