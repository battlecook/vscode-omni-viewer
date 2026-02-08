import * as vscode from 'vscode';
import { AudioViewerProvider } from './audioViewerProvider';
import { ImageViewerProvider } from './imageViewerProvider';
import { VideoViewerProvider } from './videoViewerProvider';
import { CsvViewerProvider } from './csvViewerProvider';
import { JsonlViewerProvider } from './jsonlViewerProvider';
import { ParquetViewerProvider } from './parquetViewerProvider';
import { HwpViewerProvider } from './hwpViewerProvider';
import { PsdViewerProvider } from './psdViewerProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Omni Viewer extension is now active!');
    console.log('📁 Extension path:', context.extensionPath);

    // Register custom editors
    const audioViewerProvider = new AudioViewerProvider(context);
    const imageViewerProvider = new ImageViewerProvider(context);
    const videoViewerProvider = new VideoViewerProvider(context);
    const csvViewerProvider = new CsvViewerProvider(context);
    const jsonlViewerProvider = new JsonlViewerProvider(context);
    const parquetViewerProvider = new ParquetViewerProvider(context);
    const hwpViewerProvider = new HwpViewerProvider(context);
    const psdViewerProvider = new PsdViewerProvider(context);

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

    const openJsonlViewer = vscode.commands.registerCommand('omni-viewer.openJsonlViewer', (uri: vscode.Uri) => {
        if (uri) {
            vscode.commands.executeCommand('vscode.openWith', uri, 'omni-viewer.jsonlViewer');
        } else {
            vscode.window.showErrorMessage('No JSONL file selected');
        }
    });

    const openParquetViewer = vscode.commands.registerCommand('omni-viewer.openParquetViewer', (uri: vscode.Uri) => {
        if (uri) {
            vscode.commands.executeCommand('vscode.openWith', uri, 'omni-viewer.parquetViewer');
        } else {
            vscode.window.showErrorMessage('No Parquet file selected');
        }
    });

    const openHwpViewer = vscode.commands.registerCommand('omni-viewer.openHwpViewer', (uri: vscode.Uri) => {
        if (uri) {
            vscode.commands.executeCommand('vscode.openWith', uri, 'omni-viewer.hwpViewer');
        } else {
            vscode.window.showErrorMessage('No HWP file selected');
        }
    });

    const openPsdViewer = vscode.commands.registerCommand('omni-viewer.openPsdViewer', (uri: vscode.Uri) => {
        if (uri) {
            vscode.commands.executeCommand('vscode.openWith', uri, 'omni-viewer.psdViewer');
        } else {
            vscode.window.showErrorMessage('No PSD file selected');
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

    console.log('🔄 Registering JSONL custom editor provider...');
    const jsonlEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.jsonlViewer',
        jsonlViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );
    console.log('✅ JSONL custom editor provider registered');

    const parquetEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.parquetViewer',
        parquetViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    const hwpEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.hwpViewer',
        hwpViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    const psdEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.psdViewer',
        psdViewerProvider,
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
        openJsonlViewer,
        openParquetViewer,
        openHwpViewer,
        openPsdViewer,
        audioEditorRegistration,
        imageEditorRegistration,
        videoEditorRegistration,
        csvEditorRegistration,
        jsonlEditorRegistration,
        parquetEditorRegistration,
        hwpEditorRegistration,
        psdEditorRegistration
    );
}

export function deactivate() {
    console.log('Omni Viewer extension is now deactivated!');
}
