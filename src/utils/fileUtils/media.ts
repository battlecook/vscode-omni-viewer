import * as fs from 'fs';
import * as mm from 'music-metadata';
import * as path from 'path';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

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
    const fileSize = buffer.length;

    if (fileSize > MAX_FILE_SIZE) {
        throw new Error(`File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
    }

    return `data:${mimeType};base64,${buffer.toString('base64')}`;
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
