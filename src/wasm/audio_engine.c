#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>

#define DR_WAV_IMPLEMENTATION
#include "lib/dr_wav.h"
#define DR_MP3_IMPLEMENTATION
#include "lib/dr_mp3.h"
#define DR_FLAC_IMPLEMENTATION
#include "lib/dr_flac.h"
#include "lib/stb_vorbis.c"
#include "lib/kiss_fft.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/* ===== Audio Data Structure ===== */

typedef struct {
    float* samples;        /* interleaved PCM float32 */
    uint32_t channels;
    uint32_t sample_rate;
    uint64_t total_frames;
} AudioData;

/* ===== Decoding ===== */

EMSCRIPTEN_KEEPALIVE
AudioData* decode_audio(const uint8_t* data, uint32_t length) {
    AudioData* audio = (AudioData*)malloc(sizeof(AudioData));
    if (!audio) return NULL;
    memset(audio, 0, sizeof(AudioData));

    /* Try WAV */
    {
        drwav wav;
        if (drwav_init_memory(&wav, data, length, NULL)) {
            audio->channels = wav.channels;
            audio->sample_rate = wav.sampleRate;
            audio->total_frames = wav.totalPCMFrameCount;
            audio->samples = (float*)malloc(sizeof(float) * wav.totalPCMFrameCount * wav.channels);
            if (!audio->samples) {
                drwav_uninit(&wav);
                free(audio);
                return NULL;
            }
            drwav_read_pcm_frames_f32(&wav, wav.totalPCMFrameCount, audio->samples);
            drwav_uninit(&wav);
            return audio;
        }
    }

    /* Try MP3 */
    {
        drmp3_config mp3_config;
        drmp3_uint64 mp3_frames;
        float* mp3_samples = drmp3_open_memory_and_read_pcm_frames_f32(
            data, length, &mp3_config, &mp3_frames, NULL
        );
        if (mp3_samples) {
            audio->channels = mp3_config.channels;
            audio->sample_rate = mp3_config.sampleRate;
            audio->total_frames = mp3_frames;
            audio->samples = mp3_samples;
            return audio;
        }
    }

    /* Try FLAC */
    {
        unsigned int flac_channels, flac_sample_rate;
        drflac_uint64 flac_frames;
        float* flac_samples = drflac_open_memory_and_read_pcm_frames_f32(
            data, length, &flac_channels, &flac_sample_rate, &flac_frames, NULL
        );
        if (flac_samples) {
            audio->channels = flac_channels;
            audio->sample_rate = flac_sample_rate;
            audio->total_frames = flac_frames;
            audio->samples = flac_samples;
            return audio;
        }
    }

    /* Try OGG Vorbis */
    {
        int vorbis_channels, vorbis_sample_rate;
        short* vorbis_samples_i16;
        int vorbis_frames = stb_vorbis_decode_memory(
            data, (int)length, &vorbis_channels, &vorbis_sample_rate, &vorbis_samples_i16
        );
        if (vorbis_frames > 0 && vorbis_samples_i16) {
            uint64_t total_samples = (uint64_t)vorbis_frames * vorbis_channels;
            audio->channels = (uint32_t)vorbis_channels;
            audio->sample_rate = (uint32_t)vorbis_sample_rate;
            audio->total_frames = (uint64_t)vorbis_frames;
            /* Memory optimization: realloc int16 buffer to float32 size
             * then convert backwards in-place to avoid holding both buffers */
            float* float_buf = (float*)realloc(vorbis_samples_i16, sizeof(float) * total_samples);
            if (!float_buf) {
                free(vorbis_samples_i16);
                free(audio);
                return NULL;
            }
            short* short_view = (short*)float_buf;
            for (int64_t i = (int64_t)total_samples - 1; i >= 0; i--) {
                float_buf[i] = short_view[i] / 32768.0f;
            }
            audio->samples = float_buf;
            return audio;
        }
    }

    free(audio);
    return NULL;
}

/* ===== Accessor functions for struct fields ===== */

EMSCRIPTEN_KEEPALIVE
uint32_t audio_get_channels(AudioData* audio) {
    return audio ? audio->channels : 0;
}

EMSCRIPTEN_KEEPALIVE
uint32_t audio_get_sample_rate(AudioData* audio) {
    return audio ? audio->sample_rate : 0;
}

EMSCRIPTEN_KEEPALIVE
uint32_t audio_get_total_frames(AudioData* audio) {
    return audio ? (uint32_t)audio->total_frames : 0;
}

/* For large files, return high/low 32-bit parts */
EMSCRIPTEN_KEEPALIVE
uint32_t audio_get_total_frames_high(AudioData* audio) {
    return audio ? (uint32_t)(audio->total_frames >> 32) : 0;
}

/* ===== Peaks Generation ===== */

EMSCRIPTEN_KEEPALIVE
float* generate_peaks(AudioData* audio, int width) {
    if (!audio || !audio->samples || width <= 0) return NULL;

    float* peaks = (float*)malloc(sizeof(float) * width);
    if (!peaks) return NULL;

    uint64_t frames_per_pixel = audio->total_frames / width;
    if (frames_per_pixel == 0) frames_per_pixel = 1;

    for (int i = 0; i < width; i++) {
        float max_val = 0.0f;
        uint64_t start = (uint64_t)i * audio->total_frames / width;
        uint64_t end = (uint64_t)(i + 1) * audio->total_frames / width;
        if (end > audio->total_frames) end = audio->total_frames;

        for (uint64_t j = start; j < end; j++) {
            /* Mono downmix */
            float sample = 0.0f;
            for (uint32_t ch = 0; ch < audio->channels; ch++) {
                sample += audio->samples[j * audio->channels + ch];
            }
            sample /= (float)audio->channels;
            float abs_val = fabsf(sample);
            if (abs_val > max_val) max_val = abs_val;
        }
        peaks[i] = max_val;
    }
    return peaks;
}

/* ===== Mel Scale (matches wavesurfer Spectrogram plugin) ===== */

static float freq_to_mel(float freq) {
    return 2595.0f * log10f(1.0f + freq / 700.0f);
}

static float mel_to_freq(float mel) {
    return 700.0f * (powf(10.0f, mel / 2595.0f) - 1.0f);
}

/* ===== Spectrogram Generation ===== */
/* Replicates wavesurfer SpectrogramPlugin.getFrequencies() exactly:
 *   1. Hann window + FFT → magnitude with 2/N normalization
 *   2. Mel filter bank (linear interpolation at mel-spaced positions)
 *   3. dB conversion → uint8 colormap index (gainDB=20, rangeDB=80)
 */

EMSCRIPTEN_KEEPALIVE
uint8_t* generate_spectrogram(
    AudioData* audio,
    int fft_size,
    int hop_size,
    int* out_width,
    int* out_height
) {
    if (!audio || !audio->samples || fft_size <= 0 || hop_size <= 0) return NULL;

    int num_fft_bins = fft_size / 2;
    int height = num_fft_bins; /* output mel bins = fft_size/2 (same as wavesurfer) */
    int64_t width_calc = ((int64_t)audio->total_frames - fft_size) / hop_size + 1;
    if (width_calc <= 0) width_calc = 1;
    int width = (int)width_calc;
    *out_width = width;
    *out_height = height;

    uint8_t* spectrogram = (uint8_t*)malloc((size_t)width * height);
    if (!spectrogram) return NULL;

    kiss_fft_cfg cfg = kiss_fft_alloc(fft_size, 0, NULL, NULL);
    if (!cfg) {
        free(spectrogram);
        return NULL;
    }

    kiss_fft_cpx* fft_in = (kiss_fft_cpx*)malloc(sizeof(kiss_fft_cpx) * fft_size);
    kiss_fft_cpx* fft_out = (kiss_fft_cpx*)malloc(sizeof(kiss_fft_cpx) * fft_size);
    float* magnitudes = (float*)malloc(sizeof(float) * num_fft_bins);
    if (!fft_in || !fft_out || !magnitudes) {
        free(spectrogram); free(fft_in); free(fft_out); free(magnitudes);
        kiss_fft_free(cfg);
        return NULL;
    }

    /* Hann window (matches wavesurfer default) */
    float* window = (float*)malloc(sizeof(float) * fft_size);
    if (!window) {
        free(spectrogram); free(fft_in); free(fft_out); free(magnitudes);
        kiss_fft_free(cfg);
        return NULL;
    }
    for (int i = 0; i < fft_size; i++) {
        window[i] = 0.5f * (1.0f - cosf(2.0f * (float)M_PI * i / (fft_size - 1)));
    }

    /* Pre-compute mel filter bank lookup table
     * Matches wavesurfer: createFilterBankForScale('mel', numFilters, fftSize, sampleRate)
     * Each mel bin interpolates between two adjacent FFT magnitude bins
     */
    float sample_rate = (float)audio->sample_rate;
    float nyquist = sample_rate / 2.0f;
    float mel_min = freq_to_mel(0.0f);
    float mel_max = freq_to_mel(nyquist);
    float freq_per_bin = sample_rate / (float)fft_size;

    int* mel_bin0 = (int*)malloc(sizeof(int) * height);
    float* mel_frac = (float*)malloc(sizeof(float) * height);
    if (!mel_bin0 || !mel_frac) {
        free(spectrogram); free(fft_in); free(fft_out); free(magnitudes);
        free(window); free(mel_bin0); free(mel_frac);
        kiss_fft_free(cfg);
        return NULL;
    }

    for (int m = 0; m < height; m++) {
        float mel_val = mel_min + (float)m / (float)height * (mel_max - mel_min);
        float center_freq = mel_to_freq(mel_val);
        float bin_float = center_freq / freq_per_bin;
        mel_bin0[m] = (int)floorf(bin_float);
        mel_frac[m] = bin_float - (float)mel_bin0[m];
    }

    float norm = 2.0f / (float)fft_size;

    for (int t = 0; t < width; t++) {
        int64_t offset = (int64_t)t * hop_size;

        /* Windowed FFT input (mono downmix) */
        for (int i = 0; i < fft_size; i++) {
            float sample = 0.0f;
            int64_t idx = offset + i;
            if (idx < (int64_t)audio->total_frames) {
                for (uint32_t ch = 0; ch < audio->channels; ch++) {
                    sample += audio->samples[idx * audio->channels + ch];
                }
                sample /= (float)audio->channels;
            }
            fft_in[i].r = sample * window[i];
            fft_in[i].i = 0.0f;
        }

        kiss_fft(cfg, fft_in, fft_out);

        /* Step 1: Compute normalized magnitudes for all linear FFT bins */
        for (int f = 0; f < num_fft_bins; f++) {
            float re = fft_out[f].r;
            float im = fft_out[f].i;
            magnitudes[f] = norm * sqrtf(re * re + im * im);
        }

        /* Step 2: Apply mel filter bank + dB → uint8
         * Match wavesurfer: gainDB=20, rangeDB=80
         *   dB < -100 → 0
         *   dB > -20  → 255
         *   else      → (dB + 100) / 80 * 255
         */
        for (int m = 0; m < height; m++) {
            int b0 = mel_bin0[m];
            int b1 = b0 + 1;
            float frac = mel_frac[m];
            float magnitude;

            if (b0 >= num_fft_bins) {
                magnitude = 1e-12f;
            } else if (b1 >= num_fft_bins) {
                magnitude = magnitudes[b0] * (1.0f - frac);
            } else {
                magnitude = magnitudes[b0] * (1.0f - frac) + magnitudes[b1] * frac;
            }

            if (magnitude < 1e-12f) magnitude = 1e-12f;
            float db = 20.0f * log10f(magnitude);
            float val = (db + 100.0f) / 80.0f;
            if (val < 0.0f) val = 0.0f;
            if (val > 1.0f) val = 1.0f;
            spectrogram[t * height + m] = (uint8_t)(val * 255.0f);
        }
    }

    free(window);
    free(fft_in);
    free(fft_out);
    free(magnitudes);
    free(mel_bin0);
    free(mel_frac);
    kiss_fft_free(cfg);

    return spectrogram;
}

/* ===== Memory Management ===== */

EMSCRIPTEN_KEEPALIVE
void free_audio(AudioData* audio) {
    if (audio) {
        if (audio->samples) {
            free(audio->samples);
        }
        free(audio);
    }
}

EMSCRIPTEN_KEEPALIVE
void free_buffer(void* ptr) {
    if (ptr) {
        free(ptr);
    }
}
