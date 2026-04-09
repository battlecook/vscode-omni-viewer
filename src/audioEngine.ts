import * as fs from 'fs';
import * as path from 'path';

declare const __non_webpack_require__: typeof require;

export interface AudioAnalysis {
    peaks: number[][];       // wavesurfer peaks format: [[...]]
    duration: number;        // seconds
    sampleRate: number;
    channels: number;
    spectrogram: number[][]; // [time][frequency] uint8 values (downsampled)
}

const MAX_SPEC_WIDTH = 3500;   // max time columns for spectrogram (~10MB JSON)
const MAX_SPEC_HEIGHT = 1024;  // full frequency resolution (no downsampling)
const FFT_SIZE = 2048;
const DEFAULT_PEAKS_WIDTH = 32000; // high-density peaks for zoomed view

export class AudioEngine {
    private module: any = null;

    async init(): Promise<void> {
        if (this.module) { return; }

        const wasmDir = path.join(__dirname, '..', 'src', 'wasm');
        const jsPath = path.join(wasmDir, 'audio_engine.js');

        if (!fs.existsSync(jsPath)) {
            throw new Error(`WASM module not found: ${jsPath}`);
        }

        // Use __non_webpack_require__ to prevent webpack from bundling the WASM glue code
        const AudioEngineModule = __non_webpack_require__(jsPath);
        this.module = await AudioEngineModule({
            locateFile: (file: string) => path.join(wasmDir, file)
        });
    }

    async analyze(filePath: string, peaksWidth: number = DEFAULT_PEAKS_WIDTH): Promise<AudioAnalysis> {
        if (!this.module) {
            await this.init();
        }

        const fileBuffer = await fs.promises.readFile(filePath);
        const uint8 = new Uint8Array(fileBuffer);
        const ext = path.extname(filePath).toLowerCase();

        console.log(`[AudioEngine] Analyzing: ${path.basename(filePath)} (${(uint8.length / 1024 / 1024).toFixed(1)}MB, ext=${ext})`);

        // Copy input data to WASM memory
        const inputPtr = this.module._malloc(uint8.length);
        if (!inputPtr) {
            throw new Error(`WASM malloc failed for input buffer (${(uint8.length / 1024 / 1024).toFixed(1)}MB)`);
        }
        this.module.HEAPU8.set(uint8, inputPtr);

        // Decode audio
        const audioPtr = this.module._decode_audio(inputPtr, uint8.length);
        this.module._free(inputPtr);

        if (!audioPtr) {
            const supported = ['.wav', '.mp3', '.flac', '.ogg'];
            if (!supported.includes(ext)) {
                throw new Error(`Unsupported audio format: ${ext}. WASM engine supports: ${supported.join(', ')}`);
            }
            throw new Error(`Failed to decode audio file (${ext}, ${(uint8.length / 1024 / 1024).toFixed(1)}MB). Possible memory limit exceeded.`);
        }

        try {
            // Read audio properties via accessor functions
            const channels = this.module._audio_get_channels(audioPtr);
            const sampleRate = this.module._audio_get_sample_rate(audioPtr);
            const totalFramesLow = this.module._audio_get_total_frames(audioPtr);
            const totalFramesHigh = this.module._audio_get_total_frames_high(audioPtr);
            const totalFrames = totalFramesLow + totalFramesHigh * 0x100000000;
            const duration = totalFrames / sampleRate;

            // Generate peaks
            const peaksPtr = this.module._generate_peaks(audioPtr, peaksWidth);
            if (!peaksPtr) {
                throw new Error('Failed to generate peaks');
            }

            const peaksArray = new Float32Array(
                this.module.HEAPF32.buffer, peaksPtr, peaksWidth
            ).slice(); // copy out of WASM memory
            this.module._free_buffer(peaksPtr);

            // Calculate hop_size to limit spectrogram time columns
            const hopSize = Math.max(512, Math.ceil(totalFrames / MAX_SPEC_WIDTH));

            // Generate spectrogram
            const outWidthPtr = this.module._malloc(4);
            const outHeightPtr = this.module._malloc(4);
            const specPtr = this.module._generate_spectrogram(
                audioPtr, FFT_SIZE, hopSize, outWidthPtr, outHeightPtr
            );

            const specWidth = this.module.getValue(outWidthPtr, 'i32');
            const specHeight = this.module.getValue(outHeightPtr, 'i32'); // FFT_SIZE / 2 = 1024
            this.module._free(outWidthPtr);
            this.module._free(outHeightPtr);

            let spectrogram: number[][] = [];
            if (specPtr && specWidth > 0 && specHeight > 0) {
                const outHeight = Math.min(specHeight, MAX_SPEC_HEIGHT);
                const freqStep = Math.max(1, Math.floor(specHeight / outHeight));

                for (let t = 0; t < specWidth; t++) {
                    const column: number[] = new Array(outHeight);
                    if (freqStep === 1) {
                        // No downsampling — copy directly
                        for (let f = 0; f < outHeight; f++) {
                            column[f] = this.module.HEAPU8[specPtr + t * specHeight + f];
                        }
                    } else {
                        for (let fOut = 0; fOut < outHeight; fOut++) {
                            const fStart = fOut * freqStep;
                            const fEnd = Math.min(fStart + freqStep, specHeight);
                            let sum = 0;
                            for (let f = fStart; f < fEnd; f++) {
                                sum += this.module.HEAPU8[specPtr + t * specHeight + f];
                            }
                            column[fOut] = Math.round(sum / (fEnd - fStart));
                        }
                    }
                    spectrogram.push(column);
                }
                this.module._free_buffer(specPtr);
            }

            return {
                peaks: [Array.from(peaksArray)],
                duration,
                sampleRate,
                channels,
                spectrogram
            };
        } finally {
            this.module._free_audio(audioPtr);
        }
    }
}
