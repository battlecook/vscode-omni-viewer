import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { gunzipSync } from 'zlib';
import JSZip from 'jszip';

const execFileAsync = promisify(execFile);
const MAX_VISIBLE_ENTRIES = 1000;
const GZIP_PREVIEW_LIMIT = 64 * 1024 * 1024;

export interface ArchivePreviewEntry {
    path: string;
    kind: 'file' | 'directory';
    compressedSize: number | null;
    uncompressedSize: number | null;
    modifiedAt: string | null;
}

export interface ArchivePreviewData {
    format: string;
    fileName: string;
    fileSize: string;
    entryCount: number;
    fileCount: number;
    directoryCount: number;
    truncated: boolean;
    entries: ArchivePreviewEntry[];
    note?: string;
}

export async function readArchiveFile(filePath: string): Promise<ArchivePreviewData> {
    const stats = await fs.promises.stat(filePath);
    const lowerPath = filePath.toLowerCase();

    if (lowerPath.endsWith('.zip') || lowerPath.endsWith('.jar') || lowerPath.endsWith('.apk')) {
        return readZipArchive(filePath, stats.size);
    }

    if (lowerPath.endsWith('.tar')) {
        return readTarArchive(filePath, stats.size, false);
    }

    if (lowerPath.endsWith('.tgz') || lowerPath.endsWith('.tar.gz')) {
        return readTarArchive(filePath, stats.size, true);
    }

    if (lowerPath.endsWith('.gz')) {
        return readGzipArchive(filePath, stats.size);
    }

    throw new Error('Unsupported archive format. Currently supported: ZIP, TAR, TGZ, TAR.GZ, and GZ.');
}

async function readZipArchive(filePath: string, fileSizeBytes: number): Promise<ArchivePreviewData> {
    const buffer = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const allEntries = Object.values(zip.files)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => {
            const internalEntry = entry as typeof entry & {
                _data?: { compressedSize?: number; uncompressedSize?: number };
            };

            return {
                path: entry.name,
                kind: entry.dir ? 'directory' as const : 'file' as const,
                compressedSize: internalEntry._data?.compressedSize ?? null,
                uncompressedSize: internalEntry._data?.uncompressedSize ?? null,
                modifiedAt: entry.date instanceof Date && !Number.isNaN(entry.date.getTime())
                    ? entry.date.toISOString()
                    : null
            };
        });

    return finalizeArchiveData('ZIP', filePath, fileSizeBytes, allEntries);
}

async function readTarArchive(filePath: string, fileSizeBytes: number, gzipCompressed: boolean): Promise<ArchivePreviewData> {
    try {
        const args = gzipCompressed ? ['-tzf', filePath] : ['-tf', filePath];
        const { stdout } = await execFileAsync('tar', args, { maxBuffer: 16 * 1024 * 1024 });
        const allEntries = stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right))
            .map((entryPath) => ({
                path: entryPath,
                kind: entryPath.endsWith('/') ? 'directory' as const : 'file' as const,
                compressedSize: null,
                uncompressedSize: null,
                modifiedAt: null
            }));

        return finalizeArchiveData(gzipCompressed ? 'TAR.GZ' : 'TAR', filePath, fileSizeBytes, allEntries);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to inspect TAR archive with the system tar command. ${message}`);
    }
}

async function readGzipArchive(filePath: string, fileSizeBytes: number): Promise<ArchivePreviewData> {
    const buffer = await fs.promises.readFile(filePath);

    if (fileSizeBytes > GZIP_PREVIEW_LIMIT) {
        return finalizeArchiveData('GZIP', filePath, fileSizeBytes, [
            {
                path: deriveGzipEntryName(filePath, buffer),
                kind: 'file',
                compressedSize: fileSizeBytes,
                uncompressedSize: null,
                modifiedAt: null
            }
        ], 'The compressed file is large, so the uncompressed size was skipped for preview performance.');
    }
    let uncompressedSize: number | null = null;

    try {
        uncompressedSize = gunzipSync(buffer).length;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to inspect GZIP archive. ${message}`);
    }

    return finalizeArchiveData('GZIP', filePath, fileSizeBytes, [
        {
            path: deriveGzipEntryName(filePath, buffer),
            kind: 'file',
            compressedSize: fileSizeBytes,
            uncompressedSize,
            modifiedAt: null
        }
    ]);
}

function finalizeArchiveData(
    format: string,
    filePath: string,
    fileSizeBytes: number,
    allEntries: ArchivePreviewEntry[],
    note?: string
): ArchivePreviewData {
    const visibleEntries = allEntries.slice(0, MAX_VISIBLE_ENTRIES);
    const directoryCount = allEntries.filter((entry) => entry.kind === 'directory').length;
    const fileCount = allEntries.length - directoryCount;

    return {
        format,
        fileName: path.basename(filePath),
        fileSize: formatFileSize(fileSizeBytes),
        entryCount: allEntries.length,
        fileCount,
        directoryCount,
        truncated: allEntries.length > visibleEntries.length,
        entries: visibleEntries,
        ...(note ? { note } : {})
    };
}

function deriveGzipEntryName(filePath: string, buffer: Buffer): string {
    const originalName = readGzipOriginalName(buffer);
    if (originalName) {
        return originalName;
    }

    const baseName = path.basename(filePath);
    if (baseName.toLowerCase().endsWith('.gz')) {
        return baseName.slice(0, -3) || baseName;
    }

    return baseName;
}

function readGzipOriginalName(buffer: Buffer): string | null {
    if (buffer.length < 10 || buffer[0] !== 0x1F || buffer[1] !== 0x8B) {
        return null;
    }

    const flags = buffer[3];
    let offset = 10;

    if (flags & 0x04) {
        if (offset + 2 > buffer.length) {
            return null;
        }
        const extraLength = buffer.readUInt16LE(offset);
        offset += 2 + extraLength;
    }

    if (flags & 0x08) {
        const end = buffer.indexOf(0x00, offset);
        if (end === -1) {
            return null;
        }
        return buffer.subarray(offset, end).toString('utf8');
    }

    return null;
}

function formatFileSize(size: number): string {
    if (!Number.isFinite(size) || size < 0) {
        return 'Unknown';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = size;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
}
