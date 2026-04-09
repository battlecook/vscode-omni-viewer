#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Source emsdk if available
if [ -f /tmp/emsdk/emsdk_env.sh ]; then
    source /tmp/emsdk/emsdk_env.sh 2>/dev/null
fi

echo "Building WASM audio engine..."

emcc audio_engine.c \
     lib/kiss_fft.c \
     -O3 \
     -s WASM=1 \
     -s EXPORTED_FUNCTIONS='["_decode_audio","_generate_peaks","_generate_spectrogram","_free_audio","_free_buffer","_malloc","_free","_audio_get_channels","_audio_get_sample_rate","_audio_get_total_frames","_audio_get_total_frames_high"]' \
     -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","HEAPU8","HEAPF32"]' \
     -s ALLOW_MEMORY_GROWTH=1 \
     -s INITIAL_MEMORY=67108864 \
     -s MAXIMUM_MEMORY=2147483648 \
     -s MODULARIZE=1 \
     -s EXPORT_NAME="AudioEngineModule" \
     -s ENVIRONMENT='node' \
     -s NODEJS_CATCH_EXIT=0 \
     -s NODEJS_CATCH_REJECTION=0 \
     -I lib \
     -o audio_engine.js

echo "Build complete: audio_engine.js + audio_engine.wasm"
ls -lh audio_engine.js audio_engine.wasm
