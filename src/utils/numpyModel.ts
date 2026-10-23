import * as fs from 'fs';
import * as path from 'path';
import { NumpyDocument, parseNumpy } from 'omni-viewer-core/parsers/numpy';
import { MAX_NUMPY_READ_BYTES } from './numpyLimits';

export { MAX_NUMPY_READ_BYTES };

export async function readNumpyDocument(
    filePath: string,
    signal?: AbortSignal
): Promise<NumpyDocument> {
    const { size } = await fs.promises.stat(filePath);
    if (size > MAX_NUMPY_READ_BYTES) {
        throw new Error(
            `The array file is ${(size / 1024 / 1024).toFixed(1)}MB, above the 512MB in-memory NumPy inspection limit.`
        );
    }

    // `parseNumpy` tells a bare `.npy` array from an `.npz` archive by its
    // bytes; the file name only names the array of a standalone `.npy`.
    const bytes = await fs.promises.readFile(filePath, { signal });
    return parseNumpy(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        path.basename(filePath),
        signal ? { signal } : undefined
    );
}
