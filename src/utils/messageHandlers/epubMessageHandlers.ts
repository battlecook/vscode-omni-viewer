import * as vscode from 'vscode';
import { WebviewMessage } from './types';

/**
 * Host-side services for the omni-viewer-core EPUB viewer.
 *
 * The viewer is read-only and renders entirely in the webview; the host only
 * opens a book's external links. Each request carries a `requestId`; the reply
 * is posted back as `epubHostResponse`.
 */
export class EpubMessageHandlers {
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
        void webview.postMessage({ type: 'epubHostResponse', requestId, ok, result, error });
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
