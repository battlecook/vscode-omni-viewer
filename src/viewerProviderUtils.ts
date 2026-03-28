import * as vscode from 'vscode';
import { TemplateUtils } from './utils/templateUtils';
import { FileUtils, OmniViewerViewType } from './utils/fileUtils';

export interface ViewerErrorContent {
    title: string;
    message: string;
    icon: string;
    lang?: string;
}

export interface ViewerProviderContext {
    context: vscode.ExtensionContext;
    document: vscode.CustomDocument;
    webviewPanel: vscode.WebviewPanel;
    viewType: OmniViewerViewType;
}

export function createReadonlyDocument(uri: vscode.Uri): vscode.CustomDocument {
    return {
        uri,
        dispose: () => {}
    };
}

export function configureWebview(
    context: vscode.ExtensionContext,
    webviewPanel: vscode.WebviewPanel
): void {
    webviewPanel.webview.options = TemplateUtils.getWebviewOptions(context);
}

export async function rerouteIfNeeded(
    documentUri: vscode.Uri,
    requestedViewType: OmniViewerViewType,
    webviewPanel: vscode.WebviewPanel
): Promise<boolean> {
    const detection = await FileUtils.detectViewerType(documentUri.fsPath, requestedViewType);
    if (!detection.viewType || detection.viewType === requestedViewType) {
        return false;
    }

    await vscode.commands.executeCommand('vscode.openWith', documentUri, detection.viewType);
    webviewPanel.dispose();
    return true;
}

export function renderErrorHtml(
    fileName: string,
    errorMessage: string,
    content: ViewerErrorContent
): string {
    const lang = content.lang || 'en';

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${content.title} - ${fileName}</title>
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
            min-height: 100vh;
        }
        .error-container {
            max-width: 560px;
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
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">${content.icon}</div>
        <div class="error-title">${content.title}</div>
        <div class="error-message">${content.message}</div>
        <div class="file-name">${fileName}</div>
        <div class="error-message">${errorMessage}</div>
    </div>
</body>
</html>`;
}
