import * as fs from 'fs';
import * as XLSX from 'xlsx';

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const ANSI_DECODERS = [
    { name: 'windows-1252', decoder: new TextDecoder('windows-1252') },
    { name: 'euc-kr', decoder: new TextDecoder('euc-kr') },
    { name: 'shift_jis', decoder: new TextDecoder('shift_jis') }
] as const;

interface CfbEntry {
    name: string;
    type: number;
    startSector: number;
    size: number;
}

interface CfbReader {
    getStream(name: string): Buffer | null;
    listStreams(): Array<{ name: string; size: number }>;
}

interface PieceTableCandidate {
    text: string;
    score: number;
    styledParagraphs?: StyledParagraph[];
    decodedSegments?: DecodedPieceSegment[];
}

interface FibInfo {
    nFib: number;
    tableStreamName: '0Table' | '1Table';
    ccpText: number;
    fcClx: number;
    lcbClx: number;
    fcPlcfBteChpx: number;
    lcbPlcfBteChpx: number;
    fcPlcfBtePapx: number;
    lcbPlcfBtePapx: number;
}

interface CharacterStyle {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    fontSizeHalfPoints?: number;
    color?: string;
    backgroundColor?: string;
    highlightColor?: string;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    marginLeftTwips?: number;
    marginRightTwips?: number;
    firstLineIndentTwips?: number;
    inTable?: boolean;
    isTableTerminator?: boolean;
    tableColumnCount?: number;
    tableColumnWidthsTwips?: number[];
    tableCellMerges?: TableCellMerge[];
}

interface CharacterStyleRun {
    fcStart: number;
    fcEnd: number;
    style: CharacterStyle;
}

interface ParagraphStyleRun {
    fcStart: number;
    fcEnd: number;
    style: CharacterStyle;
}

interface TableCellMerge {
    horzMerge: number;
    vertMerge: number;
}

interface DecodedPieceSegment {
    text: string;
    fcStart: number;
    bytesPerChar: number;
}

interface StyledParagraph {
    text: string;
    style?: CharacterStyle;
    runs?: Array<{ text: string; style?: CharacterStyle }>;
    listLevel?: number;
    inTable?: boolean;
    isTableTerminator?: boolean;
    tableColumnCount?: number;
    tableColumnWidthsTwips?: number[];
    tableCellMerges?: TableCellMerge[];
}

interface StyledLine {
    text: string;
    style?: CharacterStyle;
    runs?: Array<{ text: string; style?: CharacterStyle }>;
    listLevel?: number;
    inTable?: boolean;
    isTableTerminator?: boolean;
    tableColumnCount?: number;
    tableColumnWidthsTwips?: number[];
    tableCellMerges?: TableCellMerge[];
}

type LegacyBlock =
    | { kind: 'heading'; text: string; style?: CharacterStyle; runs?: Array<{ text: string; style?: CharacterStyle }> }
    | { kind: 'paragraph'; text: string; style?: CharacterStyle; runs?: Array<{ text: string; style?: CharacterStyle }> }
    | { kind: 'list'; ordered: boolean; items: Array<{ text: string; level: number; style?: CharacterStyle }> }
    | {
        kind: 'table';
        rows: Array<Array<{ text: string; colspan?: number; rowspan?: number }>>;
        columnWidthsTwips?: number[];
        cellMerges?: TableCellMerge[][];
    }
    | {
        kind: 'embedded-sheet';
        title: string;
        chart?: { type: 'bar' | 'line'; categories: string[]; series: Array<{ name: string; values: number[]; color: string }> };
        rows?: string[][];
    }
    | { kind: 'image-gallery'; images: Array<{ src: string; alt: string }> };

export class DocBinaryParser {
    public static async parseToHtml(filePath: string): Promise<string> {
        const buffer = await fs.promises.readFile(filePath);
        const cfb = this.parseCfb(buffer);
        const wordStream = cfb.getStream('WordDocument');
        if (!wordStream) {
            throw new Error('Invalid .doc file: missing WordDocument stream.');
        }

        const fib = this.parseFib(wordStream);
        const extracted = this.extractDocumentText(cfb, wordStream, fib);
        const images = this.extractImages(cfb);
        const embeddedTables = this.extractEmbeddedWorkbookTables(cfb);
        const html = this.renderHtml(extracted.text, images, extracted.styledParagraphs);
        if (html || embeddedTables.length > 0) {
            const baseHtml = html || '<div class="ov-doc-legacy"></div>';
            if (embeddedTables.length === 0) {
                return baseHtml;
            }

            const workbookBlocks = embeddedTables.flatMap((table) => {
                return [{
                    kind: 'embedded-sheet',
                    title: table.title,
                    chart: table.chart,
                    rows: table.showTable ? table.rows : undefined
                } satisfies LegacyBlock];
            });

            return baseHtml.replace(/<\/div>\s*$/, `${this.renderBlocks(workbookBlocks)}</div>`);
        }

        return '<div class="ov-doc-legacy-empty">No readable text content found in this .doc file.</div>';
    }

    private static extractDocumentText(cfb: CfbReader, wordStream: Buffer, fib: FibInfo): PieceTableCandidate {
        const candidates: PieceTableCandidate[] = [];
        const preferredTableStream = cfb.getStream(fib.tableStreamName);
        if (preferredTableStream) {
            const styleRuns = this.extractCharacterStyleRuns(wordStream, preferredTableStream, fib);
            const paragraphStyleRuns = this.extractParagraphStyleRuns(wordStream, preferredTableStream, fib);
            const clxCandidate = this.extractFromClx(wordStream, preferredTableStream, fib);
            if (clxCandidate) {
                clxCandidate.styledParagraphs = this.buildStyledParagraphs(clxCandidate, styleRuns, paragraphStyleRuns);
                candidates.push(clxCandidate);
            }

            const candidate = this.extractFromPieceTable(wordStream, preferredTableStream);
            if (candidate) {
                candidate.styledParagraphs = this.buildStyledParagraphs(candidate, styleRuns, paragraphStyleRuns);
                candidates.push(candidate);
            }
        }

        const bestCandidate = candidates.sort((a, b) => b.score - a.score)[0];
        if (bestCandidate && bestCandidate.text.trim().length >= 40) {
            return bestCandidate;
        }

        return {
            text: this.extractFallbackText(wordStream, cfb, fib),
            score: 0
        };
    }

    private static parseFib(wordStream: Buffer): FibInfo {
        if (wordStream.length < 32) {
            throw new Error('Invalid WordDocument stream: missing FIB base.');
        }

        const nFib = wordStream.readUInt16LE(2);
        const flags = wordStream.readUInt16LE(10);
        const tableStreamName = ((flags >> 9) & 0x0001) === 1 ? '1Table' : '0Table';

        let offset = 32;
        const csw = wordStream.readUInt16LE(offset);
        offset += 2 + csw * 2;

        const cslw = wordStream.readUInt16LE(offset);
        offset += 2;
        const fibRgLwOffset = offset;
        const fibRgLwLength = cslw * 4;
        const ccpText = fibRgLwLength >= 16 && fibRgLwOffset + 16 <= wordStream.length
            ? wordStream.readUInt32LE(fibRgLwOffset + 12)
            : 0;
        offset += fibRgLwLength;

        const cbRgFcLcb = wordStream.readUInt16LE(offset);
        offset += 2;
        const fibRgFcLcbOffset = offset;

        const readPair = (pairIndex: number): { fc: number; lcb: number } => {
            const pairOffset = fibRgFcLcbOffset + pairIndex * 8;
            if (pairIndex >= cbRgFcLcb || pairOffset + 8 > wordStream.length) {
                return { fc: 0, lcb: 0 };
            }

            return {
                fc: wordStream.readUInt32LE(pairOffset),
                lcb: wordStream.readUInt32LE(pairOffset + 4)
            };
        };

        const clx = readPair(33);
        const chpx = readPair(12);
        const papx = readPair(13);

        return {
            nFib,
            tableStreamName,
            ccpText,
            fcClx: clx.fc,
            lcbClx: clx.lcb,
            fcPlcfBteChpx: chpx.fc,
            lcbPlcfBteChpx: chpx.lcb,
            fcPlcfBtePapx: papx.fc,
            lcbPlcfBtePapx: papx.lcb
        };
    }

    private static extractFromClx(wordStream: Buffer, tableStream: Buffer, fib: FibInfo): PieceTableCandidate | null {
        if (fib.lcbClx <= 0 || fib.fcClx < 0 || fib.fcClx + fib.lcbClx > tableStream.length) {
            return null;
        }

        const clx = tableStream.subarray(fib.fcClx, fib.fcClx + fib.lcbClx);
        let offset = 0;

        while (offset < clx.length && clx[offset] === 0x01) {
            if (offset + 3 > clx.length) {
                return null;
            }
            const cbGrpprl = clx.readUInt16LE(offset + 1);
            offset += 3 + cbGrpprl;
        }

        if (offset + 5 > clx.length || clx[offset] !== 0x02) {
            return null;
        }

        const lcb = clx.readUInt32LE(offset + 1);
        if (lcb < 16 || offset + 5 + lcb > clx.length) {
            return null;
        }

        const plcPcd = clx.subarray(offset + 5, offset + 5 + lcb);
        const pieceCount = (lcb - 4) / 12;
        if (pieceCount <= 0 || !Number.isInteger(pieceCount)) {
            return null;
        }

        return this.decodePieceTable(wordStream, plcPcd, pieceCount, 2)
            ?? this.decodePieceTable(wordStream, plcPcd, pieceCount, 0);
    }

    private static extractFromPieceTable(wordStream: Buffer, tableStream: Buffer): PieceTableCandidate | null {
        let best: PieceTableCandidate | null = null;

        for (let offset = 0; offset + 5 < tableStream.length; offset++) {
            if (tableStream[offset] !== 0x02) {
                continue;
            }

            const lcb = tableStream.readUInt32LE(offset + 1);
            if (lcb < 16 || offset + 5 + lcb > tableStream.length) {
                continue;
            }
            if ((lcb - 4) % 12 !== 0) {
                continue;
            }

            const pieceCount = (lcb - 4) / 12;
            if (pieceCount <= 0 || pieceCount > 200000) {
                continue;
            }

            const plcPcd = tableStream.subarray(offset + 5, offset + 5 + lcb);
            for (const fcOffset of [2, 0]) {
                const candidate = this.decodePieceTable(wordStream, plcPcd, pieceCount, fcOffset);
                if (!candidate) {
                    continue;
                }

                if (!best || candidate.score > best.score) {
                    best = candidate;
                }
            }
        }

        return best;
    }

    private static decodePieceTable(
        wordStream: Buffer,
        plcPcd: Buffer,
        pieceCount: number,
        fcOffset: number
    ): PieceTableCandidate | null {
        const cpCount = pieceCount + 1;
        const cpByteLength = cpCount * 4;
        if (cpByteLength >= plcPcd.length) {
            return null;
        }

        const cps: number[] = [];
        for (let i = 0; i < cpCount; i++) {
            cps.push(plcPcd.readUInt32LE(i * 4));
        }

        if (!this.isValidCpSequence(cps)) {
            return null;
        }

        const decodedByAnsiDecoder = new Map<string, string[]>();
        const segmentsByAnsiDecoder = new Map<string, DecodedPieceSegment[]>();
        for (const { name } of ANSI_DECODERS) {
            decodedByAnsiDecoder.set(name, []);
            segmentsByAnsiDecoder.set(name, []);
        }

        for (let i = 0; i < pieceCount; i++) {
            const charCount = cps[i + 1] - cps[i];
            if (charCount <= 0) {
                continue;
            }

            const pcdOffset = cpByteLength + i * 8;
            if (pcdOffset + fcOffset + 4 > plcPcd.length) {
                return null;
            }

            const fcRaw = plcPcd.readUInt32LE(pcdOffset + fcOffset);
            const compressed = (fcRaw & 0x40000000) !== 0;
            const byteOffset = compressed ? ((fcRaw & 0x3fffffff) >>> 1) : (fcRaw & 0x3fffffff);
            const byteLength = compressed ? charCount : charCount * 2;

            if (byteOffset < 0 || byteLength < 0 || byteOffset + byteLength > wordStream.length) {
                return null;
            }

            const pieceBuffer = wordStream.subarray(byteOffset, wordStream.length >= byteOffset + byteLength ? byteOffset + byteLength : wordStream.length);
            if (compressed) {
                for (const { name, decoder } of ANSI_DECODERS) {
                    const pieceText = decoder.decode(pieceBuffer);
                    decodedByAnsiDecoder.get(name)?.push(pieceText);
                    segmentsByAnsiDecoder.get(name)?.push({
                        text: pieceText,
                        fcStart: byteOffset,
                        bytesPerChar: 1
                    });
                }
            } else {
                const pieceText = pieceBuffer.toString('utf16le');
                for (const { name } of ANSI_DECODERS) {
                    decodedByAnsiDecoder.get(name)?.push(pieceText);
                    segmentsByAnsiDecoder.get(name)?.push({
                        text: pieceText,
                        fcStart: byteOffset,
                        bytesPerChar: 2
                    });
                }
            }
        }

        return this.selectBestDecodedCandidate(decodedByAnsiDecoder, segmentsByAnsiDecoder, cps[0] === 0, pieceCount);
    }

    private static isValidCpSequence(cps: number[]): boolean {
        if (cps.length < 2) {
            return false;
        }

        for (let i = 1; i < cps.length; i++) {
            if (cps[i] < cps[i - 1]) {
                return false;
            }
        }

        const totalChars = cps[cps.length - 1] - cps[0];
        return totalChars > 0 && totalChars <= 10_000_000;
    }

    private static scoreExtractedText(text: string, startsAtZero: boolean, pieceCount: number): number {
        const paragraphs = text
            .split(/\n+/)
            .map((part) => part.trim())
            .filter(Boolean);
        const readableChars = (text.match(/[A-Za-z0-9가-힣]/g) || []).length;
        const penalty = (text.match(/[\uFFFD]/g) || []).length * 30;
        const hangulChars = (text.match(/[가-힣]/g) || []).length;
        const suspiciousGlyphs = (text.match(/[ÃÂÐÑØÞãäåæçðñøþ]/g) || []).length * 12;
        const controlLike = (text.match(/[^\x20-\x7E\u00A0-\u024F\u3131-\u318E\uAC00-\uD7A3\r\n\t]/g) || []).length * 6;

        return text.length
            + paragraphs.length * 120
            + readableChars * 2
            + hangulChars * 3
            + (startsAtZero ? 200 : 0)
            + Math.min(pieceCount, 2000)
            - penalty
            - suspiciousGlyphs
            - controlLike;
    }

    private static extractFallbackText(wordStream: Buffer, cfb: CfbReader, fib: FibInfo): string {
        const sources = [
            wordStream,
            cfb.getStream(fib.tableStreamName)
        ].filter((buffer): buffer is Buffer => Boolean(buffer));

        const utf16Candidates: string[] = [];
        const ansiCandidates = new Map<string, string[]>();
        for (const { name } of ANSI_DECODERS) {
            ansiCandidates.set(name, []);
        }

        for (const source of sources) {
            utf16Candidates.push(...this.extractReadableSegments(source.toString('utf16le')));
            for (const { name, decoder } of ANSI_DECODERS) {
                ansiCandidates.get(name)?.push(...this.extractReadableSegments(decoder.decode(source)));
            }
        }

        const baseUtf16 = this.dedupeSegments(utf16Candidates);
        let best = '';
        let bestScore = Number.NEGATIVE_INFINITY;

        for (const { name } of ANSI_DECODERS) {
            const combined = this.dedupeSegments([...baseUtf16, ...(ansiCandidates.get(name) ?? [])]);
            const normalized = this.normalizeDocumentText(combined.join('\n\n'));
            if (normalized.length < 20) {
                continue;
            }

            const score = this.scoreExtractedText(normalized, true, combined.length);
            if (score > bestScore) {
                best = normalized;
                bestScore = score;
            }
        }

        return best;
    }

    private static extractCharacterStyleRuns(wordStream: Buffer, tableStream: Buffer, fib: FibInfo): CharacterStyleRun[] {
        if (fib.lcbPlcfBteChpx <= 4 || fib.fcPlcfBteChpx < 0 || fib.fcPlcfBteChpx + fib.lcbPlcfBteChpx > tableStream.length) {
            return [];
        }

        const plcf = tableStream.subarray(fib.fcPlcfBteChpx, fib.fcPlcfBteChpx + fib.lcbPlcfBteChpx);
        if ((plcf.length - 4) % 8 !== 0) {
            return [];
        }

        const runCount = (plcf.length - 4) / 8;
        const fcOffsets: number[] = [];
        for (let i = 0; i < runCount + 1; i++) {
            fcOffsets.push(plcf.readUInt32LE(i * 4));
        }

        const runs: CharacterStyleRun[] = [];
        const pnOffset = (runCount + 1) * 4;
        for (let i = 0; i < runCount; i++) {
            const pnValue = plcf.readUInt32LE(pnOffset + i * 4);
            const pn = pnValue & 0x003fffff;
            const fkpOffset = pn * 512;
            if (pn <= 0 || fkpOffset < 0 || fkpOffset + 512 > wordStream.length) {
                continue;
            }

            const page = wordStream.subarray(fkpOffset, fkpOffset + 512);
            runs.push(...this.parseChpxFkp(page, fcOffsets[i], fcOffsets[i + 1]));
        }

        return runs.sort((a, b) => a.fcStart - b.fcStart || a.fcEnd - b.fcEnd);
    }

    private static extractParagraphStyleRuns(wordStream: Buffer, tableStream: Buffer, fib: FibInfo): ParagraphStyleRun[] {
        if (fib.lcbPlcfBtePapx <= 4 || fib.fcPlcfBtePapx < 0 || fib.fcPlcfBtePapx + fib.lcbPlcfBtePapx > tableStream.length) {
            return [];
        }

        const plcf = tableStream.subarray(fib.fcPlcfBtePapx, fib.fcPlcfBtePapx + fib.lcbPlcfBtePapx);
        if ((plcf.length - 4) % 8 !== 0) {
            return [];
        }

        const runCount = (plcf.length - 4) / 8;
        const fcOffsets: number[] = [];
        for (let i = 0; i < runCount + 1; i++) {
            fcOffsets.push(plcf.readUInt32LE(i * 4));
        }

        const runs: ParagraphStyleRun[] = [];
        const pnOffset = (runCount + 1) * 4;
        for (let i = 0; i < runCount; i++) {
            const pnValue = plcf.readUInt32LE(pnOffset + i * 4);
            const pn = pnValue & 0x003fffff;
            const fkpOffset = pn * 512;
            if (pn <= 0 || fkpOffset < 0 || fkpOffset + 512 > wordStream.length) {
                continue;
            }

            const page = wordStream.subarray(fkpOffset, fkpOffset + 512);
            runs.push(...this.parsePapxFkp(page, fcOffsets[i], fcOffsets[i + 1]));
        }

        return runs.sort((a, b) => a.fcStart - b.fcStart || a.fcEnd - b.fcEnd);
    }

    private static parsePapxFkp(page: Buffer, pageStartFc: number, pageEndFc: number): ParagraphStyleRun[] {
        const crun = page[511];
        if (crun <= 0 || 4 * (crun + 1) > 511) {
            return [];
        }

        const rgfc: number[] = [];
        for (let i = 0; i < crun + 1; i++) {
            rgfc.push(page.readUInt32LE(i * 4));
        }

        const rgbxOffset = 4 * (crun + 1);
        const runs: ParagraphStyleRun[] = [];
        for (let i = 0; i < crun; i++) {
            const fcStart = rgfc[i];
            const fcEnd = rgfc[i + 1];
            if (fcStart >= fcEnd || fcEnd <= pageStartFc || fcStart >= pageEndFc) {
                continue;
            }

            const bxOffset = rgbxOffset + i * 13;
            if (bxOffset + 13 > 511) {
                break;
            }

            const papxWordOffset = page.readUInt16LE(bxOffset);
            const papxOffset = papxWordOffset * 2;
            if (papxOffset <= 0 || papxOffset >= 511) {
                continue;
            }

            const papx = this.parsePapxInFkp(page, papxOffset);
            if (!papx || !this.hasParagraphLayoutStyle(papx)) {
                continue;
            }

            runs.push({ fcStart, fcEnd, style: papx });
        }

        return runs;
    }

    private static parsePapxInFkp(page: Buffer, papxOffset: number): CharacterStyle | null {
        if (papxOffset >= 511) {
            return null;
        }

        const cb = page[papxOffset];
        let grpprlOffset = papxOffset + 1;
        let grpprlLength = 0;

        if (cb === 0) {
            if (grpprlOffset >= 511) {
                return null;
            }
            const cbExtended = page[grpprlOffset];
            grpprlOffset += 1;
            grpprlLength = cbExtended * 2;
        } else {
            grpprlLength = Math.max(0, (cb * 2) - 1);
        }

        if (grpprlOffset + grpprlLength > 511 || grpprlLength < 2) {
            return null;
        }

        const grpprlAndIstd = page.subarray(grpprlOffset, grpprlOffset + grpprlLength);
        const grpprl = grpprlAndIstd.subarray(2);
        return this.parseParagraphGrpprl(grpprl);
    }

    private static parseParagraphGrpprl(grpprl: Buffer): CharacterStyle {
        const style: CharacterStyle = {};
        let offset = 0;

        while (offset + 2 <= grpprl.length) {
            const sprm = grpprl.readUInt16LE(offset);
            const operandLength = this.getSprmOperandLength(sprm, grpprl, offset + 2);
            if (operandLength < 0 || offset + 2 + operandLength > grpprl.length) {
                break;
            }

            const operandOffset = offset + 2;
            switch (sprm) {
            case 0x2403:
                style.textAlign = this.parseParagraphAlignment(grpprl[operandOffset]);
                break;
            case 0x2416:
                style.inTable = grpprl[operandOffset] !== 0;
                break;
            case 0x2417:
                style.isTableTerminator = grpprl[operandOffset] !== 0;
                break;
            case 0xD608:
                {
                    const tableDef = this.parseTDefTableOperand(grpprl.subarray(operandOffset, operandOffset + operandLength));
                    if (tableDef) {
                        style.tableColumnCount = tableDef.columnCount;
                        style.tableColumnWidthsTwips = tableDef.columnWidthsTwips;
                        style.tableCellMerges = tableDef.cellMerges;
                    }
                }
                break;
            case 0xC64D:
                if (operandLength >= 10) {
                    const shading = this.parseShdOperand(grpprl.subarray(operandOffset, operandOffset + 10));
                    if (shading.backgroundColor) {
                        style.backgroundColor = shading.backgroundColor;
                    }
                }
                break;
            case 0x845E:
                if (operandLength >= 2) {
                    style.marginLeftTwips = grpprl.readInt16LE(operandOffset);
                }
                break;
            case 0x845D:
                if (operandLength >= 2) {
                    style.marginRightTwips = grpprl.readInt16LE(operandOffset);
                }
                break;
            case 0x8460:
                if (operandLength >= 2) {
                    style.firstLineIndentTwips = grpprl.readInt16LE(operandOffset);
                }
                break;
            default:
                break;
            }

            offset += 2 + operandLength;
        }

        return style;
    }

    private static parseTDefTableOperand(
        buffer: Buffer
    ): { columnCount: number; columnWidthsTwips: number[]; cellMerges: TableCellMerge[] } | undefined {
        if (buffer.length < 4) {
            return undefined;
        }

        const dataOffset = buffer[1] === 0 && buffer.length >= 4 ? 2 : 1;
        const itcMac = buffer[dataOffset];
        if (itcMac < 1 || itcMac > 63) {
            return undefined;
        }

        const expectedCentersLength = dataOffset + 1 + ((itcMac + 1) * 2);
        if (buffer.length < expectedCentersLength) {
            return undefined;
        }

        const boundaries: number[] = [];
        for (let index = 0; index < itcMac + 1; index++) {
            boundaries.push(buffer.readInt16LE(dataOffset + 1 + index * 2));
        }

        const columnWidthsTwips: number[] = [];
        for (let index = 0; index < itcMac; index++) {
            columnWidthsTwips.push(Math.max(0, boundaries[index + 1] - boundaries[index]));
        }

        const cellMerges: TableCellMerge[] = [];
        const tc80Offset = expectedCentersLength;
        const remaining = buffer.length - tc80Offset;
        const tc80Size = itcMac > 0 && remaining >= itcMac * 2 && remaining % itcMac === 0
            ? Math.floor(remaining / itcMac)
            : 0;

        if (tc80Size >= 2) {
            for (let index = 0; index < itcMac; index++) {
                const offset = tc80Offset + index * tc80Size;
                const tcgrf = buffer.readUInt16LE(offset);
                cellMerges.push({
                    horzMerge: tcgrf & 0x0003,
                    vertMerge: (tcgrf >> 5) & 0x0003
                });
            }
        }

        return {
            columnCount: itcMac,
            columnWidthsTwips,
            cellMerges
        };
    }

    private static parseChpxFkp(page: Buffer, pageStartFc: number, pageEndFc: number): CharacterStyleRun[] {
        const crun = page[511];
        if (crun <= 0 || 4 * (crun + 1) > 511) {
            return [];
        }

        const rgfc: number[] = [];
        for (let i = 0; i < crun + 1; i++) {
            rgfc.push(page.readUInt32LE(i * 4));
        }

        const rgbOffset = 4 * (crun + 1);
        const runs: CharacterStyleRun[] = [];
        for (let i = 0; i < crun; i++) {
            const fcStart = rgfc[i];
            const fcEnd = rgfc[i + 1];
            if (fcStart >= fcEnd || fcEnd <= pageStartFc || fcStart >= pageEndFc) {
                continue;
            }

            const chpxOffset = page[rgbOffset + i] * 2;
            if (chpxOffset <= 0 || chpxOffset >= 511) {
                continue;
            }

            const grpprlLength = page[chpxOffset];
            const grpprlStart = chpxOffset + 1;
            const grpprlEnd = Math.min(511, grpprlStart + grpprlLength);
            if (grpprlStart >= grpprlEnd) {
                continue;
            }

            const style = this.parseCharacterGrpprl(page.subarray(grpprlStart, grpprlEnd));
            if (!this.hasCharacterStyle(style)) {
                continue;
            }

            runs.push({
                fcStart,
                fcEnd,
                style
            });
        }

        return runs;
    }

    private static parseCharacterGrpprl(grpprl: Buffer): CharacterStyle {
        const style: CharacterStyle = {};
        let offset = 0;

        while (offset + 2 <= grpprl.length) {
            const sprm = grpprl.readUInt16LE(offset);
            const operandLength = this.getSprmOperandLength(sprm, grpprl, offset + 2);
            if (operandLength < 0 || offset + 2 + operandLength > grpprl.length) {
                break;
            }

            const operandOffset = offset + 2;
            switch (sprm) {
            case 0x0835:
                style.bold = grpprl[operandOffset] !== 0;
                break;
            case 0x0836:
                style.italic = grpprl[operandOffset] !== 0;
                break;
            case 0x2A3E:
                style.underline = grpprl[operandOffset] !== 0;
                break;
            case 0x4A43:
                if (operandLength >= 2) {
                    style.fontSizeHalfPoints = grpprl.readUInt16LE(operandOffset);
                }
                break;
            case 0x6870:
                if (operandLength >= 4) {
                    style.color = this.parseColorRef(grpprl.subarray(operandOffset, operandOffset + 4));
                }
                break;
            case 0xCA71:
                if (operandLength >= 10) {
                    const shading = this.parseShdOperand(grpprl.subarray(operandOffset, operandOffset + 10));
                    if (shading.foregroundColor) {
                        style.color = style.color ?? shading.foregroundColor;
                    }
                    if (shading.backgroundColor) {
                        style.backgroundColor = shading.backgroundColor;
                    }
                }
                break;
            case 0x2A0C:
                if (operandLength >= 1) {
                    style.highlightColor = this.parseHighlightIco(grpprl[operandOffset]);
                }
                break;
            default:
                break;
            }

            offset += 2 + operandLength;
        }

        return style;
    }

    private static getSprmOperandLength(sprm: number, buffer: Buffer, operandOffset: number): number {
        const spra = (sprm >> 13) & 0x7;
        switch (spra) {
        case 0:
        case 1:
            return 1;
        case 2:
        case 4:
        case 5:
            return 2;
        case 3:
            return 4;
        case 6:
            return operandOffset < buffer.length ? 1 + buffer[operandOffset] : -1;
        case 7:
            return 3;
        default:
            return -1;
        }
    }

    private static hasCharacterStyle(style: CharacterStyle | undefined): boolean {
        return Boolean(
            style && (
                style.bold
                || style.italic
                || style.underline
                || style.fontSizeHalfPoints
                || style.color
                || style.backgroundColor
                || style.highlightColor
            )
        );
    }

    private static parseColorRef(buffer: Buffer): string | undefined {
        if (buffer.length < 4 || buffer[3] === 0xFF) {
            return undefined;
        }

        const red = buffer[0];
        const green = buffer[1];
        const blue = buffer[2];
        return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
    }

    private static parseShdOperand(buffer: Buffer): { foregroundColor?: string; backgroundColor?: string } {
        if (buffer.length < 10) {
            return {};
        }

        const foregroundColor = this.parseColorRef(buffer.subarray(0, 4));
        const backgroundColor = this.sanitizeRenderableBackground(this.parseColorRef(buffer.subarray(4, 8)));
        const pattern = buffer.readUInt16LE(8);

        if (pattern === 0) {
            return { foregroundColor };
        }

        return {
            foregroundColor,
            backgroundColor: backgroundColor ?? this.sanitizeRenderableBackground(foregroundColor)
        };
    }

    private static parseHighlightIco(value: number): string | undefined {
        const highlightMap: Record<number, string> = {
            1: '#000000',
            2: '#0000ff',
            3: '#00ffff',
            4: '#00ff00',
            5: '#ff00ff',
            6: '#ff0000',
            7: '#ffff00',
            8: '#ffffff',
            9: '#00008b',
            10: '#008b8b',
            11: '#006400',
            12: '#8b008b',
            13: '#8b0000',
            14: '#808000',
            15: '#808080',
            16: '#d3d3d3'
        };

        return highlightMap[value];
    }

    private static sanitizeRenderableBackground(color: string | undefined): string | undefined {
        if (!color) {
            return undefined;
        }

        const rgb = this.parseHexColor(color);
        if (!rgb) {
            return undefined;
        }

        const luminance = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
        if (luminance < 48) {
            return undefined;
        }

        return color;
    }

    private static parseHexColor(color: string): { r: number; g: number; b: number } | undefined {
        const match = color.match(/^#([0-9a-f]{6})$/i);
        if (!match) {
            return undefined;
        }

        const hex = match[1];
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16)
        };
    }

    private static buildStyledParagraphs(
        candidate: PieceTableCandidate,
        styleRuns: CharacterStyleRun[],
        paragraphStyleRuns: ParagraphStyleRun[]
    ): StyledParagraph[] | undefined {
        if ((!styleRuns.length && !paragraphStyleRuns.length) || !candidate.decodedSegments || candidate.decodedSegments.length === 0) {
            return undefined;
        }

        return this.enrichStructuredTableParagraphs(
            this.buildStyledParagraphsFromSegments(candidate.decodedSegments, styleRuns, paragraphStyleRuns)
        );
    }

    private static enrichStructuredTableParagraphs(paragraphs: StyledParagraph[]): StyledParagraph[] {
        if (paragraphs.length === 0) {
            return paragraphs;
        }

        const enriched = paragraphs.map((paragraph) => ({
            ...paragraph,
            style: paragraph.style ? { ...paragraph.style } : undefined,
            runs: paragraph.runs?.map((run) => ({
                ...run,
                style: run.style ? { ...run.style } : undefined
            }))
        }));

        let rowStart = -1;
        for (let index = 0; index < enriched.length; index++) {
            const paragraph = enriched[index];
            if (!paragraph.inTable) {
                rowStart = -1;
                continue;
            }

            if (rowStart < 0) {
                rowStart = index;
            }

            if (!paragraph.isTableTerminator) {
                continue;
            }

            for (let rowIndex = rowStart; rowIndex <= index; rowIndex++) {
                const target = enriched[rowIndex];
                target.tableColumnCount = target.tableColumnCount ?? paragraph.tableColumnCount;
                target.tableColumnWidthsTwips = target.tableColumnWidthsTwips ?? paragraph.tableColumnWidthsTwips;
                target.tableCellMerges = target.tableCellMerges ?? paragraph.tableCellMerges;
                if (paragraph.style?.backgroundColor && !target.style?.backgroundColor) {
                    target.style = this.mergeStyles(target.style, { backgroundColor: paragraph.style.backgroundColor });
                }
            }

            rowStart = -1;
        }

        return enriched;
    }

    private static buildStyledParagraphsFromSegments(
        segments: DecodedPieceSegment[],
        styleRuns: CharacterStyleRun[],
        paragraphStyleRuns: ParagraphStyleRun[]
    ): StyledParagraph[] {
        const paragraphs: StyledParagraph[] = [];
        let currentText = '';
        let currentRuns: Array<{ text: string; style?: CharacterStyle }> = [];
        let currentRunText = '';
        let currentRunStyle: CharacterStyle | undefined;
        let currentParagraphStyle: CharacterStyle = {};
        let visibleCount = 0;
        let boldCount = 0;
        let italicCount = 0;
        let underlineCount = 0;
        const fontSizes = new Map<number, number>();
        const textColors = new Map<string, number>();
        const backgroundColors = new Map<string, number>();
        const highlightColors = new Map<string, number>();

        const flushRun = () => {
            if (currentRunText.length === 0) {
                return;
            }

            currentRuns.push({
                text: currentRunText,
                style: currentRunStyle
            });
            currentRunText = '';
            currentRunStyle = undefined;
        };

        const flushParagraph = () => {
            flushRun();
            const normalized = this.normalizeParagraphText(currentText, true);
            if (normalized.length > 0 || currentParagraphStyle.inTable || currentParagraphStyle.isTableTerminator) {
                const style: CharacterStyle = {};
                if (visibleCount > 0) {
                    if (boldCount / visibleCount >= 0.55) style.bold = true;
                    if (italicCount / visibleCount >= 0.55) style.italic = true;
                    if (underlineCount / visibleCount >= 0.55) style.underline = true;

                    let bestFontSize = 0;
                    let bestFontCount = 0;
                    for (const [fontSize, count] of Array.from(fontSizes.entries())) {
                        if (count > bestFontCount) {
                            bestFontSize = fontSize;
                            bestFontCount = count;
                        }
                    }
                    if (bestFontSize >= 2 && bestFontCount / visibleCount >= 0.45) {
                        style.fontSizeHalfPoints = bestFontSize;
                    }

                    const dominantColor = this.pickDominantStyleValue(textColors, visibleCount, 0.45);
                    if (dominantColor) {
                        style.color = dominantColor;
                    }

                    const dominantBackground = this.pickDominantStyleValue(backgroundColors, visibleCount, 0.45);
                    if (dominantBackground) {
                        style.backgroundColor = dominantBackground;
                    }

                    const dominantHighlight = this.pickDominantStyleValue(highlightColors, visibleCount, 0.35);
                    if (dominantHighlight) {
                        style.highlightColor = dominantHighlight;
                    }
                }

                paragraphs.push({
                    text: normalized,
                    style: this.mergeStyles(currentParagraphStyle, this.hasCharacterStyle(style) ? style : undefined),
                    runs: this.normalizeInlineRuns(currentRuns),
                    listLevel: this.inferListLevel(currentParagraphStyle),
                    inTable: Boolean(currentParagraphStyle.inTable),
                    isTableTerminator: Boolean(currentParagraphStyle.isTableTerminator),
                    tableColumnCount: currentParagraphStyle.tableColumnCount,
                    tableColumnWidthsTwips: currentParagraphStyle.tableColumnWidthsTwips,
                    tableCellMerges: currentParagraphStyle.tableCellMerges
                });
            }

            currentText = '';
            currentRuns = [];
            currentRunText = '';
            currentRunStyle = undefined;
            currentParagraphStyle = {};
            visibleCount = 0;
            boldCount = 0;
            italicCount = 0;
            underlineCount = 0;
            fontSizes.clear();
            textColors.clear();
            backgroundColors.clear();
            highlightColors.clear();
        };

        for (const segment of segments) {
            for (let index = 0; index < segment.text.length; index++) {
                const char = segment.text[index];
                const code = char.charCodeAt(0);
                const fc = segment.fcStart + index * segment.bytesPerChar;
                const paragraphStyle = this.findParagraphStyleForFc(paragraphStyleRuns, fc);

                if (char === '\r' || code === 0x0007 || code === 0x000b) {
                    if (paragraphStyle) {
                        currentParagraphStyle = this.mergeStyles(currentParagraphStyle, paragraphStyle) ?? currentParagraphStyle;
                    }
                    flushParagraph();
                    continue;
                }
                if (code < 32 && char !== '\t') {
                    continue;
                }

                const style = this.findCharacterStyleForFc(styleRuns, fc);
                if (paragraphStyle) {
                    currentParagraphStyle = this.mergeStyles(currentParagraphStyle, paragraphStyle) ?? currentParagraphStyle;
                }

                currentText += char;
                if (!this.areCharacterStylesEqual(currentRunStyle, style)) {
                    flushRun();
                    currentRunStyle = style ? { ...style } : undefined;
                }
                currentRunText += char;
                if (!/\s/.test(char)) {
                    visibleCount += 1;
                    if (style?.bold) boldCount += 1;
                    if (style?.italic) italicCount += 1;
                    if (style?.underline) underlineCount += 1;
                    if (style?.fontSizeHalfPoints) {
                        fontSizes.set(style.fontSizeHalfPoints, (fontSizes.get(style.fontSizeHalfPoints) ?? 0) + 1);
                    }
                    if (style?.color) {
                        textColors.set(style.color, (textColors.get(style.color) ?? 0) + 1);
                    }
                    if (style?.backgroundColor) {
                        backgroundColors.set(style.backgroundColor, (backgroundColors.get(style.backgroundColor) ?? 0) + 1);
                    }
                    if (style?.highlightColor) {
                        highlightColors.set(style.highlightColor, (highlightColors.get(style.highlightColor) ?? 0) + 1);
                    }
                }
            }
        }

        flushParagraph();
        return paragraphs;
    }

    private static normalizeInlineRuns(runs: Array<{ text: string; style?: CharacterStyle }>): Array<{ text: string; style?: CharacterStyle }> | undefined {
        const normalizedRuns: Array<{ text: string; style?: CharacterStyle }> = [];

        for (const run of runs) {
            const text = run.text.replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ');
            if (text.length === 0) {
                continue;
            }

            const previous = normalizedRuns[normalizedRuns.length - 1];
            if (previous && this.areCharacterStylesEqual(previous.style, run.style)) {
                previous.text += text;
                continue;
            }

            normalizedRuns.push({
                text,
                style: run.style
            });
        }

        return normalizedRuns.length > 0 ? normalizedRuns : undefined;
    }

    private static findCharacterStyleForFc(styleRuns: CharacterStyleRun[], fc: number): CharacterStyle | undefined {
        for (let index = styleRuns.length - 1; index >= 0; index--) {
            const run = styleRuns[index];
            if (fc >= run.fcStart && fc < run.fcEnd) {
                return run.style;
            }
            if (fc >= run.fcEnd) {
                break;
            }
        }
        return undefined;
    }

    private static findParagraphStyleForFc(styleRuns: ParagraphStyleRun[], fc: number): CharacterStyle | undefined {
        for (let index = styleRuns.length - 1; index >= 0; index--) {
            const run = styleRuns[index];
            if (fc >= run.fcStart && fc < run.fcEnd) {
                return run.style;
            }
            if (fc >= run.fcEnd) {
                break;
            }
        }
        return undefined;
    }

    private static areCharacterStylesEqual(left?: CharacterStyle, right?: CharacterStyle): boolean {
        return Boolean(left?.bold) === Boolean(right?.bold)
            && Boolean(left?.italic) === Boolean(right?.italic)
            && Boolean(left?.underline) === Boolean(right?.underline)
            && (left?.fontSizeHalfPoints ?? 0) === (right?.fontSizeHalfPoints ?? 0)
            && (left?.color ?? '') === (right?.color ?? '')
            && (left?.backgroundColor ?? '') === (right?.backgroundColor ?? '')
            && (left?.highlightColor ?? '') === (right?.highlightColor ?? '')
            && (left?.textAlign ?? 'left') === (right?.textAlign ?? 'left')
            && (left?.marginLeftTwips ?? 0) === (right?.marginLeftTwips ?? 0)
            && (left?.marginRightTwips ?? 0) === (right?.marginRightTwips ?? 0)
            && (left?.firstLineIndentTwips ?? 0) === (right?.firstLineIndentTwips ?? 0)
            && Boolean(left?.inTable) === Boolean(right?.inTable)
            && Boolean(left?.isTableTerminator) === Boolean(right?.isTableTerminator)
            && (left?.tableColumnCount ?? 0) === (right?.tableColumnCount ?? 0);
    }

    private static hasParagraphLayoutStyle(style: CharacterStyle | undefined): boolean {
        return Boolean(
            style && (
                style.textAlign
                || style.marginLeftTwips
                || style.marginRightTwips
                || style.firstLineIndentTwips
                || style.inTable
                || style.isTableTerminator
                || style.tableColumnCount
            )
        );
    }

    private static parseParagraphAlignment(value: number): 'left' | 'center' | 'right' | 'justify' | undefined {
        switch (value) {
        case 1:
            return 'center';
        case 2:
            return 'right';
        case 3:
        case 4:
            return 'justify';
        case 0:
        default:
            return 'left';
        }
    }

    private static inferListLevel(style: CharacterStyle | undefined): number {
        if (!style) {
            return 0;
        }

        const indent = Math.max(0, style.marginLeftTwips ?? 0);
        const hanging = Math.max(0, -(style.firstLineIndentTwips ?? 0));
        const effectiveIndent = Math.max(indent, hanging);
        return Math.max(0, Math.min(6, Math.round(effectiveIndent / 360) - 1));
    }

    private static mergeStyles(base?: CharacterStyle, override?: CharacterStyle): CharacterStyle | undefined {
        if (!base && !override) {
            return undefined;
        }

        return {
            ...base,
            ...override
        };
    }

    private static pickDominantStyleValue(values: Map<string, number>, visibleCount: number, threshold: number): string | undefined {
        let bestValue: string | undefined;
        let bestCount = 0;

        for (const [value, count] of Array.from(values.entries())) {
            if (count > bestCount) {
                bestValue = value;
                bestCount = count;
            }
        }

        return bestValue && visibleCount > 0 && bestCount / visibleCount >= threshold
            ? bestValue
            : undefined;
    }

    private static selectBestDecodedCandidate(
        decodedByAnsiDecoder: Map<string, string[]>,
        segmentsByAnsiDecoder: Map<string, DecodedPieceSegment[]>,
        startsAtZero: boolean,
        pieceCount: number
    ): PieceTableCandidate | null {
        let best: PieceTableCandidate | null = null;

        for (const { name } of ANSI_DECODERS) {
            const normalized = this.normalizeDocumentText((decodedByAnsiDecoder.get(name) ?? []).join(''));
            if (normalized.length < 20) {
                continue;
            }

            const candidate = {
                text: normalized,
                score: this.scoreExtractedText(normalized, startsAtZero, pieceCount),
                decodedSegments: segmentsByAnsiDecoder.get(name) ?? []
            };
            if (!best || candidate.score > best.score) {
                best = candidate;
            }
        }

        return best;
    }

    private static extractReadableSegments(raw: string): string[] {
        return raw
            .replace(/\u0000/g, '')
            .split(/[\r\n\t\x00-\x1f]+/)
            .map((text) => this.normalizeParagraphText(text))
            .filter((text) => text.length >= 3 && /[A-Za-z0-9가-힣]/.test(text));
    }

    private static dedupeSegments(candidates: string[]): string[] {
        const deduped: string[] = [];
        const seen = new Set<string>();
        for (const raw of candidates) {
            const normalized = this.normalizeParagraphText(raw);
            if (!normalized || this.isNoise(normalized) || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            deduped.push(normalized);
        }

        return deduped;
    }

    private static renderHtml(
        rawText: string,
        images: Array<{ src: string; alt: string }>,
        styledParagraphs?: StyledParagraph[]
    ): string {
        const rawLines: StyledLine[] = styledParagraphs && styledParagraphs.length > 0
            ? styledParagraphs
                .map((entry) => ({
                    text: this.normalizeParagraphText(entry.text, true),
                    style: entry.style,
                    runs: entry.runs,
                    listLevel: entry.listLevel,
                    inTable: entry.inTable,
                    isTableTerminator: entry.isTableTerminator,
                    tableColumnCount: entry.tableColumnCount,
                    tableColumnWidthsTwips: entry.tableColumnWidthsTwips,
                    tableCellMerges: entry.tableCellMerges
                }))
                .filter((entry) => entry.text.length > 0 || entry.inTable || entry.isTableTerminator)
            : rawText
                .split(/\n+/)
                .map((text) => ({ text: this.normalizeParagraphText(text, true) }))
                .filter((entry) => entry.text.length > 0);
        const lines = rawLines.filter((line, index) => line.inTable || line.isTableTerminator || !this.shouldDropLine(line.text, rawLines[index - 1]?.text || '', rawLines[index + 1]?.text || ''));

        if (lines.length === 0 && images.length === 0) {
            return '';
        }

        const blocks = this.buildBlocks(lines);
        if (images.length > 0) {
            blocks.push({ kind: 'image-gallery', images });
        }

        return `<div class="ov-doc-legacy">${this.renderBlocks(blocks)}</div>`;
    }

    private static buildBlocks(lines: StyledLine[]): LegacyBlock[] {
        const blocks: LegacyBlock[] = [];
        let index = 0;

        while (index < lines.length) {
            const line = lines[index];
            const text = line.text;
            if (index === 0 && text.length <= 120 && this.hasEnoughLetters(text)) {
                blocks.push({ kind: 'heading', text: this.normalizeParagraphText(text), style: line.style, runs: line.runs });
                index += 1;
                continue;
            }

            const structuredTable = this.collectStructuredTable(lines, index);
            if (structuredTable) {
                blocks.push({
                    kind: 'table',
                    rows: this.buildTableCells(structuredTable.rows, structuredTable.cellMerges),
                    columnWidthsTwips: structuredTable.columnWidthsTwips,
                    cellMerges: structuredTable.cellMerges
                });
                index = structuredTable.nextIndex;
                continue;
            }

            const definitionSection = this.collectDefinitionSection(lines.map((entry) => entry.text), index);
            if (definitionSection) {
                blocks.push({ kind: 'heading', text: definitionSection.heading });
                blocks.push({ kind: 'table', rows: this.buildTableCells(definitionSection.rows) });
                index = definitionSection.nextIndex;
                continue;
            }

            if (this.looksLikeSectionHeading(text, lines[index - 1]?.text || '', lines[index + 1]?.text || '')) {
                blocks.push({ kind: 'heading', text: this.normalizeParagraphText(text), style: line.style, runs: line.runs });
                index += 1;
                continue;
            }

            const plainLines = lines.map((entry) => entry.text);
            const definitionTable = this.collectDefinitionTable(plainLines, index);
            if (definitionTable) {
                blocks.push({ kind: 'table', rows: this.buildTableCells(definitionTable.rows) });
                index = definitionTable.nextIndex;
                continue;
            }

            const table = this.collectTableRows(plainLines, index);
            if (table) {
                blocks.push({ kind: 'table', rows: this.buildTableCells(table.rows) });
                index = table.nextIndex;
                continue;
            }

            const listKind = this.getListKind(text);
            if (listKind) {
                const items: Array<{ text: string; level: number; style?: CharacterStyle }> = [];
                while (index < lines.length) {
                    const currentLine = lines[index];
                    const match = this.getListKind(currentLine.text);
                    if (!match || match.kind !== listKind.kind) {
                        break;
                    }
                    items.push({
                        text: this.normalizeParagraphText(currentLine.text.replace(match.pattern, '').trim()),
                        level: currentLine.listLevel ?? 0,
                        style: currentLine.style
                    });
                    index += 1;
                }
                blocks.push({ kind: 'list', ordered: listKind.kind === 'ordered', items });
                continue;
            }

            blocks.push({ kind: 'paragraph', text: this.normalizeParagraphText(text), style: line.style, runs: line.runs });
            index += 1;
        }

        return blocks;
    }

    private static collectDefinitionSection(
        lines: string[],
        startIndex: number
    ): { heading: string; rows: string[][]; nextIndex: number } | null {
        const heading = this.normalizeParagraphText(lines[startIndex]);
        if (!this.isCompactHeadingCandidate(heading)) {
            return null;
        }

        const rows: string[][] = [];
        let index = startIndex + 1;
        while (index < lines.length) {
            const row = this.splitDefinitionColumns(lines[index]);
            if (!row) {
                break;
            }
            rows.push(row);
            index += 1;
        }

        if (rows.length < 2) {
            return null;
        }

        return {
            heading,
            rows: [['Item', 'Description'], ...rows],
            nextIndex: index
        };
    }

    private static collectStructuredTable(
        lines: StyledLine[],
        startIndex: number
    ): { rows: string[][]; columnWidthsTwips?: number[]; cellMerges?: TableCellMerge[][]; nextIndex: number } | null {
        if (!lines[startIndex]?.inTable) {
            return null;
        }

        const rows: string[][] = [];
        let expectedColumnCount = 0;
        let columnWidthsTwips: number[] | undefined;
        const cellMerges: TableCellMerge[][] = [];
        let index = startIndex;

        while (index < lines.length && lines[index].inTable) {
            const rowLines: StyledLine[] = [];
            let rowMetadata: StyledLine | undefined;

            while (index < lines.length && lines[index].inTable) {
                const line = lines[index];
                rowLines.push(line);
                expectedColumnCount = Math.max(expectedColumnCount, line.tableColumnCount ?? 0);
                if (!columnWidthsTwips && line.tableColumnWidthsTwips?.length) {
                    columnWidthsTwips = line.tableColumnWidthsTwips;
                }
                if (line.tableColumnCount || line.tableCellMerges?.length || line.isTableTerminator) {
                    rowMetadata = line;
                }
                index += 1;

                if (line.isTableTerminator) {
                    break;
                }
            }

            const row = this.buildStructuredTableRow(
                rowLines,
                rowMetadata?.tableColumnCount ?? expectedColumnCount
            );
            if (row.length > 0) {
                rows.push(row);
                cellMerges.push(rowMetadata?.tableCellMerges ?? []);
            }
        }

        if (rows.length === 0) {
            return null;
        }

        const maxColumns = Math.max(expectedColumnCount, ...rows.map((row) => row.length));
        if (maxColumns < 2) {
            return null;
        }

        return {
            rows: rows.map((row) => [...row, ...Array(Math.max(0, maxColumns - row.length)).fill('')]),
            columnWidthsTwips,
            cellMerges,
            nextIndex: index
        };
    }

    private static buildStructuredTableRow(lines: StyledLine[], expectedColumnCount = 0): string[] {
        const columns: string[] = [];

        for (const line of lines) {
            const source = (line.runs?.map((run) => run.text).join('') ?? line.text)
                .replace(/\u0007/g, '\t');

            if (source.includes('\t')) {
                columns.push(...this.splitStructuredTableRow(line, 0));
                continue;
            }

            const normalized = this.normalizeParagraphText(source);
            if (normalized.length > 0) {
                columns.push(normalized);
            }
        }

        while (columns.length > 0 && columns[columns.length - 1].length === 0 && (expectedColumnCount === 0 || columns.length > expectedColumnCount)) {
            columns.pop();
        }

        while (expectedColumnCount > 0 && columns.length < expectedColumnCount) {
            columns.push('');
        }

        return columns;
    }

    private static splitStructuredTableRow(line: StyledLine, expectedColumnCount = 0): string[] {
        const source = (line.runs?.map((run) => run.text).join('') ?? line.text)
            .replace(/\u0007/g, '\t');
        const columns = source
            .split('\t')
            .map((cell) => this.normalizeParagraphText(cell));

        while (columns.length > 0 && columns[columns.length - 1].length === 0 && (expectedColumnCount === 0 || columns.length > expectedColumnCount)) {
            columns.pop();
        }

        while (expectedColumnCount > 0 && columns.length < expectedColumnCount) {
            columns.push('');
        }

        return columns;
    }

    private static buildTableCells(
        rows: string[][],
        cellMerges?: TableCellMerge[][]
    ): Array<Array<{ text: string; colspan?: number; rowspan?: number }>> {
        if (rows.length === 0) {
            return [];
        }

        const columnCount = Math.max(...rows.map((row) => row.length));
        const grid = rows.map((row) => [...row, ...Array(Math.max(0, columnCount - row.length)).fill('')]);
        const covered = Array.from({ length: grid.length }, () => Array(columnCount).fill(false));
        const result: Array<Array<{ text: string; colspan?: number; rowspan?: number }>> = [];

        for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
            const renderedRow: Array<{ text: string; colspan?: number; rowspan?: number }> = [];

            for (let colIndex = 0; colIndex < columnCount; colIndex++) {
                if (covered[rowIndex][colIndex]) {
                    continue;
                }

                const text = grid[rowIndex][colIndex];
                let colspan = 1;
                let rowspan = 1;
                const merge = cellMerges?.[rowIndex]?.[colIndex];

                if (merge?.vertMerge === 1 || merge?.horzMerge === 1) {
                    continue;
                }

                while (
                    colIndex + colspan < columnCount
                    && (
                        cellMerges?.[rowIndex]?.[colIndex + colspan]?.horzMerge === 1
                        || (!cellMerges?.[rowIndex]?.length && grid[rowIndex][colIndex + colspan].length === 0)
                    )
                ) {
                    colspan += 1;
                }

                if (text.length > 0 || merge?.vertMerge === 2) {
                    let nextRow = rowIndex + 1;
                    while (nextRow < grid.length) {
                        let canExtend = true;
                        for (let spanIndex = 0; spanIndex < colspan; spanIndex++) {
                            const nextMerge = cellMerges?.[nextRow]?.[colIndex + spanIndex];
                            const mergedDown = nextMerge?.vertMerge === 1;
                            const emptyFallback = !cellMerges?.[nextRow]?.length && grid[nextRow][colIndex + spanIndex].length === 0;
                            if (!mergedDown && !emptyFallback) {
                                canExtend = false;
                                break;
                            }
                        }
                        if (!canExtend) {
                            break;
                        }
                        rowspan += 1;
                        nextRow += 1;
                    }
                }

                for (let rowSpanIndex = 0; rowSpanIndex < rowspan; rowSpanIndex++) {
                    for (let colSpanIndex = 0; colSpanIndex < colspan; colSpanIndex++) {
                        covered[rowIndex + rowSpanIndex][colIndex + colSpanIndex] = rowSpanIndex !== 0 || colSpanIndex !== 0;
                    }
                }

                renderedRow.push({
                    text,
                    colspan: colspan > 1 ? colspan : undefined,
                    rowspan: rowspan > 1 ? rowspan : undefined
                });

                colIndex += colspan - 1;
            }

            result.push(renderedRow);
        }

        return result;
    }

    private static renderBlocks(blocks: LegacyBlock[]): string {
        const rendered: string[] = [];

        for (const block of blocks) {
            if (block.kind === 'heading') {
                const tag = rendered.length === 0 ? 'h1' : 'h2';
                const merged = this.flattenSingleRunBlock(block.text, block.style, block.runs);
                const content = this.renderInlineStyledText(merged.runs, merged.text);
                rendered.push(`<${tag}${this.renderInlineStyleAttribute(merged.style)}>${content}</${tag}>`);
                continue;
            }

            if (block.kind === 'paragraph') {
                const merged = this.flattenSingleRunBlock(block.text, block.style, block.runs);
                const content = this.renderInlineStyledText(merged.runs, merged.text);
                rendered.push(`<p${this.renderInlineStyleAttribute(merged.style)}>${content}</p>`);
                continue;
            }

            if (block.kind === 'list') {
                const listTag = block.ordered ? 'ol' : 'ul';
                rendered.push(
                    `<${listTag}>${block.items.map((item) => {
                        const style = this.renderInlineStyleAttribute({
                            ...item.style,
                            marginLeftTwips: (item.level || 0) * 360
                        });
                        return `<li${style}>${this.escapeHtml(item.text)}</li>`;
                    }).join('')}</${listTag}>`
                );
                continue;
            }

            if (block.kind === 'table') {
                const colGroup = this.renderTableColGroup(
                    block.columnWidthsTwips,
                    Math.max(...block.rows.map((row) => row.reduce((sum, cell) => sum + (cell.colspan ?? 1), 0)))
                );
                const rowsHtml = block.rows
                    .map((row, rowIndex) => {
                        const tag = rowIndex === 0 ? 'th' : 'td';
                        return `<tr>${row.map((cell) => {
                            const colspanAttr = cell.colspan && cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
                            const rowspanAttr = cell.rowspan && cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
                            return `<${tag}${colspanAttr}${rowspanAttr}>${this.escapeHtml(cell.text)}</${tag}>`;
                        }).join('')}</tr>`;
                    })
                    .join('');
                rendered.push(`<div class="ov-doc-legacy-table"><table>${colGroup}<tbody>${rowsHtml}</tbody></table></div>`);
                continue;
            }

            if (block.kind === 'embedded-sheet') {
                const parts = [`<section class="ov-doc-embedded-sheet"><div class="ov-doc-embedded-sheet-card"><div class="ov-doc-embedded-sheet-head"><h2>${this.escapeHtml(block.title)}</h2></div>`];
                if (block.chart) {
                    parts.push(this.renderEmbeddedChart(block.chart));
                }
                if (block.rows) {
                    const rowsHtml = block.rows
                        .map((row, rowIndex) => {
                            const tag = rowIndex === 0 ? 'th' : 'td';
                            return `<tr>${row.map((cell) => `<${tag}>${this.escapeHtml(cell)}</${tag}>`).join('')}</tr>`;
                        })
                        .join('');
                    parts.push(`<div class="ov-doc-embedded-table-wrap"><div class="ov-doc-embedded-table-label">Data Table</div><div class="ov-doc-legacy-table"><table><tbody>${rowsHtml}</tbody></table></div></div>`);
                }
                parts.push(`</div></section>`);
                rendered.push(parts.join(''));
                continue;
            }

            if (block.kind === 'image-gallery' && block.images.length > 0) {
                const items = block.images
                    .map((image) => `<figure class="ov-doc-legacy-image"><img src="${image.src}" alt="${this.escapeHtml(image.alt)}"><figcaption>${this.escapeHtml(image.alt)}</figcaption></figure>`)
                    .join('');
                rendered.push(`<section class="ov-doc-legacy-images"><h2>Images</h2><div class="ov-doc-legacy-image-grid">${items}</div></section>`);
            }
        }

        return rendered.join('\n');
    }

    private static flattenSingleRunBlock(
        text: string,
        style: CharacterStyle | undefined,
        runs: Array<{ text: string; style?: CharacterStyle }> | undefined
    ): {
        text: string;
        style?: CharacterStyle;
        runs?: Array<{ text: string; style?: CharacterStyle }>;
    } {
        if (!runs || runs.length !== 1) {
            return { text, style, runs };
        }

        const [run] = runs;
        if (this.normalizeParagraphText(run.text, true) !== this.normalizeParagraphText(text, true)) {
            return { text, style, runs };
        }

        return {
            text: run.text,
            style: this.mergeStyles(style, run.style),
            runs: undefined
        };
    }

    private static renderInlineStyleAttribute(style?: CharacterStyle): string {
        if (!style) {
            return '';
        }

        const declarations: string[] = [];
        if (style.bold) {
            declarations.push('font-weight:700');
        }
        if (style.italic) {
            declarations.push('font-style:italic');
        }
        if (style.underline) {
            declarations.push('text-decoration:underline');
        }
        if (style.fontSizeHalfPoints && style.fontSizeHalfPoints >= 2) {
            declarations.push(`font-size:${(style.fontSizeHalfPoints / 2).toFixed(1)}pt`);
        }
        if (style.color) {
            declarations.push(`color:${style.color}`);
        }
        const safeBackground = this.sanitizeRenderableBackground(style.backgroundColor);
        if (safeBackground) {
            declarations.push(`background-color:${safeBackground}`);
        }
        const safeHighlight = this.sanitizeRenderableBackground(style.highlightColor);
        if (safeHighlight) {
            declarations.push(`background-color:${safeHighlight}`);
        }
        if (style.textAlign) {
            declarations.push(`text-align:${style.textAlign}`);
        }
        if (style.marginLeftTwips) {
            declarations.push(`margin-left:${(style.marginLeftTwips / 20).toFixed(1)}pt`);
        }
        if (style.marginRightTwips) {
            declarations.push(`margin-right:${(style.marginRightTwips / 20).toFixed(1)}pt`);
        }
        if (style.firstLineIndentTwips) {
            declarations.push(`text-indent:${(style.firstLineIndentTwips / 20).toFixed(1)}pt`);
        }

        return declarations.length > 0 ? ` style="${declarations.join(';')}"` : '';
    }

    private static renderInlineStyledText(
        runs: Array<{ text: string; style?: CharacterStyle }> | undefined,
        fallbackText: string
    ): string {
        if (!runs || runs.length === 0) {
            return this.escapeHtml(fallbackText);
        }

        return runs
            .map((run) => {
                const text = this.escapeHtml(run.text);
                const styleAttr = this.renderInlineStyleAttribute(run.style);
                return styleAttr ? `<span${styleAttr}>${text}</span>` : text;
            })
            .join('');
    }

    private static renderTableColGroup(columnWidthsTwips: number[] | undefined, columnCount: number): string {
        if (!columnWidthsTwips || columnWidthsTwips.length === 0 || columnCount <= 0) {
            return '';
        }

        const widths = columnWidthsTwips.slice(0, columnCount);
        const total = widths.reduce((sum, width) => sum + Math.max(0, width), 0);
        if (total <= 0) {
            return '';
        }

        const cols = widths
            .map((width) => `<col style="width:${((Math.max(0, width) / total) * 100).toFixed(2)}%">`)
            .join('');
        return `<colgroup>${cols}</colgroup>`;
    }

    private static getListKind(text: string): { kind: 'bullet' | 'ordered'; pattern: RegExp } | null {
        const bulletPattern = /^([\u2022\u00b7\-*o])\s+/;
        if (bulletPattern.test(text)) {
            return { kind: 'bullet', pattern: bulletPattern };
        }

        const orderedPattern = /^((\d+|[A-Za-z])[.)])\s+/;
        if (orderedPattern.test(text)) {
            return { kind: 'ordered', pattern: orderedPattern };
        }

        return null;
    }

    private static collectTableRows(lines: string[], startIndex: number): { rows: string[][]; nextIndex: number } | null {
        const rows: string[][] = [];
        let index = startIndex;

        while (index < lines.length) {
            const columns = this.splitTableColumns(lines[index]);
            if (!columns || columns.length < 2) {
                break;
            }
            rows.push(columns);
            index += 1;
        }

        if (rows.length < 2) {
            return null;
        }

        const maxColumns = Math.max(...rows.map((row) => row.length));
        if (maxColumns < 2) {
            return null;
        }

        return {
            rows: rows.map((row) => [...row, ...Array(Math.max(0, maxColumns - row.length)).fill('')]),
            nextIndex: index
        };
    }

    private static collectDefinitionTable(lines: string[], startIndex: number): { rows: string[][]; nextIndex: number } | null {
        const rows: string[][] = [];
        let index = startIndex;

        while (index < lines.length) {
            const row = this.splitDefinitionColumns(lines[index]);
            if (!row) {
                break;
            }
            rows.push(row);
            index += 1;
        }

        if (rows.length < 3) {
            return null;
        }

        const uniqueKeys = new Set(rows.map((row) => row[0]));
        if (uniqueKeys.size < 3) {
            return null;
        }

        return {
            rows: [['Item', 'Description'], ...rows],
            nextIndex: index
        };
    }

    private static splitTableColumns(line: string): string[] | null {
        const tabColumns = line
            .split('\t')
            .map((cell) => this.normalizeParagraphText(cell))
            .filter(Boolean);
        if (tabColumns.length >= 2) {
            return tabColumns;
        }

        const pipeColumns = line
            .split(/\s*\|\s*/)
            .map((cell) => this.normalizeParagraphText(cell))
            .filter(Boolean);
        if (pipeColumns.length >= 2) {
            return pipeColumns;
        }

        return null;
    }

    private static splitDefinitionColumns(line: string): string[] | null {
        const normalized = this.normalizeParagraphText(line);
        const match = normalized.match(/^([^:]{1,40})\s*:\s+(.{2,})$/);
        if (!match) {
            return null;
        }

        const key = this.normalizeParagraphText(match[1]);
        const value = this.normalizeParagraphText(match[2]);
        if (!key || !value || !this.hasEnoughLetters(key) || value.length < 2) {
            return null;
        }

        return [key, value];
    }

    private static looksLikeSectionHeading(text: string, previous: string, next: string): boolean {
        const normalizedText = this.normalizeParagraphText(text);
        if (!normalizedText || normalizedText.includes(':') || /[.!?]$/.test(normalizedText)) {
            return false;
        }
        if (normalizedText.length > 24 || !this.isCompactHeadingCandidate(normalizedText)) {
            return false;
        }

        const previousLength = this.normalizeParagraphText(previous).length;
        const nextLength = this.normalizeParagraphText(next).length;
        return nextLength > 15 && (previousLength === 0 || previousLength > 20);
    }

    private static isCompactHeadingCandidate(text: string): boolean {
        const words = text.split(/\s+/).filter(Boolean);
        return text.length >= 2
            && text.length <= 24
            && words.length <= 4
            && this.hasEnoughLetters(text);
    }

    private static shouldDropLine(text: string, previous: string, next: string): boolean {
        const normalized = this.normalizeParagraphText(text);
        if (!normalized) {
            return true;
        }
        if (/^EMBED\s+/i.test(normalized)) {
            return true;
        }
        if (/^\d+$/.test(normalized)) {
            return true;
        }

        const prevNormalized = this.normalizeParagraphText(previous);
        const nextNormalized = this.normalizeParagraphText(next);
        const adjacentNumber = /^\d+$/.test(prevNormalized) || /^\d+$/.test(nextNormalized);
        if (adjacentNumber && normalized.length <= 48) {
            return true;
        }

        const isShortLabel = normalized.length <= 14 && /^[A-Za-z가-힣]+(?:\s+[A-Za-z가-힣]+)?$/.test(normalized);
        if (!isShortLabel) {
            return adjacentNumber && normalized.split(/\s+/).length <= 6;
        }

        const surroundedByLongParagraphs = prevNormalized.length > 20 && nextNormalized.length > 20;
        return /^\d+$/.test(prevNormalized)
            || /^\d+$/.test(nextNormalized)
            || /^EMBED\s+/i.test(prevNormalized)
            || /^EMBED\s+/i.test(nextNormalized)
            || surroundedByLongParagraphs;
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
            const offset = (sid + 1) * sectorSize;
            if (offset < 0 || offset + sectorSize > file.length) {
                return Buffer.alloc(0);
            }
            return file.subarray(offset, offset + sectorSize);
        };

        const difat: number[] = [];
        for (let i = 0; i < 109; i++) {
            const sid = file.readInt32LE(76 + i * 4);
            if (sid !== -1) {
                difat.push(sid);
            }
        }

        let nextDifat = firstDifatSector;
        for (let i = 0; i < numDifatSectors && nextDifat !== ENDOFCHAIN && nextDifat !== -1; i++) {
            const sector = readSector(nextDifat);
            if (sector.length === 0) {
                break;
            }
            const entryCount = sectorSize / 4 - 1;
            for (let j = 0; j < entryCount; j++) {
                const sid = sector.readInt32LE(j * 4);
                if (sid !== -1) {
                    difat.push(sid);
                }
            }
            nextDifat = sector.readInt32LE(sectorSize - 4);
        }

        const fatSectors = difat.slice(0, numFatSectors);
        const fat: number[] = [];
        for (const sid of fatSectors) {
            const sector = readSector(sid);
            if (sector.length === 0) {
                continue;
            }
            for (let i = 0; i < sectorSize; i += 4) {
                fat.push(sector.readInt32LE(i));
            }
        }

        const readChain = (startSid: number): Buffer => {
            if (startSid < 0 || startSid === ENDOFCHAIN) {
                return Buffer.alloc(0);
            }

            const chunks: Buffer[] = [];
            const visited = new Set<number>();
            let sid = startSid;

            while (sid >= 0 && sid !== ENDOFCHAIN && sid !== FREESECT) {
                if (visited.has(sid) || sid >= fat.length) {
                    break;
                }
                visited.add(sid);
                const sector = readSector(sid);
                if (sector.length === 0) {
                    break;
                }
                chunks.push(sector);
                sid = fat[sid];
            }

            return Buffer.concat(chunks);
        };

        const dirStream = readChain(firstDirSector);
        const entries: CfbEntry[] = [];
        for (let offset = 0; offset + 128 <= dirStream.length; offset += 128) {
            const nameLength = dirStream.readUInt16LE(offset + 64);
            const name = dirStream
                .subarray(offset, offset + Math.max(0, nameLength - 2))
                .toString('utf16le')
                .replace(/\u0000/g, '');
            const type = dirStream.readUInt8(offset + 66);
            const startSector = dirStream.readInt32LE(offset + 116);
            const sizeLow = dirStream.readUInt32LE(offset + 120);
            const sizeHigh = dirStream.readUInt32LE(offset + 124);
            const size = sizeHigh > 0 ? Number(sizeLow) : sizeLow;
            entries.push({ name, type, startSector, size });
        }

        const root = entries.find((entry) => entry.type === 5);
        const miniStream = root
            ? readChain(root.startSector).subarray(0, root.size)
            : Buffer.alloc(0);
        const miniFatData = readChain(firstMiniFatSector);
        const miniFat: number[] = [];
        for (let i = 0; i + 4 <= miniFatData.length && i / 4 < numMiniFatSectors * (sectorSize / 4); i += 4) {
            miniFat.push(miniFatData.readInt32LE(i));
        }

        const readMiniChain = (startMiniSid: number, size: number): Buffer => {
            if (startMiniSid < 0) {
                return Buffer.alloc(0);
            }

            const chunks: Buffer[] = [];
            const visited = new Set<number>();
            let sid = startMiniSid;

            while (sid >= 0 && sid !== ENDOFCHAIN && sid !== FREESECT) {
                if (visited.has(sid) || sid >= miniFat.length) {
                    break;
                }
                visited.add(sid);
                const start = sid * miniSectorSize;
                const end = start + miniSectorSize;
                if (start < 0 || end > miniStream.length) {
                    break;
                }
                chunks.push(miniStream.subarray(start, end));
                sid = miniFat[sid];
            }

            return Buffer.concat(chunks).subarray(0, size);
        };

        const streamMap = new Map<string, CfbEntry>();
        for (const entry of entries) {
            if (entry.name && entry.type === 2) {
                streamMap.set(entry.name, entry);
            }
        }

        return {
            getStream: (name: string): Buffer | null => {
                const entry = streamMap.get(name);
                if (!entry) {
                    return null;
                }

                if (entry.size < miniCutoff) {
                    return readMiniChain(entry.startSector, entry.size);
                }

                return readChain(entry.startSector).subarray(0, entry.size);
            },
            listStreams: () =>
                entries
                    .filter((entry) => entry.name && entry.type === 2)
                    .map((entry) => ({ name: entry.name, size: entry.size }))
        };
    }

    private static normalizeDocumentText(raw: string): string {
        return raw
            .replace(/\u0000/g, '')
            .replace(/\b(HYPERLINK|PAGEREF|TOC|REF)\b\s+"[^"]*"\s*/gi, '')
            .replace(/[\u0001-\u0006\u0008\u000c\u000e-\u0012\u0014-\u001f]/g, ' ')
            .replace(/[\u0007\u000b]/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ ]{2,}/g, ' ')
            .trim();
    }

    private static normalizeParagraphText(raw: string, preserveTabs = false): string {
        const whitespacePattern = preserveTabs ? /[^\S\t]+/g : /\s+/g;
        return (raw || '')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
            .replace(whitespacePattern, ' ')
            .trim();
    }

    private static isNoise(text: string): boolean {
        if (text.length < 3) {
            return true;
        }

        const lower = text.toLowerCase();
        if (/^(times new roman|arial|calibri|courier new|normal|heading)\b/.test(lower)) {
            return true;
        }
        if (/^[_\W]+$/.test(text)) {
            return true;
        }
        if (!this.isMostlyReadable(text)) {
            return true;
        }
        if (!this.hasEnoughLetters(text)) {
            return true;
        }
        return false;
    }

    private static isMostlyReadable(text: string): boolean {
        let readable = 0;
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            const isPrintableAscii = code >= 32 && code <= 126;
            const isKorean = code >= 0xac00 && code <= 0xd7a3;
            const isCommonUnicode = code >= 0x00a0 && code <= 0x024f;
            if (isPrintableAscii || isKorean || isCommonUnicode) {
                readable += 1;
            }
        }

        return readable / Math.max(1, text.length) >= 0.8;
    }

    private static hasEnoughLetters(text: string): boolean {
        const letters = (text.match(/[A-Za-z가-힣]/g) || []).length;
        return letters >= Math.max(3, Math.floor(text.length * 0.25));
    }

    private static extractImages(cfb: CfbReader): Array<{ src: string; alt: string }> {
        const images: Array<{ src: string; alt: string }> = [];

        for (const stream of cfb.listStreams()) {
            const buffer = cfb.getStream(stream.name);
            if (!buffer || buffer.length < 16) {
                continue;
            }

            const extracted = this.extractImageBuffer(buffer);
            if (!extracted) {
                continue;
            }

            images.push({
                src: `data:${extracted.mimeType};base64,${extracted.buffer.toString('base64')}`,
                alt: stream.name
            });

            if (images.length >= 8) {
                break;
            }
        }

        return images;
    }

    private static extractEmbeddedWorkbookTables(
        cfb: CfbReader
    ): Array<{
        title: string;
        rows: string[][];
        showTable: boolean;
        chart?: { type: 'bar' | 'line'; categories: string[]; series: Array<{ name: string; values: number[]; color: string }> };
    }> {
        const workbook = cfb.getStream('Workbook');
        if (!workbook) {
            return [];
        }

        try {
            const parsed = XLSX.read(workbook, { type: 'buffer' });
            return (parsed.SheetNames
                .map((sheetName) => {
                    const sheet = parsed.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as any[][];
                    const normalizedRows = rows
                        .map((row) => row.map((cell) => this.normalizeParagraphText(String(cell ?? ''))))
                        .filter((row) => row.some((cell) => cell.length > 0));
                    if (normalizedRows.length < 2 || normalizedRows[0].length < 2) {
                        return null;
                    }
                    return {
                        title: `Embedded ${sheetName}`,
                        rows: normalizedRows,
                        showTable: !/^chart/i.test(sheetName),
                        chart: this.buildEmbeddedChart(normalizedRows)
                    };
                })
                .filter(Boolean) as Array<{
                    title: string;
                    rows: string[][];
                    showTable: boolean;
                    chart?: { type: 'bar' | 'line'; categories: string[]; series: Array<{ name: string; values: number[]; color: string }> };
                }>)
                .slice(0, 3);
        } catch (error) {
            console.warn('[DOC] Failed to parse embedded workbook:', error);
            return [];
        }
    }

    private static buildEmbeddedChart(rows: string[][]): { type: 'bar' | 'line'; categories: string[]; series: Array<{ name: string; values: number[]; color: string }> } | undefined {
        if (rows.length < 2 || rows[0].length < 3) {
            return undefined;
        }

        const header = rows[0];
        const seriesNames = header.slice(1).map((name, index) => name || `Series ${index + 1}`);
        const categories = rows.slice(1).map((row) => row[0]).filter(Boolean);
        if (categories.length === 0) {
            return undefined;
        }

        const palette = ['#004586', '#ff420e', '#ffd320', '#579d1c', '#7e57c2'];
        const series = seriesNames.map((name, seriesIndex) => {
            const values = rows.slice(1).map((row) => {
                const numeric = Number(row[seriesIndex + 1]);
                return Number.isFinite(numeric) ? numeric : 0;
            });
            return {
                name,
                values,
                color: palette[seriesIndex % palette.length]
            };
        });

        if (series.every((entry) => entry.values.every((value) => value === 0))) {
            return undefined;
        }

        return {
            type: this.inferEmbeddedChartType(categories, series),
            categories,
            series
        };
    }

    private static inferEmbeddedChartType(
        categories: string[],
        series: Array<{ name: string; values: number[]; color: string }>
    ): 'bar' | 'line' {
        const numericLikeCategories = categories.every((value) => /^-?\d+(\.\d+)?$/.test(value));
        if (numericLikeCategories || (categories.length >= 6 && series.length <= 2)) {
            return 'line';
        }
        return 'bar';
    }

    private static renderEmbeddedChart(chart: { type: 'bar' | 'line'; categories: string[]; series: Array<{ name: string; values: number[]; color: string }> }): string {
        const width = 760;
        const height = 320;
        const margin = { top: 28, right: 160, bottom: 54, left: 46 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;
        const maxValue = Math.max(1, ...chart.series.flatMap((series) => series.values));
        const groupWidth = plotWidth / Math.max(1, chart.categories.length);
        const barWidth = Math.max(12, (groupWidth * 0.78) / Math.max(1, chart.series.length));
        const groupOffset = (groupWidth - barWidth * chart.series.length) / 2;
        const ticks = 5;

        const parts: string[] = [];
        for (let i = 0; i <= ticks; i++) {
            const value = (maxValue / ticks) * i;
            const y = margin.top + plotHeight - (value / maxValue) * plotHeight;
            parts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}" stroke="#d6dbe1" stroke-width="1" />`);
            parts.push(`<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="#6b7280">${value.toFixed(0)}</text>`);
        }

        chart.categories.forEach((category, index) => {
            const x = margin.left + index * groupWidth + groupWidth / 2;
            parts.push(`<text x="${x}" y="${margin.top + plotHeight + 28}" text-anchor="middle" font-size="12" fill="#111827">${this.escapeHtml(category)}</text>`);
        });

        if (chart.type === 'line') {
            chart.series.forEach((series) => {
                const points = series.values.map((value, valueIndex) => {
                    const x = margin.left + valueIndex * groupWidth + groupWidth / 2;
                    const y = margin.top + plotHeight - (Math.max(0, value) / maxValue) * plotHeight;
                    return `${x},${y}`;
                }).join(' ');
                parts.push(`<polyline points="${points}" fill="none" stroke="${series.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />`);
                series.values.forEach((value, valueIndex) => {
                    const x = margin.left + valueIndex * groupWidth + groupWidth / 2;
                    const y = margin.top + plotHeight - (Math.max(0, value) / maxValue) * plotHeight;
                    parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${series.color}" />`);
                });
            });
        } else {
            chart.series.forEach((series, seriesIndex) => {
                series.values.forEach((value, valueIndex) => {
                    const x = margin.left + valueIndex * groupWidth + groupOffset + seriesIndex * barWidth;
                    const barHeight = (Math.max(0, value) / maxValue) * plotHeight;
                    const y = margin.top + plotHeight - barHeight;
                    parts.push(`<rect x="${x}" y="${y}" width="${barWidth - 2}" height="${barHeight}" fill="${series.color}" rx="1" />`);
                });
            });
        }

        const legend = chart.series
            .map((series) => `<div class="ov-doc-embedded-chart-legend-item"><span class="ov-doc-embedded-chart-swatch" style="background:${series.color}"></span><span>${this.escapeHtml(series.name)}</span></div>`)
            .join('');
        const typeLabel = chart.type === 'line' ? 'Line chart' : 'Bar chart';

        return `
            <div class="ov-doc-embedded-chart">
                <div class="ov-doc-embedded-chart-meta">${typeLabel}</div>
                <div class="ov-doc-embedded-chart-frame">
                    <svg class="ov-doc-embedded-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">
                        ${parts.join('')}
                    </svg>
                </div>
                <div class="ov-doc-embedded-chart-legend">${legend}</div>
            </div>
        `;
    }

    private static extractImageBuffer(buffer: Buffer): { buffer: Buffer; mimeType: string } | null {
        const signatures = [
            {
                marker: Buffer.from([0xff, 0xd8, 0xff]),
                mimeType: 'image/jpeg',
                terminator: Buffer.from([0xff, 0xd9])
            },
            {
                marker: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
                mimeType: 'image/png',
                terminator: Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
            },
            {
                marker: Buffer.from('GIF87a', 'ascii'),
                mimeType: 'image/gif'
            },
            {
                marker: Buffer.from('GIF89a', 'ascii'),
                mimeType: 'image/gif'
            },
            {
                marker: Buffer.from([0x42, 0x4d]),
                mimeType: 'image/bmp'
            }
        ];

        for (const signature of signatures) {
            const start = buffer.indexOf(signature.marker);
            if (start < 0) {
                continue;
            }

            if ('terminator' in signature && signature.terminator) {
                const end = buffer.indexOf(signature.terminator, start + signature.marker.length);
                if (end > start) {
                    return {
                        buffer: buffer.subarray(start, end + signature.terminator.length),
                        mimeType: signature.mimeType
                    };
                }
            }

            return {
                buffer: buffer.subarray(start),
                mimeType: signature.mimeType
            };
        }

        return null;
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
