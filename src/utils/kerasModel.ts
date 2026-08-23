import * as fs from 'fs';
import * as path from 'path';
import { KerasDocument, parseKeras } from 'omni-viewer-core/parsers/keras';
import { MAX_KERAS_READ_BYTES } from './kerasLimits';

export { MAX_KERAS_READ_BYTES };

export async function readKerasDocument(
    filePath: string,
    signal?: AbortSignal
): Promise<KerasDocument> {
    const { size } = await fs.promises.stat(filePath);
    if (size > MAX_KERAS_READ_BYTES) {
        throw new Error(
            `The model is ${(size / 1024 / 1024).toFixed(1)}MB, above the 512MB in-memory Keras inspection limit.`
        );
    }

    const bytes = await fs.promises.readFile(filePath, { signal });
    return parseKeras(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        path.basename(filePath),
        signal ? { signal } : undefined
    );
}
