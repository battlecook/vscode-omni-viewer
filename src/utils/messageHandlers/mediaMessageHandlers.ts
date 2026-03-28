import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { WebviewMessage } from './types';

export class MediaMessageHandlers {
    public static async handleSaveFilteredImage(message: WebviewMessage): Promise<void> {
        try {
            if (!message.fileName || !message.imageData) {
                throw new Error('No filename or image data provided');
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('No workspace folder found');
            }

            const workspaceFolder = workspaceFolders[0];
            const filePath = path.join(workspaceFolder.uri.fsPath, message.fileName);

            if (fs.existsSync(filePath)) {
                const overwrite = await vscode.window.showWarningMessage(
                    `File "${message.fileName}" already exists. Do you want to overwrite it?`,
                    'Yes',
                    'No'
                );
                if (overwrite !== 'Yes') {
                    return;
                }
            }

            const imageBuffer = Buffer.from(message.imageData, 'base64');
            fs.writeFileSync(filePath, imageBuffer);

            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            vscode.window.showInformationMessage(`Filtered image saved: ${relativePath}`);

            const openFile = await vscode.window.showInformationMessage(
                'Filtered image saved successfully!',
                'Open File',
                'Show in Explorer'
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

    public static async handleSaveRegionFile(message: WebviewMessage): Promise<void> {
        try {
            if (!message.fileName || !message.blob) {
                throw new Error('No filename or blob data provided');
            }

            const defaultFileName = this.sanitizeFileName(message.fileName);
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultFileName),
                filters: {
                    'Audio files': ['wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a'],
                    'All files': ['*']
                }
            });

            if (!saveUri) {
                return;
            }

            const audioBuffer = Buffer.from(message.blob, 'base64');
            await vscode.workspace.fs.writeFile(saveUri, audioBuffer);

            const fileSize = (audioBuffer.length / 1024).toFixed(2);
            vscode.window.showInformationMessage(
                `오디오 저장 완료: ${path.basename(saveUri.fsPath)} (${fileSize} KB)`,
                '파일 위치 열기'
            ).then((selection) => {
                if (selection === '파일 위치 열기') {
                    vscode.commands.executeCommand('revealFileInOS', saveUri);
                }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`오디오 저장 실패: ${errorMessage}`);
            console.error('Error saving region file:', error);
        }
    }

    public static async handleDownloadFile(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        try {
            if (!documentUri) {
                vscode.window.showErrorMessage('No document URI available for download');
                return;
            }

            const originalFileName = path.basename(documentUri.fsPath);
            const fileName = message.fileName || originalFileName || 'audio_file';
            const defaultFileName = this.sanitizeFileName(fileName);
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultFileName),
                filters: {
                    'Audio files': ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
                    'All files': ['*']
                }
            });

            if (!saveUri) {
                return;
            }

            try {
                const fileData = await vscode.workspace.fs.readFile(documentUri);
                await vscode.workspace.fs.writeFile(saveUri, fileData);
                vscode.window.showInformationMessage(`File downloaded successfully: ${saveUri.fsPath}`);
            } catch (copyError) {
                try {
                    const fileData = fs.readFileSync(documentUri.fsPath);
                    fs.writeFileSync(saveUri.fsPath, fileData);
                    vscode.window.showInformationMessage(`File downloaded successfully: ${saveUri.fsPath}`);
                } catch {
                    try {
                        await vscode.commands.executeCommand('revealFileInOS', documentUri);
                        vscode.window.showInformationMessage('Please manually copy the file from the revealed location');
                    } catch {
                        vscode.window.showErrorMessage(`Failed to download file: ${copyError}. Please try copying the file manually.`);
                    }
                }
            }
        } catch (error) {
            console.error('Error handling download request:', error);
            vscode.window.showErrorMessage(`Download failed: ${error}`);
        }
    }

    private static sanitizeFileName(fileName: string): string {
        return fileName
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, 255);
    }
}
