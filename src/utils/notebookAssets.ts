import * as fs from 'fs';
import * as path from 'path';

// Matches the omni-viewer-core notebook parser default, so a file the host
// accepts is one the parser will not reject for size.
export const MAX_NOTEBOOK_READ_BYTES = 64 * 1024 * 1024;
export const MAX_NOTEBOOK_ASSET_BYTES = 16 * 1024 * 1024;

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml'
};

export interface NotebookAsset {
    mimeType: string;
    dataBase64: string;
}

function isInside(directory: string, target: string): boolean {
    const relative = path.relative(directory, target);
    return relative !== ''
        && relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative);
}

/**
 * Reads an image a Markdown cell references relative to the notebook, such as
 * `![plot](figures/loss.png)`. The core viewer already refuses schemes,
 * absolute paths, and `..` segments; this is the host-side gate, which also
 * resolves symlinks so a link inside the folder cannot reach outside it.
 * Returns null for anything that is not a readable image under the notebook's
 * directory.
 */
export async function resolveNotebookAsset(notebookPath: string, assetPath: string): Promise<NotebookAsset | null> {
    let decoded: string;
    try {
        decoded = decodeURIComponent(assetPath.replace(/[?#].*$/, ''));
    } catch {
        return null;
    }
    if (!decoded || path.isAbsolute(decoded) || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
        return null;
    }

    const mimeType = IMAGE_MIME_TYPES[path.extname(decoded).toLowerCase()];
    if (!mimeType) {
        return null;
    }

    const directory = path.dirname(notebookPath);
    const target = path.resolve(directory, decoded);
    if (!isInside(directory, target)) {
        return null;
    }

    try {
        const [realDirectory, realTarget] = await Promise.all([
            fs.promises.realpath(directory),
            fs.promises.realpath(target)
        ]);
        if (!isInside(realDirectory, realTarget)) {
            return null;
        }

        const stat = await fs.promises.stat(realTarget);
        if (!stat.isFile() || stat.size > MAX_NOTEBOOK_ASSET_BYTES) {
            return null;
        }

        const data = await fs.promises.readFile(realTarget);
        return { mimeType, dataBase64: data.toString('base64') };
    } catch {
        return null;
    }
}
