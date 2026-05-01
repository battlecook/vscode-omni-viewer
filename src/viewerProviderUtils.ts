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

interface RefreshableViewer {
    uri: vscode.Uri;
    viewType: OmniViewerViewType;
    webviewPanel: vscode.WebviewPanel;
    refresh: () => Promise<void>;
}

const refreshableViewers = new Map<string, RefreshableViewer>();
const refreshDisposeKeys = new WeakMap<vscode.WebviewPanel, Set<string>>();
const panelDisposables = new WeakMap<vscode.WebviewPanel, Map<string, vscode.Disposable>>();
const refreshTokenSource = new vscode.CancellationTokenSource();

export const refreshCancellationToken = refreshTokenSource.token;

function getViewerKey(uri: vscode.Uri, viewType: string): string {
    return `${viewType}:${uri.toString()}`;
}

function getActiveCustomEditorInput(): { uri?: vscode.Uri; viewType?: string } | undefined {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = activeTab?.input as { uri?: vscode.Uri; viewType?: string } | undefined;
    return input;
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

export function registerRefreshableViewer(
    documentUri: vscode.Uri,
    viewType: OmniViewerViewType,
    webviewPanel: vscode.WebviewPanel,
    refresh: () => Promise<void>
): void {
    const key = getViewerKey(documentUri, viewType);
    refreshableViewers.set(key, {
        uri: documentUri,
        viewType,
        webviewPanel,
        refresh
    });

    let disposeKeys = refreshDisposeKeys.get(webviewPanel);
    if (!disposeKeys) {
        disposeKeys = new Set<string>();
        refreshDisposeKeys.set(webviewPanel, disposeKeys);
    }

    if (!disposeKeys.has(key)) {
        disposeKeys.add(key);
        webviewPanel.onDidDispose(() => {
            const current = refreshableViewers.get(key);
            if (current?.webviewPanel === webviewPanel) {
                refreshableViewers.delete(key);
            }
        });
    }
}

export function replacePanelDisposable(
    webviewPanel: vscode.WebviewPanel,
    key: string,
    disposable: vscode.Disposable
): void {
    let disposables = panelDisposables.get(webviewPanel);
    if (!disposables) {
        disposables = new Map<string, vscode.Disposable>();
        panelDisposables.set(webviewPanel, disposables);
        webviewPanel.onDidDispose(() => {
            for (const item of disposables?.values() || []) {
                item.dispose();
            }
            disposables?.clear();
        });
    }

    disposables.get(key)?.dispose();
    disposables.set(key, disposable);
}

export async function refreshActiveViewer(): Promise<void> {
    const input = getActiveCustomEditorInput();
    if (!input?.uri || !input.viewType) {
        vscode.window.showWarningMessage('No Omni Viewer editor is active.');
        return;
    }

    const viewer = refreshableViewers.get(getViewerKey(input.uri, input.viewType));
    if (!viewer) {
        vscode.window.showWarningMessage('The active Omni Viewer editor cannot be refreshed.');
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: `Refreshing ${vscode.workspace.asRelativePath(viewer.uri, false)}`
        },
        async () => {
            await viewer.refresh();
        }
    );
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
