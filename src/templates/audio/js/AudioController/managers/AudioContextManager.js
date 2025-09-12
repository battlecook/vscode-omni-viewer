import { AudioUtils } from '../utils/AudioUtils.js';

export class AudioContextManager {
    constructor(state) {
        this.state = state;
    }

    async initialize() {
        if (this.state.audioContextInitialized) return;
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            this.state.audioContextInitialized = true;
            
        } catch (error) {
            console.error('Failed to initialize AudioContext:', error);
            AudioUtils.showStatus('AudioContext initialization failed: ' + error.message, this.state.elements?.status);
        }
    }

    getWaveSurferAudioContext() {
        try {
            if (!this.state.wavesurfer?.backend?.audioContext) {
                return null;
            }
            return this.state.wavesurfer.backend.audioContext;
        } catch (error) {
            console.error('Error getting WaveSurfer AudioContext:', error);
            return null;
        }
    }

    checkState() {
        const audioContext = this.getWaveSurferAudioContext();
        if (audioContext) {
            return audioContext.state;
        } else {
            return null;
        }
    }
}
