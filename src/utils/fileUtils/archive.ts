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

export interface ArchiveEntryPreviewData {
    path: string;
    status: 'success' | 'unsupported' | 'error';
    content?: string;
    truncated?: boolean;
    message?: string;
}

const MAX_PREVIEW_TEXT_BYTES = 64 * 1024;
const MAX_PREVIEW_ENTRY_BYTES = 512 * 1024;

export async function readArchiveFile(filePath: string): Promise<ArchivePreviewData> {
    const stats = await fs.promises.stat(filePath);
    const lowerPath = filePath.toLowerCase();

    if (lowerPath.endsWith('.zip') || lowerPath.endsWith('.jar') || lowerPath.endsWith('.apk')) {
        return readZipArchive(filePath, stats.size);
    }

    if (lowerPath.endsWith('.rar')) {
        return readSevenZipArchive(filePath, stats.size, 'RAR');
    }

    if (lowerPath.endsWith('.7z')) {
        return readSevenZipArchive(filePath, stats.size, '7Z');
    }

    if (lowerPath.endsWith('.dmg')) {
        return readSevenZipArchive(filePath, stats.size, 'DMG');
    }

    if (lowerPath.endsWith('.tar')) {
        return readTarArchive(filePath, stats.size, 'plain');
    }

    if (lowerPath.endsWith('.tgz') || lowerPath.endsWith('.tar.gz')) {
        return readTarArchive(filePath, stats.size, 'gzip');
    }

    if (lowerPath.endsWith('.tbz2') || lowerPath.endsWith('.tar.bz2')) {
        return readTarArchive(filePath, stats.size, 'bzip2');
    }

    if (lowerPath.endsWith('.txz') || lowerPath.endsWith('.tar.xz')) {
        return readTarArchive(filePath, stats.size, 'xz');
    }

    if (lowerPath.endsWith('.gz')) {
        return readGzipArchive(filePath, stats.size);
    }

    throw new Error('Unsupported archive format. Currently supported: ZIP, APK, JAR, RAR, 7Z, DMG, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, TGZ, TBZ2, TXZ, and GZ.');
}

export async function readArchiveEntryPreview(filePath: string, entryPath: string): Promise<ArchiveEntryPreviewData> {
    const lowerPath = filePath.toLowerCase();

    try {
        if (lowerPath.endsWith('.zip') || lowerPath.endsWith('.jar') || lowerPath.endsWith('.apk')) {
            return readZipArchiveEntryPreview(filePath, entryPath);
        }

        if (lowerPath.endsWith('.rar') || lowerPath.endsWith('.7z') || lowerPath.endsWith('.dmg')) {
            return readSevenZipArchiveEntryPreview(filePath, entryPath);
        }

        if (lowerPath.endsWith('.tar')) {
            return readTarArchiveEntryPreview(filePath, entryPath, 'plain');
        }

        if (lowerPath.endsWith('.tgz') || lowerPath.endsWith('.tar.gz')) {
            return readTarArchiveEntryPreview(filePath, entryPath, 'gzip');
        }

        if (lowerPath.endsWith('.tbz2') || lowerPath.endsWith('.tar.bz2')) {
            return readTarArchiveEntryPreview(filePath, entryPath, 'bzip2');
        }

        if (lowerPath.endsWith('.txz') || lowerPath.endsWith('.tar.xz')) {
            return readTarArchiveEntryPreview(filePath, entryPath, 'xz');
        }

        if (lowerPath.endsWith('.gz')) {
            return readGzipArchiveEntryPreview(filePath, entryPath);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            path: entryPath,
            status: 'error',
            message
        };
    }

    return {
        path: entryPath,
        status: 'unsupported',
        message: 'Preview is not available for this archive format.'
    };
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

async function readZipArchiveEntryPreview(filePath: string, entryPath: string): Promise<ArchiveEntryPreviewData> {
    const buffer = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const entry = zip.file(entryPath);

    if (!entry) {
        return {
            path: entryPath,
            status: 'error',
            message: 'The selected entry could not be found in the archive.'
        };
    }

    const internalEntry = entry as typeof entry & {
        _data?: { uncompressedSize?: number };
    };
    const knownSize = internalEntry._data?.uncompressedSize;
    if (typeof knownSize === 'number' && knownSize > MAX_PREVIEW_ENTRY_BYTES) {
        return {
            path: entryPath,
            status: 'unsupported',
            message: `Preview is limited to files up to ${formatFileSize(MAX_PREVIEW_ENTRY_BYTES)}.`
        };
    }

    const entryBuffer = await entry.async('nodebuffer');
    return buildArchiveEntryPreview(entryPath, entryBuffer);
}

async function readSevenZipArchive(filePath: string, fileSizeBytes: number, format: string): Promise<ArchivePreviewData> {
    try {
        const { stdout } = await execFileAsync('7z', ['l', '-slt', filePath], { maxBuffer: 16 * 1024 * 1024 });
        const { entries, warnings } = parseSevenZipListing(stdout, filePath);

        return finalizeArchiveData(
            format,
            filePath,
            fileSizeBytes,
            entries,
            warnings.length > 0 ? warnings.join(' ') : undefined
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to inspect ${format} archive with the system 7z command. ${message}`);
    }
}

async function readSevenZipArchiveEntryPreview(filePath: string, entryPath: string): Promise<ArchiveEntryPreviewData> {
    try {
        const { stdout } = await execFileAsync('7z', ['x', '-so', filePath, entryPath], {
            encoding: 'buffer',
            maxBuffer: MAX_PREVIEW_ENTRY_BYTES
        });
        const outputBuffer = asBuffer(stdout);
        return buildArchiveEntryPreview(entryPath, outputBuffer);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('stdout maxBuffer length exceeded')) {
            return {
                path: entryPath,
                status: 'unsupported',
                message: `Preview is limited to files up to ${formatFileSize(MAX_PREVIEW_ENTRY_BYTES)}.`
            };
        }

        throw new Error(`Failed to extract the selected entry with the system 7z command. ${message}`);
    }
}

async function readTarArchive(
    filePath: string,
    fileSizeBytes: number,
    compression: 'plain' | 'gzip' | 'bzip2' | 'xz'
): Promise<ArchivePreviewData> {
    try {
        const args = getTarListArgs(filePath, compression);
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

        return finalizeArchiveData(getTarFormatLabel(compression), filePath, fileSizeBytes, allEntries);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to inspect TAR archive with the system tar command. ${message}`);
    }
}

async function readTarArchiveEntryPreview(
    filePath: string,
    entryPath: string,
    compression: 'plain' | 'gzip' | 'bzip2' | 'xz'
): Promise<ArchiveEntryPreviewData> {
    try {
        const args = getTarExtractArgs(filePath, entryPath, compression);
        const { stdout } = await execFileAsync('tar', args, {
            encoding: 'buffer',
            maxBuffer: MAX_PREVIEW_ENTRY_BYTES
        });
        const outputBuffer = asBuffer(stdout);
        return buildArchiveEntryPreview(entryPath, outputBuffer);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('stdout maxBuffer length exceeded')) {
            return {
                path: entryPath,
                status: 'unsupported',
                message: `Preview is limited to files up to ${formatFileSize(MAX_PREVIEW_ENTRY_BYTES)}.`
            };
        }

        throw new Error(`Failed to extract the selected TAR entry. ${message}`);
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

async function readGzipArchiveEntryPreview(filePath: string, entryPath: string): Promise<ArchiveEntryPreviewData> {
    const buffer = await fs.promises.readFile(filePath);
    const derivedName = deriveGzipEntryName(filePath, buffer);

    if (entryPath !== derivedName) {
        return {
            path: entryPath,
            status: 'error',
            message: 'The selected entry could not be found in the archive.'
        };
    }

    if (buffer.length > MAX_PREVIEW_ENTRY_BYTES) {
        return {
            path: entryPath,
            status: 'unsupported',
            message: `Preview is limited to files up to ${formatFileSize(MAX_PREVIEW_ENTRY_BYTES)}.`
        };
    }

    try {
        const uncompressed = gunzipSync(buffer);
        return buildArchiveEntryPreview(entryPath, uncompressed);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to extract the selected GZIP entry. ${message}`);
    }
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

function getTarListArgs(filePath: string, compression: 'plain' | 'gzip' | 'bzip2' | 'xz'): string[] {
    switch (compression) {
    case 'gzip':
        return ['-tzf', filePath];
    case 'bzip2':
        return ['-tjf', filePath];
    case 'xz':
        return ['-tJf', filePath];
    case 'plain':
    default:
        return ['-tf', filePath];
    }
}

function getTarExtractArgs(
    filePath: string,
    entryPath: string,
    compression: 'plain' | 'gzip' | 'bzip2' | 'xz'
): string[] {
    switch (compression) {
    case 'gzip':
        return ['-xOzf', filePath, entryPath];
    case 'bzip2':
        return ['-xOjf', filePath, entryPath];
    case 'xz':
        return ['-xOJf', filePath, entryPath];
    case 'plain':
    default:
        return ['-xOf', filePath, entryPath];
    }
}

function getTarFormatLabel(compression: 'plain' | 'gzip' | 'bzip2' | 'xz'): string {
    switch (compression) {
    case 'gzip':
        return 'TAR.GZ';
    case 'bzip2':
        return 'TAR.BZ2';
    case 'xz':
        return 'TAR.XZ';
    case 'plain':
    default:
        return 'TAR';
    }
}

function parseSevenZipListing(
    output: string,
    archivePath: string
): { entries: ArchivePreviewEntry[]; warnings: string[] } {
    const lines = output.split(/\r?\n/);
    const warnings = lines
        .map((line) => line.trim())
        .filter((line) => line.includes('WARNING'));

    const separatorIndex = lines.findIndex((line) => line.trim() === '----------');
    if (separatorIndex === -1) {
        return { entries: [], warnings };
    }

    const records: Array<Record<string, string>> = [];
    let currentRecord: Record<string, string> = {};

    for (const line of lines.slice(separatorIndex + 1)) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (Object.keys(currentRecord).length > 0) {
                records.push(currentRecord);
                currentRecord = {};
            }
            continue;
        }

        const delimiterIndex = line.indexOf(' = ');
        if (delimiterIndex === -1) {
            continue;
        }

        const key = line.slice(0, delimiterIndex).trim();
        const value = line.slice(delimiterIndex + 3).trim();
        currentRecord[key] = value;
    }

    if (Object.keys(currentRecord).length > 0) {
        records.push(currentRecord);
    }

    const entries = records
        .filter((record) => record.Path && record.Path !== archivePath)
        .map((record) => {
            const entryPath = record.Path;
            const isDirectory = record.Folder === '+'
                || entryPath.endsWith('/')
                || (record.Attributes || '').startsWith('D');

            return {
                path: entryPath,
                kind: isDirectory ? 'directory' as const : 'file' as const,
                compressedSize: parseArchiveNumber(record['Packed Size']),
                uncompressedSize: parseArchiveNumber(record.Size),
                modifiedAt: normalizeArchiveDate(record.Modified || record.Created || null)
            };
        })
        .sort((left, right) => left.path.localeCompare(right.path));

    return { entries, warnings };
}

function parseArchiveNumber(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeArchiveDate(value: string | null): string | null {
    if (!value) {
        return null;
    }

    const normalized = value.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
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

function buildArchiveEntryPreview(entryPath: string, buffer: Buffer): ArchiveEntryPreviewData {
    if (buffer.length === 0) {
        return {
            path: entryPath,
            status: 'success',
            content: '',
            truncated: false
        };
    }

    if (buffer.length > MAX_PREVIEW_ENTRY_BYTES) {
        return {
            path: entryPath,
            status: 'unsupported',
            message: `Preview is limited to files up to ${formatFileSize(MAX_PREVIEW_ENTRY_BYTES)}.`
        };
    }

    if (isProbablyBinary(buffer)) {
        return {
            path: entryPath,
            status: 'unsupported',
            message: 'Binary files are not rendered in the inline preview yet.'
        };
    }

    const previewBuffer = buffer.subarray(0, MAX_PREVIEW_TEXT_BYTES);
    return {
        path: entryPath,
        status: 'success',
        content: previewBuffer.toString('utf8'),
        truncated: buffer.length > MAX_PREVIEW_TEXT_BYTES
    };
}

function isProbablyBinary(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8192);
    let suspiciousCount = 0;

    for (let index = 0; index < sampleSize; index += 1) {
        const byte = buffer[index];
        if (byte === 0) {
            return true;
        }

        const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12;
        if (isControl) {
            suspiciousCount += 1;
        }
    }

    return suspiciousCount / sampleSize > 0.02;
}

function asBuffer(value: string | Buffer): Buffer {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
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
