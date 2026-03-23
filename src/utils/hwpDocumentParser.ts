import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { parse as parseHwp } from 'hwp.js';
import { FileUtils } from './fileUtils';

export type HwpSourceFormat = 'hwp' | 'hwpx';

export interface HwpLayoutRun {
    text: string;
    fontSizePt?: number;
    fontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
    backgroundColor?: string;
    color?: string;
}

export interface HwpLayoutParagraph {
    id: string;
    kind: 'paragraph';
    align: 'left' | 'center' | 'right' | 'justify';
    lineHeight: number;
    fontSizePt?: number;
    marginTopPt?: number;
    marginBottomPt?: number;
    marginLeftPt?: number;
    marginRightPt?: number;
    textIndentPt?: number;
    runs: HwpLayoutRun[];
}

export interface HwpLayoutTableCell {
    text: string;
    colSpan?: number;
    rowSpan?: number;
    widthPt?: number;
    heightPt?: number;
    backgroundColor?: string;
    borderColor?: string;
    borderWidthPt?: number;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
}

export interface HwpLayoutTableRow {
    cells: HwpLayoutTableCell[];
}

export interface HwpLayoutTableBlock {
    id: string;
    kind: 'table';
    rows: HwpLayoutTableRow[];
    widthPt?: number;
    marginTopPt?: number;
    marginBottomPt?: number;
}

export interface HwpLayoutImageBlock {
    id: string;
    kind: 'image';
    src?: string;
    alt: string;
    positioning?: 'inline' | 'absolute';
    anchorScope?: 'page' | 'paragraph' | 'cell' | 'character';
    leftPt?: number;
    topPt?: number;
    zIndex?: number;
    widthPt?: number;
    heightPt?: number;
    marginTopPt?: number;
    marginBottomPt?: number;
}

export interface HwpLayoutLineBlock {
    id: string;
    kind: 'line';
    positioning?: 'inline' | 'absolute';
    anchorScope?: 'page' | 'paragraph' | 'cell' | 'character';
    leftPt?: number;
    topPt?: number;
    zIndex?: number;
    widthPt?: number;
    heightPt?: number;
    x1Pt?: number;
    y1Pt?: number;
    x2Pt?: number;
    y2Pt?: number;
    pathD?: string;
    rotateDeg?: number;
    color?: string;
    lineWidthPt?: number;
    lineStyle?: 'solid' | 'dashed' | 'dotted';
    markerStart?: 'arrow' | 'diamond' | 'circle';
    markerEnd?: 'arrow' | 'diamond' | 'circle';
    marginTopPt?: number;
    marginBottomPt?: number;
}

export interface HwpLayoutTextBoxBlock {
    id: string;
    kind: 'textbox';
    text: string;
    shapeType?: 'rectangle' | 'rounded' | 'ellipse' | 'diamond';
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    color?: string;
    backgroundColor?: string;
    borderColor?: string;
    borderWidthPt?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
    borderRadiusPt?: number;
    paddingPt?: number;
    opacity?: number;
    rotateDeg?: number;
    backgroundImage?: string;
    boxShadowCss?: string;
    markerStart?: 'arrow' | 'diamond' | 'circle';
    markerEnd?: 'arrow' | 'diamond' | 'circle';
    positioning?: 'inline' | 'absolute';
    anchorScope?: 'page' | 'paragraph' | 'cell' | 'character';
    leftPt?: number;
    topPt?: number;
    zIndex?: number;
    widthPt?: number;
    heightPt?: number;
    marginTopPt?: number;
    marginBottomPt?: number;
}

export type HwpLayoutBlock = HwpLayoutParagraph | HwpLayoutTableBlock | HwpLayoutImageBlock | HwpLayoutLineBlock | HwpLayoutTextBoxBlock;

export interface HwpLayoutPage {
    id: string;
    widthPt: number;
    minHeightPt: number;
    headerText?: string;
    footerText?: string;
    headerAlign?: 'left' | 'center' | 'right' | 'justify';
    footerAlign?: 'left' | 'center' | 'right' | 'justify';
    paddingPt: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    blocks: HwpLayoutBlock[];
}

export interface HwpLayoutDocument {
    format: HwpSourceFormat;
    stage: 'step2-paragraph-layout';
    fileName: string;
    fileSize: string;
    pages: HwpLayoutPage[];
    warnings: string[];
}

export class HwpDocumentParser {
    public static async parseFile(filePath: string): Promise<HwpLayoutDocument> {
        const ext = path.extname(filePath).toLowerCase();
        const fileName = path.basename(filePath);
        const fileSize = await FileUtils.getFileSize(filePath);

        if (ext === '.hwpx') {
            return this.parseHwpxFile(filePath, fileName, fileSize);
        }

        return this.parseHwpFile(filePath, fileName, fileSize);
    }

    private static async parseHwpFile(filePath: string, fileName: string, fileSize: string): Promise<HwpLayoutDocument> {
        const buffer = await fs.promises.readFile(filePath);
        const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const parsed = parseHwp(bytes, { type: 'buffer' });
        const warnings: string[] = [];

        const pages = Array.isArray(parsed?.sections)
            ? parsed.sections.map((section: any, index: number) => this.mapHwpSectionToPage(section, parsed?.info, index))
            : [];

        if (pages.length === 0) {
            warnings.push('파싱된 섹션이 없어 빈 문서로 렌더링했습니다.');
        }

        return {
            format: 'hwp',
            stage: 'step2-paragraph-layout',
            fileName,
            fileSize,
            pages: this.paginatePages(pages.length > 0 ? pages : [this.createEmptyPage('hwp-empty-page')]),
            warnings
        };
    }

    private static async parseHwpxFile(filePath: string, fileName: string, fileSize: string): Promise<HwpLayoutDocument> {
        const buffer = await fs.promises.readFile(filePath);
        const zip = await JSZip.loadAsync(buffer);
        const sectionNames = Object.keys(zip.files)
            .filter(name => /^Contents\/section\d+\.xml$/i.test(name))
            .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

        const warnings: string[] = [];
        const pages: HwpLayoutPage[] = [];

        const binaryAssets = await this.collectHwpxBinaryAssets(zip);
        const headerFooterMap = await this.collectHwpxHeaderFooterTexts(zip);

        const totalPages = Math.max(sectionNames.length, 1);

        for (const [index, sectionName] of sectionNames.entries()) {
            const xml = await zip.files[sectionName].async('text');
            pages.push(this.mapHwpxSectionXmlToPage(xml, index, totalPages, binaryAssets, headerFooterMap));
        }

        if (pages.length === 0) {
            warnings.push('HWPX 섹션 XML을 찾지 못해 빈 문서로 렌더링했습니다.');
        }

        return {
            format: 'hwpx',
            stage: 'step2-paragraph-layout',
            fileName,
            fileSize,
            pages: this.paginatePages(pages.length > 0 ? pages : [this.createEmptyPage('hwpx-empty-page')]),
            warnings
        };
    }

    private static mapHwpSectionToPage(section: any, info: any, index: number): HwpLayoutPage {
        const widthPt = this.hwpUnitToPt(section?.width, 595);
        const minHeightPt = this.hwpUnitToPt(section?.height, 842);
        const paddingTop = this.hwpUnitToPt((section?.paddingTop ?? 0) + (section?.headerPadding ?? 0), 56);
        const paddingRight = this.hwpUnitToPt(section?.paddingRight, 56);
        const paddingBottom = this.hwpUnitToPt((section?.paddingBottom ?? 0) + (section?.footerPadding ?? 0), 56);
        const paddingLeft = this.hwpUnitToPt(section?.paddingLeft, 56);

        const blocks = Array.isArray(section?.content)
            ? section.content
                .map((paragraph: any, paragraphIndex: number) => this.mapHwpParagraph(paragraph, info, index, paragraphIndex))
                .flat()
            : [];

        return {
            id: `hwp-page-${index + 1}`,
            widthPt,
            minHeightPt,
            headerText: this.defaultHeaderLabel(index + 1),
            headerAlign: 'left',
            footerText: `Page ${index + 1}`,
            footerAlign: 'right',
            paddingPt: {
                top: paddingTop,
                right: paddingRight,
                bottom: paddingBottom,
                left: paddingLeft
            },
            blocks: blocks.length > 0 ? blocks : [this.createEmptyParagraph(`hwp-empty-paragraph-${index + 1}`)]
        };
    }

    private static mapHwpParagraph(paragraph: any, info: any, sectionIndex: number, paragraphIndex: number): HwpLayoutBlock[] {
        const text = this.extractHwpParagraphText(paragraph);
        const controlBlocks = this.extractHwpControlBlocks(paragraph, info, sectionIndex, paragraphIndex);

        if (!text.trim() && controlBlocks.length === 0) {
            return [];
        }

        const charShapeIndex = paragraph?.shapeBuffer?.[0]?.shapeIndex;
        const charShape = typeof info?.getCharShpe === 'function'
            ? info.getCharShpe(charShapeIndex ?? 0)
            : null;
        const paragraphShape = Array.isArray(info?.paragraphShapes)
            ? info.paragraphShapes[paragraph?.shapeIndex ?? 0]
            : null;
        const fontSizePt = this.resolveHwpFontSizePt(charShape);
        const lineHeight = this.resolveHwpLineHeight(paragraph, fontSizePt);

        const blocks: HwpLayoutBlock[] = [];

        if (text.trim()) {
            blocks.push({
                id: `hwp-p-${sectionIndex + 1}-${paragraphIndex + 1}`,
                kind: 'paragraph',
                align: this.mapParagraphAlign(paragraphShape?.align),
                lineHeight,
                fontSizePt,
                marginTopPt: this.resolveHwpParagraphGap(paragraph, 'before', fontSizePt),
                marginBottomPt: this.resolveHwpParagraphGap(paragraph, 'after', fontSizePt),
                runs: [{
                    text,
                    fontSizePt,
                    fontWeight: this.resolveHwpFontWeight(charShape),
                    backgroundColor: this.rgbArrayToCss(charShape?.shadeColor),
                    color: this.rgbArrayToCss(charShape?.color)
                }]
            });
        }

        return blocks.concat(controlBlocks);
    }

    private static mapHwpxSectionXmlToPage(
        xml: string,
        index: number,
        totalPages: number,
        binaryAssets: Map<string, string>,
        headerFooterMap: Map<string, string>
    ): HwpLayoutPage {
        const paragraphBlocks = this.extractHwpxParagraphs(xml).map((paragraph, paragraphIndex) => ({
            id: `hwpx-p-${index + 1}-${paragraphIndex + 1}`,
            kind: 'paragraph' as const,
            align: paragraph.align,
            lineHeight: paragraph.lineHeight,
            fontSizePt: paragraph.fontSizePt,
            marginTopPt: paragraph.marginTopPt,
            marginBottomPt: paragraph.marginBottomPt,
            marginLeftPt: paragraph.marginLeftPt,
            marginRightPt: paragraph.marginRightPt,
            textIndentPt: paragraph.textIndentPt,
            runs: paragraph.runs
        }));
        const tableBlocks = this.extractHwpxTables(xml, index);
        const imageBlocks = this.extractHwpxImages(xml, index, binaryAssets);
        const lineBlocks = this.extractHwpxLines(xml, index);
        const textBoxBlocks = this.extractHwpxTextBoxes(xml, index);

        const headerFooter = this.extractHwpxHeaderFooterTexts(xml, index, totalPages, headerFooterMap);

        return {
            id: `hwpx-page-${index + 1}`,
            widthPt: this.readHwpxDimension(xml, /(?:page|sec)W(?:idth)?="(\d+)"/i, 595),
            minHeightPt: this.readHwpxDimension(xml, /(?:page|sec)H(?:eight)?="(\d+)"/i, 842),
            headerText: headerFooter.headerText,
            footerText: headerFooter.footerText,
            headerAlign: headerFooter.headerAlign,
            footerAlign: headerFooter.footerAlign,
            paddingPt: {
                top: 56,
                right: 56,
                bottom: 56,
                left: 56
            },
            blocks: [...paragraphBlocks, ...tableBlocks, ...imageBlocks, ...lineBlocks, ...textBoxBlocks].length > 0
                ? [...paragraphBlocks, ...tableBlocks, ...imageBlocks, ...lineBlocks, ...textBoxBlocks]
                : [this.createEmptyParagraph(`hwpx-empty-paragraph-${index + 1}`)]
        };
    }

    private static defaultHeaderLabel(pageNumber: number): string {
        return `Omni Viewer Layout Engine - ${pageNumber}`;
    }

    private static extractHwpxHeaderFooterTexts(
        xml: string,
        pageIndex: number,
        totalPages: number,
        headerFooterMap: Map<string, string>
    ): {
        headerText: string;
        footerText: string;
        headerAlign?: 'left' | 'center' | 'right' | 'justify';
        footerAlign?: 'left' | 'center' | 'right' | 'justify';
    } {
        const headerRegion = this.extractHwpxRegionContent(xml, /<[^>]*?:header\b[\s\S]*?<\/[^>]*?:header>/i);
        const footerRegion = this.extractHwpxRegionContent(xml, /<[^>]*?:footer\b[\s\S]*?<\/[^>]*?:footer>/i);
        const headerFallback = this.resolveHwpxHeaderFooterRule('header', pageIndex, headerFooterMap);
        const footerFallback = this.resolveHwpxHeaderFooterRule('footer', pageIndex, headerFooterMap);
        const headerText = this.applyPageNumberTokens(
            headerRegion.text || headerFallback?.text || this.defaultHeaderLabel(pageIndex + 1),
            pageIndex,
            totalPages
        );
        const footerText = this.applyPageNumberTokens(
            footerRegion.text || footerFallback?.text || `Page ${pageIndex + 1}`,
            pageIndex,
            totalPages
        );

        return {
            headerText,
            footerText,
            headerAlign: headerRegion.align || headerFallback?.align || 'left',
            footerAlign: footerRegion.align || footerFallback?.align || 'right'
        };
    }

    private static extractHwpxRegionContent(
        xml: string,
        regionPattern: RegExp
    ): { text?: string; align?: 'left' | 'center' | 'right' | 'justify' } {
        const region = xml.match(regionPattern)?.[0];
        if (!region) {
            return {};
        }

        const text = this.extractXmlTextWithFieldTokens(region);
        return {
            text: text || undefined,
            align: this.mapHwpxAlign(this.readXmlAttribute(region, /(?:align|horzAlign|textAlign)="([^"]+)"/i))
        };
    }

    private static async collectHwpxHeaderFooterTexts(zip: JSZip): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        const names = Object.keys(zip.files)
            .filter(name => /\.(xml)$/i.test(name) && /(header|footer)/i.test(path.basename(name)));

        for (const name of names) {
            const file = zip.files[name];
            if (!file || file.dir) {
                continue;
            }

            const xml = await file.async('text');
            const text = this.extractXmlTextWithFieldTokens(xml);
            if (!text) {
                continue;
            }

            const baseName = path.basename(name).toLowerCase();
            const kind = baseName.includes('footer') ? 'footer' : 'header';
            const align = this.mapHwpxAlign(this.readXmlAttribute(xml, /(?:align|horzAlign|textAlign)="([^"]+)"/i)) || (kind === 'header' ? 'left' : 'right');
            const indexMatch = baseName.match(/(\d+)/);
            const variant = this.detectHwpxHeaderFooterVariant(baseName, xml);
            const serialized = JSON.stringify({ text, align });
            if (indexMatch) {
                result.set(`${kind}:${indexMatch[1]}`, serialized);
            }

            if (variant) {
                result.set(`${kind}:${variant}`, serialized);
            }

            if (!result.has(`${kind}:default`)) {
                result.set(`${kind}:default`, serialized);
            }
        }

        return result;
    }

    private static detectHwpxHeaderFooterVariant(baseName: string, xml: string): 'first' | 'odd' | 'even' | undefined {
        if (/(?:first|title)/i.test(baseName) || /(?:first|title)Page/i.test(xml)) {
            return 'first';
        }

        if (/(?:applyPageType|pageRange|pageType)="(?:FIRST|first)"/i.test(xml)) {
            return 'first';
        }

        if (/odd/i.test(baseName) || /(?:odd|oddPage)/i.test(xml)) {
            return 'odd';
        }

        if (/(?:applyPageType|pageRange|pageType)="(?:ODD|odd)"/i.test(xml)) {
            return 'odd';
        }

        if (/even/i.test(baseName) || /(?:even|evenPage)/i.test(xml)) {
            return 'even';
        }

        if (/(?:applyPageType|pageRange|pageType)="(?:EVEN|even)"/i.test(xml)) {
            return 'even';
        }

        return undefined;
    }

    private static resolveHwpxHeaderFooterRule(
        kind: 'header' | 'footer',
        pageIndex: number,
        headerFooterMap: Map<string, string>
    ): { text: string; align?: 'left' | 'center' | 'right' | 'justify' } | undefined {
        const pageNumber = pageIndex + 1;
        const keys = [
            `${kind}:${pageNumber}`,
            pageNumber === 1 ? `${kind}:first` : '',
            pageNumber % 2 === 0 ? `${kind}:even` : `${kind}:odd`,
            `${kind}:default`
        ].filter(Boolean);

        for (const key of keys) {
            const rawValue = headerFooterMap.get(key);
            if (!rawValue) {
                continue;
            }

            try {
                return JSON.parse(rawValue);
            } catch {
                return { text: rawValue };
            }
        }

        return undefined;
    }

    private static applyPageNumberTokens(text: string, pageIndex: number, totalPages: number): string {
        const pageNumber = pageIndex + 1;
        const today = new Date();
        const isoDate = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, '0'),
            String(today.getDate()).padStart(2, '0')
        ].join('-');
        const localeDate = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
        const sectionNumber = pageNumber;
        return text
            .replace(/\{\s*(?:PAGE|pageNum|page)\s*\}/gi, String(pageNumber))
            .replace(/\{\s*(?:NUMPAGES|pageCount|totalPages)\s*\}/gi, String(totalPages))
            .replace(/\{\s*(?:SECTION|sectionNum|section)\s*\}/gi, String(sectionNumber))
            .replace(/\{\s*(?:DATE|createdate|today)\s*\}/gi, localeDate)
            .replace(/\[\s*(?:PAGE|pageNum|page)\s*\]/gi, String(pageNumber))
            .replace(/\[\s*(?:NUMPAGES|pageCount|totalPages)\s*\]/gi, String(totalPages))
            .replace(/\[\s*(?:SECTION|sectionNum|section)\s*\]/gi, String(sectionNumber))
            .replace(/\[\s*(?:DATE|createdate|today)\s*\]/gi, localeDate)
            .replace(/<<PAGE>>/gi, String(pageNumber))
            .replace(/<<NUMPAGES>>/gi, String(totalPages))
            .replace(/<<SECTION>>/gi, String(sectionNumber))
            .replace(/<<DATE>>/gi, localeDate)
            .replace(/<<ISODATE>>/gi, isoDate)
            .replace(/\bPAGE\b/gi, String(pageNumber))
            .replace(/\bNUMPAGES\b/gi, String(totalPages))
            .replace(/\bSECTION\b/gi, String(sectionNumber))
            .replace(/\bDATE\b/gi, localeDate);
    }

    private static extractXmlTextWithFieldTokens(xml: string): string {
        const fieldAwareXml = xml
            .replace(/<[^>]*?(?:instrText|fldData)\b[^>]*>[\s\S]*?(?:PAGE|pageNum|pageNumber)[\s\S]*?<\/[^>]+>/gi, ' <<PAGE>> ')
            .replace(/<[^>]*?(?:instrText|fldData)\b[^>]*>[\s\S]*?(?:NUMPAGES|pageCount|totalPages)[\s\S]*?<\/[^>]+>/gi, ' <<NUMPAGES>> ')
            .replace(/<[^>]*?(?:instrText|fldData)\b[^>]*>[\s\S]*?(?:SECTION|sectionNum|chapterNum)[\s\S]*?<\/[^>]+>/gi, ' <<SECTION>> ')
            .replace(/<[^>]*?(?:instrText|fldData)\b[^>]*>[\s\S]*?(?:DATE|createDate|printDate)[\s\S]*?<\/[^>]+>/gi, ' <<DATE>> ')
            .replace(/<[^>]*?(?:fieldBegin|fldSimple)\b[^>]*?(?:type|instr|command)="[^"]*(?:PAGE|pageNum|pageNumber)[^"]*"[^>]*\/>/gi, ' <<PAGE>> ')
            .replace(/<[^>]*?(?:fieldBegin|fldSimple)\b[^>]*?(?:type|instr|command)="[^"]*(?:NUMPAGES|pageCount|totalPages)[^"]*"[^>]*\/>/gi, ' <<NUMPAGES>> ')
            .replace(/<[^>]*?(?:fieldBegin|fldSimple)\b[^>]*?(?:type|instr|command)="[^"]*(?:SECTION|sectionNum|chapterNum)[^"]*"[^>]*\/>/gi, ' <<SECTION>> ')
            .replace(/<[^>]*?(?:fieldBegin|fldSimple)\b[^>]*?(?:type|instr|command)="[^"]*(?:DATE|createDate|printDate)[^"]*"[^>]*\/>/gi, ' <<DATE>> ')
            .replace(/<[^>]*?(?:pageNum|pageNumber|curPage)\b[^>]*\/>/gi, ' <<PAGE>> ')
            .replace(/<[^>]*?(?:pageCount|totalPage|totalPages|numPages)\b[^>]*\/>/gi, ' <<NUMPAGES>> ')
            .replace(/<[^>]*?(?:secNum|sectionNum|chapterNum)\b[^>]*\/>/gi, ' <<SECTION>> ')
            .replace(/<[^>]*?(?:date|createDate|printDate)\b[^>]*\/>/gi, ' <<DATE>> ')
            .replace(/<[^>]*?(?:fieldBegin|fldSimple)\b[^>]*?(?:type|instr|command)="[^"]*(?:PAGE|pageNum|pageNumber)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, ' <<PAGE>> ')
            .replace(/<[^>]*?(?:fieldBegin|fldSimple)\b[^>]*?(?:type|instr|command)="[^"]*(?:NUMPAGES|pageCount|totalPages)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, ' <<NUMPAGES>> ')
            .replace(/<[^>]*?(?:fieldBegin|fldSimple)\b[^>]*?(?:type|instr|command)="[^"]*(?:SECTION|sectionNum|chapterNum)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, ' <<SECTION>> ')
            .replace(/<[^>]*?(?:fieldBegin|fldSimple)\b[^>]*?(?:type|instr|command)="[^"]*(?:DATE|createDate|printDate)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, ' <<DATE>> ')
            .replace(/<[^>]*?(?:pageNum|pageNumber|curPage)\b[^>]*>[\s\S]*?<\/[^>]+>/gi, ' <<PAGE>> ')
            .replace(/<[^>]*?(?:pageCount|totalPage|totalPages|numPages)\b[^>]*>[\s\S]*?<\/[^>]+>/gi, ' <<NUMPAGES>> ')
            .replace(/<[^>]*?(?:secNum|sectionNum|chapterNum)\b[^>]*>[\s\S]*?<\/[^>]+>/gi, ' <<SECTION>> ')
            .replace(/<[^>]*?(?:date|createDate|printDate)\b[^>]*>[\s\S]*?<\/[^>]+>/gi, ' <<DATE>> ');

        return this.decodeXmlText(fieldAwareXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
    }

    private static extractHwpParagraphText(paragraph: any): string {
        if (!Array.isArray(paragraph?.content)) {
            return '';
        }

        let text = '';

        for (const item of paragraph.content) {
            if (typeof item?.value === 'string') {
                text += item.value;
                continue;
            }

            if (typeof item?.value === 'number') {
                if (item.value === 13 || item.value === 10) {
                    text += '\n';
                } else if (item.value === 9) {
                    text += '    ';
                }
            }
        }

        return text.replace(/\u0000/g, '').replace(/\s+\n/g, '\n').trimEnd();
    }

    private static extractHwpxParagraphs(xml: string): Array<{
        align: 'left' | 'center' | 'right' | 'justify';
        lineHeight: number;
        fontSizePt?: number;
        marginTopPt?: number;
        marginBottomPt?: number;
        marginLeftPt?: number;
        marginRightPt?: number;
        textIndentPt?: number;
        runs: HwpLayoutRun[];
    }> {
        const normalized = xml
            .replace(/<w:br\s*\/>/gi, '\n')
            .replace(/<hp:lineBreak\s*\/>/gi, '\n');
        const paragraphMatches = normalized.match(/<[^>]*?:p\b[\s\S]*?<\/[^>]*?:p>/gi) ?? [];
        const paragraphs: Array<{
            align: 'left' | 'center' | 'right' | 'justify';
            lineHeight: number;
            fontSizePt?: number;
            marginTopPt?: number;
            marginBottomPt?: number;
            marginLeftPt?: number;
            marginRightPt?: number;
            textIndentPt?: number;
            runs: HwpLayoutRun[];
        }> = [];

        for (const paragraphXml of paragraphMatches) {
            const paragraphStyle = this.extractHwpxParagraphStyle(paragraphXml);
            const runs = this.extractHwpxRuns(paragraphXml);

            if (runs.some(run => (run.text || '').trim())) {
                paragraphs.push({
                    ...paragraphStyle,
                    runs
                });
            }
        }

        return paragraphs;
    }

    private static resolveHwpFontSizePt(charShape: any): number | undefined {
        const fontBaseSize = Number(charShape?.fontBaseSize);
        const fontRatio = Array.isArray(charShape?.fontRatio) ? Number(charShape.fontRatio[0]) : 100;

        if (!Number.isFinite(fontBaseSize) || fontBaseSize <= 0) {
            return 11;
        }

        return Number(((fontBaseSize * (fontRatio / 100)) / 100).toFixed(2));
    }

    private static rgbArrayToCss(color: unknown): string | undefined {
        if (!Array.isArray(color) || color.length < 3) {
            return undefined;
        }

        const [red, green, blue] = color.map(value => Number(value));
        if ([red, green, blue].some(value => !Number.isFinite(value))) {
            return undefined;
        }

        return `rgb(${red}, ${green}, ${blue})`;
    }

    private static mapParagraphAlign(align: unknown): 'left' | 'center' | 'right' | 'justify' {
        switch (align) {
        case 0:
            return 'justify';
        case 2:
            return 'right';
        case 3:
            return 'center';
        default:
            return 'left';
        }
    }

    private static mapHwpxAlign(value: string | undefined): 'left' | 'center' | 'right' | 'justify' {
        switch ((value || '').toLowerCase()) {
        case 'center':
        case 'middle':
            return 'center';
        case 'right':
            return 'right';
        case 'justify':
        case 'distribute':
            return 'justify';
        default:
            return 'left';
        }
    }

    private static resolveHwpLineHeight(paragraph: any, fontSizePt?: number): number {
        const firstSegment = Array.isArray(paragraph?.lineSegments) ? paragraph.lineSegments[0] : null;
        const height = Number(firstSegment?.height);
        const spacing = Number(firstSegment?.lineSpacing);
        const baseFontSize = fontSizePt && Number.isFinite(fontSizePt) ? fontSizePt : 11;

        if (Number.isFinite(height) && height > 0) {
            const heightPt = Number(((height / 100)).toFixed(2));
            const spacingPt = Number.isFinite(spacing) ? spacing / 100 : 0;
            const ratio = (heightPt + spacingPt) / Math.max(baseFontSize, 1);
            return Number(Math.max(1.3, Math.min(ratio, 2.4)).toFixed(2));
        }

        return 1.65;
    }

    private static resolveHwpParagraphGap(paragraph: any, edge: 'before' | 'after', fontSizePt?: number): number {
        const lineCount = Array.isArray(paragraph?.lineSegments) ? paragraph.lineSegments.length : 0;
        const baseFontSize = fontSizePt && Number.isFinite(fontSizePt) ? fontSizePt : 11;

        if (lineCount <= 1) {
            return edge === 'before' ? 0 : Number((baseFontSize * 0.45).toFixed(2));
        }

        return edge === 'before' ? Number((baseFontSize * 0.1).toFixed(2)) : Number((baseFontSize * 0.35).toFixed(2));
    }

    private static resolveHwpFontWeight(charShape: any): string | undefined {
        const attr = Number(charShape?.attr);
        if (!Number.isFinite(attr)) {
            return undefined;
        }

        return (attr & 1) === 1 ? '700' : undefined;
    }

    private static resolveHwpBorderFillBackgroundColor(info: any, borderFillIndex: number | undefined): string | undefined {
        if (borderFillIndex === undefined || !Array.isArray(info?.borderFills)) {
            return undefined;
        }

        const borderFill = info.borderFills[borderFillIndex];
        if (!borderFill) {
            return undefined;
        }

        return this.rgbArrayToCss(borderFill.backgroundColor);
    }

    private static resolveHwpBorderFillBorderColor(info: any, borderFillIndex: number | undefined): string | undefined {
        if (borderFillIndex === undefined || !Array.isArray(info?.borderFills)) {
            return undefined;
        }

        const borderFill = info.borderFills[borderFillIndex];
        if (!borderFill) {
            return undefined;
        }

        return this.rgbArrayToCss(borderFill.style?.top?.color);
    }

    private static resolveHwpBorderFillBorderWidth(info: any, borderFillIndex: number | undefined): number | undefined {
        if (borderFillIndex === undefined || !Array.isArray(info?.borderFills)) {
            return undefined;
        }

        const borderFill = info.borderFills[borderFillIndex];
        if (!borderFill) {
            return undefined;
        }

        const widthMap = [0, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0];
        const widthIndex = Number(borderFill.style?.top?.width);
        return widthMap[widthIndex] ?? 0.5;
    }

    private static hwpUnitToPt(value: unknown, fallback: number): number {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return fallback;
        }

        return Number(((numericValue / 7200) * 72).toFixed(2));
    }

    private static readHwpxDimension(xml: string, pattern: RegExp, fallback: number): number {
        const match = xml.match(pattern);
        if (!match) {
            return fallback;
        }

        const rawValue = Number(match[1]);
        if (!Number.isFinite(rawValue) || rawValue <= 0) {
            return fallback;
        }

        return Number(((rawValue / 7200) * 72).toFixed(2));
    }

    private static createEmptyPage(id: string): HwpLayoutPage {
        return {
            id,
            widthPt: 595,
            minHeightPt: 842,
            headerText: this.defaultHeaderLabel(1),
            headerAlign: 'left',
            footerText: 'Page 1',
            footerAlign: 'right',
            paddingPt: {
                top: 56,
                right: 56,
                bottom: 56,
                left: 56
            },
            blocks: [this.createEmptyParagraph(`${id}-paragraph`)]
        };
    }

    private static createEmptyParagraph(id: string): HwpLayoutParagraph {
        return {
            id,
            kind: 'paragraph',
            align: 'left',
            lineHeight: 1.65,
            marginBottomPt: 8,
            runs: [{ text: '' }]
        };
    }

    private static extractHwpxParagraphStyle(paragraphXml: string): Omit<HwpLayoutParagraph, 'id' | 'kind' | 'runs'> {
        const align = this.mapHwpxAlign(this.readXmlAttribute(paragraphXml, /(?:align|horzAlign)="([^"]+)"/i));
        const fontSizePt = this.hwpxUnitToPt(this.readXmlNumber(paragraphXml, /(?:fontSize|charPrIDRefSize|sz)="(\d+)"/i), 11);
        const marginLeftPt = this.hwpxUnitToPt(this.readXmlNumber(paragraphXml, /(?:marginLeft|left)="(\d+)"/i), 0);
        const marginRightPt = this.hwpxUnitToPt(this.readXmlNumber(paragraphXml, /(?:marginRight|right)="(\d+)"/i), 0);
        const textIndentPt = this.hwpxUnitToPt(this.readXmlNumber(paragraphXml, /(?:indent|firstLine)="(-?\d+)"/i), 0);
        const marginTopPt = this.hwpxUnitToPt(this.readXmlNumber(paragraphXml, /(?:marginTop|spaceBefore|paraSpaceBefore)="(\d+)"/i), 0);
        const marginBottomPt = this.hwpxUnitToPt(this.readXmlNumber(paragraphXml, /(?:marginBottom|spaceAfter|paraSpaceAfter)="(\d+)"/i), fontSizePt * 0.45);
        const lineSpacingRaw = this.readXmlNumber(paragraphXml, /(?:lineSpacing|lineSpace)="(\d+)"/i);

        return {
            align,
            lineHeight: lineSpacingRaw && lineSpacingRaw > 0 ? Number(Math.max(1.3, Math.min(lineSpacingRaw / 100, 2.4)).toFixed(2)) : 1.65,
            fontSizePt,
            marginTopPt,
            marginBottomPt,
            marginLeftPt,
            marginRightPt,
            textIndentPt
        };
    }

    private static extractHwpxRuns(paragraphXml: string): HwpLayoutRun[] {
        const runMatches = paragraphXml.match(/<[^>]*?:run\b[\s\S]*?<\/[^>]*?:run>/gi) ?? [];

        if (runMatches.length === 0) {
            const text = this.decodeXmlText(paragraphXml.replace(/<[^>]+>/g, '')).trimEnd();
            return text ? [{ text, fontSizePt: 11 }] : [];
        }

        return runMatches
            .map(runXml => {
                const textMatches = runXml.match(/<[^>]*?:t\b[^>]*>([\s\S]*?)<\/[^>]*?:t>/gi) ?? [];
                const fieldAwareRunXml = this.extractXmlTextWithFieldTokens(runXml);
                const rawText = textMatches.map(match => match.replace(/<[^>]+>/g, '')).join(' ');
                const mergedText = [rawText, fieldAwareRunXml]
                    .filter(Boolean)
                    .join(' ')
                    .replace(/\s+/g, ' ');
                const text = this.decodeXmlText(mergedText).trimEnd();
                if (!text) {
                    return null;
                }

                return {
                    text,
                    fontSizePt: this.hwpxUnitToPt(this.readXmlNumber(runXml, /(?:fontSize|sz)="(\d+)"/i), 11),
                    fontWeight: /(?:bold|fontWt)="(?:1|true|bold|700)"/i.test(runXml) ? '700' : undefined,
                    fontStyle: /(?:italic|fontStyle)="(?:1|true|italic)"/i.test(runXml) ? 'italic' : undefined,
                    color: this.normalizeHwpxColor(this.readXmlAttribute(runXml, /(?:textColor|color)="([^"]+)"/i)),
                    backgroundColor: this.normalizeHwpxColor(this.readXmlAttribute(runXml, /(?:shadeColor|fillColor|backColor)="([^"]+)"/i))
                } as HwpLayoutRun;
            })
            .filter((run): run is HwpLayoutRun => run !== null);
    }

    private static extractHwpControlBlocks(paragraph: any, info: any, sectionIndex: number, paragraphIndex: number): HwpLayoutBlock[] {
        if (!Array.isArray(paragraph?.controls)) {
            return [];
        }

        const blocks: HwpLayoutBlock[] = [];

        for (const [controlIndex, control] of paragraph.controls.entries()) {
            if (Array.isArray(control?.content) && Number(control?.rowCount) > 0) {
                const tableBlock = this.mapHwpTableControl(control, info, sectionIndex, paragraphIndex, controlIndex);
                if (tableBlock) {
                    blocks.push(tableBlock);
                }
                continue;
            }

            if (control?.info?.binID !== undefined) {
                const imageBlock = this.mapHwpImageControl(control, info, sectionIndex, paragraphIndex, controlIndex);
                if (imageBlock) {
                    blocks.push(imageBlock);
                }
                continue;
            }

            const lineBlock = this.mapHwpLineControl(control, sectionIndex, paragraphIndex, controlIndex);
            if (lineBlock) {
                blocks.push(lineBlock);
                continue;
            }

            if (Array.isArray(control?.content) && Number(control?.width) > 0 && Number(control?.height) > 0) {
                const textBoxBlock = this.mapHwpTextBoxControl(control, sectionIndex, paragraphIndex, controlIndex);
                if (textBoxBlock) {
                    blocks.push(textBoxBlock);
                }
            }
        }

        return blocks;
    }

    private static mapHwpTableControl(control: any, info: any, sectionIndex: number, paragraphIndex: number, controlIndex: number): HwpLayoutTableBlock | null {
        const rows: HwpLayoutTableRow[] = [];

        for (const row of control.content ?? []) {
            if (!Array.isArray(row)) {
                continue;
            }

            const cells = row
                .map((cell: any) => this.mapHwpTableCell(cell, info))
                .filter((cell: HwpLayoutTableCell) => cell.text);

            if (cells.length > 0) {
                rows.push({ cells });
            }
        }

        if (rows.length === 0) {
            return null;
        }

        return {
            id: `hwp-table-${sectionIndex + 1}-${paragraphIndex + 1}-${controlIndex + 1}`,
            kind: 'table',
            rows,
            widthPt: Number(control?.width) > 0 ? Number((control.width / 100).toFixed(2)) : undefined,
            marginTopPt: 10,
            marginBottomPt: 12
        };
    }

    private static mapHwpTableCell(cell: any, info: any): HwpLayoutTableCell {
        const borderFill = cell?.attribute?.borderFillID !== undefined
            ? cell.attribute.borderFillID
            : undefined;

        return {
            text: this.extractParagraphListText(cell?.items),
            colSpan: Number(cell?.attribute?.colSpan) || 1,
            rowSpan: Number(cell?.attribute?.rowSpan) || 1,
            widthPt: Number(cell?.attribute?.width) > 0 ? Number((cell.attribute.width / 100).toFixed(2)) : undefined,
            heightPt: Number(cell?.attribute?.height) > 0 ? Number((cell.attribute.height / 100).toFixed(2)) : undefined,
            backgroundColor: this.resolveHwpBorderFillBackgroundColor(info, borderFill),
            borderColor: this.resolveHwpBorderFillBorderColor(info, borderFill),
            borderWidthPt: this.resolveHwpBorderFillBorderWidth(info, borderFill),
            textAlign: 'left'
        };
    }

    private static mapHwpImageControl(control: any, info: any, sectionIndex: number, paragraphIndex: number, controlIndex: number): HwpLayoutImageBlock | null {
        const binId = control?.info?.binID;
        const binData = Array.isArray(info?.binData) ? info.binData[binId] : null;

        return {
            id: `hwp-image-${sectionIndex + 1}-${paragraphIndex + 1}-${controlIndex + 1}`,
            kind: 'image',
            src: this.createHwpImageDataUrl(binData),
            alt: binData?.extension ? `embedded-${binData.extension}` : 'embedded-image',
            positioning: Number(control?.attribute?.vertRelTo) === 0 ? 'absolute' : 'inline',
            anchorScope: this.resolveHwpAnchorScope(control),
            leftPt: Number(control?.horizontalOffset) > 0 ? Number((control.horizontalOffset / 100).toFixed(2)) : undefined,
            topPt: Number(control?.verticalOffset) > 0 ? Number((control.verticalOffset / 100).toFixed(2)) : undefined,
            zIndex: Number.isFinite(Number(control?.zIndex)) ? Number(control.zIndex) : undefined,
            widthPt: Number(control?.width) > 0 ? Number((control.width / 100).toFixed(2)) : undefined,
            heightPt: Number(control?.height) > 0 ? Number((control.height / 100).toFixed(2)) : undefined,
            marginTopPt: 8,
            marginBottomPt: 12
        };
    }

    private static mapHwpLineControl(control: any, sectionIndex: number, paragraphIndex: number, controlIndex: number): HwpLayoutLineBlock | null {
        const controlType = String(control?.ctrlId || control?.shapeType || control?.objectType || '').toLowerCase();
        const widthPt = Number(control?.width) > 0 ? Number((control.width / 100).toFixed(2)) : undefined;
        const heightPt = Number(control?.height) > 0 ? Number((control.height / 100).toFixed(2)) : undefined;
        if (!/line|arc|curve|connector/.test(controlType) && !(widthPt && heightPt && Math.min(widthPt, heightPt) <= 8 && !Array.isArray(control?.content))) {
            return null;
        }

        return {
            id: `hwp-line-${sectionIndex + 1}-${paragraphIndex + 1}-${controlIndex + 1}`,
            kind: 'line',
            positioning: Number(control?.attribute?.vertRelTo) === 0 ? 'absolute' : 'inline',
            anchorScope: this.resolveHwpAnchorScope(control),
            leftPt: Number(control?.horizontalOffset) > 0 ? Number((control.horizontalOffset / 100).toFixed(2)) : undefined,
            topPt: Number(control?.verticalOffset) > 0 ? Number((control.verticalOffset / 100).toFixed(2)) : undefined,
            zIndex: Number.isFinite(Number(control?.zIndex)) ? Number(control.zIndex) : undefined,
            widthPt: widthPt || 80,
            heightPt: heightPt || 2,
            x1Pt: Number.isFinite(Number(control?.x1)) ? Number((Number(control.x1) / 100).toFixed(2)) : 0,
            y1Pt: Number.isFinite(Number(control?.y1)) ? Number((Number(control.y1) / 100).toFixed(2)) : 0,
            x2Pt: Number.isFinite(Number(control?.x2)) ? Number((Number(control.x2) / 100).toFixed(2)) : (widthPt || 80),
            y2Pt: Number.isFinite(Number(control?.y2)) ? Number((Number(control.y2) / 100).toFixed(2)) : (heightPt || 2),
            pathD: this.extractLinePathDFromPoints(control?.points),
            rotateDeg: this.normalizeRotation(control?.rotateAngle ?? control?.rotation),
            color: this.rgbArrayToCss(control?.lineColor || control?.color),
            lineWidthPt: Number(control?.lineThick) > 0 ? Number((Number(control.lineThick) / 100).toFixed(2)) : 1,
            lineStyle: this.normalizeBorderStyle(control?.lineStyle || control?.lineType),
            markerStart: this.normalizeMarkerType(control?.lineHead || control?.startArrow),
            markerEnd: this.normalizeMarkerType(control?.lineTail || control?.endArrow),
            marginTopPt: 6,
            marginBottomPt: 8
        };
    }

    private static mapHwpTextBoxControl(control: any, sectionIndex: number, paragraphIndex: number, controlIndex: number): HwpLayoutTextBoxBlock | null {
        const text = (control.content ?? [])
            .flatMap((paragraphList: any) => Array.isArray(paragraphList?.items) ? paragraphList.items : [])
            .map((item: any) => this.extractHwpParagraphText(item))
            .filter(Boolean)
            .join('\n')
            .trim();

        if (!text) {
            return null;
        }

        return {
            id: `hwp-textbox-${sectionIndex + 1}-${paragraphIndex + 1}-${controlIndex + 1}`,
            kind: 'textbox',
            text,
            shapeType: this.normalizeShapeType(control?.shapeType || control?.objectType || control?.ctrlId),
            textAlign: 'left',
            color: this.rgbArrayToCss(control?.textColor),
            backgroundColor: this.rgbArrayToCss(control?.fillColor) || this.rgbArrayToCss(control?.backgroundColor),
            borderColor: this.rgbArrayToCss(control?.lineColor) || this.rgbArrayToCss(control?.borderColor),
            borderWidthPt: Number(control?.lineThick) > 0 ? Number((Number(control.lineThick) / 100).toFixed(2)) : undefined,
            borderStyle: this.normalizeBorderStyle(control?.lineStyle || control?.lineType),
            borderRadiusPt: Number(control?.radius) > 0 ? Number((Number(control.radius) / 100).toFixed(2)) : undefined,
            paddingPt: 8,
            opacity: this.normalizeOpacity(control?.fillAlpha ?? control?.alpha ?? control?.opacity),
            rotateDeg: this.normalizeRotation(control?.rotateAngle ?? control?.rotation),
            backgroundImage: this.resolveShapeBackgroundFill(control),
            boxShadowCss: this.resolveShapeShadow(control),
            markerStart: this.normalizeMarkerType(control?.lineHead || control?.startArrow),
            markerEnd: this.normalizeMarkerType(control?.lineTail || control?.endArrow),
            positioning: Number(control?.attribute?.vertRelTo) === 0 ? 'absolute' : 'inline',
            anchorScope: this.resolveHwpAnchorScope(control),
            leftPt: Number(control?.horizontalOffset) > 0 ? Number((control.horizontalOffset / 100).toFixed(2)) : undefined,
            topPt: Number(control?.verticalOffset) > 0 ? Number((control.verticalOffset / 100).toFixed(2)) : undefined,
            zIndex: Number.isFinite(Number(control?.zIndex)) ? Number(control.zIndex) : undefined,
            widthPt: Number(control?.width) > 0 ? Number((control.width / 100).toFixed(2)) : undefined,
            heightPt: Number(control?.height) > 0 ? Number((control.height / 100).toFixed(2)) : undefined,
            marginTopPt: 8,
            marginBottomPt: 12
        };
    }

    private static createHwpImageDataUrl(binData: any): string | undefined {
        const payload = binData?.payload;
        const extension = String(binData?.extension || '').toLowerCase();

        if (!(payload instanceof Uint8Array) && !Buffer.isBuffer(payload)) {
            return undefined;
        }

        const buffer = Buffer.from(payload);
        const mimeType = ({
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            bmp: 'image/bmp',
            webp: 'image/webp'
        } as Record<string, string>)[extension] || 'application/octet-stream';

        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    private static extractParagraphListText(items: any[]): string {
        if (!Array.isArray(items)) {
            return '';
        }

        return items
            .map(item => this.extractHwpParagraphText(item))
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    private static extractHwpxTables(xml: string, pageIndex: number): HwpLayoutTableBlock[] {
        const tableMatches = xml.match(/<[^>]*?:tbl\b[\s\S]*?<\/[^>]*?:tbl>/gi) ?? [];

        return tableMatches.map((tableXml, tableIndex): HwpLayoutTableBlock => {
            const rowMatches = tableXml.match(/<[^>]*?:tr\b[\s\S]*?<\/[^>]*?:tr>/gi) ?? [];
            const rows: HwpLayoutTableRow[] = rowMatches.map(rowXml => {
                const cellMatches = rowXml.match(/<[^>]*?:tc\b[\s\S]*?<\/[^>]*?:tc>/gi) ?? [];
                return {
                    cells: cellMatches
                        .map(cellXml => ({
                            text: this.decodeXmlText(cellXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim(),
                            colSpan: this.readXmlNumber(cellXml, /(?:colSpan|gridSpan)="(\d+)"/i) ?? 1,
                            rowSpan: this.readXmlNumber(cellXml, /(?:rowSpan|rowMerge)="(\d+)"/i) ?? 1,
                            widthPt: this.hwpxUnitToPt(this.readXmlNumber(cellXml, /(?:width|cellW)="(\d+)"/i), 0),
                            heightPt: this.hwpxUnitToPt(this.readXmlNumber(cellXml, /(?:height|cellH)="(\d+)"/i), 0),
                            backgroundColor: this.normalizeHwpxColor(this.readXmlAttribute(cellXml, /(?:fillColor|backColor|bgColor)="([^"]+)"/i)),
                            borderColor: this.normalizeHwpxColor(this.readXmlAttribute(cellXml, /(?:borderColor|lineColor)="([^"]+)"/i)),
                            textAlign: this.mapHwpxAlign(this.readXmlAttribute(cellXml, /(?:align|horzAlign)="([^"]+)"/i))
                        }))
                        .filter((cell: HwpLayoutTableCell) => cell.text)
                };
            }).filter((row: HwpLayoutTableRow) => row.cells.length > 0);

            return {
                id: `hwpx-table-${pageIndex + 1}-${tableIndex + 1}`,
                kind: 'table',
                rows,
                marginTopPt: 10,
                marginBottomPt: 12
            };
        }).filter((table: HwpLayoutTableBlock) => table.rows.length > 0);
    }

    private static async collectHwpxBinaryAssets(zip: JSZip): Promise<Map<string, string>> {
        const assets = new Map<string, string>();
        const names = Object.keys(zip.files).filter(name => this.looksLikeImageAsset(name));

        for (const name of names) {
            const file = zip.files[name];
            if (!file || file.dir) {
                continue;
            }

            const buffer = await file.async('nodebuffer');
            const ext = path.extname(name).replace('.', '').toLowerCase();
            const mimeType = ({
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                gif: 'image/gif',
                bmp: 'image/bmp',
                webp: 'image/webp',
                svg: 'image/svg+xml'
            } as Record<string, string>)[ext];

            if (!mimeType) {
                continue;
            }

            const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
            assets.set(name.toLowerCase(), dataUrl);
            assets.set(path.basename(name).toLowerCase(), dataUrl);
            assets.set(path.basename(name, path.extname(name)).toLowerCase(), dataUrl);
        }

        return assets;
    }

    private static looksLikeImageAsset(name: string): boolean {
        return /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(name);
    }

    private static extractHwpxImages(xml: string, pageIndex: number, binaryAssets: Map<string, string>): HwpLayoutImageBlock[] {
        const imageRefs = new Set<string>();
        const patterns = [
            /(?:binaryItemIDRef|idref|href|src)="([^"]+)"/gi,
            /(?:fileName|name)="([^"]+\.(?:png|jpe?g|gif|bmp|webp|svg))"/gi
        ];

        for (const pattern of patterns) {
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(xml)) !== null) {
                imageRefs.add(match[1]);
            }
        }

        const blocks: HwpLayoutImageBlock[] = [];
        let imageIndex = 0;

        for (const ref of imageRefs) {
            const normalizedCandidates = this.expandHwpxImageRefCandidates(ref);
            const src = normalizedCandidates.map(candidate => binaryAssets.get(candidate)).find(Boolean);

            if (!src) {
                continue;
            }

            imageIndex += 1;
            blocks.push({
                id: `hwpx-image-${pageIndex + 1}-${imageIndex}`,
                kind: 'image',
                src,
                alt: path.basename(ref),
                positioning: this.readHwpxImagePositioning(xml, ref),
                anchorScope: this.resolveHwpxAnchorScope(this.findHwpxImageSnippet(xml, ref) || ''),
                leftPt: this.hwpxUnitToPt(this.readHwpxImageMetric(xml, ref, /(?:x|left)="(-?\d+)"/i), 0),
                topPt: this.hwpxUnitToPt(this.readHwpxImageMetric(xml, ref, /(?:y|top)="(-?\d+)"/i), 0),
                zIndex: this.readHwpxImageMetric(xml, ref, /(?:zOrder|zIndex)="(-?\d+)"/i) ?? undefined,
                widthPt: this.hwpxUnitToPt(this.readHwpxImageMetric(xml, ref, /(?:width|curWidth)="(\d+)"/i), 0),
                heightPt: this.hwpxUnitToPt(this.readHwpxImageMetric(xml, ref, /(?:height|curHeight)="(\d+)"/i), 0),
                marginTopPt: 8,
                marginBottomPt: 12
            });
        }

        return blocks;
    }

    private static extractHwpxTextBoxes(xml: string, pageIndex: number): HwpLayoutTextBoxBlock[] {
        const candidates = [
            ...this.matchHwpxShapeLikeBlocks(xml, /<[^>]*?(?:textbox|shapeRect|shapeObject|drawText|textBox)[^>]*>[\s\S]*?<\/[^>]+>/gi),
            ...this.matchHwpxShapeLikeBlocks(xml, /<[^>]*?(?:shapeRect|shapeContainer|shapeComponent)[^>]*\/>/gi)
        ];

        const deduped = new Map<string, HwpLayoutTextBoxBlock>();
        let index = 0;

        for (const candidate of candidates) {
            const text = this.extractVisibleTextFromXml(candidate.xml);
            if (!text) {
                continue;
            }

            index += 1;
            const id = `hwpx-textbox-${pageIndex + 1}-${index}`;
            deduped.set(id, {
                id,
                kind: 'textbox',
                text,
                shapeType: this.normalizeShapeType(
                    this.readXmlAttribute(candidate.xml, /(?:shapeType|objectType|type)="([^"]+)"/i)
                        || candidate.xml.match(/<(?:[^>:]+:)?(ellipse|oval|rect|roundRect|diamond|textbox|shapeRect)\b/i)?.[1]
                ),
                textAlign: this.mapHwpxAlign(this.readXmlAttribute(candidate.xml, /(?:align|horzAlign|textAlign)="([^"]+)"/i)),
                color: this.normalizeHwpxColor(this.readXmlAttribute(candidate.xml, /(?:textColor|fontColor|color)="([^"]+)"/i)),
                backgroundColor: this.normalizeHwpxColor(this.readXmlAttribute(candidate.xml, /(?:fillColor|backColor|bgColor)="([^"]+)"/i)),
                borderColor: this.normalizeHwpxColor(this.readXmlAttribute(candidate.xml, /(?:borderColor|lineColor|strokeColor)="([^"]+)"/i)),
                borderWidthPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:lineWidth|borderWidth|strokeWidth)="(\d+)"/i), 0),
                borderStyle: this.normalizeBorderStyle(this.readXmlAttribute(candidate.xml, /(?:lineStyle|strokeStyle|borderStyle)="([^"]+)"/i)),
                borderRadiusPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:radius|cornerRadius)="(\d+)"/i), 0),
                paddingPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:padding|innerMargin)="(\d+)"/i), 8),
                opacity: this.normalizeOpacity(
                    this.readXmlAttribute(candidate.xml, /(?:alpha|fillAlpha|opacity)="([^"]+)"/i)
                ),
                rotateDeg: this.normalizeRotation(
                    this.readXmlAttribute(candidate.xml, /(?:rotation|rotate|rot)="([^"]+)"/i)
                ),
                backgroundImage: this.resolveHwpxShapeBackgroundFill(candidate.xml),
                boxShadowCss: this.resolveHwpxShapeShadow(candidate.xml),
                markerStart: this.normalizeMarkerType(
                    this.readXmlAttribute(candidate.xml, /(?:startArrow|headStyle|lineHead)="([^"]+)"/i)
                ),
                markerEnd: this.normalizeMarkerType(
                    this.readXmlAttribute(candidate.xml, /(?:endArrow|tailStyle|lineTail)="([^"]+)"/i)
                ),
                positioning: this.resolveHwpxShapePositioning(candidate.xml),
                anchorScope: this.resolveHwpxAnchorScope(candidate.xml),
                leftPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:x|left)="(-?\d+)"/i), 0),
                topPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:y|top)="(-?\d+)"/i), 0),
                zIndex: this.readXmlNumber(candidate.xml, /(?:zOrder|zIndex)="(-?\d+)"/i) ?? undefined,
                widthPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:width|curWidth|szw)="(\d+)"/i), 120),
                heightPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:height|curHeight|szh)="(\d+)"/i), 40),
                marginTopPt: 8,
                marginBottomPt: 12
            });
        }

        return [...deduped.values()];
    }

    private static extractHwpxLines(xml: string, pageIndex: number): HwpLayoutLineBlock[] {
        const candidates = this.matchHwpxShapeLikeBlocks(xml, /<[^>]*?(?:line|arc|curve|connector|shapeLine)[^>]*\/?>[\s\S]*?(?:<\/[^>]+>)?/gi);
        return candidates.map((candidate, index) => {
            const widthPt = this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:width|curWidth|szw)="(\d+)"/i), 80);
            const heightPt = this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:height|curHeight|szh)="(\d+)"/i), 2);
            return {
                id: `hwpx-line-${pageIndex + 1}-${index + 1}`,
                kind: 'line',
                positioning: this.resolveHwpxShapePositioning(candidate.xml),
                leftPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:x|left)="(-?\d+)"/i), 0),
                topPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:y|top)="(-?\d+)"/i), 0),
                zIndex: this.readXmlNumber(candidate.xml, /(?:zOrder|zIndex)="(-?\d+)"/i) ?? undefined,
                widthPt,
                heightPt,
                x1Pt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:x1|startX|fromX)="(-?\d+)"/i), 0),
                y1Pt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:y1|startY|fromY)="(-?\d+)"/i), 0),
                x2Pt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:x2|endX|toX)="(-?\d+)"/i), widthPt),
                y2Pt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:y2|endY|toY)="(-?\d+)"/i), heightPt),
                pathD: this.extractHwpxLinePathD(candidate.xml),
                rotateDeg: this.normalizeRotation(this.readXmlAttribute(candidate.xml, /(?:rotation|rotate|rot)="([^"]+)"/i)),
                color: this.normalizeHwpxColor(this.readXmlAttribute(candidate.xml, /(?:lineColor|strokeColor|color)="([^"]+)"/i)),
                lineWidthPt: this.hwpxUnitToPt(this.readXmlNumber(candidate.xml, /(?:lineWidth|strokeWidth)="(\d+)"/i), 1),
                lineStyle: this.normalizeBorderStyle(this.readXmlAttribute(candidate.xml, /(?:lineStyle|strokeStyle|borderStyle)="([^"]+)"/i)),
                markerStart: this.normalizeMarkerType(this.readXmlAttribute(candidate.xml, /(?:startArrow|headStyle|lineHead)="([^"]+)"/i)),
                markerEnd: this.normalizeMarkerType(this.readXmlAttribute(candidate.xml, /(?:endArrow|tailStyle|lineTail)="([^"]+)"/i)),
                anchorScope: this.resolveHwpxAnchorScope(candidate.xml),
                marginTopPt: 6,
                marginBottomPt: 8
            } as HwpLayoutLineBlock;
        });
    }

    private static extractLinePathDFromPoints(points: unknown): string | undefined {
        if (!Array.isArray(points) || points.length < 2) {
            return undefined;
        }

        const normalizedPoints = points
            .map((point: any) => ({
                x: Number.isFinite(Number(point?.x)) ? Number((Number(point.x) / 100).toFixed(2)) : undefined,
                y: Number.isFinite(Number(point?.y)) ? Number((Number(point.y) / 100).toFixed(2)) : undefined
            }))
            .filter((point: { x?: number; y?: number }) => point.x !== undefined && point.y !== undefined) as Array<{ x: number; y: number }>;

        if (normalizedPoints.length < 2) {
            return undefined;
        }

        return normalizedPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    }

    private static extractHwpxLinePathD(xml: string): string | undefined {
        const pointMatches = [...xml.matchAll(/(?:x|ptx)="(-?\d+)"[^>]*?(?:y|pty)="(-?\d+)"/gi)];
        if (pointMatches.length >= 2) {
            return pointMatches
                .map((match, index) => {
                    const x = this.hwpxUnitToPt(Number(match[1]), 0);
                    const y = this.hwpxUnitToPt(Number(match[2]), 0);
                    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
                })
                .join(' ');
        }

        return this.readXmlAttribute(xml, /(?:pathData|d)="([^"]+)"/i) || undefined;
    }

    private static matchHwpxShapeLikeBlocks(xml: string, pattern: RegExp): Array<{ xml: string }> {
        const matches = xml.match(pattern) ?? [];
        return matches.map(match => ({ xml: match }));
    }

    private static extractVisibleTextFromXml(xml: string): string {
        const textMatches = xml.match(/<[^>]*?:t\b[^>]*>([\s\S]*?)<\/[^>]*?:t>/gi) ?? [];
        const rawText = textMatches.length > 0
            ? textMatches.map(match => match.replace(/<[^>]+>/g, '')).join('\n')
            : xml.replace(/<[^>]+>/g, ' ');
        const text = this.decodeXmlText(rawText).replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/\s+/g, ' ').trim();

        if (!text) {
            return '';
        }

        if (/^(header|footer|page)\b/i.test(text) && text.length < 16) {
            return '';
        }

        return text;
    }

    private static resolveHwpxShapePositioning(xml: string): 'inline' | 'absolute' {
        if (/(?:treatAsChar|inline)="(?:1|true)"/i.test(xml)) {
            return 'inline';
        }

        if (/(?:textWrap|flowWithText)="(?:square|topAndBottom|behindText|inFrontOfText|0|false)"/i.test(xml)) {
            return 'absolute';
        }

        if (/(?:x|left|y|top)="-?\d+"/i.test(xml)) {
            return 'absolute';
        }

        return 'inline';
    }

    private static expandHwpxImageRefCandidates(ref: string): string[] {
        const normalized = ref.replace(/^#/, '').replace(/\\/g, '/').toLowerCase();
        const candidates = new Set<string>([
            normalized,
            path.basename(normalized),
            path.basename(normalized, path.extname(normalized))
        ]);

        if (!/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(normalized)) {
            for (const prefix of ['bindata/', 'contents/bindata/', 'bin/', 'contents/']) {
                for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']) {
                    candidates.add(`${prefix}${normalized}.${ext}`);
                    candidates.add(`${prefix}${path.basename(normalized)}.${ext}`);
                }
            }
        }

        return [...candidates];
    }

    private static readHwpxImagePositioning(xml: string, ref: string): 'inline' | 'absolute' {
        const snippet = this.findHwpxImageSnippet(xml, ref);
        if (!snippet) {
            return 'inline';
        }

        return /(?:treatAsChar|inline)="(?:0|false)"/i.test(snippet) ? 'absolute' : 'inline';
    }

    private static resolveHwpAnchorScope(control: any): 'page' | 'paragraph' | 'cell' | 'character' | undefined {
        const verticalTarget = Number(control?.attribute?.vertRelTo);
        const horizontalTarget = Number(control?.attribute?.horzRelTo ?? control?.attribute?.textHorzRelTo);
        const anchorTarget = Number.isFinite(verticalTarget) ? verticalTarget : horizontalTarget;
        if (!Number.isFinite(anchorTarget)) {
            return undefined;
        }

        if (anchorTarget === 0) {
            return 'page';
        }

        if (anchorTarget === 1) {
            return 'paragraph';
        }

        if (anchorTarget === 2) {
            return 'cell';
        }

        if (anchorTarget === 3) {
            return 'character';
        }

        return undefined;
    }

    private static resolveHwpxAnchorScope(xml: string): 'page' | 'paragraph' | 'cell' | 'character' | undefined {
        const value = this.readXmlAttribute(xml, /(?:vertRelTo|horzRelTo|relativeTo|textFlowAnchor)="([^"]+)"/i);
        if (!value) {
            return undefined;
        }

        const normalized = value.toLowerCase();
        if (/page|paper/.test(normalized)) {
            return 'page';
        }

        if (/para|paragraph/.test(normalized)) {
            return 'paragraph';
        }

        if (/cell|table/.test(normalized)) {
            return 'cell';
        }

        if (/char|letter|inline/.test(normalized)) {
            return 'character';
        }

        return undefined;
    }

    private static readHwpxImageMetric(xml: string, ref: string, pattern: RegExp): number | undefined {
        const snippet = this.findHwpxImageSnippet(xml, ref);
        if (!snippet) {
            return undefined;
        }

        return this.readXmlNumber(snippet, pattern);
    }

    private static findHwpxImageSnippet(xml: string, ref: string): string | undefined {
        const normalizedRef = ref.replace(/^#/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`<[^>]+(?:binaryItemIDRef|idref|href|src)="${normalizedRef}"[^>]*>[\\s\\S]*?<\\/[^>]+>|<[^>]+(?:binaryItemIDRef|idref|href|src)="${normalizedRef}"[^>]*/>`, 'i');
        return xml.match(pattern)?.[0];
    }

    private static paginatePages(pages: HwpLayoutPage[]): HwpLayoutPage[] {
        const result: HwpLayoutPage[] = [];

        for (const page of pages) {
            const contentHeightPt = Math.max(page.minHeightPt - page.paddingPt.top - page.paddingPt.bottom, 120);
            let currentBlocks: HwpLayoutBlock[] = [];
            let currentHeightPt = 0;
            let pageIndex = 1;

            for (const block of page.blocks) {
                const blockHeightPt = this.estimateBlockHeight(block, page.widthPt - page.paddingPt.left - page.paddingPt.right);

                if (currentBlocks.length > 0 && currentHeightPt + blockHeightPt > contentHeightPt) {
                    result.push({
                        ...page,
                        id: `${page.id}-split-${pageIndex}`,
                        blocks: currentBlocks
                    });
                    currentBlocks = [];
                    currentHeightPt = 0;
                    pageIndex += 1;
                }

                currentBlocks.push(block);
                currentHeightPt += blockHeightPt;
            }

            result.push({
                ...page,
                id: pageIndex === 1 ? page.id : `${page.id}-split-${pageIndex}`,
                blocks: currentBlocks.length > 0 ? currentBlocks : [this.createEmptyParagraph(`${page.id}-empty`)]
            });
        }

        return result;
    }

    private static estimateBlockHeight(block: HwpLayoutBlock, usableWidthPt: number): number {
        if (block.kind === 'table') {
            const rowCount = block.rows.length || 1;
            const cellLines = block.rows.reduce((sum, row) => {
                const rowLineCount = row.cells.reduce((rowMax, cell) => Math.max(rowMax, Math.max(1, Math.ceil(cell.text.length / 24))), 1);
                return sum + rowLineCount;
            }, 0);
            return (block.marginTopPt ?? 0) + Math.max(48, rowCount * 28 + cellLines * 10) + (block.marginBottomPt ?? 0);
        }

        if (block.kind === 'image') {
            if (block.positioning === 'absolute') {
                return 0;
            }
            return (block.marginTopPt ?? 0) + Math.max(block.heightPt ?? 140, 80) + (block.marginBottomPt ?? 0);
        }

        if (block.kind === 'line') {
            if (block.positioning === 'absolute') {
                return 0;
            }

            return Math.max((block.heightPt ?? 2) + (block.marginTopPt ?? 0) + (block.marginBottomPt ?? 0), 8);
        }

        if (block.kind === 'textbox') {
            if (block.positioning === 'absolute') {
                return 0;
            }

            const widthBudget = Math.max((block.widthPt ?? usableWidthPt) / 6.2, 12);
            const lines = block.text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Math.max(line.length, 1) / widthBudget)), 0);
            const contentHeight = Math.max(block.heightPt ?? 72, lines * 16);
            return (block.marginTopPt ?? 0) + contentHeight + (block.marginBottomPt ?? 0);
        }

        return this.estimateParagraphHeight(block, usableWidthPt);
    }

    private static estimateParagraphHeight(paragraph: HwpLayoutParagraph, usableWidthPt: number): number {
        const fontSizePt = paragraph.fontSizePt ?? paragraph.runs.find(run => run.fontSizePt)?.fontSizePt ?? 11;
        const text = paragraph.runs.map(run => run.text).join('');
        const averageCharWidth = fontSizePt * 0.52;
        const widthBudget = Math.max(usableWidthPt - (paragraph.marginLeftPt ?? 0) - (paragraph.marginRightPt ?? 0) - Math.abs(paragraph.textIndentPt ?? 0), fontSizePt * 8);
        const roughCharsPerLine = Math.max(Math.floor(widthBudget / Math.max(averageCharWidth, 1)), 8);
        const explicitLines = text.split('\n');
        let lineCount = 0;

        for (const line of explicitLines) {
            const visualLength = Math.max(line.length, 1);
            lineCount += Math.max(1, Math.ceil(visualLength / roughCharsPerLine));
        }

        return Number((lineCount * fontSizePt * (paragraph.lineHeight || 1.65)).toFixed(2));
    }

    private static readXmlAttribute(xml: string, pattern: RegExp): string | undefined {
        return xml.match(pattern)?.[1];
    }

    private static readXmlNumber(xml: string, pattern: RegExp): number | undefined {
        const rawValue = this.readXmlAttribute(xml, pattern);
        if (rawValue === undefined) {
            return undefined;
        }

        const value = Number(rawValue);
        return Number.isFinite(value) ? value : undefined;
    }

    private static hwpxUnitToPt(value: number | undefined, fallback: number): number {
        if (!Number.isFinite(value)) {
            return fallback;
        }

        return Number((((value as number) / 7200) * 72).toFixed(2));
    }

    private static normalizeHwpxColor(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = value.replace(/^#/, '').trim();
        if (/^[0-9a-f]{6}$/i.test(normalized)) {
            return `#${normalized}`;
        }

        return undefined;
    }

    private static normalizeBorderStyle(value: unknown): 'solid' | 'dashed' | 'dotted' | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = String(value).toLowerCase();
        if (/(dot|dotted)/i.test(normalized)) {
            return 'dotted';
        }

        if (/(dash|longdash|shortdash)/i.test(normalized)) {
            return 'dashed';
        }

        if (/(solid|line|single)/i.test(normalized)) {
            return 'solid';
        }

        return undefined;
    }

    private static normalizeOpacity(value: unknown): number | undefined {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return undefined;
        }

        if (numericValue > 1) {
            return Number(Math.max(0.05, Math.min(numericValue / 100, 1)).toFixed(2));
        }

        return Number(Math.max(0.05, Math.min(numericValue, 1)).toFixed(2));
    }

    private static normalizeRotation(value: unknown): number | undefined {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return undefined;
        }

        const degreeValue = Math.abs(numericValue) > 360 ? numericValue / 100 : numericValue;
        return Number(degreeValue.toFixed(2));
    }

    private static normalizeMarkerType(value: unknown): 'arrow' | 'diamond' | 'circle' | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = String(value).toLowerCase();
        if (/diamond|rhombus/.test(normalized)) {
            return 'diamond';
        }

        if (/circle|oval|round/.test(normalized)) {
            return 'circle';
        }

        if (/arrow|triangle|spear/.test(normalized)) {
            return 'arrow';
        }

        return undefined;
    }

    private static normalizeShapeType(value: unknown): 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = String(value).toLowerCase();
        if (/ellipse|oval|circle/.test(normalized)) {
            return 'ellipse';
        }

        if (/diamond|rhombus/.test(normalized)) {
            return 'diamond';
        }

        if (/round|rounded/.test(normalized)) {
            return 'rounded';
        }

        if (/rect|textbox|shape/.test(normalized)) {
            return 'rectangle';
        }

        return undefined;
    }

    private static resolveShapeBackgroundFill(control: any): string | undefined {
        const startColor = this.rgbArrayToCss(control?.gradationStartColor || control?.gradientStartColor);
        const endColor = this.rgbArrayToCss(control?.gradationEndColor || control?.gradientEndColor);
        if (startColor && endColor) {
            return `linear-gradient(135deg, ${startColor}, ${endColor})`;
        }

        if (control?.fillPatternColor) {
            const patternColor = this.rgbArrayToCss(control.fillPatternColor);
            const baseColor = this.rgbArrayToCss(control?.fillColor) || 'rgba(255,255,255,0.88)';
            if (patternColor) {
                return `repeating-linear-gradient(45deg, ${baseColor}, ${baseColor} 6pt, ${patternColor} 6pt, ${patternColor} 12pt)`;
            }
        }

        return undefined;
    }

    private static resolveShapeShadow(control: any): string | undefined {
        const shadowColor = this.rgbArrayToCss(control?.shadowColor);
        const offsetX = Number(control?.shadowOffsetX ?? control?.shadowOffset?.x);
        const offsetY = Number(control?.shadowOffsetY ?? control?.shadowOffset?.y);
        const blur = Number(control?.shadowBlur ?? control?.shadowSoft);
        const opacity = this.normalizeOpacity(control?.shadowAlpha ?? control?.shadowOpacity) ?? 0.18;
        if (!shadowColor && !Number.isFinite(offsetX) && !Number.isFinite(offsetY)) {
            return undefined;
        }

        const cssColor = this.withAlpha(shadowColor || '#000000', opacity);
        return `${Number.isFinite(offsetX) ? offsetX / 100 : 2}px ${Number.isFinite(offsetY) ? offsetY / 100 : 2}px ${Number.isFinite(blur) ? blur / 100 : 8}px ${cssColor}`;
    }

    private static resolveHwpxShapeBackgroundFill(xml: string): string | undefined {
        const startColor = this.normalizeHwpxColor(this.readXmlAttribute(xml, /(?:gradColor1|startColor|fillStartColor)="([^"]+)"/i));
        const endColor = this.normalizeHwpxColor(this.readXmlAttribute(xml, /(?:gradColor2|endColor|fillEndColor)="([^"]+)"/i));
        if (startColor && endColor) {
            return `linear-gradient(135deg, ${startColor}, ${endColor})`;
        }

        const patternColor = this.normalizeHwpxColor(this.readXmlAttribute(xml, /(?:patternColor|hatchColor)="([^"]+)"/i));
        const baseColor = this.normalizeHwpxColor(this.readXmlAttribute(xml, /(?:fillColor|backColor|bgColor)="([^"]+)"/i));
        if (patternColor && baseColor) {
            return `repeating-linear-gradient(45deg, ${baseColor}, ${baseColor} 6pt, ${patternColor} 6pt, ${patternColor} 12pt)`;
        }

        return undefined;
    }

    private static resolveHwpxShapeShadow(xml: string): string | undefined {
        const shadowColor = this.normalizeHwpxColor(this.readXmlAttribute(xml, /(?:shadowColor|effectColor)="([^"]+)"/i));
        const offsetX = this.readXmlNumber(xml, /(?:shadowOffsetX|offsetX)="(-?\d+)"/i);
        const offsetY = this.readXmlNumber(xml, /(?:shadowOffsetY|offsetY)="(-?\d+)"/i);
        const blur = this.readXmlNumber(xml, /(?:shadowBlur|blurRadius)="(\d+)"/i);
        const opacity = this.normalizeOpacity(this.readXmlAttribute(xml, /(?:shadowAlpha|shadowOpacity)="([^"]+)"/i)) ?? 0.18;
        if (!shadowColor && offsetX === undefined && offsetY === undefined) {
            return undefined;
        }

        const cssColor = this.withAlpha(shadowColor || '#000000', opacity);
        return `${offsetX !== undefined ? offsetX / 100 : 2}px ${offsetY !== undefined ? offsetY / 100 : 2}px ${blur !== undefined ? blur / 100 : 8}px ${cssColor}`;
    }

    private static withAlpha(color: string, alpha: number): string {
        const normalized = color.replace(/^#/, '');
        if (!/^[0-9a-f]{6}$/i.test(normalized)) {
            return color;
        }

        const r = Number.parseInt(normalized.slice(0, 2), 16);
        const g = Number.parseInt(normalized.slice(2, 4), 16);
        const b = Number.parseInt(normalized.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    private static decodeXmlText(value: string): string {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }
}
