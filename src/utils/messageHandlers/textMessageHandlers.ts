import * as vscode from 'vscode';
import { FileUtils } from '../fileUtils';
import { WebviewMessage } from './types';

export class TextMessageHandlers {
    public static async handleSaveChanges(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        try {
            if (!message.data) {
                throw new Error('No data provided for saving');
            }

            const uri = this.resolveDocumentUri(documentUri);

            if (message.data.headers && message.data.rows) {
                const delimiter = message.data.delimiter || FileUtils.getDelimitedFileDelimiter(uri.fsPath);
                const csvContent = this.convertToDelimitedString(message.data.headers, message.data.rows, delimiter);
                await vscode.workspace.fs.writeFile(uri, Buffer.from(csvContent, 'utf8'));
                return;
            }

            if (message.data.content) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(message.data.content, 'utf8'));
                return;
            }

            if (message.text) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(message.text, 'utf8'));
                return;
            }

            throw new Error('No content provided for saving');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to save file: ${errorMessage}`);
            console.error('Error saving file:', error);
        }
    }

    public static async handleUpdateLine(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        await this.updateLines(documentUri, (lines) => {
            if (!message.lineNumber || message.content === undefined) {
                throw new Error('Line number and content are required');
            }

            const lineIndex = message.lineNumber - 1;
            if (lineIndex < 0 || lineIndex >= lines.length) {
                throw new Error(`Line ${message.lineNumber} is out of range (file has ${lines.length} lines)`);
            }

            lines[lineIndex] = message.content;
            return lines;
        }, 'update line');
    }

    public static async handleDeleteLine(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        await this.updateLines(documentUri, (lines) => {
            if (!message.lineNumber) {
                throw new Error('Line number is required');
            }

            const lineIndex = message.lineNumber - 1;
            if (lineIndex < 0 || lineIndex >= lines.length) {
                throw new Error(`Line ${message.lineNumber} is out of range`);
            }

            lines.splice(lineIndex, 1);
            return lines;
        }, 'delete line');
    }

    public static async handleInsertLine(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        await this.updateLines(documentUri, (lines) => {
            if (!message.lineNumber || message.content === undefined) {
                throw new Error('Line number and content are required');
            }

            const lineIndex = message.lineNumber - 1;
            if (lineIndex < 0 || lineIndex > lines.length) {
                throw new Error(`Line ${message.lineNumber} is out of range`);
            }

            lines.splice(lineIndex, 0, message.content);
            return lines;
        }, 'insert line');
    }

    public static async handleInsertMultipleLines(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        await this.updateLines(documentUri, (lines) => {
            if (!message.data || message.data.afterLineNumber === undefined || !Array.isArray(message.data.lines)) {
                throw new Error('After line number and lines array are required');
            }

            const insertIndex = message.data.afterLineNumber;
            if (insertIndex < 0 || insertIndex > lines.length) {
                throw new Error(`Line ${message.data.afterLineNumber} is out of range`);
            }

            lines.splice(insertIndex, 0, ...message.data.lines);
            return lines;
        }, 'insert lines');
    }

    public static async handleDeleteMultipleLines(message: WebviewMessage, documentUri?: vscode.Uri): Promise<void> {
        await this.updateLines(documentUri, (lines) => {
            if (!message.data || !Array.isArray(message.data.lineNumbers)) {
                throw new Error('Line numbers array is required');
            }

            const sortedLineNumbers = [...message.data.lineNumbers].sort((a: number, b: number) => b - a);
            sortedLineNumbers.forEach((lineNumber: number) => {
                const lineIndex = lineNumber - 1;
                if (lineIndex >= 0 && lineIndex < lines.length) {
                    lines.splice(lineIndex, 1);
                }
            });

            return lines;
        }, 'delete lines');
    }

    public static convertToDelimitedString(headers: string[], rows: string[][], delimiter = ','): string {
        const escapeDelimitedValue = (value: string): string => {
            if (value === null || value === undefined) {
                return '';
            }

            const stringValue = String(value);
            if (stringValue.includes(delimiter) || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }

            return stringValue;
        };

        const headerLine = headers.map(escapeDelimitedValue).join(delimiter);
        const rowLines = rows.map((row) => row.map(escapeDelimitedValue).join(delimiter));
        return [headerLine, ...rowLines].join('\n');
    }

    private static resolveDocumentUri(documentUri?: vscode.Uri): vscode.Uri {
        if (documentUri) {
            return documentUri;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            throw new Error('No active document found');
        }

        return activeEditor.document.uri;
    }

    private static async updateLines(
        documentUri: vscode.Uri | undefined,
        updater: (lines: string[]) => string[],
        operation: string
    ): Promise<void> {
        try {
            const uri = this.resolveDocumentUri(documentUri);
            const fileContent = await vscode.workspace.fs.readFile(uri);
            const lines = Buffer.from(fileContent).toString('utf8').split('\n');
            const newContent = updater(lines).join('\n');
            await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, 'utf8'));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to ${operation}: ${errorMessage}`);
            console.error(`Error during ${operation}:`, error);
        }
    }
}
