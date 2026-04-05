import * as fs from 'fs';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

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
    headerFooterBySection?: Map<number, LegacyHeaderFooter>;
}

interface FibInfo {
    nFib: number;
    tableStreamName: '0Table' | '1Table';
    ccpText: number;
    ccpFtn: number;
    ccpHdd: number;
    fcPlcfSed: number;
    lcbPlcfSed: number;
    fcPlcfHdd: number;
    lcbPlcfHdd: number;
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
    pageBreakBefore?: boolean;
    keepWithNext?: boolean;
    keepLinesTogether?: boolean;
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
    cpStart: number;
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
    embeddedChartAnchor?: boolean;
    embeddedImageAnchor?: boolean;
    embeddedAssetAnchor?: boolean;
    embeddedAssetPreference?: 'chart' | 'image';
    embeddedObjectClass?: string;
    floatingSide?: 'left' | 'right' | 'center';
    floatingWidthMode?: 'narrow' | 'regular' | 'wide';
    floatingPlacement?: 'edge-wrap' | 'center-block';
    floatingClearancePx?: number;
    preserveEmpty?: boolean;
    pageBreakBefore?: boolean;
    sectionIndex?: number;
    sectionLayout?: LegacyLayoutMetrics;
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
    embeddedChartAnchor?: boolean;
    embeddedImageAnchor?: boolean;
    embeddedAssetAnchor?: boolean;
    embeddedAssetPreference?: 'chart' | 'image';
    embeddedObjectClass?: string;
    floatingSide?: 'left' | 'right' | 'center';
    floatingWidthMode?: 'narrow' | 'regular' | 'wide';
    floatingPlacement?: 'edge-wrap' | 'center-block';
    floatingClearancePx?: number;
    preserveEmpty?: boolean;
    pageBreakBefore?: boolean;
    sectionIndex?: number;
    sectionLayout?: LegacyLayoutMetrics;
}

type LegacyBlock =
    | { kind: 'heading'; text: string; style?: CharacterStyle; runs?: Array<{ text: string; style?: CharacterStyle }>; pageBreakBefore?: boolean; sectionIndex?: number; sectionLayout?: LegacyLayoutMetrics }
    | { kind: 'paragraph'; text: string; style?: CharacterStyle; runs?: Array<{ text: string; style?: CharacterStyle }>; pageBreakBefore?: boolean; sectionIndex?: number; sectionLayout?: LegacyLayoutMetrics }
    | { kind: 'list'; ordered: boolean; items: Array<{ text: string; level: number; style?: CharacterStyle }>; pageBreakBefore?: boolean; sectionIndex?: number; sectionLayout?: LegacyLayoutMetrics }
    | {
        kind: 'table';
        rows: Array<Array<{ text: string; colspan?: number; rowspan?: number }>>;
        columnWidthsTwips?: number[];
        cellMerges?: TableCellMerge[][];
        pageBreakBefore?: boolean;
        sectionIndex?: number;
        sectionLayout?: LegacyLayoutMetrics;
    }
    | {
        kind: 'embedded-sheet';
        title?: string;
        chart?: { type: 'bar' | 'line'; categories: string[]; series: Array<{ name: string; values: number[]; color: string }> };
        rows?: string[][];
        objectPlacementMode?: 'text-flow' | 'drawing-anchor';
        pageBreakBefore?: boolean;
        sectionIndex?: number;
        sectionLayout?: LegacyLayoutMetrics;
    }
    | { kind: 'embedded-chart-anchor'; objectClass?: string; pageBreakBefore?: boolean; sectionIndex?: number; sectionLayout?: LegacyLayoutMetrics }
    | { kind: 'embedded-asset-anchor'; assetPreference?: 'chart' | 'image'; pageBreakBefore?: boolean; sectionIndex?: number; sectionLayout?: LegacyLayoutMetrics }
    | { kind: 'image'; src: string; alt: string; floating?: boolean; floatingSide?: 'left' | 'right' | 'center'; floatingWidthMode?: 'narrow' | 'regular' | 'wide'; floatingPlacement?: 'edge-wrap' | 'center-block'; floatingClearancePx?: number; pageBreakBefore?: boolean; sectionIndex?: number; sectionLayout?: LegacyLayoutMetrics }
    | { kind: 'image-gallery'; images: Array<{ src: string; alt: string }>; floating?: boolean; floatingSide?: 'left' | 'right' | 'center'; floatingWidthMode?: 'narrow' | 'regular' | 'wide'; floatingPlacement?: 'edge-wrap' | 'center-block'; floatingClearancePx?: number; pageBreakBefore?: boolean; sectionIndex?: number; sectionLayout?: LegacyLayoutMetrics };

type EmbeddedChart = {
    type: 'bar' | 'line';
    categories: string[];
    series: Array<{ name: string; values: number[]; color: string }>;
};

type EmbeddedSheetData = {
    title?: string;
    rows: string[][];
    showTable: boolean;
    chart?: EmbeddedChart;
    objectPlacementMode?: 'text-flow' | 'drawing-anchor';
};

type LegacyLayoutMetrics = {
    pageWidthTwips: number;
    pageHeightTwips: number;
    marginTopTwips: number;
    marginRightTwips: number;
    marginBottomTwips: number;
    marginLeftTwips: number;
    gutterTwips: number;
    headerTopTwips: number;
    footerBottomTwips: number;
    columns: number;
    columnGapTwips: number;
    lineBetweenColumns: boolean;
    rtlGutter: boolean;
    explicitColumnWidthsTwips: number[];
    explicitColumnSpacingsTwips: number[];
};

type LegacySection = {
    sectionIndex?: number;
    layout: LegacyLayoutMetrics;
    blocks: LegacyBlock[];
    headerFooter?: LegacyHeaderFooter;
};

type SectionBoundary = {
    sectionIndex: number;
    cpStart: number;
    cpEnd: number;
    layout?: LegacyLayoutMetrics;
};

type LegacyHeaderFooter = {
    sectionNumber?: number;
    sectionCount?: number;
    evenHeaderText?: string;
    oddHeaderText?: string;
    evenFooterText?: string;
    oddFooterText?: string;
    firstHeaderText?: string;
    firstFooterText?: string;
};

type LegacyRenderedTableCell = {
    text: string;
    colspan?: number;
    rowspan?: number;
};

type LegacyRenderedTableRow = {
    cells: LegacyRenderedTableCell[];
    cellTag: 'th' | 'td';
};

type LegacyRenderedTableModel = {
    columnCount: number;
    colGroupHtml: string;
    headerRows: LegacyRenderedTableRow[];
    bodyRows: LegacyRenderedTableRow[];
    headerRowCount: number;
};

type LegacyRenderedBlockModel = {
    kind: 'content' | 'table' | 'sheet' | 'image' | 'images';
    html: string;
    pageBreakBefore?: boolean;
    style?: CharacterStyle;
    semanticKind?: LegacySemanticBlockModel['kind'];
    semanticTag?: 'p' | 'h1' | 'h2';
    semanticRole?: 'caption' | 'floating-media';
    textLength?: number;
    hasInlineField?: boolean;
    hasInlineBreak?: boolean;
    itemCount?: number;
    rowCount?: number;
    mediaCount?: number;
    estimatedHeightPx?: number;
    minimumFragmentHeightPx?: number;
    floatingSide?: 'left' | 'right' | 'center';
    floatingWidthMode?: 'narrow' | 'regular' | 'wide';
    floatingPlacement?: 'edge-wrap' | 'center-block';
    floatingClearancePx?: number;
    objectPlacementMode?: 'text-flow' | 'drawing-anchor';
};

type LegacySemanticInlineToken =
    | { kind: 'text'; text: string; style?: CharacterStyle }
    | { kind: 'tab' }
    | { kind: 'line-break' }
    | { kind: 'field'; field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGE' | 'SECTIONPAGES' | 'SECTION' | 'SECTIONS'; style?: CharacterStyle };

type LegacySemanticContentBlockModel = {
    kind: 'content';
    tag: 'p' | 'h1' | 'h2';
    text: string;
    style?: CharacterStyle;
    inlineTokens?: LegacySemanticInlineToken[];
    semanticRole?: 'caption';
    pageBreakBefore?: boolean;
};

type LegacySemanticListBlockModel = {
    kind: 'list';
    ordered: boolean;
    items: Array<{ text: string; level: number; style?: CharacterStyle }>;
    pageBreakBefore?: boolean;
};

type LegacySemanticTableCell = {
    text: string;
    colspan?: number;
    rowspan?: number;
};

type LegacySemanticTableRow = {
    cells: LegacySemanticTableCell[];
    rowKind: 'header' | 'body';
};

type LegacySemanticTableModel = {
    columnCount: number;
    columnWidthsTwips?: number[];
    headerRowCount: number;
    rows: LegacySemanticTableRow[];
};

type LegacySemanticTableBlockModel = {
    kind: 'table';
    table: LegacySemanticTableModel;
    pageBreakBefore?: boolean;
};

type LegacySemanticSheetBlockModel = {
    kind: 'sheet';
    title?: string;
    chart?: EmbeddedChart;
    rows?: string[][];
    headerRowCount?: number;
    objectPlacementMode?: 'text-flow' | 'drawing-anchor';
    pageBreakBefore?: boolean;
};

type LegacySemanticImageBlockModel = {
    kind: 'image';
    src: string;
    alt: string;
    floating?: boolean;
    floatingSide?: 'left' | 'right' | 'center';
    floatingWidthMode?: 'narrow' | 'regular' | 'wide';
    floatingPlacement?: 'edge-wrap' | 'center-block';
    floatingClearancePx?: number;
    pageBreakBefore?: boolean;
};

type LegacySemanticImageGalleryBlockModel = {
    kind: 'images';
    images: Array<{ src: string; alt: string }>;
    floating?: boolean;
    floatingSide?: 'left' | 'right' | 'center';
    floatingWidthMode?: 'narrow' | 'regular' | 'wide';
    floatingPlacement?: 'edge-wrap' | 'center-block';
    floatingClearancePx?: number;
    pageBreakBefore?: boolean;
};

type LegacySemanticBlockModel =
    | LegacySemanticContentBlockModel
    | LegacySemanticListBlockModel
    | LegacySemanticTableBlockModel
    | LegacySemanticSheetBlockModel
    | LegacySemanticImageBlockModel
    | LegacySemanticImageGalleryBlockModel;

type LegacyHeaderFooterToken =
    | { kind: 'text'; value: string }
    | { kind: 'field'; field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGE' | 'SECTIONPAGES' | 'SECTION' | 'SECTIONS' };

type LegacySemanticHeaderFooterModel = {
    sectionNumber?: number;
    sectionCount?: number;
    evenHeaderTokens?: LegacyHeaderFooterToken[];
    oddHeaderTokens?: LegacyHeaderFooterToken[];
    evenFooterTokens?: LegacyHeaderFooterToken[];
    oddFooterTokens?: LegacyHeaderFooterToken[];
    firstHeaderTokens?: LegacyHeaderFooterToken[];
    firstFooterTokens?: LegacyHeaderFooterToken[];
};

type LegacySemanticSectionModel = {
    sectionIndex?: number;
    layout: LegacyLayoutMetrics;
    headerFooter?: LegacySemanticHeaderFooterModel;
    blocks: LegacySemanticBlockModel[];
};

type LegacySemanticDocumentModel = {
    sections: LegacySemanticSectionModel[];
};

type LegacyRenderedSectionModel = {
    sectionIndex?: number;
    layout: LegacyLayoutMetrics;
    headerFooter?: LegacyHeaderFooter;
    renderedBlocks: LegacyRenderedBlockModel[];
};

type LegacyRenderedDocumentModel = {
    sections: LegacyRenderedSectionModel[];
};

export class DocBinaryParser {
    private static readonly FIELD_CODE_NOISE_PATTERN = /\b(?:HYPERLINK|PAGEREF|TOC|REF)\b\s+"[^"]*"\s*/gi;
    private static readonly HEADER_FOOTER_FIELD_PATTERN = /\b(?:PAGE|NUMPAGES|SECTIONPAGE|SECTIONPAGES|SECTION|SECTIONS)\b/gi;

    public static async parseToHtml(filePath: string): Promise<string> {
        const buffer = await fs.promises.readFile(filePath);
        const cfb = this.parseCfb(buffer);
        const wordStream = cfb.getStream('WordDocument');
        if (!wordStream) {
            throw new Error('Invalid .doc file: missing WordDocument stream.');
        }

        const fib = this.parseFib(wordStream);
        const extracted = this.extractDocumentText(cfb, wordStream, fib);
        const objectPlacementMode = this.detectEmbeddedObjectPlacementMode(cfb, buffer);
        const images = this.extractImages(cfb);
        const embeddedTables = this.extractEmbeddedWorkbookTables(cfb, objectPlacementMode);
        const embeddedPackageCharts = await this.extractEmbeddedPackageCharts(cfb, objectPlacementMode);
        const blocks = this.buildDocumentBlocks(extracted.text, images, extracted.styledParagraphs);
        if (blocks.length > 0 || embeddedTables.length > 0 || embeddedPackageCharts.length > 0) {
            const combinedBlocks = this.composeDocumentBlocks(blocks, embeddedPackageCharts, embeddedTables, images);
            return this.wrapLegacyHtml(this.buildLegacySections(combinedBlocks, extracted.headerFooterBySection));
        }

        return '<div class="ov-doc-legacy-empty">No readable text content found in this .doc file.</div>';
    }

    private static extractDocumentText(cfb: CfbReader, wordStream: Buffer, fib: FibInfo): PieceTableCandidate {
        const candidates: PieceTableCandidate[] = [];
        const preferredTableStream = cfb.getStream(fib.tableStreamName);
        if (preferredTableStream) {
            const styleRuns = this.extractCharacterStyleRuns(wordStream, preferredTableStream, fib);
            const paragraphStyleRuns = this.extractParagraphStyleRuns(wordStream, preferredTableStream, fib);
            const sectionBoundaries = this.extractSectionBoundaries(preferredTableStream, fib, wordStream);
            const clxCandidate = this.extractFromClx(wordStream, preferredTableStream, fib);
            if (clxCandidate) {
                clxCandidate.styledParagraphs = this.buildStyledParagraphs(clxCandidate, styleRuns, paragraphStyleRuns, sectionBoundaries);
                clxCandidate.headerFooterBySection = this.extractHeaderFooterBySection(clxCandidate.decodedSegments, preferredTableStream, fib);
                candidates.push(clxCandidate);
            }

            const candidate = this.extractFromPieceTable(wordStream, preferredTableStream);
            if (candidate) {
                candidate.styledParagraphs = this.buildStyledParagraphs(candidate, styleRuns, paragraphStyleRuns, sectionBoundaries);
                candidate.headerFooterBySection = this.extractHeaderFooterBySection(candidate.decodedSegments, preferredTableStream, fib);
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

    private static extractSectionBoundaries(tableStream: Buffer, fib: FibInfo, wordStream: Buffer): SectionBoundary[] {
        if (fib.lcbPlcfSed <= 0 || fib.fcPlcfSed < 0 || fib.fcPlcfSed + fib.lcbPlcfSed > tableStream.length) {
            return [];
        }

        const plc = tableStream.subarray(fib.fcPlcfSed, fib.fcPlcfSed + fib.lcbPlcfSed);
        const possibleSedSize = 12;
        const numerator = plc.length - 4;
        const denominator = possibleSedSize + 4;
        if (numerator <= 0 || numerator % denominator !== 0) {
            return [];
        }

        const sectionCount = numerator / denominator;
        if (sectionCount <= 0) {
            return [];
        }

        const cps: number[] = [];
        for (let index = 0; index < sectionCount + 1; index++) {
            cps.push(plc.readUInt32LE(index * 4));
        }

        const boundaries: SectionBoundary[] = [];
        for (let index = 0; index < sectionCount; index++) {
            const cpStart = cps[index];
            const cpEnd = cps[index + 1];
            if (cpEnd <= cpStart) {
                continue;
            }

            boundaries.push({
                sectionIndex: index,
                cpStart,
                cpEnd,
                layout: this.extractSectionLayoutFromSed(wordStream, plc, sectionCount, index)
            });
        }

        return boundaries;
    }

    private static extractHeaderFooterBySection(
        segments: DecodedPieceSegment[] | undefined,
        tableStream: Buffer,
        fib: FibInfo
    ): Map<number, LegacyHeaderFooter> {
        const sectionMap = new Map<number, LegacyHeaderFooter>();
        if (!segments || segments.length === 0 || fib.lcbPlcfHdd <= 0 || fib.ccpHdd <= 0) {
            return sectionMap;
        }
        if (fib.fcPlcfHdd < 0 || fib.fcPlcfHdd + fib.lcbPlcfHdd > tableStream.length) {
            return sectionMap;
        }

        const plc = tableStream.subarray(fib.fcPlcfHdd, fib.fcPlcfHdd + fib.lcbPlcfHdd);
        if (plc.length < 12 || plc.length % 4 !== 0) {
            return sectionMap;
        }

        const cpCount = plc.length / 4;
        const storyCount = cpCount - 2;
        if (storyCount <= 0) {
            return sectionMap;
        }

        const cps: number[] = [];
        for (let index = 0; index < cpCount; index++) {
            cps.push(plc.readUInt32LE(index * 4));
        }

        const hddBaseCp = fib.ccpText + fib.ccpFtn;
        const resolveStoryText = (storyIndex: number): string | undefined => {
            if (storyIndex < 0 || storyIndex >= storyCount) {
                return undefined;
            }
            const startCp = hddBaseCp + cps[storyIndex];
            const endCp = hddBaseCp + cps[storyIndex + 1];
            if (endCp <= startCp) {
                return undefined;
            }
            return this.extractTextForCpRange(segments, startCp, endCp);
        };

        const resolveInheritedStoryText = (sectionIndex: number, storyOffset: number): string | undefined => {
            for (let currentSection = sectionIndex; currentSection >= 0; currentSection--) {
                const storyText = resolveStoryText(6 + currentSection * 6 + storyOffset);
                if (storyText) {
                    return storyText;
                }
            }
            return undefined;
        };

        const sectionCount = Math.max(0, Math.floor((storyCount - 6) / 6));
        for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
            sectionMap.set(sectionIndex, {
                sectionNumber: sectionIndex + 1,
                sectionCount,
                evenHeaderText: resolveInheritedStoryText(sectionIndex, 0),
                oddHeaderText: resolveInheritedStoryText(sectionIndex, 1),
                evenFooterText: resolveInheritedStoryText(sectionIndex, 2),
                oddFooterText: resolveInheritedStoryText(sectionIndex, 3),
                firstHeaderText: resolveInheritedStoryText(sectionIndex, 4),
                firstFooterText: resolveInheritedStoryText(sectionIndex, 5)
            });
        }

        return sectionMap;
    }

    private static extractTextForCpRange(
        segments: DecodedPieceSegment[],
        startCp: number,
        endCp: number
    ): string | undefined {
        if (endCp <= startCp) {
            return undefined;
        }

        let text = '';
        for (const segment of segments) {
            const segmentStart = segment.cpStart;
            const segmentEnd = segment.cpStart + segment.text.length;
            if (segmentEnd <= startCp || segmentStart >= endCp) {
                continue;
            }

            const localStart = Math.max(0, startCp - segmentStart);
            const localEnd = Math.min(segment.text.length, endCp - segmentStart);
            text += segment.text.slice(localStart, localEnd);
        }

        const normalized = text
            .replace(/\u0007/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        if (!normalized.length) {
            return undefined;
        }

        const cleaned = this.normalizeHeaderFooterText(normalized);
        return cleaned.length > 0 ? cleaned : undefined;
    }

    private static normalizeHeaderFooterText(raw: string): string {
        return (raw || '')
            .replace(this.FIELD_CODE_NOISE_PATTERN, '')
            .replace(/[\u0000-\u001f]+/g, ' ')
            .replace(/[ ]{2,}/g, ' ')
            .replace(/\s*\n\s*/g, '\n')
            .trim();
    }

    private static extractSectionLayoutFromSed(
        wordStream: Buffer,
        plc: Buffer,
        sectionCount: number,
        sectionIndex: number
    ): LegacyLayoutMetrics | undefined {
        const sedSize = 12;
        const sedOffset = (sectionCount + 1) * 4 + sectionIndex * sedSize;
        if (sedOffset < 0 || sedOffset + sedSize > plc.length) {
            return undefined;
        }

        const fcSepx = plc.readInt32LE(sedOffset + 2);
        if (fcSepx <= 0 || fcSepx + 2 > wordStream.length) {
            return undefined;
        }

        return this.parseSepxLayout(wordStream, fcSepx);
    }

    private static parseSepxLayout(wordStream: Buffer, fcSepx: number): LegacyLayoutMetrics | undefined {
        if (fcSepx < 0 || fcSepx + 2 > wordStream.length) {
            return undefined;
        }

        const cb = wordStream.readUInt16LE(fcSepx);
        const grpprlOffset = fcSepx + 2;
        if (cb <= 0 || grpprlOffset + cb > wordStream.length) {
            return undefined;
        }

        return this.parseSectionGrpprl(wordStream.subarray(grpprlOffset, grpprlOffset + cb));
    }

    private static parseSectionGrpprl(grpprl: Buffer): LegacyLayoutMetrics | undefined {
        const defaults = this.defaultLegacyLayoutMetrics();
        let layout: LegacyLayoutMetrics = { ...defaults };
        let hasOverride = false;
        let orientationLandscape = false;
        let evenlySpacedColumns = false;
        let offset = 0;

        while (offset + 2 <= grpprl.length) {
            const sprm = grpprl.readUInt16LE(offset);
            const operandLength = this.getSprmOperandLength(sprm, grpprl, offset + 2);
            if (operandLength < 0 || offset + 2 + operandLength > grpprl.length) {
                break;
            }

            const operandOffset = offset + 2;
            switch (sprm) {
            case 0xF203:
                if (operandLength >= 3) {
                    const columnIndex = grpprl[operandOffset];
                    const value = grpprl.readUInt16LE(operandOffset + 1);
                    layout.explicitColumnWidthsTwips[columnIndex] = value;
                    hasOverride = true;
                }
                break;
            case 0xF204:
                if (operandLength >= 3) {
                    const columnIndex = grpprl[operandOffset];
                    const value = grpprl.readUInt16LE(operandOffset + 1);
                    layout.explicitColumnSpacingsTwips[columnIndex] = value;
                    hasOverride = true;
                }
                break;
            case 0x500B:
                if (operandLength >= 2) {
                    layout.columns = Math.max(1, grpprl.readUInt16LE(operandOffset));
                    hasOverride = true;
                }
                break;
            case 0x900C:
                if (operandLength >= 2) {
                    layout.columnGapTwips = grpprl.readUInt16LE(operandOffset);
                    hasOverride = true;
                }
                break;
            case 0xB01F:
                if (operandLength >= 2) {
                    layout.pageWidthTwips = grpprl.readUInt16LE(operandOffset);
                    hasOverride = true;
                }
                break;
            case 0x3005:
                evenlySpacedColumns = grpprl[operandOffset] !== 0;
                hasOverride = true;
                break;
            case 0xB017:
                if (operandLength >= 2) {
                    layout.headerTopTwips = grpprl.readUInt16LE(operandOffset);
                    hasOverride = true;
                }
                break;
            case 0xB018:
                if (operandLength >= 2) {
                    layout.footerBottomTwips = grpprl.readUInt16LE(operandOffset);
                    hasOverride = true;
                }
                break;
            case 0x3019:
                layout.lineBetweenColumns = grpprl[operandOffset] !== 0;
                hasOverride = true;
                break;
            case 0xB020:
                if (operandLength >= 2) {
                    layout.pageHeightTwips = grpprl.readUInt16LE(operandOffset);
                    hasOverride = true;
                }
                break;
            case 0xB021:
                if (operandLength >= 2) {
                    layout.marginLeftTwips = grpprl.readUInt16LE(operandOffset);
                    hasOverride = true;
                }
                break;
            case 0xB022:
                if (operandLength >= 2) {
                    layout.marginRightTwips = grpprl.readUInt16LE(operandOffset);
                    hasOverride = true;
                }
                break;
            case 0x9023:
                if (operandLength >= 2) {
                    layout.marginTopTwips = Math.max(0, grpprl.readInt16LE(operandOffset));
                    hasOverride = true;
                }
                break;
            case 0x9024:
                if (operandLength >= 2) {
                    layout.marginBottomTwips = Math.max(0, grpprl.readInt16LE(operandOffset));
                    hasOverride = true;
                }
                break;
            case 0xB025:
                if (operandLength >= 2) {
                    layout.gutterTwips = grpprl.readUInt16LE(operandOffset);
                    hasOverride = true;
                }
                break;
            case 0x301D:
                orientationLandscape = grpprl[operandOffset] !== 0;
                hasOverride = true;
                break;
            case 0x322A:
                layout.rtlGutter = grpprl[operandOffset] !== 0;
                hasOverride = true;
                break;
            default:
                break;
            }

            offset += 2 + operandLength;
        }

        if (!hasOverride) {
            return undefined;
        }

        if (orientationLandscape && layout.pageHeightTwips > layout.pageWidthTwips) {
            [layout.pageWidthTwips, layout.pageHeightTwips] = [layout.pageHeightTwips, layout.pageWidthTwips];
        }

        if (layout.columns < 1) {
            layout.columns = 1;
        }
        if (!evenlySpacedColumns && layout.columns > 1) {
            layout.columns = Math.max(1, layout.columns);
        }
        if (layout.explicitColumnWidthsTwips.length > 0) {
            layout.columns = Math.max(layout.columns, layout.explicitColumnWidthsTwips.filter((value) => value > 0).length);
        }

        return layout;
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
        const ccpFtn = fibRgLwLength >= 20 && fibRgLwOffset + 20 <= wordStream.length
            ? wordStream.readUInt32LE(fibRgLwOffset + 16)
            : 0;
        const ccpHdd = fibRgLwLength >= 24 && fibRgLwOffset + 24 <= wordStream.length
            ? wordStream.readUInt32LE(fibRgLwOffset + 20)
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

        const sed = readPair(6);
        const hdd = readPair(11);
        const clx = readPair(33);
        const chpx = readPair(12);
        const papx = readPair(13);

        return {
            nFib,
            tableStreamName,
            ccpText,
            ccpFtn,
            ccpHdd,
            fcPlcfSed: sed.fc,
            lcbPlcfSed: sed.lcb,
            fcPlcfHdd: hdd.fc,
            lcbPlcfHdd: hdd.lcb,
            fcClx: clx.fc,
            lcbClx: clx.lcb,
            fcPlcfBteChpx: chpx.fc,
            lcbPlcfBteChpx: chpx.lcb,
            fcPlcfBtePapx: papx.fc,
            lcbPlcfBtePapx: papx.lcb
        };
    }

    private static detectEmbeddedObjectPlacementMode(
        cfb: CfbReader,
        fileBuffer: Buffer
    ): 'text-flow' | 'drawing-anchor' {
        const markerStreams = cfb.listStreams()
            .map((stream) => stream.name)
            .join('\n');
        const markerPattern = /ObjectPool|MsoDataStore|OfficeArt|Escher|Drawing/i;
        if (markerPattern.test(markerStreams)) {
            return 'drawing-anchor';
        }

        const probeBuffers = [
            fileBuffer,
            cfb.getStream('WordDocument'),
            cfb.getStream('1Table'),
            cfb.getStream('0Table'),
            cfb.getStream('Data')
        ].filter((buffer): buffer is Buffer => Buffer.isBuffer(buffer));

        const markerBytes = [/MSODRAWING/i, /OfficeArt/i, /Escher/i, /FSPA/i, /PlcfSpa/i];
        for (const probe of probeBuffers) {
            const ascii = probe.toString('latin1');
            if (markerBytes.some((pattern) => pattern.test(ascii))) {
                return 'drawing-anchor';
            }
        }

        return 'text-flow';
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
                        cpStart: cps[i],
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
                        cpStart: cps[i],
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
            case 0x2405:
                style.keepLinesTogether = grpprl[operandOffset] !== 0;
                break;
            case 0x2406:
                style.keepWithNext = grpprl[operandOffset] !== 0;
                break;
            case 0x2407:
                style.pageBreakBefore = grpprl[operandOffset] !== 0;
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
        paragraphStyleRuns: ParagraphStyleRun[],
        sectionBoundaries: SectionBoundary[]
    ): StyledParagraph[] | undefined {
        if ((!styleRuns.length && !paragraphStyleRuns.length) || !candidate.decodedSegments || candidate.decodedSegments.length === 0) {
            return undefined;
        }

        return this.enrichStructuredTableParagraphs(
            this.buildStyledParagraphsFromSegments(candidate.decodedSegments, styleRuns, paragraphStyleRuns, sectionBoundaries)
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
        paragraphStyleRuns: ParagraphStyleRun[],
        sectionBoundaries: SectionBoundary[]
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
        let pendingPageBreakBefore = false;
        let paragraphCpStart: number | undefined;
        const fontSizes = new Map<number, number>();
        const textColors = new Map<string, number>();
        const backgroundColors = new Map<string, number>();
        const highlightColors = new Map<string, number>();

        const resolveSectionIndex = (cp: number | undefined): number | undefined => {
            const boundary = resolveSectionBoundary(cp);
            return boundary?.sectionIndex;
        };

        const resolveSectionBoundary = (cp: number | undefined): SectionBoundary | undefined => {
            if (cp === undefined || sectionBoundaries.length === 0) {
                return undefined;
            }

            for (const boundary of sectionBoundaries) {
                if (cp >= boundary.cpStart && cp < boundary.cpEnd) {
                    return boundary;
                }
            }

            return cp >= sectionBoundaries[sectionBoundaries.length - 1].cpEnd
                ? sectionBoundaries[sectionBoundaries.length - 1]
                : undefined;
        };
        const countAdjacentParagraphBreaks = (
            text: string,
            startIndex: number,
            direction: -1 | 1
        ): number => {
            let count = 0;
            let cursor = startIndex + direction;
            while (cursor >= 0 && cursor < text.length) {
                const code = text.charCodeAt(cursor);
                if (code === 0x000d || code === 0x000b) {
                    count += 1;
                    cursor += direction;
                    continue;
                }
                if (code === 0x0020 || code === 0x0009) {
                    cursor += direction;
                    continue;
                }
                break;
            }
            return count;
        };

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
            const preserveEmpty = normalized.length === 0
                && !currentParagraphStyle.inTable
                && !currentParagraphStyle.isTableTerminator
                && this.hasCharacterStyle(currentParagraphStyle);
            if (normalized.length > 0 || currentParagraphStyle.inTable || currentParagraphStyle.isTableTerminator || preserveEmpty) {
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

                const sectionBoundary = resolveSectionBoundary(paragraphCpStart);
                paragraphs.push({
                    text: normalized,
                    style: this.mergeStyles(currentParagraphStyle, this.hasCharacterStyle(style) ? style : undefined),
                    runs: this.normalizeInlineRuns(currentRuns),
                    listLevel: this.inferListLevel(currentParagraphStyle),
                    inTable: Boolean(currentParagraphStyle.inTable),
                    isTableTerminator: Boolean(currentParagraphStyle.isTableTerminator),
                    tableColumnCount: currentParagraphStyle.tableColumnCount,
                    tableColumnWidthsTwips: currentParagraphStyle.tableColumnWidthsTwips,
                    tableCellMerges: currentParagraphStyle.tableCellMerges,
                    preserveEmpty,
                    pageBreakBefore: pendingPageBreakBefore || Boolean(currentParagraphStyle.pageBreakBefore),
                    sectionIndex: sectionBoundary?.sectionIndex,
                    sectionLayout: sectionBoundary?.layout
                });
                pendingPageBreakBefore = false;
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
            paragraphCpStart = undefined;
            fontSizes.clear();
            textColors.clear();
            backgroundColors.clear();
            highlightColors.clear();
        };

        for (const segment of segments) {
            for (let index = 0; index < segment.text.length; index++) {
                const char = segment.text[index];
                const code = char.charCodeAt(0);
                const cp = segment.cpStart + index;
                const fc = segment.fcStart + index * segment.bytesPerChar;
                const paragraphStyle = this.findParagraphStyleForFc(paragraphStyleRuns, fc);

                if (code === 0x0013) {
                    const field = this.readFieldInstruction(segment.text, index);
                    if (field) {
                        const embeddedObjectClass = this.parseEmbeddedChartObjectClass(field.fieldCode);
                        if (embeddedObjectClass) {
                            const anchorPageBreakBefore = pendingPageBreakBefore
                                || Boolean(currentParagraphStyle.pageBreakBefore);
                            if (paragraphStyle) {
                                currentParagraphStyle = this.mergeStyles(currentParagraphStyle, paragraphStyle) ?? currentParagraphStyle;
                            }
                            flushParagraph();
                            const sectionBoundary = resolveSectionBoundary(cp);
                            paragraphs.push({
                                text: '',
                                embeddedChartAnchor: true,
                                embeddedObjectClass,
                                pageBreakBefore: anchorPageBreakBefore,
                                sectionIndex: sectionBoundary?.sectionIndex,
                                sectionLayout: sectionBoundary?.layout
                            });
                            pendingPageBreakBefore = false;
                        }
                        index = field.fieldEndIndex;
                        continue;
                    }
                }

                if (code === 0x0001) {
                    const anchorPageBreakBefore = pendingPageBreakBefore || Boolean(currentParagraphStyle.pageBreakBefore);
                    if (paragraphStyle) {
                        currentParagraphStyle = this.mergeStyles(currentParagraphStyle, paragraphStyle) ?? currentParagraphStyle;
                    }
                    flushParagraph();
                    const sectionBoundary = resolveSectionBoundary(cp);
                    paragraphs.push({
                        text: '',
                        embeddedImageAnchor: true,
                        floatingSide: this.inferFloatingSideFromStyle(currentParagraphStyle),
                        floatingWidthMode: this.inferFloatingWidthModeFromStyle(currentParagraphStyle),
                        floatingPlacement: this.inferFloatingPlacementFromStyle(currentParagraphStyle),
                        floatingClearancePx: this.inferFloatingClearancePx(currentParagraphStyle),
                        pageBreakBefore: anchorPageBreakBefore,
                        sectionIndex: sectionBoundary?.sectionIndex,
                        sectionLayout: sectionBoundary?.layout
                    });
                    pendingPageBreakBefore = false;
                    continue;
                }

                if (code === 0x0008) {
                    const surroundingBreakCount = countAdjacentParagraphBreaks(segment.text, index, -1)
                        + countAdjacentParagraphBreaks(segment.text, index, 1);
                    const anchorPageBreakBefore = pendingPageBreakBefore
                        || Boolean(currentParagraphStyle.pageBreakBefore);
                    const embeddedAssetPreference = surroundingBreakCount >= 8 ? 'chart' : 'image';
                    if (paragraphStyle) {
                        currentParagraphStyle = this.mergeStyles(currentParagraphStyle, paragraphStyle) ?? currentParagraphStyle;
                    }
                    flushParagraph();
                    const sectionBoundary = resolveSectionBoundary(cp);
                    paragraphs.push({
                        text: '',
                        embeddedAssetAnchor: true,
                        embeddedAssetPreference,
                        pageBreakBefore: anchorPageBreakBefore,
                        sectionIndex: sectionBoundary?.sectionIndex,
                        sectionLayout: sectionBoundary?.layout
                    });
                    pendingPageBreakBefore = false;
                    continue;
                }

                if (code === 0x000c) {
                    flushParagraph();
                    pendingPageBreakBefore = true;
                    continue;
                }

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
                if (paragraphCpStart === undefined) {
                    paragraphCpStart = cp;
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

    private static readFieldInstruction(
        text: string,
        startIndex: number
    ): { fieldCode: string; fieldEndIndex: number } | undefined {
        if (text.charCodeAt(startIndex) !== 0x0013) {
            return undefined;
        }

        let separatorIndex = -1;
        let endIndex = -1;
        for (let index = startIndex + 1; index < text.length; index++) {
            const code = text.charCodeAt(index);
            if (code === 0x0014 && separatorIndex < 0) {
                separatorIndex = index;
            }
            if (code === 0x0015) {
                endIndex = index;
                break;
            }
        }

        if (endIndex < 0) {
            return undefined;
        }

        const rawCode = text.slice(startIndex + 1, separatorIndex >= 0 ? separatorIndex : endIndex);
        return {
            fieldCode: rawCode.replace(/[\u0000-\u001f]+/g, ' ').trim(),
            fieldEndIndex: endIndex
        };
    }

    private static parseEmbeddedChartObjectClass(fieldCode: string): string | undefined {
        const match = fieldCode.match(/\bEMBED\s+([^\s]+)/i);
        if (!match) {
            return undefined;
        }

        const objectClass = match[1].trim();
        return /chart/i.test(objectClass) ? objectClass : undefined;
    }

    private static normalizeInlineRuns(runs: Array<{ text: string; style?: CharacterStyle }>): Array<{ text: string; style?: CharacterStyle }> | undefined {
        const normalizedRuns: Array<{ text: string; style?: CharacterStyle }> = [];

        for (const run of runs) {
            const text = run.text.replace(/\u0000/g, '');
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
            && Boolean(left?.pageBreakBefore) === Boolean(right?.pageBreakBefore)
            && Boolean(left?.keepWithNext) === Boolean(right?.keepWithNext)
            && Boolean(left?.keepLinesTogether) === Boolean(right?.keepLinesTogether)
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
                || style.pageBreakBefore
                || style.keepWithNext
                || style.keepLinesTogether
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
        const blocks = this.buildDocumentBlocks(rawText, images, styledParagraphs);
        if (blocks.length === 0) {
            return '';
        }

        return this.wrapLegacyHtml(this.buildLegacySections(blocks));
    }

    private static buildDocumentBlocks(
        rawText: string,
        images: Array<{ src: string; alt: string }>,
        styledParagraphs?: StyledParagraph[]
    ): LegacyBlock[] {
        const lines = this.buildRenderableLines(rawText, styledParagraphs);
        if (lines.length === 0 && images.length === 0) {
            return [];
        }

        return this.buildBlocks(lines);
    }

    private static buildRenderableLines(rawText: string, styledParagraphs?: StyledParagraph[]): StyledLine[] {
        const rawLines: StyledLine[] = styledParagraphs && styledParagraphs.length > 0
            ? styledParagraphs
                .map((entry) => {
                    const normalizedText = this.normalizeParagraphText(entry.text, true);
                    const fallbackEmbeddedObjectClass = !entry.embeddedChartAnchor
                        ? this.parseEmbeddedChartObjectClass(normalizedText)
                        : undefined;
                    return {
                        text: normalizedText,
                        style: entry.style,
                        runs: entry.runs,
                        listLevel: entry.listLevel,
                        inTable: entry.inTable,
                        isTableTerminator: entry.isTableTerminator,
                        tableColumnCount: entry.tableColumnCount,
                        tableColumnWidthsTwips: entry.tableColumnWidthsTwips,
                        tableCellMerges: entry.tableCellMerges,
                        embeddedChartAnchor: entry.embeddedChartAnchor || Boolean(fallbackEmbeddedObjectClass),
                        embeddedImageAnchor: entry.embeddedImageAnchor,
                        embeddedAssetAnchor: entry.embeddedAssetAnchor,
                        embeddedAssetPreference: entry.embeddedAssetPreference,
                        embeddedObjectClass: entry.embeddedObjectClass || fallbackEmbeddedObjectClass,
                        floatingSide: entry.floatingSide,
                        floatingWidthMode: entry.floatingWidthMode,
                        floatingPlacement: entry.floatingPlacement,
                        floatingClearancePx: entry.floatingClearancePx,
                        preserveEmpty: entry.preserveEmpty,
                        pageBreakBefore: entry.pageBreakBefore,
                        sectionIndex: entry.sectionIndex,
                        sectionLayout: entry.sectionLayout
                    };
                })
                .filter((entry) => entry.text.length > 0 || entry.preserveEmpty || entry.inTable || entry.isTableTerminator || entry.embeddedChartAnchor || entry.embeddedImageAnchor || entry.embeddedAssetAnchor)
            : rawText
                .split(/\n+/)
                .map((text) => {
                    const normalizedText = this.normalizeParagraphText(text, true);
                    const fallbackEmbeddedObjectClass = this.parseEmbeddedChartObjectClass(normalizedText);
                    return {
                        text: normalizedText,
                        embeddedChartAnchor: Boolean(fallbackEmbeddedObjectClass),
                        embeddedObjectClass: fallbackEmbeddedObjectClass
                    };
                })
                .filter((entry) => entry.text.length > 0);

        return rawLines.filter((line, index) => (
            line.inTable
            || line.preserveEmpty
            || line.isTableTerminator
            || line.embeddedChartAnchor
            || line.embeddedImageAnchor
            || line.embeddedAssetAnchor
            || !this.shouldDropLine(line.text, rawLines[index - 1]?.text || '', rawLines[index + 1]?.text || '')
        ));
    }

    private static composeDocumentBlocks(
        baseBlocks: LegacyBlock[],
        packageCharts: EmbeddedSheetData[],
        workbookTables: EmbeddedSheetData[],
        images: Array<{ src: string; alt: string }> = []
    ): LegacyBlock[] {
        const combinedBlocks = [...baseBlocks];
        const packageBlocks = this.buildEmbeddedSheetBlocks(packageCharts);
        const inferSectionMetadataAround = (blocks: LegacyBlock[], index: number): Pick<LegacyBlock, 'sectionIndex' | 'sectionLayout'> => {
            for (let current = index - 1; current >= 0; current--) {
                const candidate = blocks[current];
                if (candidate.sectionIndex !== undefined || candidate.sectionLayout !== undefined) {
                    return {
                        sectionIndex: candidate.sectionIndex,
                        sectionLayout: candidate.sectionLayout
                    };
                }
            }

            for (let current = index; current < blocks.length; current++) {
                const candidate = blocks[current];
                if (candidate.sectionIndex !== undefined || candidate.sectionLayout !== undefined) {
                    return {
                        sectionIndex: candidate.sectionIndex,
                        sectionLayout: candidate.sectionLayout
                    };
                }
            }

            return {};
        };
        const inheritBlockMetadata = <T extends LegacyBlock>(
            block: T,
            metadata?: Pick<LegacyBlock, 'sectionIndex' | 'sectionLayout' | 'pageBreakBefore'>
        ): T => ({
            ...block,
            pageBreakBefore: block.pageBreakBefore ?? metadata?.pageBreakBefore,
            sectionIndex: block.sectionIndex ?? metadata?.sectionIndex,
            sectionLayout: block.sectionLayout ?? metadata?.sectionLayout
        });
        const imageQueue = [...images];
        const chartQueue = [...packageBlocks];
        const normalizeAssetCueText = (value: string | undefined): string => this.normalizeParagraphText(this.stripFieldCodeNoise(value || ''))
            .replace(/\s+/g, ' ')
            .trim();
        const getCaptionCueKind = (block: LegacyBlock): 'chart' | 'image' | undefined => {
            if (block.kind !== 'paragraph' && block.kind !== 'heading') {
                return undefined;
            }

            const normalized = normalizeAssetCueText(block.text);
            if (!normalized || normalized.length > 120) {
                return undefined;
            }

            if (/^(chart|table|diagram|graph|도표|차트|표)\s*([0-9]+|[ivxlcdm]+)?(?:[\s:.)-]|$)/i.test(normalized)) {
                return 'chart';
            }

            if (/^(figure|fig\.?|image|photo|picture|그림|사진)\s*([0-9]+|[ivxlcdm]+)?(?:[\s:.)-]|$)/i.test(normalized)) {
                return 'image';
            }

            return undefined;
        };
        const findCaptionInsertionIndex = (blocks: LegacyBlock[], kind: 'chart' | 'image'): number | undefined => {
            for (let index = 0; index < blocks.length; index++) {
                const cueKind = getCaptionCueKind(blocks[index]);
                if (cueKind === kind) {
                    return index + 1;
                }
            }

            return undefined;
        };
        for (let index = 0; index < combinedBlocks.length; index++) {
            if (combinedBlocks[index].kind !== 'embedded-asset-anchor') {
                continue;
            }

            const anchor = combinedBlocks[index];
            if (anchor.kind !== 'embedded-asset-anchor') {
                continue;
            }
            const metadata = {
                pageBreakBefore: anchor.pageBreakBefore,
                sectionIndex: anchor.sectionIndex,
                sectionLayout: anchor.sectionLayout
            };
            const preferredKind = anchor.assetPreference;

            if (preferredKind === 'chart' && chartQueue.length > 0) {
                combinedBlocks.splice(index, 1, inheritBlockMetadata(
                    chartQueue.shift() as LegacyBlock,
                    metadata
                ));
                continue;
            }

            if (preferredKind === 'image' && imageQueue.length > 0) {
                const image = imageQueue.shift() as { src: string; alt: string };
                combinedBlocks.splice(index, 1, inheritBlockMetadata({
                    kind: 'image',
                    ...image
                }, metadata));
                continue;
            }

            if (imageQueue.length > 0) {
                const image = imageQueue.shift() as { src: string; alt: string };
                combinedBlocks.splice(index, 1, inheritBlockMetadata({
                    kind: 'image',
                    ...image
                }, metadata));
                continue;
            }

            if (chartQueue.length > 0) {
                combinedBlocks.splice(index, 1, inheritBlockMetadata(
                    chartQueue.shift() as LegacyBlock,
                    metadata
                ));
                continue;
            }
        }
        if (packageBlocks.length > 0) {
            const remaining = [...chartQueue];
            for (let index = 0; index < combinedBlocks.length && remaining.length > 0; index++) {
                if (combinedBlocks[index].kind !== 'embedded-chart-anchor') {
                    continue;
                }

                const anchor = combinedBlocks[index];
                combinedBlocks.splice(index, 1, inheritBlockMetadata(
                    remaining.shift() as LegacyBlock,
                    {
                        pageBreakBefore: anchor.pageBreakBefore,
                        sectionIndex: anchor.sectionIndex,
                        sectionLayout: anchor.sectionLayout
                    }
                ));
            }

            const filtered = combinedBlocks.filter((block) => block.kind !== 'embedded-chart-anchor');
            combinedBlocks.splice(0, combinedBlocks.length, ...filtered);

            if (remaining.length > 0) {
                for (const block of remaining) {
                    const insertionIndex = findCaptionInsertionIndex(combinedBlocks, 'chart')
                        ?? this.findPreferredAssetInsertionIndex(combinedBlocks);
                    const sectionMetadata = inferSectionMetadataAround(combinedBlocks, insertionIndex);
                    combinedBlocks.splice(insertionIndex, 0, inheritBlockMetadata(block, sectionMetadata));
                }
            }
        } else {
            const filtered = combinedBlocks.filter((block) => block.kind !== 'embedded-chart-anchor');
            combinedBlocks.splice(0, combinedBlocks.length, ...filtered);
        }

        const workbookBlocks = this.buildEmbeddedSheetBlocks(workbookTables);
        if (workbookBlocks.length > 0) {
                const insertionIndex = this.findPreferredAssetInsertionIndex(combinedBlocks);
                const sectionMetadata = inferSectionMetadataAround(combinedBlocks, insertionIndex);
                combinedBlocks.splice(insertionIndex, 0, ...workbookBlocks.map((block) => inheritBlockMetadata(block, sectionMetadata)));
            }

        const imageAnchorIndexes = combinedBlocks
            .map((block, index) => (block.kind === 'image-gallery' && block.images.length === 0 ? index : -1))
            .filter((index) => index >= 0);

        const remainingImages = [...imageQueue];
        for (const index of imageAnchorIndexes) {
            const gallery = combinedBlocks[index];
            if (gallery.kind !== 'image-gallery') {
                continue;
            }

            if (remainingImages.length === 0) {
                continue;
            }

            const image = remainingImages.shift() as { src: string; alt: string };
            combinedBlocks.splice(index, 1, {
                kind: 'image',
                ...image,
                floating: gallery.floating,
                floatingSide: gallery.floatingSide,
                floatingWidthMode: gallery.floatingWidthMode,
                floatingPlacement: gallery.floatingPlacement,
                floatingClearancePx: gallery.floatingClearancePx,
                pageBreakBefore: gallery.pageBreakBefore,
                sectionIndex: gallery.sectionIndex,
                sectionLayout: gallery.sectionLayout
            });
        }

        if (remainingImages.length > 0) {
            for (const image of remainingImages) {
                const insertionIndex = findCaptionInsertionIndex(combinedBlocks, 'image')
                    ?? findCaptionInsertionIndex(combinedBlocks, 'chart')
                    ?? this.findPreferredAssetInsertionIndex(combinedBlocks);
                const sectionMetadata = inferSectionMetadataAround(combinedBlocks, insertionIndex);
                combinedBlocks.splice(insertionIndex, 0, inheritBlockMetadata({
                    kind: 'image',
                    ...image
                }, sectionMetadata));
            }
        }

        const filteredBlocks = combinedBlocks.filter((block) => (
            !(block.kind === 'image-gallery' && block.images.length === 0)
            && block.kind !== 'embedded-asset-anchor'
        ));
        combinedBlocks.splice(0, combinedBlocks.length, ...filteredBlocks);

        return combinedBlocks;
    }

    private static findPreferredAssetInsertionIndex(blocks: LegacyBlock[]): number {
        for (let index = blocks.length - 1; index >= 0; index--) {
            if (blocks[index].kind === 'table') {
                return index + 1;
            }
        }

        return blocks.length;
    }

    private static buildEmbeddedSheetBlocks(sheets: EmbeddedSheetData[]): LegacyBlock[] {
        return sheets.map((sheet) => ({
            kind: 'embedded-sheet',
            title: sheet.title,
            chart: sheet.chart,
            rows: sheet.showTable ? sheet.rows : undefined,
            objectPlacementMode: sheet.objectPlacementMode
        }));
    }

    private static wrapLegacyHtml(sections: LegacySection[]): string {
        return this.renderLegacyDocumentModel(this.buildRenderedDocumentModel(this.buildSemanticDocumentModel(sections)));
    }

    private static buildSemanticDocumentModel(sections: LegacySection[]): LegacySemanticDocumentModel {
        return {
            sections: sections.map((section) => this.buildSemanticSectionModel(section))
        };
    }

    private static buildSemanticSectionModel(section: LegacySection): LegacySemanticSectionModel {
        const semanticBlocks: LegacySemanticBlockModel[] = [];
        for (const block of section.blocks) {
            const model = this.buildSemanticBlockModel(block, semanticBlocks.length === 0);
            if (model) {
                semanticBlocks.push(model);
            }
        }

        return {
            sectionIndex: section.sectionIndex,
            layout: section.layout,
            headerFooter: this.buildSemanticHeaderFooterModel(section.headerFooter),
            blocks: semanticBlocks
        };
    }

    private static buildRenderedDocumentModel(documentModel: LegacySemanticDocumentModel): LegacyRenderedDocumentModel {
        return {
            sections: documentModel.sections.map((section) => this.buildRenderedSectionModel(section))
        };
    }

    private static buildRenderedSectionModel(section: LegacySemanticSectionModel): LegacyRenderedSectionModel {
        const renderedBlocks: LegacyRenderedBlockModel[] = [];
        for (const block of section.blocks) {
            const model = this.buildRenderedBlockModel(block);
            if (model) {
                renderedBlocks.push(model);
            }
        }

        return {
            sectionIndex: section.sectionIndex,
            layout: section.layout,
            headerFooter: this.buildRenderedHeaderFooterModel(section.headerFooter),
            renderedBlocks
        };
    }

    private static buildSemanticHeaderFooterModel(headerFooter?: LegacyHeaderFooter): LegacySemanticHeaderFooterModel | undefined {
        if (!headerFooter) {
            return undefined;
        }

        const buildTokens = (value?: string): LegacyHeaderFooterToken[] | undefined => {
            const tokens = this.tokenizeHeaderFooterText(value);
            return tokens.length > 0 ? tokens : undefined;
        };

        return {
            sectionNumber: headerFooter.sectionNumber,
            sectionCount: headerFooter.sectionCount,
            evenHeaderTokens: buildTokens(headerFooter.evenHeaderText),
            oddHeaderTokens: buildTokens(headerFooter.oddHeaderText),
            evenFooterTokens: buildTokens(headerFooter.evenFooterText),
            oddFooterTokens: buildTokens(headerFooter.oddFooterText),
            firstHeaderTokens: buildTokens(headerFooter.firstHeaderText),
            firstFooterTokens: buildTokens(headerFooter.firstFooterText)
        };
    }

    private static buildRenderedHeaderFooterModel(headerFooter?: LegacySemanticHeaderFooterModel): LegacyHeaderFooter | undefined {
        if (!headerFooter) {
            return undefined;
        }

        const stringify = (tokens?: LegacyHeaderFooterToken[]): string | undefined => {
            if (!tokens || tokens.length === 0) {
                return undefined;
            }
            return tokens.map((token) => token.kind === 'text' ? token.value : token.field).join('');
        };

        return {
            sectionNumber: headerFooter.sectionNumber,
            sectionCount: headerFooter.sectionCount,
            evenHeaderText: stringify(headerFooter.evenHeaderTokens),
            oddHeaderText: stringify(headerFooter.oddHeaderTokens),
            evenFooterText: stringify(headerFooter.evenFooterTokens),
            oddFooterText: stringify(headerFooter.oddFooterTokens),
            firstHeaderText: stringify(headerFooter.firstHeaderTokens),
            firstFooterText: stringify(headerFooter.firstFooterTokens)
        };
    }

    private static renderLegacyDocumentModel(documentModel: LegacyRenderedDocumentModel): string {
        const content = documentModel.sections
            .map((section) => {
                const style = [
                    `--ov-page-width-mm:${this.twipsToMm(section.layout.pageWidthTwips).toFixed(2)}mm`,
                    `--ov-page-height-mm:${this.twipsToMm(section.layout.pageHeightTwips).toFixed(2)}mm`,
                    `--ov-page-padding-top-mm:${this.twipsToMm(section.layout.marginTopTwips).toFixed(2)}mm`,
                    `--ov-page-padding-right-mm:${this.twipsToMm(section.layout.marginRightTwips).toFixed(2)}mm`,
                    `--ov-page-padding-bottom-mm:${this.twipsToMm(section.layout.marginBottomTwips).toFixed(2)}mm`,
                    `--ov-page-padding-left-mm:${this.twipsToMm(section.layout.marginLeftTwips).toFixed(2)}mm`,
                    `--ov-page-gutter-mm:${this.twipsToMm(section.layout.gutterTwips).toFixed(2)}mm`,
                    `--ov-page-header-mm:${this.twipsToMm(section.layout.headerTopTwips).toFixed(2)}mm`,
                    `--ov-page-footer-mm:${this.twipsToMm(section.layout.footerBottomTwips).toFixed(2)}mm`,
                    `--ov-columns:${Math.max(1, section.layout.columns)}`,
                    `--ov-column-gap-mm:${this.twipsToMm(section.layout.columnGapTwips).toFixed(2)}mm`,
                    `--ov-column-rule-width:${section.layout.lineBetweenColumns ? '1px' : '0px'}`,
                    `--ov-gutter-side:${section.layout.rtlGutter ? 'right' : 'left'}`
                ].join(';');

                const metaJson = this.escapeHtml(JSON.stringify(section.headerFooter ?? {}));
                const columnWidths = section.layout.explicitColumnWidthsTwips.map((value) => this.twipsToMm(value).toFixed(2)).join(',');
                const columnSpacings = section.layout.explicitColumnSpacingsTwips.map((value) => this.twipsToMm(value).toFixed(2)).join(',');
                const blocksHtml = section.renderedBlocks
                    .map((block) => this.wrapLegacyBlock(block))
                    .join('\n');
                return `<section class="ov-doc-legacy-section" data-ov-gutter-side="${section.layout.rtlGutter ? 'right' : 'left'}" data-ov-columns="${Math.max(1, section.layout.columns)}" data-ov-custom-columns="${section.layout.explicitColumnWidthsTwips.length > 0 ? 'true' : 'false'}" data-ov-column-widths="${columnWidths}" data-ov-column-spacings="${columnSpacings}" style="${style}"><script type="application/json" class="ov-doc-legacy-section-meta">${metaJson}</script>${blocksHtml}</section>`;
            })
            .join('');

        return `<div class="ov-doc-legacy">${content}</div>`;
    }

    private static inferLegacyLayoutMetrics(blocks: LegacyBlock[]): LegacyLayoutMetrics {
        const explicitLayout = blocks.find((block) => block.sectionLayout)?.sectionLayout;
        if (explicitLayout) {
            return explicitLayout;
        }

        const a4Portrait = { width: 11906, height: 16838 };
        const a4Landscape = { width: 16838, height: 11906 };
        const standardMarginTwips = 1440;
        const narrowMarginTwips = 1080;

        const widestTableTwips = blocks
            .filter((block): block is Extract<LegacyBlock, { kind: 'table' }> => block.kind === 'table')
            .map((block) => (block.columnWidthsTwips ?? []).reduce((sum, width) => sum + Math.max(0, width), 0))
            .reduce((widest, width) => Math.max(widest, width), 0);

        const needsLandscape = widestTableTwips > (a4Portrait.width - standardMarginTwips * 2);
        const page = needsLandscape ? a4Landscape : a4Portrait;
        const sideMarginTwips = needsLandscape && widestTableTwips > (page.width - standardMarginTwips * 2)
            ? narrowMarginTwips
            : standardMarginTwips;

        return {
            pageWidthTwips: page.width,
            pageHeightTwips: page.height,
            marginTopTwips: standardMarginTwips,
            marginRightTwips: sideMarginTwips,
            marginBottomTwips: standardMarginTwips,
            marginLeftTwips: sideMarginTwips,
            gutterTwips: 0,
            headerTopTwips: 720,
            footerBottomTwips: 720,
            columns: 1,
            columnGapTwips: 720,
            lineBetweenColumns: false,
            rtlGutter: false,
            explicitColumnWidthsTwips: [],
            explicitColumnSpacingsTwips: []
        };
    }

    private static defaultLegacyLayoutMetrics(): LegacyLayoutMetrics {
        return {
            pageWidthTwips: 11906,
            pageHeightTwips: 16838,
            marginTopTwips: 1440,
            marginRightTwips: 1440,
            marginBottomTwips: 1440,
            marginLeftTwips: 1440,
            gutterTwips: 0,
            headerTopTwips: 720,
            footerBottomTwips: 720,
            columns: 1,
            columnGapTwips: 720,
            lineBetweenColumns: false,
            rtlGutter: false,
            explicitColumnWidthsTwips: [],
            explicitColumnSpacingsTwips: []
        };
    }

    private static buildLegacySections(blocks: LegacyBlock[], headerFooterBySection?: Map<number, LegacyHeaderFooter>): LegacySection[] {
        if (blocks.length === 0) {
            return [];
        }

        const sections: LegacySection[] = [];
        let currentBlocks: LegacyBlock[] = [];

        const flushSection = () => {
            if (currentBlocks.length === 0) {
                return;
            }

            sections.push({
                sectionIndex: currentBlocks[0]?.sectionIndex,
                layout: this.inferLegacyLayoutMetrics(currentBlocks),
                blocks: currentBlocks,
                headerFooter: currentBlocks[0]?.sectionIndex !== undefined
                    ? headerFooterBySection?.get(currentBlocks[0].sectionIndex)
                    : undefined
            });
            currentBlocks = [];
        };

        for (const block of blocks) {
            const sectionIndexChanged = currentBlocks.length > 0
                && block.sectionIndex !== undefined
                && currentBlocks[currentBlocks.length - 1].sectionIndex !== undefined
                && block.sectionIndex !== currentBlocks[currentBlocks.length - 1].sectionIndex;

            if (sectionIndexChanged && currentBlocks.length > 0) {
                flushSection();
            }
            currentBlocks.push(block);
        }

        flushSection();
        return sections;
    }

    private static twipsToMm(value: number): number {
        return (Math.max(0, value) / 1440) * 25.4;
    }

    private static buildBlocks(lines: StyledLine[]): LegacyBlock[] {
        const blocks: LegacyBlock[] = [];
        let index = 0;

        while (index < lines.length) {
            const line = lines[index];
            const text = line.text;
            if (line.embeddedChartAnchor) {
                blocks.push({
                    kind: 'embedded-chart-anchor',
                    objectClass: line.embeddedObjectClass,
                    pageBreakBefore: line.pageBreakBefore,
                    sectionIndex: line.sectionIndex,
                    sectionLayout: line.sectionLayout
                });
                index += 1;
                continue;
            }
            if (line.embeddedAssetAnchor) {
                blocks.push({
                    kind: 'embedded-asset-anchor',
                    assetPreference: line.embeddedAssetPreference,
                    pageBreakBefore: line.pageBreakBefore,
                    sectionIndex: line.sectionIndex,
                    sectionLayout: line.sectionLayout
                });
                index += 1;
                continue;
            }
            if (line.embeddedImageAnchor) {
                blocks.push({
                    kind: 'image-gallery',
                    images: [],
                    floating: true,
                    floatingSide: line.floatingSide,
                    floatingWidthMode: line.floatingWidthMode,
                    floatingPlacement: line.floatingPlacement,
                    floatingClearancePx: line.floatingClearancePx,
                    pageBreakBefore: line.pageBreakBefore,
                    sectionIndex: line.sectionIndex,
                    sectionLayout: line.sectionLayout
                });
                index += 1;
                continue;
            }
            const implicitBulletList = this.collectImplicitBulletList(lines, index);
            if (implicitBulletList) {
                blocks.push({
                    kind: 'list',
                    ordered: false,
                    items: implicitBulletList.items,
                    pageBreakBefore: line.pageBreakBefore,
                    sectionIndex: line.sectionIndex,
                    sectionLayout: line.sectionLayout
                });
                index = implicitBulletList.nextIndex;
                continue;
            }
            if (this.isLikelyDocumentTitle(line, index, lines)) {
                blocks.push({
                    kind: 'heading',
                    text: this.normalizeParagraphText(text),
                    style: line.style,
                    runs: line.runs,
                    pageBreakBefore: line.pageBreakBefore,
                    sectionIndex: line.sectionIndex,
                    sectionLayout: line.sectionLayout
                });
                index += 1;
                continue;
            }
            if (this.isLikelyLeadParagraph(line, lines[index + 1])) {
                blocks.push({
                    kind: 'paragraph',
                    text: this.normalizeParagraphText(text),
                    style: {
                        ...line.style,
                        bold: true,
                        fontSizeHalfPoints: Math.max(line.style?.fontSizeHalfPoints ?? 0, 36),
                        firstLineIndentTwips: 0
                    },
                    runs: this.promoteInlineRuns(line.runs, {
                        bold: true,
                        fontSizeHalfPoints: Math.max(line.style?.fontSizeHalfPoints ?? 0, 36),
                        firstLineIndentTwips: 0
                    }),
                    pageBreakBefore: line.pageBreakBefore,
                    sectionIndex: line.sectionIndex,
                    sectionLayout: line.sectionLayout
                });
                index += 1;
                continue;
            }
            if (this.isLikelySectionLeadParagraph(line, lines[index - 1], lines[index + 1])) {
                blocks.push({
                    kind: 'heading',
                    text: this.normalizeParagraphText(text),
                    style: {
                        ...line.style,
                        bold: true,
                        fontSizeHalfPoints: Math.max(line.style?.fontSizeHalfPoints ?? 0, 32)
                    },
                    runs: this.promoteInlineRuns(line.runs, {
                        bold: true,
                        fontSizeHalfPoints: Math.max(line.style?.fontSizeHalfPoints ?? 0, 32)
                    }),
                    pageBreakBefore: line.pageBreakBefore,
                    sectionIndex: line.sectionIndex,
                    sectionLayout: line.sectionLayout
                });
                index += 1;
                continue;
            }

            const structuredTable = this.collectStructuredTable(lines, index);
            if (structuredTable) {
                blocks.push({
                    kind: 'table',
                    rows: this.buildTableCells(structuredTable.rows, structuredTable.cellMerges),
                    columnWidthsTwips: structuredTable.columnWidthsTwips,
                    cellMerges: structuredTable.cellMerges,
                    pageBreakBefore: line.pageBreakBefore,
                    sectionIndex: line.sectionIndex,
                    sectionLayout: line.sectionLayout
                });
                index = structuredTable.nextIndex;
                continue;
            }

            const definitionSection = this.collectDefinitionSection(lines.map((entry) => entry.text), index);
            if (definitionSection) {
                blocks.push({ kind: 'heading', text: definitionSection.heading, sectionIndex: line.sectionIndex, sectionLayout: line.sectionLayout });
                blocks.push({ kind: 'table', rows: this.buildTableCells(definitionSection.rows), pageBreakBefore: line.pageBreakBefore, sectionIndex: line.sectionIndex, sectionLayout: line.sectionLayout });
                index = definitionSection.nextIndex;
                continue;
            }

            if (this.looksLikeSectionHeading(line, lines[index - 1], lines[index + 1])) {
                blocks.push({
                    kind: 'heading',
                    text: this.normalizeParagraphText(text),
                    style: line.style,
                    runs: line.runs,
                    pageBreakBefore: line.pageBreakBefore,
                    sectionIndex: line.sectionIndex,
                    sectionLayout: line.sectionLayout
                });
                index += 1;
                continue;
            }

            // Avoid reconstructing generic tab-delimited/plain-text tables heuristically.
            // For legacy .doc files this frequently misclassifies flowing paragraphs as
            // side-by-side columns. Prefer binary table metadata only.

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
                blocks.push({ kind: 'list', ordered: listKind.kind === 'ordered', items, pageBreakBefore: line.pageBreakBefore, sectionIndex: line.sectionIndex, sectionLayout: line.sectionLayout });
                continue;
            }

            blocks.push({
                kind: 'paragraph',
                text: this.normalizeParagraphText(text),
                style: line.style,
                runs: line.runs,
                pageBreakBefore: line.pageBreakBefore,
                sectionIndex: line.sectionIndex,
                sectionLayout: line.sectionLayout
            });
            index += 1;
        }

        return blocks;
    }

    private static collectImplicitBulletList(
        lines: StyledLine[],
        startIndex: number
    ): { items: Array<{ text: string; level: number; style?: CharacterStyle }>; nextIndex: number } | null {
        const items: Array<{ text: string; level: number; style?: CharacterStyle }> = [];
        let index = startIndex;

        while (index < lines.length) {
            const line = lines[index];
            const normalizedText = this.normalizeParagraphText(line.text);
            if (!this.isImplicitBulletCandidate(line, normalizedText)) {
                break;
            }

            items.push({
                text: normalizedText,
                level: Math.max(0, line.listLevel ?? 0),
                style: line.style
            });
            index += 1;
        }

        if (items.length < 3) {
            return null;
        }

        return {
            items,
            nextIndex: index
        };
    }

    private static isImplicitBulletCandidate(line: StyledLine | undefined, normalizedText: string): boolean {
        if (!line || !normalizedText) {
            return false;
        }

        if (
            line.inTable
            || line.isTableTerminator
            || line.embeddedChartAnchor
            || line.embeddedImageAnchor
            || line.embeddedAssetAnchor
        ) {
            return false;
        }

        if ((line.style?.keepWithNext ?? false) || (line.style?.pageBreakBefore ?? false)) {
            return false;
        }

        if (this.getListKind(normalizedText)) {
            return false;
        }

        const wordCount = normalizedText.split(/\s+/).length;
        return normalizedText.length <= 96 && wordCount >= 2 && wordCount <= 14;
    }

    private static isLikelyLeadParagraph(line: StyledLine | undefined, next?: StyledLine): boolean {
        if (!line) {
            return false;
        }

        const normalizedText = this.normalizeParagraphText(line.text);
        if (!normalizedText || normalizedText.length > 120 || !this.hasEnoughLetters(normalizedText)) {
            return false;
        }

        const hasLeadCue = Boolean(line.style?.keepWithNext)
            || Math.abs(line.style?.firstLineIndentTwips ?? 0) >= 360;
        if (!hasLeadCue) {
            return false;
        }

        const nextText = this.normalizeParagraphText(next?.text || '');
        const nextLength = nextText.length;
        const nextIsSpacer = nextLength === 0;
        const nextLooksTabular = Boolean(next?.inTable);

        return nextLength > 120 || nextIsSpacer || nextLooksTabular;
    }

    private static isLikelySectionLeadParagraph(
        line: StyledLine | undefined,
        previous?: StyledLine,
        next?: StyledLine
    ): boolean {
        if (!line) {
            return false;
        }

        const normalizedText = this.normalizeParagraphText(line.text);
        if (!normalizedText || normalizedText.length > 96 || !this.hasEnoughLetters(normalizedText)) {
            return false;
        }

        if (
            line.inTable
            || line.isTableTerminator
            || line.embeddedChartAnchor
            || line.embeddedImageAnchor
            || line.embeddedAssetAnchor
        ) {
            return false;
        }

        const previousLength = this.normalizeParagraphText(previous?.text || '').length;
        const nextLength = this.normalizeParagraphText(next?.text || '').length;
        const sparseStyle = !line.style
            || Object.keys(line.style).every((key) => ['bold', 'fontSizeHalfPoints'].includes(key));
        return nextLength > 120 && (previousLength > 120 || sparseStyle);
    }

    private static promoteInlineRuns(
        runs: Array<{ text: string; style?: CharacterStyle }> | undefined,
        style: CharacterStyle
    ): Array<{ text: string; style?: CharacterStyle }> | undefined {
        if (!runs || runs.length === 0) {
            return undefined;
        }

        return runs.map((run) => ({
            text: run.text,
            style: {
                ...run.style,
                ...style
            }
        }));
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
        let sawTerminator = false;
        let sawExplicitTableMetadata = false;

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
                    if ((line.tableColumnCount ?? 0) >= 2 || (line.tableCellMerges?.length ?? 0) > 0) {
                        sawExplicitTableMetadata = true;
                    }
                }
                index += 1;

                if (line.isTableTerminator) {
                    sawTerminator = true;
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

        if (!sawTerminator || !sawExplicitTableMetadata) {
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
            const semanticModel = this.buildSemanticBlockModel(block, rendered.length === 0);
            const model = semanticModel ? this.buildRenderedBlockModel(semanticModel) : undefined;
            if (!model) {
                continue;
            }

            rendered.push(this.wrapLegacyBlock(model));
        }

        return rendered.join('\n');
    }

    private static buildSemanticBlockModel(block: LegacyBlock, isFirstRenderableBlock: boolean): LegacySemanticBlockModel | undefined {
        if (block.kind === 'heading') {
            const merged = this.flattenSingleRunBlock(block.text, block.style, block.runs);
            return {
                kind: 'content',
                tag: isFirstRenderableBlock ? 'h1' : 'h2',
                text: merged.text,
                inlineTokens: this.buildSemanticInlineTokens(merged.runs, merged.text),
                pageBreakBefore: block.pageBreakBefore,
                style: merged.style
            };
        }

        if (block.kind === 'paragraph') {
            const merged = this.flattenSingleRunBlock(block.text, block.style, block.runs);
            return {
                kind: 'content',
                tag: 'p',
                text: merged.text,
                inlineTokens: this.buildSemanticInlineTokens(merged.runs, merged.text),
                semanticRole: this.inferSemanticContentRole(merged.text, merged.style),
                pageBreakBefore: block.pageBreakBefore,
                style: merged.style
            };
        }

        if (block.kind === 'list') {
            return {
                kind: 'list',
                ordered: block.ordered,
                items: block.items.map((item) => ({
                    text: item.text,
                    level: item.level,
                    style: {
                        ...item.style,
                        marginLeftTwips: (item.level || 0) * 360
                    }
                })),
                pageBreakBefore: block.pageBreakBefore
            };
        }

        if (block.kind === 'table') {
            return {
                kind: 'table',
                table: this.buildSemanticTableModel(block),
                pageBreakBefore: block.pageBreakBefore
            };
        }

        if (block.kind === 'embedded-sheet') {
            return {
                kind: 'sheet',
                title: block.title,
                chart: block.chart,
                rows: block.rows,
                headerRowCount: this.detectEmbeddedSheetHeaderRowCount(block.rows),
                objectPlacementMode: block.objectPlacementMode,
                pageBreakBefore: block.pageBreakBefore
            };
        }

        if (block.kind === 'image') {
            return {
                kind: 'image',
                src: block.src,
                alt: block.alt,
                floating: block.floating,
                floatingSide: block.floatingSide,
                floatingWidthMode: block.floatingWidthMode,
                floatingPlacement: block.floatingPlacement,
                floatingClearancePx: block.floatingClearancePx,
                pageBreakBefore: block.pageBreakBefore
            };
        }

        if (block.kind === 'image-gallery' && block.images.length > 0) {
            return {
                kind: 'images',
                images: block.images,
                floating: block.floating,
                floatingSide: block.floatingSide,
                floatingWidthMode: block.floatingWidthMode,
                floatingPlacement: block.floatingPlacement,
                floatingClearancePx: block.floatingClearancePx,
                pageBreakBefore: block.pageBreakBefore
            };
        }

        return undefined;
    }

    private static buildRenderedBlockModel(block: LegacySemanticBlockModel): LegacyRenderedBlockModel | undefined {
        if (block.kind === 'content') {
            const content = this.renderSemanticInlineTokens(block.inlineTokens, block.text);
            const hasInlineField = !!block.inlineTokens?.some((token) => token.kind === 'field');
            const hasInlineBreak = !!block.inlineTokens?.some((token) => token.kind === 'tab' || token.kind === 'line-break');
            const textLength = this.stripFieldCodeNoise(block.text).trim().length;
            return {
                kind: 'content',
                html: `<${block.tag}${this.renderInlineStyleAttribute(block.style)}>${content}</${block.tag}>`,
                pageBreakBefore: block.pageBreakBefore,
                style: block.style,
                semanticKind: block.kind,
                semanticTag: block.tag,
                semanticRole: block.semanticRole,
                textLength,
                hasInlineField,
                hasInlineBreak,
                estimatedHeightPx: this.estimateContentBlockHeightPx(block.tag, textLength, hasInlineBreak, block.semanticRole),
                minimumFragmentHeightPx: this.estimateContentBlockHeightPx(block.tag, Math.min(textLength, 72), hasInlineBreak, block.semanticRole)
            };
        }

        if (block.kind === 'list') {
            const listTag = block.ordered ? 'ol' : 'ul';
            const itemCount = block.items.length;
            return {
                kind: 'content',
                html: `<${listTag}>${block.items.map((item) => {
                    const style = this.renderInlineStyleAttribute(item.style);
                    return `<li${style}>${this.escapeHtml(item.text)}</li>`;
                }).join('')}</${listTag}>`,
                pageBreakBefore: block.pageBreakBefore,
                semanticKind: block.kind,
                itemCount,
                estimatedHeightPx: this.estimateListBlockHeightPx(itemCount),
                minimumFragmentHeightPx: this.estimateListBlockHeightPx(Math.min(itemCount, 2))
            };
        }

        if (block.kind === 'table') {
            const rowCount = block.table.rows.length;
            return {
                kind: 'table',
                html: this.renderRenderedTableModel(this.buildRenderedTableModel(block.table)),
                pageBreakBefore: block.pageBreakBefore,
                semanticKind: block.kind,
                rowCount,
                estimatedHeightPx: this.estimateTableBlockHeightPx(rowCount, block.table.headerRowCount),
                minimumFragmentHeightPx: this.estimateTableBlockHeightPx(
                    Math.min(rowCount, Math.max(block.table.headerRowCount + 2, 3)),
                    Math.min(block.table.headerRowCount, rowCount)
                )
            };
        }

        if (block.kind === 'sheet') {
            const parts = ['<section class="ov-doc-embedded-sheet"><div class="ov-doc-embedded-sheet-card">'];
            if (block.title) {
                parts.push(`<div class="ov-doc-embedded-sheet-head"><h2>${this.escapeHtml(block.title)}</h2></div>`);
            }
            if (block.chart) {
                parts.push(this.renderEmbeddedChart(block.chart));
            }
            if (block.rows) {
                const headerRowCount = Math.min(block.headerRowCount || 0, block.rows.length);
                const headerRows = block.rows.slice(0, headerRowCount);
                const bodyRows = block.rows.slice(headerRowCount);
                const renderRows = (rows: string[][], cellTag: 'th' | 'td') => rows
                    .map((row) => `<tr>${row.map((cell) => `<${cellTag}>${this.escapeHtml(cell)}</${cellTag}>`).join('')}</tr>`)
                    .join('');
                const theadHtml = headerRows.length > 0 ? `<thead>${renderRows(headerRows, 'th')}</thead>` : '';
                const tbodyHtml = bodyRows.length > 0 ? `<tbody>${renderRows(bodyRows, 'td')}</tbody>` : '';
                parts.push(`<div class="ov-doc-embedded-table-wrap"><div class="ov-doc-embedded-table-label">Data Table</div><div class="ov-doc-legacy-table" data-ov-table-header-rows="${headerRows.length}"><table>${theadHtml}${tbodyHtml}</table></div></div>`);
            }
            parts.push(`</div></section>`);
            return {
                kind: 'sheet',
                html: parts.join(''),
                pageBreakBefore: block.pageBreakBefore,
                semanticKind: block.kind,
                rowCount: block.rows?.length || 0,
                objectPlacementMode: block.objectPlacementMode,
                estimatedHeightPx: this.estimateSheetBlockHeightPx(block.rows?.length || 0, !!block.chart),
                minimumFragmentHeightPx: this.estimateSheetBlockHeightPx(
                    Math.min(block.rows?.length || 0, 3),
                    !!block.chart
                )
            };
        }

        if (block.kind === 'image') {
            const floatingClass = block.floating
                ? ` ov-doc-legacy-image-floating ov-doc-legacy-image-floating-${block.floatingSide || 'right'} ov-doc-legacy-image-floating-${block.floatingWidthMode || 'regular'}`
                : '';
            const figureClass = `ov-doc-legacy-image ov-doc-legacy-image-inline${floatingClass}`;
            const captionHtml = block.alt ? `<figcaption>${this.escapeHtml(block.alt)}</figcaption>` : '';
            return {
                kind: 'image',
                html: `<figure class="${figureClass}"><img src="${block.src}" alt="${this.escapeHtml(block.alt)}">${captionHtml}</figure>`,
                pageBreakBefore: block.pageBreakBefore,
                semanticKind: block.kind,
                semanticRole: block.floating ? 'floating-media' : undefined,
                mediaCount: 1,
                estimatedHeightPx: this.estimateImageBlockHeightPx(1),
                minimumFragmentHeightPx: this.estimateImageBlockHeightPx(1),
                floatingSide: block.floatingSide,
                floatingWidthMode: block.floatingWidthMode,
                floatingPlacement: block.floatingPlacement,
                floatingClearancePx: block.floatingClearancePx
            };
        }

        if (block.kind === 'images') {
            const items = block.images
                .map((image) => `<figure class="ov-doc-legacy-image${block.floating ? ` ov-doc-legacy-image-floating ov-doc-legacy-image-floating-${block.floatingSide || 'right'} ov-doc-legacy-image-floating-${block.floatingWidthMode || 'regular'}` : ''}"><img src="${image.src}" alt="${this.escapeHtml(image.alt)}">${image.alt ? `<figcaption>${this.escapeHtml(image.alt)}</figcaption>` : ''}</figure>`)
                .join('');
            const mediaCount = block.images.length;
            return {
                kind: 'images',
                html: block.images.length === 1
                    ? `<section class="ov-doc-legacy-images"><div class="ov-doc-legacy-image-grid">${items}</div></section>`
                    : `<section class="ov-doc-legacy-images"><h2>Images</h2><div class="ov-doc-legacy-image-grid">${items}</div></section>`,
                pageBreakBefore: block.pageBreakBefore,
                semanticKind: block.kind,
                semanticRole: block.floating ? 'floating-media' : undefined,
                mediaCount,
                estimatedHeightPx: this.estimateImageBlockHeightPx(mediaCount),
                minimumFragmentHeightPx: this.estimateImageBlockHeightPx(Math.min(mediaCount, 2)),
                floatingSide: block.floatingSide,
                floatingWidthMode: block.floatingWidthMode,
                floatingPlacement: block.floatingPlacement,
                floatingClearancePx: block.floatingClearancePx
            };
        }

        return undefined;
    }

    private static renderRenderedTableModel(tableModel: LegacyRenderedTableModel): string {
        const renderRow = (row: LegacyRenderedTableRow) => (
            `<tr>${row.cells.map((cell) => {
                const colspanAttr = cell.colspan && cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
                const rowspanAttr = cell.rowspan && cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
                return `<${row.cellTag}${colspanAttr}${rowspanAttr}>${this.escapeHtml(cell.text)}</${row.cellTag}>`;
            }).join('')}</tr>`
        );

        const theadHtml = tableModel.headerRows.length > 0
            ? `<thead>${tableModel.headerRows.map((row) => renderRow(row)).join('')}</thead>`
            : '';
        const tbodyHtml = `<tbody>${tableModel.bodyRows.map((row) => renderRow(row)).join('')}</tbody>`;
        return `<div class="ov-doc-legacy-table" data-ov-table-header-rows="${tableModel.headerRowCount}"><table>${tableModel.colGroupHtml}${theadHtml}${tbodyHtml}</table></div>`;
    }

    private static buildRenderedTableModel(tableModel: LegacySemanticTableModel): LegacyRenderedTableModel {
        return {
            columnCount: tableModel.columnCount,
            colGroupHtml: this.renderTableColGroup(tableModel.columnWidthsTwips, tableModel.columnCount),
            headerRowCount: tableModel.headerRowCount,
            headerRows: tableModel.rows
                .filter((row) => row.rowKind === 'header')
                .map((row) => ({
                    cellTag: 'th',
                    cells: row.cells.map((cell) => ({
                        text: cell.text,
                        colspan: cell.colspan,
                        rowspan: cell.rowspan
                    }))
                })),
            bodyRows: tableModel.rows
                .filter((row) => row.rowKind === 'body')
                .map((row) => ({
                    cellTag: 'td',
                    cells: row.cells.map((cell) => ({
                        text: cell.text,
                        colspan: cell.colspan,
                        rowspan: cell.rowspan
                    }))
                }))
        };
    }

    private static wrapLegacyBlock(block: LegacyRenderedBlockModel): string {
        const attrs = [
            `class="ov-doc-legacy-block ov-doc-legacy-block-${block.kind}"`,
            block.pageBreakBefore ? 'data-ov-page-break-before="true"' : '',
            block.style?.keepWithNext ? 'data-ov-keep-with-next="true"' : '',
            block.style?.keepLinesTogether ? 'data-ov-keep-lines-together="true"' : '',
            block.semanticKind ? `data-ov-semantic-kind="${block.semanticKind}"` : '',
            block.semanticTag ? `data-ov-semantic-tag="${block.semanticTag}"` : '',
            block.semanticRole ? `data-ov-semantic-role="${block.semanticRole}"` : '',
            typeof block.textLength === 'number' ? `data-ov-text-length="${block.textLength}"` : '',
            block.hasInlineField ? 'data-ov-inline-field="true"' : '',
            block.hasInlineBreak ? 'data-ov-inline-break="true"' : '',
            typeof block.itemCount === 'number' ? `data-ov-item-count="${block.itemCount}"` : '',
            typeof block.rowCount === 'number' ? `data-ov-row-count="${block.rowCount}"` : '',
            typeof block.mediaCount === 'number' ? `data-ov-media-count="${block.mediaCount}"` : '',
            typeof block.estimatedHeightPx === 'number' ? `data-ov-estimated-height="${block.estimatedHeightPx}"` : '',
            typeof block.minimumFragmentHeightPx === 'number' ? `data-ov-min-fragment-height="${block.minimumFragmentHeightPx}"` : '',
            block.floatingSide ? `data-ov-floating-side="${block.floatingSide}"` : '',
            block.floatingWidthMode ? `data-ov-floating-width="${block.floatingWidthMode}"` : '',
            block.floatingPlacement ? `data-ov-floating-placement="${block.floatingPlacement}"` : '',
            typeof block.floatingClearancePx === 'number' ? `data-ov-floating-clearance="${block.floatingClearancePx}"` : '',
            block.objectPlacementMode ? `data-ov-object-placement="${block.objectPlacementMode}"` : ''
        ].filter(Boolean).join(' ');

        return `<div ${attrs}>${block.html}</div>`;
    }

    private static detectEmbeddedSheetHeaderRowCount(rows?: string[][]): number {
        if (!rows || rows.length === 0) {
            return 0;
        }

        if (rows.length === 1) {
            return 1;
        }

        const normalize = (value: string): string => String(value || '').trim();
        const firstRow = rows[0];
        const secondRow = rows[1];
        const firstFilled = firstRow.filter((cell) => normalize(cell).length > 0).length;
        const secondFilled = secondRow.filter((cell) => normalize(cell).length > 0).length;
        const firstNumeric = firstRow.filter((cell) => /^[-+]?[\d,.%]+$/.test(normalize(cell))).length;
        const secondNumeric = secondRow.filter((cell) => /^[-+]?[\d,.%]+$/.test(normalize(cell))).length;

        if (rows.length > 2 && firstFilled > 0 && secondFilled > 0 && firstNumeric === 0 && secondNumeric === 0) {
            return 2;
        }

        return 1;
    }

    private static inferFloatingSideFromStyle(style?: CharacterStyle): 'left' | 'right' | 'center' {
        if (style?.textAlign === 'center') {
            return 'center';
        }
        if (style?.textAlign === 'right') {
            return 'right';
        }
        if ((style?.marginRightTwips ?? 0) > (style?.marginLeftTwips ?? 0)) {
            return 'left';
        }
        return 'right';
    }

    private static inferFloatingWidthModeFromStyle(style?: CharacterStyle): 'narrow' | 'regular' | 'wide' {
        if (style?.textAlign === 'center') {
            return 'wide';
        }

        const left = Math.max(0, style?.marginLeftTwips ?? 0);
        const right = Math.max(0, style?.marginRightTwips ?? 0);
        const total = left + right;
        if (total >= 1440) {
            return 'narrow';
        }
        if (total <= 240) {
            return 'wide';
        }
        return 'regular';
    }

    private static inferFloatingPlacementFromStyle(style?: CharacterStyle): 'edge-wrap' | 'center-block' {
        const side = this.inferFloatingSideFromStyle(style);
        const widthMode = this.inferFloatingWidthModeFromStyle(style);
        if (side === 'center' || widthMode === 'wide') {
            return 'center-block';
        }
        return 'edge-wrap';
    }

    private static inferFloatingClearancePx(style?: CharacterStyle): number {
        const side = this.inferFloatingSideFromStyle(style);
        const widthMode = this.inferFloatingWidthModeFromStyle(style);
        if (side === 'center') {
            return 18;
        }
        if (widthMode === 'wide') {
            return 16;
        }
        if (widthMode === 'narrow') {
            return 8;
        }
        return 12;
    }

    private static estimateContentBlockHeightPx(
        tag: 'p' | 'h1' | 'h2',
        textLength: number,
        hasInlineBreak: boolean,
        semanticRole?: 'caption' | 'floating-media'
    ): number {
        const base = tag === 'h1' ? 64 : tag === 'h2' ? 52 : semanticRole === 'caption' ? 42 : 34;
        const approxLines = Math.max(1, Math.ceil(textLength / (tag === 'p' ? 72 : 40)) + (hasInlineBreak ? 1 : 0));
        return base + Math.max(0, approxLines - 1) * 18;
    }

    private static estimateListBlockHeightPx(itemCount: number): number {
        return 28 + Math.max(1, itemCount) * 24;
    }

    private static estimateTableBlockHeightPx(rowCount: number, headerRowCount: number): number {
        return 32 + Math.max(1, headerRowCount) * 28 + Math.max(0, rowCount - headerRowCount) * 24;
    }

    private static estimateSheetBlockHeightPx(rowCount: number, hasChart: boolean): number {
        return 72 + (hasChart ? 180 : 0) + Math.max(0, rowCount) * 22;
    }

    private static estimateImageBlockHeightPx(mediaCount: number): number {
        return mediaCount <= 1 ? 260 : 120 + (Math.ceil(mediaCount / 2) * 180);
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
            declarations.push(`line-height:${Math.max(1.15, Math.min(1.9, (style.fontSizeHalfPoints / 24) + 0.8)).toFixed(2)}`);
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
            return this.escapeHtml(this.stripFieldCodeNoise(fallbackText));
        }

        return runs
            .map((run) => {
                const text = this.escapeHtml(this.stripFieldCodeNoise(run.text));
                const styleAttr = this.renderInlineStyleAttribute(run.style);
                return styleAttr ? `<span${styleAttr}>${text}</span>` : text;
            })
            .join('');
    }

    private static buildSemanticInlineTokens(
        runs: Array<{ text: string; style?: CharacterStyle }> | undefined,
        fallbackText: string
    ): LegacySemanticInlineToken[] | undefined {
        if (!runs || runs.length === 0) {
            const tokens = this.tokenizeSemanticInlineText(this.stripFieldCodeNoise(fallbackText));
            return tokens.length > 0 ? tokens : undefined;
        }

        const tokens = runs.flatMap((run) => this.tokenizeSemanticInlineText(this.stripFieldCodeNoise(run.text), run.style));

        return tokens.length > 0 ? tokens : undefined;
    }

    private static renderSemanticInlineTokens(
        tokens: LegacySemanticInlineToken[] | undefined,
        fallbackText: string
    ): string {
        if (!tokens || tokens.length === 0) {
            return this.escapeHtml(this.stripFieldCodeNoise(fallbackText));
        }

        return tokens
            .map((token) => {
                if (token.kind === 'tab') {
                    return '\t';
                }
                if (token.kind === 'line-break') {
                    return '<br>';
                }
                const text = this.escapeHtml(token.kind === 'field' ? token.field : token.text);
                const styleAttr = this.renderInlineStyleAttribute(token.style);
                return styleAttr ? `<span${styleAttr}>${text}</span>` : text;
            })
            .join('');
    }

    private static tokenizeSemanticInlineText(
        raw: string,
        style?: CharacterStyle
    ): LegacySemanticInlineToken[] {
        if (!raw) {
            return [];
        }

        const tokens: LegacySemanticInlineToken[] = [];
        const pattern = /(SECTIONPAGES|SECTIONPAGE|NUMPAGES|SECTIONS|SECTION|PAGE)|(\t)|(\n)/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(raw)) !== null) {
            if (match.index > lastIndex) {
                tokens.push({ kind: 'text', text: raw.slice(lastIndex, match.index), style });
            }

            if (match[1]) {
                tokens.push({
                    kind: 'field',
                    field: match[1] as 'PAGE' | 'NUMPAGES' | 'SECTIONPAGE' | 'SECTIONPAGES' | 'SECTION' | 'SECTIONS',
                    style
                });
            } else if (match[2]) {
                tokens.push({ kind: 'tab' });
            } else if (match[3]) {
                tokens.push({ kind: 'line-break' });
            }

            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < raw.length) {
            tokens.push({ kind: 'text', text: raw.slice(lastIndex), style });
        }

        return tokens.filter((token) => token.kind !== 'text' || token.text.length > 0);
    }

    private static inferSemanticContentRole(
        text: string,
        style?: CharacterStyle
    ): 'caption' | undefined {
        const normalized = this.stripFieldCodeNoise(text).replace(/\s+/g, ' ').trim();
        if (!normalized || normalized.length > 120) {
            return undefined;
        }

        const captionPattern = /^(figure|fig\.?|table|chart|image|photo|picture|diagram|exhibit|그림|표|사진|도표)\s*([0-9]+|[ivxlcdm]+)?(?:[\s:.)-]|$)/i;
        if (captionPattern.test(normalized)) {
            return 'caption';
        }

        if ((style?.italic || style?.textAlign === 'center') && normalized.length <= 80) {
            return 'caption';
        }

        return undefined;
    }

    private static tokenizeHeaderFooterText(raw: string | undefined): LegacyHeaderFooterToken[] {
        const text = String(raw || '');
        if (!text) {
            return [];
        }

        const tokens: LegacyHeaderFooterToken[] = [];
        let lastIndex = 0;
        const pattern = /\b(SECTIONPAGES|SECTIONPAGE|NUMPAGES|SECTIONS|SECTION|PAGE)\b/g;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(text)) !== null) {
            if (match.index > lastIndex) {
                tokens.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
            }

            tokens.push({
                kind: 'field',
                field: match[1].toUpperCase() as 'PAGE' | 'NUMPAGES' | 'SECTIONPAGE' | 'SECTIONPAGES' | 'SECTION' | 'SECTIONS'
            });
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            tokens.push({ kind: 'text', value: text.slice(lastIndex) });
        }

        return tokens.filter((token) => token.kind !== 'text' || token.value.length > 0);
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

    private static buildSemanticTableModel(
        block: Extract<LegacyBlock, { kind: 'table' }>
    ): LegacySemanticTableModel {
        const columnCount = Math.max(...block.rows.map((row) => row.reduce((sum, cell) => sum + (cell.colspan ?? 1), 0)));
        const headerRowCount = this.detectTableHeaderRowCount(block.rows);
        const mapRows = (
            rows: Array<Array<{ text: string; colspan?: number; rowspan?: number }>>,
            rowKind: 'header' | 'body'
        ): LegacySemanticTableRow[] => rows.map((row) => ({
            rowKind,
            cells: row.map((cell) => ({
                text: cell.text,
                colspan: cell.colspan,
                rowspan: cell.rowspan
            }))
        }));

        return {
            columnCount,
            columnWidthsTwips: block.columnWidthsTwips,
            headerRowCount,
            rows: [
                ...mapRows(block.rows.slice(0, headerRowCount), 'header'),
                ...mapRows(block.rows.slice(headerRowCount), 'body')
            ]
        };
    }

    private static detectTableHeaderRowCount(
        rows: Array<Array<{ text: string; colspan?: number; rowspan?: number }>>
    ): number {
        if (rows.length < 2) {
            return 0;
        }

        const isNumericLike = (text: string): boolean => {
            const normalized = this.normalizeParagraphText(text);
            return /^[-+]?[$]?\d[\d\s,./:%-]*$/.test(normalized);
        };

        const hasStructuralSpan = (row: Array<{ text: string; colspan?: number; rowspan?: number }>): boolean => (
            row.some((cell) => (cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1)
        );

        const isDenseHeaderRow = (row: Array<{ text: string; colspan?: number; rowspan?: number }>): boolean => {
            if (!row.length) {
                return false;
            }

            const nonEmptyCells = row.filter((cell) => this.normalizeParagraphText(cell.text).length > 0);
            if (nonEmptyCells.length !== row.length) {
                return false;
            }

            return nonEmptyCells.every((cell) => {
                const text = this.normalizeParagraphText(cell.text);
                return text.length > 0 && text.length <= 80;
            });
        };

        const looksLikeDataRow = (row: Array<{ text: string; colspan?: number; rowspan?: number }>): boolean => {
            const normalizedCells = row
                .map((cell) => this.normalizeParagraphText(cell.text))
                .filter((text) => text.length > 0);
            if (normalizedCells.length < 2) {
                return false;
            }

            const numericLikeCount = normalizedCells.filter((text) => isNumericLike(text)).length;
            return numericLikeCount / normalizedCells.length >= 0.5;
        };

        if (!isDenseHeaderRow(rows[0])) {
            return 0;
        }

        let headerRowCount = 1;
        const maxHeaderRows = Math.min(3, rows.length - 1);

        for (let index = 1; index < maxHeaderRows; index++) {
            const row = rows[index];
            if (!isDenseHeaderRow(row)) {
                break;
            }
            if (looksLikeDataRow(row) && !hasStructuralSpan(rows[index - 1])) {
                break;
            }

            if (hasStructuralSpan(rows[index - 1]) || hasStructuralSpan(row) || !looksLikeDataRow(row)) {
                headerRowCount += 1;
                continue;
            }

            break;
        }

        return headerRowCount;
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

    private static looksLikeSectionHeading(line: StyledLine, previous?: StyledLine, next?: StyledLine): boolean {
        const normalizedText = this.normalizeParagraphText(line.text);
        if (!normalizedText || normalizedText.includes(':') || /[.!?]$/.test(normalizedText)) {
            return false;
        }
        if (normalizedText.length > 24 || !this.isCompactHeadingCandidate(normalizedText)) {
            return false;
        }

        const previousLength = this.normalizeParagraphText(previous?.text || '').length;
        const nextLength = this.normalizeParagraphText(next?.text || '').length;
        const prominentStyle = Boolean(line.style?.bold)
            || Boolean(line.style?.textAlign === 'center')
            || (line.style?.fontSizeHalfPoints ?? 0) >= 26;
        return prominentStyle && nextLength > 15 && (previousLength === 0 || previousLength > 20);
    }

    private static isLikelyDocumentTitle(line: StyledLine, index: number, lines: StyledLine[]): boolean {
        const text = this.normalizeParagraphText(line.text);
        if (index > 2 || !text || text.length > 120 || !this.hasEnoughLetters(text)) {
            return false;
        }

        const nextLength = this.normalizeParagraphText(lines[index + 1]?.text || '').length;
        const strongStyle = (line.style?.fontSizeHalfPoints ?? 0) >= 28
            || Boolean(line.style?.bold && line.style?.textAlign === 'center')
            || Boolean(line.style?.bold && text.length <= 48);

        return strongStyle && nextLength > 20;
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
            .replace(this.FIELD_CODE_NOISE_PATTERN, '')
            .replace(/[\u0001-\u0006\u0008\u000c\u000e-\u0012\u0014-\u001f]/g, ' ')
            .replace(/[\u0007\u000b]/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ ]{2,}/g, ' ')
            .trim();
    }

    private static normalizeParagraphText(raw: string, preserveTabs = false): string {
        const normalized = (raw || '')
            .replace(this.FIELD_CODE_NOISE_PATTERN, '')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
            .replace(/\r/g, '');

        if (preserveTabs) {
            return normalized
                .replace(/[ \t]+\n/g, '\n')
                .trim();
        }

        return normalized
            .replace(/\s+/g, ' ')
            .trim();
    }

    private static stripFieldCodeNoise(raw: string): string {
        return (raw || '').replace(this.FIELD_CODE_NOISE_PATTERN, '');
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

    private static normalizeImageLabel(label: string | undefined, fallbackIndex?: number): string {
        const normalized = this.normalizeParagraphText(String(label || ''));
        if (!normalized) {
            return '';
        }

        if (/^(worddocument|data|properties_stream|package_stream|\x01compobj|\x01ole)$/i.test(normalized)) {
            return '';
        }

        return normalized;
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
                alt: this.normalizeImageLabel(stream.name, images.length + 1)
            });

            if (images.length >= 8) {
                break;
            }
        }

        return images;
    }

    private static extractEmbeddedWorkbookTables(
        cfb: CfbReader,
        objectPlacementMode: 'text-flow' | 'drawing-anchor'
    ): EmbeddedSheetData[] {
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
                        chart: this.buildEmbeddedChart(normalizedRows),
                        objectPlacementMode
                    };
                })
                .filter(Boolean) as EmbeddedSheetData[])
                .slice(0, 3);
        } catch (error) {
            console.warn('[DOC] Failed to parse embedded workbook:', error);
            return [];
        }
    }

    private static async extractEmbeddedPackageCharts(
        cfb: CfbReader,
        objectPlacementMode: 'text-flow' | 'drawing-anchor'
    ): Promise<EmbeddedSheetData[]> {
        const packageStream = cfb.getStream('package_stream');
        if (!packageStream) {
            return [];
        }

        try {
            const zip = await JSZip.loadAsync(packageStream);
            const mimeType = await zip.file('mimetype')?.async('string');
            if (!mimeType || !/opendocument\.chart/i.test(mimeType)) {
                return [];
            }

            const contentXml = await zip.file('content.xml')?.async('string');
            if (!contentXml) {
                return [];
            }

            const parsed = this.parseOdfChartContent(contentXml, objectPlacementMode);
            return parsed ? [parsed] : [];
        } catch (error) {
            console.warn('[DOC] Failed to parse embedded chart package:', error);
            return [];
        }
    }

    private static parseOdfChartContent(
        contentXml: string,
        objectPlacementMode: 'text-flow' | 'drawing-anchor'
    ): EmbeddedSheetData | undefined {
        const rowMatches = Array.from(contentXml.matchAll(/<table:table-row[\s\S]*?<\/table:table-row>/g));
        if (rowMatches.length < 2) {
            return undefined;
        }

        const rows = rowMatches
            .map((match) => this.parseOdfTableRow(match[0]))
            .filter((row) => row.some((cell) => cell.length > 0));
        if (rows.length < 2 || rows[0].length < 2) {
            return undefined;
        }

        const firstSeries = contentXml.match(/<chart:series[^>]*chart:class="chart:([^"]+)"/i)?.[1];
        const chart = this.buildEmbeddedChart(rows);

        return {
            rows,
            showTable: false,
            objectPlacementMode,
            chart: chart
                ? {
                    ...chart,
                    type: firstSeries === 'line' ? 'line' : chart.type
                }
                : undefined
        };
    }

    private static parseOdfTableRow(rowXml: string): string[] {
        const cellMatches = Array.from(rowXml.matchAll(/<table:table-cell\b[\s\S]*?<\/table:table-cell>/g));
        return cellMatches.map((cellMatch) => {
            const cellXml = cellMatch[0];
            const paragraphMatches = Array.from(cellXml.matchAll(/<text:p(?:\b[^>]*)?>([\s\S]*?)<\/text:p>|<text:p\b[^>]*\/>/g));
            if (paragraphMatches.length === 0) {
                return '';
            }

            return paragraphMatches
                .map((paragraph) => this.decodeXmlEntities(this.normalizeParagraphText(paragraph[1] ?? '')))
                .join(' ')
                .trim();
        });
    }

    private static buildEmbeddedChart(rows: string[][]): EmbeddedChart | undefined {
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

    private static renderEmbeddedChart(chart: EmbeddedChart): string {
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

        return `
            <div class="ov-doc-embedded-chart">
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

    private static decodeXmlEntities(value: string): string {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, '\'')
            .replace(/&amp;/g, '&');
    }
}
