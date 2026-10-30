import type { FileViewerDetectionResult } from './fileUtils';

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff']);
const ARROW_EXTENSIONS = new Set(['.arrow', '.feather']);
const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);

/** ASCII sfnt signatures also occur in ordinary prose and JSON booleans.
 * Require a binary header and a plausible first table-directory entry. */
function isFont(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;
    const signature = buffer.readUInt32BE(0);
    const woff = signature === 0x774f4646;
    const flavor = woff ? buffer.readUInt32BE(4) : signature;
    if (![0x00010000, 0x4f54544f, 0x74727565].includes(flavor)) return false;
    const header = woff ? 44 : 12;
    const stride = woff ? 20 : 16;
    if (buffer.length < header + stride) return false;
    const count = buffer.readUInt16BE(woff ? 12 : 4);
    if (!count || count > 4096) return false;
    const directoryEnd = header + count * stride;
    if (woff && (buffer.readUInt16BE(14) !== 0 || buffer.readUInt32BE(8) < directoryEnd)) return false;
    const firstTag = buffer.subarray(header, header + 4).toString('latin1');
    return /^[\x20-\x7e]{4}$/.test(firstTag) && buffer.readUInt32BE(header + (woff ? 4 : 8)) >= directoryEnd;
}

/** Conservative schema-message check, matching core's IPC file/stream probe. */
function isArrowIpc(buffer: Buffer): boolean {
    if (buffer.subarray(0, 6).equals(Buffer.from('ARROW1'))) return true;
    if (buffer.length < 16) return false;
    const continuation = buffer.readInt32LE(0) === -1;
    const prefix = continuation ? 8 : 4;
    const length = buffer.readInt32LE(continuation ? 4 : 0);
    if (length < 16 || length > 16 * 1024 * 1024) return false;
    const available = Math.min(buffer.length, prefix + length);
    const table = prefix + buffer.readUInt32LE(prefix);
    if (table < prefix + 4 || table + 4 > available) return false;
    const vtable = table - buffer.readInt32LE(table);
    if (vtable < prefix + 4 || vtable + 8 > available) return false;
    const field = buffer.readUInt16LE(vtable + 6);
    return field >= 4 && table + field < available && buffer[table + field] === 1;
}

/** Only a complete sampled top-level GeoJSON object claims generic JSON. */
function isGeoJson(buffer: Buffer): boolean {
    try {
        const value = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
        if (!value || Array.isArray(value) || typeof value !== 'object') return false;
        if (value.type === 'FeatureCollection') return Array.isArray(value.features);
        if (value.type === 'Feature') return 'geometry' in value && 'properties' in value
            && !Array.isArray(value.geometry) && !Array.isArray(value.properties)
            && (value.geometry === null || typeof value.geometry === 'object')
            && (value.properties === null || typeof value.properties === 'object');
        if (value.type === 'GeometryCollection') return Array.isArray(value.geometries);
        return GEOMETRY_TYPES.has(value.type) && Array.isArray(value.coordinates);
    } catch { return false; }
}

export function detectCorePreview(buffer: Buffer, ext: string, signaturesOnly = false): FileViewerDetectionResult | null {
    // GeoJSON is text; claim its extension before a UTF-16 BOM or comma-heavy
    // coordinates are mistaken for audio or CSV. Core reports invalid input.
    if (ext === '.geojson') return { viewType: 'omni-viewer.geojsonViewer', reason: 'Used the GeoJSON extension fallback.', matchedBySignature: false };
    if (isFont(buffer)) {
        return { viewType: 'omni-viewer.fontViewer', reason: 'Matched the font signature.', matchedBySignature: true };
    }
    if (isArrowIpc(buffer)) return { viewType: 'omni-viewer.arrowViewer', reason: 'Matched an Arrow IPC file or schema message.', matchedBySignature: true };
    if (signaturesOnly) return null;
    if (FONT_EXTENSIONS.has(ext)) return { viewType: 'omni-viewer.fontViewer', reason: 'Used the font extension fallback.', matchedBySignature: false };
    if (ARROW_EXTENSIONS.has(ext)) return { viewType: 'omni-viewer.arrowViewer', reason: 'Used the Arrow extension fallback.', matchedBySignature: false };
    if ((ext === '.json' || ext === '') && isGeoJson(buffer)) {
        return { viewType: 'omni-viewer.geojsonViewer', reason: 'Matched GeoJSON content.', matchedBySignature: false };
    }
    return null;
}
