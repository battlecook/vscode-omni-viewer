import * as fs from 'fs';
import * as path from 'path';
import {
    detectViewer, probeContainer, sniffContainer, JSON_VIEWER_DESCRIPTOR, XML_VIEWER_DESCRIPTOR,
    SARIF_VIEWER_DESCRIPTOR, GPS_VIEWER_DESCRIPTOR, TRACE_VIEWER_DESCRIPTOR, SBOM_VIEWER_DESCRIPTOR,
    MSG_VIEWER_DESCRIPTOR, DRAWIO_VIEWER_DESCRIPTOR, OPENDOCUMENT_VIEWER_DESCRIPTOR
} from 'omni-viewer-core/registry';
import { decodeMarkupText } from 'omni-viewer-core/parsers/epub';
import type { FileViewerDetectionResult, OmniViewerViewType } from './fileUtils';
import { CORE_PREVIEW_VIEWERS, readBoundedPreviewFile } from './corePreview';
import { decodePreviewSignature } from './core023Detection';

export type Core024Kind = 'sarif' | 'gps' | 'trace' | 'sbom' | 'msg' | 'drawio' | 'opendocument';

const PREVIEW_DESCRIPTORS = [SARIF_VIEWER_DESCRIPTOR, GPS_VIEWER_DESCRIPTOR, TRACE_VIEWER_DESCRIPTOR,
    SBOM_VIEWER_DESCRIPTOR, MSG_VIEWER_DESCRIPTOR, DRAWIO_VIEWER_DESCRIPTOR, OPENDOCUMENT_VIEWER_DESCRIPTOR];
const KINDS = new Set<string>(PREVIEW_DESCRIPTORS.map(descriptor => descriptor.id));
const TITLES: Record<Core024Kind, string> = {
    sarif: 'SARIF', gps: 'GPX/KML/KMZ', trace: 'Chrome Trace', sbom: 'CycloneDX', msg: 'Outlook MSG', drawio: 'draw.io', opendocument: 'OpenDocument'
};
/** The core parses a plain GPX/KML at its 16 MiB XML budget; KMZ uses the full preview budget. */
const GPS_XML_MAX_BYTES = 16 * 1024 * 1024;
/** BOM, whitespace, declaration, PIs, comments and a DOCTYPE; each alternative starts differently, so it stays linear. */
const XML_PROLOGUE = /^\uFEFF?(?:\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:"[^"]*"|'[^']*'|\[[^\]]*\]|[^>"'[])*>)*/;

function match(kind: Core024Kind, reason: string, matchedBySignature = false): FileViewerDetectionResult {
    return { viewType: `omni-viewer.${kind}Viewer` as OmniViewerViewType, reason, matchedBySignature };
}

/** Compound extensions (`.sarif.json`, `.cdx.json`, `.trace.json`) come from the core descriptors. */
function extensionKind(fileName: string): Core024Kind | undefined {
    const lower = fileName.toLowerCase();
    return PREVIEW_DESCRIPTORS.find(descriptor => descriptor.extensions.some(ext => lower.endsWith(`.${ext}`)))?.id as Core024Kind | undefined;
}

async function fits(filePath: string, maxBytes: number): Promise<boolean> {
    try { return (await fs.promises.stat(filePath)).size <= maxBytes; } catch { return false; }
}

/** Full bounded content is needed to read a ZIP central directory or CFB directory. */
async function probe(filePath: string, container: 'zip' | 'ole'): Promise<string | null> {
    try {
        const maxBytes = CORE_PREVIEW_VIEWERS[container === 'ole' ? 'msg' : 'opendocument'].maxBytes;
        if (!(await fits(filePath, maxBytes))) return null;
        return await probeContainer(await readBoundedPreviewFile(filePath, maxBytes), container);
    } catch { return null; }
}

/** Uses the core content sniffers through its detector, restricted to one generic format. */
function sniff(text: string, format: 'json' | 'xml'): Core024Kind | null {
    const generic = format === 'json' ? JSON_VIEWER_DESCRIPTOR : XML_VIEWER_DESCRIPTOR;
    const { viewerId } = detectViewer(`sample.${format}`, new Set(), [generic, ...PREVIEW_DESCRIPTORS], undefined, text);
    return viewerId !== generic.id && KINDS.has(viewerId) ? viewerId as Core024Kind : null;
}

/** The GPS parser reads the sniffer's namespaced GPX/KML roots and also a root with no namespace. */
function gpsRoot(text: string): boolean {
    if (sniff(text, 'xml') === 'gps') return true;
    const root = /^<(?:gpx|kml)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec(text.slice(0, 64 * 1024).replace(XML_PROLOGUE, ''));
    return !!root && !/\sxmlns\s*=/.test(root[1].replace(/"[^"]*"|'[^']*'/g, '""'));
}

/**
 * Routes the 0.24 core file previews. ZIP and CFB containers are verified before
 * their extensions are trusted, so a `.msg` that is a ROS message or Tcl catalog
 * keeps its previous routing and an over-budget package stays with the Archive viewer.
 */
export async function detectCore024Preview(filePath: string, buffer: Buffer, ext: string, requestedViewType?: OmniViewerViewType): Promise<FileViewerDetectionResult | null> {
    const kind = extensionKind(path.basename(filePath));
    const container = sniffContainer(buffer);
    if (container === 'ole') {
        if (kind === 'msg') return match('msg', 'Matched the Compound File signature with the Outlook MSG extension.', true);
        return !ext && await probe(filePath, 'ole') === 'msg' ? match('msg', 'Matched Outlook MSG property streams.', true) : null;
    }
    if (kind === 'msg') {
        // A ROS message or Tcl catalog requested as Outlook mail is readable as plain text.
        return requestedViewType === 'omni-viewer.msgViewer'
            ? { viewType: 'omni-viewer.textViewer', reason: 'The .msg file is not an Outlook Compound File, so it opened as text.', matchedBySignature: false }
            : null;
    }
    if (container === 'zip') {
        if (requestedViewType === 'omni-viewer.archiveViewer') return null;
        const zipKind = kind === 'gps' || kind === 'opendocument' ? kind : !ext ? await probe(filePath, 'zip') : null;
        if ((zipKind !== 'gps' && zipKind !== 'opendocument') || !(await fits(filePath, CORE_PREVIEW_VIEWERS[zipKind].maxBytes))) return null;
        return match(zipKind, kind ? `Matched a ZIP container with the ${TITLES[zipKind]} extension.` : `Matched ${TITLES[zipKind]} package members.`, true);
    }
    const textBudget = (textKind: Core024Kind) => textKind === 'gps' ? GPS_XML_MAX_BYTES : CORE_PREVIEW_VIEWERS[textKind].maxBytes;
    if (kind) {
        // A larger `*.json`, `.gpx` or `.kml` document, or another XML root, stays readable by the generic JSON/XML viewer.
        const gpsXml = ext === '.gpx' || ext === '.kml';
        if (gpsXml && !gpsRoot(decodeMarkupText(buffer).text)) return null;
        if ((ext === '.json' || gpsXml) && !(await fits(filePath, textBudget(kind)))) return null;
        return match(kind, `Used the ${TITLES[kind]} extension fallback.`);
    }
    if (!buffer.length || !(ext === '' || ext === '.json' || ext === '.xml')) return null;
    // The XML decoder follows BOM-less UTF-16 and declared encodings like the core parsers.
    const sniffed = (ext !== '.xml' ? sniff(decodePreviewSignature(buffer), 'json') : null)
        ?? (ext !== '.json' ? sniff(decodeMarkupText(buffer).text, 'xml') : null);
    if (!sniffed) return null;
    // A document over the preview budget stays with the generic JSON/XML viewer.
    return await fits(filePath, textBudget(sniffed)) ? match(sniffed, `Matched ${TITLES[sniffed]} content.`) : null;
}
