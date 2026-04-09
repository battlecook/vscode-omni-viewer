import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

interface Relationship {
    id: string;
    target: string;
    type: string;
}

interface Transform {
    offX: number;
    offY: number;
    scaleX: number;
    scaleY: number;
    rotDeg: number;
}

interface ThemeInfo {
    colors: Record<string, string>;
}

interface ColorContext {
    themeColors: Record<string, string>;
    clrMap: Record<string, string>;
}

interface ParsedElement {
    type: 'text' | 'image' | 'table' | 'chart' | 'shape';
    x: number;
    y: number;
    width: number;
    height: number;
    rotateDeg?: number;
    zIndex: number;
    sourcePriority: number;
    placeholderKey?: string;
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
    vectorFallback?: boolean;
    tableRows?: string[][];
    chartKind?: string;
    chartTitle?: string;
    chartData?: {
        kind: 'stackedColumn';
        categories: string[];
        series: Array<{
            name: string;
            color: string;
            values: number[];
            dataLabel?: {
                showValue?: boolean;
                numFmt?: string;
                fontSizePx?: number;
                color?: string;
            };
        }>;
        gapWidth?: number;
        overlap?: number;
        legend?: {
            position?: string;
            fontSizePx?: number;
            color?: string;
            align?: string;
        };
        categoryAxis?: {
            numFmt?: string;
            fontSizePx?: number;
            color?: string;
            lineColor?: string;
        };
        valueAxis?: {
            numFmt?: string;
            fontSizePx?: number;
            color?: string;
            lineColor?: string;
            gridColor?: string;
            majorUnit?: number;
            min?: number;
            max?: number;
            crossesAt?: number;
        };
    };
    fillColor?: string;
    borderColor?: string;
    hasGeometry?: boolean;
    hiddenPromptText?: boolean;
}

const ZERO_TX: Transform = {
    offX: 0,
    offY: 0,
    scaleX: 1,
    scaleY: 1,
    rotDeg: 0
};

export class PptxXmlParser {
    public static async parse(filePath: string): Promise<{
        slides: Array<{
            slideNumber: number;
            widthPx: number;
            heightPx: number;
            backgroundColor: string;
            elements: ParsedElement[];
        }>;
        totalSlides: number;
    }> {
        const buffer = await fs.promises.readFile(filePath);
        const zip = await JSZip.loadAsync(buffer);

        const size = await this.getSlideSize(zip);
        const slidePaths = await this.getOrderedSlidePaths(zip);

        const slides: Array<{
            slideNumber: number;
            widthPx: number;
            heightPx: number;
            backgroundColor: string;
            elements: ParsedElement[];
        }> = [];

        for (let i = 0; i < slidePaths.length; i++) {
            const parsed = await this.parseSingleSlide(zip, slidePaths[i], i + 1, size);
            slides.push(parsed);
        }

        return {
            slides,
            totalSlides: slides.length
        };
    }

    private static async parseSingleSlide(
        zip: JSZip,
        slidePath: string,
        slideNumber: number,
        size: { widthPx: number; heightPx: number }
    ): Promise<{
        slideNumber: number;
        widthPx: number;
        heightPx: number;
        backgroundColor: string;
        elements: ParsedElement[];
    }> {
        const slideXml = await this.readZipText(zip, slidePath);
        const slideRels = await this.getRelationships(zip, slidePath);

        const layoutPath = slideRels.find((r) => r.type.includes('/slideLayout'))?.target;
        const layoutXml = layoutPath ? await this.readZipText(zip, layoutPath) : '';
        const layoutRels = layoutPath ? await this.getRelationships(zip, layoutPath) : [];

        const masterPath = layoutRels.find((r) => r.type.includes('/slideMaster'))?.target;
        const masterXml = masterPath ? await this.readZipText(zip, masterPath) : '';
        const masterRels = masterPath ? await this.getRelationships(zip, masterPath) : [];

        const themePath = masterRels.find((r) => r.type.includes('/theme'))?.target;
        const themeXml = themePath ? await this.readZipText(zip, themePath) : '';
        const theme = this.parseTheme(themeXml);
        const colorCtx = this.buildColorContext(theme, masterXml, layoutXml, slideXml);

        const backgroundColor =
            this.extractBackgroundColor(slideXml, colorCtx)
            || this.extractBackgroundColor(layoutXml, colorCtx)
            || this.extractBackgroundColor(masterXml, colorCtx)
            || '#ffffff';

        const masterElements = await this.extractElementsFromPart(zip, masterXml, masterRels, colorCtx, 1);
        const layoutElements = await this.extractElementsFromPart(zip, layoutXml, layoutRels, colorCtx, 2);
        const slideElements = await this.extractElementsFromPart(zip, slideXml, slideRels, colorCtx, 3);

        const merged = this.mergeWithPlaceholderInheritance([
            ...masterElements,
            ...layoutElements,
            ...slideElements
        ]);

        return {
            slideNumber,
            widthPx: size.widthPx,
            heightPx: size.heightPx,
            backgroundColor,
            elements: merged
        };
    }

    private static mergeWithPlaceholderInheritance(elements: ParsedElement[]): ParsedElement[] {
        const placeholders = new Map<string, ParsedElement>();
        const others: ParsedElement[] = [];

        const sorted = [...elements].sort((a, b) => {
            if (a.sourcePriority !== b.sourcePriority) {
                return a.sourcePriority - b.sourcePriority;
            }
            return a.zIndex - b.zIndex;
        });

        for (const element of sorted) {
            if (!element.placeholderKey) {
                others.push(element);
                continue;
            }

            const prev = placeholders.get(element.placeholderKey);
            if (!prev) {
                placeholders.set(element.placeholderKey, element);
                continue;
            }

            placeholders.set(element.placeholderKey, this.mergePlaceholderElement(prev, element));
        }

        const merged = [...others, ...Array.from(placeholders.values())]
            .filter((element) => !element.hiddenPromptText);
        merged.sort((a, b) => {
            if (a.sourcePriority !== b.sourcePriority) {
                return a.sourcePriority - b.sourcePriority;
            }
            return a.zIndex - b.zIndex;
        });

        return merged.map((el, idx) => ({ ...el, zIndex: idx }));
    }

    private static mergePlaceholderElement(base: ParsedElement, incoming: ParsedElement): ParsedElement {
        const incomingHasGeometry = this.hasValidGeometry(incoming);
        const baseHasGeometry = this.hasValidGeometry(base);
        const mergedParagraphs = incoming.paragraphs && incoming.paragraphs.length > 0
            ? this.mergeParagraphStyles(base.paragraphs, incoming.paragraphs)
            : base.paragraphs;
        const incomingHasVisibleParagraphs = !!(incoming.paragraphs && incoming.paragraphs.length > 0 && !incoming.hiddenPromptText);

        return {
            ...base,
            ...incoming,
            x: incomingHasGeometry ? incoming.x : base.x,
            y: incomingHasGeometry ? incoming.y : base.y,
            width: incomingHasGeometry ? incoming.width : base.width,
            height: incomingHasGeometry ? incoming.height : base.height,
            rotateDeg: incomingHasGeometry ? incoming.rotateDeg : base.rotateDeg,
            hasGeometry: incomingHasGeometry || baseHasGeometry || !!incoming.hasGeometry || !!base.hasGeometry,
            paragraphs: mergedParagraphs,
            src: incoming.src || base.src,
            tableRows: incoming.tableRows && incoming.tableRows.length > 0 ? incoming.tableRows : base.tableRows,
            chartKind: incoming.chartKind || base.chartKind,
            chartTitle: incoming.chartTitle || base.chartTitle,
            fillColor: incoming.fillColor || base.fillColor,
            borderColor: incoming.borderColor || base.borderColor,
            isTitle: incoming.isTitle || base.isTitle,
            hiddenPromptText: incomingHasVisibleParagraphs ? false : !!(incoming.hiddenPromptText ?? base.hiddenPromptText)
        };
    }

    private static hasValidGeometry(el: ParsedElement): boolean {
        return Number.isFinite(el.width) && Number.isFinite(el.height) && el.width > 0 && el.height > 0;
    }

    private static mergeParagraphStyles(
        baseParagraphs: ParsedElement['paragraphs'],
        incomingParagraphs: ParsedElement['paragraphs']
    ): ParsedElement['paragraphs'] {
        if (!incomingParagraphs || incomingParagraphs.length === 0) {
            return baseParagraphs;
        }
        if (!baseParagraphs || baseParagraphs.length === 0) {
            return incomingParagraphs;
        }

        return incomingParagraphs.map((paragraph, index) => {
            const fallback = baseParagraphs[index]
                || baseParagraphs.find((candidate) => candidate.level === paragraph.level)
                || baseParagraphs[0];
            if (!fallback) {
                return paragraph;
            }

            const incomingRuns = Array.isArray(paragraph.runs) ? paragraph.runs : [];
            const fallbackRuns = Array.isArray(fallback.runs) ? fallback.runs : [];
            const mergedRuns = incomingRuns.length > 0
                ? incomingRuns.map((run, runIndex) => {
                    const fallbackRun = fallbackRuns[runIndex] || fallbackRuns[0];
                    return {
                        ...fallbackRun,
                        ...run,
                        fontSizePx: run.fontSizePx || fallbackRun?.fontSizePx,
                        bold: run.bold ?? fallbackRun?.bold,
                        italic: run.italic ?? fallbackRun?.italic,
                        color: run.color || fallbackRun?.color
                    };
                })
                : fallbackRuns;

            return {
                ...fallback,
                ...paragraph,
                text: paragraph.text,
                level: Number.isFinite(paragraph.level) ? paragraph.level : fallback.level,
                bullet: paragraph.bullet ?? fallback.bullet,
                align: paragraph.align || fallback.align,
                fontSizePx: paragraph.fontSizePx || fallback.fontSizePx,
                bold: paragraph.bold ?? fallback.bold,
                italic: paragraph.italic ?? fallback.italic,
                color: paragraph.color || fallback.color,
                runs: mergedRuns.length > 0 ? mergedRuns : undefined
            };
        });
    }

    private static async extractElementsFromPart(
        zip: JSZip,
        partXml: string,
        rels: Relationship[],
        colors: ColorContext,
        sourcePriority: number
    ): Promise<ParsedElement[]> {
        if (!partXml) {
            return [];
        }

        const tree = this.extractTagBlock(partXml, 'p:spTree');
        if (!tree) {
            return [];
        }

        const result: ParsedElement[] = [];
        await this.collectBlocks(zip, tree, rels, colors, sourcePriority, ZERO_TX, result, { value: 0 });
        return result;
    }

    private static async collectBlocks(
        zip: JSZip,
        xml: string,
        rels: Relationship[],
        colors: ColorContext,
        sourcePriority: number,
        parentTx: Transform,
        out: ParsedElement[],
        zCounter: { value: number }
    ): Promise<void> {
        const tagNames = ['p:sp', 'p:pic', 'p:graphicFrame', 'p:grpSp', 'p:cxnSp'];
        let cursor = 0;

        while (cursor < xml.length) {
            let nextIdx = -1;
            let foundTag = '';

            for (const tag of tagNames) {
                const idx = this.findNextTagIndex(xml, tag, cursor);
                if (idx !== -1 && (nextIdx === -1 || idx < nextIdx)) {
                    nextIdx = idx;
                    foundTag = tag;
                }
            }

            if (nextIdx === -1) {
                break;
            }

            const block = this.extractBalancedTag(xml, foundTag, nextIdx);
            if (!block) {
                cursor = nextIdx + foundTag.length;
                continue;
            }

            if (foundTag === 'p:grpSp') {
                const grpTx = this.combineTransforms(parentTx, this.parseGroupTransform(block.content));
                await this.collectBlocks(zip, block.innerContent, rels, colors, sourcePriority, grpTx, out, zCounter);
            } else if (foundTag === 'p:sp' || foundTag === 'p:cxnSp') {
                const element = this.parseShapeBlock(block.content, colors, sourcePriority, parentTx, zCounter.value);
                if (element) {
                    out.push(element);
                    zCounter.value += 1;
                }
            } else if (foundTag === 'p:pic') {
                const element = await this.parsePictureBlock(zip, block.content, rels, sourcePriority, parentTx, zCounter.value);
                if (element) {
                    out.push(element);
                    zCounter.value += 1;
                }
            } else if (foundTag === 'p:graphicFrame') {
                const element = await this.parseGraphicFrameBlock(zip, block.content, rels, colors, sourcePriority, parentTx, zCounter.value);
                if (element) {
                    out.push(element);
                    zCounter.value += 1;
                }
            }

            cursor = block.end;
        }
    }

    private static findNextTagIndex(xml: string, tag: string, from: number): number {
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`<${escaped}(?=[\\s>/])`, 'g');
        re.lastIndex = from;
        const m = re.exec(xml);
        return m ? m.index : -1;
    }

    private static parseShapeBlock(
        shapeXml: string,
        colors: ColorContext,
        sourcePriority: number,
        parentTx: Transform,
        zIndex: number
    ): ParsedElement | null {
        const placeholderType = this.getPlaceholderType(shapeXml);
        // Footer/date/slide-number placeholders in master/layout should not render unless slide overrides them.
        if (sourcePriority < 3 && (placeholderType === 'dt' || placeholderType === 'ftr' || placeholderType === 'sldnum')) {
            return null;
        }

        const localGeom = this.parseGeometry(shapeXml);
        const geom = localGeom ? this.applyTransform(localGeom, parentTx) : null;

        const placeholderKey = this.getPlaceholderKey(shapeXml);
        const isTitle = this.isTitleShape(shapeXml);
        const paragraphs = this.extractTextParagraphs(shapeXml, colors);
        if (paragraphs.length > 0 && sourcePriority < 3) {
            const hasOnlyPromptText = paragraphs.every((p) => this.isPlaceholderPromptText(p.text));
            if (hasOnlyPromptText) {
                if (placeholderKey && geom) {
                    return {
                        type: 'text',
                        x: geom.x,
                        y: geom.y,
                        width: geom.width,
                        height: geom.height,
                        rotateDeg: geom.rotateDeg,
                        zIndex,
                        sourcePriority,
                        placeholderKey,
                        hasGeometry: true,
                        paragraphs,
                        hiddenPromptText: true
                    };
                }
                return null;
            }
        }

        const fillColor = this.extractFillColor(shapeXml, colors);
        const borderColor = this.extractLineColor(shapeXml, colors);

        if (paragraphs.length > 0) {
            return {
                type: 'text',
                x: geom ? geom.x : 0,
                y: geom ? geom.y : 0,
                width: geom ? geom.width : 0,
                height: geom ? geom.height : 0,
                rotateDeg: geom?.rotateDeg,
                zIndex,
                sourcePriority,
                placeholderKey,
                isTitle,
                paragraphs,
                fillColor,
                borderColor,
                hasGeometry: !!geom
            };
        }

        // Keep non-text shape so layout boxes/background elements are still visible.
        if (fillColor || borderColor) {
            return {
                type: 'shape',
                x: geom ? geom.x : 0,
                y: geom ? geom.y : 0,
                width: geom ? geom.width : 0,
                height: geom ? geom.height : 0,
                rotateDeg: geom?.rotateDeg,
                zIndex,
                sourcePriority,
                placeholderKey,
                fillColor,
                borderColor,
                hasGeometry: !!geom
            };
        }

        return null;
    }

    private static async parsePictureBlock(
        zip: JSZip,
        picXml: string,
        rels: Relationship[],
        sourcePriority: number,
        parentTx: Transform,
        zIndex: number
    ): Promise<ParsedElement | null> {
        const localGeom = this.parseGeometry(picXml);
        const geom = localGeom ? this.applyTransform(localGeom, parentTx) : null;
        const placeholderKey = this.getPlaceholderKey(picXml);
        const picName = picXml.match(/<p:cNvPr[^>]*name="([^"]+)"/)?.[1] || '';

        if (sourcePriority < 3 && !placeholderKey && /placeholder/i.test(picName)) {
            return null;
        }

        const embedId = picXml.match(/<a:blip[^>]*r:embed="([^"]+)"/)?.[1];
        if (!embedId) {
            if (!geom && !placeholderKey) {
                return null;
            }
            return {
                type: 'shape',
                x: geom ? geom.x : 0,
                y: geom ? geom.y : 0,
                width: geom ? geom.width : 0,
                height: geom ? geom.height : 0,
                rotateDeg: geom?.rotateDeg,
                zIndex,
                sourcePriority,
                placeholderKey,
                hasGeometry: !!geom
            };
        }

        const target = rels.find((r) => r.id === embedId)?.target;
        if (!target) {
            return geom || placeholderKey ? {
                type: 'shape',
                x: geom ? geom.x : 0,
                y: geom ? geom.y : 0,
                width: geom ? geom.width : 0,
                height: geom ? geom.height : 0,
                rotateDeg: geom?.rotateDeg,
                zIndex,
                sourcePriority,
                placeholderKey,
                hasGeometry: !!geom
            } : null;
        }

        const selectedTarget = this.resolveImageTarget(zip, target);
        const media = zip.file(selectedTarget);
        if (!media) {
            return null;
        }

        const base64 = await media.async('base64');
        const mime = this.getMimeTypeByExtension(selectedTarget);
        const sourceExt = path.extname(target).toLowerCase();
        const selectedExt = path.extname(selectedTarget).toLowerCase();
        const vectorFallback = (sourceExt === '.emf' || sourceExt === '.wmf')
            && selectedTarget !== target
            && (selectedExt === '.png' || selectedExt === '.jpg' || selectedExt === '.jpeg' || selectedExt === '.webp' || selectedExt === '.gif');

        return {
            type: 'image',
            x: geom ? geom.x : 0,
            y: geom ? geom.y : 0,
            width: geom ? geom.width : 0,
            height: geom ? geom.height : 0,
            rotateDeg: geom?.rotateDeg,
            zIndex,
            sourcePriority,
            placeholderKey,
            src: `data:${mime};base64,${base64}`,
            vectorFallback,
            hasGeometry: !!geom
        };
    }

    private static async parseGraphicFrameBlock(
        zip: JSZip,
        frameXml: string,
        rels: Relationship[],
        colors: ColorContext,
        sourcePriority: number,
        parentTx: Transform,
        zIndex: number
    ): Promise<ParsedElement | null> {
        const localGeom = this.parseGeometry(frameXml);
        if (!localGeom) {
            return null;
        }
        const geom = this.applyTransform(localGeom, parentTx);

        const uri = frameXml.match(/<a:graphicData[^>]*uri="([^"]+)"/)?.[1] || '';

        if (uri.includes('/table')) {
            const tableRows = this.extractTableRows(frameXml);
            if (tableRows.length === 0) {
                return null;
            }
            return {
                type: 'table',
                x: geom.x,
                y: geom.y,
                width: geom.width,
                height: geom.height,
                rotateDeg: geom.rotateDeg,
                zIndex,
                sourcePriority,
                placeholderKey: this.getPlaceholderKey(frameXml),
                tableRows
            };
        }

        if (uri.includes('/chart')) {
            const chartRelId = frameXml.match(/<c:chart[^>]*r:id="([^"]+)"/)?.[1] || '';
            let chartTitle = 'Chart';
            let chartData: ParsedElement['chartData'] | undefined;
            if (chartRelId) {
                const chartTarget = rels.find((r) => r.id === chartRelId)?.target;
                if (chartTarget) {
                    const chartXml = await this.readZipText(zip, chartTarget);
                    const chartText = chartXml.match(/<c:title[\s\S]*?<a:t(?=[\s>])[^>]*>([\s\S]*?)<\/a:t>/)?.[1];
                    if (chartText) {
                        chartTitle = this.decodeXmlEntities(chartText);
                    }
                    chartData = this.parseChartData(chartXml, colors);
                }
            }
            return {
                type: 'chart',
                x: geom.x,
                y: geom.y,
                width: geom.width,
                height: geom.height,
                rotateDeg: geom.rotateDeg,
                zIndex,
                sourcePriority,
                placeholderKey: this.getPlaceholderKey(frameXml),
                chartKind: 'chart',
                chartTitle,
                chartData
            };
        }

        if (uri.includes('/diagram')) {
            return {
                type: 'chart',
                x: geom.x,
                y: geom.y,
                width: geom.width,
                height: geom.height,
                rotateDeg: geom.rotateDeg,
                zIndex,
                sourcePriority,
                placeholderKey: this.getPlaceholderKey(frameXml),
                chartKind: 'smartart',
                chartTitle: 'SmartArt'
            };
        }

        // Other embedded objects fallback as shape frame
        return {
            type: 'shape',
            x: geom.x,
            y: geom.y,
            width: geom.width,
            height: geom.height,
            rotateDeg: geom.rotateDeg,
            zIndex,
            sourcePriority,
            placeholderKey: this.getPlaceholderKey(frameXml),
            fillColor: '#f7f7f7',
            borderColor: '#c9c9c9'
        };
    }

    private static extractTableRows(xml: string): string[][] {
        const rows: string[][] = [];
        const trMatches = xml.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) || [];
        for (const tr of trMatches) {
            const row: string[] = [];
            const tcMatches = tr.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) || [];
            for (const tc of tcMatches) {
                const texts: string[] = [];
                const tMatches = tc.match(/<a:t(?=[\s>])[^>]*>([\s\S]*?)<\/a:t>/g) || [];
                for (const t of tMatches) {
                    const value = t.match(/<a:t(?=[\s>])[^>]*>([\s\S]*?)<\/a:t>/)?.[1] || '';
                    if (value) texts.push(this.decodeXmlEntities(value));
                }
                row.push(texts.join(' ').trim());
            }
            if (row.length > 0) rows.push(row);
        }
        return rows;
    }

    private static extractTextParagraphs(shapeXml: string, colors: ColorContext): Array<{
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
    }> {
        const paragraphs: Array<{
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
        }> = [];

        const txBody = this.extractTagBlock(shapeXml, 'p:txBody') || shapeXml;
        const lstStyle = this.extractTagBlock(txBody, 'a:lstStyle') || '';
        const bodyPr = this.extractTagBlock(txBody, 'a:bodyPr') || '';
        const pMatches = txBody.match(/<a:p\b[\s\S]*?<\/a:p>/g) || [];
        for (const pXml of pMatches) {
            const textParts: string[] = [];
            const runs: Array<{
                text: string;
                fontSizePx?: number;
                bold?: boolean;
                italic?: boolean;
                color?: string;
            }> = [];
            const runMatches = pXml.match(/<a:r\b[\s\S]*?<\/a:r>|<a:fld\b[\s\S]*?<\/a:fld>|<a:t(?=[\s>])[^>]*>[\s\S]*?<\/a:t>/g) || [];
            let lastRun = '';

            for (const run of runMatches) {
                if (run.startsWith('<a:r') || run.startsWith('<a:fld')) {
                    lastRun = run;
                    const t = run.match(/<a:t(?=[\s>])[^>]*>([\s\S]*?)<\/a:t>/)?.[1];
                    if (t) {
                        const text = this.decodeXmlEntities(t);
                        textParts.push(text);
                        const runRPr = run.match(/<a:rPr[^>]*\/?>/)?.[0] || '';
                        const runSz = Number(this.getAttr(runRPr, 'sz') || 0);
                        runs.push({
                            text,
                            fontSizePx: runSz > 0 ? Math.round((runSz / 100) * 1.333) : undefined,
                            bold: this.parseOptionalBoolAttr(runRPr, 'b'),
                            italic: this.parseOptionalBoolAttr(runRPr, 'i'),
                            color: this.extractColorFromXml(runRPr + run, colors)
                        });
                    }
                } else {
                    const t = run.match(/<a:t(?=[\s>])[^>]*>([\s\S]*?)<\/a:t>/)?.[1];
                    if (t) {
                        const text = this.decodeXmlEntities(t);
                        textParts.push(text);
                        runs.push({ text });
                    }
                }
            }

            const text = textParts.join('').trim();
            if (!text) continue;

            const inlinePPr = pXml.match(/<a:pPr[^>]*\/?>/)?.[0] || '';
            const inlineLevel = Number(this.getAttr(inlinePPr, 'lvl') || 0);
            const level = Number.isFinite(inlineLevel) ? inlineLevel : 0;
            const levelStyle = this.extractParagraphLevelStyle(lstStyle, level);
            const levelPPr = levelStyle.match(/<a:lvl\d+pPr[^>]*>/)?.[0] || '';
            const pPr = inlinePPr || levelPPr;
            const levelRPr = levelStyle.match(/<a:defRPr[^>]*\/?>/)?.[0] || '';
            const bodyDefaultRPr = txBody.match(/<a:defRPr[^>]*\/?>/)?.[0]
                || bodyPr.match(/<a:defRPr[^>]*\/?>/)?.[0]
                || '';
            const rPr = lastRun.match(/<a:rPr[^>]*\/?>/)?.[0]
                || pXml.match(/<a:defRPr[^>]*\/?>/)?.[0]
                || levelRPr
                || bodyDefaultRPr
                || '';

            const align = this.getAttr(pPr, 'algn') || undefined;
            const size = Number(this.getAttr(rPr, 'sz') || 0);
            const color = this.extractColorFromXml(rPr, colors);
            const hasBullet = /<a:buChar\b|<a:buAutoNum\b|<a:buBlip\b/.test(pXml) || /<a:buChar\b|<a:buAutoNum\b|<a:buBlip\b/.test(levelStyle);
            const hasBuNone = /<a:buNone\b/.test(pXml) || /<a:buNone\b/.test(levelStyle);

            paragraphs.push({
                text,
                level: Number.isFinite(level) ? level : 0,
                bullet: hasBullet && !hasBuNone,
                align,
                fontSizePx: size > 0 ? Math.round((size / 100) * 1.333) : undefined,
                bold: this.parseOptionalBoolAttr(rPr, 'b'),
                italic: this.parseOptionalBoolAttr(rPr, 'i'),
                color,
                runs: runs.length > 0 ? runs : undefined
            });
        }

        return paragraphs;
    }

    private static parseGeometry(xml: string): { x: number; y: number; width: number; height: number; rotateDeg?: number } | null {
        const xfrm = this.extractTagBlock(xml, 'a:xfrm') || this.extractTagBlock(xml, 'p:xfrm');
        if (!xfrm) return null;

        const off = xfrm.match(/<a:off[^>]*\/>/)?.[0] || '';
        const ext = xfrm.match(/<a:ext[^>]*\/>/)?.[0] || '';

        const x = Number(this.getAttr(off, 'x') || 0);
        const y = Number(this.getAttr(off, 'y') || 0);
        const cx = Number(this.getAttr(ext, 'cx') || 0);
        const cy = Number(this.getAttr(ext, 'cy') || 0);
        if (!cx || !cy) return null;

        const rotRaw = Number(this.getAttr(xfrm, 'rot') || 0);

        return {
            x: this.emuToPx(x),
            y: this.emuToPx(y),
            width: this.emuToPx(cx),
            height: this.emuToPx(cy),
            rotateDeg: rotRaw ? rotRaw / 60000 : undefined
        };
    }

    private static parseGroupTransform(xml: string): Transform {
        const grpPr = this.extractTagBlock(xml, 'p:grpSpPr');
        const xfrm = grpPr ? this.extractTagBlock(grpPr, 'a:xfrm') : '';
        if (!xfrm) {
            return ZERO_TX;
        }

        const off = xfrm.match(/<a:off[^>]*\/>/)?.[0] || '';
        const ext = xfrm.match(/<a:ext[^>]*\/>/)?.[0] || '';
        const chOff = xfrm.match(/<a:chOff[^>]*\/>/)?.[0] || '';
        const chExt = xfrm.match(/<a:chExt[^>]*\/>/)?.[0] || '';

        const offX = Number(this.getAttr(off, 'x') || 0);
        const offY = Number(this.getAttr(off, 'y') || 0);
        const extX = Number(this.getAttr(ext, 'cx') || 1);
        const extY = Number(this.getAttr(ext, 'cy') || 1);
        const chOffX = Number(this.getAttr(chOff, 'x') || 0);
        const chOffY = Number(this.getAttr(chOff, 'y') || 0);
        const chExtX = Number(this.getAttr(chExt, 'cx') || extX || 1);
        const chExtY = Number(this.getAttr(chExt, 'cy') || extY || 1);

        const sx = extX / (chExtX || 1);
        const sy = extY / (chExtY || 1);
        const rotRaw = Number(this.getAttr(xfrm, 'rot') || 0);

        return {
            offX: this.emuToPx(offX - chOffX * sx),
            offY: this.emuToPx(offY - chOffY * sy),
            scaleX: sx,
            scaleY: sy,
            rotDeg: rotRaw ? rotRaw / 60000 : 0
        };
    }

    private static combineTransforms(parent: Transform, child: Transform): Transform {
        return {
            offX: parent.offX + child.offX * parent.scaleX,
            offY: parent.offY + child.offY * parent.scaleY,
            scaleX: parent.scaleX * child.scaleX,
            scaleY: parent.scaleY * child.scaleY,
            rotDeg: (parent.rotDeg || 0) + (child.rotDeg || 0)
        };
    }

    private static applyTransform(
        geom: { x: number; y: number; width: number; height: number; rotateDeg?: number },
        tx: Transform
    ): { x: number; y: number; width: number; height: number; rotateDeg?: number } {
        return {
            x: Math.round(tx.offX + geom.x * tx.scaleX),
            y: Math.round(tx.offY + geom.y * tx.scaleY),
            width: Math.round(geom.width * tx.scaleX),
            height: Math.round(geom.height * tx.scaleY),
            rotateDeg: (geom.rotateDeg || 0) + (tx.rotDeg || 0)
        };
    }

    private static parseTheme(themeXml: string): ThemeInfo {
        const colors: Record<string, string> = {
            lt1: '#ffffff',
            dk1: '#000000',
            lt2: '#eeeeee',
            dk2: '#222222',
            accent1: '#4472c4',
            accent2: '#ed7d31',
            accent3: '#a5a5a5',
            accent4: '#ffc000',
            accent5: '#5b9bd5',
            accent6: '#70ad47'
        };

        if (!themeXml) return { colors };

        const clrScheme = this.extractTagBlock(themeXml, 'a:clrScheme') || '';
        const keys = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
        for (const key of keys) {
            const block = this.extractTagBlock(clrScheme, `a:${key}`) || '';
            const srgb = block.match(/<a:srgbClr[^>]*val="([^"]+)"/)?.[1];
            const sys = block.match(/<a:sysClr[^>]*lastClr="([^"]+)"/)?.[1];
            if (srgb) colors[key] = `#${srgb}`;
            else if (sys) colors[key] = `#${sys}`;
        }

        return { colors };
    }

    private static extractBackgroundColor(xml: string, colors: ColorContext): string | undefined {
        if (!xml) return undefined;
        const bgPr = this.extractTagBlock(xml, 'p:bgPr') || '';
        if (!bgPr) return undefined;
        const solid = this.extractColorFromXml(bgPr, colors);
        if (solid) return solid;

        const gradFill = this.extractTagBlock(bgPr, 'a:gradFill') || '';
        if (gradFill) {
            const stops = gradFill.match(/<a:gs\b[\s\S]*?<\/a:gs>/g) || [];
            const lastStop = stops[stops.length - 1] || gradFill;
            return this.extractColorFromXml(lastStop, colors);
        }

        return undefined;
    }

    private static extractFillColor(xml: string, colors: ColorContext): string | undefined {
        const spPr = this.extractTagBlock(xml, 'p:spPr') || xml;
        const solid = this.extractTagBlock(spPr, 'a:solidFill') || '';
        const solidColor = this.extractColorFromXml(solid, colors);
        if (solidColor) return solidColor;

        const gradFill = this.extractTagBlock(spPr, 'a:gradFill') || '';
        if (gradFill) {
            const stops = gradFill.match(/<a:gs\b[\s\S]*?<\/a:gs>/g) || [];
            const firstStop = stops[0] || gradFill;
            const lastStop = stops[stops.length - 1] || gradFill;
            return this.extractColorFromXml(firstStop, colors) || this.extractColorFromXml(lastStop, colors);
        }

        const style = this.extractTagBlock(xml, 'p:style') || '';
        const fillRef = this.extractTagBlock(style, 'a:fillRef') || '';
        return this.extractColorFromXml(fillRef, colors);
    }

    private static extractLineColor(xml: string, colors: ColorContext): string | undefined {
        const spPr = this.extractTagBlock(xml, 'p:spPr') || xml;
        const ln = this.extractTagBlock(spPr, 'a:ln') || '';
        return this.extractColorFromXml(ln, colors);
    }

    private static extractColorFromXml(xml: string, colors: ColorContext): string | undefined {
        if (!xml) return undefined;
        const srgbNode = xml.match(/<a:srgbClr[^>]*val="([^"]+)"[^>]*\/>|<a:srgbClr[^>]*val="([^"]+)"[^>]*>[\s\S]*?<\/a:srgbClr>/);
        if (srgbNode) {
            const raw = srgbNode[1] || srgbNode[2];
            const base = raw ? `#${raw}` : undefined;
            if (base) return this.applyColorTransforms(base, srgbNode[0]);
        }

        const sysNode = xml.match(/<a:sysClr[^>]*lastClr="([^"]+)"[^>]*\/>|<a:sysClr[^>]*lastClr="([^"]+)"[^>]*>[\s\S]*?<\/a:sysClr>/);
        if (sysNode) {
            const raw = sysNode[1] || sysNode[2];
            const base = raw ? `#${raw}` : undefined;
            if (base) return this.applyColorTransforms(base, sysNode[0]);
        }

        const presetNode = xml.match(/<a:prstClr[^>]*val="([^"]+)"[^>]*\/>|<a:prstClr[^>]*val="([^"]+)"[^>]*>[\s\S]*?<\/a:prstClr>/);
        if (presetNode) {
            const preset = presetNode[1] || presetNode[2];
            const presetColor = preset ? this.mapPresetColorName(preset) : undefined;
            if (presetColor) return this.applyColorTransforms(presetColor, presetNode[0]);
        }

        const schemeNode = xml.match(/<a:schemeClr[^>]*val="([^"]+)"[^>]*\/>|<a:schemeClr[^>]*val="([^"]+)"[^>]*>[\s\S]*?<\/a:schemeClr>/);
        if (schemeNode) {
            const scheme = ((schemeNode[1] || schemeNode[2]) || '').trim();
            if (scheme) {
                let base = colors.themeColors[scheme];
                if (!base) {
                    const mapped = colors.clrMap[scheme];
                    if (mapped) base = colors.themeColors[mapped];
                }
                if (base) return this.applyColorTransforms(base, schemeNode[0]);
            }
        }
        return undefined;
    }

    private static isTitleShape(xml: string): boolean {
        const phType = xml.match(/<p:ph[^>]*type="([^"]+)"/)?.[1] || '';
        if (phType === 'title' || phType === 'ctrTitle') return true;
        const name = xml.match(/<p:cNvPr[^>]*name="([^"]+)"/)?.[1] || '';
        // Avoid treating subtitle placeholders as title.
        if (/subtitle/i.test(name)) return false;
        return /^title\b/i.test(name) || /title placeholder/i.test(name);
    }

    private static getPlaceholderKey(xml: string): string | undefined {
        const ph = xml.match(/<p:ph[^>]*\/>/)?.[0] || xml.match(/<p:ph[^>]*>/)?.[0] || '';
        if (!ph) return undefined;
        const rawIdx = this.getAttr(ph, 'idx') || '0';
        const idx = (rawIdx && rawIdx !== '0' && rawIdx !== '4294967295') ? rawIdx : undefined;
        const type = (this.getAttr(ph, 'type') || 'body').toLowerCase();
        const normalizedType = this.normalizePlaceholderType(type);
        if (normalizedType === 'title' || normalizedType === 'body' || normalizedType === 'sldnum' || normalizedType === 'ftr' || normalizedType === 'dt') {
            return `type:${normalizedType}`;
        }
        if (idx) {
            return `idx:${idx}`;
        }
        return `type:${normalizedType}`;
    }

    private static normalizePlaceholderType(type: string): string {
        if (type === 'title' || type === 'ctrtitle') return 'title';
        if (type === 'subtitle' || type === 'subTitle'.toLowerCase()) return 'body';
        if (type === 'sldnum') return 'sldnum';
        if (type === 'body' || type === 'obj' || type === 'content') return 'body';
        return type;
    }

    private static getPlaceholderType(xml: string): string | undefined {
        const ph = xml.match(/<p:ph[^>]*\/>/)?.[0] || xml.match(/<p:ph[^>]*>/)?.[0] || '';
        if (!ph) return undefined;
        const type = (this.getAttr(ph, 'type') || '').toLowerCase();
        return type || undefined;
    }

    private static async getSlideSize(zip: JSZip): Promise<{ widthPx: number; heightPx: number }> {
        const presentation = await this.readZipText(zip, 'ppt/presentation.xml');
        const szTag = presentation.match(/<p:sldSz[^>]*\/>/)?.[0] || '';
        const cx = Number(this.getAttr(szTag, 'cx') || 0);
        const cy = Number(this.getAttr(szTag, 'cy') || 0);

        if (!cx || !cy) return { widthPx: 1280, heightPx: 720 };

        const widthPx = this.emuToPx(cx);
        const heightPx = this.emuToPx(cy);
        if (widthPx < 300 || heightPx < 200) return { widthPx: 1280, heightPx: 720 };
        return { widthPx, heightPx };
    }

    private static async getOrderedSlidePaths(zip: JSZip): Promise<string[]> {
        const presentationXml = await this.readZipText(zip, 'ppt/presentation.xml');
        const rels = await this.getRelationships(zip, 'ppt/presentation.xml');

        const relMap = new Map<string, string>();
        rels.forEach((r) => relMap.set(r.id, r.target));

        const ordered: string[] = [];
        const idMatches = presentationXml.match(/<p:sldId[^>]*r:id="([^"]+)"[^>]*\/?/g) || [];
        for (const match of idMatches) {
            const id = match.match(/r:id="([^"]+)"/)?.[1];
            if (!id) continue;
            const target = relMap.get(id);
            if (target && zip.file(target)) ordered.push(target);
        }

        if (ordered.length > 0) return ordered;

        return Object.keys(zip.files)
            .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
            .sort((a, b) => {
                const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
                const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
                return na - nb;
            });
    }

    private static async getRelationships(zip: JSZip, partPath: string): Promise<Relationship[]> {
        const relPath = this.toRelsPath(partPath);
        const relXml = await this.readZipText(zip, relPath);
        if (!relXml) return [];

        const list: Relationship[] = [];
        const re = /<Relationship[^>]*Id="([^"]+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(relXml)) !== null) {
            list.push({
                id: m[1],
                type: m[2],
                target: this.resolvePath(partPath, m[3])
            });
        }
        return list;
    }

    private static toRelsPath(partPath: string): string {
        const dir = path.posix.dirname(partPath);
        const base = path.posix.basename(partPath);
        return path.posix.join(dir, '_rels', `${base}.rels`);
    }

    private static resolvePath(basePath: string, target: string): string {
        if (target.startsWith('/')) {
            return target.replace(/^\/+/, '');
        }
        return path.posix.normalize(path.posix.join(path.posix.dirname(basePath), target));
    }

    private static async readZipText(zip: JSZip, zipPath: string): Promise<string> {
        const file = zip.file(zipPath);
        if (!file) return '';
        return await file.async('text');
    }

    private static extractBalancedTag(
        xml: string,
        tag: string,
        startAt: number
    ): { content: string; innerContent: string; end: number } | null {
        const closeToken = `</${tag}>`;
        let pos = startAt;

        const firstOpen = this.findNextTagIndex(xml, tag, pos);
        if (firstOpen !== startAt) return null;

        const firstClose = xml.indexOf('>', firstOpen);
        if (firstClose === -1) return null;

        // Self-closing tag
        const beforeClose = xml.slice(firstOpen, firstClose + 1);
        if (/\/\s*>$/.test(beforeClose)) {
            return {
                content: xml.slice(firstOpen, firstClose + 1),
                innerContent: '',
                end: firstClose + 1
            };
        }

        let depth = 1;
        pos = firstClose + 1;

        while (depth > 0) {
            const nextOpen = this.findNextTagIndex(xml, tag, pos);
            const nextClose = xml.indexOf(closeToken, pos);
            if (nextClose === -1) return null;

            if (nextOpen !== -1 && nextOpen < nextClose) {
                const openEnd = xml.indexOf('>', nextOpen);
                if (openEnd === -1) return null;
                if (xml[openEnd - 1] !== '/') {
                    depth += 1;
                }
                pos = openEnd + 1;
            } else {
                depth -= 1;
                pos = nextClose + closeToken.length;
            }
        }

        return {
            content: xml.slice(firstOpen, pos),
            innerContent: xml.slice(firstClose + 1, pos - closeToken.length),
            end: pos
        };
    }

    private static extractTagBlock(xml: string, tag: string): string {
        const idx = xml.indexOf(`<${tag}`);
        if (idx === -1) return '';
        return this.extractBalancedTag(xml, tag, idx)?.content || '';
    }

    private static getAttr(tag: string, attr: string): string | undefined {
        if (!tag) return undefined;
        const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return tag.match(new RegExp(`${escaped}=(?:"([^"]+)"|'([^']+)')`))?.[1]
            || tag.match(new RegExp(`${escaped}=(?:"([^"]+)"|'([^']+)')`))?.[2];
    }

    private static parseOptionalBoolAttr(tag: string, attr: string): boolean | undefined {
        const raw = this.getAttr(tag, attr);
        if (raw === undefined) return undefined;
        return raw === '1' || raw.toLowerCase() === 'true';
    }

    private static emuToPx(emu: number): number {
        return Math.round(emu / 9525);
    }

    private static decodeXmlEntities(input: string): string {
        return input
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#xD;/gi, '')
            .replace(/&#xA;/gi, ' ')
            .replace(/&#10;/g, ' ');
    }

    private static extractParagraphLevelStyle(lstStyle: string, level: number): string {
        if (!lstStyle) return '';
        const normalizedLevel = Math.max(0, Math.min(8, Number.isFinite(level) ? level : 0)) + 1;
        return this.extractTagBlock(lstStyle, `a:lvl${normalizedLevel}pPr`) || '';
    }

    private static buildColorContext(
        theme: ThemeInfo,
        masterXml: string,
        layoutXml: string,
        slideXml: string
    ): ColorContext {
        const masterMap = this.parseMasterClrMap(masterXml);
        const layoutOverride = this.parseClrMapOverride(layoutXml);
        const slideOverride = this.parseClrMapOverride(slideXml);

        let clrMap = { ...masterMap };
        if (layoutOverride) {
            clrMap = { ...clrMap, ...layoutOverride };
        }
        if (slideOverride) {
            clrMap = { ...clrMap, ...slideOverride };
        }

        return {
            themeColors: theme.colors,
            clrMap
        };
    }

    private static parseMasterClrMap(masterXml: string): Record<string, string> {
        const defaults: Record<string, string> = {
            bg1: 'lt1',
            tx1: 'dk1',
            bg2: 'lt2',
            tx2: 'dk2',
            accent1: 'accent1',
            accent2: 'accent2',
            accent3: 'accent3',
            accent4: 'accent4',
            accent5: 'accent5',
            accent6: 'accent6',
            hlink: 'hlink',
            folHlink: 'folHlink'
        };

        const clrMapTag = masterXml.match(/<p:clrMap\b[^>]*\/>/)?.[0] || '';
        if (!clrMapTag) {
            return defaults;
        }

        const keys = Object.keys(defaults);
        const parsed: Record<string, string> = { ...defaults };
        keys.forEach((key) => {
            const value = this.getAttr(clrMapTag, key);
            if (value) parsed[key] = value;
        });
        return parsed;
    }

    private static parseClrMapOverride(xml: string): Record<string, string> | null {
        if (!xml) return null;
        const clrMapOvr = this.extractTagBlock(xml, 'p:clrMapOvr') || '';
        if (!clrMapOvr) return null;
        if (clrMapOvr.includes('<a:masterClrMapping')) {
            return null;
        }

        const overrideTag = clrMapOvr.match(/<a:overrideClrMapping\b[^>]*\/>/)?.[0] || '';
        if (!overrideTag) return null;

        const keys = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
        const parsed: Record<string, string> = {};
        keys.forEach((key) => {
            const value = this.getAttr(overrideTag, key);
            if (value) parsed[key] = value;
        });
        return Object.keys(parsed).length > 0 ? parsed : null;
    }

    private static parseChartData(xml: string, colors: ColorContext): ParsedElement['chartData'] | undefined {
        if (!xml) return undefined;
        const barChart = this.extractTagBlock(xml, 'c:barChart');
        if (!barChart) return undefined;

        const grouping = barChart.match(/<c:grouping[^>]*val="([^"]+)"/)?.[1] || '';
        const barDir = barChart.match(/<c:barDir[^>]*val="([^"]+)"/)?.[1] || '';
        if (grouping !== 'stacked' || barDir !== 'col') return undefined;

        const serBlocks = barChart.match(/<c:ser\b[\s\S]*?<\/c:ser>/g) || [];
        if (serBlocks.length === 0) return undefined;

        let categories: string[] = [];
        const series = serBlocks.map((serXml, idx) => {
            const name = this.decodeXmlEntities(
                serXml.match(/<c:tx[\s\S]*?<c:v>([\s\S]*?)<\/c:v>/)?.[1]
                || `Series ${idx + 1}`
            );

            const spPr = this.extractTagBlock(serXml, 'c:spPr') || '';
            const palette = ['#8a8a8a', '#d10000', '#4f81bd', '#9bbb59', '#8064a2', '#f79646'];
            const seriesColor = this.extractColorFromXml(spPr, colors) || palette[idx % palette.length];

            if (categories.length === 0) {
                const categoryPts = serXml.match(/<c:cat[\s\S]*?<\/c:cat>/)?.[0] || '';
                categories = this.extractChartPoints(categoryPts);
            }

            const valuePts = serXml.match(/<c:val[\s\S]*?<\/c:val>/)?.[0] || '';
            const values = this.extractChartNumericPoints(valuePts, categories.length || undefined);
            const dataLabel = this.parseSeriesDataLabel(serXml, colors);
            return {
                name,
                color: seriesColor,
                values,
                dataLabel
            };
        });

        if (categories.length === 0) {
            const maxLen = Math.max(...series.map((s) => s.values.length));
            categories = Array.from({ length: maxLen }, (_, i) => `${i + 1}`);
        }

        const normalizedSeries = series.map((s) => ({
            ...s,
            values: this.padValues(s.values, categories.length)
        }));

        const gapWidth = this.parseNumber(barChart.match(/<c:gapWidth[^>]*val="([^"]+)"/)?.[1]);
        const overlap = this.parseNumber(barChart.match(/<c:overlap[^>]*val="([^"]+)"/)?.[1]);
        const categoryAxis = this.parseCategoryAxis(xml, colors);
        const valueAxis = this.parseValueAxis(xml, colors);
        const legend = this.parseLegend(xml, colors);

        return {
            kind: 'stackedColumn',
            categories,
            series: normalizedSeries,
            gapWidth,
            overlap,
            categoryAxis,
            valueAxis,
            legend
        };
    }

    private static parseSeriesDataLabel(
        serXml: string,
        colors: ColorContext
    ): { showValue?: boolean; numFmt?: string; fontSizePx?: number; color?: string } | undefined {
        const dLbls = this.extractTagBlock(serXml, 'c:dLbls') || '';
        if (!dLbls) return undefined;

        const txPr = this.extractTagBlock(dLbls, 'c:txPr') || '';
        const style = this.parseTxPrStyle(txPr, colors);
        const numFmtRaw = dLbls.match(/<c:numFmt[^>]*formatCode="([^"]+)"/)?.[1];
        const showValRaw = dLbls.match(/<c:showVal[^>]*val="([^"]+)"/)?.[1];
        const numFmt = numFmtRaw ? this.decodeXmlEntities(numFmtRaw) : undefined;
        const showValue = showValRaw === '1' ? true : (showValRaw === '0' ? false : undefined);

        if (showValue === undefined && !numFmt && !style.fontSizePx && !style.color) {
            return undefined;
        }

        return {
            showValue,
            numFmt,
            fontSizePx: style.fontSizePx,
            color: style.color
        };
    }

    private static parseCategoryAxis(
        chartXml: string,
        colors: ColorContext
    ): { numFmt?: string; fontSizePx?: number; color?: string; lineColor?: string } | undefined {
        const catAx = this.extractTagBlock(chartXml, 'c:catAx') || '';
        if (!catAx) return undefined;

        const txPr = this.extractTagBlock(catAx, 'c:txPr') || '';
        const style = this.parseTxPrStyle(txPr, colors);
        const lineColor = this.extractColorFromXml(this.extractTagBlock(catAx, 'c:spPr') || '', colors);
        const numFmtRaw = catAx.match(/<c:numFmt[^>]*formatCode="([^"]+)"/)?.[1];
        const numFmt = numFmtRaw ? this.decodeXmlEntities(numFmtRaw) : undefined;

        return {
            numFmt,
            fontSizePx: style.fontSizePx,
            color: style.color,
            lineColor
        };
    }

    private static parseValueAxis(
        chartXml: string,
        colors: ColorContext
    ): {
        numFmt?: string;
        fontSizePx?: number;
        color?: string;
        lineColor?: string;
        gridColor?: string;
        majorUnit?: number;
        min?: number;
        max?: number;
        crossesAt?: number;
    } | undefined {
        const valAx = this.extractTagBlock(chartXml, 'c:valAx') || '';
        if (!valAx) return undefined;

        const txPr = this.extractTagBlock(valAx, 'c:txPr') || '';
        const style = this.parseTxPrStyle(txPr, colors);
        const lineColor = this.extractColorFromXml(this.extractTagBlock(valAx, 'c:spPr') || '', colors);
        const majorGridColor = this.extractColorFromXml(this.extractTagBlock(valAx, 'c:majorGridlines') || '', colors);
        const numFmtRaw = valAx.match(/<c:numFmt[^>]*formatCode="([^"]+)"/)?.[1];
        const numFmt = numFmtRaw ? this.decodeXmlEntities(numFmtRaw) : undefined;

        const scaling = this.extractTagBlock(valAx, 'c:scaling') || '';
        const min = this.parseNumber(scaling.match(/<c:min[^>]*val="([^"]+)"/)?.[1]);
        const max = this.parseNumber(scaling.match(/<c:max[^>]*val="([^"]+)"/)?.[1]);
        const majorUnit = this.parseNumber(valAx.match(/<c:majorUnit[^>]*val="([^"]+)"/)?.[1]);
        const crossesAt = this.parseNumber(valAx.match(/<c:crossesAt[^>]*val="([^"]+)"/)?.[1]);

        return {
            numFmt,
            fontSizePx: style.fontSizePx,
            color: style.color,
            lineColor,
            gridColor: majorGridColor,
            majorUnit,
            min,
            max,
            crossesAt
        };
    }

    private static parseLegend(
        chartXml: string,
        colors: ColorContext
    ): { position?: string; fontSizePx?: number; color?: string; align?: string } | undefined {
        const legend = this.extractTagBlock(chartXml, 'c:legend') || '';
        if (!legend) return undefined;

        const position = legend.match(/<c:legendPos[^>]*val="([^"]+)"/)?.[1];
        const txPr = this.extractTagBlock(legend, 'c:txPr') || '';
        const style = this.parseTxPrStyle(txPr, colors);

        return {
            position: position || undefined,
            fontSizePx: style.fontSizePx,
            color: style.color,
            align: style.align
        };
    }

    private static parseTxPrStyle(
        txPr: string,
        colors: ColorContext
    ): { fontSizePx?: number; color?: string; align?: string } {
        if (!txPr) return {};
        const pPr = txPr.match(/<a:pPr[^>]*\/?>/)?.[0] || '';
        const defRPr = txPr.match(/<a:defRPr[^>]*\/?>/)?.[0] || '';
        const endRPr = txPr.match(/<a:endParaRPr[^>]*\/?>/)?.[0] || '';
        const fontRaw = Number(this.getAttr(defRPr, 'sz') || this.getAttr(endRPr, 'sz') || 0);
        const color = this.extractColorFromXml(defRPr || txPr, colors);
        return {
            fontSizePx: fontRaw > 0 ? Math.round((fontRaw / 100) * 1.333) : undefined,
            color,
            align: this.getAttr(pPr, 'algn') || undefined
        };
    }

    private static extractChartPoints(xml: string): string[] {
        if (!xml) return [];
        const out: Array<{ idx: number; value: string }> = [];
        const pts = xml.match(/<c:pt\b[\s\S]*?<\/c:pt>/g) || [];
        pts.forEach((pt) => {
            const idx = Number(pt.match(/idx="(\d+)"/)?.[1] || 0);
            const raw = pt.match(/<c:v>([\s\S]*?)<\/c:v>/)?.[1] || '';
            out.push({ idx, value: this.decodeXmlEntities(raw) });
        });
        out.sort((a, b) => a.idx - b.idx);
        return out.map((p) => p.value);
    }

    private static extractChartNumericPoints(xml: string, fallbackLength?: number): number[] {
        const values: number[] = [];
        if (!xml) return fallbackLength ? Array.from({ length: fallbackLength }, () => 0) : values;

        const pts = xml.match(/<c:pt\b[\s\S]*?<\/c:pt>/g) || [];
        pts.forEach((pt) => {
            const idx = Number(pt.match(/idx="(\d+)"/)?.[1] || 0);
            const raw = pt.match(/<c:v>([\s\S]*?)<\/c:v>/)?.[1] || '';
            const n = Number(raw);
            if (!Number.isNaN(n)) {
                values[idx] = n;
            }
        });

        if (fallbackLength && values.length < fallbackLength) {
            for (let i = 0; i < fallbackLength; i++) {
                if (!Number.isFinite(values[i])) values[i] = 0;
            }
        }

        return values.map((v) => (Number.isFinite(v) ? v : 0));
    }

    private static padValues(values: number[], length: number): number[] {
        const out = Array.from({ length }, (_, i) => values[i] || 0);
        return out;
    }

    private static mapPresetColorName(name: string): string | undefined {
        const n = name.toLowerCase();
        if (n === 'black') return '#000000';
        if (n === 'white') return '#ffffff';
        if (n === 'red') return '#ff0000';
        if (n === 'blue') return '#0000ff';
        if (n === 'green') return '#008000';
        if (n === 'gray' || n === 'grey') return '#808080';
        return undefined;
    }

    private static applyColorTransforms(hex: string, xml: string): string {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return hex;

        const shade = Number(xml.match(/<a:shade[^>]*val="(\d+)"/)?.[1] || 100000) / 100000;
        const tint = Number(xml.match(/<a:tint[^>]*val="(\d+)"/)?.[1] || 0) / 100000;
        const lumMod = Number(xml.match(/<a:lumMod[^>]*val="(\d+)"/)?.[1] || 100000) / 100000;
        const lumOff = Number(xml.match(/<a:lumOff[^>]*val="(\d+)"/)?.[1] || 0) / 100000;

        const apply = (value: number): number => {
            let c = value * shade;
            c = c + (255 - c) * tint;
            c = c * lumMod + 255 * lumOff;
            return Math.max(0, Math.min(255, Math.round(c)));
        };

        return this.rgbToHex(apply(rgb.r), apply(rgb.g), apply(rgb.b));
    }

    private static hexToRgb(hex: string): { r: number; g: number; b: number } | null {
        const raw = hex.replace('#', '').trim();
        if (raw.length === 3) {
            const r = parseInt(raw[0] + raw[0], 16);
            const g = parseInt(raw[1] + raw[1], 16);
            const b = parseInt(raw[2] + raw[2], 16);
            if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
            return { r, g, b };
        }
        if (raw.length === 6) {
            const r = parseInt(raw.slice(0, 2), 16);
            const g = parseInt(raw.slice(2, 4), 16);
            const b = parseInt(raw.slice(4, 6), 16);
            if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
            return { r, g, b };
        }
        return null;
    }

    private static rgbToHex(r: number, g: number, b: number): string {
        return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    }

    private static parseNumber(raw: string | undefined): number | undefined {
        if (raw === undefined) return undefined;
        const value = Number(raw);
        return Number.isFinite(value) ? value : undefined;
    }

    private static isPlaceholderPromptText(text: string): boolean {
        const normalized = (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!normalized) return true;
        const promptPatterns = [
            /^click to edit master/i,
            /^click to edit/i,
            /^insert text here$/i,
            /^list (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth) level$/i,
            /^click icon to add picture$/i,
            /^presentation title$/i,
            /^author$/i,
            /^department$/i,
            /^date$/i,
            /^location$/i
        ];
        return promptPatterns.some((re) => re.test(normalized));
    }

    private static resolveImageTarget(zip: JSZip, target: string): string {
        const ext = path.extname(target).toLowerCase();
        if (ext !== '.emf' && ext !== '.wmf') {
            return target;
        }

        const dir = path.posix.dirname(target);
        const base = path.posix.basename(target, ext);
        const exactCandidates = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].map((e) => path.posix.join(dir, `${base}${e}`));
        for (const candidate of exactCandidates) {
            if (zip.file(candidate)) return candidate;
        }

        const anyRaster = Object.keys(zip.files)
            .filter((name) => name.startsWith(`${dir}/`) && /\.(png|jpe?g|webp|gif)$/i.test(name))
            .sort();
        return anyRaster[0] || target;
    }

    private static getMimeTypeByExtension(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const map: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.wmf': 'image/wmf',
            '.emf': 'image/emf'
        };
        return map[ext] || 'application/octet-stream';
    }
}
