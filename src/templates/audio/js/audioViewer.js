const vscode = acquireVsCodeApi();

// Constants
const CONSTANTS = {
    WAVESURFER: {
        WAVE_COLOR: '#4F4A85',
        PROGRESS_COLOR: '#383351',
        CURSOR_COLOR: '#fff',
        BAR_WIDTH: 2,
        BAR_RADIUS: 3,
        CURSOR_WIDTH: 1,
        BAR_GAP: 3,
        SAMPLE_RATE: 44100,
        ZOOM_LEVELS: { IN: 50, OUT: 20, FIT: 100 }
    },
    TIMELINE: {
        MIN_TICK_PIXELS: 100,
        NICE_STEPS: [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
    },
    SPECTROGRAM: {
        FFT_SIZE: 4096,
        NOVERLAP: 2048
    },
    REGION: {
        MIN_DURATION: 0.1
    }
};

// Audio file source
const audioSrc = '{{audioSrc}}';

// Get metadata from server
const getMetadata = () => {
    try {
        const metadataScript = document.getElementById('metadata-script');
        if (metadataScript && metadataScript.textContent) {
            return JSON.parse(metadataScript.textContent);
        }
    } catch (error) {
        console.warn('Error parsing metadata:', error);
    }
    return {};
};

const audioMetadata = getMetadata();

// State management
const state = {
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
    regionEndOverlay: null
};

// DOM elements cache
const elements = {
    playPause: document.getElementById('playPause'),
    stop: document.getElementById('stop'),
    zoomIn: document.getElementById('zoomIn'),
    zoomOut: document.getElementById('zoomOut'),
    fitToScreen: document.getElementById('fitToScreen'),
    volume: document.getElementById('volume'),
    loopEnabled: document.getElementById('loopEnabled'),
    loopControls: document.getElementById('loopControls'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    waveform: document.getElementById('waveform'),
    spectrogram: document.getElementById('spectrogram'),
    status: document.getElementById('status'),
    fileInfo: document.getElementById('fileInfo'),
    durationInfo: document.getElementById('durationInfo'),
    sampleRateInfo: document.getElementById('sampleRateInfo'),
    channelsInfo: document.getElementById('channelsInfo'),
    bitDepthInfo: document.getElementById('bitDepthInfo'),
    fileSizeInfo: document.getElementById('fileSizeInfo'),
    formatInfo: document.getElementById('formatInfo')
};

// Utility functions
const utils = {
    formatTime: (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        const milliseconds = Math.floor((seconds % 1) * 1000);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    },

    showStatus: (message) => {
        elements.status.textContent = message;
        elements.status.classList.add('show');
        setTimeout(() => {
            elements.status.classList.remove('show');
        }, 100);
    },

    log: (message) => {
        if (typeof vscode !== 'undefined' && vscode.env && vscode.env.uiKind === 1) {
            console.log(message);
        }
    }
};

// AudioContext management
const audioContextManager = {
    async initialize() {
        if (state.audioContextInitialized) return;
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            state.audioContextInitialized = true;
            
        } catch (error) {
            console.error('Failed to initialize AudioContext:', error);
            utils.showStatus('AudioContext initialization failed: ' + error.message);
        }
    },

    getWaveSurferAudioContext() {
        try {
            if (!state.wavesurfer?.backend?.audioContext) {
                return null;
            }
            return state.wavesurfer.backend.audioContext;
        } catch (error) {
            console.error('Error getting WaveSurfer AudioContext:', error);
            return null;
        }
    },

    checkState() {
        const audioContext = this.getWaveSurferAudioContext();
        if (audioContext) {
            return audioContext.state;
        } else {
            return null;
        }
    }
};

// WaveSurfer configuration
const wavesurferConfig = {
    create() {
        return WaveSurfer.create({
            container: '#waveform',
            waveColor: CONSTANTS.WAVESURFER.WAVE_COLOR,
            progressColor: CONSTANTS.WAVESURFER.PROGRESS_COLOR,
            cursorColor: CONSTANTS.WAVESURFER.CURSOR_COLOR,
            barWidth: CONSTANTS.WAVESURFER.BAR_WIDTH,
            barRadius: CONSTANTS.WAVESURFER.BAR_RADIUS,
            cursorWidth: CONSTANTS.WAVESURFER.CURSOR_WIDTH,
            barGap: CONSTANTS.WAVESURFER.BAR_GAP,
            responsive: true,
            sampleRate: CONSTANTS.WAVESURFER.SAMPLE_RATE,
            normalize: true,
            backend: 'WebAudio',
            autoplay: false,
            mediaControls: false,
            hideScrollbar: false,
            interact: true,
            plugins: [
                WaveSurfer.Hover.create({
                    lineWidth: 2,
                    labelBackground: '#000000',
                    labelColor: '#fff',
                    formatTimeCallback: utils.formatTime
                })
            ]
        });
    },

    getTimelineIntervals(durationSec) {
        if (!durationSec || durationSec <= 0) {
            return { timeInterval: 1, primaryLabelInterval: 5, secondaryLabelInterval: 1 };
        }

        const timelineEl = document.getElementById('timeline');
        const containerWidth = timelineEl?.offsetWidth || 1000;
        const pixelsPerSecond = containerWidth / durationSec;

        let chosenStep = CONSTANTS.TIMELINE.NICE_STEPS[CONSTANTS.TIMELINE.NICE_STEPS.length - 1];
        for (const step of CONSTANTS.TIMELINE.NICE_STEPS) {
            if (step * pixelsPerSecond >= CONSTANTS.TIMELINE.MIN_TICK_PIXELS) {
                chosenStep = step;
                break;
            }
        }

        return {
            timeInterval: chosenStep,
            primaryLabelInterval: chosenStep * 5,
            secondaryLabelInterval: chosenStep
        };
    }
};

// Plugin management
const pluginManager = {
    async setupSpectrogram() {
        if (state.spectrogramPlugin) {
            try {
                state.wavesurfer.unregisterPlugin(state.spectrogramPlugin);
                state.spectrogramPlugin = null;
            } catch (error) {
                console.warn('Error removing existing spectrogram plugin:', error);
            }
        }
        
        const spectrogramContainer = document.getElementById('spectrogram');
        if (spectrogramContainer) {
            spectrogramContainer.innerHTML = '';
        }
        
        try {
            state.spectrogramPlugin = state.wavesurfer.registerPlugin(WaveSurfer.Spectrogram.create({
                container: '#spectrogram',
                labels: true,
                scale: 'linear',
                splitChannels: false,
                fftSize: CONSTANTS.SPECTROGRAM.FFT_SIZE,
                noverlap: CONSTANTS.SPECTROGRAM.NOVERLAP
            }));
            utils.log('Spectrogram plugin registered successfully');
        } catch (error) {
            console.warn('Failed to register spectrogram plugin:', error);
            state.spectrogramPlugin = null;
        }
    },

    async setupTimeline() {
        if (state.timelinePlugin) {
            try {
                state.wavesurfer.unregisterPlugin(state.timelinePlugin);
                state.timelinePlugin = null;
            } catch (error) {
                console.warn('Error removing existing timeline plugin:', error);
            }
        }
        
        const timelineContainer = document.getElementById('timeline');
        if (timelineContainer) {
            timelineContainer.innerHTML = '';
        }
        
        const intervals = wavesurferConfig.getTimelineIntervals(state.wavesurfer.getDuration());
        
        try {
            state.timelinePlugin = state.wavesurfer.registerPlugin(WaveSurfer.Timeline.create({
                container: '#timeline',
                formatTimeCallback: utils.formatTime,
                timeInterval: intervals.timeInterval,
                primaryLabelInterval: intervals.primaryLabelInterval,
                secondaryLabelInterval: intervals.secondaryLabelInterval
            }));
            utils.log('Timeline plugin registered successfully');
        } catch (error) {
            console.warn('Failed to register timeline plugin:', error);
            state.timelinePlugin = null;
        }
    },

    async setupRegions() {
        try {
            state.regionsPlugin = state.wavesurfer.registerPlugin(WaveSurfer.Regions.create({}));
            utils.log('Regions plugin registered successfully');
        } catch (error) {
            console.warn('Failed to register regions plugin:', error);
            state.regionsPlugin = null;
            return;
        }
        
        this.setupRegionEvents();
    },

    setupRegionEvents() {
        state.regionsPlugin.enableDragSelection({
            color: 'rgba(255, 0, 0, 0.1)'
        });

        state.regionsPlugin.on('region-created', (region) => {
            if (state.regionsPlugin.getRegions) {
                const newRegions = state.regionsPlugin.getRegions();
                newRegions.forEach((existingRegion) => {
                    if (existingRegion.id !== region.id) {
                        existingRegion.remove();
                    }
                });
            }
            state.selectedRegionId = region.id;
            regionManager.showControls();
            
            setTimeout(() => {
                regionManager.createOverlays(region);
            }, 100);
        });

        state.regionsPlugin.on('region-clicked', (region) => {
            state.selectedRegionId = region.id;
            regionManager.showControls();
            regionManager.createOverlays(region);
        });

        state.regionsPlugin.on('region-removed', (region) => {
            if (state.selectedRegionId === region.id) {
                state.selectedRegionId = null;
                regionManager.hideControls();
            }
        });

        state.regionsPlugin.on('region-updated', (region) => {
            if (state.selectedRegionId === region.id) {
                regionManager.updateOverlays(region);
            }
        });

        this.setupRegionClickHandlers();
    },

    setupRegionClickHandlers() {
        const removeAllRegions = () => {
            if (state.regionsPlugin?.getRegions) {
                const regions = state.regionsPlugin.getRegions();
                if (regions && Object.keys(regions).length > 0) {
                    Object.values(regions).forEach(region => {
                        region.remove();
                    });
                    state.selectedRegionId = null;
                    regionManager.hideControls();
                }
            }
        };

        const waveformContainer = document.getElementById('waveform');
        waveformContainer.addEventListener('click', (e) => {
            const clickedElement = e.target;
            const isRegionElement = clickedElement.closest('.wavesurfer-region') || 
                                   clickedElement.closest('.region-input-overlay') ||
                                   clickedElement.classList.contains('region-input-overlay') ||
                                   clickedElement.classList.contains('region-start-input') ||
                                   clickedElement.classList.contains('region-end-input');
            
            if (!isRegionElement) {
                removeAllRegions();
            }
        });

        const spectrogramContainer = document.getElementById('spectrogram');
        if (spectrogramContainer) {
            spectrogramContainer.addEventListener('click', removeAllRegions);
        }
    }
};

// Region management
const regionManager = {
    showControls() {
        elements.loopControls.style.display = 'flex';
    },

    hideControls() {
        elements.loopControls.style.display = 'none';
        this.removeOverlays();
    },

    createOverlays(region) {
        this.removeOverlays();
        
        const waveformContainer = document.getElementById('waveform');
        const containerRect = waveformContainer.getBoundingClientRect();
        const regionElement = region.element;
        
        if (!regionElement) return;
        
        const regionRect = regionElement.getBoundingClientRect();
        
        // Start input overlay
        state.regionStartOverlay = document.createElement('div');
        state.regionStartOverlay.className = 'region-input-overlay';
        state.regionStartOverlay.innerHTML = `
            <input type="number" value="${region.start.toFixed(1)}" class="region-start-input" title="Start time">
        `;
        
        // End input overlay
        state.regionEndOverlay = document.createElement('div');
        state.regionEndOverlay.className = 'region-input-overlay';
        state.regionEndOverlay.innerHTML = `
            <input type="number" value="${region.end.toFixed(1)}" class="region-end-input" title="End time">
        `;
        
        // Position calculation
        const startLeft = regionRect.left - containerRect.left - 10;
        const endLeft = regionRect.right - containerRect.left + 10;
        const top = regionRect.top - containerRect.top + 10;
        
        state.regionStartOverlay.style.left = startLeft + 'px';
        state.regionStartOverlay.style.top = top + 'px';
        
        state.regionEndOverlay.style.left = endLeft + 'px';
        state.regionEndOverlay.style.top = top + 'px';
        
        waveformContainer.appendChild(state.regionStartOverlay);
        waveformContainer.appendChild(state.regionEndOverlay);
        
        this.setupOverlayEvents(region);
    },

    setupOverlayEvents(region) {
        const startInput = state.regionStartOverlay.querySelector('.region-start-input');
        const endInput = state.regionEndOverlay.querySelector('.region-end-input');
        
        const applyRegionInput = (startTimeInput, endTimeInput) => {
            console.log('applyRegionInput called with:', { startTimeInput, endTimeInput, region });
            
            if (!region || !state.wavesurfer) {
                return;
            }
            
            const duration = state.wavesurfer.getDuration() || 0;

            let startSec = region.start;
            let endSec = region.end;

            const parsedStart = parseFloat(startTimeInput);
            const parsedEnd = parseFloat(endTimeInput);
            
            if (!isNaN(parsedStart)) startSec = parsedStart;
            if (!isNaN(parsedEnd)) endSec = parsedEnd;

            // 시작점이 끝점보다 크면 값 교환
            if (startSec > endSec) {
                const temp = startSec;
                startSec = endSec;
                endSec = temp;
            }

            // 전체 길이를 초과하는 경우 최대 길이로 제한
            if (startSec > duration) {
                startSec = Math.max(0, duration - CONSTANTS.REGION.MIN_DURATION);
            }
            
            if (endSec > duration) {
                endSec = duration;
            }

            // 최소값과 최대값 제한
            startSec = Math.max(0, startSec);
            endSec = Math.min(duration, endSec);

            // 최소 길이 유지
            if (startSec + CONSTANTS.REGION.MIN_DURATION > endSec) {
                endSec = Math.min(duration, startSec + CONSTANTS.REGION.MIN_DURATION);
            }

            try {
                // 기존 리전 제거
                if (state.regionsPlugin && state.regionsPlugin.getRegions) {
                    const regions = state.regionsPlugin.getRegions();
                    Object.values(regions).forEach(existingRegion => {
                        existingRegion.remove();
                    });
                }
                
                // 새 리전 생성
                if (state.regionsPlugin && state.regionsPlugin.addRegion) {
                    const newRegion = state.regionsPlugin.addRegion({
                        start: startSec,
                        end: endSec,
                        color: 'rgba(255, 0, 0, 0.1)'
                    });
                    
                    state.selectedRegionId = newRegion.id;
                    
                    // 오버레이 업데이트
                    setTimeout(() => {
                        this.createOverlays(newRegion);
                    }, 100);
                }
            } catch (err) {
                console.error('Failed to update region: ', err);
                utils.showStatus('Failed to update region: ' + err.message);
            }
        };
        
        const handleStartInput = (e) => {
            const startValue = e.target.value;
            const endValue = endInput.value;
            applyRegionInput(startValue, endValue);
        };
        
        const handleEndInput = (e) => {
            const startValue = startInput.value;
            const endValue = e.target.value;
            applyRegionInput(startValue, endValue);
        };
        
        startInput.addEventListener('change', handleStartInput);
        startInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
                handleStartInput(e);
            }
        });
        
        endInput.addEventListener('change', handleEndInput);
        endInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
                handleEndInput(e);
            }
        });
    },

    updateOverlays(region) {
        if (state.regionStartOverlay && state.regionEndOverlay) {
            const startInput = state.regionStartOverlay.querySelector('.region-start-input');
            const endInput = state.regionEndOverlay.querySelector('.region-end-input');
            startInput.value = region.start.toFixed(1);
            endInput.value = region.end.toFixed(1);
        }
    },

    removeOverlays() {
        if (state.regionStartOverlay) {
            state.regionStartOverlay.remove();
            state.regionStartOverlay = null;
        }
        if (state.regionEndOverlay) {
            state.regionEndOverlay.remove();
            state.regionEndOverlay = null;
        }
    },

    getSelectedRegion() {
        if (!state.regionsPlugin?.getRegions) {
            return null;
        }
        
        const regions = state.regionsPlugin.getRegions();
        
        if (!regions || Object.keys(regions).length === 0) {
            return null;
        }
        
        if (state.selectedRegionId && regions[state.selectedRegionId]) {
            const region = regions[state.selectedRegionId];
            return region;
        }
        
        const regionIds = Object.keys(regions);
        if (regionIds.length > 0) {
            const lastRegion = regions[regionIds[regionIds.length - 1]];
            state.selectedRegionId = lastRegion.id;
            return lastRegion;
        }
        return null;
    }
};

// File info management
const fileInfoManager = {
    updateDuration(durationFromMetadata = null) {
        let duration = durationFromMetadata;
        
        if (!duration) {
            duration = state.wavesurfer.getDuration();
        }
        
        if (duration && !isNaN(duration)) {
            const minutes = Math.floor(duration / 60);
            const seconds = Math.floor(duration % 60);
            elements.durationInfo.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    },

    updateFileInfo() {
        try {
            const decodedData = state.wavesurfer.getDecodedData();
            
            // Use server metadata if available, fallback to decoded data
            const sampleRate = audioMetadata.sampleRate || (decodedData?.sampleRate || CONSTANTS.WAVESURFER.SAMPLE_RATE);
            const channels = audioMetadata.channels || (decodedData?.numberOfChannels || 2);
            const bitDepth = audioMetadata.bitDepth || (decodedData?.length > 0 ? (decodedData instanceof Float32Array ? 32 : 16) : '--');
            const format = audioMetadata.format || this.detectFormat();
            const fileSize = audioMetadata.fileSize || (decodedData ? this.estimateFileSize(decodedData) : '--');
            const duration = audioMetadata.duration || (decodedData ? decodedData.length / sampleRate : '--');

            // Update UI elements
            elements.sampleRateInfo.textContent = sampleRate ? `${sampleRate} Hz` : '--';
            elements.channelsInfo.textContent = channels || '--';
            elements.bitDepthInfo.textContent = bitDepth === '--' ? '--' : `${bitDepth} bit`;
            elements.formatInfo.textContent = format || '--';
            elements.fileSizeInfo.textContent = fileSize || '--';
            
            // Update duration if available
            if (duration && duration !== '--') {
                this.updateDuration(duration);
            } else {
                this.updateDuration();
            }
            
            elements.fileInfo.style.display = 'flex';
        } catch (error) {
            console.warn('Error updating file info:', error);
        }
    },

    estimateFileSize(decodedData) {
        if (!decodedData) return '--';
        const estimatedSize = decodedData.length * decodedData.numberOfChannels * 2;
        const sizeInKB = Math.round(estimatedSize / 1024);
        const sizeInMB = (estimatedSize / (1024 * 1024)).toFixed(1);
        return sizeInMB > 1 ? `${sizeInMB} MB` : `${sizeInKB} KB`;
    },

    detectFormat() {
        if (audioSrc.startsWith('data:')) {
            const match = audioSrc.match(/data:([^;]+)/);
            if (match) {
                const mimeType = match[1];
                const formatMap = {
                    'mpeg': 'MP3', 'mp3': 'MP3', 'wav': 'WAV', 'flac': 'FLAC',
                    'ogg': 'OGG', 'aac': 'AAC', 'webm': 'WEBM'
                };
                
                for (const [key, format] of Object.entries(formatMap)) {
                    if (mimeType.includes(key)) return format;
                }
                return mimeType.split('/')[1]?.toUpperCase() || 'Unknown';
            }
        } else {
            const extension = audioSrc.split('.').pop()?.toLowerCase();
            const formatMap = {
                'mp3': 'MP3', 'wav': 'WAV', 'flac': 'FLAC',
                'ogg': 'OGG', 'aac': 'AAC', 'webm': 'WEBM'
            };
            return formatMap[extension] || extension?.toUpperCase() || 'Unknown';
        }
        return 'Unknown';
    }
};

// Event handlers
const eventHandlers = {
    setupPlayPause() {
        elements.playPause.addEventListener('click', async () => {
            try {
                if (state.isPlaying) {
                    state.wavesurfer.pause();
                } else {
                    if (!state.wavesurfer) {
                        return;
                    }
                    
                    if (!state.audioContextInitialized) {
                        await audioContextManager.initialize();
                    }
                    
                    const audioContext = audioContextManager.getWaveSurferAudioContext();
                    if (audioContext?.state === 'suspended') {
                        await audioContext.resume();
                    }
                    
                    const selectedRegion = regionManager.getSelectedRegion();
                    if (selectedRegion) {
                        await state.wavesurfer.play(selectedRegion.start, selectedRegion.end);
                    } else {
                        await state.wavesurfer.play();
                    }
                }
            } catch (error) {
                console.error('Playback error:', error);
                utils.showStatus('Playback error: ' + error.message);
                
                if (error.message.includes('AudioContext') || error.message.includes('suspended')) {
                    state.audioContextInitialized = false;
                    await audioContextManager.initialize();
                }
            }
        });
    },

    setupStop() {
        elements.stop.addEventListener('click', () => {
            state.wavesurfer.stop();
        });
    },

    setupZoom() {
        elements.zoomIn.addEventListener('click', () => {
            state.wavesurfer.zoom(CONSTANTS.WAVESURFER.ZOOM_LEVELS.IN);
        });

        elements.zoomOut.addEventListener('click', () => {
            state.wavesurfer.zoom(CONSTANTS.WAVESURFER.ZOOM_LEVELS.OUT);
        });

        elements.fitToScreen.addEventListener('click', () => {
            state.wavesurfer.zoom(CONSTANTS.WAVESURFER.ZOOM_LEVELS.FIT);
        });
    },

    setupVolume() {
        elements.volume.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            state.wavesurfer.setVolume(volume);
        });
    },

    setupLoop() {
        elements.loopEnabled.addEventListener('change', (e) => {
            state.loopEnabled = e.target.checked;
        });
    },

    setupWaveSurferEvents() {
        state.wavesurfer.on('play', () => {
            state.isPlaying = true;
            elements.playPause.textContent = '⏸️';
        });

        state.wavesurfer.on('pause', () => {
            state.isPlaying = false;
            elements.playPause.textContent = '▶️';
        });

        state.wavesurfer.on('stop', () => {
            state.isPlaying = false;
            elements.playPause.textContent = '▶️';
        });

        state.wavesurfer.on('finish', () => {
            if (state.loopEnabled) {
                const selectedRegion = regionManager.getSelectedRegion();
                if (selectedRegion) {
                    setTimeout(() => {
                        state.wavesurfer.play(selectedRegion.start, selectedRegion.end);
                    }, 100);
                } else {
                    setTimeout(() => {
                        state.wavesurfer.play();
                    }, 100);
                }
            } else {
                state.isPlaying = false;
                elements.playPause.textContent = '▶️';
            }
        });

        let loopCheckInterval = null;
        
        state.wavesurfer.on('play', () => {
            if (state.loopEnabled) {
                loopCheckInterval = setInterval(() => {
                    if (state.isPlaying && state.loopEnabled) {
                        const currentTime = state.wavesurfer.getCurrentTime();
                        const selectedRegion = regionManager.getSelectedRegion();
                        
                        if (selectedRegion && selectedRegion.start !== undefined && selectedRegion.end !== undefined) {
                            if (currentTime >= selectedRegion.end - 0.1) {
                                state.wavesurfer.play(selectedRegion.start, selectedRegion.end);
                            }
                        } else {
                            const duration = state.wavesurfer.getDuration();
                            if (currentTime >= duration - 0.1) {
                                state.wavesurfer.play();
                            }
                        }
                    }
                }, 100);
            }
        });

        state.wavesurfer.on('pause', () => {
            if (loopCheckInterval) {
                clearInterval(loopCheckInterval);
                loopCheckInterval = null;
            }
        });

        state.wavesurfer.on('stop', () => {
            if (loopCheckInterval) {
                clearInterval(loopCheckInterval);
                loopCheckInterval = null;
            }
        });

        state.wavesurfer.on('error', (error) => {
            utils.showStatus('Error: ' + error.message);
            vscode.postMessage({ command: 'error', text: error.message });
        });

        state.wavesurfer.on('ready', () => {
            
            setTimeout(() => {
                audioContextManager.checkState();
            }, 100);
        });

        state.wavesurfer.on('decode', () => {
            setTimeout(() => {
                fileInfoManager.updateFileInfo();
            }, 100);
        });
    }
};

// Main initialization
async function initAudioViewer() {
    try {
        utils.log('Initializing audio viewer...');
        utils.log('Audio source length: ' + audioSrc.length);

        state.wavesurfer = wavesurferConfig.create();
        
        const loadAudio = async () => {
            try {
                state.isSetupComplete = false;
                await state.wavesurfer.load(audioSrc);
                
                await new Promise(resolve => setTimeout(resolve, 100));
                audioContextManager.checkState();
                
            } catch (error) {
                console.error('Error loading audio:', error);
                utils.showStatus('Error loading audio: ' + error.message);
                throw error;
            }
        };

        const preloadAudio = async () => {
            try {
                await loadAudio();
            } catch (error) {
                console.warn('Preload failed:', error);
                utils.showStatus('Preload failed: ' + error.message);
                setupUserInteractionHandler();
            }
        };

        const setupUserInteractionHandler = () => {
            const handleUserInteraction = async () => {
                document.removeEventListener('click', handleUserInteraction);
                document.removeEventListener('keydown', handleUserInteraction);
                document.removeEventListener('touchstart', handleUserInteraction);
                
                try {
                    await audioContextManager.initialize();
                } catch (error) {
                    console.error('AudioContext initialization failed:', error);
                    utils.showStatus('AudioContext initialization failed: ' + error.message);
                }
            };

            document.addEventListener('click', handleUserInteraction);
            document.addEventListener('keydown', handleUserInteraction);
            document.addEventListener('touchstart', handleUserInteraction);
        };

        preloadAudio();
        
        const setupAfterDecode = async () => {
            if (state.isSetupComplete) return;
            
            state.isSetupComplete = true;
            
            await pluginManager.setupSpectrogram();
            await pluginManager.setupTimeline();
            await pluginManager.setupRegions();

            // Hide loading, show content
            elements.loading.style.display = 'none';
            elements.waveform.style.display = 'block';
            elements.spectrogram.style.display = 'block';
            
            // Force spectrogram redraw
            if (state.spectrogramPlugin) {
                setTimeout(() => {
                    state.spectrogramPlugin.render();
                }, 100);
            }
            
            // Set up event listeners
            eventHandlers.setupPlayPause();
            eventHandlers.setupStop();
            eventHandlers.setupZoom();
            eventHandlers.setupVolume();
            eventHandlers.setupLoop();
            eventHandlers.setupWaveSurferEvents();
            
            // Update info
            fileInfoManager.updateDuration();
            fileInfoManager.updateFileInfo();
            
            setTimeout(() => {
                if (state.spectrogramPlugin) {
                    try {
                        utils.log('Spectrogram frequency range check...');
                        utils.log('Sample rate: ' + (state.wavesurfer.getDecodedData()?.sampleRate || 'unknown'));
                        utils.log('FFT size: ' + (state.spectrogramPlugin.params?.fftSize || 'unknown'));
                    } catch (error) {
                        console.warn('Error checking spectrogram frequency range:', error);
                    }
                }
            }, 1000);
        };

        state.wavesurfer.on('decode', setupAfterDecode);
        
    } catch (error) {
        console.error('Error loading audio:', error);
        elements.loading.style.display = 'none';
        elements.error.style.display = 'block';
        elements.error.textContent = 'Error loading audio file: ' + error.message;
        vscode.postMessage({ command: 'error', text: error.message });
        
        if (error.name === 'NotSupportedError') {
            elements.error.textContent += '\n\nThis audio format may not be supported by your browser.';
        } else if (error.name === 'QuotaExceededError') {
            elements.error.textContent += '\n\nFile is too large. Try a smaller audio file.';
        }
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    regionManager.hideControls();
    initAudioViewer();
});

// Log to VSCode console
vscode.postMessage({ command: 'log', text: 'Audio viewer initialized' });
