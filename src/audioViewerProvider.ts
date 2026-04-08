import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';
import { AudioEngine } from './audioEngine';

const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB

export class AudioViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.audioViewer';
    private audioEngine: AudioEngine | null = null;

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return createReadonlyDocument(uri);
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const audioUri = document.uri;
        const audioPath = audioUri.fsPath;
        const audioFileName = path.basename(audioPath);

        // Configure webview with default options first
        configureWebview(this.context, webviewPanel);

        try {
            if (await rerouteIfNeeded(audioUri, AudioViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const metadata = await FileUtils.getAudioMetadata(audioPath);
            const stats = await fs.promises.stat(audioPath);
            const fileSize = stats.size;
            const isLargeFile = fileSize > LARGE_FILE_THRESHOLD;

            let templateVars: Record<string, string>;

            if (isLargeFile) {
                // Large file: add the audio file's directory to localResourceRoots
                // so the webview can stream the file via MediaElement
                const fileDir = vscode.Uri.file(path.dirname(audioPath));
                const defaultOptions = TemplateUtils.getWebviewOptions(this.context);
                webviewPanel.webview.options = {
                    ...defaultOptions,
                    localResourceRoots: [
                        ...(defaultOptions.localResourceRoots || []),
                        fileDir
                    ]
                };

                // Use WASM engine for peaks/spectrogram
                if (!this.audioEngine) {
                    this.audioEngine = new AudioEngine();
                    await this.audioEngine.init();
                }

                const analysis = await this.audioEngine.analyze(audioPath);
                const audioWebviewUri = webviewPanel.webview.asWebviewUri(audioUri);

                templateVars = {
                    fileName: audioFileName,
                    audioSrc: audioWebviewUri.toString(),
                    metadata: JSON.stringify(metadata),
                    peaks: JSON.stringify(analysis.peaks),
                    duration: String(analysis.duration),
                    spectrogram: JSON.stringify(analysis.spectrogram),
                    sampleRate: String(analysis.sampleRate),
                    mode: 'precomputed'
                };
            } else {
                // Small file: existing base64 data URL approach
                const mimeType = FileUtils.getAudioMimeType(audioPath);
                const audioData = await FileUtils.fileToDataUrl(audioPath, mimeType);

                templateVars = {
                    fileName: audioFileName,
                    audioSrc: audioData,
                    metadata: JSON.stringify(metadata),
                    peaks: '',
                    duration: '',
                    spectrogram: '',
                    sampleRate: '',
                    mode: 'default'
                };
            }

            const html = await TemplateUtils.loadTemplate(this.context, 'audio/audioViewer.html', templateVars);
            webviewPanel.webview.html = html;

            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);

        } catch (error) {
            console.error('Error setting up audio viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(audioFileName, errorMessage, {
                title: 'Failed to load audio file',
                message: 'Unable to load the audio file due to an error:',
                icon: '🎵'
            });
        }
    }
}
