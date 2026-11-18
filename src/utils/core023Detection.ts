import * as fs from 'fs';
import { looksLikeEml, looksLikeJUnit, looksLikeOpenApi } from 'omni-viewer-core/registry';
import { decodeMarkupText } from 'omni-viewer-core/parsers/epub';
import { loadOpenApiYamlDeps } from 'omni-viewer-core/parsers/openapi/self-loading';
import type { FileViewerDetectionResult, OmniViewerViewType } from './fileUtils';
import { readBoundedPreviewFile } from './corePreview';

export function decodePreviewSignature(bytes: Uint8Array): string {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    return new TextDecoder(encoding).decode(bytes);
}
function match(kind: 'text' | 'dicom' | 'junit' | 'openapi' | 'eml' | 'mcap' | 'mesh', reason: string, matchedBySignature = false): FileViewerDetectionResult {
    return { viewType: `omni-viewer.${kind}Viewer` as OmniViewerViewType, reason, matchedBySignature };
}

/** These text/binary extensions must precede the legacy CSV/audio heuristics. */
export function detectCore023Signature(buffer: Buffer, ext: string, preferText = false): FileViewerDetectionResult | null {
    if (ext === '.txt' && (preferText || !buffer.length || buffer[0] === 0xff && buffer[1] === 0xfe || buffer[0] === 0xfe && buffer[1] === 0xff)) {
        return match('text', 'Used the explicit plain-text extension.');
    }
    if (buffer.subarray(128, 132).equals(Buffer.from('DICM'))) return match('dicom', 'Matched the DICOM Part 10 marker.', true);
    if (ext === '.dcm' || ext === '.dicom') return match('dicom', 'Used the DICOM extension fallback.');
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 13, 10]))) return match('mcap', 'Matched the MCAP v0 signature.', true);
    if (buffer.subarray(0, 4).equals(Buffer.from('glTF'))) return match('mesh', 'Matched the GLB signature.', true);
    if (['.glb', '.gltf', '.stl', '.obj'].includes(ext)) return match('mesh', 'Used the 3D model extension fallback.');
    if (ext === '.mcap') return match('mcap', 'Used the MCAP extension fallback.');
    if (ext === '.eml') return match('eml', 'Used the email extension fallback.');
    // Match the core XML parser's BOM-less UTF-16 and declared legacy
    // encoding detection as well as its BOM handling.
    if ((ext === '.xml' || !ext) && looksLikeJUnit(decodeMarkupText(buffer).text)) return match('junit', 'Matched a JUnit XML report root.');
    if (!ext && looksLikeEml(decodePreviewSignature(buffer))) return match('eml', 'Matched email headers.');
    return null;
}

/** Full bounded content, rather than a partial JSON document, refines JSON/YAML. */
export async function detectCore023OpenApi(filePath: string, buffer: Buffer, ext: string): Promise<FileViewerDetectionResult | null> {
    if (!['', '.json', '.yaml', '.yml'].includes(ext) || !buffer.length) return null;
    try {
        const maxBytes = 10 * 1024 * 1024;
        const size = (await fs.promises.stat(filePath)).size;
        if (size > maxBytes) return null;
        const data = size > buffer.length ? await readBoundedPreviewFile(filePath, maxBytes) : buffer;
        const text = decodePreviewSignature(data);
        if (!/(?:openapi|swagger|\\)/.test(text)) return null;
        if (looksLikeOpenApi(text, ext === '.json' ? { format: 'json' } : {})) return match('openapi', 'Matched an OpenAPI / Swagger document.');
        if (ext === '.json') return null;
        // Let the core inspect the original YAML under the same node/alias
        // budgets as its viewer; never materialize an expanded JSON string.
        const yamlDeps = await loadOpenApiYamlDeps();
        return looksLikeOpenApi(text, { yamlDeps }) ? match('openapi', 'Matched an OpenAPI / Swagger YAML document.') : null;
    } catch { return null; }
}
