import * as path from 'path';
import * as fs from 'fs';
import * as mm from 'music-metadata';

export class FileUtils {
    private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024;

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

    public static async getFileSize(filePath: string): Promise<string> {
        try {
            const stats = await fs.promises.stat(filePath);
            const bytes = stats.size;
            
            if (bytes === 0) return '0 B';
            
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        } catch (error) {
            console.error('Error getting file size:', error);
            return 'Unknown';
        }
    }

    public static async getAudioMetadata(filePath: string): Promise<{
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
                fileSize: await this.getFileSize(filePath)
            };
        } catch (error) {
            console.error('Error reading audio metadata:', error);
            return {
                format: path.extname(filePath).toUpperCase().slice(1),
                fileSize: await this.getFileSize(filePath)
            };
        }
    }

    public static async readCsvFile(filePath: string): Promise<{
        headers: string[];
        rows: string[][];
        totalRows: number;
        totalColumns: number;
        fileSize: string;
    }> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim() !== '');
            
            if (lines.length === 0) {
                throw new Error('CSV file is empty');
            }

            // Parse CSV (simple implementation - assumes comma-separated values)
            const rows: string[][] = [];
            for (const line of lines) {
                // Simple CSV parsing - split by comma, handle quoted values
                const row = this.parseCsvLine(line);
                rows.push(row);
            }

            const headers = rows[0] || [];
            const dataRows = rows.slice(1);
            const fileSize = await this.getFileSize(filePath);

            return {
                headers,
                rows: dataRows,
                totalRows: dataRows.length,
                totalColumns: headers.length,
                fileSize
            };
        } catch (error) {
            console.error('Error reading CSV file:', error);
            throw error;
        }
    }

    private static parseCsvLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    current += '"';
                    i++;
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                // End of field
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        // Add the last field
        result.push(current.trim());
        
        return result;
    }
}
