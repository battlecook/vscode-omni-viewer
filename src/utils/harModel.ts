import * as fs from 'fs';
import { HarDocument, parseHar } from 'omni-viewer-core/parsers/har';
import type { ParseResult } from 'omni-viewer-core/parsers/types';
import { MAX_HAR_READ_BYTES } from './harLimits';

export { MAX_HAR_READ_BYTES };

export type HarParseResult = ParseResult<HarDocument>;

export async function readHarDocument(
    filePath: string,
    signal?: AbortSignal
): Promise<HarParseResult> {
    const { size } = await fs.promises.stat(filePath);
    if (size > MAX_HAR_READ_BYTES) {
        throw new Error(
            `The archive is ${(size / 1024 / 1024).toFixed(1)}MB, above the 100MB in-memory HAR inspection limit.`
        );
    }

    // A truncated or partly malformed archive still comes back `partial` with
    // the entries it did hold, and an unreadable one as `failed` with a catalog
    // key — both are handed to the webview so it can localize the diagnostics.
    const bytes = await fs.promises.readFile(filePath, { signal });
    const { result } = parseHar(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        {
            ...(signal ? { signal } : {}),
            limits: { maxInputBytes: MAX_HAR_READ_BYTES }
        }
    );
    return result;
}
