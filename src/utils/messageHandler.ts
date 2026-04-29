import * as vscode from 'vscode';
import { MediaMessageHandlers } from './messageHandlers/mediaMessageHandlers';
import { PdfMessageHandlers } from './messageHandlers/pdfMessageHandlers';
import { TextMessageHandlers } from './messageHandlers/textMessageHandlers';
import { WebviewMessage } from './messageHandlers/types';

export type { WebviewMessage } from './messageHandlers/types';

export class MessageHandler {
    public static async handleWebviewMessage(
        message: WebviewMessage,
        documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        const messageType = message.type || message.command;

        switch (messageType) {
            case 'log':
                console.log('Webview:', message.text);
                break;
            case 'error':
                vscode.window.showErrorMessage(`Webview Error: ${message.text}`);
                break;
            case 'info':
                vscode.window.showInformationMessage(`Webview: ${message.text}`);
                break;
            case 'warning':
                vscode.window.showWarningMessage(`Webview: ${message.text}`);
                break;
            case 'saveFilteredImage':
                await MediaMessageHandlers.handleSaveFilteredImage(message);
                break;
            case 'saveRegionFile':
                await MediaMessageHandlers.handleSaveRegionFile(message, documentUri);
                break;
            case 'saveChanges':
                await TextMessageHandlers.handleSaveChanges(message, documentUri);
                break;
            case 'updateLine':
                await TextMessageHandlers.handleUpdateLine(message, documentUri);
                break;
            case 'deleteLine':
                await TextMessageHandlers.handleDeleteLine(message, documentUri);
                break;
            case 'insertLine':
                await TextMessageHandlers.handleInsertLine(message, documentUri);
                break;
            case 'insertMultipleLines':
                await TextMessageHandlers.handleInsertMultipleLines(message, documentUri);
                break;
            case 'deleteMultipleLines':
                await TextMessageHandlers.handleDeleteMultipleLines(message, documentUri);
                break;
            case 'downloadFile':
                await MediaMessageHandlers.handleDownloadFile(message, documentUri);
                break;
            case 'savePdf':
            case 'savePdfAs':
                await PdfMessageHandlers.handleSavePdf(message, documentUri, webview);
                break;
            case 'selectMergePdf':
                await PdfMessageHandlers.handleSelectMergePdf(documentUri, webview);
                break;
            case 'resetMergePdfCache':
                PdfMessageHandlers.resetMergedPdfCache(documentUri);
                break;
            default:
                console.log('Unknown message type:', messageType);
        }
    }

    public static convertToDelimitedString(headers: string[], rows: string[][], delimiter = ','): string {
        return TextMessageHandlers.convertToDelimitedString(headers, rows, delimiter);
    }

    public static setupMessageListener(
        webview: vscode.Webview,
        documentUri?: vscode.Uri,
        customHandlers?: { [command: string]: (message: WebviewMessage) => void }
    ): vscode.Disposable {
        return webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            if (customHandlers && customHandlers[message.command]) {
                customHandlers[message.command](message);
                return;
            }

            await this.handleWebviewMessage(message, documentUri, webview);
        });
    }
}
