import * as fs from 'fs';
import { CoremlDocument, parseCoreml } from 'omni-viewer-core/parsers/coreml';
import { MAX_COREML_READ_BYTES } from './coremlLimits';

export { MAX_COREML_READ_BYTES };

export async function readCoremlDocument(
    filePath: string,
    signal?: AbortSignal
): Promise<CoremlDocument> {
    const { size } = await fs.promises.stat(filePath);
    if (size > MAX_COREML_READ_BYTES) {
        throw new Error(
            `The model is ${(size / 1024 / 1024).toFixed(1)}MB, above the 512MB in-memory Core ML inspection limit.`
        );
    }

    // `parseCoreml` tells a bare `.mlmodel` specification from an `.mlpackage`
    // archive by its bytes, so the extension never has to route on the name.
    const bytes = await fs.promises.readFile(filePath, { signal });
    return parseCoreml(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        signal ? { signal } : undefined
    );
}
