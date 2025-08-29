import * as vscode from 'vscode';
import { AudioViewerProvider } from './audioViewerProvider';
import { ImageViewerProvider } from './imageViewerProvider';
import { VideoViewerProvider } from './videoViewerProvider';
import { CsvViewerProvider } from './csvViewerProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Omni Viewer extension is now active!');

    // Register custom editors
    const audioViewerProvider = new AudioViewerProvider(context);
    const imageViewerProvider = new ImageViewerProvider(context);
    const videoViewerProvider = new VideoViewerProvider(context);
    const csvViewerProvider = new CsvViewerProvider(context);

    // Register commands
    const openAudioViewer = vscode.commands.registerCommand('omni-viewer.openAudioViewer', (uri: vscode.Uri) => {
        if (uri) {
            vscode.commands.executeCommand('vscode.openWith', uri, 'omni-viewer.audioViewer');
        } else {
            vscode.window.showErrorMessage('No audio file selected');
        }
    });

    const openImageViewer = vscode.commands.registerCommand('omni-viewer.openImageViewer', (uri: vscode.Uri) => {
        if (uri) {
            vscode.commands.executeCommand('vscode.openWith', uri, 'omni-viewer.imageViewer');
        } else {
            vscode.window.showErrorMessage('No image file selected');
        }
    });

    const openVideoViewer = vscode.commands.registerCommand('omni-viewer.openVideoViewer', (uri: vscode.Uri) => {
        if (uri) {
            vscode.commands.executeCommand('vscode.openWith', uri, 'omni-viewer.videoViewer');
        } else {
            vscode.window.showErrorMessage('No video file selected');
        }
    });

    const openCsvViewer = vscode.commands.registerCommand('omni-viewer.openCsvViewer', (uri: vscode.Uri) => {
        if (uri) {
            vscode.commands.executeCommand('vscode.openWith', uri, 'omni-viewer.csvViewer');
        } else {
            vscode.window.showErrorMessage('No CSV file selected');
        }
    });

    // Register custom editors
    const audioEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.audioViewer',
        audioViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    const imageEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.imageViewer',
        imageViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    const videoEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.videoViewer',
        videoViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    const csvEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.csvViewer',
        csvViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    context.subscriptions.push(
        openAudioViewer,
        openImageViewer,
        openVideoViewer,
        openCsvViewer,
        audioEditorRegistration,
        imageEditorRegistration,
        videoEditorRegistration,
        csvEditorRegistration
    );
}

export function deactivate() {
    console.log('Omni Viewer extension is now deactivated!');
}
