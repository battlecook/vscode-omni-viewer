import * as vscode from 'vscode';
import { AudioViewerProvider } from './audioViewerProvider';
import { CsvViewerProvider } from './csvViewerProvider';
import { ExcelViewerProvider } from './excelViewerProvider';
import { HwpViewerProvider } from './hwpViewerProvider';
import { ImageViewerProvider } from './imageViewerProvider';
import { JsonlViewerProvider } from './jsonlViewerProvider';
import { ParquetViewerProvider } from './parquetViewerProvider';
import { PdfViewerProvider } from './pdfViewerProvider';
import { PptViewerProvider } from './pptViewerProvider';
import { PsdViewerProvider } from './psdViewerProvider';
import { VideoViewerProvider } from './videoViewerProvider';
import { WordViewerProvider } from './wordViewerProvider';
import { OmniViewerViewType } from './utils/fileUtils';

export interface ViewerRegistration {
    viewType: OmniViewerViewType;
    command: string;
    missingMessage: string;
    retainContextWhenHidden: boolean;
    createProvider: (context: vscode.ExtensionContext) => vscode.CustomReadonlyEditorProvider;
}

export const VIEWER_REGISTRATIONS: ViewerRegistration[] = [
    {
        viewType: AudioViewerProvider.viewType,
        command: 'omni-viewer.openAudioViewer',
        missingMessage: 'No audio file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new AudioViewerProvider(context)
    },
    {
        viewType: ImageViewerProvider.viewType,
        command: 'omni-viewer.openImageViewer',
        missingMessage: 'No image file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ImageViewerProvider(context)
    },
    {
        viewType: VideoViewerProvider.viewType,
        command: 'omni-viewer.openVideoViewer',
        missingMessage: 'No video file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new VideoViewerProvider(context)
    },
    {
        viewType: CsvViewerProvider.viewType,
        command: 'omni-viewer.openCsvViewer',
        missingMessage: 'No CSV file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new CsvViewerProvider(context)
    },
    {
        viewType: JsonlViewerProvider.viewType,
        command: 'omni-viewer.openJsonlViewer',
        missingMessage: 'No JSONL file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new JsonlViewerProvider(context)
    },
    {
        viewType: ParquetViewerProvider.viewType,
        command: 'omni-viewer.openParquetViewer',
        missingMessage: 'No Parquet file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ParquetViewerProvider(context)
    },
    {
        viewType: HwpViewerProvider.viewType,
        command: 'omni-viewer.openHwpViewer',
        missingMessage: 'No HWP file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new HwpViewerProvider(context)
    },
    {
        viewType: PsdViewerProvider.viewType,
        command: 'omni-viewer.openPsdViewer',
        missingMessage: 'No PSD file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new PsdViewerProvider(context)
    },
    {
        viewType: ExcelViewerProvider.viewType,
        command: 'omni-viewer.openExcelViewer',
        missingMessage: 'No Excel file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ExcelViewerProvider(context)
    },
    {
        viewType: WordViewerProvider.viewType,
        command: 'omni-viewer.openWordViewer',
        missingMessage: 'No Word file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new WordViewerProvider(context)
    },
    {
        viewType: PdfViewerProvider.viewType,
        command: 'omni-viewer.openPdfViewer',
        missingMessage: 'No PDF file selected',
        retainContextWhenHidden: false,
        createProvider: (context) => new PdfViewerProvider(context)
    },
    {
        viewType: PptViewerProvider.viewType,
        command: 'omni-viewer.openPptViewer',
        missingMessage: 'No PowerPoint file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new PptViewerProvider(context)
    }
];
