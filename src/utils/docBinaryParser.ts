import * as fs from 'fs';

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

interface CfbEntry {
    name: string;
    type: number;
    startSector: number;
    size: number;
}

interface CfbReader {
    getStream(name: string): Buffer | null;
}

export class DocBinaryParser {
    public static async parseToHtml(filePath: string): Promise<string> {
        const buffer = await fs.promises.readFile(filePath);
        const cfb = this.parseCfb(buffer);
        const wordStream = cfb.getStream('WordDocument');
        if (!wordStream) {
            throw new Error('Invalid .doc file: missing WordDocument stream.');
        }

        const texts = this.extractTexts(wordStream);
        if (texts.length === 0) {
            return '<div class="ov-doc-legacy-empty">No readable text content found in this .doc file.</div>';
        }

        const titleIndex = texts.findIndex((t) => this.isGoodTitleCandidate(t));
        const ordered = titleIndex > 0
            ? [texts[titleIndex], ...texts.slice(0, titleIndex), ...texts.slice(titleIndex + 1)]
            : texts;

        const blocks = ordered.slice(0, 400).map((line, idx) => {
            const escaped = this.escapeHtml(line);
            if (idx === 0) return `<h1>${escaped}</h1>`;
            return `<p>${escaped}</p>`;
        });

        return `<div class="ov-doc-legacy">${blocks.join('\n')}</div>`;
    }

    private static parseCfb(file: Buffer): CfbReader {
        if (file.length < 512) {
            throw new Error('Invalid CFB file: too small.');
        }
        if (file.slice(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') {
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
            const off = (sid + 1) * sectorSize;
            if (off < 0 || off + sectorSize > file.length) return Buffer.alloc(0);
            return file.slice(off, off + sectorSize);
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
            const max = sectorSize / 4 - 1;
            for (let j = 0; j < max; j++) {
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
            const out: Buffer[] = [];
            const seen = new Set<number>();
            let sid = startSid;
            while (sid >= 0 && sid !== ENDOFCHAIN && sid !== FREESECT) {
                if (seen.has(sid) || sid >= fat.length) break;
                seen.add(sid);
                const sec = readSector(sid);
                if (sec.length === 0) break;
                out.push(sec);
                sid = fat[sid];
            }
            return Buffer.concat(out);
        };

        const dirStream = readChain(firstDirSector);
        const entries: CfbEntry[] = [];
        for (let off = 0; off + 128 <= dirStream.length; off += 128) {
            const nameLength = dirStream.readUInt16LE(off + 64);
            const name = dirStream
                .slice(off, off + Math.max(0, nameLength - 2))
                .toString('utf16le')
                .replace(/\u0000/g, '');
            const type = dirStream.readUInt8(off + 66);
            const startSector = dirStream.readInt32LE(off + 116);
            const sizeLow = dirStream.readUInt32LE(off + 120);
            const sizeHigh = dirStream.readUInt32LE(off + 124);
            const size = sizeHigh > 0 ? Number(sizeLow) : sizeLow;
            entries.push({ name, type, startSector, size });
        }

        const root = entries.find((e) => e.type === 5);
        const miniStream = root ? readChain(root.startSector).slice(0, root.size) : Buffer.alloc(0);
        const miniFatData = readChain(firstMiniFatSector);
        const miniFat: number[] = [];
        for (let i = 0; i + 4 <= miniFatData.length && i / 4 < numMiniFatSectors * (sectorSize / 4); i += 4) {
            miniFat.push(miniFatData.readInt32LE(i));
        }

        const readMiniChain = (startMiniSid: number, size: number): Buffer => {
            if (startMiniSid < 0) return Buffer.alloc(0);
            const out: Buffer[] = [];
            const seen = new Set<number>();
            let sid = startMiniSid;
            while (sid >= 0 && sid !== ENDOFCHAIN && sid !== FREESECT) {
                if (seen.has(sid) || sid >= miniFat.length) break;
                seen.add(sid);
                const start = sid * miniSectorSize;
                const end = start + miniSectorSize;
                if (start < 0 || end > miniStream.length) break;
                out.push(miniStream.slice(start, end));
                sid = miniFat[sid];
            }
            return Buffer.concat(out).slice(0, size);
        };

        const streamMap = new Map<string, CfbEntry>();
        entries.forEach((e) => {
            if (e.name && e.type === 2) streamMap.set(e.name, e);
        });

        return {
            getStream: (name: string): Buffer | null => {
                const entry = streamMap.get(name);
                if (!entry) return null;
                if (entry.size < miniCutoff) {
                    return readMiniChain(entry.startSector, entry.size);
                }
                return readChain(entry.startSector).slice(0, entry.size);
            }
        };
    }

    private static extractTexts(wordStream: Buffer): string[] {
        const candidates: string[] = [];

        const utf16 = wordStream.toString('utf16le')
            .replace(/\u0000/g, '')
            .split(/[\r\n\t]+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 3 && /[A-Za-z0-9가-힣]/.test(s));
        candidates.push(...utf16);

        const latin = wordStream.toString('latin1')
            .split(/[\x00-\x1f]+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 5 && /[A-Za-z0-9]/.test(s));
        candidates.push(...latin);

        const dedup = new Set<string>();
        const out: string[] = [];
        candidates.forEach((raw) => {
            const text = this.normalizeText(raw);
            if (!text) return;
            if (this.isNoise(text)) return;
            if (dedup.has(text)) return;
            dedup.add(text);
            out.push(text);
        });

        return out;
    }

    private static isNoise(text: string): boolean {
        if (text.length < 3) return true;
        const lower = text.toLowerCase();
        if (/^(times new roman|arial|calibri|courier new)$/.test(lower)) return true;
        if (/^[_\W]+$/.test(text)) return true;
        if (!this.isMostlyReadable(text)) return true;
        if (!this.hasEnoughLetters(text)) return true;
        return false;
    }

    private static isMostlyReadable(text: string): boolean {
        let readable = 0;
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            const isPrintable = code >= 32 && code <= 126;
            const isKorean = code >= 0xac00 && code <= 0xd7a3;
            if (isPrintable || isKorean) readable += 1;
        }
        return readable / Math.max(1, text.length) >= 0.8;
    }

    private static normalizeText(raw: string): string {
        return (raw || '')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
            .replace(/[^\x20-\x7E\uAC00-\uD7A3]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private static hasEnoughLetters(text: string): boolean {
        const letters = (text.match(/[A-Za-z가-힣]/g) || []).length;
        return letters >= Math.max(3, Math.floor(text.length * 0.35));
    }

    private static isGoodTitleCandidate(text: string): boolean {
        if (!text) return false;
        if (!this.hasEnoughLetters(text)) return false;
        if (text.length < 6 || text.length > 120) return false;
        const words = text.split(/\s+/).filter(Boolean);
        return words.length >= 2;
    }

    private static escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
