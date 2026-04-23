import * as fs from 'fs';
import * as mm from 'music-metadata';
import * as path from 'path';
import { spawn } from 'child_process';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const WEBVIEW_TRANSCODE_EXTENSIONS = new Set(['.aiff', '.aif', '.aifc', '.ac3', '.amr', '.awb']);
const RAW_PCM_EXTENSION = '.pcm';
const RAW_PCM_SAMPLE_RATE = 16000;
const RAW_PCM_CHANNELS = 1;
const RAW_PCM_BIT_DEPTH = 16;

export function getAudioMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.pcm': 'audio/wav',
        '.aiff': 'audio/aiff',
        '.aif': 'audio/aiff',
        '.aifc': 'audio/aiff',
        '.amr': 'audio/amr',
        '.awb': 'audio/amr-wb',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.ac3': 'audio/ac3',
        '.aac': 'audio/aac',
        '.m4a': 'audio/mp4'
    };
    return mimeTypes[ext] || 'audio/wav';
}

export function getVideoMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.mp4': 'video/mp4',
        '.ts': 'video/mp2t',
        '.mts': 'video/mp2t',
        '.m2ts': 'video/mp2t',
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
    const fileSize = buffer.length;

    if (fileSize > MAX_FILE_SIZE) {
        throw new Error(`File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
    }

    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function getAudioWebviewSource(filePath: string): Promise<{ dataUrl: string; mimeType: string; transcoded: boolean }> {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = getAudioMimeType(filePath);

    if (ext === RAW_PCM_EXTENSION) {
        const pcmBuffer = await fs.promises.readFile(filePath);
        if (pcmBuffer.length > MAX_FILE_SIZE) {
            throw new Error(`PCM file too large (${(pcmBuffer.length / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
        }

        const wavBuffer = wrapRawPcmAsWav(pcmBuffer);
        return {
            dataUrl: `data:audio/wav;base64,${wavBuffer.toString('base64')}`,
            mimeType: 'audio/wav',
            transcoded: true
        };
    }

    if (!WEBVIEW_TRANSCODE_EXTENSIONS.has(ext)) {
        return {
            dataUrl: await fileToDataUrl(filePath, mimeType),
            mimeType,
            transcoded: false
        };
    }

    try {
        const wavBuffer = await transcodeAudioToWav(filePath);
        return {
            dataUrl: `data:audio/wav;base64,${wavBuffer.toString('base64')}`,
            mimeType: 'audio/wav',
            transcoded: true
        };
    } catch (error) {
        console.warn(`Failed to transcode ${path.basename(filePath)} for webview playback:`, error);
        return {
            dataUrl: await fileToDataUrl(filePath, mimeType),
            mimeType,
            transcoded: false
        };
    }
}

async function transcodeAudioToWav(filePath: string): Promise<Buffer> {
    const ffmpegPath = await findExecutable('ffmpeg');
    if (!ffmpegPath) {
        throw new Error('ffmpeg is not available in PATH.');
    }

    return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        const process = spawn(ffmpegPath, [
            '-v', 'error',
            '-i', filePath,
            '-f', 'wav',
            '-acodec', 'pcm_s16le',
            '-'
        ]);

        process.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        process.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
        process.on('error', reject);
        process.on('close', (code) => {
            if (code !== 0) {
                const message = Buffer.concat(stderrChunks).toString('utf8').trim() || `ffmpeg exited with code ${code}`;
                reject(new Error(message));
                return;
            }

            const buffer = Buffer.concat(chunks);
            if (buffer.length === 0) {
                reject(new Error('ffmpeg produced no audio output.'));
                return;
            }

            if (buffer.length > MAX_FILE_SIZE) {
                reject(new Error(`Transcoded file too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`));
                return;
            }

            resolve(buffer);
        });
    });
}

async function findExecutable(command: string): Promise<string | null> {
    const envPath = process.env.PATH || '';
    const pathEntries = envPath.split(path.delimiter).filter(Boolean);

    for (const entry of pathEntries) {
        const candidate = path.join(entry, command);
        try {
            await fs.promises.access(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            continue;
        }
    }

    return null;
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
    const ext = path.extname(filePath).toLowerCase();

    if (ext === RAW_PCM_EXTENSION) {
        const stats = await fs.promises.stat(filePath);
        const bytesPerFrame = RAW_PCM_CHANNELS * (RAW_PCM_BIT_DEPTH / 8);
        const duration = bytesPerFrame > 0
            ? stats.size / (RAW_PCM_SAMPLE_RATE * bytesPerFrame)
            : undefined;

        return {
            sampleRate: RAW_PCM_SAMPLE_RATE,
            channels: RAW_PCM_CHANNELS,
            bitDepth: RAW_PCM_BIT_DEPTH,
            duration,
            format: 'PCM (s16le)',
            fileSize: await getFileSize(filePath)
        };
    }

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
            format: ext.toUpperCase().slice(1),
            fileSize: await getFileSize(filePath)
        };
    }
}

function wrapRawPcmAsWav(pcmBuffer: Buffer): Buffer {
    const bytesPerSample = RAW_PCM_BIT_DEPTH / 8;
    const blockAlign = RAW_PCM_CHANNELS * bytesPerSample;
    const byteRate = RAW_PCM_SAMPLE_RATE * blockAlign;
    const dataSize = pcmBuffer.length;
    const wavBuffer = Buffer.alloc(44 + dataSize);

    wavBuffer.write('RIFF', 0, 'ascii');
    wavBuffer.writeUInt32LE(36 + dataSize, 4);
    wavBuffer.write('WAVE', 8, 'ascii');
    wavBuffer.write('fmt ', 12, 'ascii');
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20);
    wavBuffer.writeUInt16LE(RAW_PCM_CHANNELS, 22);
    wavBuffer.writeUInt32LE(RAW_PCM_SAMPLE_RATE, 24);
    wavBuffer.writeUInt32LE(byteRate, 28);
    wavBuffer.writeUInt16LE(blockAlign, 32);
    wavBuffer.writeUInt16LE(RAW_PCM_BIT_DEPTH, 34);
    wavBuffer.write('data', 36, 'ascii');
    wavBuffer.writeUInt32LE(dataSize, 40);
    pcmBuffer.copy(wavBuffer, 44);

    return wavBuffer;
}
