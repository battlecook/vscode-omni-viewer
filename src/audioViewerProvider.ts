import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class AudioViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.audioViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules'))
            ]
        };

        const audioUri = document.uri;
        const audioPath = audioUri.fsPath;
        const audioFileName = path.basename(audioPath);

        // Read the audio file and convert to base64
        let audioData: string;
        try {
            const audioBuffer = await fs.promises.readFile(audioPath);
            const fileSize = audioBuffer.length;
            const maxSize = 50 * 1024 * 1024; // 50MB limit
            
            if (fileSize > maxSize) {
                throw new Error(`File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB). Maximum size is 50MB.`);
            }
            
            const mimeType = this.getMimeType(audioPath);
            audioData = `data:${mimeType};base64,${audioBuffer.toString('base64')}`;
            
            console.log(`Audio file loaded: ${(fileSize / 1024 / 1024).toFixed(2)}MB, MIME type: ${mimeType}`);
        } catch (error) {
            console.error('Error reading audio file:', error);
            audioData = '';
        }

        // Get the webview content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, audioData, audioFileName);

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'log':
                        console.log('Audio Viewer:', message.text);
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(`Audio Viewer Error: ${message.text}`);
                        break;
                }
            }
        );
    }

    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: { [key: string]: string } = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.flac': 'audio/flac',
            '.aac': 'audio/aac',
            '.m4a': 'audio/mp4'
        };
        return mimeTypes[ext] || 'audio/wav';
    }

    private getHtmlForWebview(webview: vscode.Webview, audioData: string, fileName: string): string {
        const audioSrc = audioData;
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Audio Viewer - ${fileName}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            overflow: hidden;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
            padding: 20px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .title {
            font-size: 18px;
            font-weight: 600;
        }

        .controls {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .control-group {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .control-group label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .control-group input, .control-group select {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
        }

        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn:disabled {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: not-allowed;
        }

        .btn.active {
            background: var(--vscode-button-prominentBackground);
            color: var(--vscode-button-prominentForeground);
        }

        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .waveform-container {
            flex: 1;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            position: relative;
        }

        #waveform {
            width: 100%;
            height: 200px;
            background: var(--vscode-editor-background);
        }

        #spectrogram {
            width: 100%;
            height: 200px;
            background: var(--vscode-editor-background);
            margin-top: 20px;
        }

        .playback-controls {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 15px;
            background: var(--vscode-panel-background);
            border-radius: 8px;
            border: 1px solid var(--vscode-panel-border);
        }

        .time-display {
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 14px;
            color: var(--vscode-editor-foreground);
            min-width: 120px;
        }

        .volume-control {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .volume-slider {
            width: 80px;
        }

        .loop-controls {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .loop-input {
            width: 80px;
        }

        .status {
            position: absolute;
            top: 10px;
            right: 10px;
            background: var(--vscode-notifications-background);
            color: var(--vscode-notifications-foreground);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s;
        }

        .status.show {
            opacity: 1;
        }

        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            font-size: 16px;
            color: var(--vscode-descriptionForeground);
        }

        .error {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            color: var(--vscode-errorForeground);
            text-align: center;
            padding: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="title">🎵 ${fileName}</div>
            <div class="controls">
                <div class="control-group">
                    <label>View:</label>
                    <select id="viewMode">
                        <option value="waveform">Waveform</option>
                        <option value="spectrogram" disabled>Spectrogram (Coming Soon)</option>
                        <option value="both" disabled>Both (Coming Soon)</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Loop:</label>
                    <input type="checkbox" id="loopEnabled">
                </div>
                <div class="control-group loop-controls">
                    <label>Start:</label>
                    <input type="number" id="loopStart" class="loop-input" step="0.1" min="0" placeholder="0">
                    <label>End:</label>
                    <input type="number" id="loopEnd" class="loop-input" step="0.1" min="0" placeholder="0">
                </div>
            </div>
        </div>

        <div class="main-content">
            <div class="waveform-container">
                <div id="loading" class="loading">Loading audio file...</div>
                <div id="error" class="error" style="display: none;"></div>
                <div id="waveform"></div>
                <div id="spectrogram" style="display: none;"></div>
                <div id="status" class="status"></div>
            </div>

            <div class="playback-controls">
                <button id="playPause" class="btn">▶️ Play</button>
                <button id="stop" class="btn">⏹️ Stop</button>
                <button id="zoomIn" class="btn">🔍+</button>
                <button id="zoomOut" class="btn">🔍-</button>
                <button id="fitToScreen" class="btn">📐 Fit</button>
                
                <div class="time-display">
                    <div id="currentTime">00:00</div>
                    <div id="duration">00:00</div>
                </div>

                <div class="volume-control">
                    <label>🔊</label>
                    <input type="range" id="volume" class="volume-slider" min="0" max="1" step="0.1" value="0.5">
                </div>
            </div>
        </div>
    </div>

    <script src="https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.min.js"></script>
    <script>
        const vscode = acquireVsCodeApi();
        
        // Audio file source
        const audioSrc = '${audioSrc}';
        
        // Initialize WaveSurfer
        let wavesurfer;
        let spectrogram;
        let isPlaying = false;
        let loopEnabled = false;
        let loopStart = 0;
        let loopEnd = 0;
        
        // DOM elements
        const playPauseBtn = document.getElementById('playPause');
        const stopBtn = document.getElementById('stop');
        const zoomInBtn = document.getElementById('zoomIn');
        const zoomOutBtn = document.getElementById('zoomOut');
        const fitToScreenBtn = document.getElementById('fitToScreen');
        const volumeSlider = document.getElementById('volume');
        const viewModeSelect = document.getElementById('viewMode');
        const loopEnabledCheckbox = document.getElementById('loopEnabled');
        const loopStartInput = document.getElementById('loopStart');
        const loopEndInput = document.getElementById('loopEnd');
        const currentTimeDiv = document.getElementById('currentTime');
        const durationDiv = document.getElementById('duration');
        const loadingDiv = document.getElementById('loading');
        const errorDiv = document.getElementById('error');
        const waveformDiv = document.getElementById('waveform');
        const spectrogramDiv = document.getElementById('spectrogram');
        const statusDiv = document.getElementById('status');

        // Initialize the audio viewer
        async function initAudioViewer() {
            try {
                console.log('Initializing audio viewer...');
                console.log('Audio source length:', audioSrc.length);
                
                // Create WaveSurfer instance
                wavesurfer = WaveSurfer.create({
                    container: '#waveform',
                    waveColor: '#4F4A85',
                    progressColor: '#383351',
                    cursorColor: '#fff',
                    barWidth: 2,
                    barRadius: 3,
                    cursorWidth: 1,
                    height: 200,
                    barGap: 3,
                    responsive: true,
                    normalize: true,
                    backend: 'WebAudio'
                });

                console.log('WaveSurfer instance created, loading audio...');
                
                // Load audio file
                await wavesurfer.load(audioSrc);
                
                // Spectrogram will be implemented later
                // For now, just create a placeholder
                spectrogram = null;
                
                // Hide loading, show content
                loadingDiv.style.display = 'none';
                waveformDiv.style.display = 'block';
                
                // Set up event listeners
                setupEventListeners();
                
                // Update duration display
                updateDuration();
                
                showStatus('Audio loaded successfully');
                
            } catch (error) {
                console.error('Error loading audio:', error);
                loadingDiv.style.display = 'none';
                errorDiv.style.display = 'block';
                errorDiv.textContent = 'Error loading audio file: ' + error.message;
                vscode.postMessage({ command: 'error', text: error.message });
                
                // Show more detailed error information
                if (error.name === 'NotSupportedError') {
                    errorDiv.textContent += '\\n\\nThis audio format may not be supported by your browser.';
                } else if (error.name === 'QuotaExceededError') {
                    errorDiv.textContent += '\\n\\nFile is too large. Try a smaller audio file.';
                }
            }
        }

        function setupEventListeners() {
            // Play/Pause button
            playPauseBtn.addEventListener('click', () => {
                if (isPlaying) {
                    wavesurfer.pause();
                } else {
                    wavesurfer.play();
                }
            });

            // Stop button
            stopBtn.addEventListener('click', () => {
                wavesurfer.stop();
            });

            // Zoom controls
            zoomInBtn.addEventListener('click', () => {
                wavesurfer.zoom(50);
            });

            zoomOutBtn.addEventListener('click', () => {
                wavesurfer.zoom(20);
            });

            fitToScreenBtn.addEventListener('click', () => {
                wavesurfer.zoom(100);
            });

            // Volume control
            volumeSlider.addEventListener('input', (e) => {
                const volume = parseFloat(e.target.value);
                wavesurfer.setVolume(volume);
            });

            // View mode change
            viewModeSelect.addEventListener('change', (e) => {
                const mode = e.target.value;
                switch (mode) {
                    case 'waveform':
                        waveformDiv.style.display = 'block';
                        spectrogramDiv.style.display = 'none';
                        break;
                    case 'spectrogram':
                        // Spectrogram not implemented yet
                        waveformDiv.style.display = 'block';
                        spectrogramDiv.style.display = 'none';
                        viewModeSelect.value = 'waveform';
                        break;
                    case 'both':
                        // Both not implemented yet
                        waveformDiv.style.display = 'block';
                        spectrogramDiv.style.display = 'none';
                        viewModeSelect.value = 'waveform';
                        break;
                }
            });

            // Loop controls
            loopEnabledCheckbox.addEventListener('change', (e) => {
                loopEnabled = e.target.checked;
                if (loopEnabled) {
                    showStatus('Loop enabled');
                } else {
                    showStatus('Loop disabled');
                }
            });

            loopStartInput.addEventListener('change', (e) => {
                loopStart = parseFloat(e.target.value) || 0;
            });

            loopEndInput.addEventListener('change', (e) => {
                loopEnd = parseFloat(e.target.value) || 0;
            });

            // WaveSurfer events
            wavesurfer.on('ready', () => {
                showStatus('Audio ready to play');
                updateDuration();
            });

            wavesurfer.on('play', () => {
                isPlaying = true;
                playPauseBtn.textContent = '⏸️ Pause';
                showStatus('Playing');
            });

            wavesurfer.on('pause', () => {
                isPlaying = false;
                playPauseBtn.textContent = '▶️ Play';
                showStatus('Paused');
            });

            wavesurfer.on('stop', () => {
                isPlaying = false;
                playPauseBtn.textContent = '▶️ Play';
                showStatus('Stopped');
            });

            wavesurfer.on('finish', () => {
                if (loopEnabled && loopEnd > loopStart) {
                    // Loop playback
                    setTimeout(() => {
                        wavesurfer.play(loopStart);
                        showStatus('Looping playback');
                    }, 100);
                } else {
                    isPlaying = false;
                    playPauseBtn.textContent = '▶️ Play';
                    showStatus('Playback finished');
                }
            });

            wavesurfer.on('audioprocess', (currentTime) => {
                updateCurrentTime(currentTime);
                
                // Check for loop end
                if (loopEnabled && loopEnd > loopStart && currentTime >= loopEnd) {
                    wavesurfer.play(loopStart);
                    showStatus('Looping to start');
                }
            });

            wavesurfer.on('seek', (progress) => {
                updateCurrentTime(progress * wavesurfer.getDuration());
            });

            wavesurfer.on('error', (error) => {
                console.error('WaveSurfer error:', error);
                showStatus('Error: ' + error.message);
                vscode.postMessage({ command: 'error', text: error.message });
            });
        }

        function updateCurrentTime(currentTime) {
            const minutes = Math.floor(currentTime / 60);
            const seconds = Math.floor(currentTime % 60);
            currentTimeDiv.textContent = \`\${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}\`;
        }

        function updateDuration() {
            const duration = wavesurfer.getDuration();
            if (duration && !isNaN(duration)) {
                const minutes = Math.floor(duration / 60);
                const seconds = Math.floor(duration % 60);
                durationDiv.textContent = \`\${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}\`;
                
                // Set loop end default value
                if (!loopEndInput.value) {
                    loopEndInput.placeholder = duration.toFixed(1);
                }
            }
        }

        function showStatus(message) {
            statusDiv.textContent = message;
            statusDiv.classList.add('show');
            setTimeout(() => {
                statusDiv.classList.remove('show');
            }, 3000);
        }

        // Initialize when page loads
        document.addEventListener('DOMContentLoaded', initAudioViewer);

        // Log to VSCode console
        vscode.postMessage({ command: 'log', text: 'Audio viewer initialized' });
    </script>
</body>
</html>`;
    }
}
