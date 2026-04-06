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
            debugInfo: document.getElementById('debugInfo'),
            downloadBtn: document.getElementById('downloadBtn'),
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

    // Get viewer configuration (isLargeFile, etc.)
    getViewerConfig: () => {
        try {
            const configScript = document.getElementById('viewer-config');
            if (configScript && configScript.textContent) {
                return JSON.parse(configScript.textContent);
            }
        } catch (error) {
            console.warn('Error parsing viewer config:', error);
        }
        return {};
    }
};
