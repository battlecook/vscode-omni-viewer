import * as fs from 'fs';

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

interface CfbEntry {
    name: string;
    type: number;
    leftId: number;
    rightId: number;
    childId: number;
    startSector: number;
    size: number;
}

interface CfbParseResult {
    getStream(name: string): Buffer | null;
}

interface PptRecord {
    recType: number;
    recInstance: number;
    recVer: number;
    length: number;
    payloadOffset: number;
    payload: Buffer;
    children?: PptRecord[];
}

interface PptSlideModel {
    slideNumber: number;
    widthPx: number;
    heightPx: number;
    backgroundColor: string;
    elements: Array<{
        type: 'text' | 'image' | 'shape';
        x: number;
        y: number;
        width: number;
        height: number;
        zIndex: number;
        isTitle?: boolean;
        paragraphs?: Array<{
            text: string;
            level: number;
            bullet?: boolean;
            align?: string;
            fontSizePx?: number;
            bold?: boolean;
            italic?: boolean;
            color?: string;
            runs?: Array<{
                text: string;
                fontSizePx?: number;
                bold?: boolean;
                italic?: boolean;
                color?: string;
            }>;
        }>;
        src?: string;
        fillColor?: string;
        borderColor?: string;
    }>;
}

/**
 * Standalone legacy .ppt parser.
 *
 * Scope (incremental roadmap):
 * 1) CFB/OLE container parsing
 * 2) Slide container indexing
 * 3) Text extraction
 * 4) Basic layout placement
 * 5) Pictures stream extraction (JPEG/PNG)
 * 6) Minimal style hints (title/bullets)
 * 7) Extension-friendly internal pipeline
 */
export class PptBinaryParser {
    public static async parse(filePath: string): Promise<{
        slides: PptSlideModel[];
        totalSlides: number;
    }> {
        const buffer = await fs.promises.readFile(filePath);
        const cfb = this.parseCfb(buffer);

        const docStream = cfb.getStream('PowerPoint Document');
        if (!docStream) {
            throw new Error('Invalid .ppt file: missing "PowerPoint Document" stream.');
        }

        const records = this.parseRecords(docStream, 0, docStream.length);
        const slideRecords = this.collectSlideContainers(records);
        const pictures = this.extractPictures(cfb.getStream('Pictures'));

        const widthPx = 960;
        const heightPx = 720;
        const slides = this.buildSlides(slideRecords, pictures, widthPx, heightPx);

        if (slides.length === 0) {
            const fallbackTexts = this.extractLooseTexts(docStream).slice(0, 40);
            if (fallbackTexts.length > 0) {
                return {
                    slides: [{
                        slideNumber: 1,
                        widthPx,
                        heightPx,
                        backgroundColor: '#ffffff',
                        elements: fallbackTexts.map((text, idx) => ({
                            type: 'text',
                            x: 72,
                            y: 80 + idx * 34,
                            width: 816,
                            height: 30,
                            zIndex: idx,
                            isTitle: idx === 0,
                            paragraphs: [{
                                text,
                                level: 0,
                                bullet: idx > 0
                            }]
                        }))
                    }],
                    totalSlides: 1
                };
            }
        }

        return {
            slides,
            totalSlides: slides.length
        };
    }

    private static parseCfb(file: Buffer): CfbParseResult {
        if (file.length < 512) {
            throw new Error('Invalid CFB file: too small.');
        }
        const signature = file.slice(0, 8).toString('hex');
        if (signature !== 'd0cf11e0a1b11ae1') {
            throw new Error('Invalid CFB signature.');
        }

        const sectorShift = file.readUInt16LE(30);
        const miniSectorShift = file.readUInt16LE(32);
        const sectorSize = 1 << sectorShift;
        const miniSectorSize = 1 << miniSectorShift;

        const numFatSectors = file.readUInt32LE(44);
        const firstDirSector = file.readInt32LE(48);
        const miniCutoff = file.readUInt32LE(56);
        const firstMiniFatSector = file.readInt32LE(60);
        const numMiniFatSectors = file.readUInt32LE(64);
        const firstDifatSector = file.readInt32LE(68);
        const numDifatSectors = file.readUInt32LE(72);

        const readSector = (sid: number): Buffer => {
            const offset = (sid + 1) * sectorSize;
            if (offset < 0 || offset + sectorSize > file.length) {
                return Buffer.alloc(0);
            }
            return file.slice(offset, offset + sectorSize);
        };

        const difat: number[] = [];
        for (let i = 0; i < 109; i++) {
            const sid = file.readInt32LE(76 + i * 4);
            if (sid !== -1) difat.push(sid);
        }

        let nextDifat = firstDifatSector;
        for (let i = 0; i < numDifatSectors && nextDifat !== ENDOFCHAIN && nextDifat !== -1; i++) {
            const sec = readSector(nextDifat);
            if (sec.length === 0) break;
            const entriesPerSector = sectorSize / 4 - 1;
            for (let j = 0; j < entriesPerSector; j++) {
                const sid = sec.readInt32LE(j * 4);
                if (sid !== -1) difat.push(sid);
            }
            nextDifat = sec.readInt32LE(sectorSize - 4);
        }

        const fatSectors = difat.slice(0, numFatSectors);
        const fat: number[] = [];
        fatSectors.forEach((sid) => {
            const sec = readSector(sid);
            if (sec.length === 0) return;
            for (let i = 0; i < sectorSize; i += 4) {
                fat.push(sec.readInt32LE(i));
            }
        });

        const readChain = (startSid: number): Buffer => {
            if (startSid < 0 || startSid === ENDOFCHAIN) return Buffer.alloc(0);
            const chunks: Buffer[] = [];
            const seen = new Set<number>();
            let sid = startSid;
            while (sid >= 0 && sid !== ENDOFCHAIN && sid !== FREESECT) {
                if (seen.has(sid) || sid >= fat.length) break;
                seen.add(sid);
                const sec = readSector(sid);
                if (sec.length === 0) break;
                chunks.push(sec);
                sid = fat[sid];
            }
            return Buffer.concat(chunks);
        };

        const dirStream = readChain(firstDirSector);
        const entries: CfbEntry[] = [];
        for (let off = 0; off + 128 <= dirStream.length; off += 128) {
            const nameLength = dirStream.readUInt16LE(off + 64);
            const rawName = dirStream.slice(off, off + Math.max(0, nameLength - 2));
            const name = rawName.toString('utf16le').replace(/\u0000/g, '');
            const type = dirStream.readUInt8(off + 66);
            const leftId = dirStream.readInt32LE(off + 68);
            const rightId = dirStream.readInt32LE(off + 72);
            const childId = dirStream.readInt32LE(off + 76);
            const startSector = dirStream.readInt32LE(off + 116);
            const sizeLow = dirStream.readUInt32LE(off + 120);
            const sizeHigh = dirStream.readUInt32LE(off + 124);
            const size = sizeHigh > 0 ? Number(sizeLow) : sizeLow;
            entries.push({
                name,
                type,
                leftId,
                rightId,
                childId,
                startSector,
                size
            });
        }

        const root = entries.find((e) => e.type === 5);
        const miniStream = root ? readChain(root.startSector).slice(0, root.size) : Buffer.alloc(0);
        const miniFatStream = readChain(firstMiniFatSector);
        const miniFat: number[] = [];
        for (let off = 0; off + 4 <= numMiniFatSectors * sectorSize && off + 4 <= miniFatStream.length; off += 4) {
            miniFat.push(miniFatStream.readInt32LE(off));
        }

        const readMiniChain = (startMiniSid: number, size: number): Buffer => {
            if (startMiniSid < 0) return Buffer.alloc(0);
            const chunks: Buffer[] = [];
            const seen = new Set<number>();
            let sid = startMiniSid;
            while (sid >= 0 && sid !== ENDOFCHAIN && sid !== FREESECT) {
                if (seen.has(sid) || sid >= miniFat.length) break;
                seen.add(sid);
                const start = sid * miniSectorSize;
                const end = start + miniSectorSize;
                if (start < 0 || end > miniStream.length) break;
                chunks.push(miniStream.slice(start, end));
                sid = miniFat[sid];
            }
            return Buffer.concat(chunks).slice(0, size);
        };

        const byName = new Map<string, CfbEntry>();
        entries.forEach((e) => {
            if (e.name) byName.set(e.name, e);
        });

        return {
            getStream: (name: string): Buffer | null => {
                const entry = byName.get(name);
                if (!entry || entry.type !== 2) return null;
                if (entry.size < miniCutoff && root) {
                    return readMiniChain(entry.startSector, entry.size);
                }
                return readChain(entry.startSector).slice(0, entry.size);
            }
        };
    }

    private static parseRecords(buffer: Buffer, start: number, end: number): PptRecord[] {
        const records: PptRecord[] = [];
        let offset = start;

        while (offset + 8 <= end && offset + 8 <= buffer.length) {
            const verInst = buffer.readUInt16LE(offset);
            const recVer = verInst & 0x000f;
            const recInstance = (verInst >> 4) & 0x0fff;
            const recType = buffer.readUInt16LE(offset + 2);
            const length = buffer.readUInt32LE(offset + 4);
            const payloadOffset = offset + 8;
            const payloadEnd = payloadOffset + length;
            if (payloadEnd > end || payloadEnd > buffer.length) break;

            const payload = buffer.slice(payloadOffset, payloadEnd);
            const record: PptRecord = {
                recType,
                recInstance,
                recVer,
                length,
                payloadOffset,
                payload
            };

            if (recVer === 0x0f) {
                record.children = this.parseRecords(buffer, payloadOffset, payloadEnd);
            }

            records.push(record);
            offset = payloadEnd;
        }

        return records;
    }

    private static collectSlideContainers(records: PptRecord[]): PptRecord[] {
        const out: PptRecord[] = [];
        const visit = (list: PptRecord[]) => {
            list.forEach((r) => {
                // RT_Slide (commonly 1006)
                if (r.recType === 1006) {
                    out.push(r);
                }
                if (r.children && r.children.length > 0) {
                    visit(r.children);
                }
            });
        };
        visit(records);
        return out;
    }

    private static buildSlides(
        slideRecords: PptRecord[],
        pictures: Array<{ mime: string; base64: string }>,
        widthPx: number,
        heightPx: number
    ): PptSlideModel[] {
        const slides: PptSlideModel[] = [];
        for (let i = 0; i < slideRecords.length; i++) {
            const slideRecord = slideRecords[i];
            const texts = this.extractTextsFromRecord(slideRecord).slice(0, 24);
            const elements: PptSlideModel['elements'] = [];

            if (texts.length > 0) {
                texts.forEach((text, idx) => {
                    const y = idx === 0 ? 76 : 170 + (idx - 1) * 42;
                    elements.push({
                        type: 'text',
                        x: 72,
                        y,
                        width: 816,
                        height: idx === 0 ? 72 : 36,
                        zIndex: idx,
                        isTitle: idx === 0,
                        paragraphs: [{
                            text,
                            level: 0,
                            bullet: idx > 0
                        }]
                    });
                });
            }

            // Minimal image support: assign in stream order.
            const img = pictures[i];
            if (img) {
                elements.push({
                    type: 'image',
                    x: 72,
                    y: 180,
                    width: 816,
                    height: 420,
                    zIndex: 100,
                    src: `data:${img.mime};base64,${img.base64}`
                });
            }

            slides.push({
                slideNumber: i + 1,
                widthPx,
                heightPx,
                backgroundColor: '#ffffff',
                elements
            });
        }
        return slides;
    }

    private static extractTextsFromRecord(record: PptRecord): string[] {
        const texts: string[] = [];
        const visit = (r: PptRecord) => {
            const isTextType = r.recType === 4000 || r.recType === 3998 || r.recType === 4026 || r.recType === 4086;
            if (isTextType || (r.recVer !== 0x0f && r.payload.length > 4 && r.payload.length < 4096)) {
                const candidates = this.decodeTextCandidates(r.payload);
                candidates.forEach((t) => {
                    if (!t) return;
                    if (this.isNoiseText(t)) return;
                    texts.push(t);
                });
            }
            if (r.children) r.children.forEach(visit);
        };
        visit(record);

        const dedup = new Set<string>();
        const out: string[] = [];
        texts.forEach((t) => {
            const normalized = t.replace(/\s+/g, ' ').trim();
            if (!normalized || dedup.has(normalized)) return;
            dedup.add(normalized);
            out.push(normalized);
        });
        return out;
    }

    private static extractLooseTexts(stream: Buffer): string[] {
        const out: string[] = [];
        out.push(...this.decodeTextCandidates(stream));
        return out.filter((t) => !this.isNoiseText(t)).slice(0, 80);
    }

    private static decodeTextCandidates(payload: Buffer): string[] {
        const out: string[] = [];

        // UTF-16LE chunks
        const utf16 = payload.toString('utf16le')
            .replace(/\u0000/g, '')
            .split(/[\r\n\t]+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 3 && /[A-Za-z0-9가-힣]/.test(s) && this.isMostlyReadable(s));
        out.push(...utf16);

        // Latin1 chunks
        const latin = payload.toString('latin1')
            .split(/[\x00-\x1f]+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 4 && /[A-Za-z0-9]/.test(s) && this.isMostlyReadable(s));
        out.push(...latin);

        return out.slice(0, 30);
    }

    private static isNoiseText(text: string): boolean {
        const t = text.toLowerCase();
        if (t.length < 3) return true;
        if (!this.isMostlyReadable(text)) return true;
        if (/^[\W_]+$/.test(t)) return true;
        if (/^(arial|times new roman|calibri|wingdings)$/i.test(text)) return true;
        if (/click to edit master/i.test(t)) return true;
        if (/^_+ppt\d+/i.test(t)) return true;
        return false;
    }

    private static isMostlyReadable(text: string): boolean {
        const normalized = (text || '').trim();
        if (!normalized) return false;
        let readable = 0;
        for (let i = 0; i < normalized.length; i++) {
            const code = normalized.charCodeAt(i);
            const isBasicPrintable = code >= 32 && code <= 126;
            const isKorean = code >= 0xac00 && code <= 0xd7a3;
            const isCommonPunct = '“”‘’•…–—·©®™°'.includes(normalized[i]);
            if (isBasicPrintable || isKorean || isCommonPunct) readable += 1;
        }
        const ratio = readable / Math.max(1, normalized.length);
        return ratio >= 0.75;
    }

    private static extractPictures(picturesStream: Buffer | null): Array<{ mime: string; base64: string }> {
        if (!picturesStream || picturesStream.length === 0) return [];
        const out: Array<{ mime: string; base64: string }> = [];

        // PNG scan
        const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        let idx = 0;
        while ((idx = picturesStream.indexOf(pngSig, idx)) !== -1) {
            const end = this.findPngEnd(picturesStream, idx);
            if (end > idx) {
                out.push({ mime: 'image/png', base64: picturesStream.slice(idx, end).toString('base64') });
                idx = end;
            } else {
                idx += pngSig.length;
            }
        }

        // JPEG scan
        idx = 0;
        while ((idx = picturesStream.indexOf(Buffer.from([0xff, 0xd8]), idx)) !== -1) {
            const end = picturesStream.indexOf(Buffer.from([0xff, 0xd9]), idx + 2);
            if (end !== -1) {
                out.push({
                    mime: 'image/jpeg',
                    base64: picturesStream.slice(idx, end + 2).toString('base64')
                });
                idx = end + 2;
            } else {
                break;
            }
        }

        return out;
    }

    private static findPngEnd(buf: Buffer, start: number): number {
        let off = start + 8;
        while (off + 12 <= buf.length) {
            const len = buf.readUInt32BE(off);
            const type = buf.slice(off + 4, off + 8).toString('ascii');
            off += 12 + len;
            if (type === 'IEND') return off;
        }
        return -1;
    }
}
