import * as vscode from 'vscode';
import { WebviewMessage } from './types';

/**
 * Host-side services for the omni-viewer-core XML viewer.
 *
 * The viewer is read-only and renders entirely in the webview; the host only
 * backs the clipboard (copying an XPath, a value, or a node's XML) when the
 * webview's own clipboard is blocked. Each request carries a `requestId`; the
 * reply is posted back as `xmlHostResponse`.
 */
export class XmlMessageHandlers {
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
        void webview.postMessage({ type: 'xmlHostResponse', requestId, ok, result, error });
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
}
