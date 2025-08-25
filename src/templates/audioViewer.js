const vscode = acquireVsCodeApi();

// Audio file source
const audioSrc = '{{audioSrc}}';

// Initialize WaveSurfer
let wavesurfer;
let spectrogram;
let timeline;
let isPlaying = false;
let loopEnabled = false;
let loopStart = 0;
let loopEnd = 0;
let isSetupComplete = false;
let audioContextInitialized = false;

// DOM elements
const playPauseBtn = document.getElementById('playPause');
const stopBtn = document.getElementById('stop');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const fitToScreenBtn = document.getElementById('fitToScreen');
const volumeSlider = document.getElementById('volume');
const loopEnabledCheckbox = document.getElementById('loopEnabled');
const loopStartInput = document.getElementById('loopStart');
const loopEndInput = document.getElementById('loopEnd');
const currentTimeDiv = null; // Removed time display
const durationDiv = null; // Removed time display
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const waveformDiv = document.getElementById('waveform');
const spectrogramDiv = document.getElementById('spectrogram');
const statusDiv = document.getElementById('status');
const fileInfoDiv = document.getElementById('fileInfo');
const durationInfoDiv = document.getElementById('durationInfo');
const sampleRateInfoDiv = document.getElementById('sampleRateInfo');
const channelsInfoDiv = document.getElementById('channelsInfo');
const bitDepthInfoDiv = document.getElementById('bitDepthInfo');
const fileSizeInfoDiv = document.getElementById('fileSizeInfo');
const formatInfoDiv = document.getElementById('formatInfo');

async function initializeAudioContext() {
    if (audioContextInitialized) return;
    
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        audioContextInitialized = true;
        console.log('AudioContext initialized successfully');
        showStatus('AudioContext initialized');
        
    } catch (error) {
        console.error('Failed to initialize AudioContext:', error);
        showStatus('AudioContext initialization failed: ' + error.message);
    }
}

// WaveSurfer의 AudioContext 가져오기 함수
function getWaveSurferAudioContext() {
    try {
        if (!wavesurfer) {
            console.log('WaveSurfer not initialized yet');
            return null;
        }
        
        if (!wavesurfer.backend) {
            console.log('WaveSurfer backend not available');
            return null;
        }
        
        if (!wavesurfer.backend.audioContext) {
            console.log('WaveSurfer audioContext not available');
            return null;
        }
        
        return wavesurfer.backend.audioContext;
    } catch (error) {
        console.error('Error getting WaveSurfer AudioContext:', error);
        return null;
    }
}

function checkAudioContextState() {
    const audioContext = getWaveSurferAudioContext();
    if (audioContext) {
        console.log('AudioContext state:', audioContext.state);
        console.log('AudioContext sample rate:', audioContext.sampleRate);
        showStatus(`AudioContext state: ${audioContext.state}`);
        return audioContext.state;
    } else {
        console.log('No AudioContext available');
        showStatus('AudioContext not available');
        return null;
    }
}

async function initAudioViewer() {
    try {
        if (typeof vscode !== 'undefined' && vscode.env && vscode.env.uiKind === 1) { // Web
            console.log('Initializing audio viewer...');
            console.log('Audio source length:', audioSrc.length);
        }

        // Create hover plugin first
        const hoverPlugin = WaveSurfer.Hover.create({
            lineColor: '#ff0000',
            lineWidth: 2,
            labelBackground: '#555',
            labelColor: '#fff',
            labelSize: '11px',
            labelPreferLeft: false
        });

        wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: '#4F4A85',
            progressColor: '#383351',
            cursorColor: '#fff',
            barWidth: 2,
            barRadius: 3,
            cursorWidth: 1,
            barGap: 3,
            responsive: true,
            sampleRate: 44100,
            normalize: true,
            backend: 'WebAudio',
            autoplay: false,
            mediaControls: false,
            hideScrollbar: false,
            interact: true,
            plugins: [hoverPlugin]
        });

        // Development mode logging only
        if (typeof vscode !== 'undefined' && vscode.env && vscode.env.uiKind === 1) {
            console.log('WaveSurfer instance created, loading audio...');
        }
        
        const loadAudio = async () => {
            try {
                isSetupComplete = false;
                console.log('Starting audio load...');
                showStatus('Loading audio...');
                await wavesurfer.load(audioSrc);
                console.log('Audio loaded successfully');
                showStatus('Audio loaded successfully');
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
                checkAudioContextState();
                
            } catch (error) {
                console.error('Error loading audio:', error);
                showStatus('Error loading audio: ' + error.message);
                throw error;
            }
        };

        const preloadAudio = async () => {
            try {
                console.log('Preloading audio file...');
                showStatus('Preloading audio file...');
                
                await loadAudio();
                
                showStatus('Audio loaded. Click or press a key to play.');
                
            } catch (error) {
                console.warn('Preload failed:', error);
                showStatus('Preload failed: ' + error.message);
                
                setupUserInteractionHandler();
            }
        };

        const setupUserInteractionHandler = () => {
            const handleUserInteraction = async () => {
                document.removeEventListener('click', handleUserInteraction);
                document.removeEventListener('keydown', handleUserInteraction);
                document.removeEventListener('touchstart', handleUserInteraction);
                
                console.log('User interaction detected, initializing AudioContext...');
                showStatus('User interaction detected, initializing AudioContext...');
                
                try {
                    await initializeAudioContext();
                    showStatus('AudioContext initialized. Ready to play.');
                } catch (error) {
                    console.error('AudioContext initialization failed:', error);
                    showStatus('AudioContext initialization failed: ' + error.message);
                }
            };

            document.addEventListener('click', handleUserInteraction);
            document.addEventListener('keydown', handleUserInteraction);
            document.addEventListener('touchstart', handleUserInteraction);
        };

        preloadAudio();
        
        const setupSpectrogram = async () => {
            if (spectrogram) {
                try {
                    wavesurfer.unregisterPlugin(spectrogram);
                    spectrogram = null;
                } catch (error) {
                    console.warn('Error removing existing spectrogram plugin:', error);
                }
            }
            
            const spectrogramContainer = document.getElementById('spectrogram');
            if (spectrogramContainer) {
                spectrogramContainer.innerHTML = '';
            }
            
            try {
                spectrogram = wavesurfer.registerPlugin(WaveSurfer.Spectrogram.create({
                    container: '#spectrogram',
                    labels: true,
                    windowFunc: 'hann',
                    scale: 'linear',
                    splitChannels: false,
                    fftSize: 4096,
                    noverlap: 2048,
                }));
                if (typeof vscode !== 'undefined' && vscode.env && vscode.env.uiKind === 1) {
                    console.log('Spectrogram plugin registered successfully');
                }
            } catch (error) {
                console.warn('Failed to register spectrogram plugin:', error);
                spectrogram = null;
            }
        };

        // Calculate timeline intervals based on duration
        const getTimelineIntervals = (durationSec) => {
            if (!durationSec || durationSec <= 0) {
                return { timeInterval: 1, primaryLabelInterval: 5, secondaryLabelInterval: 1 }
            }

            const timelineEl = document.getElementById('timeline')
            const containerWidth = timelineEl?.offsetWidth || 1000
            const pixelsPerSecond = containerWidth / durationSec

            const minTickPixels = 100
            const niceSteps = [
                0.5, 1, 2, 5, 10, 15, 30,
                60, 120, 300, 600, 900, 1800, 3600
            ]

            let chosenStep = niceSteps[niceSteps.length - 1]
            for (const step of niceSteps) {
                if (step * pixelsPerSecond >= minTickPixels) {
                    chosenStep = step
                    break
                }
            }

            const primary = chosenStep * 5
            const secondary = chosenStep

            return {
                timeInterval: chosenStep,
                primaryLabelInterval: primary,
                secondaryLabelInterval: secondary,
            }
        };

        const setupAfterDecode = async () => {
            if (isSetupComplete) return;
            
            isSetupComplete = true;
            
            await setupSpectrogram();
            
            if (timeline) {
                try {
                    wavesurfer.unregisterPlugin(timeline);
                    timeline = null;
                } catch (error) {
                    console.warn('Error removing existing timeline plugin:', error);
                }
            }
            
            const timelineContainer = document.getElementById('timeline');
            if (timelineContainer) {
                timelineContainer.innerHTML = '';
            }
            
            const intervals = getTimelineIntervals(wavesurfer.getDuration());
            // Register timeline plugin
            try {
                timeline = wavesurfer.registerPlugin(WaveSurfer.Timeline.create({
                    container: '#timeline',
                    formatTimeCallback: (seconds) => {
                        const minutes = Math.floor(seconds / 60);
                        const remainingSeconds = Math.floor(seconds % 60);
                        const milliseconds = Math.floor((seconds % 1) * 1000);
                        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
                    },
                    timeInterval: intervals.timeInterval,
                    primaryLabelInterval: intervals.primaryLabelInterval,
                    secondaryLabelInterval: intervals.secondaryLabelInterval
                }));
                if (typeof vscode !== 'undefined' && vscode.env && vscode.env.uiKind === 1) {
                    console.log('Timeline plugin registered successfully');
                }
            } catch (error) {
                console.warn('Failed to register timeline plugin:', error);
                timeline = null;
            }
            
            // Hover plugin is already registered in WaveSurfer.create()
            console.log('Hover plugin should be active from initialization');

            // Hide loading, show content
            loadingDiv.style.display = 'none';
            waveformDiv.style.display = 'block';
            spectrogramDiv.style.display = 'block';
            
            // Force spectrogram redraw for both view
            if (spectrogram) {
                setTimeout(() => {
                    spectrogram.render();
                }, 100);
            }
            
            // Set up event listeners
            setupEventListeners();
            
            // Update loop end placeholder and file info
            updateDuration();
            updateFileInfo();
            
            showStatus('Audio loaded successfully');
            
            setTimeout(() => {
                if (spectrogram) {
                    try {
                        if (typeof vscode !== 'undefined' && vscode.env && vscode.env.uiKind === 1) {
                            console.log('Spectrogram frequency range check...');
                            console.log('Sample rate:', wavesurfer.getDecodedData()?.sampleRate || 'unknown');
                            console.log('FFT size:', spectrogram.params?.fftSize || 'unknown');
                        }
                    } catch (error) {
                        console.warn('Error checking spectrogram frequency range:', error);
                    }
                }
            }, 1000);
        };

        wavesurfer.on('decode', setupAfterDecode);
        
    } catch (error) {
        console.error('Error loading audio:', error);
        loadingDiv.style.display = 'none';
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'Error loading audio file: ' + error.message;
        vscode.postMessage({ command: 'error', text: error.message });
        
        // Show more detailed error information
        if (error.name === 'NotSupportedError') {
            errorDiv.textContent += '\n\nThis audio format may not be supported by your browser.';
        } else if (error.name === 'QuotaExceededError') {
            errorDiv.textContent += '\n\nFile is too large. Try a smaller audio file.';
        }
    }
}

function setupEventListeners() {
    // Play/Pause button
    playPauseBtn.addEventListener('click', async () => {
        try {
            if (isPlaying) {
                wavesurfer.pause();
            } else {
                if (!wavesurfer) {
                    console.log('WaveSurfer not initialized');
                    showStatus('WaveSurfer not initialized');
                    return;
                }
                
                if (!audioContextInitialized) {
                    console.log('Initializing AudioContext on user interaction...');
                    showStatus('Initializing AudioContext...');
                    await initializeAudioContext();
                }
                
                const audioContext = getWaveSurferAudioContext();
                if (audioContext && audioContext.state === 'suspended') {
                    console.log('AudioContext suspended, resuming...');
                    showStatus('Resuming AudioContext...');
                    await audioContext.resume();
                }
                
                console.log('Attempting to play audio...');
                showStatus('Attempting to play audio...');
                await wavesurfer.play();
            }
        } catch (error) {
            console.error('Playback error:', error);
            showStatus('Playback error: ' + error.message);
            
            if (error.message.includes('AudioContext') || error.message.includes('suspended')) {
                console.log('Attempting to reinitialize AudioContext...');
                showStatus('Attempting to reinitialize AudioContext...');
                audioContextInitialized = false;
                await initializeAudioContext();
            }
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
    wavesurfer.on('play', () => {
        isPlaying = true;
        playPauseBtn.textContent = '⏸️';
        showStatus('Playing');
    });

    wavesurfer.on('pause', () => {
        isPlaying = false;
        playPauseBtn.textContent = '▶️';
        showStatus('Paused');
    });

    wavesurfer.on('stop', () => {
        isPlaying = false;
        playPauseBtn.textContent = '▶️';
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
            playPauseBtn.textContent = '▶️';
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

    wavesurfer.on('ready', () => {
        console.log('WaveSurfer is ready for playback');
        showStatus('Ready for playback');
        
        setTimeout(() => {
            checkAudioContextState();
        }, 100);
    });

    wavesurfer.on('load', () => {
        console.log('Audio file loaded');
        showStatus('Audio file loaded');
    });

    wavesurfer.on('decode', () => {
        console.log('Audio decoded');
        showStatus('Audio decoded');
        // Update file info after decode
        setTimeout(() => {
            updateFileInfo();
        }, 100);
    });
}

function updateCurrentTime(currentTime) {
    // Time display removed - no longer updating current time display
}

function updateDuration() {
    const duration = wavesurfer.getDuration();
    if (duration && !isNaN(duration)) {
        // Set loop end default value
        if (!loopEndInput.value) {
            loopEndInput.placeholder = duration.toFixed(1);
        }
        
        // Update duration info display
        const minutes = Math.floor(duration / 60);
        const seconds = Math.floor(duration % 60);
        durationInfoDiv.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

function updateFileInfo() {
    try {
        const decodedData = wavesurfer.getDecodedData();
        if (decodedData) {
            // Sample Rate
            sampleRateInfoDiv.textContent = `${decodedData.sampleRate} Hz`;
            
            // Channels
            channelsInfoDiv.textContent = decodedData.numberOfChannels;
            
            // Bit Depth (estimated from data type)
            const bitDepth = decodedData.length > 0 ? 
                (decodedData instanceof Float32Array ? 32 : 16) : '--';
            bitDepthInfoDiv.textContent = bitDepth === '--' ? '--' : `${bitDepth} bit`;
            
            // Format (extract from data URI or file extension)
            let format = 'Unknown';
            if (audioSrc.startsWith('data:')) {
                // Extract format from data URI
                const match = audioSrc.match(/data:([^;]+)/);
                if (match) {
                    const mimeType = match[1];
                    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
                        format = 'MP3';
                    } else if (mimeType.includes('wav')) {
                        format = 'WAV';
                    } else if (mimeType.includes('flac')) {
                        format = 'FLAC';
                    } else if (mimeType.includes('ogg')) {
                        format = 'OGG';
                    } else if (mimeType.includes('aac')) {
                        format = 'AAC';
                    } else if (mimeType.includes('webm')) {
                        format = 'WEBM';
                    } else {
                        format = mimeType.split('/')[1]?.toUpperCase() || 'Unknown';
                    }
                }
            } else {
                // Extract from file extension
                const extension = audioSrc.split('.').pop()?.toLowerCase();
                if (extension === 'mp3') format = 'MP3';
                else if (extension === 'wav') format = 'WAV';
                else if (extension === 'flac') format = 'FLAC';
                else if (extension === 'ogg') format = 'OGG';
                else if (extension === 'aac') format = 'AAC';
                else if (extension === 'webm') format = 'WEBM';
                else format = extension?.toUpperCase() || 'Unknown';
            }
            formatInfoDiv.textContent = format;
            
            // File Size (estimated from decoded data)
            const estimatedSize = decodedData.length * decodedData.numberOfChannels * 2; // 2 bytes per sample
            const sizeInKB = Math.round(estimatedSize / 1024);
            const sizeInMB = (estimatedSize / (1024 * 1024)).toFixed(1);
            fileSizeInfoDiv.textContent = sizeInMB > 1 ? `${sizeInMB} MB` : `${sizeInKB} KB`;
            
            // Show file info
            fileInfoDiv.style.display = 'flex';
        }
    } catch (error) {
        console.warn('Error updating file info:', error);
    }
}

function showStatus(message) {
    statusDiv.textContent = message;
    statusDiv.classList.add('show');
    setTimeout(() => {
        statusDiv.classList.remove('show');
    }, 100);
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initAudioViewer);

// Log to VSCode console
vscode.postMessage({ command: 'log', text: 'Audio viewer initialized' });
