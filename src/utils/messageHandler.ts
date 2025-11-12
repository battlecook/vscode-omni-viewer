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
    type?: string;
    lineNumber?: number;
    mimeType?: string;
    duration?: string;
    startTime?: string;
    endTime?: string;
    content?: string;
}

export class MessageHandler {
    public static async handleWebviewMessage(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        // Handle both command-based and type-based messages
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
                await this.handleSaveFilteredImage(message);
                break;
            case 'saveRegionFile':
                await this.handleSaveRegionFile(message);
                break;
            case 'saveChanges':
                console.log('Received saveChanges message:', message);
                await this.handleSaveChanges(message, documentUri);
                break;
            case 'updateLine':
                await this.handleUpdateLine(message, documentUri);
                break;
            case 'deleteLine':
                await this.handleDeleteLine(message, documentUri);
                break;
            case 'insertLine':
                await this.handleInsertLine(message, documentUri);
                break;
            case 'insertMultipleLines':
                await this.handleInsertMultipleLines(message, documentUri);
                break;
            case 'deleteMultipleLines':
                await this.handleDeleteMultipleLines(message, documentUri);
                break;
            case 'downloadFile':
                await this.handleDownloadFile(message, documentUri);
                break;

            default:
                console.log('Unknown message type:', messageType);
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

    private static async handleUpdateLine(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        try {
            console.log('🔍 handleUpdateLine called with:', {
                lineNumber: message.lineNumber,
                content: message.content,
                documentUri: documentUri?.fsPath
            });

            if (!message.lineNumber || message.content === undefined) {
                throw new Error('Line number and content are required');
            }

            if (!documentUri) {
                throw new Error('No document URI provided');
            }

            // Read current file content
            const fileContent = await vscode.workspace.fs.readFile(documentUri);
            const lines = Buffer.from(fileContent).toString('utf8').split('\n');
            
            console.log('📄 Current file has', lines.length, 'lines');
            console.log('📍 Trying to update line', message.lineNumber, '(0-based index:', message.lineNumber - 1, ')');
            
            // Update the specific line (lineNumber is 1-based)
            const lineIndex = message.lineNumber - 1;
            if (lineIndex >= 0 && lineIndex < lines.length) {
                lines[lineIndex] = message.content;
                console.log('✅ Line updated successfully');
            } else {
                console.error('❌ Line index out of range:', {
                    lineIndex: lineIndex,
                    fileLines: lines.length,
                    requestedLine: message.lineNumber
                });
                throw new Error(`Line ${message.lineNumber} is out of range (file has ${lines.length} lines)`);
            }

            // Write back to file
            const newContent = lines.join('\n');
            await vscode.workspace.fs.writeFile(documentUri, Buffer.from(newContent, 'utf8'));
            
            console.log(`✅ Updated line ${message.lineNumber} in ${documentUri.fsPath}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to update line: ${errorMessage}`);
            console.error('❌ Error updating line:', error);
        }
    }

    private static async handleDeleteLine(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        try {
            if (!message.lineNumber) {
                throw new Error('Line number is required');
            }

            if (!documentUri) {
                throw new Error('No document URI provided');
            }

            // Read current file content
            const fileContent = await vscode.workspace.fs.readFile(documentUri);
            const lines = Buffer.from(fileContent).toString('utf8').split('\n');
            
            // Delete the specific line (lineNumber is 1-based)
            const lineIndex = message.lineNumber - 1;
            if (lineIndex >= 0 && lineIndex < lines.length) {
                lines.splice(lineIndex, 1);
            } else {
                throw new Error(`Line ${message.lineNumber} is out of range`);
            }

            // Write back to file
            const newContent = lines.join('\n');
            await vscode.workspace.fs.writeFile(documentUri, Buffer.from(newContent, 'utf8'));
            
            console.log(`Deleted line ${message.lineNumber} in ${documentUri.fsPath}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to delete line: ${errorMessage}`);
            console.error('Error deleting line:', error);
        }
    }

    private static async handleInsertLine(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        try {
            if (!message.lineNumber || !message.content) {
                throw new Error('Line number and content are required');
            }

            if (!documentUri) {
                throw new Error('No document URI provided');
            }

            // Read current file content
            const fileContent = await vscode.workspace.fs.readFile(documentUri);
            const lines = Buffer.from(fileContent).toString('utf8').split('\n');
            
            // Insert the new line (lineNumber is 1-based)
            const lineIndex = message.lineNumber - 1;
            if (lineIndex >= 0 && lineIndex <= lines.length) {
                lines.splice(lineIndex, 0, message.content);
            } else {
                throw new Error(`Line ${message.lineNumber} is out of range`);
            }

            // Write back to file
            const newContent = lines.join('\n');
            await vscode.workspace.fs.writeFile(documentUri, Buffer.from(newContent, 'utf8'));
            
            console.log(`Inserted line ${message.lineNumber} in ${documentUri.fsPath}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to insert line: ${errorMessage}`);
            console.error('Error inserting line:', error);
        }
    }

    private static async handleInsertMultipleLines(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        try {
            console.log('🔍 handleInsertMultipleLines called with:', {
                message: message,
                documentUri: documentUri?.fsPath
            });

            if (!message.data || message.data.afterLineNumber === undefined || !Array.isArray(message.data.lines)) {
                throw new Error('After line number and lines array are required');
            }

            if (!documentUri) {
                throw new Error('No document URI provided');
            }

            // Read current file content
            const fileContent = await vscode.workspace.fs.readFile(documentUri);
            const lines = Buffer.from(fileContent).toString('utf8').split('\n');
            
            console.log('📄 Current file has', lines.length, 'lines');
            console.log('📍 afterLineNumber:', message.data.afterLineNumber);
            console.log('📝 Lines to insert:', message.data.lines);
            
            // Insert lines after the specified line number (afterLineNumber is 1-based line number)
            const insertIndex = message.data.afterLineNumber; // Insert after this line (1-based line number)
            console.log('🎯 Insert index:', insertIndex);
            
            if (insertIndex >= 0 && insertIndex <= lines.length) {
                lines.splice(insertIndex, 0, ...message.data.lines);
                console.log('✅ Lines inserted, new total:', lines.length);
            } else {
                throw new Error(`Line ${message.data.afterLineNumber} is out of range`);
            }

            // Write back to file
            const newContent = lines.join('\n');
            await vscode.workspace.fs.writeFile(documentUri, Buffer.from(newContent, 'utf8'));
            
            console.log(`✅ Inserted ${message.data.lines.length} lines after line ${message.data.afterLineNumber} in ${documentUri.fsPath}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to insert lines: ${errorMessage}`);
            console.error('❌ Error inserting lines:', error);
        }
    }

    private static async handleDeleteMultipleLines(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        try {
            if (!message.data || !Array.isArray(message.data.lineNumbers)) {
                throw new Error('Line numbers array is required');
            }

            if (!documentUri) {
                throw new Error('No document URI provided');
            }

            // Read current file content
            const fileContent = await vscode.workspace.fs.readFile(documentUri);
            const lines = Buffer.from(fileContent).toString('utf8').split('\n');
            
            // Sort line numbers in descending order to avoid index shifting issues
            const sortedLineNumbers = message.data.lineNumbers.sort((a: number, b: number) => b - a);
            
            // Delete lines from highest to lowest index
            sortedLineNumbers.forEach((lineNumber: number) => {
                const lineIndex = lineNumber - 1; // Convert to 0-based index
                if (lineIndex >= 0 && lineIndex < lines.length) {
                    lines.splice(lineIndex, 1);
                }
            });

            // Write back to file
            const newContent = lines.join('\n');
            await vscode.workspace.fs.writeFile(documentUri, Buffer.from(newContent, 'utf8'));
            
            console.log(`Deleted lines ${sortedLineNumbers.join(', ')} in ${documentUri.fsPath}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to delete lines: ${errorMessage}`);
            console.error('Error deleting lines:', error);
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

    private static async handleSaveRegionFile(message: WebviewMessage): Promise<void> {
        try {
            if (!message.fileName || !message.blob) {
                throw new Error('No filename or blob data provided');
            }

            // Show save dialog
            const defaultFileName = this.sanitizeFileName(message.fileName);
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultFileName),
                filters: {
                    'Audio files': ['wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a'],
                    'All files': ['*']
                }
            });

            if (!saveUri) {
                // User cancelled
                return;
            }

            // Convert base64 to buffer and save file
            const audioBuffer = Buffer.from(message.blob, 'base64');
            await vscode.workspace.fs.writeFile(saveUri, audioBuffer);

            // Show success message with file path and info
            const fileSize = (audioBuffer.length / 1024).toFixed(2);
            const duration = message.duration ? `${message.duration}초` : '';
            const timeRange = message.startTime && message.endTime 
                ? `(${message.startTime}s - ${message.endTime}s)` 
                : '';
            
            const infoMessage = `오디오 저장 완료!\n파일: ${path.basename(saveUri.fsPath)}\n위치: ${saveUri.fsPath}\n크기: ${fileSize} KB${duration ? `\n길이: ${duration}` : ''}${timeRange ? `\n${timeRange}` : ''}`;
            
            vscode.window.showInformationMessage(`오디오 저장 완료: ${path.basename(saveUri.fsPath)} (${fileSize} KB)`, '파일 위치 열기')
                .then(selection => {
                    if (selection === '파일 위치 열기') {
                        vscode.commands.executeCommand('revealFileInOS', saveUri);
                    }
                });

            console.log('Region file saved successfully:', saveUri.fsPath);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`오디오 저장 실패: ${errorMessage}`);
            console.error('Error saving region file:', error);
        }
    }

    private static async handleDownloadFile(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        try {
            console.log('Download file request:', message);
            
            if (!documentUri) {
                vscode.window.showErrorMessage('No document URI available for download');
                return;
            }

            const originalFileName = path.basename(documentUri.fsPath);
            const fileName = message.fileName || originalFileName || 'audio_file';
            
            console.log('Downloading file:', documentUri.fsPath, 'as', fileName);
            
            // Show save dialog with proper default filename
            const defaultFileName = this.sanitizeFileName(fileName);
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultFileName),
                filters: {
                    'Audio files': ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
                    'All files': ['*']
                }
            });

            if (saveUri) {
                try {
                    console.log('Attempting to read file:', documentUri.fsPath);
                    
                    // Read the file content first
                    const fileData = await vscode.workspace.fs.readFile(documentUri);
                    console.log('File read successfully, size:', fileData.length, 'bytes');
                    
                    // Write to the new location
                    console.log('Writing to:', saveUri.fsPath);
                    await vscode.workspace.fs.writeFile(saveUri, fileData);
                    
                    vscode.window.showInformationMessage(`File downloaded successfully: ${saveUri.fsPath}`);
                    console.log('File downloaded to:', saveUri.fsPath);
                } catch (copyError) {
                    console.error('Error downloading file:', copyError);
                    console.error('Error details:', {
                        name: (copyError as any)?.name,
                        message: (copyError as any)?.message,
                        code: (copyError as any)?.code
                    });
                    
                    // Try alternative method: use Node.js fs module
                    try {
                        console.log('Trying alternative download method...');
                        const fs = require('fs');
                        const fileData = fs.readFileSync(documentUri.fsPath);
                        fs.writeFileSync(saveUri.fsPath, fileData);
                        
                        vscode.window.showInformationMessage(`File downloaded successfully: ${saveUri.fsPath}`);
                        console.log('File downloaded using Node.js fs to:', saveUri.fsPath);
                    } catch (fsError) {
                        console.error('Node.js fs method also failed:', fsError);
                        
                        // Final fallback: try to open the file location
                        try {
                            await vscode.commands.executeCommand('revealFileInOS', documentUri);
                            vscode.window.showInformationMessage('Please manually copy the file from the revealed location');
                        } catch (revealError) {
                            vscode.window.showErrorMessage(`Failed to download file: ${copyError}. Please try copying the file manually.`);
                        }
                    }
                }
            } else {
                console.log('Download cancelled by user');
            }
            
        } catch (error) {
            console.error('Error handling download request:', error);
            vscode.window.showErrorMessage(`Download failed: ${error}`);
        }
    }

    private static sanitizeFileName(fileName: string): string {
        // Remove or replace invalid characters for file names
        return fileName
            .replace(/[<>:"/\\|?*]/g, '_')  // Replace invalid characters with underscore
            .replace(/\s+/g, '_')           // Replace spaces with underscore
            .replace(/_{2,}/g, '_')          // Replace multiple underscores with single
            .replace(/^_|_$/g, '')          // Remove leading/trailing underscores
            .substring(0, 255);              // Limit length
    }
}
