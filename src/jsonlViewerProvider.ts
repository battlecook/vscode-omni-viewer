import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';

export class JsonlViewerProvider implements vscode.CustomEditorProvider {
    public static readonly viewType = 'omni-viewer.jsonlViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        console.log('🔍 JSONL Viewer: resolveCustomEditor called');
        console.log('📄 Document URI:', document.uri.toString());
        
        webviewPanel.webview.options = TemplateUtils.getWebviewOptions(this.context);

        const jsonlUri = document.uri;
        const jsonlPath = jsonlUri.fsPath;
        const jsonlFileName = path.basename(jsonlPath);

        console.log('📁 File path:', jsonlPath);
        console.log('📁 File name:', jsonlFileName);

        try {
            // Read file content directly
            console.log('🔄 Reading file content...');
            const jsonlContent = await FileUtils.readJsonlFile(jsonlPath);
            console.log('✅ File content read:', {
                totalLines: jsonlContent.totalLines,
                validLines: jsonlContent.validLines,
                invalidLines: jsonlContent.invalidLines
            });
            
            const jsonlData = JSON.stringify(jsonlContent);
            console.log('📊 JSON data length:', jsonlData.length);

            console.log('🔄 Loading template...');
            const html = await TemplateUtils.loadTemplate(this.context, 'jsonl/jsonlViewer.html', {
                fileName: jsonlFileName,
                jsonlData: jsonlData
            });
            console.log('✅ Template loaded, HTML length:', html.length);

            webviewPanel.webview.html = html;
            console.log('✅ Webview HTML set successfully');

            // Setup message listener for saving
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);

        } catch (error) {
            console.error('❌ Error setting up JSONL viewer:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
            
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = this.getErrorHtml(jsonlFileName, errorMessage);
        }
    }



    private getErrorHtml(fileName: string, errorMessage: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JSONL Viewer Error - ${fileName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            text-align: center;
            padding: 20px;
        }
        .error-container {
            max-width: 500px;
        }
        .error-icon {
            font-size: 48px;
            margin-bottom: 20px;
        }
        .error-title {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 10px;
            color: var(--vscode-errorForeground);
        }
        .error-message {
            font-size: 14px;
            line-height: 1.5;
            margin-bottom: 20px;
        }
        .file-name {
            font-family: 'Monaco', 'Menlo', monospace;
            background: var(--vscode-textBlockQuote-background);
            padding: 8px 12px;
            border-radius: 4px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">📄</div>
        <div class="error-title">Failed to load JSONL file</div>
        <div class="error-message">
            Unable to load the JSONL file due to an error:
        </div>
        <div class="file-name">${fileName}</div>
        <div class="error-message">
            ${errorMessage}
        </div>
    </div>
</body>
</html>`;
    }
}
