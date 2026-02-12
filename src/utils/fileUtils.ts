import * as path from 'path';
import * as fs from 'fs';
import * as mm from 'music-metadata';
import { parquetReadObjects, parquetSchema, parquetMetadataAsync } from 'hyparquet';
import { parse as parseHwp } from 'hwp.js';
import * as XLSX from 'xlsx';

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
