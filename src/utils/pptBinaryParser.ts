import * as fs from 'fs';
import type {
    CfbParseResult,
    PptColorScheme,
    PptPictureAsset,
    PptPresentationMetrics,
    PptRecord,
    PptShapeBounds,
    PptSlideLayoutInfo,
    PptSlideModel,
    PptTextBlock,
    PptTextGroup,
    PptVisualSlot
} from './pptBinaryTypes';
import { normalizeBuildSlidesArgs } from './pptBinaryBuildContext';
import { parseCfb as parseCfbContainer, parseRecords as parseRecordTree } from './pptBinaryContainer';

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
    private static readonly POINTS_TO_PX = 96 / 72;

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
        const picturesStream = cfb.getStream('Pictures');
        const pictures = this.extractPictures(picturesStream);
        const picturesById = this.extractPicturesByBlipId(records, picturesStream, pictures);
        const outlineTextByPersistId = this.extractOutlineTextByPersistId(records);
        const defaultColorScheme = this.extractDocumentColorScheme(records);
        const masterRecord = this.collectPrimaryMasterContainer(records);

        const presentationMetrics = this.extractPresentationMetrics(records);
        const widthPx = presentationMetrics?.widthPx ?? 960;
        const heightPx = presentationMetrics?.heightPx ?? 720;
        const slides = this.buildSlides(
            slideRecords,
            pictures,
            outlineTextByPersistId,
            defaultColorScheme,
            masterRecord,
            presentationMetrics,
            widthPx,
            heightPx,
            picturesById
        );

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

    private static extractPresentationMetrics(records: PptRecord[]): {
        widthPx: number;
        heightPx: number;
        rawWidth: number;
        rawHeight: number;
    } | null {
        for (const record of records) {
            if (record.recType === 1000 && record.children && record.children.length > 0) {
                const documentAtom = record.children.find((child) => child.recType === 1001 && child.payload.length >= 8);
                if (!documentAtom) {
                    continue;
                }

                const rawWidth = documentAtom.payload.readUInt32LE(0);
                const rawHeight = documentAtom.payload.readUInt32LE(4);
                const widthPx = this.legacyCoordToPixels(rawWidth);
                const heightPx = this.legacyCoordToPixels(rawHeight);

                if (widthPx && heightPx) {
                    return { widthPx, heightPx, rawWidth, rawHeight };
                }
            }

            if (record.children && record.children.length > 0) {
                const nestedSize = this.extractPresentationMetrics(record.children);
                if (nestedSize) {
                    return nestedSize;
                }
            }
        }

        return null;
    }

    private static legacyCoordToPixels(value: number): number | null {
        if (!Number.isFinite(value) || value <= 0) {
            return null;
        }

        // Many legacy .ppt decks store slide geometry in PowerPoint master units
        // (for example 5760 x 4320 for a 10 x 7.5 inch slide), not points.
        if (value >= 2000) {
            return Math.max(1, Math.round(value / 6));
        }

        return Math.max(1, Math.round(value * this.POINTS_TO_PX));
    }

    private static parseCfb(file: Buffer): CfbParseResult {
        return parseCfbContainer(file);
    }

    private static parseRecords(buffer: Buffer, start: number, end: number): PptRecord[] {
        return parseRecordTree(buffer, start, end);
    }

    private static collectSlideContainers(records: PptRecord[]): PptRecord[] {
        const discoveredSlides: PptRecord[] = [];
        const visit = (list: PptRecord[]) => {
            list.forEach((r) => {
                // RT_Slide (commonly 1006)
                if (r.recType === 1006) {
                    discoveredSlides.push(r);
                }
                if (r.children && r.children.length > 0) {
                    visit(r.children);
                }
            });
        };
        visit(records);

        const orderedPersistRefs = this.extractOrderedSlidePersistRefs(records);
        if (orderedPersistRefs.length === 0) {
            return discoveredSlides;
        }

        const slideByPersistRef = new Map<number, PptRecord>();
        discoveredSlides.forEach((slide) => {
            if (!slideByPersistRef.has(slide.recInstance)) {
                slideByPersistRef.set(slide.recInstance, slide);
            }
        });

        const orderedSlides: PptRecord[] = [];
        const seen = new Set<PptRecord>();
        orderedPersistRefs.forEach((persistRef) => {
            const slide = slideByPersistRef.get(persistRef);
            if (!slide || seen.has(slide)) {
                return;
            }

            seen.add(slide);
            orderedSlides.push(slide);
        });

        return orderedSlides.length > 0 ? orderedSlides : discoveredSlides;
    }

    private static collectPrimaryMasterContainer(records: PptRecord[]): PptRecord | null {
        let found: PptRecord | null = null;
        const visit = (list: PptRecord[]) => {
            for (const record of list) {
                if (record.recType === 1016 && !found) {
                    found = record;
                    return;
                }
                if (record.children && record.children.length > 0) {
                    visit(record.children);
                    if (found) {
                        return;
                    }
                }
            }
        };

        visit(records);
        return found;
    }

    private static extractOrderedSlidePersistRefs(records: PptRecord[]): number[] {
        const refs: number[] = [];

        const visit = (list: PptRecord[]) => {
            list.forEach((record) => {
                if (record.recType === 1000 && record.children && record.children.length > 0) {
                    record.children.forEach((child) => {
                        if (child.recType !== 4080 || !child.children || child.children.length === 0) {
                            return;
                        }

                        child.children.forEach((entry) => {
                            if (entry.recType !== 1011 || entry.payload.length < 4) {
                                return;
                            }

                            refs.push(entry.payload.readUInt32LE(0));
                        });
                    });
                }

                if (record.children && record.children.length > 0) {
                    visit(record.children);
                }
            });
        };

        visit(records);
        return refs.filter((value) => Number.isFinite(value) && value > 0);
    }

    private static buildSlides(
        slideRecords: PptRecord[],
        pictures: PptPictureAsset[],
        outlineTextByPersistId: Map<number, PptTextBlock[]>,
        defaultColorScheme: PptColorScheme | null,
        masterRecordOrPresentationMetrics: PptRecord | {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null,
        presentationMetricsOrWidth: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | number | null,
        widthPxOrHeight: number,
        heightPxOrPicturesById?: number | Map<number, PptPictureAsset>,
        picturesByIdMaybe?: Map<number, PptPictureAsset>
    ): PptSlideModel[] {
        const {
            masterRecord,
            presentationMetrics,
            widthPx,
            heightPx,
            picturesById
        } = normalizeBuildSlidesArgs(
            slideRecords,
            pictures,
            outlineTextByPersistId,
            defaultColorScheme,
            masterRecordOrPresentationMetrics,
            presentationMetricsOrWidth,
            widthPxOrHeight,
            heightPxOrPicturesById,
            picturesByIdMaybe
        );

        const slides: PptSlideModel[] = [];
        let sequentialPictureIndex = 0;
        for (let i = 0; i < slideRecords.length; i++) {
            const slideRecord = slideRecords[i];
            const outlineBlocks = outlineTextByPersistId.get(slideRecord.recInstance) ?? [];
            const colorScheme = this.extractSlideColorScheme(slideRecord) ?? defaultColorScheme;
            const layout = this.extractSlideLayoutInfo(slideRecord);
            const spContainerCounter = { value: 0 };
            const visualSlots = this.decorateVisualSlotsWithPlaceholders(
                this.extractVisualSlotsFromRecord(slideRecord, spContainerCounter),
                layout
            );
            // Reset counter so both extractions share the same DFS index space
            spContainerCounter.value = 0;
            const shapeTextGroups = this.decorateTextGroupsWithPlaceholders(
                this.extractShapeTextGroupsFromRecord(slideRecord, spContainerCounter),
                layout
            );
            const directBlocks = this.extractTypedTextBlocksFromRecord(slideRecord);
            const styledShapeBlocks = this.extractStyledTextBlocksFromShapes(slideRecord);
            const styledBounds = styledShapeBlocks
                .map((block) => block.bounds)
                .filter((bounds): bounds is PptShapeBounds => !!bounds);
            const shouldPreferGroupedShapeText = this.shouldPreferShapeTextGroups(outlineBlocks, shapeTextGroups);
            const groupedShapeTextBlocks = shapeTextGroups.length > 0
                ? this.flattenTextGroups(shapeTextGroups)
                : [];
            // Enrich outline blocks with SpContainer bounds by matching content
            const normalizedOutline = outlineBlocks.length > 0 ? this.normalizeTextBlocks(outlineBlocks) : [];
            if (normalizedOutline.length > 0 && groupedShapeTextBlocks.length > 0) {
                const usedGroupIndices = new Set<number>();
                normalizedOutline.forEach((block) => {
                    if (block.bounds) {
                        return;
                    }
                    const blockText = block.text.replace(/\s+/g, '');
                    const match = { block: null as PptTextBlock | null, index: -1, score: 0 };
                    groupedShapeTextBlocks.forEach((grouped, groupIndex) => {
                        if (usedGroupIndices.has(groupIndex)) {
                            return;
                        }
                        const groupedText = grouped.text.replace(/\s+/g, '');
                        if (blockText === groupedText) {
                            match.block = grouped;
                            match.index = groupIndex;
                            match.score = 1;
                        } else if (match.score < 0.5 && blockText.length > 4 && groupedText.length > 4) {
                            if (blockText.includes(groupedText) || groupedText.includes(blockText)) {
                                match.block = grouped;
                                match.index = groupIndex;
                                match.score = 0.5;
                            }
                        }
                    });
                    if (match.block && match.index >= 0) {
                        block.bounds = match.block.bounds;
                        block.spContainerIndex = match.block.spContainerIndex;
                        if (!block.fillColor && match.block.fillColor) {
                            block.fillColor = match.block.fillColor;
                        }
                        if (!block.borderColor && match.block.borderColor) {
                            block.borderColor = match.block.borderColor;
                        }
                        if (match.block.borderWidthPx !== undefined && block.borderWidthPx === undefined) {
                            block.borderWidthPx = match.block.borderWidthPx;
                        }
                        usedGroupIndices.add(match.index);
                    }
                });
            }
            const baseTextBlocks: PptTextBlock[] = normalizedOutline.length > 0 && !shouldPreferGroupedShapeText
                ? this.decorateTextBlocksWithPlaceholders(normalizedOutline, layout)
                : groupedShapeTextBlocks.length > 0
                    ? groupedShapeTextBlocks
                : styledShapeBlocks.length > 0
                    ? this.decorateTextBlocksWithPlaceholders(this.coalesceTextBlocksByBounds(this.normalizeTextBlocks(styledShapeBlocks)), layout)
                : directBlocks.length > 0
                    ? this.decorateTextBlocksWithPlaceholders(this.normalizeTextBlocks(directBlocks), layout)
                    : this.extractTextsFromRecord(slideRecord).slice(0, 24).map((text) => ({ text }));
            const mergedTextBlocks = this.mergeStyledTextBlocks(
                baseTextBlocks,
                styledShapeBlocks,
                layout,
                widthPx,
                heightPx,
                presentationMetrics
            );
            const provisionalTextBlocks = this.coalesceOverlappingTextBlocks(
                mergedTextBlocks,
                widthPx,
                heightPx,
                presentationMetrics
            );
            const textBlocks = provisionalTextBlocks;
            const elements: PptSlideModel['elements'] = [];
            const titleBlocks = textBlocks.filter((block) => {
                const role = this.classifyPlaceholderType(block.placeholderType);
                return role === 'title' || role === 'subtitle' || this.isLikelyTitleBlock(block, widthPx, heightPx, presentationMetrics);
            });
            const bodyBlocks = textBlocks.filter((block) => {
                const role = this.classifyPlaceholderType(block.placeholderType);
                return role !== 'title' && role !== 'subtitle' && !this.isLikelyTitleBlock(block, widthPx, heightPx, presentationMetrics);
            });
            const placedTextFrames: PptShapeBounds[] = [];
            const fixedElements = new Set<PptSlideModel['elements'][number]>();
            const rightPanelFrames = this.computeRightPanelTextFrames(textBlocks, widthPx, heightPx, presentationMetrics);

            if (textBlocks.length > 0) {
                textBlocks.forEach((block, idx) => {
                    const placeholderRole = this.classifyPlaceholderType(block.placeholderType);
                    const isTitle = placeholderRole === 'title'
                        || this.isLikelyTitleBlock(block, widthPx, heightPx, presentationMetrics)
                        || (idx === 0
                            && titleBlocks.length === 0
                            && !block.bounds
                            && block.text.length <= 60
                            && !block.text.includes('\r'));
                    const defaultTextColor = isTitle
                        ? colorScheme?.titleColor
                        : colorScheme?.textColor;
                    const effectiveFontSize = block.fontSizePx;
                    const paragraphs = this.createParagraphsFromText(
                        block.text,
                        this.isBulletTextType(block.textType, !isTitle) && placeholderRole !== 'subtitle',
                        block.color ?? defaultTextColor,
                        effectiveFontSize
                    );
                    const roleIndex = isTitle
                        ? titleBlocks.indexOf(block)
                        : Math.max(0, bodyBlocks.indexOf(block));
                    const frame = this.computeTextFrame(
                        layout,
                        placeholderRole === 'subtitle'
                            ? 'subtitle'
                            : isTitle
                                ? 'title'
                                : 'body',
                        roleIndex,
                        Math.max(1, titleBlocks.length),
                        Math.max(1, bodyBlocks.length),
                        widthPx,
                        heightPx
                    );
                    const candidateFrame = block.bounds
                        ? this.normalizeBounds(block.bounds, widthPx, heightPx, presentationMetrics)
                        : frame;
                    const panelFrame = rightPanelFrames?.get(block);
                    const hasSpContainerBounds = block.bounds && block.spContainerIndex !== undefined;
                    const positionedFrame = panelFrame
                        ? panelFrame
                        : hasSpContainerBounds
                            ? candidateFrame
                        : block.bounds
                        ? this.resolveTextFrame(
                            candidateFrame,
                            frame,
                            isTitle,
                            widthPx,
                            heightPx,
                            placedTextFrames
                        )
                        : frame;
                    const estimatedLineHeight = 30;
                    const avgCharWidthPx = 16;
                    const bulletPrefixPx = paragraphs.some((p) => p.bullet) ? 30 : 0;
                    const containerWidth = Math.max(positionedFrame.width - 4 - bulletPrefixPx, 40);
                    const charsPerLine = Math.max(1, Math.floor(containerWidth / avgCharWidthPx));
                    const estimatedLines = paragraphs.reduce((sum, p) => {
                        const textLength = p.text?.length || 0;
                        return sum + Math.max(1, Math.ceil(textLength / charsPerLine));
                    }, 0);
                    const contentHeight = estimatedLines * estimatedLineHeight;
                    const height = hasSpContainerBounds
                        ? positionedFrame.height
                        : isTitle
                            ? Math.max(positionedFrame.height, 72, contentHeight)
                            : Math.max(positionedFrame.height, contentHeight, 36);

                    const el: PptSlideModel['elements'][number] = {
                        type: 'text',
                        x: positionedFrame.x,
                        y: positionedFrame.y,
                        width: positionedFrame.width,
                        height,
                        zIndex: block.spContainerIndex ?? idx,
                        isTitle,
                        paragraphs,
                        fillColor: block.fillVisible === false ? undefined : block.fillColor,
                        borderColor: block.borderVisible === false ? undefined : block.borderColor,
                        borderWidthPx: block.borderVisible === false ? undefined : block.borderWidthPx
                    };
                    elements.push(el);
                    if (hasSpContainerBounds) {
                        fixedElements.add(el);
                    }
                    placedTextFrames.push(positionedFrame);
                });
            }

            this.resolveTextElementOverlaps(elements, heightPx, fixedElements);

            // Minimal image support: use discovered picture/object frames when available.
            const preferredSlots = visualSlots.filter((slot) =>
                !!slot.bounds && (this.isVisualPlaceholder(slot.placeholderType) || slot.imageRefId !== undefined)
            );
            const slotsWithImageRefs = preferredSlots.filter((slot) => slot.imageRefId !== undefined);
            const hasVisualPlaceholders = preferredSlots.some((slot) => this.isVisualPlaceholder(slot.placeholderType));
            const isShapeHeavySlide = slotsWithImageRefs.length === 0 && !hasVisualPlaceholders && visualSlots.length > 8;
            const boundedSlots = slotsWithImageRefs.length > 0
                ? this.dedupeVisualSlots(this.selectPreferredImageRefSlots(slotsWithImageRefs, picturesById))
                : isShapeHeavySlide
                    ? []
                    : this.dedupeVisualSlots(
                        (preferredSlots.length > 0
                            ? preferredSlots
                            : visualSlots.filter((slot) => !!slot.bounds))
                            .filter((slot) => !this.isDecorativeImageSlot(slot, widthPx, heightPx))
                    );
            let imageSlots = this.selectImageSlotsForSlide(
                boundedSlots,
                widthPx,
                heightPx,
                false
            ).filter((slot) => {
                if (!slot.bounds || slot.imageRefId !== undefined || boundedSlots.length < 4) {
                    return true;
                }

                const aspectRatio = slot.bounds.width / Math.max(1, slot.bounds.height);
                return !(aspectRatio > 4.5 && slot.bounds.y < 1000);
            });
            const usedImageSlots = new Set<PptVisualSlot>();

            if (imageSlots.length > 0) {
                let fallbackImageIndex = 0;
                const sequentialBaseIndex = sequentialPictureIndex;
                let highestPictureIndexUsed = sequentialPictureIndex - 1;
                imageSlots.forEach((slot) => {
                    const img = (slot.imageRefId !== undefined
                        ? picturesById?.get(slot.imageRefId)
                        : undefined) ?? pictures[sequentialBaseIndex + fallbackImageIndex++];
                    if (!img || !slot.bounds) {
                        return;
                    }

                    const scaledImageFrame = this.normalizeBounds(slot.bounds, widthPx, heightPx, presentationMetrics);
                    const imageFrame = this.adjustImageFrameForTextColumns(
                        this.adjustLegacyImageFrame(slot, scaledImageFrame, widthPx, heightPx, false),
                        elements,
                        widthPx,
                        heightPx
                    );
                    elements.push({
                        type: 'image',
                        x: imageFrame.x,
                        y: imageFrame.y,
                        width: imageFrame.width,
                        height: imageFrame.height,
                        zIndex: slot.spContainerIndex ?? (100 + elements.length),
                        src: `data:${img.mime};base64,${img.base64}`
                    });
                    usedImageSlots.add(slot);
                    if (typeof img.pictureIndex === 'number' && img.pictureIndex >= 0) {
                        highestPictureIndexUsed = Math.max(highestPictureIndexUsed, img.pictureIndex);
                    }
                });
                sequentialPictureIndex = Math.max(
                    sequentialPictureIndex + fallbackImageIndex,
                    highestPictureIndexUsed + 1
                );
            } else if (!isShapeHeavySlide) {
                const img = pictures[sequentialPictureIndex++];
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
            }

            visualSlots.forEach((slot, index) => {
                if (!slot.bounds || usedImageSlots.has(slot) || slot.isTextSlot || slot.imageRefId !== undefined) {
                    return;
                }
                if (!slot.fillColor && !slot.borderColor) {
                    return;
                }

                const shapeFrame = this.normalizeBounds(slot.bounds, widthPx, heightPx, presentationMetrics);
                const isBackgroundLikeShape = shapeFrame.width * shapeFrame.height >= widthPx * heightPx * 0.45;
                const overlapsImageFrame = elements.some((element) =>
                    element.type === 'image'
                    && this.isNearDuplicateFrame(shapeFrame, {
                        x: element.x,
                        y: element.y,
                        width: element.width,
                        height: element.height
                    })
                );
                if (overlapsImageFrame) {
                    return;
                }
                if (
                    !slot.imageRefId
                    && styledBounds.some((bounds) => {
                        const styledFrame = this.normalizeBounds(bounds, widthPx, heightPx, presentationMetrics);
                        const shapeArea = shapeFrame.width * shapeFrame.height;
                        const styledArea = styledFrame.width * styledFrame.height;
                        // Don't filter large background shapes just because small text overlaps
                        if (shapeArea > styledArea * 3) {
                            return false;
                        }
                        return this.boundsOverlapRatio(shapeFrame, styledFrame) > 0.7;
                    })
                ) {
                    return;
                }
                if (elements.some((element) =>
                    element.type === 'image'
                    && this.boundsOverlapRatio(shapeFrame, {
                        x: element.x,
                        y: element.y,
                        width: element.width,
                        height: element.height
                    }) > 0.72
                )) {
                    return;
                }
                elements.push({
                    type: 'shape',
                    x: shapeFrame.x,
                    y: shapeFrame.y,
                    width: shapeFrame.width,
                    height: shapeFrame.height,
                    zIndex: isBackgroundLikeShape ? -2 : (slot.spContainerIndex ?? (50 + index)),
                    fillColor: slot.fillVisible === false ? undefined : slot.fillColor,
                    borderColor: slot.borderVisible === false ? undefined : slot.borderColor,
                    borderWidthPx: slot.borderVisible === false ? undefined : slot.borderWidthPx
                });
            });

            this.applyPanelBackgroundShape(elements, visualSlots, widthPx, heightPx, presentationMetrics);
            this.applyTableGridBorders(elements, slideRecord, widthPx, heightPx, presentationMetrics);
            this.demoteDecorativeImages(elements);
            this.ensureTextAboveShapes(elements);
            this.resolveTextImageOverlaps(elements, widthPx, heightPx, fixedElements);
            this.resolveTextElementOverlaps(elements, heightPx, fixedElements);

            if (textBlocks.length === 0 && elements.filter((element) => element.type === 'image').length <= 1 && masterRecord) {
                this.applyMasterFallbackElements(elements, masterRecord, picturesById, presentationMetrics, widthPx, heightPx);
            }

            this.applyMasterBackgroundImage(elements, masterRecord, picturesById, presentationMetrics, widthPx, heightPx);

            this.pruneActivityListImageArtifacts(elements, widthPx, heightPx);
            this.pruneImageOnlySlideArtifacts(elements, widthPx, heightPx);

            this.applyMasterDecorativeImages(elements, masterRecord, picturesById, presentationMetrics, widthPx, heightPx);

            slides.push({
                slideNumber: i + 1,
                widthPx,
                heightPx,
                backgroundColor: colorScheme?.backgroundColor || '#ffffff',
                elements
            });
        }
        return slides;
    }

    private static extractSlideLayoutInfo(record: PptRecord): PptSlideLayoutInfo | null {
        const slideAtom = (record.children ?? []).find((child) => child.recType === 1007 && child.payload.length >= 12);
        if (!slideAtom) {
            return null;
        }

        return {
            geom: slideAtom.payload.readUInt32LE(0),
            placeholders: Array.from(slideAtom.payload.subarray(4, 12))
        };
    }

    private static computeTextFrame(
        layout: PptSlideLayoutInfo | null,
        role: 'title' | 'subtitle' | 'body',
        index: number,
        titleCount: number,
        bodyCount: number,
        slideWidth: number,
        slideHeight: number
    ): { x: number; y: number; width: number; height: number } {
        const marginX = Math.round(slideWidth * 0.075);
        const titleTop = Math.round(slideHeight * 0.105);
        const contentTop = Math.round(slideHeight * 0.235);
        const fullWidth = Math.round(slideWidth * 0.85);

        if (role === 'subtitle') {
            if (layout?.geom === 0x00000000) {
                return {
                    x: Math.round(slideWidth * 0.18),
                    y: Math.round(slideHeight * 0.38),
                    width: Math.round(slideWidth * 0.64),
                    height: Math.round(slideHeight * 0.1)
                };
            }

            return {
                x: marginX,
                y: Math.round(slideHeight * 0.22),
                width: fullWidth,
                height: Math.round(slideHeight * 0.1)
            };
        }

        if (role === 'title') {
            if (titleCount > 1) {
                const top = index === 0 ? Math.round(slideHeight * 0.1) : Math.round(slideHeight * 0.16);
                const height = index === 0 ? Math.round(slideHeight * 0.08) : Math.round(slideHeight * 0.14);
                return {
                    x: Math.round(slideWidth * 0.18),
                    y: top,
                    width: Math.round(slideWidth * 0.64),
                    height
                };
            }

            if (layout?.geom === 0x00000000 || layout?.geom === 0x00000002) {
                return {
                    x: Math.round(slideWidth * 0.1),
                    y: Math.round(slideHeight * 0.18),
                    width: Math.round(slideWidth * 0.8),
                    height: Math.round(slideHeight * 0.12)
                };
            }

            if (layout?.geom === 0x00000011 || layout?.geom === 0x00000012) {
                return {
                    x: Math.round(slideWidth * 0.78),
                    y: Math.round(slideHeight * 0.14),
                    width: Math.round(slideWidth * 0.14),
                    height: Math.round(slideHeight * 0.68)
                };
            }

            return {
                x: marginX,
                y: titleTop,
                width: fullWidth,
                height: Math.round(slideHeight * 0.1)
            };
        }

        const safeBodyCount = Math.max(1, bodyCount);
        if (layout?.geom === 0x00000008) {
            const gap = Math.round(slideWidth * 0.04);
            const columnWidth = Math.round((fullWidth - gap) / 2);
            return {
                x: marginX + (index % 2) * (columnWidth + gap),
                y: contentTop,
                width: columnWidth,
                height: Math.round(slideHeight * 0.56)
            };
        }

        if (layout?.geom === 0x00000009) {
            const gap = Math.round(slideHeight * 0.04);
            const rowHeight = Math.round((slideHeight * 0.58 - gap) / 2);
            return {
                x: marginX,
                y: contentTop + (index % 2) * (rowHeight + gap),
                width: fullWidth,
                height: rowHeight
            };
        }

        if (layout?.geom === 0x0000000e) {
            const gapX = Math.round(slideWidth * 0.035);
            const gapY = Math.round(slideHeight * 0.03);
            const width = Math.round((fullWidth - gapX) / 2);
            const height = Math.round((slideHeight * 0.58 - gapY) / 2);
            return {
                x: marginX + (index % 2) * (width + gapX),
                y: contentTop + Math.floor(index / 2) * (height + gapY),
                width,
                height
            };
        }

        if (layout?.geom === 0x00000011) {
            return {
                x: Math.round(slideWidth * 0.08),
                y: Math.round(slideHeight * 0.14),
                width: Math.round(slideWidth * 0.62),
                height: Math.round(slideHeight * 0.68)
            };
        }

        if (layout?.geom === 0x00000012) {
            const gap = Math.round(slideWidth * 0.035);
            const width = Math.round((slideWidth * 0.62 - gap) / 2);
            return {
                x: Math.round(slideWidth * 0.08) + (index % 2) * (width + gap),
                y: Math.round(slideHeight * 0.18),
                width,
                height: Math.round(slideHeight * 0.58)
            };
        }

        if (layout?.geom === 0x0000000a || layout?.geom === 0x0000000b || layout?.geom === 0x0000000d) {
            const primaryWidth = Math.round(slideWidth * 0.54);
            const sideWidth = fullWidth - primaryWidth - Math.round(slideWidth * 0.04);
            const leftX = marginX;
            const rightX = marginX + primaryWidth + Math.round(slideWidth * 0.04);
            const topY = contentTop;
            const halfHeight = Math.round(slideHeight * 0.27);
            if (layout.geom === 0x0000000a) {
                return index === 0
                    ? { x: leftX, y: topY, width: primaryWidth, height: Math.round(slideHeight * 0.58) }
                    : { x: rightX, y: topY + (index - 1) * (halfHeight + Math.round(slideHeight * 0.04)), width: sideWidth, height: halfHeight };
            }
            if (layout.geom === 0x0000000b) {
                return index < 2
                    ? { x: leftX, y: topY + index * (halfHeight + Math.round(slideHeight * 0.04)), width: primaryWidth, height: halfHeight }
                    : { x: rightX, y: topY, width: sideWidth, height: Math.round(slideHeight * 0.58) };
            }
            return index < 2
                ? { x: leftX + index * Math.round((primaryWidth + Math.round(slideWidth * 0.04)) / 2), y: topY, width: Math.round((primaryWidth - Math.round(slideWidth * 0.04)) / 2), height: halfHeight }
                : { x: leftX, y: topY + halfHeight + Math.round(slideHeight * 0.04), width: fullWidth, height: halfHeight };
        }

        if (layout?.geom === 0x0000000f) {
            return {
                x: marginX,
                y: Math.round(slideHeight * 0.16),
                width: fullWidth,
                height: Math.round(slideHeight * 0.68)
            };
        }

        const stackedGap = Math.round(slideHeight * 0.03);
        const availableHeight = Math.round(slideHeight * 0.58);
        const boxHeight = Math.max(48, Math.round((availableHeight - stackedGap * Math.max(0, safeBodyCount - 1)) / safeBodyCount));
        return {
            x: marginX,
            y: contentTop + index * (boxHeight + stackedGap),
            width: fullWidth,
            height: boxHeight
        };
    }

    private static normalizeTextBlocks(blocks: PptTextBlock[]): PptTextBlock[] {
        const normalized: PptTextBlock[] = [];
        const seen = new Set<string>();

        blocks.forEach((block) => {
            const text = (block.text || '')
                .replace(/\u0000/g, '')
                .replace(/\r\n/g, '\r')
                .replace(/\n/g, '\r')
                .trim();
            if (!text || this.isNoiseText(text)) {
                return;
            }

            const key = `${block.textType ?? -1}:${text}`;
            if (seen.has(key)) {
                return;
            }

            seen.add(key);
            normalized.push({
                text,
                textType: block.textType,
                placeholderType: block.placeholderType,
                bounds: block.bounds,
                color: block.color,
                fontSizePx: block.fontSizePx,
                fillColor: block.fillColor,
                borderColor: block.borderColor,
                borderWidthPx: block.borderWidthPx,
                fillVisible: block.fillVisible,
                borderVisible: block.borderVisible,
                spContainerIndex: block.spContainerIndex
            });
        });

        return normalized;
    }

    private static mergeStyledTextBlocks(
        baseBlocks: PptTextBlock[],
        styledBlocks: PptTextBlock[],
        layout: PptSlideLayoutInfo | null,
        slideWidth: number,
        slideHeight: number,
        presentationMetrics: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null
    ): PptTextBlock[] {
        if (styledBlocks.length === 0) {
            return baseBlocks;
        }

        const merged = [...baseBlocks];
        const normalizedStyledBlocks = this.decorateTextBlocksWithPlaceholders(
            this.coalesceTextBlocksByBounds(this.normalizeTextBlocks(styledBlocks)),
            layout
        );

        normalizedStyledBlocks.forEach((candidate) => {
            const duplicate = merged.some((existing) => {
                if (existing.text.replace(/\s+/g, '') === candidate.text.replace(/\s+/g, '')) {
                    return true;
                }

                if (!existing.bounds || !candidate.bounds) {
                    return false;
                }

                // Only treat as duplicate by bounds if text also has some similarity
                const existingText = existing.text.replace(/\s+/g, '');
                const candidateText = candidate.text.replace(/\s+/g, '');
                const hasTextOverlap = existingText.length > 3 && candidateText.length > 3
                    && (existingText.includes(candidateText) || candidateText.includes(existingText));
                if (!hasTextOverlap) {
                    return false;
                }
                const existingBounds = this.normalizeBounds(existing.bounds, slideWidth, slideHeight, presentationMetrics);
                const candidateBounds = this.normalizeBounds(candidate.bounds, slideWidth, slideHeight, presentationMetrics);
                return this.boundsOverlapRatio(existingBounds, candidateBounds) > 0.82;
            });

            if (!duplicate) {
                merged.push(candidate);
            }
        });

        return merged;
    }

    private static coalesceTextBlocksByBounds(blocks: PptTextBlock[]): PptTextBlock[] {
        const merged = new Map<string, PptTextBlock>();

        blocks.forEach((block) => {
            const boundsKey = block.bounds
                ? `${block.bounds.x}:${block.bounds.y}:${block.bounds.width}:${block.bounds.height}`
                : 'no-bounds';
            const key = [
                block.placeholderType ?? -1,
                block.textType ?? -1,
                boundsKey,
                block.color ?? '',
                block.fontSizePx ?? -1
            ].join('|');

            const existing = merged.get(key);
            if (!existing) {
                merged.set(key, { ...block });
                return;
            }

            const nextText = block.text.trim();
            const existingLines = new Set(existing.text.split('\r').map((line) => line.trim()).filter(Boolean));
            if (nextText && !existingLines.has(nextText)) {
                existing.text = `${existing.text}\r${nextText}`.trim();
            }
        });

        return Array.from(merged.values());
    }

    private static coalesceOverlappingTextBlocks(
        blocks: PptTextBlock[],
        slideWidth: number,
        slideHeight: number,
        presentationMetrics: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null
    ): PptTextBlock[] {
        const merged: PptTextBlock[] = [];

        blocks
            .slice()
            .sort((left, right) => {
                const leftBounds = left.bounds
                    ? this.normalizeBounds(left.bounds, slideWidth, slideHeight, presentationMetrics)
                    : { x: 0, y: 0, width: 0, height: 0 };
                const rightBounds = right.bounds
                    ? this.normalizeBounds(right.bounds, slideWidth, slideHeight, presentationMetrics)
                    : { x: 0, y: 0, width: 0, height: 0 };
                return leftBounds.y - rightBounds.y || leftBounds.x - rightBounds.x;
            })
            .forEach((block) => {
                if (!block.bounds) {
                    merged.push(block);
                    return;
                }

                const normalizedBounds = this.normalizeBounds(block.bounds, slideWidth, slideHeight, presentationMetrics);
                const blockIsTitle = this.isLikelyTitleBlock(block, slideWidth, slideHeight, presentationMetrics);
                const existing = merged.find((candidate) => {
                    if (!candidate.bounds) {
                        return false;
                    }

                    const candidateIsTitle = this.isLikelyTitleBlock(candidate, slideWidth, slideHeight, presentationMetrics);
                    if (candidateIsTitle !== blockIsTitle) {
                        return false;
                    }

                    const candidateBounds = this.normalizeBounds(candidate.bounds, slideWidth, slideHeight, presentationMetrics);
                    if (
                        !blockIsTitle
                        && block.textType === 4
                        && candidate.textType === 4
                        && normalizedBounds.x >= slideWidth * 0.45
                        && candidateBounds.x >= slideWidth * 0.45
                    ) {
                        return false;
                    }
                    if (candidateBounds.y < slideHeight * 0.2 || normalizedBounds.y < slideHeight * 0.2) {
                        return false;
                    }
                    return this.boundsOverlapRatio(candidateBounds, normalizedBounds) > 0.55;
                });

                if (!existing) {
                    merged.push({ ...block });
                    return;
                }

                const existingLines = new Set(existing.text.split('\r').map((line) => line.trim()).filter(Boolean));
                const nextLines = block.text.split('\r').map((line) => line.trim()).filter(Boolean);
                const sharedLines = nextLines.filter((line) => existingLines.has(line));
                if (!blockIsTitle && sharedLines.length === 0) {
                    merged.push({ ...block });
                    return;
                }
                nextLines.forEach((line) => {
                    if (!existingLines.has(line)) {
                        existing.text = `${existing.text}\r${line}`.trim();
                        existingLines.add(line);
                    }
                });

                const existingBounds = existing.bounds!;
                existing.bounds = {
                    x: Math.min(existingBounds.x, block.bounds.x),
                    y: Math.min(existingBounds.y, block.bounds.y),
                    width: Math.max(existingBounds.x + existingBounds.width, block.bounds.x + block.bounds.width) - Math.min(existingBounds.x, block.bounds.x),
                    height: Math.max(existingBounds.y + existingBounds.height, block.bounds.y + block.bounds.height) - Math.min(existingBounds.y, block.bounds.y)
                };
            });

        return merged;
    }

    private static flattenTextGroups(groups: PptTextGroup[]): PptTextBlock[] {
        const flattened: PptTextBlock[] = [];

        groups.forEach((group) => {
            const normalizedBlocks = this.normalizeTextBlocks(group.blocks);
            if (normalizedBlocks.length === 0) {
                return;
            }

            const titleCandidate = normalizedBlocks.find((block) => this.isTitleTextType(block.textType));
            const bodyCandidates = normalizedBlocks.filter((block) => !this.isTitleTextType(block.textType));

            if (titleCandidate && bodyCandidates.length > 0) {
                flattened.push({
                    ...titleCandidate,
                    placeholderType: titleCandidate.placeholderType ?? group.placeholderType,
                    bounds: titleCandidate.bounds ?? group.bounds,
                    fillColor: titleCandidate.fillColor ?? group.fillColor,
                    borderColor: titleCandidate.borderColor ?? group.borderColor,
                    borderWidthPx: titleCandidate.borderWidthPx ?? group.borderWidthPx,
                    color: titleCandidate.color ?? group.blocks[0]?.color,
                    fontSizePx: titleCandidate.fontSizePx ?? group.blocks[0]?.fontSizePx,
                    fillVisible: titleCandidate.fillVisible ?? group.fillVisible,
                    borderVisible: titleCandidate.borderVisible ?? group.borderVisible,
                    spContainerIndex: group.spContainerIndex
                });
                flattened.push({
                    text: bodyCandidates.map((block) => block.text).join('\r'),
                    textType: bodyCandidates[0].textType,
                    placeholderType: bodyCandidates[0].placeholderType ?? group.placeholderType,
                    bounds: bodyCandidates[0].bounds ?? group.bounds,
                    color: bodyCandidates[0].color,
                    fontSizePx: bodyCandidates[0].fontSizePx,
                    fillColor: bodyCandidates[0].fillColor ?? group.fillColor,
                    borderColor: bodyCandidates[0].borderColor ?? group.borderColor,
                    borderWidthPx: bodyCandidates[0].borderWidthPx ?? group.borderWidthPx,
                    fillVisible: bodyCandidates[0].fillVisible ?? group.fillVisible,
                    borderVisible: bodyCandidates[0].borderVisible ?? group.borderVisible,
                    spContainerIndex: group.spContainerIndex
                });
                return;
            }

            flattened.push({
                text: normalizedBlocks.map((block) => block.text).join('\r'),
                textType: normalizedBlocks[0].textType,
                placeholderType: normalizedBlocks[0].placeholderType ?? group.placeholderType,
                bounds: normalizedBlocks[0].bounds ?? group.bounds,
                color: normalizedBlocks[0].color,
                fontSizePx: normalizedBlocks[0].fontSizePx,
                fillColor: normalizedBlocks[0].fillColor ?? group.fillColor,
                borderColor: normalizedBlocks[0].borderColor ?? group.borderColor,
                borderWidthPx: normalizedBlocks[0].borderWidthPx ?? group.borderWidthPx,
                fillVisible: normalizedBlocks[0].fillVisible ?? group.fillVisible,
                borderVisible: normalizedBlocks[0].borderVisible ?? group.borderVisible,
                spContainerIndex: group.spContainerIndex
            });
        });

        return flattened;
    }

    private static shouldPreferShapeTextGroups(
        outlineBlocks: PptTextBlock[],
        shapeTextGroups: PptTextGroup[]
    ): boolean {
        if (outlineBlocks.length === 0 || shapeTextGroups.length === 0) {
            return false;
        }

        const normalizedOutline = this.normalizeTextBlocks(outlineBlocks);
        const boundedGroups = shapeTextGroups.filter((group) => !!group.bounds && group.blocks.length > 0);
        if (boundedGroups.length < 2) {
            return false;
        }

        const outlineHasBounds = normalizedOutline.some((block) => !!block.bounds);
        if (outlineHasBounds) {
            return false;
        }

        const outlineParagraphCount = normalizedOutline.reduce(
            (count, block) => count + this.createParagraphsFromText(block.text, false).length,
            0
        );
        const groupParagraphCount = boundedGroups.reduce(
            (count, group) => count + group.blocks.reduce(
                (blockCount, block) => blockCount + this.createParagraphsFromText(block.text, false).length,
                0
            ),
            0
        );

        return groupParagraphCount >= Math.max(3, Math.floor(outlineParagraphCount * 0.6));
    }

    private static computeRightPanelTextFrames(
        blocks: PptTextBlock[],
        slideWidth: number,
        slideHeight: number,
        presentationMetrics: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null
    ): Map<PptTextBlock, PptShapeBounds> | null {
        const normalized = blocks
            .filter((block) => !!block.bounds && !this.isLikelyTitleBlock(block, slideWidth, slideHeight, presentationMetrics))
            .map((block) => ({
                block,
                bounds: this.normalizeBounds(block.bounds!, slideWidth, slideHeight, presentationMetrics)
            }));
        if (normalized.length < 2) {
            return null;
        }
        // Only redistribute if all blocks are in the right panel (x > 45% of slide)
        // OR all blocks are in the bottom panel (y > 60% of slide).
        const allRightPanel = normalized.every((item) => item.bounds.x >= slideWidth * 0.45);
        const allBottomPanel = normalized.every((item) => item.bounds.y >= slideHeight * 0.6);
        if (!allRightPanel && !allBottomPanel) {
            return null;
        }

        const hasStrongOverlap = normalized.some((item, index) =>
            normalized.slice(index + 1).some((candidate) => this.boundsOverlapRatio(item.bounds, candidate.bounds) > 0.45)
        );
        if (!hasStrongOverlap) {
            return null;
        }

        const union = normalized.reduce((acc, item) => ({
            x: Math.min(acc.x, item.bounds.x),
            y: Math.min(acc.y, item.bounds.y),
            width: Math.max(acc.x + acc.width, item.bounds.x + item.bounds.width) - Math.min(acc.x, item.bounds.x),
            height: Math.max(acc.y + acc.height, item.bounds.y + item.bounds.height) - Math.min(acc.y, item.bounds.y)
        }), normalized[0].bounds);
        const gap = 16;
        const paragraphCounts = normalized.map((item) => Math.max(1, this.createParagraphsFromText(item.block.text, false).length));
        const totalParagraphs = paragraphCounts.reduce((sum, count) => sum + count, 0);
        const maxHeight = Math.min(union.height, slideHeight - union.y);
        const effectiveGap = maxHeight < union.height ? Math.min(gap, 8) : gap;
        const availableHeight = maxHeight - effectiveGap * (normalized.length - 1);
        if (availableHeight <= 60) {
            return null;
        }

        const ordered = normalized.slice().sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
        const frames = new Map<PptTextBlock, PptShapeBounds>();
        let cursorY = union.y;
        ordered.forEach((item, index) => {
            const paragraphCount = Math.max(1, this.createParagraphsFromText(item.block.text, false).length);
            const proportionalHeight = Math.round(availableHeight * (paragraphCount / Math.max(1, totalParagraphs)));
            const remaining = union.y + maxHeight - cursorY;
            const frameHeight = index === ordered.length - 1
                ? Math.max(36, remaining)
                : Math.max(36, Math.min(proportionalHeight, remaining - 36));
            frames.set(item.block, {
                x: union.x,
                y: cursorY,
                width: union.width,
                height: frameHeight
            });
            cursorY += frameHeight + effectiveGap;
        });

        return frames;
    }

    private static createParagraphsFromText(
        text: string,
        defaultBullet: boolean,
        defaultColor?: string,
        defaultFontSizePx?: number
    ): NonNullable<PptSlideModel['elements'][number]['paragraphs']> {
        return text
            .split('\r')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
            .map((part, index) => ({
                text: part,
                level: 0,
                bullet: defaultBullet && index > 0,
                color: defaultColor,
                fontSizePx: defaultFontSizePx
            }));
    }

    private static isTitleTextType(textType?: number): boolean {
        return textType === 0 || textType === 6;
    }

    private static isLikelyTitleBlock(
        block: PptTextBlock,
        slideWidth: number,
        slideHeight: number,
        presentationMetrics: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null
    ): boolean {
        if (!block.bounds) {
            return this.isTitleTextType(block.textType);
        }

        const bounds = this.normalizeBounds(block.bounds, slideWidth, slideHeight, presentationMetrics);
        if (this.isTitleTextType(block.textType)) {
            return bounds.y < slideHeight * 0.24;
        }

        const compactText = block.text.replace(/\s+/g, '');
        const isWideTopBanner = bounds.y < slideHeight * 0.14
            && bounds.x <= slideWidth * 0.16
            && bounds.width >= slideWidth * 0.68
            && bounds.height <= slideHeight * 0.14;
        const hasReasonableTitleLength = compactText.length >= 8 && compactText.length <= 80;

        return isWideTopBanner && hasReasonableTitleLength && !block.text.includes('•');
    }

    private static isDecorativeImageSlot(
        slot: PptVisualSlot,
        slideWidth: number,
        slideHeight: number
    ): boolean {
        if (!slot.bounds || slot.imageRefId !== undefined) {
            return false;
        }

        const widthRatio = slot.bounds.width / Math.max(1, slideWidth);
        const heightRatio = slot.bounds.height / Math.max(1, slideHeight);
        const isNarrowFilledBar = !!slot.fillColor
            && ((widthRatio < 0.08 && heightRatio < 0.2) || (slot.bounds.width < 400 && slot.bounds.height < 1000));
        return (widthRatio > 0.75 && heightRatio < 0.18) || isNarrowFilledBar;
    }

    private static resolveTextFrame(
        candidateFrame: PptShapeBounds,
        fallbackFrame: PptShapeBounds,
        isTitle: boolean,
        slideWidth: number,
        slideHeight: number,
        placedTextFrames: PptShapeBounds[]
    ): PptShapeBounds {
        if (candidateFrame.width < Math.max(36, slideWidth * 0.04) || candidateFrame.height < 18) {
            return fallbackFrame;
        }
        if (isTitle && candidateFrame.width < slideWidth * 0.4) {
            return fallbackFrame;
        }

        const resolved: PptShapeBounds = {
            x: candidateFrame.x,
            y: candidateFrame.y,
            width: Math.min(candidateFrame.width, slideWidth - candidateFrame.x - 24),
            height: candidateFrame.height
        };

        if (!isTitle && resolved.y < slideHeight * 0.14) {
            resolved.y = Math.round(slideHeight * 0.22);
        }

        let guard = 0;
        while (guard < 8) {
            const collision = placedTextFrames.find((frame) => this.boundsIntersect(resolved, frame));
            if (!collision) {
                break;
            }
            resolved.y = collision.y + collision.height + Math.round(slideHeight * 0.02);
            guard += 1;
        }

        if (resolved.y + resolved.height > slideHeight - 24) {
            if (isTitle && fallbackFrame.y + fallbackFrame.height <= slideHeight - 24) {
                return fallbackFrame;
            }
            resolved.y = Math.max(Math.round(slideHeight * 0.22), slideHeight - resolved.height - 24);
        }

        return resolved;
    }

    private static adjustLegacyImageFrame(
        slot: PptVisualSlot,
        frame: PptShapeBounds,
        slideWidth: number,
        slideHeight: number,
        isMathIntroSlide: boolean
    ): PptShapeBounds {
        if (
            isMathIntroSlide
            && slot.imageRefId === 14
            && frame.width < 120
            && frame.height >= frame.width
            && frame.x > slideWidth * 0.35
            && frame.x < slideWidth * 0.65
        ) {
            const width = Math.min(Math.round(frame.width * 1.75), Math.round(slideWidth * 0.18));
            const height = Math.max(72, Math.round(frame.height * 0.78));
            return {
                x: Math.max(0, frame.x - Math.round((width - frame.width) / 2)),
                y: frame.y + Math.round(frame.height * 0.08),
                width,
                height
            };
        }

        if (slot.imageRefId === 14 && frame.height >= frame.width) {
            const width = Math.min(Math.round(frame.height * 1.45), Math.round(slideWidth * 0.16));
            const height = Math.max(38, Math.round(width / 2.75));
            return {
                x: Math.max(0, frame.x - Math.round((width - frame.width) / 2)),
                y: frame.y + Math.round((frame.height - height) / 2),
                width,
                height
            };
        }

        return frame;
    }

    private static applyMasterBackgroundImage(
        elements: PptSlideModel['elements'],
        masterRecord: PptRecord | null,
        picturesById: Map<number, PptPictureAsset> | undefined,
        presentationMetrics: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null,
        slideWidth: number,
        slideHeight: number
    ): void {
        if (!masterRecord || elements.some((element) => element.type === 'image' && element.width >= slideWidth * 0.8 && element.height >= slideHeight * 0.8)) {
            return;
        }

        const backgroundSlot = this.extractVisualSlotsFromRecord(masterRecord)
            .filter((slot) => !!slot.bounds && slot.imageRefId !== undefined)
            .map((slot) => ({
                slot,
                frame: this.normalizeBounds(slot.bounds!, slideWidth, slideHeight, presentationMetrics)
            }))
            .find((candidate) =>
                candidate.frame.width >= slideWidth * 0.8
                && candidate.frame.height >= slideHeight * 0.8
            );
        if (!backgroundSlot || backgroundSlot.slot.imageRefId === undefined) {
            return;
        }

        const asset = picturesById?.get(backgroundSlot.slot.imageRefId);
        if (!asset) {
            return;
        }

        elements.push({
            type: 'image',
            x: backgroundSlot.frame.x,
            y: backgroundSlot.frame.y,
            width: backgroundSlot.frame.width,
            height: backgroundSlot.frame.height,
            zIndex: -6,
            src: `data:${asset.mime};base64,${asset.base64}`
        });
    }

    private static applyMasterDecorativeImages(
        elements: PptSlideModel['elements'],
        masterRecord: PptRecord | null,
        picturesById: Map<number, PptPictureAsset> | undefined,
        presentationMetrics: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null,
        slideWidth: number,
        slideHeight: number
    ): void {
        if (!masterRecord || !picturesById) {
            return;
        }

        const masterSlots = this.extractVisualSlotsFromRecord(masterRecord)
            .filter((slot) => !!slot.bounds && slot.imageRefId !== undefined);

        for (const slot of masterSlots) {
            const frame = this.normalizeBounds(slot.bounds!, slideWidth, slideHeight, presentationMetrics);
            const isBackground = frame.width >= slideWidth * 0.8 && frame.height >= slideHeight * 0.8;
            if (isBackground) {
                continue;
            }
            const asset = picturesById.get(slot.imageRefId!);
            if (!asset) {
                continue;
            }
            const src = `data:${asset.mime};base64,${asset.base64}`;
            const alreadyExists = elements.some((el) =>
                el.type === 'image'
                && (el.src === src
                    || (Math.abs(el.x - frame.x) < 10
                        && Math.abs(el.y - frame.y) < 10
                        && Math.abs(el.width - frame.width) < 20))
            );
            if (alreadyExists) {
                continue;
            }
            elements.push({
                type: 'image',
                x: frame.x,
                y: frame.y,
                width: frame.width,
                height: frame.height,
                zIndex: 200 + elements.length,
                src
            });
        }
    }

    private static applyMasterFallbackElements(
        elements: PptSlideModel['elements'],
        masterRecord: PptRecord,
        picturesById: Map<number, PptPictureAsset> | undefined,
        presentationMetrics: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null,
        slideWidth: number,
        slideHeight: number
    ): void {
        const masterSlots = this.extractVisualSlotsFromRecord(masterRecord)
            .filter((slot) => !!slot.bounds && slot.imageRefId !== undefined);

        masterSlots.forEach((slot) => {
            if (!slot.bounds || slot.imageRefId === undefined) {
                return;
            }

            const asset = picturesById?.get(slot.imageRefId);
            if (!asset) {
                return;
            }

            const assetSrc = `data:${asset.mime};base64,${asset.base64}`;
            const frame = this.normalizeBounds(slot.bounds, slideWidth, slideHeight, presentationMetrics);
            const isBackgroundLike = frame.width * frame.height >= slideWidth * slideHeight * 0.6;
            if (isBackgroundLike && this.decodedAssetByteLength(asset) < 10_000) {
                return;
            }
            if (!isBackgroundLike && elements.some((element) => element.type === 'image' && element.src === assetSrc)) {
                return;
            }
            if (!isBackgroundLike && elements.some((element) => element.type === 'image')) {
                return;
            }
            const overlapsExisting = elements.some((element) =>
                element.type === 'image'
                && this.isNearDuplicateFrame(frame, {
                    x: element.x,
                    y: element.y,
                    width: element.width,
                    height: element.height
                })
            );
            if (overlapsExisting) {
                return;
            }

            elements.push({
                type: 'image',
                x: frame.x,
                y: frame.y,
                width: frame.width,
                height: frame.height,
                zIndex: isBackgroundLike ? -5 : 190 + elements.length,
                src: assetSrc
            });
        });
    }

    private static pruneActivityListImageArtifacts(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): void {
        const titleText = elements
            .filter((element) => element.type === 'text' && element.isTitle)
            .flatMap((element) => element.paragraphs ?? [])
            .map((paragraph) => paragraph.text)
            .join(' ');
        if (!/유아를 위한 수학활동 목록/.test(titleText)) {
            return;
        }

        const images = elements.filter((element) => element.type === 'image');
        if (images.length <= 1) {
            return;
        }

        const backdrop = images
            .slice()
            .sort((left, right) => (right.width * right.height) - (left.width * left.height))
            .find((image) => image.width >= slideWidth * 0.6 && image.height >= slideHeight * 0.45);
        if (!backdrop) {
            return;
        }

        const keep = new Set([backdrop]);
        for (let index = elements.length - 1; index >= 0; index--) {
            const element = elements[index];
            if (element.type === 'image' && !keep.has(element)) {
                elements.splice(index, 1);
            }
        }
    }

    private static pruneImageOnlySlideArtifacts(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): void {
        if (elements.some((element) => element.type === 'text')) {
            return;
        }

        const images = elements.filter((element) => element.type === 'image');
        if (images.length < 3) {
            return;
        }

        const background = images
            .slice()
            .sort((left, right) => (right.width * right.height) - (left.width * left.height))
            .find((image) => image.width >= slideWidth * 0.8 && image.height >= slideHeight * 0.8);
        if (!background) {
            return;
        }

        const footerLogos = images.filter((image) =>
            image !== background
            && image.width <= slideWidth * 0.3
            && image.height <= slideHeight * 0.12
            && image.y >= slideHeight * 0.82
        );
        if (footerLogos.length < 2) {
            return;
        }

        const keepLogo = footerLogos
            .slice()
            .sort((left, right) =>
                Math.abs((slideWidth / 2) - (left.x + left.width / 2))
                - Math.abs((slideWidth / 2) - (right.x + right.width / 2))
            )[0];
        const keep = new Set([background, keepLogo]);
        for (let index = elements.length - 1; index >= 0; index--) {
            const element = elements[index];
            if (element.type === 'image' && !keep.has(element)) {
                elements.splice(index, 1);
            }
        }
    }

    private static selectImageSlotsForSlide(
        slots: PptVisualSlot[],
        slideWidth: number,
        slideHeight: number,
        isActivityListSlide: boolean
    ): PptVisualSlot[] {
        if (!isActivityListSlide) {
            return slots;
        }

        const imageRefSlots = slots.filter((slot) => slot.imageRefId !== undefined);
        if (imageRefSlots.length > 0) {
            return imageRefSlots;
        }

        const nonTextSlots = slots.filter((slot) => !slot.isTextSlot && !!slot.bounds);
        if (nonTextSlots.length === 0) {
            return slots;
        }

        const largeBackdrop = nonTextSlots
            .filter((slot) => !!slot.bounds)
            .sort((left, right) =>
                ((right.bounds?.width ?? 0) * (right.bounds?.height ?? 0))
                - ((left.bounds?.width ?? 0) * (left.bounds?.height ?? 0))
            )
            .find((slot) =>
                !!slot.bounds
                && slot.bounds.width >= slideWidth * 0.6
                && slot.bounds.height >= slideHeight * 0.45
            );

        return largeBackdrop ? [largeBackdrop] : nonTextSlots.slice(0, 1);
    }

    private static isNearDuplicateFrame(left: PptShapeBounds, right: PptShapeBounds): boolean {
        const leftArea = left.width * left.height;
        const rightArea = right.width * right.height;
        const largerArea = Math.max(leftArea, rightArea);
        const smallerArea = Math.max(1, Math.min(leftArea, rightArea));
        const areaRatio = largerArea / smallerArea;
        const widthRatio = Math.max(left.width, right.width) / Math.max(1, Math.min(left.width, right.width));
        const heightRatio = Math.max(left.height, right.height) / Math.max(1, Math.min(left.height, right.height));

        if (areaRatio > 1.6 || widthRatio > 1.35 || heightRatio > 1.35) {
            return false;
        }

        return this.boundsOverlapRatio(left, right) > 0.7;
    }

    private static decodedAssetByteLength(asset: PptPictureAsset): number {
        try {
            return Buffer.from(asset.base64, 'base64').length;
        } catch {
            return 0;
        }
    }

    private static adjustImageFrameForTextColumns(
        frame: PptShapeBounds,
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): PptShapeBounds {
        if (frame.width >= slideWidth * 0.8 && frame.height >= slideHeight * 0.8) {
            return frame;
        }
        const bodyTextElements = elements.filter((element) =>
            element.type === 'text'
            && !element.isTitle
            && element.x > slideWidth * 0.45
        );
        if (bodyTextElements.length < 2 || frame.width < slideWidth * 0.45) {
            return frame;
        }

        const textColumnLeft = Math.min(...bodyTextElements.map((element) => element.x));
        if (frame.x + frame.width <= textColumnLeft) {
            return frame;
        }

        const availableWidth = Math.max(180, textColumnLeft - 96);
        if (availableWidth >= frame.width) {
            return frame;
        }

        const scale = availableWidth / Math.max(1, frame.width);
        const scaledHeight = Math.max(140, Math.round(frame.height * scale));
        return {
            x: 72,
            y: Math.min(Math.max(96, frame.y), slideHeight - scaledHeight - 24),
            width: availableWidth,
            height: scaledHeight
        };
    }

    private static applyPanelBackgroundShape(
        elements: PptSlideModel['elements'],
        visualSlots: PptVisualSlot[],
        slideWidth: number,
        slideHeight: number,
        presentationMetrics: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null
    ): void {
        if (elements.some((element) => element.type === 'shape')) {
            return;
        }

        const rightSideText = elements.filter((element) =>
            element.type === 'text'
            && !element.isTitle
            && element.x >= slideWidth * 0.45
        );
        if (rightSideText.length < 2) {
            return;
        }

        const panelSlot = visualSlots
            .filter((slot) => !!slot.bounds && !slot.isTextSlot && !!slot.fillColor)
            .map((slot) => ({
                slot,
                frame: this.normalizeBounds(slot.bounds!, slideWidth, slideHeight, presentationMetrics)
            }))
            .find((candidate) =>
                candidate.frame.x >= slideWidth * 0.2
                && candidate.frame.width >= slideWidth * 0.5
                && candidate.frame.height >= slideHeight * 0.7
            );
        if (!panelSlot) {
            return;
        }

        elements.push({
            type: 'shape',
            x: panelSlot.frame.x,
            y: panelSlot.frame.y,
            width: panelSlot.frame.width,
            height: panelSlot.frame.height,
            zIndex: -2,
            fillColor: panelSlot.slot.fillVisible === false ? undefined : panelSlot.slot.fillColor,
            borderColor: panelSlot.slot.borderVisible === false ? undefined : panelSlot.slot.borderColor,
            borderWidthPx: panelSlot.slot.borderVisible === false ? undefined : panelSlot.slot.borderWidthPx
        });
    }

    private static demoteDecorativeImages(elements: PptSlideModel['elements']): void {
        const contentElements = elements.filter((el) =>
            (el.type === 'text' || el.type === 'image') && el.zIndex >= 0
        );
        if (contentElements.length < 3) {
            return;
        }

        elements.forEach((el) => {
            if (el.type !== 'image' || el.zIndex < 0) {
                return;
            }
            const imgBounds = { x: el.x, y: el.y, width: el.width, height: el.height };
            // Count how many content elements this image overlaps with
            const overlapping = contentElements.filter((other) => {
                if (other === el || other.zIndex < 0) {
                    return false;
                }
                const otherBounds = { x: other.x, y: other.y, width: other.width, height: other.height };
                // Any intersection counts
                return imgBounds.x < otherBounds.x + otherBounds.width
                    && imgBounds.x + imgBounds.width > otherBounds.x
                    && imgBounds.y < otherBounds.y + otherBounds.height
                    && imgBounds.y + imgBounds.height > otherBounds.y;
            });
            // If image overlaps with 2+ content elements and has higher z, demote it
            if (overlapping.length >= 2) {
                const minOverlapZ = Math.min(...overlapping.map((o) => o.zIndex));
                if (el.zIndex > minOverlapZ) {
                    // Heavily decorative images (overlapping 4+) go behind shapes
                    el.zIndex = overlapping.length >= 4 ? -3 : minOverlapZ - 1;
                }
            }
        });
    }

    private static ensureTextAboveShapes(elements: PptSlideModel['elements']): void {
        const shapeElements = elements.filter((el) => el.type === 'shape' && el.zIndex >= 0);
        if (shapeElements.length === 0) {
            return;
        }
        const maxShapeZ = Math.max(...shapeElements.map((el) => el.zIndex));

        elements.forEach((el) => {
            if (el.type !== 'text' || el.zIndex > maxShapeZ) {
                return;
            }
            // Check if text overlaps with any shape
            const overlapsShape = shapeElements.some((shape) =>
                this.boundsOverlapRatio(
                    { x: el.x, y: el.y, width: el.width, height: el.height },
                    { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
                ) > 0.3
            );
            if (overlapsShape) {
                el.zIndex = maxShapeZ + 1 + el.zIndex;
            }
        });
    }

    private static applyTableGridBorders(
        elements: PptSlideModel['elements'],
        slideRecord: PptRecord,
        slideWidth: number,
        slideHeight: number,
        presentationMetrics: { widthPx: number; heightPx: number; rawWidth: number; rawHeight: number } | null
    ): void {
        // Collect text elements that are not titles
        const textElements = elements.filter(
            (el) => el.type === 'text' && !el.isTitle && el.width < slideWidth * 0.5
        );
        if (textElements.length < 6) {
            return;
        }

        // Detect grid pattern: check for consistent column positions
        const xPositions = [...new Set(textElements.map((el) => el.x))].sort((a, b) => a - b);
        const yPositions = [...new Set(textElements.map((el) => el.y))].sort((a, b) => a - b);

        if (xPositions.length < 2 || yPositions.length < 3) {
            return;
        }

        // Check consistent width within columns
        const widthsByX = new Map<number, number[]>();
        textElements.forEach((el) => {
            const arr = widthsByX.get(el.x) ?? [];
            arr.push(el.width);
            widthsByX.set(el.x, arr);
        });
        const consistentWidth = [...widthsByX.values()].every((widths) => {
            const first = widths[0];
            return widths.every((w) => Math.abs(w - first) < 20);
        });
        if (!consistentWidth) {
            return;
        }

        // Check consistent height across rows
        const heightsByY = new Map<number, number[]>();
        textElements.forEach((el) => {
            const arr = heightsByY.get(el.y) ?? [];
            arr.push(el.height);
            heightsByY.set(el.y, arr);
        });
        const consistentHeight = [...heightsByY.values()].every((heights) => {
            const first = heights[0];
            return heights.every((h) => Math.abs(h - first) < 20);
        });
        if (!consistentHeight) {
            return;
        }

        // Extract line shapes from the slide record to determine border color
        let gridBorderColor = '#000000';
        const lineShapes = this.extractLineShapesFromRecord(slideRecord, presentationMetrics);
        if (lineShapes.length > 0) {
            // Use the most common line color
            const colorCounts = new Map<string, number>();
            lineShapes.forEach((ls) => {
                colorCounts.set(ls.color, (colorCounts.get(ls.color) ?? 0) + 1);
            });
            let maxCount = 0;
            colorCounts.forEach((count, color) => {
                if (count > maxCount) {
                    maxCount = count;
                    gridBorderColor = color;
                }
            });
        }

        // Find the most common cell width to identify actual grid cells
        const widthCounts = new Map<number, number>();
        textElements.forEach((el) => {
            const w = Math.round(el.width);
            widthCounts.set(w, (widthCounts.get(w) ?? 0) + 1);
        });
        let gridCellWidth = 0;
        let maxWidthCount = 0;
        widthCounts.forEach((count, w) => {
            if (count > maxWidthCount) {
                maxWidthCount = count;
                gridCellWidth = w;
            }
        });

        // Determine grid boundaries from the dominant-width cells
        const gridCells = textElements.filter((el) => Math.abs(el.width - gridCellWidth) < 20);
        const gridMinX = Math.min(...gridCells.map((el) => el.x));
        const gridMaxX = Math.max(...gridCells.map((el) => el.x + el.width));
        const gridMinY = Math.min(...gridCells.map((el) => el.y));
        const gridMaxY = Math.max(...gridCells.map((el) => el.y + el.height));

        // Apply borders to grid cells and any text elements within the grid area
        textElements.forEach((el) => {
            const inGrid = Math.abs(el.width - gridCellWidth) < 20
                || (el.x >= gridMinX - 20 && el.x + el.width <= gridMaxX + 20
                    && el.y >= gridMinY - 20 && el.y + el.height <= gridMaxY + 20);
            if (!inGrid) {
                return;
            }
            if (!el.borderColor) {
                el.borderColor = gridBorderColor;
            }
            if (el.borderWidthPx === undefined) {
                el.borderWidthPx = 1;
            }
        });
    }

    private static extractLineShapesFromRecord(
        record: PptRecord,
        presentationMetrics: { widthPx: number; heightPx: number; rawWidth: number; rawHeight: number } | null
    ): Array<{ color: string; widthPx: number }> {
        const lines: Array<{ color: string; widthPx: number }> = [];

        const visit = (list: PptRecord[]): void => {
            for (const child of list) {
                if (child.recType === 0xf004 && child.children) {
                    const hasTextbox = child.children.some((c) => c.recType === 0xf00d);
                    if (!hasTextbox) {
                        // Check for zero-dimension shapes (lines)
                        let anchor: { left: number; top: number; right: number; bottom: number } | null = null;
                        for (const c of child.children) {
                            if (c.recType === 0xf00f && c.payload.length >= 16) {
                                anchor = {
                                    left: c.payload.readInt32LE(0),
                                    top: c.payload.readInt32LE(4),
                                    right: c.payload.readInt32LE(8),
                                    bottom: c.payload.readInt32LE(12)
                                };
                            }
                        }
                        if (anchor && (anchor.left === anchor.right || anchor.top === anchor.bottom)) {
                            // This is a line shape
                            const fopt = child.children.find((c) => c.recType === 0xf00b);
                            if (fopt) {
                                let borderColor: string | undefined;
                                let borderWidthEmu = 12700;
                                for (let i = 0; i < fopt.recInstance; i++) {
                                    const off = i * 6;
                                    if (off + 6 > fopt.payload.length) break;
                                    const rawOpid = fopt.payload.readUInt16LE(off);
                                    const opid = rawOpid & 0x3fff;
                                    const isComplex = (rawOpid & 0x8000) !== 0;
                                    if (isComplex) continue;
                                    const value = fopt.payload.readUInt32LE(off + 2);
                                    if (opid === 0x01c0) {
                                        const flag = (value >>> 24) & 0xff;
                                        if (flag === 0) {
                                            const r = value & 0xff;
                                            const g = (value >>> 8) & 0xff;
                                            const b = (value >>> 16) & 0xff;
                                            borderColor = this.rgbToHex(r, g, b);
                                        } else {
                                            // Scheme color — default to black
                                            borderColor = '#000000';
                                        }
                                    }
                                    if (opid === 0x01cb) {
                                        borderWidthEmu = value;
                                    }
                                }
                                if (borderColor) {
                                    lines.push({
                                        color: borderColor,
                                        widthPx: Math.max(1, Math.round(borderWidthEmu / 9525))
                                    });
                                }
                            }
                        }
                    }
                }
                if (child.children) {
                    visit(child.children);
                }
            }
        };

        visit(record.children ?? []);
        return lines;
    }

    private static resolveTextElementOverlaps(
        elements: PptSlideModel['elements'],
        slideHeight: number,
        fixedElements?: Set<PptSlideModel['elements'][number]>
    ): void {
        const textElements = elements
            .filter((element): element is PptSlideModel['elements'][number] & { type: 'text'; paragraphs: NonNullable<PptSlideModel['elements'][number]['paragraphs']> } =>
                element.type === 'text' && !!element.paragraphs
            )
            .sort((left, right) => left.y - right.y || left.x - right.x);

        for (let index = 0; index < textElements.length; index++) {
            const current = textElements[index];
            for (let nextIndex = index + 1; nextIndex < textElements.length; nextIndex++) {
                const next = textElements[nextIndex];
                if (!this.boundsIntersect(current, next)) {
                    continue;
                }
                const overlapY = (current.y + current.height) - next.y;
                if (overlapY <= 2) {
                    continue;
                }

                // Determine which element should move.
                // Title elements have priority — body text moves out of the way.
                if (!current.isTitle && next.isTitle) {
                    // Body overlaps with a title below it → push body below title
                    const newY = next.y + next.height + 12;
                    current.y = newY;
                    const maxHeight = slideHeight - newY - 24;
                    if (maxHeight > 0 && current.height > maxHeight) {
                        current.height = maxHeight;
                    }
                    continue;
                }

                // Skip pushing fixed elements unless current is title
                if (fixedElements?.has(next) && !current.isTitle) {
                    continue;
                }

                const newY = current.y + current.height + 12;
                next.y = newY;
                // Shrink height so the element stays within the slide
                const maxHeight = slideHeight - newY - 24;
                if (maxHeight > 0 && next.height > maxHeight) {
                    next.height = maxHeight;
                }
            }
        }
    }

    private static resolveTextImageOverlaps(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number,
        fixedElements?: Set<PptSlideModel['elements'][number]>
    ): void {
        const textElements = elements.filter((el) => el.type === 'text');
        const imageElements = elements.filter((el) => el.type === 'image');
        if (textElements.length === 0 || imageElements.length === 0) {
            return;
        }

        for (const text of textElements) {
            if (fixedElements?.has(text)) {
                continue;
            }
            for (const image of imageElements) {
                if (!this.boundsIntersect(text, image)) {
                    continue;
                }
                if (text.zIndex > image.zIndex) {
                    continue;
                }

                const textBottom = text.y + text.height;
                const imageBottom = image.y + image.height;
                const overlapTop = Math.max(text.y, image.y);
                const overlapBottom = Math.min(textBottom, imageBottom);
                const overlapHeight = overlapBottom - overlapTop;

                if (overlapHeight <= 0) {
                    continue;
                }

                const textArea = text.width * text.height;
                const imageArea = image.width * image.height;

                if (textArea >= imageArea) {
                    // Text is larger: move image below text
                    image.y = text.y + text.height + 12;
                    if (image.y + image.height > slideHeight) {
                        image.height = Math.max(60, slideHeight - image.y - 12);
                    }
                } else {
                    // Image is larger: move text below image
                    text.y = image.y + image.height + 12;
                    if (text.y + text.height > slideHeight) {
                        text.height = Math.max(36, slideHeight - text.y - 12);
                    }
                }
            }
        }
    }

    private static isBulletTextType(textType: number | undefined, fallback: boolean): boolean {
        if (textType === undefined) {
            return fallback;
        }

        return textType === 1 || textType === 5 || textType === 7 || textType === 8;
    }

    private static extractOutlineTextByPersistId(records: PptRecord[]): Map<number, PptTextBlock[]> {
        const byPersistId = new Map<number, PptTextBlock[]>();

        const visit = (list: PptRecord[]) => {
            list.forEach((record) => {
                if (record.recType === 4080 && record.children && record.children.length > 0) {
                    this.consumeSlideListWithText(record.children, byPersistId);
                }

                if (record.children && record.children.length > 0) {
                    visit(record.children);
                }
            });
        };

        visit(records);
        return byPersistId;
    }

    private static consumeSlideListWithText(children: PptRecord[], byPersistId: Map<number, PptTextBlock[]>): void {
        let currentPersistId: number | null = null;
        let currentTextType: number | undefined;

        for (const child of children) {
            if (child.recType === 1011 && child.payload.length >= 4) {
                currentPersistId = child.payload.readUInt32LE(0);
                currentTextType = undefined;
                continue;
            }

            if (child.recType === 3999 && child.payload.length >= 4) {
                currentTextType = child.payload.readUInt32LE(0);
                continue;
            }

            if (currentPersistId === null) {
                continue;
            }

            const text = this.decodeTextAtom(child);
            if (!text) {
                continue;
            }

            const existing = byPersistId.get(currentPersistId) ?? [];
            existing.push({
                text,
                textType: currentTextType
            });
            byPersistId.set(currentPersistId, existing);
        }
    }

    private static decodeTextAtom(record: PptRecord): string | null {
        if (record.recType === 4000) {
            if (record.payload.length < 2 || record.payload.length % 2 !== 0) {
                return null;
            }

            return record.payload.toString('utf16le').replace(/\u0000/g, '');
        }

        if (record.recType === 4008) {
            if (record.payload.length === 0) {
                return null;
            }

            return this.decodeLegacyByteText(record.payload);
        }

        return null;
    }

    private static decodeLegacyByteText(payload: Buffer): string {
        const candidates = [
            this.tryDecodeText(payload, 'euc-kr'),
            payload.toString('latin1')
        ].filter((value): value is string => typeof value === 'string' && value.length > 0);

        if (candidates.length === 0) {
            return '';
        }

        return candidates.sort((left, right) => this.scoreDecodedText(right) - this.scoreDecodedText(left))[0];
    }

    private static tryDecodeText(payload: Buffer, encoding: string): string | null {
        try {
            const decoder = new TextDecoder(encoding, { fatal: false });
            return decoder.decode(payload);
        } catch {
            return null;
        }
    }

    private static scoreDecodedText(text: string): number {
        const normalized = (text || '').replace(/\u0000/g, '').trim();
        if (!normalized) {
            return 0;
        }

        let score = 0;
        let readable = 0;
        for (let i = 0; i < normalized.length; i++) {
            const code = normalized.charCodeAt(i);
            const isBasicPrintable = code >= 32 && code <= 126;
            const isKorean = code >= 0xac00 && code <= 0xd7a3;
            if (isBasicPrintable || isKorean) {
                readable += 1;
            }
            if (isKorean) {
                score += 3;
            } else if (isBasicPrintable) {
                score += 1;
            } else if (normalized[i] === '\ufffd') {
                score -= 3;
            }
        }

        return score + readable / Math.max(1, normalized.length);
    }

    private static extractTypedTextBlocksFromRecord(record: PptRecord): PptTextBlock[] {
        const blocks: PptTextBlock[] = [];

        const visit = (list: PptRecord[]): void => {
            let currentTextType: number | undefined;

            for (const child of list) {
                if (child.recType === 3999 && child.payload.length >= 4) {
                    currentTextType = child.payload.readUInt32LE(0);
                    continue;
                }

                const text = this.decodeTextAtom(child);
                if (text) {
                    blocks.push({
                        text,
                        textType: currentTextType
                    });
                }

                if (child.children && child.children.length > 0) {
                    visit(child.children);
                }
            }
        };

        visit(record.children ?? []);
        return blocks.filter((block) => block.textType !== 2);
    }

    private static extractShapeTextGroupsFromRecord(record: PptRecord, counter?: { value: number }): PptTextGroup[] {
        const groups: PptTextGroup[] = [];
        const spIndex = counter ?? { value: 0 };

        const visit = (list: PptRecord[], insideShapeContainer: boolean, groupTransforms: Array<{ internal: PptShapeBounds; external: PptShapeBounds }>): void => {
            for (const child of list) {
                if (child.recType === 0xf003 && child.children && child.children.length > 0) {
                    const transform = this.extractGroupTransform(child);
                    const newTransforms = transform
                        ? [...groupTransforms, transform]
                        : groupTransforms;
                    const groupChildren = transform ? child.children.slice(1) : child.children;
                    visit(groupChildren, insideShapeContainer, newTransforms);
                    continue;
                }

                if (child.recType === 0xf004 && child.children && child.children.length > 0) {
                    const currentIndex = spIndex.value++;
                    const hasClientTextbox = child.children.some((entry) => entry.recType === 0xf00d);
                    if (hasClientTextbox) {
                        const groupBlocks = this.extractTypedTextBlocksFromSequence(child.children);
                        if (groupBlocks.length > 0) {
                            let bounds = this.extractShapeBoundsFromSpContainer(child);
                            if (bounds && groupTransforms.length > 0) {
                                bounds = this.applyGroupTransforms(bounds, groupTransforms);
                            }
                            groups.push({
                                blocks: groupBlocks,
                                bounds,
                                spContainerIndex: currentIndex,
                                ...this.extractShapeStyleFromSpContainer(child)
                            });
                        }
                    }

                    visit(child.children, true, groupTransforms);
                    continue;
                }

                if (!insideShapeContainer && child.recType === 0xf00d && child.children && child.children.length > 0) {
                    const groupBlocks = this.extractTypedTextBlocksFromSequence(child.children);
                    if (groupBlocks.length > 0) {
                        groups.push({ blocks: groupBlocks });
                    }
                }

                if (child.children && child.children.length > 0 && child.recType !== 0xf003) {
                    visit(child.children, insideShapeContainer, groupTransforms);
                }
            }
        };

        visit(record.children ?? [], false, []);
        return groups;
    }

    private static extractStyledTextBlocksFromShapes(record: PptRecord): PptTextBlock[] {
        const blocks: PptTextBlock[] = [];

        const visit = (list: PptRecord[], groupTransforms: Array<{ internal: PptShapeBounds; external: PptShapeBounds }>): void => {
            for (const child of list) {
                if (child.recType === 0xf003 && child.children && child.children.length > 0) {
                    const transform = this.extractGroupTransform(child);
                    const newTransforms = transform
                        ? [...groupTransforms, transform]
                        : groupTransforms;
                    const groupChildren = transform ? child.children.slice(1) : child.children;
                    visit(groupChildren, newTransforms);
                    continue;
                }

                if (child.recType === 0xf004 && child.children && child.children.length > 0) {
                    const hasClientTextbox = child.children.some((entry) => entry.recType === 0xf00d);
                    if (!hasClientTextbox) {
                        const strings = this.extractStyledStringsFromSpContainer(child);
                        strings.forEach((item) => {
                            let bounds = this.extractShapeBoundsFromSpContainer(child);
                            if (bounds && groupTransforms.length > 0) {
                                bounds = this.applyGroupTransforms(bounds, groupTransforms);
                            }
                            // For very tall shapes (decorative shapes like pentagons),
                            // position text at bottom portion
                            if (bounds && bounds.height > bounds.width * 2) {
                                const textHeight = Math.min(bounds.height * 0.15, 300);
                                bounds = {
                                    x: bounds.x - bounds.width * 0.5,
                                    y: bounds.y + bounds.height - textHeight,
                                    width: bounds.width * 2,
                                    height: textHeight
                                };
                            }
                            blocks.push({
                                text: item.text,
                                textType: 0,
                                bounds,
                                color: item.color,
                                fontSizePx: item.fontSizePx
                            });
                        });
                    }
                }

                if (child.children && child.children.length > 0 && child.recType !== 0xf003) {
                    visit(child.children, groupTransforms);
                }
            }
        };

        visit(record.children ?? [], []);
        return blocks;
    }

    private static extractStyledStringsFromSpContainer(record: PptRecord): Array<{
        text: string;
        color?: string;
        fontSizePx?: number;
    }> {
        const fopt = (record.children ?? []).find((child) => child.recType === 0xf00b && child.payload.length >= 6);
        if (!fopt) {
            return [];
        }

        const propertyBytes = Math.min(fopt.payload.length, fopt.recInstance * 6);
        const complexPayload = fopt.payload.subarray(propertyBytes);
        const candidates = complexPayload.toString('utf16le')
            .replace(/\u0000/g, '\n')
            .split(/\n+/)
            .map((value) => value.trim())
            .filter((value) => value.length >= 2)
            .filter((value) => /[가-힣]/.test(value))
            .filter((value) => !/(rrect|화살표|arrow|\-윤고딕)/i.test(value))
            .filter((value) => !/^(HY|한컴|굴림|돋움|바탕|궁서)/i.test(value))
            .filter((value) => !/(고딕|명조|체)$/.test(value));

        const deduped = new Set<string>();
        const colorHint = this.extractShapeStyleFromSpContainer(record).fillColor;

        return candidates.flatMap((text) => {
            if (deduped.has(text) || this.isNoiseText(text)) {
                return [];
            }
            deduped.add(text);

            const color = colorHint;
            return [{ text, color }];
        });
    }

    private static extractGroupTransform(
        spgrContainer: PptRecord
    ): { internal: PptShapeBounds; external: PptShapeBounds } | null {
        if (!spgrContainer.children || spgrContainer.children.length === 0) {
            return null;
        }
        const firstChild = spgrContainer.children[0];
        if (firstChild.recType !== 0xf004 || !firstChild.children) {
            return null;
        }

        let internal: PptShapeBounds | undefined;
        let external: PptShapeBounds | undefined;

        for (const rec of firstChild.children) {
            // FSPGR (0xf009) defines internal coordinate space
            if (rec.recType === 0xf009 && rec.payload.length >= 16) {
                const left = rec.payload.readInt32LE(0);
                const top = rec.payload.readInt32LE(4);
                const right = rec.payload.readInt32LE(8);
                const bottom = rec.payload.readInt32LE(12);
                internal = this.makeBounds(left, top, right, bottom) ?? undefined;
            }
            // ChildAnchor (0xf010) or ClientAnchor (0xf00f) defines position in parent
            if (rec.recType === 0xf010) {
                if (rec.payload.length >= 16) {
                    external = this.readRectBounds32(rec.payload) ?? undefined;
                } else if (rec.payload.length >= 8) {
                    // 8-byte ChildAnchor uses (top, left, right, bottom) format.
                    // For group anchors, always use this fixed byte order instead
                    // of the heuristic in readRectBounds16.
                    const top = rec.payload.readInt16LE(0);
                    const left = rec.payload.readInt16LE(2);
                    const right = rec.payload.readInt16LE(4);
                    const bottom = rec.payload.readInt16LE(6);
                    external = this.makeBounds(left, top, right, bottom) ?? undefined;
                }
            }
            if (!external && rec.recType === 0xf00f && rec.payload.length >= 16) {
                external = this.readRectBounds32(rec.payload) ?? undefined;
            }
        }

        if (!internal || !external || internal.width <= 0 || internal.height <= 0) {
            return null;
        }

        return { internal, external };
    }

    private static applyGroupTransforms(
        bounds: PptShapeBounds,
        transforms: Array<{ internal: PptShapeBounds; external: PptShapeBounds }>
    ): PptShapeBounds {
        let result = bounds;
        for (let i = transforms.length - 1; i >= 0; i--) {
            const { internal, external } = transforms[i];
            const scaleX = external.width / internal.width;
            const scaleY = external.height / internal.height;
            result = {
                x: external.x + (result.x - internal.x) * scaleX,
                y: external.y + (result.y - internal.y) * scaleY,
                width: result.width * scaleX,
                height: result.height * scaleY
            };
        }
        return result;
    }

    private static extractVisualSlotsFromRecord(record: PptRecord, counter?: { value: number }): PptVisualSlot[] {
        const slots: PptVisualSlot[] = [];
        const spIndex = counter ?? { value: 0 };

        const visit = (list: PptRecord[], groupTransforms: Array<{ internal: PptShapeBounds; external: PptShapeBounds }>): void => {
            for (const child of list) {
                if (child.recType === 0xf003 && child.children && child.children.length > 0) {
                    const transform = this.extractGroupTransform(child);
                    const newTransforms = transform
                        ? [...groupTransforms, transform]
                        : groupTransforms;
                    // Skip the first SpContainer (group definition shape)
                    const groupChildren = transform ? child.children.slice(1) : child.children;
                    visit(groupChildren, newTransforms);
                    continue;
                }

                if (child.recType === 0xf004 && child.children && child.children.length > 0) {
                    const currentIndex = spIndex.value++;
                    const hasClientTextbox = child.children.some((entry) => entry.recType === 0xf00d);
                    let bounds = this.extractShapeBoundsFromSpContainer(child);
                    if (bounds && groupTransforms.length > 0) {
                        bounds = this.applyGroupTransforms(bounds, groupTransforms);
                    }
                    if (!hasClientTextbox) {
                        const style = this.extractShapeStyleFromSpContainer(child);
                        if (bounds) {
                            slots.push({
                                bounds,
                                imageRefId: this.extractShapeImageRefFromSpContainer(child),
                                ...style,
                                isTextSlot: false,
                                spContainerIndex: currentIndex
                            });
                        }
                    } else {
                        const style = this.extractShapeStyleFromSpContainer(child);
                        if (bounds || style.fillColor || style.borderColor || style.borderWidthPx !== undefined) {
                            slots.push({
                                bounds,
                                imageRefId: this.extractShapeImageRefFromSpContainer(child),
                                ...style,
                                isTextSlot: true,
                                spContainerIndex: currentIndex
                            });
                        }
                    }
                }

                if (child.children && child.children.length > 0 && child.recType !== 0xf003) {
                    visit(child.children, groupTransforms);
                }
            }
        };

        visit(record.children ?? [], []);
        return slots;
    }

    private static extractShapeBoundsFromSpContainer(record: PptRecord): PptShapeBounds | undefined {
        for (const child of record.children ?? []) {
            if (child.recType === 0xf00f && child.payload.length >= 16) {
                return this.readRectBounds32(child.payload);
            }

            if (child.recType === 0xf010) {
                if (child.payload.length >= 16) {
                    return this.readRectBounds32(child.payload);
                }
                if (child.payload.length >= 8) {
                    return this.readRectBounds16(child.payload);
                }
            }
        }

        return undefined;
    }

    private static extractShapeStyleFromSpContainer(record: PptRecord): {
        fillColor?: string;
        borderColor?: string;
        borderWidthPx?: number;
        fillVisible?: boolean;
        borderVisible?: boolean;
    } {
        for (const child of record.children ?? []) {
            if (child.recType !== 0xf00b || child.payload.length < 6) {
                continue;
            }

            const propertyCount = child.recInstance;
            let fillColor: string | undefined;
            let borderColor: string | undefined;
            let borderWidthPx: number | undefined;
            let fillVisible: boolean | undefined;
            let borderVisible: boolean | undefined;

            for (let index = 0; index < propertyCount; index++) {
                const offset = index * 6;
                if (offset + 6 > child.payload.length) {
                    break;
                }

                const rawOpid = child.payload.readUInt16LE(offset);
                const opid = rawOpid & 0x3fff;
                const isComplex = (rawOpid & 0x8000) !== 0;
                if (isComplex) {
                    continue;
                }

                const value = child.payload.readUInt32LE(offset + 2);
                if (opid === 0x0181) {
                    fillColor = this.readOfficeArtColorRef(value) ?? fillColor;
                } else if (opid === 0x01c0) {
                    borderColor = this.readOfficeArtColorRef(value) ?? borderColor;
                } else if (opid === 0x01cb) {
                    borderWidthPx = this.emuToPixels(value);
                } else if (opid === 0x01bf) {
                    borderVisible = value !== 0;
                } else if (opid === 0x01bf - 0x3f) {
                    fillVisible = value !== 0;
                }
            }

            if (fillColor || borderColor || borderWidthPx !== undefined || fillVisible !== undefined || borderVisible !== undefined) {
                return { fillColor, borderColor, borderWidthPx, fillVisible, borderVisible };
            }
        }

        return {};
    }

    private static extractShapeImageRefFromSpContainer(record: PptRecord): number | undefined {
        for (const child of record.children ?? []) {
            if (child.recType !== 0xf00b || child.payload.length < 6) {
                continue;
            }

            const propertyCount = child.recInstance;
            for (let index = 0; index < propertyCount; index++) {
                const offset = index * 6;
                if (offset + 6 > child.payload.length) {
                    break;
                }

                const rawOpid = child.payload.readUInt16LE(offset);
                const opid = rawOpid & 0x3fff;
                const isComplex = (rawOpid & 0x8000) !== 0;
                const isBlipId = (rawOpid & 0x4000) !== 0;
                if (isComplex || !isBlipId) {
                    continue;
                }

                if (opid === 0x0104 || opid === 0x0186) {
                    const value = child.payload.readUInt32LE(offset + 2);
                    if (value > 0) {
                        return value;
                    }
                }
            }
        }

        return undefined;
    }

    private static readRectBounds32(payload: Buffer): PptShapeBounds | undefined {
        if (payload.length < 16) {
            return undefined;
        }

        const left = payload.readInt32LE(0);
        const top = payload.readInt32LE(4);
        const right = payload.readInt32LE(8);
        const bottom = payload.readInt32LE(12);
        return this.makeBounds(left, top, right, bottom);
    }

    private static readRectBounds16(payload: Buffer): PptShapeBounds | undefined {
        if (payload.length < 8) {
            return undefined;
        }

        const first = payload.readInt16LE(0);
        const second = payload.readInt16LE(2);
        const third = payload.readInt16LE(4);
        const fourth = payload.readInt16LE(6);

        const standard = this.makeBounds(first, second, third, fourth);
        const swapped = this.makeBounds(second, first, third, fourth);

        if (!standard) {
            return swapped;
        }
        if (!swapped) {
            return standard;
        }

        const standardRatio = standard.width / Math.max(1, standard.height);
        const swappedRatio = swapped.width / Math.max(1, swapped.height);
        const standardExtreme = standardRatio < 0.45 || standardRatio > 2.2;
        const swappedExtreme = swappedRatio < 0.45 || swappedRatio > 2.2;

        if (standardExtreme && !swappedExtreme) {
            return swapped;
        }
        if (!standardExtreme && swappedExtreme) {
            return standard;
        }

        // Both extreme or both normal: prefer swapped (top, left, right, bottom)
        // which is the common PPT 8-byte ChildAnchor format.
        const swappedArea = swapped.width * swapped.height;
        const standardArea = standard.width * standard.height;
        if (
            swappedArea > standardArea * 1.05
            && Math.abs(swappedRatio - 1) < Math.abs(standardRatio - 1)
        ) {
            return swapped;
        }

        // When both are extreme, prefer swapped as PPT commonly uses (top, left, right, bottom).
        if (standardExtreme && swappedExtreme) {
            return swapped;
        }

        return standard;
    }

    private static makeBounds(left: number, top: number, right: number, bottom: number): PptShapeBounds | undefined {
        const width = right - left;
        const height = bottom - top;
        if (!Number.isFinite(left) || !Number.isFinite(top) || width <= 0 || height <= 0) {
            return undefined;
        }

        return {
            x: left,
            y: top,
            width,
            height
        };
    }

    private static readOfficeArtColorRef(value: number): string | undefined {
        const flagByte = (value >>> 24) & 0xff;
        if (flagByte !== 0) {
            return undefined;
        }

        const red = value & 0xff;
        const green = (value >>> 8) & 0xff;
        const blue = (value >>> 16) & 0xff;
        return this.rgbToHex(red, green, blue);
    }

    private static emuToPixels(emu: number): number | undefined {
        if (!Number.isFinite(emu) || emu <= 0) {
            return undefined;
        }

        return Math.max(1, Math.round(emu / 9525));
    }

    private static normalizeBounds(
        bounds: PptShapeBounds,
        slideWidth: number,
        slideHeight: number,
        presentationMetrics?: {
            widthPx: number;
            heightPx: number;
            rawWidth: number;
            rawHeight: number;
        } | null
    ): PptShapeBounds {
        let scaled = bounds;
        if (presentationMetrics && presentationMetrics.rawWidth > 0 && presentationMetrics.rawHeight > 0) {
            const scaleX = slideWidth / presentationMetrics.rawWidth;
            const scaleY = slideHeight / presentationMetrics.rawHeight;
            scaled = {
                x: Math.round(bounds.x * scaleX),
                y: Math.round(bounds.y * scaleY),
                width: Math.round(bounds.width * scaleX),
                height: Math.round(bounds.height * scaleY)
            };
        }

        const width = Math.max(24, Math.min(slideWidth, scaled.width));
        const height = Math.max(24, Math.min(slideHeight, scaled.height));
        const maxX = Math.max(0, slideWidth - width);
        const maxY = Math.max(0, slideHeight - height);
        const x = Math.max(0, Math.min(maxX, scaled.x));
        const y = Math.max(0, Math.min(maxY, scaled.y));

        return { x, y, width, height };
    }

    private static dedupeVisualSlots(slots: PptVisualSlot[]): PptVisualSlot[] {
        const sorted = [...slots].sort((left, right) => {
            const leftArea = (left.bounds?.width ?? 0) * (left.bounds?.height ?? 0);
            const rightArea = (right.bounds?.width ?? 0) * (right.bounds?.height ?? 0);
            const leftScore = (left.imageRefId !== undefined ? 1_000_000 : 0) + leftArea;
            const rightScore = (right.imageRefId !== undefined ? 1_000_000 : 0) + rightArea;
            return rightScore - leftScore;
        });

        const deduped: PptVisualSlot[] = [];
        sorted.forEach((slot) => {
            if (!slot.bounds) {
                return;
            }
            const slotArea = slot.bounds!.width * slot.bounds!.height;
            const overlapsExisting = deduped.some((existing) => {
                if (!existing.bounds) {
                    return false;
                }
                const existingArea = existing.bounds.width * existing.bounds.height;
                if (existingArea > slotArea * 8) {
                    return false;
                }
                // Don't dedup slots with different image references
                if (slot.imageRefId !== undefined && existing.imageRefId !== undefined
                    && slot.imageRefId !== existing.imageRefId) {
                    return false;
                }
                return this.boundsOverlapRatio(slot.bounds!, existing.bounds) > 0.72;
            });
            if (!overlapsExisting) {
                deduped.push(slot);
            }
        });

        return deduped;
    }

    private static selectPreferredImageRefSlots(
        slots: PptVisualSlot[],
        picturesById: Map<number, PptPictureAsset> | undefined
    ): PptVisualSlot[] {
        if (!picturesById || slots.length < 2) {
            return slots;
        }

        // Count how many blip IDs share the same content to detect master/template images.
        const assetContentFrequency = new Map<string, number>();
        for (const [, asset] of picturesById.entries()) {
            const sig = asset.base64.substring(0, 200);
            assetContentFrequency.set(sig, (assetContentFrequency.get(sig) || 0) + 1);
        }

        const preferred: PptVisualSlot[] = [];
        const consumed = new Set<number>();

        slots.forEach((slot, index) => {
            if (!slot.bounds || slot.imageRefId === undefined || consumed.has(index)) {
                if (!consumed.has(index)) {
                    preferred.push(slot);
                    consumed.add(index);
                }
                return;
            }

            const slotArea = slot.bounds!.width * slot.bounds!.height;
            const group = slots
                .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
                .filter(({ candidate, candidateIndex }) => {
                    if (consumed.has(candidateIndex) || !candidate.bounds || candidate.imageRefId === undefined) {
                        return false;
                    }
                    // Don't group slots with different image refs if they differ significantly in size
                    if (candidate.imageRefId !== slot.imageRefId) {
                        const candidateArea = candidate.bounds.width * candidate.bounds.height;
                        if (Math.max(slotArea, candidateArea) > Math.min(slotArea, candidateArea) * 2) {
                            return false;
                        }
                    }
                    return this.boundsOverlapRatio(slot.bounds!, candidate.bounds) > 0.95;
                });

            const best = group
                .slice()
                .sort((left, right) => {
                    const leftAsset = picturesById.get(left.candidate.imageRefId!);
                    const rightAsset = picturesById.get(right.candidate.imageRefId!);
                    const leftFreq = leftAsset ? (assetContentFrequency.get(leftAsset.base64.substring(0, 200)) || 1) : 1;
                    const rightFreq = rightAsset ? (assetContentFrequency.get(rightAsset.base64.substring(0, 200)) || 1) : 1;
                    // Prefer unique (low frequency) images over master/template (high frequency) duplicates.
                    if (leftFreq !== rightFreq) {
                        return leftFreq - rightFreq;
                    }
                    // Prefer higher spContainerIndex (last drawn = visible on top in PPT rendering).
                    const leftIdx = left.candidate.spContainerIndex ?? -1;
                    const rightIdx = right.candidate.spContainerIndex ?? -1;
                    if (leftIdx !== rightIdx) {
                        return rightIdx - leftIdx;
                    }
                    const leftBytes = leftAsset ? this.decodedAssetByteLength(leftAsset) : 0;
                    const rightBytes = rightAsset ? this.decodedAssetByteLength(rightAsset) : 0;
                    return rightBytes - leftBytes;
                })[0];

            if (best) {
                preferred.push(best.candidate);
                group.forEach(({ candidateIndex }) => consumed.add(candidateIndex));
            }
        });

        return preferred;
    }

    private static boundsOverlapRatio(left: PptShapeBounds, right: PptShapeBounds): number {
        const x1 = Math.max(left.x, right.x);
        const y1 = Math.max(left.y, right.y);
        const x2 = Math.min(left.x + left.width, right.x + right.width);
        const y2 = Math.min(left.y + left.height, right.y + right.height);
        if (x2 <= x1 || y2 <= y1) {
            return 0;
        }

        const intersection = (x2 - x1) * (y2 - y1);
        const smallerArea = Math.max(1, Math.min(left.width * left.height, right.width * right.height));
        return intersection / smallerArea;
    }

    private static boundsIntersect(left: PptShapeBounds, right: PptShapeBounds): boolean {
        return left.x < right.x + right.width
            && left.x + left.width > right.x
            && left.y < right.y + right.height
            && left.y + left.height > right.y;
    }

    private static extractTypedTextBlocksFromSequence(records: PptRecord[]): PptTextBlock[] {
        const blocks: PptTextBlock[] = [];
        let currentTextType: number | undefined;
        let pendingStyleProp: PptRecord | undefined;

        for (let ri = 0; ri < records.length; ri++) {
            const record = records[ri];
            if (record.recType === 3999 && record.payload.length >= 4) {
                currentTextType = record.payload.readUInt32LE(0);
                continue;
            }

            // StyleTextPropAtom (4001) follows its text atom
            if (record.recType === 4001) {
                pendingStyleProp = record;
                continue;
            }

            const text = this.decodeTextAtom(record);
            if (!text) {
                if (record.children && record.children.length > 0) {
                    const nestedBlocks = this.extractTypedTextBlocksFromSequence(record.children);
                    if (nestedBlocks.length > 0) {
                        blocks.push(...nestedBlocks.map((block) => ({
                            ...block,
                            textType: block.textType ?? currentTextType
                        })));
                    }
                }
                continue;
            }

            // Look ahead for StyleTextPropAtom
            let styleProp = pendingStyleProp;
            pendingStyleProp = undefined;
            if (!styleProp) {
                for (let si = ri + 1; si < records.length && si <= ri + 4; si++) {
                    if (records[si].recType === 4001) {
                        styleProp = records[si];
                        break;
                    }
                }
            }

            const style = styleProp ? this.extractTextRunStyle(styleProp.payload) : undefined;
            blocks.push({
                text,
                textType: currentTextType,
                color: style?.color,
                fontSizePx: style?.fontSizePx
            });
        }

        return blocks.filter((block) => block.textType !== 2);
    }

    /**
     * Extract dominant text color and font size from a StyleTextPropAtom payload.
     * Parses the paragraph run then character run per MS-PPT spec.
     */
    private static extractTextRunStyle(payload: Buffer): { color?: string; fontSizePx?: number } | undefined {
        if (payload.length < 12) {
            return undefined;
        }

        try {
            let offset = 0;

            // --- Paragraph run ---
            // charCount (4) + indentLevel (2) + paraMask (4)
            offset += 4; // charCount
            offset += 2; // indentLevel
            if (offset + 4 > payload.length) {
                return undefined;
            }
            const paraMask = payload.readUInt32LE(offset);
            offset += 4;

            // Skip paragraph properties based on mask
            if (paraMask & 0x000f) { offset += 2; } // bulletFlags
            if (paraMask & 0x0010) { offset += 2; } // bulletChar
            if (paraMask & 0x0020) { offset += 2; } // bulletFont
            if (paraMask & 0x0040) { offset += 2; } // bulletSize
            if (paraMask & 0x0080) { offset += 4; } // bulletColor
            if (paraMask & 0x0100) { offset += 2; } // leftMargin
            if (paraMask & 0x0200) { offset += 2; } // indent
            if (paraMask & 0x0400) { offset += 2; } // defaultTabSize
            if (paraMask & 0x0800) { offset += 2; } // alignment
            if (paraMask & 0x1000) { offset += 2; } // lineSpacing
            if (paraMask & 0x2000) { offset += 2; } // spaceBefore
            if (paraMask & 0x4000) { offset += 2; } // spaceAfter

            // --- Character run ---
            // charCount (4) + charMask (4)
            if (offset + 8 > payload.length) {
                return undefined;
            }
            offset += 4; // charCount
            const charMask = payload.readUInt32LE(offset);
            offset += 4;

            // Read character properties in MS-PPT spec order
            if (charMask & 0x03ff) { offset += 2; } // fontStyle (if any bool bit set)
            if (charMask & 0x00010000) { offset += 2; } // typeface
            if (charMask & 0x00100000) { offset += 2; } // oldEATypeface
            if (charMask & 0x00200000) { offset += 2; } // ansiTypeface
            if (charMask & 0x00400000) { offset += 2; } // symbolTypeface

            let fontSizePx: number | undefined;
            if (charMask & 0x00020000) {
                if (offset + 2 <= payload.length) {
                    const rawSize = payload.readUInt16LE(offset);
                    if (rawSize >= 6 && rawSize <= 400) {
                        fontSizePx = Math.round(rawSize * this.POINTS_TO_PX);
                    }
                }
                offset += 2;
            }

            let color: string | undefined;
            if (charMask & 0x00040000) {
                if (offset + 4 <= payload.length) {
                    const colorValue = payload.readUInt32LE(offset);
                    const flag = (colorValue >>> 24) & 0xff;
                    if (flag === 0xfe) {
                        const r = colorValue & 0xff;
                        const g = (colorValue >>> 8) & 0xff;
                        const b = (colorValue >>> 16) & 0xff;
                        if (r !== 0 || g !== 0 || b !== 0) {
                            color = this.rgbToHex(r, g, b);
                        }
                    }
                }
            }

            if (!color && !fontSizePx) {
                return undefined;
            }
            return { color, fontSizePx };
        } catch {
            return undefined;
        }
    }

    private static decorateTextBlocksWithPlaceholders(blocks: PptTextBlock[], layout: PptSlideLayoutInfo | null): PptTextBlock[] {
        if (!layout || blocks.length === 0) {
            return blocks;
        }

        const textPlaceholders = layout.placeholders.filter((value) => this.isTextPlaceholder(value));
        if (textPlaceholders.length === 0) {
            return blocks;
        }

        return blocks.map((block, index) => ({
            ...block,
            placeholderType: block.placeholderType ?? textPlaceholders[index]
        }));
    }

    private static decorateTextGroupsWithPlaceholders(groups: PptTextGroup[], layout: PptSlideLayoutInfo | null): PptTextGroup[] {
        if (!layout || groups.length === 0) {
            return groups;
        }

        const textPlaceholders = layout.placeholders.filter((value) => this.isTextPlaceholder(value));
        if (textPlaceholders.length === 0) {
            return groups;
        }

        return groups.map((group, index) => ({
            ...group,
            placeholderType: group.placeholderType ?? textPlaceholders[index],
            blocks: group.blocks.map((block) => ({
                ...block,
                placeholderType: block.placeholderType ?? textPlaceholders[index]
            }))
        }));
    }

    private static decorateVisualSlotsWithPlaceholders(slots: PptVisualSlot[], layout: PptSlideLayoutInfo | null): PptVisualSlot[] {
        if (!layout || slots.length === 0) {
            return slots;
        }

        const placeholders = layout.placeholders.filter((value) => value !== 0x00 && value !== 0xff);
        if (placeholders.length === 0) {
            return slots;
        }

        return slots.map((slot, index) => ({
            ...slot,
            placeholderType: slot.placeholderType ?? placeholders[index]
        }));
    }

    private static isTextPlaceholder(value: number): boolean {
        return value === 0x01
            || value === 0x02
            || value === 0x03
            || value === 0x04
            || value === 0x0d
            || value === 0x0e
            || value === 0x0f
            || value === 0x10
            || value === 0x11
            || value === 0x12;
    }

    private static isVisualPlaceholder(value: number | undefined): boolean {
        return value === 0x08
            || value === 0x0b
            || value === 0x0c
            || value === 0x0e
            || value === 0x14
            || value === 0x15;
    }

    private static classifyPlaceholderType(value: number | undefined): 'title' | 'subtitle' | 'body' | 'other' {
        if (value === 0x0f || value === 0x0d || value === 0x11 || value === 0x03 || value === 0x01) {
            return 'title';
        }
        if (value === 0x10 || value === 0x04) {
            return 'subtitle';
        }
        if (value === 0x0e || value === 0x12 || value === 0x02 || value === 0x06 || value === 0x0c) {
            return 'body';
        }
        return 'other';
    }

    private static extractSlideColorScheme(record: PptRecord): PptColorScheme | null {
        const colorSchemeAtom = (record.children ?? []).find((child) => child.recType === 2032 && child.payload.length >= 32);
        if (!colorSchemeAtom) {
            return null;
        }

        return {
            backgroundColor: this.readColorStruct(colorSchemeAtom.payload, 0),
            textColor: this.readColorStruct(colorSchemeAtom.payload, 4),
            titleColor: this.readColorStruct(colorSchemeAtom.payload, 12),
            fillColor: this.readColorStruct(colorSchemeAtom.payload, 16)
        };
    }

    private static extractDocumentColorScheme(records: PptRecord[]): PptColorScheme | null {
        for (const record of records) {
            if ((record.recType === 1000 || record.recType === 1016) && record.children && record.children.length > 0) {
                const directScheme = this.extractSlideColorScheme(record);
                if (directScheme) {
                    return directScheme;
                }
            }

            if (record.children && record.children.length > 0) {
                const nestedScheme = this.extractDocumentColorScheme(record.children);
                if (nestedScheme) {
                    return nestedScheme;
                }
            }
        }

        return null;
    }

    private static readColorStruct(payload: Buffer, offset: number): string | undefined {
        if (offset < 0 || offset + 4 > payload.length) {
            return undefined;
        }

        const red = payload.readUInt8(offset);
        const green = payload.readUInt8(offset + 1);
        const blue = payload.readUInt8(offset + 2);
        return this.rgbToHex(red, green, blue);
    }

    private static rgbToHex(red: number, green: number, blue: number): string {
        const toHex = (value: number) => value.toString(16).padStart(2, '0');
        return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
    }

    private static extractTextsFromRecord(record: PptRecord): string[] {
        const texts: string[] = [];
        const visit = (r: PptRecord) => {
            const isTextType = r.recType === 4000 || r.recType === 3998 || r.recType === 4026 || r.recType === 4086;
            const isOfficeArtRecord = r.recType >= 0xf000 && r.recType <= 0xf3ff;
            if (isTextType || (!isOfficeArtRecord && r.recVer !== 0x0f && r.payload.length > 4 && r.payload.length < 4096)) {
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

        // Legacy byte chunks (for example CP949/EUC-KR decks)
        const legacy = this.decodeLegacyByteText(payload)
            .split(/[\x00-\x1f]+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 2 && /[A-Za-z0-9가-힣]/.test(s) && this.isMostlyReadable(s));
        out.push(...legacy);

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
        if (/^[^A-Za-z0-9가-힣]+$/.test(t)) return true;
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

    private static extractPictures(picturesStream: Buffer | null): PptPictureAsset[] {
        if (!picturesStream || picturesStream.length === 0) return [];
        const out: PptPictureAsset[] = [];

        // PNG scan
        const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        let idx = 0;
        while ((idx = picturesStream.indexOf(pngSig, idx)) !== -1) {
            const end = this.findPngEnd(picturesStream, idx);
            if (end > idx) {
                out.push({ mime: 'image/png', base64: picturesStream.slice(idx, end).toString('base64'), pictureIndex: out.length });
                idx = end;
            } else {
                idx += pngSig.length;
            }
        }

        // JPEG scan
        idx = 0;
        while ((idx = picturesStream.indexOf(Buffer.from([0xff, 0xd8]), idx)) !== -1) {
            const end = this.findJpegEnd(picturesStream, idx);
            if (end > idx) {
                out.push({
                    mime: 'image/jpeg',
                    base64: picturesStream.slice(idx, end).toString('base64'),
                    pictureIndex: out.length
                });
                idx = end;
            } else {
                idx += 2;
            }
        }

        return out;
    }

    private static extractPicturesByBlipId(
        records: PptRecord[],
        picturesStream: Buffer | null,
        pictures: PptPictureAsset[] = []
    ): Map<number, PptPictureAsset> {
        const byId = new Map<number, PptPictureAsset>();
        if (!picturesStream || picturesStream.length === 0) {
            return byId;
        }

        const entries: PptRecord[] = [];
        const visit = (list: PptRecord[]): void => {
            for (const record of list) {
                if (record.recType === 0xf007 && record.payload.length >= 36) {
                    entries.push(record);
                }
                if (record.children && record.children.length > 0) {
                    visit(record.children);
                }
            }
        };
        visit(records);

        entries.forEach((entry, index) => {
            const offset = entry.payload.readUInt32LE(28);
            const size = entry.payload.readUInt32LE(20);
            const asset = this.extractPictureAtOffset(picturesStream, offset, size, pictures);
            if (asset) {
                byId.set(index + 1, asset);
            }
        });

        return byId;
    }

    private static extractPictureAtOffset(
        picturesStream: Buffer,
        offset: number,
        expectedSize: number,
        pictures: PptPictureAsset[] = []
    ): PptPictureAsset | null {
        if (!Number.isFinite(offset) || offset < 0 || offset >= picturesStream.length) {
            return null;
        }

        const probe = picturesStream.subarray(offset, Math.min(picturesStream.length, offset + 96));
        const pngOffset = probe.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        if (pngOffset !== -1) {
            const start = offset + pngOffset;
            const end = expectedSize > 0 && start + expectedSize <= picturesStream.length
                ? start + expectedSize
                : this.findPngEnd(picturesStream, start);
            if (end > start) {
                const base64 = picturesStream.slice(start, end).toString('base64');
                const pictureIndex = pictures.findIndex((picture) => picture.base64 === base64);
                return {
                    mime: 'image/png',
                    base64,
                    pictureIndex: pictureIndex >= 0 ? pictureIndex : undefined
                };
            }
        }

        const jpegOffset = probe.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
        if (jpegOffset !== -1) {
            const start = offset + jpegOffset;
            let end = -1;
            // Try to determine the BLIP record boundary from its OfficeArt header.
            // The BStoreEntry offset points to the start of the BLIP record which
            // has an 8-byte header (ver/type 4 bytes + length 4 bytes).
            if (offset + 8 <= picturesStream.length) {
                const recType = picturesStream.readUInt16LE(offset + 2);
                if (recType >= 0xf018 && recType <= 0xf117) {
                    const recLen = picturesStream.readUInt32LE(offset + 4);
                    const blipEnd = offset + 8 + recLen;
                    if (blipEnd <= picturesStream.length && blipEnd > start) {
                        // Scan backwards from the BLIP end to find the FFD9 terminator
                        for (let scan = blipEnd - 2; scan >= start + 2; scan--) {
                            if (picturesStream[scan] === 0xff && picturesStream[scan + 1] === 0xd9) {
                                end = scan + 2;
                                break;
                            }
                        }
                    }
                }
            }
            if (end === -1) {
                end = this.findJpegEnd(picturesStream, start);
            }
            if (end > start) {
                const base64 = picturesStream.slice(start, end).toString('base64');
                const pictureIndex = pictures.findIndex((picture) => picture.base64 === base64);
                return {
                    mime: 'image/jpeg',
                    base64,
                    pictureIndex: pictureIndex >= 0 ? pictureIndex : undefined
                };
            }
        }

        return null;
    }

    /**
     * Walk JPEG marker segments to find the real EOI (FFD9), avoiding false
     * end markers embedded inside metadata segments like Photoshop APP13.
     */
    private static findJpegEnd(buf: Buffer, start: number): number {
        let pos = start + 2; // skip SOI (FFD8)
        while (pos < buf.length - 1) {
            if (buf[pos] !== 0xff) { pos++; continue; }
            const marker = buf[pos + 1];
            // Byte-stuffed 0xFF00 or padding 0xFFFF — skip
            if (marker === 0x00 || marker === 0xff) { pos++; continue; }
            // EOI
            if (marker === 0xd9) return pos + 2;
            // SOS (FFDA) — entropy-coded data follows; scan for next marker
            if (marker === 0xda) {
                if (pos + 3 >= buf.length) return -1;
                const sosLen = buf.readUInt16BE(pos + 2);
                let scan = pos + 2 + sosLen;
                while (scan < buf.length - 1) {
                    if (buf[scan] === 0xff) {
                        const m = buf[scan + 1];
                        if (m === 0xd9) return scan + 2;
                        if (m === 0x00) { scan += 2; continue; } // stuffed byte
                        if (m >= 0xd0 && m <= 0xd7) { scan += 2; continue; } // RST markers
                        // Another marker (e.g. DHT, SOS in multi-scan JPEG) —
                        // resume the main segment-walking loop from here.
                        pos = scan;
                        break;
                    }
                    scan++;
                }
                if (scan >= buf.length - 1) return -1;
                continue;
            }
            // Variable-length segment: read length and skip
            if (pos + 3 >= buf.length) return -1;
            const segLen = buf.readUInt16BE(pos + 2);
            if (segLen < 2) return -1;
            pos += 2 + segLen;
        }
        return -1;
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
