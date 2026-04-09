// DOM utility functions
export const DOMUtils = {
    // Cache DOM elements
    getElements: () => {
        return {
            playPause: document.getElementById('playPause'),
            stop: document.getElementById('stop'),
            volume: document.getElementById('volume'),
            loopEnabled: document.getElementById('loopEnabled'),
            loopControls: document.getElementById('loopControls'),
            spectrogramScale: document.getElementById('spectrogramScale'),
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
            formatInfo: document.getElementById('formatInfo'),
            downloadBtn: document.getElementById('downloadBtn'),
            zoomControls: document.getElementById('zoomControls'),
            zoomIn: document.getElementById('zoomIn'),
            zoomOut: document.getElementById('zoomOut'),
            zoomLevel: document.getElementById('zoomLevel')
        };
    },

    // Get metadata from server
    getMetadata: () => {
        try {
            const metadataScript = document.getElementById('metadata-script');
            if (metadataScript && metadataScript.textContent) {
                return JSON.parse(metadataScript.textContent);
            }
        } catch (error) {
            console.warn('Error parsing metadata:', error);
        }
        return {};
    },

    // Get precomputed data (WASM-generated peaks/spectrogram)
    getPrecomputedData: () => {
        try {
            const script = document.getElementById('precomputed-data');
            if (script && script.textContent) {
                const raw = JSON.parse(script.textContent);
                if (raw.mode === 'precomputed') {
                    return {
                        mode: raw.mode,
                        peaks: raw.peaks ? JSON.parse(raw.peaks) : null,
                        duration: raw.duration ? parseFloat(raw.duration) : null,
                        spectrogram: raw.spectrogram ? JSON.parse(raw.spectrogram) : null,
                        sampleRate: raw.sampleRate ? parseInt(raw.sampleRate, 10) : null
                    };
                }
                if (raw.mode === 'streaming') {
                    return { mode: 'streaming' };
                }
            }
        } catch (error) {
            console.warn('Error parsing precomputed data:', error);
        }
        return null;
    }
};
