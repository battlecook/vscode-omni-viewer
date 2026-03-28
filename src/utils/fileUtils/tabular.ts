import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { getFileSize } from './media';

const DEFAULT_DELIMITER = ',';

export async function readCsvFile(filePath: string): Promise<{
    headers: string[];
    rows: string[][];
    totalRows: number;
    totalColumns: number;
    fileSize: string;
    delimiter: string;
}> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim() !== '');
    const delimiter = getDelimitedFileDelimiter(filePath, lines);

    if (lines.length === 0) {
        throw new Error('CSV file is empty');
    }

    const rows = lines.map((line) => parseDelimitedLine(line, delimiter));
    const headers = rows[0] || [];
    const dataRows = rows.slice(1);

    return {
        headers,
        rows: dataRows,
        totalRows: dataRows.length,
        totalColumns: headers.length,
        fileSize: await getFileSize(filePath),
        delimiter
    };
}

export function getDelimitedFileDelimiter(filePath: string, lines: string[] = []): string {
    if (path.extname(filePath).toLowerCase() === '.tsv') {
        return '\t';
    }

    return detectDelimiter(lines) ?? DEFAULT_DELIMITER;
}

export async function readJsonlFile(filePath: string): Promise<{
    lines: Array<{ lineNumber: number; content: string; parsedJson?: any; isValid: boolean }>;
    totalLines: number;
    validLines: number;
    invalidLines: number;
    fileSize: string;
}> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim() !== '');
    const parsedLines: Array<{ lineNumber: number; content: string; parsedJson?: any; isValid: boolean }> = [];
    let validLines = 0;
    let invalidLines = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            continue;
        }

        try {
            parsedLines.push({
                lineNumber: i + 1,
                content: line,
                parsedJson: JSON.parse(line),
                isValid: true
            });
            validLines++;
        } catch {
            parsedLines.push({
                lineNumber: i + 1,
                content: line,
                isValid: false
            });
            invalidLines++;
        }
    }

    return {
        lines: parsedLines,
        totalLines: parsedLines.length,
        validLines,
        invalidLines,
        fileSize: await getFileSize(filePath)
    };
}

export async function readParquetFile(filePath: string): Promise<{
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
    const stats = await fs.promises.stat(filePath);
    const fileSizeBytes = stats.size;
    const fileSizeMB = fileSizeBytes / (1024 * 1024);
    const maxFileSizeMB = 50;
    const maxAllowedSizeMB = 150;
    const maxRowsLimit = 10000;

    if (fileSizeMB >= maxAllowedSizeMB) {
        throw new Error(`File size (${fileSizeMB.toFixed(1)}MB) exceeds the maximum allowed size of ${maxAllowedSizeMB}MB. Cannot open this file.`);
    }

    const buffer = await fs.promises.readFile(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const asyncBuffer = {
        async slice(start: number, end: number): Promise<ArrayBuffer> {
            const sliced = arrayBuffer.slice(start, end);
            return sliced instanceof ArrayBuffer ? sliced : new ArrayBuffer(0);
        },
        byteLength: arrayBuffer.byteLength
    };

    const { parquetMetadataAsync, parquetReadObjects, parquetSchema } = await import('hyparquet');

    let schema: any = null;
    let metadata: any = null;
    let actualTotalRows: number | undefined;
    try {
        schema = await parquetSchema(asyncBuffer as any);
        metadata = await parquetMetadataAsync(asyncBuffer as any);
        if (metadata && metadata.num_rows) {
            actualTotalRows = Number(metadata.num_rows);
        }
    } catch {
        schema = null;
    }

    const isLimited = fileSizeMB >= maxFileSizeMB && fileSizeMB < maxAllowedSizeMB;
    const readOptions: any = { file: asyncBuffer as any };
    if (isLimited) {
        readOptions.rowStart = 0;
        readOptions.rowEnd = maxRowsLimit;
    }

    const result = await parquetReadObjects(readOptions);
    const dataObjects = Array.isArray(result)
        ? result
        : Array.isArray((result as any)?.data)
            ? (result as any).data
            : Array.isArray((result as any)?.rows)
                ? (result as any).rows
                : [];

    const headers: string[] = [];
    if (dataObjects.length > 0 && dataObjects[0]) {
        headers.push(...Object.keys(dataObjects[0]));
    } else if (schema) {
        headers.push(...extractColumnNames(schema));
    }

    if (headers.length === 0) {
        throw new Error('Could not extract column names from Parquet file. The file may be empty or corrupted.');
    }

    const serializableSchema = schema ? convertBigInt(schema) : {};
    const rows = dataObjects
        .filter((row: any) => row && typeof row === 'object')
        .map((row: any) => {
            const convertedRow = convertBigInt(row);
            return headers.map((header) => convertedRow[header] !== undefined ? convertedRow[header] : null);
        });

    return {
        headers,
        rows,
        totalRows: rows.length,
        totalColumns: headers.length,
        fileSize: await getFileSize(filePath),
        schema: serializableSchema,
        isLimited,
        limitMessage: isLimited
            ? `File size (${fileSizeMB.toFixed(1)}MB) exceeds 50MB limit. Showing only the first 10,000 rows. (Total rows: ${(actualTotalRows ?? 'all').toString()})`
            : undefined,
        actualTotalRows
    };
}

export async function readExcelFile(filePath: string): Promise<{
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
    const stats = await fs.promises.stat(filePath);
    const fileSizeBytes = stats.size;
    const maxExcelFileSize = 50 * 1024 * 1024;
    if (fileSizeBytes > maxExcelFileSize) {
        throw new Error(`File too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum size is ${maxExcelFileSize / 1024 / 1024}MB.`);
    }

    const buffer = await fs.promises.readFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetNames = workbook.SheetNames || [];
    const sheets = sheetNames.map((name) => buildSheetSummary(name, workbook.Sheets[name]));

    return {
        sheetNames,
        sheets,
        fileSize: await getFileSize(filePath)
    };
}

function buildSheetSummary(name: string, worksheet: XLSX.WorkSheet | undefined) {
    if (!worksheet) {
        return { name, headers: [], rows: [], totalRows: 0, totalColumns: 0 };
    }

    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
        raw: false
    });

    if (!rawRows || rawRows.length === 0) {
        return { name, headers: [], rows: [], totalRows: 0, totalColumns: 0 };
    }

    const headers = (rawRows[0] || []).map((cell: any) => cell === null || cell === undefined ? '' : String(cell));
    const dataRows = rawRows.slice(1).map((row: any[]) =>
        (Array.isArray(row) ? row : []).map((cell: any) => {
            if (cell === null || cell === undefined) return '';
            if (typeof cell === 'object' && cell instanceof Date) return cell.toISOString();
            return cell;
        })
    );

    const maxCols = Math.max(headers.length, ...dataRows.map((row) => row.length));
    const normalizedHeaders = maxCols > headers.length
        ? [...headers, ...Array(maxCols - headers.length).fill('')]
        : headers;
    const normalizedRows = dataRows.map((row) =>
        row.length < maxCols ? [...row, ...Array(maxCols - row.length).fill('')] : row
    );

    return {
        name,
        headers: normalizedHeaders,
        rows: normalizedRows,
        totalRows: normalizedRows.length,
        totalColumns: normalizedHeaders.length
    };
}

function detectDelimiter(lines: string[]): string | null {
    const sampleLines = lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 10);

    if (sampleLines.length === 0) {
        return null;
    }

    const candidates = [',', ';', '\t', '|'];
    let bestDelimiter: string | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
        const counts = sampleLines.map((line) => countDelimiterOccurrences(line, candidate));
        const positiveCounts = counts.filter((count) => count > 0);
        if (positiveCounts.length === 0) {
            continue;
        }

        const score = positiveCounts.length * 100 + positiveCounts.reduce((sum, count) => sum + count, 0);
        if (score > bestScore) {
            bestScore = score;
            bestDelimiter = candidate;
        }
    }

    return bestDelimiter;
}

function countDelimiterOccurrences(line: string, delimiter: string): number {
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

function parseDelimitedLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

function convertBigInt(value: any): any {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (Array.isArray(value)) {
        return value.map(convertBigInt);
    }
    if (value && typeof value === 'object') {
        const converted: any = {};
        for (const key in value) {
            converted[key] = convertBigInt(value[key]);
        }
        return converted;
    }
    return value;
}

function extractColumnNames(schemaTree: any): string[] {
    if (!schemaTree) {
        return [];
    }

    const names: string[] = [];
    const hasChildren = Array.isArray(schemaTree.children) && schemaTree.children.length > 0;
    if (schemaTree.element && schemaTree.element.name && !hasChildren) {
        if (Array.isArray(schemaTree.path) && schemaTree.path.length > 0) {
            names.push(schemaTree.path.join('.'));
        } else {
            names.push(schemaTree.element.name);
        }
    }

    if (hasChildren) {
        schemaTree.children.forEach((child: any) => names.push(...extractColumnNames(child)));
    }

    return names;
}
