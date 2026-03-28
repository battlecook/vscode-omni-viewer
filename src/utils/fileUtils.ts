import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import JSZip from 'jszip';
import { PptxXmlParser } from './pptxXmlParser';
import { PptBinaryParser } from './pptBinaryParser';
import {
    fileToDataUrl as readFileToDataUrl,
    getAudioMetadata as readAudioMetadata,
    getAudioMimeType as resolveAudioMimeType,
    getFileSize as readFileSize,
    getImageMimeType as resolveImageMimeType,
    getVideoMimeType as resolveVideoMimeType
} from './fileUtils/media';
import {
    getDelimitedFileDelimiter as detectDelimitedFileDelimiter,
    readCsvFile as readDelimitedCsvFile,
    readExcelFile as readWorkbookFile,
    readJsonlFile as readJsonlLines,
    readParquetFile as readParquetRows
} from './fileUtils/tabular';
import { readWordFile as readWordDocument } from './fileUtils/word';

export type OmniViewerViewType =
    | 'omni-viewer.audioViewer'
    | 'omni-viewer.videoViewer'
    | 'omni-viewer.imageViewer'
    | 'omni-viewer.csvViewer'
    | 'omni-viewer.jsonlViewer'
    | 'omni-viewer.parquetViewer'
    | 'omni-viewer.hwpViewer'
    | 'omni-viewer.psdViewer'
    | 'omni-viewer.excelViewer'
    | 'omni-viewer.wordViewer'
    | 'omni-viewer.pdfViewer'
    | 'omni-viewer.pptViewer';

export interface FileViewerDetectionResult {
    viewType: OmniViewerViewType | null;
    reason: string;
    matchedBySignature: boolean;
}

export class FileUtils {
    private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024;
    private static readonly DEFAULT_DELIMITER = ',';
    private static readonly SIGNATURE_READ_SIZE = 64 * 1024;

    public static async detectViewerType(filePath: string, fallbackViewType?: OmniViewerViewType): Promise<FileViewerDetectionResult> {
        const buffer = await this.readSignatureBuffer(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const bufferLength = buffer.length;
        const preferredOfficeViewType = this.getOfficeViewTypeForExtension(ext);

        if (bufferLength === 0) {
            return {
                viewType: fallbackViewType ?? null,
                reason: 'The file is empty, so the extension fallback was used.',
                matchedBySignature: false
            };
        }

        if (this.hasAsciiPrefix(buffer, '%PDF-')) {
            return this.signatureMatch('omni-viewer.pdfViewer', 'Matched the PDF header.');
        }

        if (this.matchesBytes(buffer, [0x38, 0x42, 0x50, 0x53])) {
            return this.signatureMatch('omni-viewer.psdViewer', 'Matched the PSD signature.');
        }

        if (this.matchesBytes(buffer, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) {
            return this.signatureMatch('omni-viewer.imageViewer', 'Matched the PNG signature.');
        }

        if (this.matchesBytes(buffer, [0xFF, 0xD8, 0xFF])) {
            return this.signatureMatch('omni-viewer.imageViewer', 'Matched the JPEG signature.');
        }

        if (this.hasAsciiPrefix(buffer, 'GIF87a') || this.hasAsciiPrefix(buffer, 'GIF89a')) {
            return this.signatureMatch('omni-viewer.imageViewer', 'Matched the GIF signature.');
        }

        if (this.matchesBytes(buffer, [0x42, 0x4D])) {
            return this.signatureMatch('omni-viewer.imageViewer', 'Matched the BMP signature.');
        }

        if (this.hasAsciiPrefix(buffer.subarray(8), 'WEBP') && this.hasAsciiPrefix(buffer, 'RIFF')) {
            return this.signatureMatch('omni-viewer.imageViewer', 'Matched the WebP RIFF signature.');
        }

        if (this.isSvg(buffer)) {
            return this.signatureMatch('omni-viewer.imageViewer', 'Matched SVG markup.');
        }

        if (this.hasAsciiPrefix(buffer, 'fLaC')) {
            return this.signatureMatch('omni-viewer.audioViewer', 'Matched the FLAC signature.');
        }

        if (this.hasAsciiPrefix(buffer, 'OggS')) {
            return this.signatureMatch('omni-viewer.audioViewer', 'Matched the OGG container signature.');
        }

        if (this.hasAsciiPrefix(buffer, 'ID3') || this.isMp3FrameHeader(buffer)) {
            return this.signatureMatch('omni-viewer.audioViewer', 'Matched MP3 frame metadata.');
        }

        if (this.hasAsciiPrefix(buffer, 'RIFF') && this.hasAsciiPrefix(buffer.subarray(8), 'WAVE')) {
            return this.signatureMatch('omni-viewer.audioViewer', 'Matched the WAV RIFF signature.');
        }

        if (this.isAacAdts(buffer)) {
            return this.signatureMatch('omni-viewer.audioViewer', 'Matched AAC ADTS sync bytes.');
        }

        if (this.hasAsciiPrefix(buffer, 'RIFF') && this.hasAsciiPrefix(buffer.subarray(8), 'AVI ')) {
            return this.signatureMatch('omni-viewer.videoViewer', 'Matched the AVI RIFF signature.');
        }

        if (this.isMp4Family(buffer)) {
            if (ext === '.m4a') {
                return this.signatureMatch('omni-viewer.audioViewer', 'Matched an MP4-family container and the .m4a extension.');
            }

            return this.signatureMatch('omni-viewer.videoViewer', 'Matched an MP4-family container signature.');
        }

        if (this.matchesBytes(buffer, [0x1A, 0x45, 0xDF, 0xA3])) {
            if (ext === '.webm' || ext === '.mkv') {
                return this.signatureMatch('omni-viewer.videoViewer', 'Matched the EBML signature used by WebM/Matroska.');
            }
        }

        if (await this.isParquet(filePath, buffer)) {
            return this.signatureMatch('omni-viewer.parquetViewer', 'Matched the Parquet magic bytes.');
        }

        if (this.isCompoundFileBinary(buffer)) {
            if (preferredOfficeViewType) {
                return this.signatureMatch(
                    preferredOfficeViewType,
                    `Matched the Compound File signature and preserved the ${ext} Office viewer.`
                );
            }

            const compoundType = this.detectCompoundFileViewType(buffer);
            if (compoundType) {
                return this.signatureMatch(compoundType.viewType, compoundType.reason);
            }
        }

        if (this.matchesBytes(buffer, [0x50, 0x4B, 0x03, 0x04])) {
            if (preferredOfficeViewType) {
                return this.signatureMatch(
                    preferredOfficeViewType,
                    `Matched a ZIP-based Office container and preserved the ${ext} Office viewer.`
                );
            }

            const zipType = await this.detectZipBasedOfficeViewType(filePath);
            if (zipType) {
                return this.signatureMatch(zipType.viewType, zipType.reason);
            }
        }

        const textType = this.detectTextBasedViewType(buffer, ext);
        if (textType) {
            return textType;
        }

        return {
            viewType: fallbackViewType ?? null,
            reason: fallbackViewType
                ? 'No strong file signature matched, so the extension fallback was used.'
                : 'No supported file signature matched.',
            matchedBySignature: false
        };
    }

    public static getAudioMimeType(filePath: string): string {
        return resolveAudioMimeType(filePath);
    }

    public static getVideoMimeType(filePath: string): string {
        return resolveVideoMimeType(filePath);
    }

    public static getImageMimeType(filePath: string): string {
        return resolveImageMimeType(filePath);
    }

    public static async fileToDataUrl(filePath: string, mimeType: string): Promise<string> {
        return readFileToDataUrl(filePath, mimeType);
    }

    public static async getFileSize(filePath: string): Promise<string> {
        return readFileSize(filePath);
    }

    public static async getAudioMetadata(filePath: string): Promise<{
        sampleRate?: number;
        channels?: number;
        bitDepth?: number;
        duration?: number;
        format?: string;
        fileSize?: string;
    }> {
        return readAudioMetadata(filePath);
    }

    public static async readCsvFile(filePath: string): Promise<{
        headers: string[];
        rows: string[][];
        totalRows: number;
        totalColumns: number;
        fileSize: string;
        delimiter: string;
    }> {
        return readDelimitedCsvFile(filePath);
    }

    public static getDelimitedFileDelimiter(filePath: string, lines: string[] = []): string {
        return detectDelimitedFileDelimiter(filePath, lines);
    }

    private static detectDelimiter(lines: string[]): string | null {
        const sampleLines = lines
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .slice(0, 10);

        if (sampleLines.length === 0) {
            return null;
        }

        const candidates = [',', ';', '\t', '|'];
        let bestDelimiter: string | null = null;
        let bestScore = 0;

        for (const candidate of candidates) {
            const counts = sampleLines.map(line => this.countDelimiterOccurrences(line, candidate));
            const positiveCounts = counts.filter(count => count > 0);

            if (positiveCounts.length === 0) {
                continue;
            }

            const consistencyScore = positiveCounts.length;
            const densityScore = positiveCounts.reduce((sum, count) => sum + count, 0);
            const score = consistencyScore * 100 + densityScore;

            if (score > bestScore) {
                bestScore = score;
                bestDelimiter = candidate;
            }
        }

        return bestDelimiter;
    }

    private static countDelimiterOccurrences(line: string, delimiter: string): number {
        let count = 0;
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                count++;
            }
        }

        return count;
    }

    private static signatureMatch(viewType: OmniViewerViewType, reason: string): FileViewerDetectionResult {
        return { viewType, reason, matchedBySignature: true };
    }

    private static getOfficeViewTypeForExtension(ext: string): OmniViewerViewType | null {
        switch (ext) {
        case '.doc':
        case '.docx':
            return 'omni-viewer.wordViewer';
        case '.xls':
        case '.xlsx':
            return 'omni-viewer.excelViewer';
        case '.ppt':
        case '.pptx':
            return 'omni-viewer.pptViewer';
        case '.hwp':
        case '.hwpx':
            return 'omni-viewer.hwpViewer';
        default:
            return null;
        }
    }

    private static async readSignatureBuffer(filePath: string): Promise<Buffer> {
        const handle = await fs.promises.open(filePath, 'r');
        try {
            const buffer = Buffer.alloc(this.SIGNATURE_READ_SIZE);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            return buffer.subarray(0, bytesRead);
        } finally {
            await handle.close();
        }
    }

    private static matchesBytes(buffer: Buffer, signature: number[], offset = 0): boolean {
        if (buffer.length < offset + signature.length) {
            return false;
        }

        return signature.every((byte, index) => buffer[offset + index] === byte);
    }

    private static hasAsciiPrefix(buffer: Buffer, value: string): boolean {
        if (buffer.length < value.length) {
            return false;
        }

        return buffer.subarray(0, value.length).toString('ascii') === value;
    }

    private static isSvg(buffer: Buffer): boolean {
        const snippet = buffer.subarray(0, 2048).toString('utf8').trimStart();
        return snippet.startsWith('<svg') || snippet.startsWith('<?xml') && snippet.includes('<svg');
    }

    private static isMp3FrameHeader(buffer: Buffer): boolean {
        return buffer.length >= 2
            && buffer[0] === 0xFF
            && (buffer[1] & 0xE0) === 0xE0;
    }

    private static isAacAdts(buffer: Buffer): boolean {
        return buffer.length >= 2
            && buffer[0] === 0xFF
            && (buffer[1] & 0xF6) === 0xF0;
    }

    private static isMp4Family(buffer: Buffer): boolean {
        if (buffer.length < 12) {
            return false;
        }

        return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    }

    private static async isParquet(filePath: string, headerBuffer: Buffer): Promise<boolean> {
        if (!this.hasAsciiPrefix(headerBuffer, 'PAR1')) {
            return false;
        }

        const stats = await fs.promises.stat(filePath);
        if (stats.size < 8) {
            return false;
        }

        const handle = await fs.promises.open(filePath, 'r');
        try {
            const footer = Buffer.alloc(4);
            await handle.read(footer, 0, footer.length, stats.size - footer.length);
            return footer.toString('ascii') === 'PAR1';
        } finally {
            await handle.close();
        }
    }

    private static isCompoundFileBinary(buffer: Buffer): boolean {
        return this.matchesBytes(buffer, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    }

    private static detectCompoundFileViewType(buffer: Buffer): { viewType: OmniViewerViewType; reason: string } | null {
        const text = buffer.toString('latin1');

        if (text.includes('WordDocument')) {
            return {
                viewType: 'omni-viewer.wordViewer',
                reason: 'Matched the Compound File signature and Word stream metadata.'
            };
        }

        if (text.includes('Workbook')) {
            return {
                viewType: 'omni-viewer.excelViewer',
                reason: 'Matched the Compound File signature and Excel workbook metadata.'
            };
        }

        if (text.includes('PowerPoint Document')) {
            return {
                viewType: 'omni-viewer.pptViewer',
                reason: 'Matched the Compound File signature and PowerPoint stream metadata.'
            };
        }

        if (text.includes('FileHeader') || text.includes('HwpSummaryInformation')) {
            return {
                viewType: 'omni-viewer.hwpViewer',
                reason: 'Matched the Compound File signature and HWP stream metadata.'
            };
        }

        return null;
    }

    private static async detectZipBasedOfficeViewType(filePath: string): Promise<{ viewType: OmniViewerViewType; reason: string } | null> {
        try {
            const buffer = await fs.promises.readFile(filePath);
            const zip = await JSZip.loadAsync(buffer);
            const names = Object.keys(zip.files);

            if (names.some(name => name.startsWith('word/'))) {
                return {
                    viewType: 'omni-viewer.wordViewer',
                    reason: 'Matched a ZIP container with Word OOXML entries.'
                };
            }

            if (names.some(name => name.startsWith('xl/'))) {
                return {
                    viewType: 'omni-viewer.excelViewer',
                    reason: 'Matched a ZIP container with Excel OOXML entries.'
                };
            }

            if (names.some(name => name.startsWith('ppt/'))) {
                return {
                    viewType: 'omni-viewer.pptViewer',
                    reason: 'Matched a ZIP container with PowerPoint OOXML entries.'
                };
            }

            if (
                names.some(name => /^Contents\/section\d+\.xml$/i.test(name))
                || names.includes('Contents/content.hpf')
                || names.includes('version.xml')
            ) {
                return {
                    viewType: 'omni-viewer.hwpViewer',
                    reason: 'Matched a ZIP container with HWPX package entries.'
                };
            }
        } catch (error) {
            console.warn('Failed to inspect ZIP-based office file:', error);
        }

        return null;
    }

    private static detectTextBasedViewType(buffer: Buffer, ext: string): FileViewerDetectionResult | null {
        const sample = buffer.subarray(0, 16 * 1024).toString('utf8');
        const lines = sample
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

        if (lines.length === 0) {
            return null;
        }

        if (ext === '.jsonl' || ext === '.ndjson' || ext === '.jsonlines' || this.looksLikeJsonl(lines)) {
            return {
                viewType: 'omni-viewer.jsonlViewer',
                reason: 'Matched line-delimited JSON content.',
                matchedBySignature: false
            };
        }

        if (ext === '.csv' || ext === '.tsv') {
            return {
                viewType: 'omni-viewer.csvViewer',
                reason: 'Used the delimited text extension fallback.',
                matchedBySignature: false
            };
        }

        const delimiter = this.detectDelimiter(lines.slice(0, 10));
        if (delimiter) {
            return {
                viewType: 'omni-viewer.csvViewer',
                reason: `Detected repeated "${delimiter}" delimiters in text rows.`,
                matchedBySignature: false
            };
        }

        return null;
    }

    private static looksLikeJsonl(lines: string[]): boolean {
        if (lines.length < 2) {
            return false;
        }

        const sampleLines = lines.slice(0, 10);
        return sampleLines.every(line => {
            try {
                const parsed = JSON.parse(line);
                return typeof parsed === 'object' && parsed !== null;
            } catch (error) {
                return false;
            }
        });
    }

    private static parseDelimitedLine(line: string, delimiter: string): string[] {
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
            } else if (char === delimiter && !inQuotes) {
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

    public static async readJsonlFile(filePath: string): Promise<{
        lines: Array<{ lineNumber: number; content: string; parsedJson?: any; isValid: boolean }>;
        totalLines: number;
        validLines: number;
        invalidLines: number;
        fileSize: string;
    }> {
        return readJsonlLines(filePath);
    }

    public static async readParquetFile(filePath: string): Promise<{
        headers: string[];
        rows: any[][];
        totalRows: number;
        totalColumns: number;
        fileSize: string;
        schema: any;
        isLimited?: boolean;
        limitMessage?: string;
        actualTotalRows?: number;
    }> {
        return readParquetRows(filePath);
    }

    public static async readExcelFile(filePath: string): Promise<{
        sheetNames: string[];
        sheets: Array<{
            name: string;
            headers: string[];
            rows: any[][];
            totalRows: number;
            totalColumns: number;
        }>;
        fileSize: string;
    }> {
        return readWorkbookFile(filePath);
    }

    public static async readWordFile(filePath: string): Promise<{
        renderer: 'docx-preview' | 'legacy-html';
        docxBase64?: string;
        htmlContent?: string;
        sourceFormat: 'docx' | 'doc';
        wasConverted: boolean;
        fileSize: string;
    }> {
        return readWordDocument(filePath);
    }

    public static async readPresentationFile(filePath: string): Promise<{
        mode: 'xml' | 'pdf';
        slides?: Array<{
            slideNumber: number;
            widthPx: number;
            heightPx: number;
            backgroundColor: string;
            elements: Array<{
                type: 'text' | 'image' | 'table' | 'chart' | 'shape';
                x: number;
                y: number;
                width: number;
                height: number;
                rotateDeg?: number;
                zIndex: number;
                isTitle?: boolean;
                paragraphs?: Array<{
                    text: string;
                    level: number;
                    bullet?: boolean;
                    align?: string;
                    fontSizePx?: number;
                    bold?: boolean;
                    italic?: boolean;
                    color?: string;
                    runs?: Array<{
                        text: string;
                        fontSizePx?: number;
                        bold?: boolean;
                        italic?: boolean;
                        color?: string;
                    }>;
                }>;
                src?: string;
                vectorFallback?: boolean;
                tableRows?: string[][];
                chartKind?: string;
                chartTitle?: string;
                chartData?: {
                    kind: 'stackedColumn';
                    categories: string[];
                    series: Array<{
                        name: string;
                        color: string;
                        values: number[];
                        dataLabel?: {
                            showValue?: boolean;
                            numFmt?: string;
                            fontSizePx?: number;
                            color?: string;
                        };
                    }>;
                    gapWidth?: number;
                    overlap?: number;
                    legend?: {
                        position?: string;
                        fontSizePx?: number;
                        color?: string;
                        align?: string;
                    };
                    categoryAxis?: {
                        numFmt?: string;
                        fontSizePx?: number;
                        color?: string;
                        lineColor?: string;
                    };
                    valueAxis?: {
                        numFmt?: string;
                        fontSizePx?: number;
                        color?: string;
                        lineColor?: string;
                        gridColor?: string;
                        majorUnit?: number;
                        min?: number;
                        max?: number;
                        crossesAt?: number;
                    };
                };
                fillColor?: string;
                borderColor?: string;
                borderWidthPx?: number;
            }>;
        }>;
        pdfBase64?: string;
        totalSlides: number;
        fileSize: string;
    }> {
        try {
            const ext = path.extname(filePath).toLowerCase();
            if (ext !== '.pptx' && ext !== '.ppt') {
                throw new Error(`Unsupported presentation format: ${ext}`);
            }

            const stats = await fs.promises.stat(filePath);
            const fileSizeBytes = stats.size;
            const MAX_PPT_FILE_SIZE = 50 * 1024 * 1024; // 50MB
            if (fileSizeBytes > MAX_PPT_FILE_SIZE) {
                throw new Error(
                    `File too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_PPT_FILE_SIZE / 1024 / 1024}MB.`
                );
            }

            const fileSize = await this.getFileSize(filePath);

            if (ext === '.pptx') {
                const parseStartedAt = Date.now();
                const parsed = await PptxXmlParser.parse(filePath);
                const parseElapsedMs = Date.now() - parseStartedAt;
                const hasRenderableElement = parsed.slides.some((slide) =>
                    Array.isArray(slide.elements) && slide.elements.length > 0
                );
                console.log(`[PPT] Parsed PPTX XML in ${parseElapsedMs}ms (${parsed.totalSlides} slides)`);

                if (!hasRenderableElement) {
                    // Fallback to the legacy PPTX extractor so users still see content
                    // if advanced XML parsing misses a specific deck structure.
                    console.warn('[PPT] Parsed slides had no renderable elements. Falling back to legacy extractor.');
                    const fallback = await this.readPptFile(filePath);
                    return {
                        mode: 'xml',
                        slides: fallback.slides.map((slide) => ({
                            slideNumber: slide.slideNumber,
                            widthPx: slide.widthPx,
                            heightPx: slide.heightPx,
                            backgroundColor: slide.backgroundColor,
                            elements: slide.elements.map((el) => ({
                                type: el.type as 'text' | 'image' | 'table' | 'chart' | 'shape',
                                x: el.x,
                                y: el.y,
                                width: el.width,
                                height: el.height,
                                rotateDeg: el.rotateDeg,
                                zIndex: el.zIndex,
                                isTitle: el.isTitle,
                                paragraphs: el.paragraphs,
                                src: el.src
                            }))
                        })),
                        totalSlides: fallback.totalSlides,
                        fileSize
                    };
                }

                return {
                    mode: 'xml',
                    slides: parsed.slides,
                    totalSlides: parsed.totalSlides,
                    fileSize
                };
            }

            // Legacy .ppt: standalone parser first (no LibreOffice dependency).
            try {
                const parseStartedAt = Date.now();
                const parsedLegacy = await PptBinaryParser.parse(filePath);
                const parseElapsedMs = Date.now() - parseStartedAt;
                console.log(`[PPT] Parsed legacy PPT in ${parseElapsedMs}ms (${parsedLegacy.totalSlides} slides)`);
                if (parsedLegacy.totalSlides > 0) {
                    return {
                        mode: 'xml',
                        slides: parsedLegacy.slides,
                        totalSlides: parsedLegacy.totalSlides,
                        fileSize
                    };
                }
            } catch (legacyErr) {
                console.warn('[PPT] Legacy standalone parser failed, trying conversion fallback:', legacyErr);
            }

            // Optional fallback for unsupported structures.
            const pdfBuffer = await this.convertPresentationToPdf(filePath);
            const totalSlides = this.countPdfPages(pdfBuffer);
            return {
                mode: 'pdf',
                pdfBase64: pdfBuffer.toString('base64'),
                totalSlides,
                fileSize
            };
        } catch (error) {
            console.error('Error reading presentation file:', error);
            throw error;
        }
    }

    private static async convertPresentationToPdf(filePath: string): Promise<Buffer> {
        const sofficePath = await this.findSofficePath();
        if (!sofficePath) {
            throw new Error(
                'LibreOffice (soffice) is required to render PPT/PPTX accurately. Please install LibreOffice and ensure "soffice" is available in PATH.'
            );
        }

        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'omni-viewer-ppt-'));
        try {
            await this.runProcess(sofficePath, [
                '--headless',
                '--convert-to',
                'pdf',
                '--outdir',
                tempDir,
                filePath
            ]);

            const expectedPdf = path.join(tempDir, `${path.parse(filePath).name}.pdf`);
            let pdfPath = expectedPdf;
            if (!fs.existsSync(pdfPath)) {
                const convertedFiles = await fs.promises.readdir(tempDir);
                const anyPdf = convertedFiles.find((name) => name.toLowerCase().endsWith('.pdf'));
                if (!anyPdf) {
                    throw new Error('Presentation conversion succeeded but no PDF output was found.');
                }
                pdfPath = path.join(tempDir, anyPdf);
            }

            return await fs.promises.readFile(pdfPath);
        } finally {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
    }

    private static async findSofficePath(): Promise<string | null> {
        const envPath = process.env.SOFFICE_PATH;
        const candidates = [
            ...(envPath ? [envPath] : []),
            'soffice',
            '/Applications/LibreOffice.app/Contents/MacOS/soffice'
        ];

        for (const candidate of candidates) {
            try {
                await this.runProcess(candidate, ['--version']);
                return candidate;
            } catch {
                // Try next candidate.
            }
        }

        return null;
    }

    private static runProcess(command: string, args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';

            proc.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            proc.on('error', (err) => {
                reject(err);
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(stderr.trim() || `Process exited with code ${code}`));
                }
            });
        });
    }

    private static countPdfPages(pdfBuffer: Buffer): number {
        try {
            const text = pdfBuffer.toString('latin1');
            const matches = text.match(/\/Type\s*\/Page\b/g);
            return matches ? matches.length : 0;
        } catch {
            return 0;
        }
    }

    public static async readPptFile(filePath: string): Promise<{
        slides: Array<{
            slideNumber: number;
            widthPx: number;
            heightPx: number;
            backgroundColor: string;
            elements: Array<{
                type: 'text' | 'image';
                x: number;
                y: number;
                width: number;
                height: number;
                rotateDeg?: number;
                zIndex: number;
                isTitle?: boolean;
                paragraphs?: Array<{
                    text: string;
                    level: number;
                    align?: string;
                    fontSizePx?: number;
                    bold?: boolean;
                    italic?: boolean;
                    color?: string;
                }>;
                src?: string;
            }>;
        }>;
        totalSlides: number;
        fileSize: string;
    }> {
        try {
            const stats = await fs.promises.stat(filePath);
            const fileSizeBytes = stats.size;
            const MAX_PPT_FILE_SIZE = 50 * 1024 * 1024; // 50MB
            if (fileSizeBytes > MAX_PPT_FILE_SIZE) {
                throw new Error(
                    `File too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_PPT_FILE_SIZE / 1024 / 1024}MB.`
                );
            }

            const buffer = await fs.promises.readFile(filePath);
            const zip = await JSZip.loadAsync(buffer);
            const orderedSlidePaths = await this.getOrderedSlidePaths(zip);
            const slideSize = await this.getPresentationSize(zip);

            const slides: Array<{
                slideNumber: number;
                widthPx: number;
                heightPx: number;
                backgroundColor: string;
                elements: Array<{
                    type: 'text' | 'image';
                    x: number;
                    y: number;
                    width: number;
                    height: number;
                    rotateDeg?: number;
                    zIndex: number;
                    isTitle?: boolean;
                    paragraphs?: Array<{
                        text: string;
                        level: number;
                        align?: string;
                        fontSizePx?: number;
                        bold?: boolean;
                        italic?: boolean;
                        color?: string;
                    }>;
                    src?: string;
                }>;
            }> = [];
            for (let i = 0; i < orderedSlidePaths.length; i++) {
                const slidePath = orderedSlidePaths[i];
                const slideFile = zip.file(slidePath);
                if (!slideFile) {
                    continue;
                }

                const slideXml = await slideFile.async('text');
                const slideRels = await this.getSlideRelationships(zip, slidePath);
                const parsedSlide = await this.parseSlideXml(zip, slidePath, slideXml, slideRels);
                slides.push({
                    slideNumber: i + 1,
                    widthPx: slideSize.widthPx,
                    heightPx: slideSize.heightPx,
                    backgroundColor: parsedSlide.backgroundColor,
                    elements: parsedSlide.elements
                });
            }

            const fileSize = await this.getFileSize(filePath);
            return {
                slides,
                totalSlides: slides.length,
                fileSize
            };
        } catch (error) {
            console.error('Error reading PowerPoint file:', error);
            throw error;
        }
    }

    private static async getPresentationSize(zip: JSZip): Promise<{ widthPx: number; heightPx: number }> {
        const DEFAULT_WIDTH = 1280;
        const DEFAULT_HEIGHT = 720;
        const presentationFile = zip.file('ppt/presentation.xml');
        if (!presentationFile) {
            return { widthPx: DEFAULT_WIDTH, heightPx: DEFAULT_HEIGHT };
        }

        const presentationXml = await presentationFile.async('text');
        const sldSzTag = presentationXml.match(/<p:sldSz[^>]*\/?>/);
        if (!sldSzTag || !sldSzTag[0]) {
            return { widthPx: DEFAULT_WIDTH, heightPx: DEFAULT_HEIGHT };
        }

        const cx = Number(this.getAttrValue(sldSzTag[0], 'cx') || 0);
        const cy = Number(this.getAttrValue(sldSzTag[0], 'cy') || 0);
        if (!cx || !cy) {
            return { widthPx: DEFAULT_WIDTH, heightPx: DEFAULT_HEIGHT };
        }

        const widthPx = this.emuToPx(cx);
        const heightPx = this.emuToPx(cy);

        // Guard against malformed or mismatched unit parsing causing tiny canvases.
        if (widthPx < 300 || heightPx < 200) {
            return { widthPx: DEFAULT_WIDTH, heightPx: DEFAULT_HEIGHT };
        }

        return { widthPx, heightPx };
    }

    private static async getOrderedSlidePaths(zip: JSZip): Promise<string[]> {
        const presentationFile = zip.file('ppt/presentation.xml');
        const relsFile = zip.file('ppt/_rels/presentation.xml.rels');

        if (presentationFile && relsFile) {
            const presentationXml = await presentationFile.async('text');
            const relsXml = await relsFile.async('text');

            const relMap: Record<string, string> = {};
            const relRegex = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*>/g;
            let relMatch: RegExpExecArray | null;
            while ((relMatch = relRegex.exec(relsXml)) !== null) {
                const relId = relMatch[1];
                const target = relMatch[2];
                relMap[relId] = this.resolveZipTargetPath('ppt/presentation.xml', target);
            }

            const orderedPaths: string[] = [];
            const slideIdRegex = /<p:sldId[^>]*r:id="([^"]+)"[^>]*\/?>/g;
            let slideIdMatch: RegExpExecArray | null;
            while ((slideIdMatch = slideIdRegex.exec(presentationXml)) !== null) {
                const relId = slideIdMatch[1];
                const resolvedPath = relMap[relId];
                if (resolvedPath && zip.file(resolvedPath)) {
                    orderedPaths.push(resolvedPath);
                }
            }

            if (orderedPaths.length > 0) {
                return orderedPaths;
            }
        }

        const fallbackPaths = Object.keys(zip.files)
            .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
            .sort((a, b) => {
                const aNum = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
                const bNum = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
                return aNum - bNum;
            });

        return fallbackPaths;
    }

    private static async getSlideRelationships(
        zip: JSZip,
        slidePath: string
    ): Promise<Record<string, string>> {
        const fileName = slidePath.split('/').pop() || '';
        const relPath = `ppt/slides/_rels/${fileName}.rels`;
        const relFile = zip.file(relPath);
        if (!relFile) {
            return {};
        }

        const relXml = await relFile.async('text');
        const relMap: Record<string, string> = {};
        const relRegex = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*>/g;
        let relMatch: RegExpExecArray | null;
        while ((relMatch = relRegex.exec(relXml)) !== null) {
            relMap[relMatch[1]] = this.resolveZipTargetPath(slidePath, relMatch[2]);
        }
        return relMap;
    }

    private static async parseSlideXml(
        zip: JSZip,
        slidePath: string,
        slideXml: string,
        slideRels: Record<string, string>
    ): Promise<{
        backgroundColor: string;
        elements: Array<{
            type: 'text' | 'image';
            x: number;
            y: number;
            width: number;
            height: number;
            rotateDeg?: number;
            zIndex: number;
            isTitle?: boolean;
            paragraphs?: Array<{
                text: string;
                level: number;
                align?: string;
                fontSizePx?: number;
                bold?: boolean;
                italic?: boolean;
                color?: string;
            }>;
            src?: string;
        }>;
    }> {
        const elements: Array<{
            type: 'text' | 'image';
            x: number;
            y: number;
            width: number;
            height: number;
            rotateDeg?: number;
            zIndex: number;
            isTitle?: boolean;
            paragraphs?: Array<{
                text: string;
                level: number;
                align?: string;
                fontSizePx?: number;
                bold?: boolean;
                italic?: boolean;
                color?: string;
            }>;
            src?: string;
        }> = [];

        const backgroundColor = this.extractSlideBackgroundColor(slideXml) || '#ffffff';
        const shapeMatches = slideXml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) || [];
        for (let i = 0; i < shapeMatches.length; i++) {
            const shapeXml = shapeMatches[i];
            const geometry = this.extractGeometry(shapeXml);
            if (!geometry) {
                continue;
            }

            const isTitle = this.isTitleShape(shapeXml);
            const paragraphs = this.extractTextParagraphs(shapeXml);
            if (paragraphs.length === 0) {
                continue;
            }

            elements.push({
                type: 'text',
                x: this.emuToPx(geometry.x),
                y: this.emuToPx(geometry.y),
                width: this.emuToPx(geometry.cx),
                height: this.emuToPx(geometry.cy),
                rotateDeg: geometry.rotateDeg,
                zIndex: i,
                isTitle,
                paragraphs
            });
        }

        const pictureMatches = slideXml.match(/<p:pic\b[\s\S]*?<\/p:pic>/g) || [];
        for (let i = 0; i < pictureMatches.length; i++) {
            const pictureXml = pictureMatches[i];
            const geometry = this.extractGeometry(pictureXml);
            if (!geometry) {
                continue;
            }

            const embedIdMatch = pictureXml.match(/<a:blip[^>]*r:embed="([^"]+)"/);
            const embedId = embedIdMatch?.[1];
            if (!embedId) {
                continue;
            }

            const targetPath = slideRels[embedId];
            if (!targetPath) {
                continue;
            }

            const mediaFile = zip.file(targetPath);
            if (!mediaFile) {
                continue;
            }

            const base64 = await mediaFile.async('base64');
            const mimeType = this.getMimeTypeByExtension(targetPath);
            elements.push({
                type: 'image',
                x: this.emuToPx(geometry.x),
                y: this.emuToPx(geometry.y),
                width: this.emuToPx(geometry.cx),
                height: this.emuToPx(geometry.cy),
                rotateDeg: geometry.rotateDeg,
                zIndex: shapeMatches.length + i,
                src: `data:${mimeType};base64,${base64}`
            });
        }

        return {
            backgroundColor,
            elements
        };
    }

    private static extractSlideBackgroundColor(slideXml: string): string | undefined {
        const bgPr = slideXml.match(/<p:bgPr[\s\S]*?<\/p:bgPr>/);
        if (!bgPr || !bgPr[0]) {
            return undefined;
        }

        const srgb = bgPr[0].match(/<a:srgbClr[^>]*val="([^"]+)"/);
        if (srgb && srgb[1]) {
            return `#${srgb[1]}`;
        }

        const sysClr = bgPr[0].match(/<a:sysClr[^>]*lastClr="([^"]+)"/);
        if (sysClr && sysClr[1]) {
            return `#${sysClr[1]}`;
        }

        return undefined;
    }

    private static isTitleShape(shapeXml: string): boolean {
        const placeholderType = shapeXml.match(/<p:ph[^>]*type="([^"]+)"/)?.[1] || '';
        if (placeholderType === 'title' || placeholderType === 'ctrTitle') {
            return true;
        }

        const shapeName = shapeXml.match(/<p:cNvPr[^>]*name="([^"]+)"/)?.[1] || '';
        return /title/i.test(shapeName);
    }

    private static extractTextParagraphs(shapeXml: string): Array<{
        text: string;
        level: number;
        align?: string;
        fontSizePx?: number;
        bold?: boolean;
        italic?: boolean;
        color?: string;
    }> {
        const paragraphs: Array<{
            text: string;
            level: number;
            align?: string;
            fontSizePx?: number;
            bold?: boolean;
            italic?: boolean;
            color?: string;
        }> = [];

        const paragraphMatches = shapeXml.match(/<a:p[\s\S]*?<\/a:p>/g) || [];
        for (const paragraphXml of paragraphMatches) {
            const textParts: string[] = [];
            const textRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
            let textMatch: RegExpExecArray | null;
            while ((textMatch = textRegex.exec(paragraphXml)) !== null) {
                textParts.push(this.decodeXmlEntities(textMatch[1]));
            }

            const text = textParts.join('').trim();
            if (!text) {
                continue;
            }

            const pPr = paragraphXml.match(/<a:pPr[^>]*\/?>/)?.[0] || '';
            const rPr = paragraphXml.match(/<a:rPr[^>]*>/)?.[0]
                || paragraphXml.match(/<a:defRPr[^>]*\/?>/)?.[0]
                || '';
            const color = paragraphXml.match(/<a:srgbClr[^>]*val="([^"]+)"/)?.[1];

            const level = Number(this.getAttrValue(pPr, 'lvl') || 0);
            const align = this.getAttrValue(pPr, 'algn') || undefined;
            const fontSizeHundredthPt = Number(this.getAttrValue(rPr, 'sz') || 0);

            paragraphs.push({
                text,
                level: Number.isFinite(level) ? level : 0,
                align,
                fontSizePx: fontSizeHundredthPt > 0 ? Math.round((fontSizeHundredthPt / 100) * 1.333) : undefined,
                bold: this.getAttrValue(rPr, 'b') === '1',
                italic: this.getAttrValue(rPr, 'i') === '1',
                color: color ? `#${color}` : undefined
            });
        }

        return paragraphs;
    }

    private static extractGeometry(xmlBlock: string): { x: number; y: number; cx: number; cy: number; rotateDeg?: number } | null {
        const xfrmTag = xmlBlock.match(/<a:xfrm[^>]*>[\s\S]*?<\/a:xfrm>/)?.[0]
            || xmlBlock.match(/<a:xfrm[^>]*\/>/)?.[0]
            || '';
        if (!xfrmTag) {
            return null;
        }

        const offTag = xfrmTag.match(/<a:off[^>]*x=(?:"[^"]+"|'[^']+')(?=[^>]*y=(?:"[^"]+"|'[^']+'))[^>]*\/>/)?.[0] || '';
        const extTag = xfrmTag.match(/<a:ext[^>]*cx=(?:"[^"]+"|'[^']+')(?=[^>]*cy=(?:"[^"]+"|'[^']+'))[^>]*\/>/)?.[0] || '';

        const x = Number(this.getAttrValue(offTag, 'x') || 0);
        const y = Number(this.getAttrValue(offTag, 'y') || 0);
        const cx = Number(this.getAttrValue(extTag, 'cx') || 0);
        const cy = Number(this.getAttrValue(extTag, 'cy') || 0);
        if (!cx || !cy) {
            return null;
        }

        const rotRaw = Number(this.getAttrValue(xfrmTag, 'rot') || 0);
        return {
            x,
            y,
            cx,
            cy,
            rotateDeg: rotRaw ? rotRaw / 60000 : undefined
        };
    }

    private static getAttrValue(tag: string, attrName: string): string | undefined {
        if (!tag) {
            return undefined;
        }
        const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = tag.match(new RegExp(`${escaped}=(?:"([^"]+)"|'([^']+)')`));
        if (!match) {
            return undefined;
        }
        return match[1] || match[2];
    }

    private static resolveZipTargetPath(baseFilePath: string, target: string): string {
        if (!target) {
            return '';
        }
        if (target.startsWith('/')) {
            return target.replace(/^\/+/, '');
        }
        return path.posix.normalize(path.posix.join(path.posix.dirname(baseFilePath), target));
    }

    private static getMimeTypeByExtension(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const map: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.wmf': 'image/wmf',
            '.emf': 'image/emf'
        };
        return map[ext] || 'application/octet-stream';
    }

    private static emuToPx(emu: number): number {
        return Math.round(emu / 9525);
    }

    private static decodeXmlEntities(input: string): string {
        return input
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#xD;/gi, '')
            .replace(/&#xA;/gi, ' ')
            .replace(/&#10;/g, ' ');
    }

    public static async readHwpFile(filePath: string): Promise<{
        base64: string;
        fileSize: string;
    }> {
        try {
            console.log('[HWP] Reading file:', filePath);
            const buffer = await fs.promises.readFile(filePath);
            console.log('[HWP] File buffer size:', buffer.length);
            
            const fileSize = await this.getFileSize(filePath);
            console.log('[HWP] File size:', fileSize);

            // hwp.js's browser Viewer preserves page layout much better than a
            // handcrafted HTML conversion, so pass the raw document bytes through.
            const base64 = buffer.toString('base64');
            console.log('[HWP] Encoded base64 length:', base64.length);

            return {
                base64,
                fileSize
            };
        } catch (error) {
            console.error('[HWP] Error reading HWP file:', error);
            throw error;
        }
    }
}
