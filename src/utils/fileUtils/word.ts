import * as fs from 'fs';
import * as path from 'path';
import { DocBinaryParser } from '../docBinaryParser';
import { getFileSize } from './media';

export async function readWordFile(filePath: string): Promise<{
    renderer: 'docx-preview' | 'legacy-html';
    docxBase64?: string;
    htmlContent?: string;
    sourceFormat: 'docx' | 'doc';
    wasConverted: boolean;
    fileSize: string;
}> {
    const stats = await fs.promises.stat(filePath);
    const fileSizeBytes = stats.size;
    const maxWordFileSize = 50 * 1024 * 1024;
    if (fileSizeBytes > maxWordFileSize) {
        throw new Error(`File too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum size is ${maxWordFileSize / 1024 / 1024}MB.`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.docx') {
        const docxBuffer = await fs.promises.readFile(filePath);
        return {
            renderer: 'docx-preview',
            docxBase64: docxBuffer.toString('base64'),
            sourceFormat: 'docx',
            wasConverted: false,
            fileSize: await getFileSize(filePath)
        };
    }

    if (ext === '.doc') {
        return {
            renderer: 'legacy-html',
            htmlContent: await DocBinaryParser.parseToHtml(filePath),
            sourceFormat: 'doc',
            wasConverted: false,
            fileSize: await getFileSize(filePath)
        };
    }

    throw new Error(`Unsupported Word format: ${ext || 'unknown'}`);
}
