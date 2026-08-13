import * as fs from 'fs';
import { parseTflite, TfliteDocument } from 'omni-viewer-core/parsers/tflite';

export const MAX_TFLITE_READ_BYTES = 512 * 1024 * 1024;

export async function readTfliteDocument(
    filePath: string,
    signal?: AbortSignal
): Promise<TfliteDocument> {
    const { size } = await fs.promises.stat(filePath);
    if (size > MAX_TFLITE_READ_BYTES) {
        throw new Error(
            `The model is ${(size / 1024 / 1024).toFixed(1)}MB, above the 512MB in-memory TFLite inspection limit.`
        );
    }

    const bytes = await fs.promises.readFile(filePath, { signal });
    return parseTflite(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}
