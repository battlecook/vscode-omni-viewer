/**
 * ChunkedSpectrogramRenderer
 * Receives PCM chunks, computes FFT, accumulates magnitude columns,
 * and renders a spectrogram canvas for large audio files.
 */

const FFT_SIZE = 4096;
const HOP_SIZE = 2048; // 50% overlap
const MAX_CANVAS_WIDTH = 4000;
const MAX_STORED_COLUMNS = 4096;
const CANVAS_HEIGHT = 250;
const GAIN_DB = 20;
const RANGE_DB = 80;

// --- Radix-2 FFT ---

function fft(re, im) {
    const n = re.length;
    if (n <= 1) { return; }

    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
            let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
            tmp = im[i]; im[i] = im[j]; im[j] = tmp;
        }
    }

    // Cooley-Tukey
    for (let len = 2; len <= n; len *= 2) {
        const halfLen = len / 2;
        const angle = -2 * Math.PI / len;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);

        for (let i = 0; i < n; i += len) {
            let curRe = 1, curIm = 0;
            for (let j = 0; j < halfLen; j++) {
                const a = i + j;
                const b = a + halfLen;
                const tRe = curRe * re[b] - curIm * im[b];
                const tIm = curRe * im[b] + curIm * re[b];
                re[b] = re[a] - tRe;
                im[b] = im[a] - tIm;
                re[a] += tRe;
                im[a] += tIm;
                const nextRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = nextRe;
            }
        }
    }
}

// Hann window (pre-computed)
const hannWindow = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
}

// Colormap tuned to avoid clipping hot bins to white.
function magnitudeToColor(dB) {
    const floorDB = -(GAIN_DB + RANGE_DB);
    const ceilingDB = -GAIN_DB;
    const normalized = Math.max(0, Math.min(1, (dB - floorDB) / (ceilingDB - floorDB)));
    const t = Math.pow(normalized, 0.85);
    let r, g, b;
    if (t < 0.2) {
        const s = t / 0.2;
        r = Math.round(12 + (40 * s));
        g = 0;
        b = Math.round(28 + (110 * s));
    } else if (t < 0.45) {
        const s = (t - 0.2) / 0.25;
        r = Math.round(52 + (130 * s));
        g = Math.round(4 + (16 * s));
        b = Math.round(138 - (50 * s));
    } else if (t < 0.7) {
        const s = (t - 0.45) / 0.25;
        r = Math.round(182 + (60 * s));
        g = Math.round(20 + (55 * s));
        b = Math.round(88 - (70 * s));
    } else {
        const s = (t - 0.7) / 0.3;
        r = Math.round(242 + (13 * s));
        g = Math.round(75 + (125 * s));
        b = Math.round(18 * (1 - s));
    }
    return (255 << 24) | (b << 16) | (g << 8) | r; // ABGR for little-endian ImageData
}

// --- Frequency scale conversion functions ---

function hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
}

function hzToBark(hz) {
    return 13 * Math.atan(0.00076 * hz) + 3.5 * Math.atan(Math.pow(hz / 7500, 2));
}

function hzToErb(hz) {
    return 21.4 * Math.log10(0.00437 * hz + 1);
}

/**
 * Map a canvas row to a frequency bin index based on the selected scale.
 * row 0 = top of canvas (high freq), row canvasHeight-1 = bottom (low freq).
 */
function rowToFreqBin(row, canvasHeight, freqBins, nyquist, scale) {
    // Normalized position: 0 = low freq (bottom), 1 = high freq (top)
    const normPos = (canvasHeight - 1 - row) / canvasHeight;

    if (scale === 'linear' || !scale) {
        return Math.floor(normPos * freqBins);
    }

    // Choose the conversion function
    let hzToScale;
    if (scale === 'mel') { hzToScale = hzToMel; }
    else if (scale === 'bark') { hzToScale = hzToBark; }
    else if (scale === 'erb') { hzToScale = hzToErb; }
    else { return Math.floor(normPos * freqBins); }

    const scaleMin = hzToScale(0);
    const scaleMax = hzToScale(nyquist);
    // Map normPos to the scale domain, then back to Hz, then to bin
    const scaleVal = scaleMin + normPos * (scaleMax - scaleMin);

    // Invert: find Hz for this scale value (binary search)
    let lo = 0, hi = nyquist;
    for (let iter = 0; iter < 30; iter++) {
        const mid = (lo + hi) / 2;
        if (hzToScale(mid) < scaleVal) { lo = mid; }
        else { hi = mid; }
    }
    const hz = (lo + hi) / 2;
    const bin = Math.round((hz / nyquist) * freqBins);
    return Math.max(0, Math.min(freqBins - 1, bin));
}

function rowBoundaryToFreqBin(rowBoundary, canvasHeight, freqBins, nyquist, scale) {
    const clampedBoundary = Math.max(0, Math.min(canvasHeight, rowBoundary));
    const normPos = (canvasHeight - clampedBoundary) / canvasHeight;

    if (scale === 'linear' || !scale) {
        return Math.max(0, Math.min(freqBins - 1, Math.round(normPos * (freqBins - 1))));
    }

    let hzToScale;
    if (scale === 'mel') { hzToScale = hzToMel; }
    else if (scale === 'bark') { hzToScale = hzToBark; }
    else if (scale === 'erb') { hzToScale = hzToErb; }
    else {
        return Math.max(0, Math.min(freqBins - 1, Math.round(normPos * (freqBins - 1))));
    }

    const scaleMin = hzToScale(0);
    const scaleMax = hzToScale(nyquist);
    const scaleVal = scaleMin + normPos * (scaleMax - scaleMin);

    let lo = 0;
    let hi = nyquist;
    for (let iter = 0; iter < 30; iter++) {
        const mid = (lo + hi) / 2;
        if (hzToScale(mid) < scaleVal) { lo = mid; }
        else { hi = mid; }
    }
    const hz = (lo + hi) / 2;
    return Math.max(0, Math.min(freqBins - 1, Math.round((hz / nyquist) * (freqBins - 1))));
}

/**
 * Get the Y position on canvas for a given frequency, respecting the scale.
 */
function freqToCanvasY(freq, canvasHeight, nyquist, scale) {
    if (scale === 'linear' || !scale) {
        return canvasHeight - (freq / nyquist) * canvasHeight;
    }

    let hzToScale;
    if (scale === 'mel') { hzToScale = hzToMel; }
    else if (scale === 'bark') { hzToScale = hzToBark; }
    else if (scale === 'erb') { hzToScale = hzToErb; }
    else { return canvasHeight - (freq / nyquist) * canvasHeight; }

    const scaleMin = hzToScale(0);
    const scaleMax = hzToScale(nyquist);
    const scaleVal = hzToScale(freq);
    const normPos = (scaleVal - scaleMin) / (scaleMax - scaleMin);
    return canvasHeight - normPos * canvasHeight;
}

export class ChunkedSpectrogramRenderer {
    constructor(options = {}) {
        this.columns = [];      // Array of Float32Array (each = half FFT_SIZE magnitudes in dB)
        this.leftover = null;   // Leftover samples from previous chunk
        this.sampleRate = 44100;
        this.expectedDuration = options.duration || 0;
        this.freqBins = FFT_SIZE / 2;
        this.currentScale = 'linear';
        this.targetColumnStride = 1;
        this.pendingColumn = null;
        this.pendingColumnCount = 0;
    }

    addChunk(pcmData) {
        this.updateAggregationSettings();

        // Concatenate with leftover from previous chunk
        let samples;
        if (this.leftover && this.leftover.length > 0) {
            samples = new Float32Array(this.leftover.length + pcmData.length);
            samples.set(this.leftover);
            samples.set(pcmData, this.leftover.length);
            this.leftover = null;
        } else {
            samples = pcmData;
        }

        let offset = 0;
        while (offset + FFT_SIZE <= samples.length) {
            // Apply window and compute FFT
            const re = new Float32Array(FFT_SIZE);
            const im = new Float32Array(FFT_SIZE);
            for (let i = 0; i < FFT_SIZE; i++) {
                re[i] = samples[offset + i] * hannWindow[i];
            }
            fft(re, im);

            // Compute magnitude in dB (only positive frequencies)
            const mag = new Float32Array(this.freqBins);
            for (let i = 0; i < this.freqBins; i++) {
                const power = re[i] * re[i] + im[i] * im[i];
                const magnitude = (2 * Math.sqrt(power)) / FFT_SIZE;
                mag[i] = 20 * Math.log10(Math.max(magnitude, 1e-12));
            }
            this.appendColumn(mag);

            offset += HOP_SIZE;
        }

        // Save leftover samples for next chunk
        if (offset < samples.length) {
            this.leftover = samples.slice(offset);
        }
    }

    render(container, scale, targetWidth) {
        if (!container) { return; }
        this.flushPendingColumn();
        if (this.columns.length === 0) { return; }

        this.currentScale = scale || this.currentScale || 'linear';
        const nyquist = this.sampleRate / 2;

        const totalCols = this.columns.length;
        const containerWidth = Math.max(1, Math.floor(targetWidth || container.clientWidth || container.offsetWidth || totalCols));
        const canvasWidth = Math.max(1, Math.min(totalCols, containerWidth, MAX_CANVAS_WIDTH));
        const displayWidth = Math.max(1, Math.min(totalCols, containerWidth));
        const canvasHeight = CANVAS_HEIGHT;

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = canvasHeight + 'px';
        canvas.style.display = 'block';

        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(canvasWidth, canvasHeight);
        const data32 = new Uint32Array(imageData.data.buffer);
        console.log('[Spectrogram] fixed dB range:', -(GAIN_DB + RANGE_DB), '~', -GAIN_DB, 'columns:', totalCols, 'canvasWidth:', canvasWidth, 'displayWidth:', displayWidth, 'scale:', this.currentScale);

        // Downsample columns if needed
        const colsPerPixel = totalCols / canvasWidth;

        for (let px = 0; px < canvasWidth; px++) {
            const colStart = Math.floor(px * colsPerPixel);
            const colEnd = Math.min(totalCols, Math.max(colStart + 1, Math.ceil((px + 1) * colsPerPixel)));
            const numCols = colEnd - colStart;

            for (let row = 0; row < canvasHeight; row++) {
                // Map row to frequency bin based on scale
                const freqBin = rowToFreqBin(row, canvasHeight, this.freqBins, nyquist, this.currentScale);
                const upperBin = rowBoundaryToFreqBin(row, canvasHeight, this.freqBins, nyquist, this.currentScale);
                const lowerBin = rowBoundaryToFreqBin(row + 1, canvasHeight, this.freqBins, nyquist, this.currentScale);
                const binStart = Math.max(0, Math.min(freqBin, upperBin, lowerBin));
                const binEnd = Math.min(this.freqBins - 1, Math.max(freqBin, upperBin, lowerBin));

                // Average across the frequency band covered by this row, not just one FFT bin.
                let sum = 0;
                let sampleCount = 0;
                for (let c = colStart; c < colEnd; c++) {
                    for (let bin = binStart; bin <= binEnd; bin++) {
                        sum += this.columns[c][bin];
                        sampleCount += 1;
                    }
                }
                const avgDB = sampleCount > 0 ? sum / sampleCount : -(GAIN_DB + RANGE_DB);

                data32[row * canvasWidth + px] = magnitudeToColor(avgDB);
            }
        }

        ctx.putImageData(imageData, 0, 0);

        // Build DOM first, then add labels (fix: canvas must be in DOM for parentElement)
        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.appendChild(canvas);
        container.appendChild(wrapper);

        // Add frequency labels (canvas is now in DOM)
        this.addFrequencyLabels(container, canvas, this.currentScale);

        // Do NOT clear columns — preserve for re-render on zoom/scale change
    }

    addFrequencyLabels(container, canvas, scale) {
        const labelCanvas = document.createElement('canvas');
        const nyquist = this.sampleRate / 2;
        const labelWidth = 55;
        labelCanvas.width = labelWidth;
        labelCanvas.height = CANVAS_HEIGHT;
        labelCanvas.style.position = 'absolute';
        labelCanvas.style.left = '0';
        labelCanvas.style.top = '0';
        labelCanvas.style.height = CANVAS_HEIGHT + 'px';
        labelCanvas.style.pointerEvents = 'none';

        const ctx = labelCanvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, labelWidth, CANVAS_HEIGHT);
        ctx.fillStyle = '#ccc';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';

        const steps = [0, 1000, 2000, 4000, 8000, 16000, 20000].filter(f => f <= nyquist);
        for (const freq of steps) {
            const y = freqToCanvasY(freq, CANVAS_HEIGHT, nyquist, scale || 'linear');
            const label = freq >= 1000 ? (freq / 1000) + 'kHz' : freq + 'Hz';
            ctx.fillText(label, labelWidth - 4, y + 3);
        }

        canvas.parentElement?.appendChild(labelCanvas);
    }

    reset() {
        this.columns = [];
        this.leftover = null;
        this.currentScale = 'linear';
        this.targetColumnStride = 1;
        this.pendingColumn = null;
        this.pendingColumnCount = 0;
    }

    updateAggregationSettings() {
        if (!this.expectedDuration || !this.sampleRate) { return; }

        const estimatedRawColumns = Math.max(
            1,
            Math.ceil((this.expectedDuration * this.sampleRate) / HOP_SIZE)
        );
        this.targetColumnStride = Math.max(1, Math.ceil(estimatedRawColumns / MAX_STORED_COLUMNS));
    }

    appendColumn(column) {
        if (this.targetColumnStride <= 1) {
            this.columns.push(column);
            return;
        }

        if (!this.pendingColumn) {
            this.pendingColumn = new Float32Array(this.freqBins);
            this.pendingColumnCount = 0;
        }

        for (let bin = 0; bin < this.freqBins; bin++) {
            this.pendingColumn[bin] += column[bin];
        }
        this.pendingColumnCount += 1;

        if (this.pendingColumnCount >= this.targetColumnStride) {
            this.flushPendingColumn();
        }
    }

    flushPendingColumn() {
        if (!this.pendingColumn || this.pendingColumnCount === 0) { return; }

        const merged = new Float32Array(this.freqBins);
        for (let bin = 0; bin < this.freqBins; bin++) {
            merged[bin] = this.pendingColumn[bin] / this.pendingColumnCount;
        }
        this.columns.push(merged);
        this.pendingColumn = null;
        this.pendingColumnCount = 0;
    }
}
