import * as fs from 'fs';
import * as mm from 'music-metadata';
import * as path from 'path';
import { spawn } from 'child_process';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const WEBVIEW_TRANSCODE_EXTENSIONS = new Set(['.aiff', '.aif', '.aifc', '.ac3', '.amr', '.awb']);

export function getAudioMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
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
