import * as path from 'path';
import * as vscode from 'vscode';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { WebviewMessage } from './types';

export class PdfMessageHandlers {
    private static readonly mergedPdfCache = new Map<string, string[]>();

    public static setupDocumentCacheKey(documentUri?: vscode.Uri): string | null {
        return documentUri ? documentUri.toString() : null;
    }

    public static resetMergedPdfCache(documentUri?: vscode.Uri): void {
        const key = this.setupDocumentCacheKey(documentUri);
        if (key) {
            this.mergedPdfCache.delete(key);
        }
    }

    public static async handleSelectMergePdf(documentUri?: vscode.Uri, webview?: vscode.Webview): Promise<void> {
        try {
            if (!documentUri || !webview) {
                throw new Error('No active PDF document');
            }

            const selectedUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'PDF files': ['pdf'] }
            });

            if (!selectedUris || selectedUris.length === 0) {
                return;
            }

            const mergeUri = selectedUris[0];
            const mergeBytes = await vscode.workspace.fs.readFile(mergeUri);
            const mergeBase64 = Buffer.from(mergeBytes).toString('base64');
            const cacheKey = this.setupDocumentCacheKey(documentUri);
            if (cacheKey) {
                this.mergedPdfCache.set(cacheKey, [mergeBase64]);
            }

            const mergedFileName = path.basename(mergeUri.fsPath);
            const maxWebviewBase64Bytes = 1_500_000;

            if (mergeBytes.length <= maxWebviewBase64Bytes) {
                await webview.postMessage({
                    type: 'selectedMergePdf',
                    data: {
                        base64: mergeBase64,
                        fileName: mergedFileName
                    }
                });
                return;
            }

            await webview.postMessage({
                type: 'selectedMergePdfMeta',
                data: { fileName: mergedFileName }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to select merge PDF: ${errorMessage}`);
            console.error('Error selecting merge PDF:', error);
        }
    }

    public static async handleSavePdf(
        message: WebviewMessage,
        documentUri?: vscode.Uri,
        webview?: vscode.Webview
    ): Promise<void> {
        try {
            if (!documentUri || !message.data) {
                throw new Error('No document or annotation data');
            }

            const isSaveAs = message.data.saveAs === true || message.command === 'savePdfAs' || message.type === 'savePdfAs';
            let targetUri = documentUri;
            if (isSaveAs) {
                const sourcePath = documentUri.fsPath;
                const sourceExt = path.extname(sourcePath) || '.pdf';
                const sourceBase = path.basename(sourcePath, sourceExt);
                const defaultPath = path.join(path.dirname(sourcePath), `${sourceBase}-edited.pdf`);
                const saveAsUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultPath),
                    filters: { 'PDF files': ['pdf'] }
                });

                if (!saveAsUri) {
                    return;
                }
                targetUri = saveAsUri;
            }

            const pdfBytes = await vscode.workspace.fs.readFile(documentUri);
            const baseDoc = await PDFDocument.load(pdfBytes);
            const sourceDocs: PDFDocument[] = [baseDoc];
            const cacheKey = this.setupDocumentCacheKey(documentUri);
            const cachedExtraPdfs = cacheKey ? (this.mergedPdfCache.get(cacheKey) || []) : [];
            const extraPdfBase64List: string[] = Array.isArray(message.data.extraPdfBase64List)
                ? message.data.extraPdfBase64List
                : (message.data.hasMerge ? cachedExtraPdfs : []);

            for (const extraBase64 of extraPdfBase64List) {
                if (!extraBase64) {
                    continue;
                }
                const extraBytes = Buffer.from(extraBase64, 'base64');
                sourceDocs.push(await PDFDocument.load(extraBytes));
            }

            const mergedDoc = await PDFDocument.create();
            for (const srcDoc of sourceDocs) {
                const pageIndices = srcDoc.getPages().map((_, index) => index);
                const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);
                copiedPages.forEach((copiedPage) => mergedDoc.addPage(copiedPage));
            }

            let workingDoc = mergedDoc;
            const totalPages = mergedDoc.getPageCount();
            const requestedPageOrder: number[] = Array.isArray(message.data.pageOrder) ? message.data.pageOrder : [];
            if (requestedPageOrder.length > 0) {
                const seen = new Set<number>();
                const normalizedOrder: number[] = [];
                for (const rawIndex of requestedPageOrder) {
                    const pageIndex = Number(rawIndex);
                    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= totalPages || seen.has(pageIndex)) {
                        continue;
                    }
                    seen.add(pageIndex);
                    normalizedOrder.push(pageIndex);
                }

                if (normalizedOrder.length === 0) {
                    throw new Error('No valid pages left to save.');
                }

                if (message.data.hasMerge === true && message.data.previewIncludesMergedPages !== true) {
                    for (let i = 0; i < totalPages; i++) {
                        if (!seen.has(i)) {
                            normalizedOrder.push(i);
                        }
                    }
                }

                const reorderedDoc = await PDFDocument.create();
                const reorderedPages = await reorderedDoc.copyPages(mergedDoc, normalizedOrder);
                reorderedPages.forEach((copiedPage) => reorderedDoc.addPage(copiedPage));
                workingDoc = reorderedDoc;
            }

            const helvetica = await workingDoc.embedFont(StandardFonts.Helvetica);
            const pages = workingDoc.getPages();
            const texts = Array.isArray(message.data.texts) ? message.data.texts : [];
            const textStamps = Array.isArray(message.data.textStamps) ? message.data.textStamps : [];
            const signatures = Array.isArray(message.data.signatures) ? message.data.signatures : [];

            if (textStamps.length > 0) {
                for (const stamp of textStamps) {
                    if (stamp.pageIndex < 0 || stamp.pageIndex >= pages.length) {
                        continue;
                    }
                    const page = pages[stamp.pageIndex];
                    const pngImage = await workingDoc.embedPng(Buffer.from(stamp.imageBase64, 'base64'));
                    page.drawImage(pngImage, {
                        x: stamp.x,
                        y: stamp.y,
                        width: stamp.width,
                        height: stamp.height
                    });
                }
            } else {
                for (const text of texts) {
                    if (text.pageIndex < 0 || text.pageIndex >= pages.length) {
                        continue;
                    }
                    const page = pages[text.pageIndex];
                    const textColor = this.hexToRgb(text.color);
                    page.drawText(text.text, {
                        x: text.x,
                        y: text.y,
                        size: text.fontSize || 12,
                        font: helvetica,
                        color: rgb(textColor.r, textColor.g, textColor.b)
                    });
                }
            }

            for (const sig of signatures) {
                if (sig.pageIndex < 0 || sig.pageIndex >= pages.length) {
                    continue;
                }
                const page = pages[sig.pageIndex];
                const pngImage = await workingDoc.embedPng(Buffer.from(sig.imageBase64, 'base64'));
                page.drawImage(pngImage, {
                    x: sig.x,
                    y: sig.y,
                    width: sig.width,
                    height: sig.height
                });
            }

            const savedBytes = await workingDoc.save();
            await vscode.workspace.fs.writeFile(targetUri, new Uint8Array(savedBytes));
            vscode.window.showInformationMessage(`PDF saved: ${path.basename(targetUri.fsPath)}`);
            this.resetMergedPdfCache(documentUri);

            if (webview) {
                await webview.postMessage({
                    type: 'pdfSaved',
                    data: {
                        base64: Buffer.from(savedBytes).toString('base64'),
                        fileName: path.basename(targetUri.fsPath)
                    }
                });
            }

            await vscode.commands.executeCommand('vscode.openWith', targetUri, 'omni-viewer.pdfViewer');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to save PDF: ${errorMessage}`);
            console.error('Error saving PDF:', error);
        }
    }

    private static hexToRgb(hex?: string): { r: number; g: number; b: number } {
        if (!hex || typeof hex !== 'string') {
            return { r: 0, g: 0, b: 0 };
        }

        const normalized = hex.trim().replace('#', '');
        const fullHex = normalized.length === 3
            ? normalized.split('').map((char) => char + char).join('')
            : normalized;

        if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) {
            return { r: 0, g: 0, b: 0 };
        }

        const intVal = parseInt(fullHex, 16);
        return {
            r: ((intVal >> 16) & 255) / 255,
            g: ((intVal >> 8) & 255) / 255,
            b: (intVal & 255) / 255
        };
    }
}
