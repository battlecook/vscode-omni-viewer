import * as path from 'path';
import * as fs from 'fs';

export class FileUtils {
    /**
     * 파일 크기 제한 (50MB)
     */
    private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024;

    /**
     * 오디오 파일의 MIME 타입을 반환합니다.
     */
    public static getAudioMimeType(filePath: string): string {
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

    /**
     * 비디오 파일의 MIME 타입을 반환합니다.
     */
    public static getVideoMimeType(filePath: string): string {
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

    /**
     * 이미지 파일의 MIME 타입을 반환합니다.
     */
    public static getImageMimeType(filePath: string): string {
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

    /**
     * 파일을 base64로 인코딩하여 data URL을 생성합니다.
     */
    public static async fileToDataUrl(filePath: string, mimeType: string): Promise<string> {
        try {
            const buffer = await fs.promises.readFile(filePath);
            const fileSize = buffer.length;
            
            if (fileSize > this.MAX_FILE_SIZE) {
                throw new Error(`File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB). Maximum size is ${this.MAX_FILE_SIZE / 1024 / 1024}MB.`);
            }
            
            console.log(`File loaded: ${(fileSize / 1024 / 1024).toFixed(2)}MB, MIME type: ${mimeType}`);
            return `data:${mimeType};base64,${buffer.toString('base64')}`;
        } catch (error) {
            console.error('Error reading file:', error);
            throw error;
        }
    }
}
