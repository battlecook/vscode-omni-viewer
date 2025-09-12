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
    }

    async initAudioViewer() {
        try {
            AudioUtils.log('Initializing audio viewer...');
            AudioUtils.log('Audio source length: ' + this.audioSrc.length);

            // Clear any existing regions from DOM first
            this.regionManager.clearRegionsFromDOM();

            this.state.wavesurfer = this.waveSurferManager.create();
            
            const loadAudio = async () => {
                try {
                    this.state.isSetupComplete = false;
                    
                    // Clear existing regions before loading new audio
                    this.regionManager.clearAllRegions();
                    
                    await this.state.wavesurfer.load(this.audioSrc);
                    
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
                    this.setupUserInteractionHandler();
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

            // 키보드 이벤트를 먼저 등록하여 사용자가 바로 스페이스바를 사용할 수 있도록 함
            this.eventManager.setupKeyboardEvents();
            
            preloadAudio();
            
            const setupAfterDecode = async () => {
                if (this.state.isSetupComplete) return;
                
                console.log('Setting up audio viewer after decode...');
                this.state.isSetupComplete = true;
                
                await this.pluginManager.setupSpectrogram();
                await this.pluginManager.setupTimeline();
                await this.pluginManager.setupRegions();

                // Hide loading, show content
                this.state.elements.loading.style.display = 'none';
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
                this.eventManager.setupWaveSurferEvents();
                console.log('Event listeners setup complete');
                
                // Update info
                this.fileInfoManager.updateDuration();
                this.fileInfoManager.updateFileInfo();
                
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
            };

            this.state.wavesurfer.on('decode', setupAfterDecode);
            
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

    initialize() {
        // Clear any existing regions from DOM first
        this.regionManager.clearRegionsFromDOM();
        
        // Initialize region state
        this.regionManager.hideControls();
        this.regionManager.clearAllRegions();
        
        this.initAudioViewer();
        
        // Log to VSCode console
        this.vscode.postMessage({ command: 'log', text: 'Audio viewer initialized' });
    }
}