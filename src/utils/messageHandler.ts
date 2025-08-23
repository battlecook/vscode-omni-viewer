import * as vscode from 'vscode';

export interface WebviewMessage {
    command: string;
    text?: string;
    data?: any;
}

export class MessageHandler {
    /**
     * 웹뷰에서 받은 메시지를 처리합니다.
     */
    public static handleWebviewMessage(message: WebviewMessage): void {
        switch (message.command) {
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
            default:
                console.log('Unknown message command:', message.command);
        }
    }

    /**
     * 웹뷰 메시지 리스너를 설정합니다.
     */
    public static setupMessageListener(
        webview: vscode.Webview,
        customHandlers?: { [command: string]: (message: WebviewMessage) => void }
    ): vscode.Disposable {
        return webview.onDidReceiveMessage((message: WebviewMessage) => {
            // 커스텀 핸들러가 있으면 먼저 실행
            if (customHandlers && customHandlers[message.command]) {
                customHandlers[message.command](message);
                return;
            }

            // 기본 핸들러 실행
            this.handleWebviewMessage(message);
        });
    }
}
