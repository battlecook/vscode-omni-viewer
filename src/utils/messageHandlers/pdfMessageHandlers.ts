import * as path from 'path';
import * as vscode from 'vscode';
import { WebviewMessage } from './types';

/**
 * Host-side services for the omni-viewer-core PDF viewer.
 *
 * The core viewer runs in the webview and performs all PDF editing itself
 * (pdf-lib is bundled into the webview). The extension host only provides the
 * platform capabilities the viewer requests over a small request/response
 * bridge: save-as, in-place writeback, file picking (merge) and clipboard.
 * Each request carries a `requestId`; the reply is posted back as
 * `pdfHostResponse` with the same id.
 */
export class PdfMessageHandlers {
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
        void webview.postMessage({ type: 'pdfHostResponse', requestId, ok, result, error });
    }

    /** FileSaveService.saveFile — write a brand new PDF chosen by the user. */
    public static async handleHostSave(
        message: WebviewMessage,
        documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        const requestId = message.requestId;
        try {
            if (!documentUri) {
                throw new Error('No active PDF document');
            }
            if (typeof message.dataBase64 !== 'string') {
                throw new Error('Missing PDF data');
            }

            const suggestedName = typeof message.name === 'string' && message.name
                ? message.name
                : 'document.pdf';
            const defaultPath = path.join(path.dirname(documentUri.fsPath), suggestedName);
            const target = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultPath),
                filters: { 'PDF files': ['pdf'] }
            });

            if (!target) {
                this.reply(webview, requestId, true, { status: 'cancelled' });
                return;
            }

            const bytes = Buffer.from(message.dataBase64, 'base64');
            await vscode.workspace.fs.writeFile(target, new Uint8Array(bytes));
            vscode.window.showInformationMessage(`PDF saved: ${path.basename(target.fsPath)}`);
            this.reply(webview, requestId, true, {
                status: 'saved',
                fileName: path.basename(target.fsPath),
                uri: target.toString()
            });

            await vscode.commands.executeCommand('vscode.openWith', target, 'omni-viewer.pdfViewer');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to save PDF: ${errorMessage}`);
            this.reply(webview, requestId, false, undefined, errorMessage);
        }
    }

    /** FileWritebackService.write — overwrite the currently open PDF in place. */
    public static async handleHostWriteback(
        message: WebviewMessage,
        documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        const requestId = message.requestId;
        try {
            if (!documentUri) {
                throw new Error('No active PDF document');
            }
            if (typeof message.dataBase64 !== 'string') {
                throw new Error('Missing PDF data');
            }

            const bytes = Buffer.from(message.dataBase64, 'base64');
            await vscode.workspace.fs.writeFile(documentUri, new Uint8Array(bytes));
            vscode.window.showInformationMessage(`PDF saved: ${path.basename(documentUri.fsPath)}`);
            this.reply(webview, requestId, true, { status: 'saved' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to save PDF: ${errorMessage}`);
            this.reply(webview, requestId, false, undefined, errorMessage);
        }
    }

    /** FilePickService.pickFile — choose a second PDF to merge. */
    public static async handleHostPickFile(
        message: WebviewMessage,
        _documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        const requestId = message.requestId;
        try {
            const accept = Array.isArray(message.accept) ? message.accept : ['.pdf'];
            const extensions = Array.from(new Set(
                accept
                    .map((entry) => String(entry).trim().toLowerCase())
                    .map((entry) => (entry === 'application/pdf' ? 'pdf' : entry.replace(/^\./, '')))
                    .filter((entry) => /^[a-z0-9]+$/.test(entry))
            ));

            const selected = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'PDF files': extensions.length > 0 ? extensions : ['pdf'] }
            });

            if (!selected || selected.length === 0) {
                this.reply(webview, requestId, true, undefined);
                return;
            }

            const picked = selected[0];
            const bytes = await vscode.workspace.fs.readFile(picked);
            if (typeof message.maxBytes === 'number' && bytes.length > message.maxBytes) {
                throw new Error(`Selected file is too large (limit ${message.maxBytes} bytes).`);
            }

            this.reply(webview, requestId, true, {
                fileName: path.basename(picked.fsPath),
                dataBase64: Buffer.from(bytes).toString('base64'),
                mimeType: 'application/pdf'
            });
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
}
