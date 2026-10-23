import * as fs from 'fs';
import { parsePt2, Pt2Document } from 'omni-viewer-core/parsers/pt2';
import { MAX_PT2_READ_BYTES } from './pt2Limits';

export { MAX_PT2_READ_BYTES };

export async function readPt2Document(
    filePath: string,
    signal?: AbortSignal
): Promise<Pt2Document> {
    const { size } = await fs.promises.stat(filePath);
    if (size > MAX_PT2_READ_BYTES) {
        throw new Error(
            `The package is ${(size / 1024 / 1024).toFixed(1)}MB, above the 512MB in-memory PyTorch Export inspection limit.`
        );
    }

    // The parser only reads the central directory, the program JSON, and a
    // short preview of each weight, so no payload is sent into the webview.
    const bytes = await fs.promises.readFile(filePath, { signal });
    return parsePt2(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        signal ? { signal } : undefined
    );
}
