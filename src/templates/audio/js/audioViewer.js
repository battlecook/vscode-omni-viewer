const vscode = acquireVsCodeApi();

// Audio file source
const audioSrc = '{{audioSrc}}';

// Initialize WaveSurfer
let wavesurfer;
let spectrogramPlugin;
let timelinePlugin;
let regionsPlugin;
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
const loopControls = document.getElementById('loopControls');
const loopInputs = document.getElementById('loopInputs');
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
            plugins: [
                WaveSurfer.Hover.create({
                    lineWidth: 2,
                    labelBackground: '#000000',
                    labelColor: '#fff',
                    formatTimeCallback: (seconds) => {
                        const minutes = Math.floor(seconds / 60);
                        const remainingSeconds = Math.floor(seconds % 60);
                        const milliseconds = Math.floor((seconds % 1) * 1000);
                        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
                    }
                })
            ]
        });
        
        const loadAudio = async () => {
            try {
                isSetupComplete = false;
                showStatus('Loading audio...');
                await wavesurfer.load(audioSrc);
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
            if (spectrogramPlugin) {
                try {
                    wavesurfer.unregisterPlugin(spectrogramPlugin);
                    spectrogramPlugin = null;
                } catch (error) {
                    console.warn('Error removing existing spectrogram plugin:', error);
                }
            }
            
            const spectrogramContainer = document.getElementById('spectrogram');
            if (spectrogramContainer) {
                spectrogramContainer.innerHTML = '';
            }
            
            try {
                spectrogramPlugin = wavesurfer.registerPlugin(WaveSurfer.Spectrogram.create({
                    container: '#spectrogram',
                    labels: true,
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
                spectrogramPlugin = null;
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


        const setupRegions = async () => {
            try {
                regionsPlugin = wavesurfer.registerPlugin(WaveSurfer.Regions.create({}));
                if (typeof vscode !== 'undefined' && vscode.env && vscode.env.uiKind === 1) {
                    console.log('Regions plugin registered successfully');
                }
            } catch (error) {
                console.warn('Failed to register regions plugin:', error);
                regionsPlugin = null;
            }
            
            regionsPlugin.enableDragSelection({
                color: 'rgba(255, 0, 0, 0.1)',
            });

            regionsPlugin.on('region-created', (region) => {
                if (regionsPlugin.getRegions) {
                  const newRegions = regionsPlugin.getRegions()
                  newRegions.forEach((existingRegion) => {
                    if (existingRegion.id !== region.id) {
                      existingRegion.remove()
                    }
                  })
                }
                selectedRegionId = region.id;
                showRegionControls();
                
                // 리전이 생성된 후 약간의 지연을 두고 오버레이 생성
                setTimeout(() => {
                    createRegionOverlays(region);
                }, 100);
                
                showStatus('Region created: ' + region.id);
            });

            regionsPlugin.on('region-clicked', (region) => {
                selectedRegionId = region.id;
                showRegionControls();
                createRegionOverlays(region);
                showStatus('Selected region: ' + region.id);
            });

            regionsPlugin.on('region-removed', (region) => {
                if (selectedRegionId === region.id) {
                    selectedRegionId = null;
                    hideRegionControls();
                }
                showStatus('Region removed: ' + region.id);
            });

            // 리전이 업데이트될 때 오버레이 위치도 업데이트
            regionsPlugin.on('region-updated', (region) => {
                if (selectedRegionId === region.id) {
                    updateRegionOverlays(region);
                }
            });

                        // 웨이브폼 클릭 시 리전 제거
            const waveformContainer = document.getElementById('waveform');
            waveformContainer.addEventListener('click', (e) => {
                // 클릭된 요소가 리전이나 리전 관련 요소가 아닌 경우에만 리전 제거
                const clickedElement = e.target;
                const isRegionElement = clickedElement.closest('.wavesurfer-region') || 
                                       clickedElement.closest('.region-input-overlay') ||
                                       clickedElement.classList.contains('region-input-overlay') ||
                       clickedElement.classList.contains('region-start-input') ||
                       clickedElement.classList.contains('region-end-input');
                
                if (!isRegionElement && regionsPlugin && regionsPlugin.getRegions) {
                    const regions = regionsPlugin.getRegions();
                    if (regions && Object.keys(regions).length > 0) {
                        // 모든 리전 제거
                        Object.values(regions).forEach(region => {
                            region.remove();
                        });
                        selectedRegionId = null;
                        hideRegionControls();
                        showStatus('All regions removed');
                    }
                }
            });

            // 스펙트로그램 클릭 시에도 리전 제거
            const spectrogramContainer = document.getElementById('spectrogram');
            if (spectrogramContainer) {
                spectrogramContainer.addEventListener('click', (e) => {
                    if (regionsPlugin && regionsPlugin.getRegions) {
                        const regions = regionsPlugin.getRegions();
                        if (regions && Object.keys(regions).length > 0) {
                            // 모든 리전 제거
                            Object.values(regions).forEach(region => {
                                region.remove();
                            });
                            selectedRegionId = null;
                            hideRegionControls();
                            showStatus('All regions removed');
                        }
                    }
                });
            }
        };

        const setupAfterDecode = async () => {
            if (isSetupComplete) return;
            
            isSetupComplete = true;
            

            await setupSpectrogram();
            
            if (timelinePlugin) {
                try {
                    wavesurfer.unregisterPlugin(timelinePlugin);
                    timelinePlugin = null;
                } catch (error) {
                    console.warn('Error removing existing timeline plugin:', error);
                }
            }

            if (regionsPlugin) {
                try {
                    wavesurfer.unregisterPlugin(regionsPlugin);
                    regionsPlugin = null;
                } catch (error) {
                    console.warn('Error removing existing regions plugin:', error);
                }
            }
            
            const timelineContainer = document.getElementById('timeline');
            if (timelineContainer) {
                timelineContainer.innerHTML = '';
            }
            
            const intervals = getTimelineIntervals(wavesurfer.getDuration());
            // Register timeline plugin
            try {
                timelinePlugin = wavesurfer.registerPlugin(WaveSurfer.Timeline.create({
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
                timelinePlugin = null;
            }

            await setupRegions();

            // Hide loading, show content
            loadingDiv.style.display = 'none';
            waveformDiv.style.display = 'block';
            spectrogramDiv.style.display = 'block';
            
            // Force spectrogram redraw for both view
            if (spectrogramPlugin) {
                setTimeout(() => {
                    spectrogramPlugin.render();
                }, 100);
            }
            
            // Set up event listeners
            setupEventListeners();
            
            // Update loop end placeholder and file info
            updateDuration();
            updateFileInfo();
            
            showStatus('Audio loaded successfully');
            
            setTimeout(() => {
                if (spectrogramPlugin) {
                    try {
                        if (typeof vscode !== 'undefined' && vscode.env && vscode.env.uiKind === 1) {
                            console.log('Spectrogram frequency range check...');
                            console.log('Sample rate:', wavesurfer.getDecodedData()?.sampleRate || 'unknown');
                            console.log('FFT size:', spectrogramPlugin.params?.fftSize || 'unknown');
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
                
                // 선택된 리전이 있는지 확인
                const selectedRegion = getSelectedRegion();
                if (selectedRegion) {
                    console.log('Playing selected region:', selectedRegion.id);
                    showStatus('Playing selected region');
                    await wavesurfer.play(selectedRegion.start, selectedRegion.end);
                } else {
                    console.log('No region selected, playing full audio...');
                    showStatus('Playing full audio');
                    await wavesurfer.play();
                }
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

let selectedRegionId = null;

// 리전 위에 입력창을 관리하는 변수들
let regionStartOverlay = null;
let regionEndOverlay = null;

// UI 표시/숨김 함수들
function showRegionControls() {
    loopControls.style.display = 'none';
    loopInputs.style.display = 'none';
}

function hideRegionControls() {
    loopControls.style.display = 'flex';
    loopInputs.style.display = 'flex';
    removeRegionOverlays();
}

function createRegionOverlays(region) {
    removeRegionOverlays();
    
    const waveformContainer = document.getElementById('waveform');
    const containerRect = waveformContainer.getBoundingClientRect();
    const regionElement = region.element;
    
    if (!regionElement) return;
    
    const regionRect = regionElement.getBoundingClientRect();
    
    // Start 입력창 생성 (리전 시작선 옆)
    regionStartOverlay = document.createElement('div');
    regionStartOverlay.className = 'region-input-overlay';
    regionStartOverlay.innerHTML = `
        <input type="number" value="${region.start.toFixed(1)}" class="region-start-input" title="Start time">
    `;
    
    // End 입력창 생성 (리전 끝선 옆)
    regionEndOverlay = document.createElement('div');
    regionEndOverlay.className = 'region-input-overlay';
    regionEndOverlay.innerHTML = `
        <input type="number" value="${region.end.toFixed(1)}" class="region-end-input" title="End time">
    `;
    
    // 위치 계산 및 배치 - 리전 선 바로 옆에 배치
    const startLeft = regionRect.left - containerRect.left - 10; // 리전 시작선 바로 옆
    const endLeft = regionRect.right - containerRect.left + 10; // 리전 끝선 바로 옆
    const top = regionRect.top - containerRect.top + 10; // 리전 아래쪽
    
    regionStartOverlay.style.left = startLeft + 'px';
    regionStartOverlay.style.top = top + 'px';
    
    regionEndOverlay.style.left = endLeft + 'px';
    regionEndOverlay.style.top = top + 'px';
    
    // DOM에 추가
    waveformContainer.appendChild(regionStartOverlay);
    waveformContainer.appendChild(regionEndOverlay);
    
    // 이벤트 리스너 추가
    const startInput = regionStartOverlay.querySelector('.region-start-input');
    const endInput = regionEndOverlay.querySelector('.region-end-input');
    
    // 엔터키와 포커스 아웃 이벤트 처리
    const handleStartInput = (e) => {
        const newStart = parseFloat(e.target.value) || 0;
        const duration = wavesurfer.getDuration();
        const newEnd = Math.max(newStart + 0.1, region.end);
        region.setStart(newStart);
        region.setEnd(newEnd);
        updateRegionOverlays(region);
        showStatus('Region start updated: ' + newStart.toFixed(1));
    };
    
    const handleEndInput = (e) => {
        const newEnd = parseFloat(e.target.value) || 0;
        const duration = wavesurfer.getDuration();
        const newStart = Math.min(newEnd - 0.1, region.start);
        region.setStart(newStart);
        region.setEnd(newEnd);
        updateRegionOverlays(region);
        showStatus('Region end updated: ' + newEnd.toFixed(1));
    };
    
    startInput.addEventListener('change', handleStartInput);
    startInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.target.blur(); // 포커스 아웃하여 change 이벤트 발생
        }
    });
    
    endInput.addEventListener('change', handleEndInput);
    endInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.target.blur(); // 포커스 아웃하여 change 이벤트 발생
        }
    });
}

function updateRegionOverlays(region) {
    if (regionStartOverlay && regionEndOverlay) {
        const startInput = regionStartOverlay.querySelector('.region-start-input');
        const endInput = regionEndOverlay.querySelector('.region-end-input');
        startInput.value = region.start.toFixed(1);
        endInput.value = region.end.toFixed(1);
    }
}

function removeRegionOverlays() {
    if (regionStartOverlay) {
        regionStartOverlay.remove();
        regionStartOverlay = null;
    }
    if (regionEndOverlay) {
        regionEndOverlay.remove();
        regionEndOverlay = null;
    }
}

function getSelectedRegion() {
    if (!regionsPlugin || !regionsPlugin.getRegions) {
        return null;
    }
    
    const regions = regionsPlugin.getRegions();
    if (!regions || Object.keys(regions).length === 0) {
        return null;
    }
    
    if (selectedRegionId && regions[selectedRegionId]) {
        return regions[selectedRegionId];
    }
    
    const regionIds = Object.keys(regions);
    if (regionIds.length > 0) {
        const lastRegion = regions[regionIds[regionIds.length - 1]];
        selectedRegionId = lastRegion.id;
        return lastRegion;
    }
    
    return null;
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    // 초기화 시 loop UI 숨기기
    hideRegionControls();
    initAudioViewer();
});

// Log to VSCode console
vscode.postMessage({ command: 'log', text: 'Audio viewer initialized' });
