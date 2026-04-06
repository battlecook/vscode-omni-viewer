import * as fs from 'fs';
import * as crypto from 'crypto';
import * as mm from 'music-metadata';
import * as path from 'path';
import * as vscode from 'vscode';

const LARGE_FILE_THRESHOLD = 30 * 1024 * 1024; // 30MB

export function getAudioMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.aac': 'audio/aac',
        '.m4a': 'audio/mp4'
    };
    return mimeTypes[ext] || 'audio/wav';
}

export function getVideoMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska'
    };
    return mimeTypes[ext] || 'video/mp4';
}

export function getImageMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'image/jpeg';
}

export async function fileToDataUrl(filePath: string, mimeType: string): Promise<string> {
    const buffer = await fs.promises.readFile(filePath);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function isLargeFile(filePath: string, threshold: number = LARGE_FILE_THRESHOLD): Promise<boolean> {
    const stats = await fs.promises.stat(filePath);
    return stats.size >= threshold;
}

export async function getFileSize(filePath: string): Promise<string> {
    try {
        const stats = await fs.promises.stat(filePath);
        const bytes = stats.size;

        if (bytes === 0) {
            return '0 B';
        }

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const index = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, index)).toFixed(1)) + ' ' + sizes[index];
    } catch {
        return 'Unknown';
    }
}

export async function getAudioMetadata(filePath: string): Promise<{
    sampleRate?: number;
    channels?: number;
    bitDepth?: number;
    duration?: number;
    format?: string;
    fileSize?: string;
}> {
    try {
        const metadata = await mm.parseFile(filePath);
        const format = metadata.format;

        return {
            sampleRate: format.sampleRate,
            channels: format.numberOfChannels,
            bitDepth: format.bitsPerSample,
            duration: format.duration,
            format: format.container || path.extname(filePath).toUpperCase().slice(1),
            fileSize: await getFileSize(filePath)
        };
    } catch {
        return {
            format: path.extname(filePath).toUpperCase().slice(1),
            fileSize: await getFileSize(filePath)
        };
    }
}

// --- Peak computation for large WAV files ---

interface WavHeader {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    dataSize: number;
    dataOffset: number;
}

export interface PeakData {
    version: number;
    samplesPerPixel: number;
    sampleRate: number;
    duration: number;
    channels: number;
    peaks: number[];
}

function parseWavHeader(buffer: Buffer): WavHeader | null {
    if (buffer.length < 44) { return null; }
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') { return null; }

    // Find 'fmt ' and 'data' chunks
    let offset = 12;
    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let dataSize = 0;
    let dataOffset = 0;

    while (offset < buffer.length - 8) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkId === 'fmt ') {
            channels = buffer.readUInt16LE(offset + 10);
            sampleRate = buffer.readUInt32LE(offset + 12);
            bitsPerSample = buffer.readUInt16LE(offset + 22);
        } else if (chunkId === 'data') {
            dataSize = chunkSize;
            dataOffset = offset + 8;
            break;
        }

        offset += 8 + chunkSize;
        // Chunks are word-aligned
        if (chunkSize % 2 !== 0) { offset++; }
    }

    if (!sampleRate || !channels || !bitsPerSample || !dataOffset) { return null; }

    return { sampleRate, channels, bitsPerSample, dataSize, dataOffset };
}

function readSample(buffer: Buffer, offset: number, bitsPerSample: number): number {
    switch (bitsPerSample) {
        case 8:
            return (buffer.readUInt8(offset) - 128) / 128;
        case 16:
            return buffer.readInt16LE(offset) / 32768;
        case 24: {
            const val = buffer.readUInt8(offset) | (buffer.readUInt8(offset + 1) << 8) | (buffer.readInt8(offset + 2) << 16);
            return val / 8388608;
        }
        case 32:
            return buffer.readInt32LE(offset) / 2147483648;
        default:
            return 0;
    }
}

export async function computeWavPeaks(filePath: string, samplesPerPixel: number = 512): Promise<PeakData | null> {
    // Read enough for WAV header (first 4KB to handle extended headers)
    const headerBuf = Buffer.alloc(4096);
    const fd = await fs.promises.open(filePath, 'r');
    try {
        await fd.read(headerBuf, 0, 4096, 0);
    } finally {
        await fd.close();
    }

    const header = parseWavHeader(headerBuf);
    if (!header) { return null; }

    const { sampleRate, channels, bitsPerSample, dataSize, dataOffset } = header;
    const bytesPerSample = bitsPerSample / 8;
    const bytesPerFrame = bytesPerSample * channels;
    const totalFrames = Math.floor(dataSize / bytesPerFrame);
    const totalBlocks = Math.ceil(totalFrames / samplesPerPixel);
    const duration = totalFrames / sampleRate;

    // peaks: interleaved [min, max, min, max, ...] for channel 0 only (mono summary)
    const peaks: number[] = new Array(totalBlocks * 2);

    const CHUNK_SIZE = 1024 * 1024; // 1MB read buffer
    const stream = fs.createReadStream(filePath, {
        start: dataOffset,
        end: dataOffset + dataSize - 1,
        highWaterMark: CHUNK_SIZE
    });

    let blockIndex = 0;
    let blockMin = 1;
    let blockMax = -1;
    let blockFrameCount = 0;
    let leftover = Buffer.alloc(0);

    return new Promise<PeakData>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
            let buf: Buffer;
            if (leftover.length > 0) {
                buf = Buffer.concat([leftover, chunk]);
                leftover = Buffer.alloc(0);
            } else {
                buf = chunk;
            }

            let pos = 0;
            while (pos + bytesPerFrame <= buf.length) {
                // Read first channel sample
                const sample = readSample(buf, pos, bitsPerSample);
                if (sample < blockMin) { blockMin = sample; }
                if (sample > blockMax) { blockMax = sample; }

                pos += bytesPerFrame;
                blockFrameCount++;

                if (blockFrameCount >= samplesPerPixel) {
                    peaks[blockIndex * 2] = blockMin;
                    peaks[blockIndex * 2 + 1] = blockMax;
                    blockIndex++;
                    blockMin = 1;
                    blockMax = -1;
                    blockFrameCount = 0;
                }
            }

            // Save leftover bytes for next chunk
            if (pos < buf.length) {
                leftover = Buffer.from(buf.subarray(pos));
            }
        });

        stream.on('end', () => {
            // Flush last partial block
            if (blockFrameCount > 0 && blockIndex < totalBlocks) {
                peaks[blockIndex * 2] = blockMin;
                peaks[blockIndex * 2 + 1] = blockMax;
                blockIndex++;
            }
            // Trim to actual size
            const trimmedPeaks = peaks.slice(0, blockIndex * 2);
            resolve({
                version: 1,
                samplesPerPixel,
                sampleRate,
                duration,
                channels,
                peaks: trimmedPeaks
            });
        });

        stream.on('error', reject);
    });
}

export async function streamWavPcmChunks(
    filePath: string,
    onChunk: (data: Float32Array, chunkIndex: number, totalChunks: number, sampleRate: number, channels: number) => void,
    onEnd: () => void
): Promise<void> {
    const headerBuf = Buffer.alloc(4096);
    const fd = await fs.promises.open(filePath, 'r');
    try {
        await fd.read(headerBuf, 0, 4096, 0);
    } finally {
        await fd.close();
    }

    const header = parseWavHeader(headerBuf);
    if (!header) {
        onEnd();
        return;
    }

    const { sampleRate, channels, bitsPerSample, dataSize, dataOffset } = header;
    const bytesPerSample = bitsPerSample / 8;
    const bytesPerFrame = bytesPerSample * channels;
    const CHUNK_SIZE = 1024 * 1024; // 1MB
    const totalChunks = Math.ceil(dataSize / CHUNK_SIZE);

    const stream = fs.createReadStream(filePath, {
        start: dataOffset,
        end: dataOffset + dataSize - 1,
        highWaterMark: CHUNK_SIZE
    });

    let chunkIndex = 0;
    let leftover = Buffer.alloc(0);

    return new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
            let buf: Buffer;
            if (leftover.length > 0) {
                buf = Buffer.concat([leftover, chunk]);
                leftover = Buffer.alloc(0);
            } else {
                buf = chunk;
            }

            // Align to frame boundary
            const usableBytes = Math.floor(buf.length / bytesPerFrame) * bytesPerFrame;
            if (usableBytes < bytesPerFrame) {
                leftover = Buffer.from(buf);
                return;
            }

            const frameCount = usableBytes / bytesPerFrame;
            // Mix down to mono float32
            const samples = new Float32Array(frameCount);
            for (let i = 0; i < frameCount; i++) {
                let sum = 0;
                for (let ch = 0; ch < channels; ch++) {
                    sum += readSample(buf, i * bytesPerFrame + ch * bytesPerSample, bitsPerSample);
                }
                samples[i] = sum / channels;
            }

            if (buf.length > usableBytes) {
                leftover = Buffer.from(buf.subarray(usableBytes));
            }

            onChunk(samples, chunkIndex, totalChunks, sampleRate, channels);
            chunkIndex++;
        });

        stream.on('end', () => {
            // Flush leftover if any
            if (leftover.length >= bytesPerFrame) {
                const usableBytes = Math.floor(leftover.length / bytesPerFrame) * bytesPerFrame;
                const frameCount = usableBytes / bytesPerFrame;
                const samples = new Float32Array(frameCount);
                for (let i = 0; i < frameCount; i++) {
                    let sum = 0;
                    for (let ch = 0; ch < channels; ch++) {
                        sum += readSample(leftover, i * bytesPerFrame + ch * bytesPerSample, bitsPerSample);
                    }
                    samples[i] = sum / channels;
                }
                onChunk(samples, chunkIndex, totalChunks, sampleRate, channels);
            }
            onEnd();
            resolve();
        });

        stream.on('error', reject);
    });
}

export async function computeAudioPeaks(filePath: string): Promise<PeakData | null> {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.wav') {
        return computeWavPeaks(filePath);
    }
    // For compressed formats, return null - let webview decode
    // But provide duration from metadata if available
    return null;
}

// --- Peak caching ---

function getPeakCacheDir(context: vscode.ExtensionContext): string {
    return path.join(context.globalStorageUri.fsPath, 'peakCache');
}

function getPeakCacheKey(filePath: string, mtime: number, fileSize: number): string {
    const hash = crypto.createHash('sha256');
    hash.update(`${filePath}|${mtime}|${fileSize}`);
    return hash.digest('hex');
}

export async function loadCachedPeaks(context: vscode.ExtensionContext, filePath: string): Promise<PeakData | null> {
    try {
        const stats = await fs.promises.stat(filePath);
        const cacheKey = getPeakCacheKey(filePath, stats.mtimeMs, stats.size);
        const cachePath = path.join(getPeakCacheDir(context), `${cacheKey}.json`);
        const data = await fs.promises.readFile(cachePath, 'utf8');
        const parsed = JSON.parse(data) as PeakData;
        if (parsed.version === 1) {
            return parsed;
        }
        return null;
    } catch {
        return null;
    }
}

export async function savePeakCache(context: vscode.ExtensionContext, filePath: string, peakData: PeakData): Promise<void> {
    try {
        const stats = await fs.promises.stat(filePath);
        const cacheKey = getPeakCacheKey(filePath, stats.mtimeMs, stats.size);
        const cacheDir = getPeakCacheDir(context);
        await fs.promises.mkdir(cacheDir, { recursive: true });
        const cachePath = path.join(cacheDir, `${cacheKey}.json`);
        await fs.promises.writeFile(cachePath, JSON.stringify(peakData));
    } catch (err) {
        console.error('Failed to save peak cache:', err);
    }
}
