import * as fs from 'fs';
import * as path from 'path';
import { OpenVinoDocument, parseOpenVino } from 'omni-viewer-core/parsers/openvino';

/** The core rejects a larger topology on its own; checking first keeps the
 *  extension host from reading such a file into memory at all. */
export const MAX_OPENVINO_XML_BYTES = 256 * 1024 * 1024;

/** The `.bin` is only range-checked and sampled for previews, but the core
 *  takes it as one buffer. A larger one is left on disk and the topology
 *  renders without it, exactly as when no `.bin` sits beside the `.xml`. */
export const MAX_OPENVINO_BIN_READ_BYTES = 512 * 1024 * 1024;

/** Why a `.bin` that does sit beside the `.xml` was not read. The core can
 *  only say that no weights were supplied, so the host explains the rest. */
export interface OpenVinoSkippedWeights {
    fileName: string;
    reason: 'tooLarge' | 'unreadable';
    size: number | null;
}

export interface OpenVinoReadResult {
    model: OpenVinoDocument;
    skippedWeights: OpenVinoSkippedWeights | null;
}

type WeightsRead =
    | { kind: 'absent' }
    | { kind: 'read'; bytes: Uint8Array }
    | { kind: 'skipped'; skipped: OpenVinoSkippedWeights };

/** The weights of `model.xml` live in `model.bin` beside it. */
export function openVinoWeightsPath(xmlPath: string): string {
    const parsed = path.parse(xmlPath);
    return path.join(parsed.dir, `${parsed.name}.bin`);
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

async function readWeights(binPath: string, signal?: AbortSignal): Promise<WeightsRead> {
    const fileName = path.basename(binPath);
    let size: number;
    try {
        const stat = await fs.promises.stat(binPath);
        if (!stat.isFile()) {
            return { kind: 'absent' };
        }
        size = stat.size;
    } catch {
        return { kind: 'absent' };
    }

    if (size > MAX_OPENVINO_BIN_READ_BYTES) {
        return { kind: 'skipped', skipped: { fileName, reason: 'tooLarge', size } };
    }

    // The topology never needs the weights, so a `.bin` that cannot be read
    // (permissions, a lock held by another process) costs only the previews.
    try {
        const bytes = await fs.promises.readFile(binPath, { signal });
        return { kind: 'read', bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
    } catch (error) {
        if (isAbortError(error)) {
            throw error;
        }
        return { kind: 'skipped', skipped: { fileName, reason: 'unreadable', size } };
    }
}

export async function readOpenVinoDocument(
    filePath: string,
    signal?: AbortSignal
): Promise<OpenVinoReadResult> {
    const { size } = await fs.promises.stat(filePath);
    if (size > MAX_OPENVINO_XML_BYTES) {
        throw new Error(
            `The IR topology is ${(size / 1024 / 1024).toFixed(1)}MB, above the 256MB OpenVINO XML inspection limit.`
        );
    }

    const xml = await fs.promises.readFile(filePath, { signal });
    const weights = await readWeights(openVinoWeightsPath(filePath), signal);
    const model = parseOpenVino(
        new Uint8Array(xml.buffer, xml.byteOffset, xml.byteLength),
        { weights: weights.kind === 'read' ? weights.bytes : undefined, signal }
    );
    return { model, skippedWeights: weights.kind === 'skipped' ? weights.skipped : null };
}
