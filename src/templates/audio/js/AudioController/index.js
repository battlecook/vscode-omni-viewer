import { AudioContextManager } from './managers/AudioContextManager.js';
import { WaveSurferManager } from './managers/WaveSurferManager.js';
import { PluginManager } from './managers/PluginManager.js';
import { RegionManager } from './managers/RegionManager.js';
import { FileInfoManager } from './managers/FileInfoManager.js';
import { EventManager } from './managers/EventManager.js';
import { DOMUtils } from './utils/DOMUtils.js';
import { AudioUtils } from './utils/AudioUtils.js';

export class AudioController {
    constructor() {
        this.vscode = acquireVsCodeApi();
        this.audioSrc = '{{audioSrc}}';
        this.audioMetadata = DOMUtils.getMetadata();
        this.viewerConfig = DOMUtils.getViewerConfig();
        this.isLargeFile = this.viewerConfig.isLargeFile || false;
        this.supportsChunkedLargeFile = this.viewerConfig.supportsChunkedLargeFile || false;
        this.runtimeMode = this.isLargeFile ? 'large-file-pending' : 'standard';

        // Initialize state
        this.state = {
            wavesurfer: null,
            spectrogramPlugin: null,
            timelinePlugin: null,
            regionsPlugin: null,
            isPlaying: false,
            loopEnabled: false,
            isSetupComplete: false,
            audioContextInitialized: false,
            selectedRegionId: null,
            regionStartOverlay: null,
            regionEndOverlay: null,
            isLargeFile: this.isLargeFile,
            zoomLevel: 1,
            elements: DOMUtils.getElements()
        };

        // Initialize managers
        this.audioContextManager = new AudioContextManager(this.state);
        this.waveSurferManager = new WaveSurferManager(this.state);
        this.regionManager = new RegionManager(this.state);
        this.fileInfoManager = new FileInfoManager(this.state, this.audioMetadata);
        this.pluginManager = new PluginManager(this.state, this.waveSurferManager);
        this.eventManager = new EventManager(this.state, this.audioContextManager, this.regionManager);

        // Set references in state for managers that need them
        this.state.audioContextManager = this.audioContextManager;
        this.state.regionManager = this.regionManager;
        this.state.fileInfoManager = this.fileInfoManager;
        this.state.pluginManager = this.pluginManager;
        this.state.audioController = this;
        
        // Initialize download functionality
        this.setupDownloadButton();
    }

    updateDebugInfo(mode, extra = '') {
        this.runtimeMode = mode || this.runtimeMode;

        const debugParts = [
            `isLargeFile=${this.isLargeFile}`,
            `supportsChunkedLargeFile=${this.supportsChunkedLargeFile}`,
            `mode=${this.runtimeMode}`
        ];

        if (extra) {
            debugParts.push(extra);
        }

        const debugMessage = debugParts.join(' | ');
        console.log('[AudioViewer Debug]', debugMessage);
        AudioUtils.log('[AudioViewer Debug] ' + debugMessage);

        if (this.state?.elements?.debugInfo) {
            this.state.elements.debugInfo.textContent = debugMessage;
        }
    }

    async initAudioViewer() {
        try {
            AudioUtils.log('Initializing audio viewer...');
            AudioUtils.log('Audio source: ' + this.audioSrc.substring(0, 100));
            AudioUtils.log('Large file mode: ' + this.isLargeFile);
            this.updateDebugInfo(this.isLargeFile ? 'large-file-pending' : 'standard', `format=${this.audioMetadata.format || 'unknown'}`);

            // Clear any existing regions from DOM first
            this.regionManager.clearRegionsFromDOM();

            this.state.wavesurfer = this.waveSurferManager.create();

            const loadAudio = async () => {
                try {
                    this.state.isSetupComplete = false;

                    // Clear existing regions before loading new audio
                    this.regionManager.clearAllRegions();

                    if (this.isLargeFile) {
                        // Large file mode: wait for peaks from extension, or load without full decode
                        this.updateDebugInfo('large-file-requesting-peaks');
                        await this.loadLargeFile();
                    } else {
                        // Small file mode: standard load (WaveSurfer decodes fully)
                        this.updateDebugInfo('standard-loading');
                        await this.state.wavesurfer.load(this.audioSrc);
                    }

                    await new Promise(resolve => setTimeout(resolve, 100));
                    this.audioContextManager.checkState();

                } catch (error) {
                    console.error('Error loading audio:', error);
                    AudioUtils.showStatus('Error loading audio: ' + error.message, this.state.elements.status);
                    throw error;
                }
            };

            const preloadAudio = async () => {
                try {
                    await loadAudio();
                } catch (error) {
                    console.warn('Preload failed:', error);
                    AudioUtils.showStatus('Preload failed: ' + error.message, this.state.elements.status);
                    setupUserInteractionHandler();
                }
            };

            const setupUserInteractionHandler = () => {
                const handleUserInteraction = async (e) => {
                    if (e.type === 'keydown' && e.code === 'Space') {
                        return;
                    }

                    document.removeEventListener('click', handleUserInteraction);
                    document.removeEventListener('keydown', handleUserInteraction);
                    document.removeEventListener('touchstart', handleUserInteraction);

                    try {
                        await this.audioContextManager.initialize();
                    } catch (error) {
                        console.error('AudioContext initialization failed:', error);
                        AudioUtils.showStatus('AudioContext initialization failed: ' + error.message, this.state.elements.status);
                    }
                };

                document.addEventListener('click', handleUserInteraction);
                document.addEventListener('keydown', handleUserInteraction);
                document.addEventListener('touchstart', handleUserInteraction);
            };

            this.eventManager.setupKeyboardEvents();

            preloadAudio();

            const setupAfterDecode = async () => {
                if (this.state.isSetupComplete) return;

                console.log('Setting up audio viewer after decode...');
                this.state.isSetupComplete = true;
                this.updateDebugInfo(this.runtimeMode, `regionsEnabled=${!this.isLargeFile}`);

                await this.pluginManager.setupSpectrogram();
                await this.pluginManager.setupTimeline();

                // Skip region setup for large files (requires full decoded data for extraction)
                if (!this.isLargeFile) {
                    await this.pluginManager.setupRegions();
                }

                // Hide loading, show content
                this.state.elements.loading.style.display = 'none';
                const peakLoading = document.getElementById('peakLoading');
                if (peakLoading) { peakLoading.style.display = 'none'; }
                this.state.elements.waveform.style.display = 'block';
                this.state.elements.spectrogram.style.display = 'block';

                // Force spectrogram redraw
                if (this.state.spectrogramPlugin) {
                    setTimeout(() => {
                        this.state.spectrogramPlugin.render();
                    }, 100);
                }

                // Set up event listeners
                console.log('Setting up event listeners...');
                this.eventManager.setupPlayPause();
                this.eventManager.setupStop();
                this.eventManager.setupVolume();
                this.eventManager.setupLoop();
                this.eventManager.setupSpectrogramScale();
                this.eventManager.setupZoom();
                this.eventManager.setupWaveSurferEvents();
                console.log('Event listeners setup complete');

                // Update info
                this.fileInfoManager.updateDuration();
                this.fileInfoManager.updateFileInfo();

                if (!this.isLargeFile) {
                    setTimeout(() => {
                        if (this.state.spectrogramPlugin) {
                            try {
                                AudioUtils.log('Spectrogram frequency range check...');
                                AudioUtils.log('Sample rate: ' + (this.state.wavesurfer.getDecodedData()?.sampleRate || 'unknown'));
                                AudioUtils.log('FFT size: ' + (this.state.spectrogramPlugin.params?.fftSize || 'unknown'));
                            } catch (error) {
                                console.warn('Error checking spectrogram frequency range:', error);
                            }
                        }
                    }, 1000);
                }
            };

            this.state.wavesurfer.on('decode', setupAfterDecode);
            // For large files loaded with pre-computed peaks, 'ready' fires instead of 'decode'
            if (this.isLargeFile) {
                this.state.wavesurfer.on('ready', () => {
                    setupAfterDecode();
                    // Request chunked spectrogram data from extension
                    this.requestSpectrogramChunks();
                });
            }
            
        } catch (error) {
            console.error('Error loading audio:', error);
            this.state.elements.loading.style.display = 'none';
            this.state.elements.error.style.display = 'block';
            this.state.elements.error.textContent = 'Error loading audio file: ' + error.message;
            this.vscode.postMessage({ command: 'error', text: error.message });
            
            if (error.name === 'NotSupportedError') {
                this.state.elements.error.textContent += '\n\nThis audio format may not be supported by your browser.';
            } else if (error.name === 'QuotaExceededError') {
                this.state.elements.error.textContent += '\n\nFile is too large. Try a smaller audio file.';
            }
        }
    }

    loadLargeFile() {
        return new Promise((resolve, reject) => {
            const peakLoading = document.getElementById('peakLoading');
            const unsupportedMessage = 'Large-file accelerated preview currently supports WAV files only.';
            let isSettled = false;
            let timeoutId = null;
            let messageHandler = null;

            const cleanup = () => {
                if (messageHandler) {
                    window.removeEventListener('message', messageHandler);
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                if (peakLoading) {
                    peakLoading.style.display = 'none';
                }
            };

            const resolveOnce = () => {
                if (isSettled) {
                    return;
                }
                isSettled = true;
                cleanup();
                resolve();
            };

            const rejectOnce = (error) => {
                if (isSettled) {
                    return;
                }
                isSettled = true;
                cleanup();
                reject(error);
            };

            if (!this.supportsChunkedLargeFile) {
                this.updateDebugInfo('large-file-unsupported');
                rejectOnce(new Error(unsupportedMessage));
                return;
            }

            if (peakLoading) { peakLoading.style.display = 'block'; }

            // Listen for peak data from the extension
            messageHandler = (event) => {
                const message = event.data;
                if (message.type === 'peakData') {
                    if (message.peaks && message.duration) {
                        // Load with pre-computed peaks
                        AudioUtils.log('Loading with pre-computed peaks (' + message.peaks.length + ' values)');
                        this.updateDebugInfo('large-file-peaks', `peakCount=${message.peaks.length}`);
                        this.waveSurferManager.loadWithPeaks(this.audioSrc, message.peaks, message.duration)
                            .then(resolveOnce)
                            .catch(rejectOnce);
                    } else {
                        this.updateDebugInfo('large-file-peaks-missing', message.message || '');
                        rejectOnce(new Error(message.message || unsupportedMessage));
                    }
                }
            };

            window.addEventListener('message', messageHandler);

            // Request peaks from extension (the extension may have already started computing)
            this.vscode.postMessage({ command: 'requestPeaks' });

            // Timeout: if no response in 60s, try loading normally
            timeoutId = setTimeout(() => {
                rejectOnce(new Error('Timed out while preparing accelerated large-file preview.'));
            }, 60000);
        });
    }

    initialize() {
        // Clear any existing regions from DOM first
        this.regionManager.clearRegionsFromDOM();

        // Initialize region state
        this.regionManager.hideControls();
        this.regionManager.clearAllRegions();

        this.initAudioViewer();

        // Set up PCM chunk message handler for chunked spectrogram
        this.setupPcmChunkListener();

        // Log to VSCode console
        this.vscode.postMessage({ command: 'log', text: 'Audio viewer initialized' });
    }

    setupPcmChunkListener() {
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.type === 'pcmChunk') {
                if (this.state.chunkedSpectrogramRenderer) {
                    this.state.chunkedSpectrogramRenderer.sampleRate = message.sampleRate || 44100;
                    this.state.chunkedSpectrogramRenderer.addChunk(new Float32Array(message.data));
                    // Update progress
                    const spectrogramContainer = document.getElementById('spectrogram');
                    if (spectrogramContainer) {
                        const progress = Math.round(((message.chunkIndex + 1) / message.totalChunks) * 100);
                        const statusDiv = spectrogramContainer.querySelector('div');
                        if (statusDiv) {
                            statusDiv.textContent = `Computing spectrogram... ${progress}%`;
                        }
                    }
                }
            } else if (message.type === 'pcmChunkError') {
                AudioUtils.showStatus(message.message || 'Failed to generate chunked spectrogram', this.state.elements.status);
            } else if (message.type === 'pcmChunkEnd') {
                if (this.state.chunkedSpectrogramRenderer) {
                    const spectrogramContainer = document.getElementById('spectrogram');
                    if (spectrogramContainer) {
                        const targetWidth = Math.max(1, spectrogramContainer.clientWidth * (this.state.zoomLevel || 1));
                        this.state.chunkedSpectrogramRenderer.render(spectrogramContainer, undefined, targetWidth);
                        AudioUtils.log('Chunked spectrogram rendered');
                    }
                }
            }
        });
    }

    requestSpectrogramChunks() {
        if (!this.isLargeFile || !this.state.chunkedSpectrogramRenderer) { return; }
        this.updateDebugInfo('large-file-spectrogram');
        AudioUtils.log('Requesting spectrogram chunks from extension...');
        this.vscode.postMessage({ command: 'requestSpectrogramChunks' });
    }

    setupDownloadButton() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.attachDownloadListener();
            });
        } else {
            this.attachDownloadListener();
        }
    }

    attachDownloadListener() {
        const downloadBtn = this.state.elements.downloadBtn;
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (event) => {
                console.log('Download button clicked!', event);
                this.downloadAudioFile();
            });
            AudioUtils.log('Download button listener attached');
            console.log('Download button found and listener attached');
        } else {
            console.warn('Download button not found in DOM');
            console.log('Available elements:', this.state.elements);
        }
    }

    async downloadAudioFile() {
        try {
            AudioUtils.log('Starting audio file download...');
            console.log('Audio source:', this.audioSrc);
            
            // Get the audio source URL
            const audioUrl = this.audioSrc;
            
            // Extract filename from URL or use a default name
            const fileName = this.extractFileNameFromUrl(audioUrl) || 'audio_file';
            console.log('Download filename:', fileName);
            
            // Try VSCode extension method first
            try {
                console.log('Trying VSCode extension method...');
                this.vscode.postMessage({
                    command: 'downloadFile',
                    url: audioUrl,
                    fileName: fileName
                });
                AudioUtils.showStatus('Download requested via VSCode extension', this.state.elements.status);
                return;
            } catch (error) {
                console.warn('VSCode extension method failed:', error);
                // Continue with browser methods if VSCode method fails
            }
            
            // Try multiple download methods
            let downloadSuccess = false;
            
            // Method 1: Force download with proper headers
            try {
                console.log('Trying forced download method...');
                const link = document.createElement('a');
                link.href = audioUrl;
                link.download = fileName;
                link.style.display = 'none';
                link.setAttribute('download', fileName);
                
                // Force download attribute
                if (link.download !== fileName) {
                    link.setAttribute('download', fileName);
                }
                
                document.body.appendChild(link);
                
                // Trigger click with user gesture
                const clickEvent = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                link.dispatchEvent(clickEvent);
                
                document.body.removeChild(link);
                
                downloadSuccess = true;
                console.log('Method 1 (forced download) succeeded');
            } catch (error) {
                console.warn('Method 1 failed:', error);
            }
            
            // Method 2: Fetch and blob download with proper MIME type
            if (!downloadSuccess) {
                try {
                    console.log('Trying fetch + blob method...');
                    const response = await fetch(audioUrl, {
                        method: 'GET',
                        mode: 'cors',
                        cache: 'no-cache'
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    
                    const blob = await response.blob();
                    console.log('Blob created:', blob.size, 'bytes, type:', blob.type);
                    
                    // Create blob URL with proper MIME type
                    const blobUrl = URL.createObjectURL(blob);
                    console.log('Blob URL created:', blobUrl);
                    
                    const link = document.createElement('a');
                    link.href = blobUrl;
                    link.download = fileName;
                    link.style.display = 'none';
                    
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    // Clean up blob URL after a delay
                    setTimeout(() => {
                        URL.revokeObjectURL(blobUrl);
                        console.log('Blob URL revoked');
                    }, 2000);
                    
                    downloadSuccess = true;
                    console.log('Method 2 (fetch + blob) succeeded');
                } catch (error) {
                    console.warn('Method 2 failed:', error);
                }
            }
            
            // Method 3: Create downloadable link in page
            if (!downloadSuccess) {
                try {
                    console.log('Trying in-page download method...');
                    
                    // Create a visible download link
                    const downloadLink = document.createElement('a');
                    downloadLink.href = audioUrl;
                    downloadLink.download = fileName;
                    downloadLink.textContent = `Download ${fileName}`;
                    downloadLink.style.cssText = `
                        display: block;
                        padding: 10px;
                        margin: 10px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        text-decoration: none;
                        border-radius: 4px;
                        text-align: center;
                    `;
                    
                    // Add to page temporarily
                    const container = document.querySelector('.main-content');
                    if (container) {
                        container.appendChild(downloadLink);
                        
                        // Auto-click after a short delay
                        setTimeout(() => {
                            downloadLink.click();
                            setTimeout(() => {
                                if (downloadLink.parentNode) {
                                    downloadLink.parentNode.removeChild(downloadLink);
                                }
                            }, 1000);
                        }, 100);
                        
                        downloadSuccess = true;
                        console.log('Method 3 (in-page link) succeeded');
                    }
                } catch (error) {
                    console.warn('Method 3 failed:', error);
                }
            }
            
            // Method 4: Open in new tab (fallback)
            if (!downloadSuccess) {
                try {
                    console.log('Trying new tab method...');
                    const newWindow = window.open(audioUrl, '_blank');
                    if (newWindow) {
                        downloadSuccess = true;
                        console.log('Method 4 (new tab) succeeded');
                    }
                } catch (error) {
                    console.warn('Method 4 failed:', error);
                }
            }
            
            if (downloadSuccess) {
                AudioUtils.log('Download initiated for: ' + fileName);
                AudioUtils.showStatus('Download started: ' + fileName, this.state.elements.status);
            } else {
                throw new Error('All download methods failed');
            }
            
        } catch (error) {
            console.error('Error downloading audio file:', error);
            AudioUtils.showStatus('Download failed: ' + error.message, this.state.elements.status);
        }
    }

    extractFileNameFromUrl(url) {
        try {
            console.log('Extracting filename from URL:', url);
            
            // Handle data URLs
            if (url.startsWith('data:')) {
                console.log('Data URL detected, using metadata filename');
                return this.getFileNameFromMetadata() || 'audio_file';
            }
            
            // Handle blob URLs
            if (url.startsWith('blob:')) {
                console.log('Blob URL detected, using metadata filename');
                return this.getFileNameFromMetadata() || 'audio_file';
            }
            
            // Handle regular URLs
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const fileName = pathname.split('/').pop();
            
            console.log('Extracted filename from URL:', fileName);
            
            // If no filename in URL, try to get from audio metadata
            if (!fileName || fileName === '' || !fileName.includes('.')) {
                console.log('No valid filename in URL, using metadata');
                return this.getFileNameFromMetadata() || 'audio_file';
            }
            
            return fileName;
        } catch (error) {
            console.warn('Error extracting filename from URL:', error);
            return this.getFileNameFromMetadata() || 'audio_file';
        }
    }

    getFileNameFromMetadata() {
        try {
            console.log('Getting filename from metadata:', this.audioMetadata);
            
            // Try to get filename from metadata
            if (this.audioMetadata && this.audioMetadata.fileName) {
                console.log('Found filename in metadata:', this.audioMetadata.fileName);
                return this.audioMetadata.fileName;
            }
            
            // Try to get from DOM title or other sources
            const title = document.title;
            console.log('Document title:', title);
            if (title && title !== 'Audio Viewer') {
                const fileName = title.replace('Audio Viewer - ', '');
                console.log('Extracted filename from title:', fileName);
                return fileName;
            }
            
            // Try to get from URL parameters or other sources
            const urlParams = new URLSearchParams(window.location.search);
            const fileNameParam = urlParams.get('fileName') || urlParams.get('filename');
            if (fileNameParam) {
                console.log('Found filename in URL params:', fileNameParam);
                return fileNameParam;
            }
            
            console.log('No filename found in metadata or title');
            return null;
        } catch (error) {
            console.warn('Error getting filename from metadata:', error);
            return null;
        }
    }

    async extractAndDownloadRegion(region) {
        try {
            if (this.isLargeFile) {
                AudioUtils.showStatus('Region extraction is not available for large files', this.state.elements.status);
                return;
            }

            if (!region || !this.state.wavesurfer) {
                AudioUtils.showStatus('No region selected', this.state.elements.status);
                return;
            }

            AudioUtils.showStatus('Extracting audio region...', this.state.elements.status);

            const startTime = region.start;
            const endTime = region.end;
            const duration = endTime - startTime;

            // Get decoded audio data
            const decodedData = this.state.wavesurfer.getDecodedData();
            if (!decodedData) {
                throw new Error('Audio data not available');
            }

            const sampleRate = decodedData.sampleRate;
            const numberOfChannels = decodedData.numberOfChannels;
            const startSample = Math.floor(startTime * sampleRate);
            const endSample = Math.floor(endTime * sampleRate);
            const length = endSample - startSample;

            // Extract audio samples for each channel
            const channels = [];
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const channelData = decodedData.getChannelData(channel);
                const extractedData = new Float32Array(length);
                for (let i = 0; i < length; i++) {
                    extractedData[i] = channelData[startSample + i];
                }
                channels.push(extractedData);
            }

            // Create AudioBuffer from extracted data
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = audioContext.createBuffer(numberOfChannels, length, sampleRate);
            
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const channelData = audioBuffer.getChannelData(channel);
                channelData.set(channels[channel]);
            }

            // Convert AudioBuffer to WAV
            const wav = this.audioBufferToWav(audioBuffer);
            const blob = new Blob([wav], { type: 'audio/wav' });

            // Generate filename
            const baseFileName = this.extractFileNameFromUrl(this.audioSrc) || 'audio_file';
            const nameWithoutExt = baseFileName.replace(/\.[^/.]+$/, '');
            const fileName = `${nameWithoutExt}_${startTime.toFixed(2)}s-${endTime.toFixed(2)}s.wav`;

            // Try VSCode extension method first (shows save dialog)
            try {
                // Convert blob to base64 for VSCode extension
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64data = reader.result.split(',')[1]; // Remove data:audio/wav;base64, prefix
                    
                    this.vscode.postMessage({
                        command: 'saveRegionFile',
                        fileName: fileName,
                        blob: base64data,
                        mimeType: 'audio/wav',
                        duration: duration.toFixed(2),
                        startTime: startTime.toFixed(2),
                        endTime: endTime.toFixed(2)
                    });
                    
                    AudioUtils.showStatus(`저장 중... (${duration.toFixed(2)}초)`, this.state.elements.status);
                };
                reader.onerror = () => {
                    throw new Error('Failed to read blob data');
                };
                reader.readAsDataURL(blob);
                return;
            } catch (error) {
                console.warn('VSCode extension method failed, using browser download:', error);
            }

            // Fallback: Browser download
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Clean up
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 100);

            const fileSize = (blob.size / 1024).toFixed(2);
            AudioUtils.showStatus(`다운로드 완료: ${fileName} (${fileSize} KB)`, this.state.elements.status);
            AudioUtils.log(`Region extracted and saved: ${fileName} (${fileSize} KB)`);
            
            // Show browser notification if available
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('오디오 저장 완료', {
                    body: `${fileName}\n${fileSize} KB`,
                    icon: '🎵'
                });
            }

        } catch (error) {
            console.error('Error extracting region:', error);
            AudioUtils.showStatus('Error extracting region: ' + error.message, this.state.elements.status);
        }
    }

    audioBufferToWav(buffer) {
        const length = buffer.length;
        const numberOfChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const bytesPerSample = 2;
        const blockAlign = numberOfChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = length * blockAlign;
        const bufferSize = 44 + dataSize;
        const arrayBuffer = new ArrayBuffer(bufferSize);
        const view = new DataView(arrayBuffer);

        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, bufferSize - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true); // audio format (PCM)
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true); // bits per sample
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        // Convert float samples to 16-bit PCM
        let offset = 44;
        for (let i = 0; i < length; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
        }

        return arrayBuffer;
    }
}
