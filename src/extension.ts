import * as vscode from 'vscode';
import { FileUtils, OmniViewerViewType } from './utils/fileUtils';
import { VIEWER_REGISTRATIONS } from './viewerRegistry';
import { refreshActiveViewer } from './viewerProviderUtils';
import { openSharedLinkCommand, shareFileCommand } from './shareCommand';

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Omni Viewer extension is now active!');
    console.log('📁 Extension path:', context.extensionPath);

    const openViewerWithSignatureCheck = async (uri: vscode.Uri | undefined, requestedViewType: OmniViewerViewType, missingMessage: string) => {
        if (!uri) {
            vscode.window.showErrorMessage(missingMessage);
            return;
        }

        const detection = await FileUtils.detectViewerType(uri.fsPath, requestedViewType);
        const targetViewType = detection.viewType ?? requestedViewType;

        if (targetViewType !== requestedViewType) {
            vscode.window.showWarningMessage(`Opened with a different viewer because the file signature matched ${targetViewType}. ${detection.reason}`);
        }

        await vscode.commands.executeCommand('vscode.openWith', uri, targetViewType);
    };

    const registrations = VIEWER_REGISTRATIONS.flatMap((registration) => {
        const provider = registration.createProvider(context);
        const openCommand = vscode.commands.registerCommand(registration.command, async (uri: vscode.Uri) => {
            await openViewerWithSignatureCheck(uri, registration.viewType, registration.missingMessage);
        });
        const editorRegistration = vscode.window.registerCustomEditorProvider(
            registration.viewType,
            provider,
            {
                webviewOptions: { retainContextWhenHidden: registration.retainContextWhenHidden },
                supportsMultipleEditorsPerDocument: false
            }
        );

        return [openCommand, editorRegistration];
    });

    const refreshCommand = vscode.commands.registerCommand('omni-viewer.refresh', refreshActiveViewer);
    const shareCommand = vscode.commands.registerCommand('omni-viewer.shareFile', shareFileCommand);
    const openSharedLinkRegistration = vscode.commands.registerCommand('omni-viewer.openSharedLink', openSharedLinkCommand);

    context.subscriptions.push(...registrations, refreshCommand, shareCommand, openSharedLinkRegistration);
}

export function deactivate() {
    console.log('Omni Viewer extension is now deactivated!');
}
