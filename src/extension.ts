import * as vscode from 'vscode';
import { AudioViewerProvider } from './audioViewerProvider';
import { ImageViewerProvider } from './imageViewerProvider';
import { VideoViewerProvider } from './videoViewerProvider';
import { CsvViewerProvider } from './csvViewerProvider';
import { JsonlViewerProvider } from './jsonlViewerProvider';
import { ParquetViewerProvider } from './parquetViewerProvider';
import { HwpViewerProvider } from './hwpViewerProvider';
import { PsdViewerProvider } from './psdViewerProvider';
import { ExcelViewerProvider } from './excelViewerProvider';
import { WordViewerProvider } from './wordViewerProvider';
import { PdfViewerProvider } from './pdfViewerProvider';
import { PptViewerProvider } from './pptViewerProvider';
import { FileUtils, OmniViewerViewType } from './utils/fileUtils';

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
    const excelViewerProvider = new ExcelViewerProvider(context);
    const wordViewerProvider = new WordViewerProvider(context);
    const pdfViewerProvider = new PdfViewerProvider(context);
    const pptViewerProvider = new PptViewerProvider(context);

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

    // Register commands
    const openAudioViewer = vscode.commands.registerCommand('omni-viewer.openAudioViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.audioViewer', 'No audio file selected');
    });

    const openImageViewer = vscode.commands.registerCommand('omni-viewer.openImageViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.imageViewer', 'No image file selected');
    });

    const openVideoViewer = vscode.commands.registerCommand('omni-viewer.openVideoViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.videoViewer', 'No video file selected');
    });

    const openCsvViewer = vscode.commands.registerCommand('omni-viewer.openCsvViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.csvViewer', 'No CSV file selected');
    });

    const openJsonlViewer = vscode.commands.registerCommand('omni-viewer.openJsonlViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.jsonlViewer', 'No JSONL file selected');
    });

    const openParquetViewer = vscode.commands.registerCommand('omni-viewer.openParquetViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.parquetViewer', 'No Parquet file selected');
    });

    const openHwpViewer = vscode.commands.registerCommand('omni-viewer.openHwpViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.hwpViewer', 'No HWP file selected');
    });

    const openPsdViewer = vscode.commands.registerCommand('omni-viewer.openPsdViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.psdViewer', 'No PSD file selected');
    });

    const openExcelViewer = vscode.commands.registerCommand('omni-viewer.openExcelViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.excelViewer', 'No Excel file selected');
    });

    const openWordViewer = vscode.commands.registerCommand('omni-viewer.openWordViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.wordViewer', 'No Word file selected');
    });

    const openPptViewer = vscode.commands.registerCommand('omni-viewer.openPptViewer', async (uri: vscode.Uri) => {
        await openViewerWithSignatureCheck(uri, 'omni-viewer.pptViewer', 'No PowerPoint file selected');
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

    const excelEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.excelViewer',
        excelViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    const wordEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.wordViewer',
        wordViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    );

    const pdfEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.pdfViewer',
        pdfViewerProvider,
        {
            webviewOptions: { retainContextWhenHidden: false },
            supportsMultipleEditorsPerDocument: false
        }
    );

    const pptEditorRegistration = vscode.window.registerCustomEditorProvider(
        'omni-viewer.pptViewer',
        pptViewerProvider,
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
        openExcelViewer,
        openWordViewer,
        openPptViewer,
        audioEditorRegistration,
        imageEditorRegistration,
        videoEditorRegistration,
        csvEditorRegistration,
        jsonlEditorRegistration,
        parquetEditorRegistration,
        hwpEditorRegistration,
        psdEditorRegistration,
        excelEditorRegistration,
        wordEditorRegistration,
        pdfEditorRegistration,
        pptEditorRegistration
    );
}

export function deactivate() {
    console.log('Omni Viewer extension is now deactivated!');
}
