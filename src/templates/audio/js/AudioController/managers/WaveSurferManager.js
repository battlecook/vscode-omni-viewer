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
                WaveSurfer.Hover.create({
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