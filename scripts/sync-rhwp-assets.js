const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'node_modules', '@rhwp', 'core');
const targetDir = path.join(projectRoot, 'src', 'templates', 'hwp', 'vendor', 'rhwp');
const filesToCopy = ['rhwp.js', 'rhwp_bg.wasm', 'LICENSE'];

if (!fs.existsSync(sourceDir)) {
    throw new Error(`@rhwp/core is not installed: ${sourceDir}`);
}

fs.mkdirSync(targetDir, { recursive: true });

for (const fileName of filesToCopy) {
    const sourcePath = path.join(sourceDir, fileName);
    const targetPath = path.join(targetDir, fileName);

    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Missing upstream asset: ${sourcePath}`);
    }

    fs.copyFileSync(sourcePath, targetPath);
}

console.log(`[sync:rhwp] Copied ${filesToCopy.length} files into ${targetDir}`);
