import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class AudioViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.audioViewer';
    private static readonly CHUNKED_LARGE_FILE_EXTENSIONS = new Set(['.wav']);

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
        configureWebview(this.context, webviewPanel);

        const audioUri = document.uri;
        const audioPath = audioUri.fsPath;
        const audioFileName = path.basename(audioPath);

        // Add the file's parent directory to localResourceRoots so the webview can load the file
        const fileDir = vscode.Uri.file(path.dirname(audioPath));
        const existingRoots = webviewPanel.webview.options.localResourceRoots || [];
        webviewPanel.webview.options = {
            ...webviewPanel.webview.options,
            enableScripts: true,
            localResourceRoots: [...existingRoots, fileDir]
        };

        try {
            if (await rerouteIfNeeded(audioUri, AudioViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const largeFile = await FileUtils.isLargeFile(audioPath);
            const supportsChunkedLargeFile = AudioViewerProvider.CHUNKED_LARGE_FILE_EXTENSIONS.has(path.extname(audioPath).toLowerCase());
            const metadata = await FileUtils.getAudioMetadata(audioPath);

            // Use webview URI instead of data URL (eliminates base64 overhead)
            const webviewUri = webviewPanel.webview.asWebviewUri(audioUri).toString();

            const html = await TemplateUtils.loadTemplate(this.context, 'audio/audioViewer.html', {
                fileName: audioFileName,
                audioSrc: webviewUri,
                metadata: JSON.stringify(metadata),
                isLargeFile: String(largeFile),
                supportsChunkedLargeFile: String(supportsChunkedLargeFile)
            });

            webviewPanel.webview.html = html;

            // Set up message listener with custom handler for peak requests
            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri, {
                requestPeaks: async () => {
                    await this.handlePeakRequest(audioPath, webviewPanel);
                },
                requestSpectrogramChunks: async () => {
                    await this.handleSpectrogramChunkRequest(audioPath, webviewPanel);
                }
            });

            // For large files, proactively compute and send peaks
            if (largeFile && supportsChunkedLargeFile) {
                this.handlePeakRequest(audioPath, webviewPanel);
            }

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

    private async handleSpectrogramChunkRequest(audioPath: string, webviewPanel: vscode.WebviewPanel): Promise<void> {
        if (!AudioViewerProvider.CHUNKED_LARGE_FILE_EXTENSIONS.has(path.extname(audioPath).toLowerCase())) {
            webviewPanel.webview.postMessage({
                type: 'pcmChunkError',
                message: 'Chunked spectrogram generation currently supports WAV files only.'
            });
            return;
        }

        try {
            await FileUtils.streamWavPcmChunks(
                audioPath,
                (data, chunkIndex, totalChunks, sampleRate, channels) => {
                    webviewPanel.webview.postMessage({
                        type: 'pcmChunk',
                        data: Array.from(data),
                        chunkIndex,
                        totalChunks,
                        sampleRate,
                        channels
                    });
                },
                () => {
                    webviewPanel.webview.postMessage({ type: 'pcmChunkEnd' });
                }
            );
        } catch (err) {
            console.error('Error streaming PCM chunks:', err);
            webviewPanel.webview.postMessage({ type: 'pcmChunkEnd' });
        }
    }

    private async handlePeakRequest(audioPath: string, webviewPanel: vscode.WebviewPanel): Promise<void> {
        if (!AudioViewerProvider.CHUNKED_LARGE_FILE_EXTENSIONS.has(path.extname(audioPath).toLowerCase())) {
            webviewPanel.webview.postMessage({
                type: 'peakData',
                peaks: null,
                duration: null,
                supported: false,
                message: 'Large-file accelerated preview currently supports WAV files only.'
            });
            return;
        }

        try {
            // Check cache first
            let peakData = await FileUtils.loadCachedPeaks(this.context, audioPath);

            if (!peakData) {
                // Compute peaks
                peakData = await FileUtils.computeAudioPeaks(audioPath);
                if (peakData) {
                    await FileUtils.savePeakCache(this.context, audioPath, peakData);
                }
            }

            if (peakData) {
                webviewPanel.webview.postMessage({
                    type: 'peakData',
                    peaks: peakData.peaks,
                    duration: peakData.duration,
                    supported: true
                });
            } else {
                webviewPanel.webview.postMessage({
                    type: 'peakData',
                    peaks: null,
                    duration: null,
                    supported: false,
                    message: 'Large-file accelerated preview could not generate waveform peaks for this file.'
                });
            }
        } catch (err) {
            console.error('Error computing peaks:', err);
            webviewPanel.webview.postMessage({
                type: 'peakData',
                peaks: null,
                duration: null,
                supported: false,
                message: err instanceof Error ? err.message : 'Failed to prepare accelerated large-file preview.'
            });
        }
    }
}
