import * as fs from 'fs';
import * as path from 'path';
import { isMeshRelativePath } from 'omni-viewer-core/parsers/mesh';
import { readBoundedPreviewFile } from './corePreview';

export const MAX_MESH_ASSET_BYTES = 64 * 1024 * 1024;
export const MAX_MESH_ASSET_TOTAL_BYTES = 256 * 1024 * 1024;

function isInside(directory: string, target: string): boolean {
    const relative = path.relative(directory, target);
    return !!relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

/** glTF assets stay inside the model's folder, including through symlinks. */
export async function readCoreMeshAsset(documentPath: string, resource: string, signal?: AbortSignal, remainingBytes = MAX_MESH_ASSET_TOTAL_BYTES): Promise<{ data: Uint8Array; mimeType: string } | null> {
    if (!isMeshRelativePath(resource)) return null;
    try {
        const directory = await fs.promises.realpath(path.dirname(documentPath));
        const target = await fs.promises.realpath(path.resolve(directory, decodeURIComponent(resource)));
        if (!isInside(directory, target) || !(await fs.promises.stat(target)).isFile()) return null;
        const data = await readBoundedPreviewFile(target, Math.min(MAX_MESH_ASSET_BYTES, remainingBytes), signal);
        const mimeTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ktx2': 'image/ktx2' };
        return { data, mimeType: mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream' };
    } catch { return null; }
}
