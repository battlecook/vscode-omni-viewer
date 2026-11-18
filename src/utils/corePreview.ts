import * as fs from 'fs';
import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export type CorePreviewKind = 'font' | 'arrow' | 'geojson' | 'text' | 'dicom' | 'junit' | 'openapi' | 'eml' | 'mcap' | 'mesh'
    | 'sarif' | 'gps' | 'trace' | 'sbom' | 'msg' | 'drawio' | 'opendocument';
interface CorePreviewConfig {
    title: string;
    maxBytes: number;
    clipboard?: boolean;
    clipboardMaxBytes?: number;
    save?: 'json' | 'attachment';
    documentAssets?: boolean;
    nestedParse?: boolean;
}

/** Host admission limits, at or below each published core parser's budget. */
export const CORE_PREVIEW_VIEWERS: Record<CorePreviewKind, CorePreviewConfig> = {
    font: { title: 'Font', maxBytes: 64 * 1024 * 1024 },
    arrow: { title: 'Arrow IPC / Feather V2', maxBytes: 256 * 1024 * 1024, clipboard: true, save: 'json', nestedParse: true },
    geojson: { title: 'GeoJSON', maxBytes: 128 * 1024 * 1024 },
    text: { title: 'Text', maxBytes: 64 * 1024 * 1024, nestedParse: true },
    dicom: { title: 'DICOM', maxBytes: 256 * 1024 * 1024 },
    // Copy Source sends the full decoded XML. A legacy single-byte input
    // can occupy three times as many bytes after UTF-8 encoding.
    junit: { title: 'JUnit XML', maxBytes: 64 * 1024 * 1024, clipboard: true, clipboardMaxBytes: 192 * 1024 * 1024, nestedParse: true },
    // Core caps operation JSON at 10 Mi UTF-16 code units, not UTF-8 bytes.
    openapi: { title: 'OpenAPI / Swagger', maxBytes: 10 * 1024 * 1024, clipboard: true, clipboardMaxBytes: 30 * 1024 * 1024 },
    eml: { title: 'EML', maxBytes: 32 * 1024 * 1024, clipboard: true, save: 'attachment' },
    mcap: { title: 'MCAP', maxBytes: 256 * 1024 * 1024, clipboard: true, nestedParse: true },
    mesh: { title: '3D Model', maxBytes: 128 * 1024 * 1024, documentAssets: true },
    // File previews share the core's 32 MiB input budget; the trace parser
    // allows 64 MiB and XML-only formats stop at the 16 MiB XML budget.
    sarif: { title: 'SARIF', maxBytes: 32 * 1024 * 1024 },
    gps: { title: 'GPS Track', maxBytes: 32 * 1024 * 1024 },
    trace: { title: 'Chrome Trace', maxBytes: 64 * 1024 * 1024 },
    sbom: { title: 'CycloneDX SBOM', maxBytes: 32 * 1024 * 1024 },
    msg: { title: 'Outlook MSG', maxBytes: 32 * 1024 * 1024, save: 'attachment' },
    drawio: { title: 'draw.io', maxBytes: 16 * 1024 * 1024 },
    opendocument: { title: 'OpenDocument', maxBytes: 32 * 1024 * 1024 }
};
const UTF8_ONLY_KINDS = new Set<CorePreviewKind>(['openapi', 'sarif', 'sbom', 'trace']);

export async function assertCorePreviewSize(filePath: string, kind: CorePreviewKind): Promise<void> {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > CORE_PREVIEW_VIEWERS[kind].maxBytes) {
        throw new Error(`The file exceeds the ${CORE_PREVIEW_VIEWERS[kind].maxBytes / 1024 / 1024} MiB ${CORE_PREVIEW_VIEWERS[kind].title} viewer limit.`);
    }
}

/** Read at most the admitted size plus one byte, even if the file grows. */
export async function readBoundedPreviewFile(filePath: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    const check = () => { if (signal?.aborted) throw new Error('Viewer loading was cancelled.'); };
    check();
    const file = await fs.promises.open(filePath, 'r');
    try {
        const { size } = await file.stat();
        check();
        if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) throw new Error(`The file exceeds the ${maxBytes / 1024 / 1024} MiB viewer limit.`);
        const buffer = Buffer.alloc(size + 1);
        let offset = 0;
        while (offset < buffer.length) {
            check();
            const { bytesRead } = await file.read(buffer, offset, Math.min(buffer.length - offset, 1024 * 1024), offset);
            if (!bytesRead) break;
            offset += bytesRead;
        }
        check();
        if (offset > size) throw new Error('The file changed while reading. Refresh the viewer to try again.');
        return new Uint8Array(buffer.buffer, buffer.byteOffset, offset);
    } finally {
        await file.close();
    }
}

export async function readCorePreview(filePath: string, kind: CorePreviewKind, signal?: AbortSignal): Promise<Uint8Array> {
    const data = await readBoundedPreviewFile(filePath, CORE_PREVIEW_VIEWERS[kind].maxBytes, signal);
    // The JSON detectors recognize BOM-aware UTF-16, while the core's OpenAPI,
    // SARIF, SBOM and Trace parsers accept UTF-8. Preserve the decoded source characters.
    if (UTF8_ONLY_KINDS.has(kind) && (data[0] === 0xff && data[1] === 0xfe || data[0] === 0xfe && data[1] === 0xff)) {
        const encoding = data[0] === 0xff ? 'utf-16le' : 'utf-16be';
        return new Uint8Array(Buffer.from(new TextDecoder(encoding).decode(data), 'utf8'));
    }
    return data;
}

export function createCorePreviewVariables(fileName: string, locale: string, cspSource: string, scriptUri: string, kind: CorePreviewKind): Record<string, string> {
    return {
        fileName: escapeHtml(fileName),
        viewerTitle: escapeHtml(CORE_PREVIEW_VIEWERS[kind].title),
        cspNonce: randomBytes(16).toString('hex'),
        cspSource: escapeHtml(cspSource),
        viewerScriptUri: escapeHtml(scriptUri),
        previewData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, kind, ...CORE_PREVIEW_VIEWERS[kind] }))
    };
}
