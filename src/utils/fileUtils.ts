import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as mm from 'music-metadata';
import { spawn } from 'child_process';
import { parquetReadObjects, parquetSchema, parquetMetadataAsync } from 'hyparquet';
import { parse as parseHwp } from 'hwp.js';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { PptxXmlParser } from './pptxXmlParser';
import { PptBinaryParser } from './pptBinaryParser';
import { DocBinaryParser } from './docBinaryParser';

export class FileUtils {
    private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024;
    private static readonly DEFAULT_DELIMITER = ',';

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
        delimiter: string;
    }> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim() !== '');
            const delimiter = this.getDelimitedFileDelimiter(filePath);
            
            if (lines.length === 0) {
                throw new Error('CSV file is empty');
            }

            const rows: string[][] = [];
            for (const line of lines) {
                const row = this.parseDelimitedLine(line, delimiter);
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
                fileSize,
                delimiter
            };
        } catch (error) {
            console.error('Error reading CSV file:', error);
            throw error;
        }
    }

    public static getDelimitedFileDelimiter(filePath: string): string {
        return path.extname(filePath).toLowerCase() === '.tsv' ? '\t' : this.DEFAULT_DELIMITER;
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
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim() !== '');
            
            const parsedLines: Array<{ lineNumber: number; content: string; parsedJson?: any; isValid: boolean }> = [];
            let validLines = 0;
            let invalidLines = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line === '') continue;

                try {
                    const parsedJson = JSON.parse(line);
                    parsedLines.push({
                        lineNumber: i + 1,
                        content: line,
                        parsedJson,
                        isValid: true
                    });
                    validLines++;
                } catch (error) {
                    parsedLines.push({
                        lineNumber: i + 1,
                        content: line,
                        isValid: false
                    });
                    invalidLines++;
                }
            }

            const fileSize = await this.getFileSize(filePath);

            return {
                lines: parsedLines,
                totalLines: parsedLines.length,
                validLines,
                invalidLines,
                fileSize
            };
        } catch (error) {
            console.error('Error reading JSONL file:', error);
            throw error;
        }
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
        try {
            // Check file size first before reading
            const stats = await fs.promises.stat(filePath);
            const fileSizeBytes = stats.size;
            const fileSizeMB = fileSizeBytes / (1024 * 1024);
            
            const MAX_FILE_SIZE_MB = 50;
            const MAX_ALLOWED_SIZE_MB = 150;
            const MAX_ROWS_LIMIT = 10000;
            
            // Reject files larger than 150MB
            if (fileSizeMB >= MAX_ALLOWED_SIZE_MB) {
                throw new Error(`File size (${fileSizeMB.toFixed(1)}MB) exceeds the maximum allowed size of ${MAX_ALLOWED_SIZE_MB}MB. Cannot open this file.`);
            }
            
            const buffer = await fs.promises.readFile(filePath);
            
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

            // Create an async buffer wrapper
            const asyncBuffer = {
                async slice(start: number, end: number): Promise<ArrayBuffer> {
                    const sliced = arrayBuffer.slice(start, end);
                    return sliced instanceof ArrayBuffer ? sliced : new ArrayBuffer(0);
                },
                byteLength: arrayBuffer.byteLength
            };

            // Read schema first
            let schema: any = null;
            let metadata: any = null;
            let actualTotalRows: number | undefined = undefined;
            try {
                schema = await parquetSchema(asyncBuffer as any);
                console.log('Parquet schema loaded:', schema ? 'success' : 'null');
                
                // Get metadata to find total row count
                metadata = await parquetMetadataAsync(asyncBuffer as any);
                if (metadata && metadata.num_rows) {
                    actualTotalRows = Number(metadata.num_rows);
                }
            } catch (schemaError) {
                console.warn('Failed to read schema, will try to extract from data:', schemaError);
                // Schema is optional, we can continue without it
            }

            // Check if file is between 50MB and 150MB, apply row limit
            // Files < 50MB: show all rows
            // Files 50MB-150MB: show first 10,000 rows only
            // Files >= 150MB: already rejected above
            const isLimited = fileSizeMB >= MAX_FILE_SIZE_MB && fileSizeMB < MAX_ALLOWED_SIZE_MB;
            const readOptions: any = {
                file: asyncBuffer as any
            };
            
            if (isLimited) {
                readOptions.rowStart = 0;
                readOptions.rowEnd = MAX_ROWS_LIMIT;
                console.log(`File size (${fileSizeMB.toFixed(2)}MB) is between ${MAX_FILE_SIZE_MB}MB and ${MAX_ALLOWED_SIZE_MB}MB. Reading only first ${MAX_ROWS_LIMIT} rows.`);
            }

            // Read data as objects
            let dataObjects: any[] = [];
            try {
                const result: any = await parquetReadObjects(readOptions);
                console.log('parquetReadObjects result type:', typeof result);
                console.log('parquetReadObjects result is array:', Array.isArray(result));
                console.log('parquetReadObjects result:', result);
                
                // parquetReadObjects should return an array directly
                if (Array.isArray(result)) {
                    dataObjects = result;
                } else if (result && typeof result === 'object') {
                    // If it's an object, try to find array property
                    console.warn('parquetReadObjects returned non-array, trying to find data...');
                    if (Array.isArray(result.data)) {
                        dataObjects = result.data;
                    } else if (Array.isArray(result.rows)) {
                        dataObjects = result.rows;
                    } else {
                        throw new Error('parquetReadObjects returned unexpected format');
                    }
                } else {
                    throw new Error('parquetReadObjects returned unexpected type');
                }
                
                console.log('Parquet data objects count:', dataObjects.length);
                if (dataObjects.length > 0) {
                    console.log('First object:', dataObjects[0]);
                    console.log('First object keys:', Object.keys(dataObjects[0]));
                } else {
                    console.warn('No data objects found in Parquet file');
                }
            } catch (readError) {
                console.error('Failed to read Parquet data:', readError);
                console.error('Error stack:', readError instanceof Error ? readError.stack : 'No stack');
                throw new Error(`Failed to read Parquet file: ${readError instanceof Error ? readError.message : String(readError)}`);
            }

            // Get column names from first row (most reliable)
            const headers: string[] = [];
            if (dataObjects && dataObjects.length > 0 && dataObjects[0]) {
                headers.push(...Object.keys(dataObjects[0]));
            } else if (schema) {
                // If no data, try to extract from schema tree recursively
                const extractColumnNames = (schemaTree: any): string[] => {
                    if (!schemaTree) return [];
                    
                    const names: string[] = [];
                    const hasChildren = schemaTree.children && Array.isArray(schemaTree.children) && schemaTree.children.length > 0;
                    
                    if (schemaTree.element && schemaTree.element.name && !hasChildren) {
                        // Leaf node - this is a column
                        if (schemaTree.path && Array.isArray(schemaTree.path) && schemaTree.path.length > 0) {
                            names.push(schemaTree.path.join('.'));
                        } else if (schemaTree.element.name) {
                            names.push(schemaTree.element.name);
                        }
                    }
                    
                    if (hasChildren) {
                        schemaTree.children.forEach((child: any) => {
                            names.push(...extractColumnNames(child));
                        });
                    }
                    return names;
                };
                const extractedHeaders = extractColumnNames(schema);
                if (extractedHeaders.length > 0) {
                    headers.push(...extractedHeaders);
                }
            }
            
            if (headers.length === 0) {
                throw new Error('Could not extract column names from Parquet file. The file may be empty or corrupted.');
            }

            // Convert BigInt to string/number for JSON serialization
            const convertBigInt = (value: any): any => {
                if (typeof value === 'bigint') {
                    // Convert BigInt to string (can also use Number() if value is small enough)
                    return value.toString();
                } else if (Array.isArray(value)) {
                    return value.map(convertBigInt);
                } else if (value && typeof value === 'object') {
                    const converted: any = {};
                    for (const key in value) {
                        converted[key] = convertBigInt(value[key]);
                    }
                    return converted;
                }
                return value;
            };

            // Convert data objects to rows format
            const rows: any[][] = [];
            if (Array.isArray(dataObjects)) {
                dataObjects.forEach((row: any) => {
                    if (row && typeof row === 'object') {
                        const convertedRow = convertBigInt(row);
                        const rowArray: any[] = [];
                        headers.forEach(header => {
                            rowArray.push(convertedRow[header] !== undefined ? convertedRow[header] : null);
                        });
                        rows.push(rowArray);
                    }
                });
            } else {
                console.warn('dataObjects is not an array:', typeof dataObjects);
            }

            // Get file size
            const fileSize = await this.getFileSize(filePath);

            // Convert schema to JSON-serializable format (remove BigInt)
            const serializableSchema = schema ? convertBigInt(schema) : {};

            // Prepare limit message if file was limited
            let limitMessage: string | undefined = undefined;
            if (isLimited) {
                const totalRowsDisplay = actualTotalRows !== undefined ? actualTotalRows.toLocaleString() : 'all';
                limitMessage = `File size (${fileSizeMB.toFixed(1)}MB) exceeds 50MB limit. Showing only the first 10,000 rows. (Total rows: ${totalRowsDisplay})`;
            }

            console.log('Parquet file read successfully:', {
                headers: headers.length,
                rows: rows.length,
                fileSize,
                isLimited,
                actualTotalRows
            });

            return {
                headers,
                rows,
                totalRows: rows.length,
                totalColumns: headers.length,
                fileSize,
                schema: serializableSchema,
                isLimited,
                limitMessage,
                actualTotalRows
            };
        } catch (error) {
            console.error('Error reading Parquet file:', error);
            throw error;
        }
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
        try {
            const stats = await fs.promises.stat(filePath);
            const fileSizeBytes = stats.size;
            const MAX_EXCEL_FILE_SIZE = 50 * 1024 * 1024; // 50MB
            if (fileSizeBytes > MAX_EXCEL_FILE_SIZE) {
                throw new Error(
                    `File too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_EXCEL_FILE_SIZE / 1024 / 1024}MB.`
                );
            }

            const buffer = await fs.promises.readFile(filePath);
            const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
            const sheetNames = workbook.SheetNames || [];
            const sheets: Array<{
                name: string;
                headers: string[];
                rows: any[][];
                totalRows: number;
                totalColumns: number;
            }> = [];

            for (const name of sheetNames) {
                const worksheet = workbook.Sheets[name];
                if (!worksheet) continue;
                const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
                    header: 1,
                    defval: '',
                    raw: false
                });
                if (!rawRows || rawRows.length === 0) {
                    sheets.push({
                        name,
                        headers: [],
                        rows: [],
                        totalRows: 0,
                        totalColumns: 0
                    });
                    continue;
                }
                const headers = (rawRows[0] || []).map((c: any) =>
                    c === null || c === undefined ? '' : String(c)
                );
                const dataRows = rawRows.slice(1).map((row: any[]) =>
                    (Array.isArray(row) ? row : []).map((cell: any) => {
                        if (cell === null || cell === undefined) return '';
                        if (typeof cell === 'object' && cell instanceof Date) return cell.toISOString();
                        return cell;
                    })
                );
                const maxCols = Math.max(
                    headers.length,
                    ...dataRows.map((r: any[]) => r.length)
                );
                const normalizedHeaders =
                    maxCols > headers.length
                        ? [...headers, ...Array(maxCols - headers.length).fill('')]
                        : headers;
                const normalizedRows = dataRows.map((r: any[]) =>
                    r.length < maxCols ? [...r, ...Array(maxCols - r.length).fill('')] : r
                );
                sheets.push({
                    name,
                    headers: normalizedHeaders,
                    rows: normalizedRows,
                    totalRows: normalizedRows.length,
                    totalColumns: normalizedHeaders.length
                });
            }

            const fileSize = await this.getFileSize(filePath);
            return {
                sheetNames,
                sheets,
                fileSize
            };
        } catch (error) {
            console.error('Error reading Excel file:', error);
            throw error;
        }
    }

    public static async readWordFile(filePath: string): Promise<{
        renderer: 'docx-preview' | 'legacy-html';
        docxBase64?: string;
        htmlContent?: string;
        sourceFormat: 'docx' | 'doc';
        wasConverted: boolean;
        fileSize: string;
    }> {
        try {
            const stats = await fs.promises.stat(filePath);
            const fileSizeBytes = stats.size;
            const MAX_WORD_FILE_SIZE = 50 * 1024 * 1024; // 50MB
            if (fileSizeBytes > MAX_WORD_FILE_SIZE) {
                throw new Error(
                    `File too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_WORD_FILE_SIZE / 1024 / 1024}MB.`
                );
            }

            const ext = path.extname(filePath).toLowerCase();
            let docxBuffer: Buffer;
            let sourceFormat: 'docx' | 'doc';
            let wasConverted = false;

            if (ext === '.docx') {
                docxBuffer = await fs.promises.readFile(filePath);
                sourceFormat = 'docx';
            } else if (ext === '.doc') {
                sourceFormat = 'doc';
                try {
                    const htmlContent = await DocBinaryParser.parseToHtml(filePath);
                    const fileSize = await this.getFileSize(filePath);
                    return {
                        renderer: 'legacy-html',
                        htmlContent,
                        sourceFormat,
                        wasConverted: false,
                        fileSize
                    };
                } catch (standaloneError) {
                    console.warn('[WORD] Standalone .doc parser failed, trying soffice fallback:', standaloneError);
                }

                docxBuffer = await this.convertLegacyWordToDocx(filePath);
                wasConverted = true;
            } else {
                throw new Error(`Unsupported Word format: ${ext || 'unknown'}`);
            }

            const fileSize = await this.getFileSize(filePath);
            return {
                renderer: 'docx-preview',
                docxBase64: docxBuffer.toString('base64'),
                sourceFormat,
                wasConverted,
                fileSize
            };
        } catch (error) {
            console.error('Error reading Word file:', error);
            throw error;
        }
    }

    private static async convertLegacyWordToDocx(filePath: string): Promise<Buffer> {
        const sofficePath = await this.findSofficePath();
        if (!sofficePath) {
            throw new Error(
                'LibreOffice (soffice) is required to open .doc files. Please install LibreOffice and ensure "soffice" is available in PATH.'
            );
        }

        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'omni-viewer-doc-'));
        try {
            await this.runProcess(sofficePath, [
                '--headless',
                '--convert-to',
                'docx',
                '--outdir',
                tempDir,
                filePath
            ]);

            const expectedDocx = path.join(tempDir, `${path.parse(filePath).name}.docx`);
            let docxPath = expectedDocx;
            if (!fs.existsSync(docxPath)) {
                const convertedFiles = await fs.promises.readdir(tempDir);
                const anyDocx = convertedFiles.find((name) => name.toLowerCase().endsWith('.docx'));
                if (!anyDocx) {
                    throw new Error('.doc conversion succeeded but no .docx output was found.');
                }
                docxPath = path.join(tempDir, anyDocx);
            }

            return await fs.promises.readFile(docxPath);
        } finally {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
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
        html: string;
        fileSize: string;
    }> {
        try {
            console.log('[HWP] Reading file:', filePath);
            const buffer = await fs.promises.readFile(filePath);
            console.log('[HWP] File buffer size:', buffer.length);
            
            const fileSize = await this.getFileSize(filePath);
            console.log('[HWP] File size:', fileSize);
            
            // Convert Buffer to Uint8Array for hwp.js
            const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            
            // Parse HWP document using hwp.js
            // type: 'buffer' tells cfb to parse the binary data directly
            console.log('[HWP] Parsing HWP document...');
            const hwpDocument = parseHwp(uint8Array, { type: 'buffer' });
            console.log('[HWP] HWP document parsed:', hwpDocument ? 'success' : 'null');
            console.log('[HWP] Sections count:', hwpDocument?.sections?.length || 0);
            
            // Convert to HTML
            console.log('[HWP] Converting to HTML...');
            const html = this.hwpToHtml(hwpDocument);
            console.log('[HWP] HTML generated, length:', html?.length || 0);
            
            // Ensure html is a string
            const safeHtml = typeof html === 'string' ? html : String(html || '');
            
            return {
                html: safeHtml,
                fileSize
            };
        } catch (error) {
            console.error('[HWP] Error reading HWP file:', error);
            throw error;
        }
    }

    private static hwpToHtml(hwpDocument: any): string {
        const sections: string[] = [];
        
        if (!hwpDocument.sections || hwpDocument.sections.length === 0) {
            return '<p>문서 내용이 없습니다.</p>';
        }

        for (const section of hwpDocument.sections) {
            const sectionHtml = this.sectionToHtml(section);
            sections.push(sectionHtml);
        }

        return sections.join('<hr class="section-divider">');
    }

    private static sectionToHtml(section: any): string {
        const paragraphs: string[] = [];
        
        if (!section.content || section.content.length === 0) {
            return '';
        }

        for (const paragraph of section.content) {
            const paragraphHtml = this.paragraphToHtml(paragraph);
            if (paragraphHtml.trim()) {
                paragraphs.push(paragraphHtml);
            }
        }

        return paragraphs.join('\n');
    }

    private static paragraphToHtml(paragraph: any): string {
        if (!paragraph.content || paragraph.content.length === 0) {
            return '<p>&nbsp;</p>';
        }

        let text = '';
        
        for (const char of paragraph.content) {
            try {
                // CharType.Char = 0
                if (char.type === 0) {
                    if (typeof char.value === 'string') {
                        text += this.escapeHtml(char.value);
                    } else if (typeof char.value === 'number') {
                        // Special characters
                        if (char.value === 10 || char.value === 13) {
                            // Line break
                            text += '<br>';
                        } else if (char.value === 9) {
                            // Tab
                            text += '&emsp;';
                        } else if (char.value >= 32 && char.value < 65536) {
                            text += this.escapeHtml(String.fromCharCode(char.value));
                        }
                    }
                }
            } catch (e) {
                // Skip problematic characters
                console.warn('Error processing char:', char, e);
            }
        }

        if (!text.trim()) {
            return '<p>&nbsp;</p>';
        }

        return `<p>${text}</p>`;
    }

    private static escapeHtml(input: any): string {
        if (input === null || input === undefined) {
            return '';
        }
        const str = String(input);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
