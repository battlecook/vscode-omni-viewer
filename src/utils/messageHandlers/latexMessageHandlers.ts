import * as path from 'path';
import * as vscode from 'vscode';
import { WebviewMessage } from './types';

/**
 * Host-side services for the omni-viewer-core LaTeX viewer.
 *
 * The viewer runs in the webview and owns the document model and the editor;
 * the extension host only provides the platform capabilities it asks for over
 * a request/response bridge: in-place writeback, save-as, clipboard and
 * external links. Each request carries a `requestId`; the reply is posted back
 * as `latexHostResponse` with the same id. Payloads are text, not base64 —
 * a `.tex` file is a text document on both sides of the bridge.
 */
export class LatexMessageHandlers {
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
        void webview.postMessage({ type: 'latexHostResponse', requestId, ok, result, error });
    }

    /** FileWritebackService.write — overwrite the open .tex file in place. */
    public static async handleHostWriteback(
        message: WebviewMessage,
        documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        const requestId = message.requestId;
        try {
            if (!documentUri) {
                throw new Error('No active LaTeX document');
            }
            if (typeof message.content !== 'string') {
                throw new Error('Missing LaTeX source');
            }

            await vscode.workspace.fs.writeFile(documentUri, Buffer.from(message.content, 'utf8'));
            this.reply(webview, requestId, true, { status: 'saved' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to save LaTeX file: ${errorMessage}`);
            this.reply(webview, requestId, false, undefined, errorMessage);
        }
    }

    /** FileSaveService.saveFile — write the edited source to a new file. */
    public static async handleHostSave(
        message: WebviewMessage,
        documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        const requestId = message.requestId;
        try {
            if (typeof message.content !== 'string') {
                throw new Error('Missing LaTeX source');
            }

            const suggestedName = typeof message.name === 'string' && message.name
                ? message.name
                : 'document.tex';
            const defaultDirectory = documentUri
                ? path.dirname(documentUri.fsPath)
                : undefined;
            const defaultPath = defaultDirectory
                ? path.join(defaultDirectory, suggestedName)
                : suggestedName;
            const target = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultPath),
                filters: { 'LaTeX files': ['tex', 'latex', 'ltx'] }
            });

            if (!target) {
                this.reply(webview, requestId, true, { status: 'cancelled' });
                return;
            }

            await vscode.workspace.fs.writeFile(target, Buffer.from(message.content, 'utf8'));
            vscode.window.showInformationMessage(`LaTeX file saved: ${path.basename(target.fsPath)}`);
            this.reply(webview, requestId, true, {
                status: 'saved',
                fileName: path.basename(target.fsPath),
                uri: target.toString()
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to save LaTeX file: ${errorMessage}`);
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

    /** NavigationService.openExternalUrl — \url / \href targets. The core checks
     *  the scheme allow-list before asking; this is a second, host-side gate. */
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
