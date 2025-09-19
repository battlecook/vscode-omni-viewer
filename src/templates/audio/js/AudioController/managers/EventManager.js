import { AudioUtils } from '../utils/AudioUtils.js';

export class EventManager {
    constructor(state, audioContextManager, regionManager) {
        this.state = state;
        this.audioContextManager = audioContextManager;
        this.regionManager = regionManager;
    }

    setupPlayPause() {
        this.state.elements.playPause.addEventListener('click', async () => {
            console.log('Play/Pause button clicked, current state:', this.state.isPlaying);
            try {
                if (this.state.isPlaying) {
                    this.state.wavesurfer.pause();
                } else {
                    if (!this.state.wavesurfer) {
                        return;
                    }
                    
                    if (!this.state.audioContextInitialized) {
                        await this.audioContextManager.initialize();
                    }
                    
                    const audioContext = this.audioContextManager.getWaveSurferAudioContext();
                    if (audioContext?.state === 'suspended') {
                        await audioContext.resume();
                    }
                    
                    const selectedRegion = this.regionManager.getSelectedRegion();
                    if (selectedRegion) {
                        await this.state.wavesurfer.play(selectedRegion.start, selectedRegion.end);
                    } else {
                        await this.state.wavesurfer.play();
                    }
                }
            } catch (error) {
                console.error('Playback error:', error);
                AudioUtils.showStatus('Playback error: ' + error.message, this.state.elements.status);
                
                if (error.message.includes('AudioContext') || error.message.includes('suspended')) {
                    this.state.audioContextInitialized = false;
                    await this.audioContextManager.initialize();
                }
            }
        });
    }

    setupStop() {
        this.state.elements.stop.addEventListener('click', () => {
            this.state.wavesurfer.stop();
        });
    }

    setupVolume() {
        this.state.elements.volume.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            this.state.wavesurfer.setVolume(volume);
        });
    }

    setupLoop() {
        this.state.elements.loopEnabled.addEventListener('change', (e) => {
            this.state.loopEnabled = e.target.checked;
        });
    }

    setupSpectrogramScale() {
        if (this.state.elements.spectrogramScale) {
            this.state.elements.spectrogramScale.addEventListener('change', async (e) => {
                const newScale = e.target.value;
                console.log('Spectrogram scale changed to:', newScale);
                
                if (this.state.pluginManager) {
                    await this.state.pluginManager.changeSpectrogramScale(newScale);
                }
            });
        }
    }

    setupKeyboardEvents() {
        document.addEventListener('keydown', async (e) => {
            if (e.code === 'Space' && !e.target.matches('input, textarea')) {
                console.log('Space key detected, triggering play/pause');
                e.preventDefault();
                
                if (!this.state.audioContextInitialized) {
                    try {
                        await this.audioContextManager.initialize();
                    } catch (error) {
                        console.error('AudioContext initialization failed on spacebar:', error);
                        AudioUtils.showStatus('AudioContext initialization failed: ' + error.message, this.state.elements.status);
                        return;
                    }
                }
                
                const audioContext = this.audioContextManager.getWaveSurferAudioContext();
                if (audioContext?.state === 'suspended') {
                    try {
                        await audioContext.resume();
                    } catch (error) {
                        console.error('Failed to resume AudioContext on spacebar:', error);
                        AudioUtils.showStatus('Failed to resume AudioContext: ' + error.message, this.state.elements.status);
                        return;
                    }
                }
                
                this.state.elements.playPause.click();
            }
        });
    }

    setupWaveSurferEvents() {
        this.state.wavesurfer.on('play', () => {
            console.log('WaveSurfer play event triggered');
            this.state.isPlaying = true;
            this.state.elements.playPause.textContent = '⏸️';
            this.state.elements.playPause.classList.add('playing');
            console.log('Button text changed to pause icon');
        });

        this.state.wavesurfer.on('pause', () => {
            console.log('WaveSurfer pause event triggered');
            this.state.isPlaying = false;
            this.state.elements.playPause.textContent = '▶️';
            this.state.elements.playPause.classList.remove('playing');
            console.log('Button text changed to play icon');
        });

        this.state.wavesurfer.on('stop', () => {
            console.log('WaveSurfer stop event triggered');
            this.state.isPlaying = false;
            this.state.elements.playPause.textContent = '▶️';
            this.state.elements.playPause.classList.remove('playing');
            console.log('Button text changed to play icon');
        });

        this.state.wavesurfer.on('finish', () => {
            if (this.state.loopEnabled) {
                const selectedRegion = this.regionManager.getSelectedRegion();
                if (selectedRegion) {
                    setTimeout(() => {
                        this.state.wavesurfer.play(selectedRegion.start, selectedRegion.end);
                    }, 100);
                } else {
                    setTimeout(() => {
                        this.state.wavesurfer.play();
                    }, 100);
                }
            } else {
                this.state.isPlaying = false;
                this.state.elements.playPause.textContent = '▶️';
                this.state.elements.playPause.classList.remove('playing');
            }
        });

        // Loop functionality
        let loopCheckInterval = null;
        
        this.state.wavesurfer.on('play', () => {
            if (this.state.loopEnabled) {
                loopCheckInterval = setInterval(() => {
                    if (this.state.isPlaying && this.state.loopEnabled) {
                        const currentTime = this.state.wavesurfer.getCurrentTime();
                        const selectedRegion = this.regionManager.getSelectedRegion();
                        
                        if (selectedRegion && selectedRegion.start !== undefined && selectedRegion.end !== undefined) {
                            if (currentTime >= selectedRegion.end - 0.1) {
                                this.state.wavesurfer.play(selectedRegion.start, selectedRegion.end);
                            }
                        } else {
                            const duration = this.state.wavesurfer.getDuration();
                            if (currentTime >= duration - 0.1) {
                                this.state.wavesurfer.play();
                            }
                        }
                    }
                }, 100);
            }
        });

        this.state.wavesurfer.on('pause', () => {
            if (loopCheckInterval) {
                clearInterval(loopCheckInterval);
                loopCheckInterval = null;
            }
        });

        this.state.wavesurfer.on('stop', () => {
            if (loopCheckInterval) {
                clearInterval(loopCheckInterval);
                loopCheckInterval = null;
            }
        });

        this.state.wavesurfer.on('error', (error) => {
            AudioUtils.showStatus('Error: ' + error.message, this.state.elements.status);
            vscode.postMessage({ command: 'error', text: error.message });
        });

        this.state.wavesurfer.on('ready', () => {
            setTimeout(() => {
                this.audioContextManager.checkState();
            }, 100);
        });

        this.state.wavesurfer.on('decode', () => {
            setTimeout(() => {
                this.state.fileInfoManager.updateFileInfo();
            }, 100);
        });
    }
}
