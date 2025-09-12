// Constants for audio viewer
export const CONSTANTS = {
    WAVESURFER: {
        WAVE_COLOR: '#4F4A85',
        PROGRESS_COLOR: '#383351',
        CURSOR_COLOR: '#fff',
        BAR_WIDTH: 2,
        BAR_RADIUS: 3,
        CURSOR_WIDTH: 1,
        BAR_GAP: 3,
        SAMPLE_RATE: 44100,
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
