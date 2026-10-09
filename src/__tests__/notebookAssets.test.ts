import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { MAX_NOTEBOOK_ASSET_BYTES, resolveNotebookAsset } from '../utils/notebookAssets';
import { createNotebookTemplateVariables } from '../utils/notebookTemplate';

describe('resolveNotebookAsset', () => {
    let tempDir: string;
    let notebookPath: string;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    beforeEach(() => {
        tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-notebook-')));
        fs.mkdirSync(path.join(tempDir, 'nb', 'figures'), { recursive: true });
        notebookPath = path.join(tempDir, 'nb', 'analysis.ipynb');
        fs.writeFileSync(notebookPath, '{}');
        fs.writeFileSync(path.join(tempDir, 'nb', 'figures', 'loss plot.png'), png);
        fs.writeFileSync(path.join(tempDir, 'secret.png'), png);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('reads an image next to the notebook, decoding the URL and dropping a query', async () => {
        const asset = await resolveNotebookAsset(notebookPath, 'figures/loss%20plot.png?raw=true');

        expect(asset).toEqual({ mimeType: 'image/png', dataBase64: png.toString('base64') });
    });

    it('accepts names that merely begin with two dots', async () => {
        fs.writeFileSync(path.join(tempDir, 'nb', '..thumb.png'), png);

        await expect(resolveNotebookAsset(notebookPath, '..thumb.png')).resolves.toEqual({
            mimeType: 'image/png',
            dataBase64: png.toString('base64')
        });
    });

    it('refuses paths that leave the notebook folder', async () => {
        await expect(resolveNotebookAsset(notebookPath, '../secret.png')).resolves.toBeNull();
        await expect(resolveNotebookAsset(notebookPath, path.join(tempDir, 'secret.png'))).resolves.toBeNull();
        await expect(resolveNotebookAsset(notebookPath, 'file:///etc/hosts.png')).resolves.toBeNull();
    });

    it('refuses a symlink that points outside the notebook folder', async () => {
        const link = path.join(tempDir, 'nb', 'escape.png');
        try {
            fs.symlinkSync(path.join(tempDir, 'secret.png'), link, 'file');
        } catch (error) {
            // Windows without Developer Mode cannot create symlinks.
            if ((error as { code?: string }).code === 'EPERM') {
                return;
            }
            throw error;
        }

        await expect(resolveNotebookAsset(notebookPath, 'escape.png')).resolves.toBeNull();
    });

    it('refuses non-image, missing, malformed, and oversized files', async () => {
        fs.writeFileSync(path.join(tempDir, 'nb', 'notes.txt'), 'text');
        fs.writeFileSync(path.join(tempDir, 'nb', 'huge.png'), Buffer.alloc(MAX_NOTEBOOK_ASSET_BYTES + 1));

        await expect(resolveNotebookAsset(notebookPath, 'notes.txt')).resolves.toBeNull();
        await expect(resolveNotebookAsset(notebookPath, 'figures/missing.png')).resolves.toBeNull();
        await expect(resolveNotebookAsset(notebookPath, '%E0%A4%A.png')).resolves.toBeNull();
        await expect(resolveNotebookAsset(notebookPath, 'huge.png')).resolves.toBeNull();
    });
});

describe('createNotebookTemplateVariables', () => {
    it('escapes values so a file name cannot close the data script tag', () => {
        const fileName = '</script><b>.ipynb';
        const variables = createNotebookTemplateVariables(
            fileName, 'ko', 'https://webview/katex.min.css', 'vscode-resource:', 'nonce1'
        );

        expect(variables.fileName).toBe('&lt;/script&gt;&lt;b&gt;.ipynb');
        expect(variables.cspNonce).toBe('nonce1');
        expect(variables.notebookData).not.toContain('</script>');
        expect(JSON.parse(variables.notebookData)).toEqual({
            fileName,
            locale: 'ko',
            katexCssUri: 'https://webview/katex.min.css'
        });
    });
});
