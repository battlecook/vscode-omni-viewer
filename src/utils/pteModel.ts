import * as fs from 'fs';
import { parsePte, PteDocument } from 'omni-viewer-core/parsers/pte';

export const MAX_PTE_READ_BYTES = 512 * 1024 * 1024;

export async function readPteDocument(
    filePath: string,
    signal?: AbortSignal
): Promise<PteDocument> {
    const { size } = await fs.promises.stat(filePath);
    if (size > MAX_PTE_READ_BYTES) {
        throw new Error(
            `The program is ${(size / 1024 / 1024).toFixed(1)}MB, above the 512MB in-memory ExecuTorch inspection limit.`
        );
    }

    const bytes = await fs.promises.readFile(filePath, { signal });
    return parsePte(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}
