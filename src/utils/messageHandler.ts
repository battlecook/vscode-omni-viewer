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
    public static async handleWebviewMessage(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
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
            case 'saveChanges':
                console.log('Received saveChanges message:', message);
                await this.handleSaveChanges(message, documentUri);
                break;



            default:
                console.log('Unknown message command:', message.command);
        }
    }

    private static async handleSaveChanges(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        try {
            console.log('handleSaveChanges called with message:', message);
            console.log('documentUri:', documentUri);
            
            if (!message.data) {
                throw new Error('No data provided for saving');
            }

            // Use provided document URI or fall back to active editor
            let uri: vscode.Uri;
            if (documentUri) {
                uri = documentUri;
                console.log('Using provided document URI:', uri.fsPath);
            } else {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    throw new Error('No active document found');
                }
                uri = activeEditor.document.uri;
                console.log('Using active editor URI:', uri.fsPath);
            }

            // Handle CSV data specifically
            if (message.data.headers && message.data.rows) {
                console.log('Processing CSV data - headers:', message.data.headers.length, 'rows:', message.data.rows.length);
                // Convert CSV data to CSV string format
                const csvContent = this.convertToCsvString(message.data.headers, message.data.rows);
                console.log('CSV content length:', csvContent.length);
                console.log('First 200 chars of CSV content:', csvContent.substring(0, 200));
                
                await vscode.workspace.fs.writeFile(uri, Buffer.from(csvContent, 'utf8'));
                console.log('File saved successfully to:', uri.fsPath);
            } else if (message.data.content) {
                // Handle regular content
                await vscode.workspace.fs.writeFile(uri, Buffer.from(message.data.content, 'utf8'));
            } else if (message.text) {
                // Handle text content
                await vscode.workspace.fs.writeFile(uri, Buffer.from(message.text, 'utf8'));
            } else {
                throw new Error('No content provided for saving');
            }
            
            console.log('File saved successfully');
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to save file: ${errorMessage}`);
            console.error('Error saving file:', error);
        }
    }

    private static convertToCsvString(headers: string[], rows: string[][]): string {
        // Escape CSV values and join with commas
        const escapeCsvValue = (value: string): string => {
            if (value === null || value === undefined) {
                return '';
            }
            const stringValue = String(value);
            // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
        };

        // Convert headers to CSV line
        const headerLine = headers.map(escapeCsvValue).join(',');
        
        // Convert rows to CSV lines
        const rowLines = rows.map(row => 
            row.map(escapeCsvValue).join(',')
        );

        // Combine all lines
        return [headerLine, ...rowLines].join('\n');
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
        documentUri?: vscode.Uri,
        customHandlers?: { [command: string]: (message: WebviewMessage) => void }
    ): vscode.Disposable {
        return webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            if (customHandlers && customHandlers[message.command]) {
                customHandlers[message.command](message);
                return;
            }

            // Pass document URI to handleWebviewMessage for save operations
            await this.handleWebviewMessage(message, documentUri);
        });
    }
}
