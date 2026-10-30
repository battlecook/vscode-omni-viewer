import * as fs from 'fs';
import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

/** Match the published core parsers' input budgets. */
export const CORE_PREVIEW_VIEWERS = {
    font: { title: 'Font', maxBytes: 64 * 1024 * 1024 },
    arrow: { title: 'Arrow IPC / Feather V2', maxBytes: 256 * 1024 * 1024 },
    geojson: { title: 'GeoJSON', maxBytes: 128 * 1024 * 1024 }
} as const;
export type CorePreviewKind = keyof typeof CORE_PREVIEW_VIEWERS;

export async function assertCorePreviewSize(filePath: string, kind: CorePreviewKind): Promise<void> {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > CORE_PREVIEW_VIEWERS[kind].maxBytes) {
        throw new Error(`The file exceeds the ${CORE_PREVIEW_VIEWERS[kind].maxBytes / 1024 / 1024} MiB ${CORE_PREVIEW_VIEWERS[kind].title} viewer limit.`);
    }
}

/** Read at most the admitted size plus one byte, even if the file grows. */
export async function readCorePreview(filePath: string, kind: CorePreviewKind): Promise<Uint8Array> {
    const file = await fs.promises.open(filePath, 'r');
    try {
        const { size } = await file.stat();
        const config = CORE_PREVIEW_VIEWERS[kind];
        if (size > config.maxBytes) {
            throw new Error(`The file exceeds the ${config.maxBytes / 1024 / 1024} MiB ${config.title} viewer limit.`);
        }
        const buffer = Buffer.alloc(size + 1);
        let offset = 0;
        while (offset < buffer.length) {
            const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
            if (!bytesRead) break;
            offset += bytesRead;
        }
        if (offset > size) throw new Error('The file changed while reading. Refresh the viewer to try again.');
        return new Uint8Array(buffer.buffer, buffer.byteOffset, offset);
    } finally {
        await file.close();
    }
}

export function createCorePreviewVariables(fileName: string, locale: string, cspSource: string, scriptUri: string, kind: CorePreviewKind): Record<string, string> {
    return {
        fileName: escapeHtml(fileName),
        viewerTitle: escapeHtml(CORE_PREVIEW_VIEWERS[kind].title),
        cspNonce: randomBytes(16).toString('hex'),
        cspSource: escapeHtml(cspSource),
        viewerScriptUri: escapeHtml(scriptUri),
        previewData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, maxBytes: CORE_PREVIEW_VIEWERS[kind].maxBytes }))
    };
}
