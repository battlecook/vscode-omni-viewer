import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface WebviewMessage {
    command: string;
    text?: string;
    data?: any;
    fileName?: string;
    blob?: any;
    imageData?: string;
}

export class MessageHandler {
    public static async handleWebviewMessage(message: WebviewMessage): Promise<void> {
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
            case 'saveFilteredImage':
                await this.handleSaveFilteredImage(message);
                break;


            default:
                console.log('Unknown message command:', message.command);
        }
    }

    private static async handleSaveFilteredImage(message: WebviewMessage): Promise<void> {
        try {
            if (!message.fileName || !message.imageData) {
                throw new Error('No filename or image data provided');
            }

            // Get the current workspace folder
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('No workspace folder found');
            }

            const workspaceFolder = workspaceFolders[0];
            const filePath = path.join(workspaceFolder.uri.fsPath, message.fileName);

            // Check if file already exists
            if (fs.existsSync(filePath)) {
                const overwrite = await vscode.window.showWarningMessage(
                    `File "${message.fileName}" already exists. Do you want to overwrite it?`,
                    'Yes', 'No'
                );
                if (overwrite !== 'Yes') {
                    return;
                }
            }

            // Convert base64 to buffer and save file
            const imageBuffer = Buffer.from(message.imageData, 'base64');
            fs.writeFileSync(filePath, imageBuffer);

            // Show success message with file path
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            vscode.window.showInformationMessage(`Filtered image saved: ${relativePath}`);
            
            // Optionally open the saved file in VSCode
            const openFile = await vscode.window.showInformationMessage(
                `Filtered image saved successfully!`,
                'Open File', 'Show in Explorer'
            );

            if (openFile === 'Open File') {
                const document = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(document);
            } else if (openFile === 'Show in Explorer') {
                vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(filePath));
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to save filtered image: ${errorMessage}`);
            console.error('Error saving filtered image:', error);
        }
    }

    public static setupMessageListener(
        webview: vscode.Webview,
        customHandlers?: { [command: string]: (message: WebviewMessage) => void }
    ): vscode.Disposable {
        return webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            if (customHandlers && customHandlers[message.command]) {
                customHandlers[message.command](message);
                return;
            }

            await this.handleWebviewMessage(message);
        });
    }
}
