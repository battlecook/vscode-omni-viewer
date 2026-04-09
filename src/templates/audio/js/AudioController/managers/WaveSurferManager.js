import WaveSurfer from 'wavesurfer.js';
import HoverPlugin from '../../../../../../node_modules/wavesurfer.js/dist/plugins/hover.js';
import MinimapPlugin from '../../../../../../node_modules/wavesurfer.js/dist/plugins/minimap.js';
import { CONSTANTS } from '../utils/Constants.js';
import { AudioUtils } from '../utils/AudioUtils.js';

export class WaveSurferManager {
    constructor(state) {
        this.state = state;
    }

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
                HoverPlugin.create({
                    lineWidth: 2,
                    labelBackground: '#000000',
                    labelColor: '#fff',
                    formatTimeCallback: AudioUtils.formatTime
                })
            ]
        });
    }

    /**
     * Create WaveSurfer in precomputed mode (large files).
     * Uses MediaElement backend with pre-generated peaks.
     * Zoomed-in view with minimap for navigation.
     */
    async createPrecomputed({ url, peaks, duration }) {
        // Calculate zoom: target ~30 seconds visible at a time
        const containerWidth = document.getElementById('waveform')?.offsetWidth || 1000;
        const visibleSeconds = Math.min(30, duration);
        const minPxPerSec = containerWidth / visibleSeconds;

        // Fetch as blob to guarantee seeking works without HTTP Range support
        let audioSrc = url;
        const audio = new Audio();
        audio.preload = 'auto';
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            audioSrc = URL.createObjectURL(blob);
            audio.src = audioSrc;
            AudioUtils.log('Audio loaded as blob URL for reliable seeking');
        } catch (e) {
            console.warn('Blob fetch failed, using direct URL:', e);
            audio.src = url;
        }

        return WaveSurfer.create({
            container: '#waveform',
            waveColor: CONSTANTS.WAVESURFER.WAVE_COLOR,
            progressColor: CONSTANTS.WAVESURFER.PROGRESS_COLOR,
            cursorColor: CONSTANTS.WAVESURFER.CURSOR_COLOR,
            barWidth: 1,
            barRadius: 1,
            cursorWidth: CONSTANTS.WAVESURFER.CURSOR_WIDTH,
            barGap: 1,
            responsive: true,
            normalize: true,
            backend: 'MediaElement',
            media: audio,
            peaks: peaks,
            duration: duration,
            minPxPerSec: minPxPerSec,
            autoScroll: true,
            autoCenter: true,
            autoplay: false,
            mediaControls: false,
            hideScrollbar: false,
            interact: true,
            plugins: [
                HoverPlugin.create({
                    lineWidth: 2,
                    labelBackground: '#000000',
                    labelColor: '#fff',
                    formatTimeCallback: AudioUtils.formatTime
                }),
                MinimapPlugin.create({
                    height: 40,
                    waveColor: '#3a366e',
                    progressColor: '#2a2546',
                    overlayColor: 'rgba(100, 100, 200, 0.15)',
                    container: '#minimap',
                    insertPosition: 'beforeend',
                })
            ]
        });
    }

    /**
     * Create WaveSurfer in streaming mode (large file, WASM fallback).
     * Uses MediaElement backend without pre-generated peaks.
     * WaveSurfer will decode audio progressively.
     */
    async createStreaming({ url }) {
        // Fetch as blob to guarantee seeking works without HTTP Range support
        const audio = new Audio();
        audio.preload = 'auto';
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            audio.src = URL.createObjectURL(blob);
        } catch (e) {
            console.warn('Blob fetch failed, using direct URL:', e);
            audio.src = url;
        }

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
            normalize: true,
            backend: 'MediaElement',
            media: audio,
            autoplay: false,
            mediaControls: false,
            hideScrollbar: false,
            interact: true,
            plugins: [
                HoverPlugin.create({
                    lineWidth: 2,
                    labelBackground: '#000000',
                    labelColor: '#fff',
                    formatTimeCallback: AudioUtils.formatTime
                })
            ]
        });
    }

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
}
