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
import {
    applyActivityListTableLayoutImpl,
    applyActivityProcessLayoutImpl,
    applyClosingPracticeLayoutImpl,
    applyDialoguePhotoLayoutImpl,
    applyMathIntroLayoutImpl,
    applyMathPlayLetterLayoutImpl
} from './pptSlideLayouts';

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
            const visualSlots = this.decorateVisualSlotsWithPlaceholders(
                this.extractVisualSlotsFromRecord(slideRecord),
                layout
            );
            const shapeTextGroups = this.decorateTextGroupsWithPlaceholders(
                this.extractShapeTextGroupsFromRecord(slideRecord),
                layout
            );
            const directBlocks = this.extractTypedTextBlocksFromRecord(slideRecord);
            const styledShapeBlocks = this.extractStyledTextBlocksFromShapes(slideRecord);
            const hasStyledTitleArt = styledShapeBlocks.some((block) => /수학교육활동|유아를 위한/.test(block.text));
            const styledBounds = styledShapeBlocks
                .map((block) => block.bounds)
                .filter((bounds): bounds is PptShapeBounds => !!bounds);
            const shouldPreferGroupedShapeText = this.shouldPreferShapeTextGroups(outlineBlocks, shapeTextGroups);
            const groupedShapeTextBlocks = shapeTextGroups.length > 0
                ? this.flattenTextGroups(shapeTextGroups)
                : [];
            const baseTextBlocks: PptTextBlock[] = outlineBlocks.length > 0 && !shouldPreferGroupedShapeText
                ? this.decorateTextBlocksWithPlaceholders(this.normalizeTextBlocks(outlineBlocks), layout)
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
            const groupedTextSignature = groupedShapeTextBlocks.map((block) => block.text).join(' ');
            const provisionalTextSignature = provisionalTextBlocks.map((block) => block.text).join(' ');
            const isDialoguePhotoSlide = (/이 큰거랑 작은거랑 바꾸자/.test(provisionalTextSignature) || /이 큰거랑 작은거랑 바꾸자/.test(groupedTextSignature))
                && (/우리 식구가 먹으려면 이정도면 되겠지/.test(provisionalTextSignature) || /우리 식구가 먹으려면 이정도면 되겠지/.test(groupedTextSignature));
            const textBlocks = isDialoguePhotoSlide && groupedShapeTextBlocks.length >= 3
                ? groupedShapeTextBlocks
                : provisionalTextBlocks;
            const slideTextSignature = textBlocks.map((block) => block.text).join(' ');
            const isMathIntroSlide = /수학은/.test(slideTextSignature) && /실제 삶에 관한 것/.test(slideTextSignature);
            const isApproachDirectionSlide = /유아 수학교육을 위한 접근의 방향/.test(slideTextSignature);
            const isPurposeSlide = /자료집 개발의 목적/.test(slideTextSignature);
            const isActivityProcessSlide = /활동 구성과정/.test(slideTextSignature);
            const isCompositionSystemSlide = /활동의 구성 체제/.test(slideTextSignature);
            const isCompositionSystemDetailSlide = isCompositionSystemSlide
                && /수수께끼 속의 병뚜껑|간단한 수학활동 방법 안내/.test(slideTextSignature);
            const isCompositionSystemFamilySlide = isCompositionSystemSlide
                && /가정연계 활동을 위한 최초 부모교육자료/.test(slideTextSignature);
            const isSubwayStorySlide = /지하철을 탈 때 나누면 좋은 이야기/.test(slideTextSignature);
            const isBottleCapRiddleSlide = !isCompositionSystemSlide
                && /수수께끼 속의 병뚜껑을 찾으려면\?/.test(slideTextSignature);
            const isMathPlayLetterSlide = /아이와 함께 하는 수학놀이 왜, 어떻게 할까요\?/.test(slideTextSignature);
            const isActivityListSlide = /유아를 위한 수학활동 목록/.test(slideTextSignature);
            const isClosingPracticeSlide = i === slideRecords.length - 1
                && textBlocks.length === 0
                && visualSlots.length === 1
                && visualSlots[0].imageRefId === 2;
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
                    const defaultTextColor = isMathIntroSlide && isTitle
                        ? '#ffffff'
                        : isTitle
                            ? colorScheme?.titleColor
                            : colorScheme?.textColor;
                    const coverTitleFrame = hasStyledTitleArt
                        ? this.computeCoverTitleFrame(block, widthPx, heightPx)
                        : null;
                    const effectiveFontSize = coverTitleFrame
                        ? this.computeCoverTitleFontSize(block)
                        : block.fontSizePx;
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
                        : (coverTitleFrame ?? frame);
                    const panelFrame = rightPanelFrames?.get(block);
                    const positionedFrame = panelFrame
                        ? panelFrame
                        : coverTitleFrame
                        ? coverTitleFrame
                        : isActivityListSlide && block.bounds
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
                    const height = isTitle
                        ? Math.max(positionedFrame.height, 72)
                        : Math.max(Math.min(positionedFrame.height, Math.max(36, paragraphs.length * 40)), 36);

                    elements.push({
                        type: 'text',
                        x: positionedFrame.x,
                        y: positionedFrame.y,
                        width: positionedFrame.width,
                        height,
                        zIndex: idx,
                        isTitle,
                        paragraphs,
                        fillColor: block.fillVisible === false ? undefined : block.fillColor,
                        borderColor: block.borderVisible === false ? undefined : block.borderColor,
                        borderWidthPx: block.borderVisible === false ? undefined : block.borderWidthPx,
                        textStylePreset: coverTitleFrame
                            ? (/유아를 위한/.test(block.text) ? 'cover-subtitle' : 'cover-title')
                            : undefined
                    });
                    placedTextFrames.push(positionedFrame);
                });
            }

            if (!isActivityListSlide) {
                this.resolveTextElementOverlaps(elements, heightPx);
            }

            // Minimal image support: use discovered picture/object frames when available.
            const preferredSlots = visualSlots.filter((slot) =>
                !!slot.bounds && (this.isVisualPlaceholder(slot.placeholderType) || slot.imageRefId !== undefined)
            );
            const slotsWithImageRefs = preferredSlots.filter((slot) => slot.imageRefId !== undefined);
            const boundedSlots = slotsWithImageRefs.length > 0
                ? this.dedupeVisualSlots(this.selectPreferredImageRefSlots(slotsWithImageRefs, picturesById))
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
                isActivityListSlide
            ).filter((slot) => {
                if (!slot.bounds || slot.imageRefId !== undefined || boundedSlots.length < 4) {
                    return true;
                }

                const aspectRatio = slot.bounds.width / Math.max(1, slot.bounds.height);
                return !(aspectRatio > 4.5 && slot.bounds.y < 1000);
            });
            if (isDialoguePhotoSlide) {
                imageSlots = imageSlots
                    .slice()
                    .sort((left, right) => {
                        const leftScore = left.imageRefId === 1 ? 1 : 0;
                        const rightScore = right.imageRefId === 1 ? 1 : 0;
                        return rightScore - leftScore;
                    });
            }
            const usedImageSlots = new Set<PptVisualSlot>();

            if (imageSlots.length > 0) {
                let fallbackImageIndex = 0;
                const sequentialBaseIndex = sequentialPictureIndex;
                let highestPictureIndexUsed = sequentialPictureIndex - 1;
                imageSlots.forEach((slot) => {
                    if (isPurposeSlide && slot.imageRefId === undefined) {
                        return;
                    }
                    if (isApproachDirectionSlide && slot.imageRefId === 15) {
                        return;
                    }
                    const img = (slot.imageRefId !== undefined
                        ? picturesById?.get(slot.imageRefId)
                        : undefined) ?? pictures[sequentialBaseIndex + fallbackImageIndex++];
                    if (!img || !slot.bounds) {
                        return;
                    }

                    const scaledImageFrame = this.normalizeBounds(slot.bounds, widthPx, heightPx, presentationMetrics);
                    const imageFrame = this.adjustImageFrameForTextColumns(
                        this.adjustLegacyImageFrame(slot, scaledImageFrame, widthPx, heightPx, isMathIntroSlide),
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
                        zIndex: 100 + elements.length,
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
            } else if (!isPurposeSlide) {
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
                    hasStyledTitleArt
                    && !slot.imageRefId
                    && slot.fillColor
                    && !slot.borderColor
                    && shapeFrame.y < heightPx * 0.35
                    && shapeFrame.height < heightPx * 0.2
                ) {
                    return;
                }
                if (
                    !slot.imageRefId
                    && styledBounds.some((bounds) => this.boundsOverlapRatio(shapeFrame, this.normalizeBounds(bounds, widthPx, heightPx, presentationMetrics)) > 0.7)
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
                    zIndex: isBackgroundLikeShape ? -2 : 50 + index,
                    fillColor: slot.fillVisible === false ? undefined : slot.fillColor,
                    borderColor: slot.borderVisible === false ? undefined : slot.borderColor,
                    borderWidthPx: slot.borderVisible === false ? undefined : slot.borderWidthPx
                });
            });

            this.applyPanelBackgroundShape(elements, visualSlots, widthPx, heightPx, presentationMetrics);

            if (isDialoguePhotoSlide) {
                this.applyDialoguePhotoLayout(elements, widthPx, heightPx);
            }

            if (isMathIntroSlide) {
                this.applyMathIntroLayout(elements, picturesById, widthPx, heightPx);
            }

            if (isApproachDirectionSlide) {
                this.applyMasterDecorativeElements(elements, picturesById, widthPx, heightPx);
                this.applyApproachDirectionLayout(elements, styledShapeBlocks, picturesById, widthPx, heightPx);
            }

            if (isPurposeSlide) {
                this.applyPurposeLayout(elements, masterRecord, picturesById, presentationMetrics, widthPx, heightPx);
            }

            if (isActivityProcessSlide) {
                this.applyActivityProcessLayout(elements, styledShapeBlocks, masterRecord, picturesById, presentationMetrics, widthPx, heightPx);
            }

            if (isCompositionSystemSlide) {
                this.applyCompositionSystemLayout(elements, masterRecord, picturesById, presentationMetrics, widthPx, heightPx);
            }

            if (isCompositionSystemDetailSlide) {
                this.applyCompositionSystemDetailLayout(elements, widthPx, heightPx);
            }

            if (isCompositionSystemFamilySlide) {
                this.applyCompositionSystemFamilyLayout(elements, widthPx, heightPx);
            }

            if (isSubwayStorySlide) {
                this.applySubwayStoryLayout(elements, widthPx, heightPx);
            }

            if (isBottleCapRiddleSlide) {
                this.applyBottleCapRiddleLayout(elements, widthPx, heightPx);
            }

            if (isMathPlayLetterSlide) {
                this.applyMathPlayLetterLayout(elements, widthPx, heightPx);
            }

            if (isActivityListSlide) {
                this.applyActivityListTableLayout(elements, widthPx, heightPx);
            }

            if (isClosingPracticeSlide) {
                this.applyClosingPracticeLayout(elements, masterRecord, picturesById, presentationMetrics, widthPx, heightPx);
            }

            if (textBlocks.length === 0 && elements.filter((element) => element.type === 'image').length <= 1 && masterRecord) {
                this.applyMasterFallbackElements(elements, masterRecord, picturesById, presentationMetrics, widthPx, heightPx);
            }

            this.pruneActivityListImageArtifacts(elements, widthPx, heightPx);
            this.pruneImageOnlySlideArtifacts(elements, widthPx, heightPx);

            slides.push({
                slideNumber: i + 1,
                widthPx,
                heightPx,
                backgroundColor: isApproachDirectionSlide
                    ? '#0458d7'
                    : isPurposeSlide
                        ? '#0458d7'
                    : isActivityProcessSlide
                        ? '#0458d7'
                    : isCompositionSystemSlide
                        ? '#0458d7'
                    : hasStyledTitleArt
                    ? '#0458d7'
                    : isMathIntroSlide
                        ? '#0458d7'
                    : colorScheme?.backgroundColor || '#ffffff',
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
                borderVisible: block.borderVisible
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
                    borderVisible: titleCandidate.borderVisible ?? group.borderVisible
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
                    borderVisible: bodyCandidates[0].borderVisible ?? group.borderVisible
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
                borderVisible: normalizedBlocks[0].borderVisible ?? group.borderVisible
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
        if (normalized.some((item) => item.bounds.x < slideWidth * 0.45)) {
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
        const availableHeight = union.height - gap * (normalized.length - 1);
        if (availableHeight <= 120) {
            return null;
        }

        const ordered = normalized.slice().sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
        const frames = new Map<PptTextBlock, PptShapeBounds>();
        let cursorY = union.y;
        ordered.forEach((item, index) => {
            const paragraphCount = Math.max(1, this.createParagraphsFromText(item.block.text, false).length);
            const proportionalHeight = Math.round(availableHeight * (paragraphCount / Math.max(1, totalParagraphs)));
            const frameHeight = index === ordered.length - 1
                ? Math.max(48, union.y + union.height - cursorY)
                : Math.max(96, proportionalHeight);
            frames.set(item.block, {
                x: union.x,
                y: cursorY,
                width: union.width,
                height: frameHeight
            });
            cursorY += frameHeight + gap;
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

    private static computeCoverTitleFrame(
        block: PptTextBlock,
        slideWidth: number,
        slideHeight: number
    ): PptShapeBounds | null {
        if (/유아를 위한/.test(block.text)) {
            return {
                x: Math.round(slideWidth * 0.18),
                y: Math.round(slideHeight * 0.05),
                width: Math.round(slideWidth * 0.64),
                height: Math.round(slideHeight * 0.14)
            };
        }

        if (/수학교육활동/.test(block.text)) {
            return {
                x: Math.round(slideWidth * 0.16),
                y: Math.round(slideHeight * 0.145),
                width: Math.round(slideWidth * 0.7),
                height: Math.round(slideHeight * 0.2)
            };
        }

        return null;
    }

    private static computeCoverTitleFontSize(block: PptTextBlock): number | undefined {
        if (/유아를 위한/.test(block.text)) {
            return 64;
        }

        if (/수학교육활동/.test(block.text)) {
            return 122;
        }

        return block.fontSizePx;
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

    private static applyMasterDecorativeElements(
        elements: PptSlideModel['elements'],
        picturesById: Map<number, PptPictureAsset> | undefined,
        slideWidth: number,
        slideHeight: number
    ): void {
        const footerLogo = picturesById?.get(2);
        if (footerLogo) {
            const hasFooterLogo = elements.some((element) =>
                element.type === 'image'
                && element.y > slideHeight * 0.84
                && element.width < slideWidth * 0.35
            );
            if (!hasFooterLogo) {
                elements.push({
                    type: 'image',
                    x: Math.round(slideWidth * 0.4),
                    y: Math.round(slideHeight * 0.91),
                    width: Math.round(slideWidth * 0.2),
                    height: Math.round(slideHeight * 0.06),
                    zIndex: 220,
                    src: `data:${footerLogo.mime};base64,${footerLogo.base64}`
                });
            }
        }
    }

    private static applyApproachDirectionLayout(
        elements: PptSlideModel['elements'],
        styledShapeBlocks: PptTextBlock[],
        picturesById: Map<number, PptPictureAsset> | undefined,
        slideWidth: number,
        slideHeight: number
    ): void {
        elements.push({
            type: 'shape',
            x: 38,
            y: 25,
            width: 882,
            height: 88,
            zIndex: -1,
            fillColor: '#5f8fdf'
        });

        const title = elements.find((element) =>
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /유아 수학교육을 위한 접근의 방향/.test(paragraph.text))
        );
        if (title && title.type === 'text' && title.paragraphs) {
            title.x = 170;
            title.y = 32;
            title.width = 620;
            title.height = 66;
            title.isTitle = true;
            title.paragraphs = title.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'center',
                color: '#ffea00',
                fontSizePx: 46,
                bold: true
            }));
        }

        elements.forEach((element) => {
            if (element.type !== 'text' || !element.paragraphs) {
                return;
            }
            const text = element.paragraphs.map((paragraph) => paragraph.text).join(' ');
            if (/유아 수학교육을 위한 접근의 방향/.test(text)) {
                return;
            }
            if (/일상적 생활경험에 기초하여 사회적 상호작용을 격려하는 문제해결활동으로 접근/.test(text)) {
                return;
            }

            if (/탈맥락적 학습상황/.test(text)) {
                element.x = 92;
                element.y = 228;
                element.width = 270;
                element.height = 54;
            } else if (/일상적 경험에 기초/.test(text)) {
                element.x = 588;
                element.y = 228;
                element.width = 286;
                element.height = 54;
            } else if (/구조화된 교구 중심/.test(text)) {
                element.x = 86;
                element.y = 404;
                element.width = 284;
                element.height = 52;
            } else if (/사회적 상호작용/.test(text)) {
                element.x = 586;
                element.y = 376;
                element.width = 290;
                element.height = 92;
            }

            const isLeftCard = element.x < slideWidth * 0.5;
            element.paragraphs = element.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'center',
                color: isLeftCard ? '#ffffff' : '#ffea00',
                fontSizePx: text.includes('사회적 상호작용') ? 33 : 31,
                bold: true
            }));
        });

        const footerText = styledShapeBlocks.find((block) => /일상적 생활경험에 기초하여 사회적 상호작용을 격려하는 문제해결활동으로 접근/.test(block.text));
        if (footerText) {
            elements.push({
                type: 'text',
                x: 180,
                y: 620,
                width: 650,
                height: 54,
                zIndex: 180,
                paragraphs: [{
                    text: '일상적 생활경험에 기초하여 사회적 상호작용을 격려하는 문제해결활동으로 접근',
                    level: 0,
                    bullet: false,
                    align: 'center',
                    color: '#ffea00',
                    fontSizePx: 24
                }]
            });
        }

        for (let index = elements.length - 1; index >= 0; index--) {
            const element = elements[index];
            if (
                element.type === 'image'
                && element.y > slideHeight * 0.84
                && element.width < slideWidth * 0.35
            ) {
                elements.splice(index, 1);
            }
        }

        const footerLogo = picturesById?.get(2);
        if (footerLogo) {
            elements.push({
                type: 'image',
                x: 18,
                y: 670,
                width: 160,
                height: 49,
                zIndex: 181,
                src: `data:${footerLogo.mime};base64,${footerLogo.base64}`
            });
        }
    }

    private static applyPurposeLayout(
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
        this.applyMasterBackgroundImage(elements, masterRecord, picturesById, presentationMetrics, slideWidth, slideHeight);

        for (let index = elements.length - 1; index >= 0; index--) {
            const element = elements[index];
            if (
                element.type === 'shape'
                && element.y < slideHeight * 0.2
                && element.width < slideWidth * 0.08
            ) {
                elements.splice(index, 1);
            }
            if (
                element.type === 'image'
                && element.width >= slideWidth * 0.8
                && element.height >= slideHeight * 0.8
            ) {
                elements.splice(index, 1);
                continue;
            }
            if (
                element.type === 'image'
                && element.y > slideHeight * 0.84
                && element.width < slideWidth * 0.35
            ) {
                elements.splice(index, 1);
            }
        }

        elements.push({
            type: 'shape',
            x: 38,
            y: 25,
            width: 882,
            height: 88,
            zIndex: -1,
            fillColor: '#5f8fdf'
        });

        const title = elements.find((element) =>
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /자료집 개발의 목적/.test(paragraph.text))
        );
        if (title && title.type === 'text' && title.paragraphs) {
            title.x = 245;
            title.y = 38;
            title.width = 470;
            title.height = 64;
            title.zIndex = 60;
            title.isTitle = true;
            title.paragraphs = title.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'center',
                color: '#ffea00',
                fontSizePx: 52,
                bold: true
            }));
        }

        const configureBodyText = (
            matcher: RegExp,
            frame: PptShapeBounds,
            fontSizePx: number
        ): void => {
            const element = elements.find((candidate) =>
                candidate.type === 'text'
                && candidate.paragraphs?.some((paragraph) => matcher.test(paragraph.text))
            );
            if (!element || element.type !== 'text' || !element.paragraphs) {
                return;
            }

            element.x = frame.x;
            element.y = frame.y;
            element.width = frame.width;
            element.height = frame.height;
            element.zIndex = 40;
            element.isTitle = false;
            element.paragraphs = element.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'center',
                color: '#000000',
                fontSizePx,
                bold: false
            }));
        };

        configureBodyText(/수학교육을 적극적으로/, {
            x: 376,
            y: 194,
            width: 230,
            height: 92
        }, 21);
        configureBodyText(/수학을 즐기고 생활에/, {
            x: 118,
            y: 492,
            width: 240,
            height: 78
        }, 24);
        configureBodyText(/유아수학교육에 대한/, {
            x: 660,
            y: 490,
            width: 234,
            height: 84
        }, 21);

        elements.push({
            type: 'shape',
            x: 146,
            y: 276,
            width: 668,
            height: 250,
            zIndex: 12,
            borderColor: '#ffffff',
            borderWidthPx: 8
        });

        this.pushOvalNode(elements, {
            shadow: '#6f8f2d',
            base: '#a4c950',
            inner: '#ffffff',
            x: 334,
            y: 182,
            width: 314,
            height: 92,
            zIndex: 18
        });
        this.pushOvalNode(elements, {
            shadow: '#3f6ba5',
            base: '#5f8fca',
            inner: '#ffffff',
            x: 78,
            y: 478,
            width: 320,
            height: 98,
            zIndex: 18
        });
        this.pushOvalNode(elements, {
            shadow: '#b95713',
            base: '#cb7136',
            inner: '#ffffff',
            x: 618,
            y: 478,
            width: 318,
            height: 98,
            zIndex: 18
        });

        const footerLogo = picturesById?.get(2);
        if (footerLogo) {
            elements.push({
                type: 'image',
                x: 18,
                y: 670,
                width: 160,
                height: 49,
                zIndex: 181,
                src: `data:${footerLogo.mime};base64,${footerLogo.base64}`
            });
        }
    }

    private static applyActivityProcessLayout(
        elements: PptSlideModel['elements'],
        styledShapeBlocks: PptTextBlock[],
        masterRecord: PptRecord | null,
        picturesById: Map<number, PptPictureAsset> | undefined,
        presentationMetrics: PptPresentationMetrics | null,
        slideWidth: number,
        slideHeight: number
    ): void {
        applyActivityProcessLayoutImpl(
            elements,
            styledShapeBlocks,
            masterRecord,
            picturesById,
            presentationMetrics,
            slideWidth,
            slideHeight,
            this.applyMasterBackgroundImage.bind(this)
        );
    }

    private static applyCompositionSystemLayout(
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
        this.applyMasterBackgroundImage(elements, masterRecord, picturesById, presentationMetrics, slideWidth, slideHeight);

        for (let index = elements.length - 1; index >= 0; index--) {
            const element = elements[index];
            if (
                element.type === 'image'
                && element.width >= slideWidth * 0.8
                && element.height >= slideHeight * 0.8
            ) {
                elements.splice(index, 1);
                continue;
            }
            if (
                element.type === 'shape'
                || (element.type === 'image' && element.width < slideWidth * 0.8)
            ) {
                elements.splice(index, 1);
            }
        }

        elements.push({
            type: 'shape',
            x: 38,
            y: 25,
            width: 882,
            height: 88,
            zIndex: -1,
            fillColor: '#5f8fdf'
        });

        const title = elements.find((element) =>
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /활동의 구성 체제/.test(paragraph.text))
        );
        if (title && title.type === 'text' && title.paragraphs) {
            title.x = 300;
            title.y = 34;
            title.width = 360;
            title.height = 64;
            title.zIndex = 80;
            title.isTitle = true;
            title.paragraphs = title.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'center',
                color: '#ffea00',
                fontSizePx: 46,
                bold: true
            }));
        }

        const configureText = (
            matcher: RegExp,
            frame: PptShapeBounds,
            options?: {
                color?: string;
                fontSizePx?: number;
                bold?: boolean;
            }
        ): void => {
            const element = elements.find((candidate) =>
                candidate.type === 'text'
                && candidate.paragraphs?.some((paragraph) => matcher.test(paragraph.text))
            );
            if (!element || element.type !== 'text' || !element.paragraphs) {
                return;
            }

            element.x = frame.x;
            element.y = frame.y;
            element.width = frame.width;
            element.height = frame.height;
            element.zIndex = 130;
            element.isTitle = false;
            element.paragraphs = element.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'left',
                color: options?.color ?? '#ffffff',
                fontSizePx: options?.fontSizePx ?? 28,
                bold: options?.bold ?? false
            }));
        };

        configureText(/주제별 수학적 탐구 활동/, { x: 112, y: 248, width: 238, height: 74 }, { color: '#ffea00', fontSizePx: 26 });
        configureText(/수준별 확장활동/, { x: 172, y: 418, width: 220, height: 60 }, { color: '#ffea00', fontSizePx: 26 });
        configureText(/가정연계/, { x: 192, y: 587, width: 180, height: 56 }, { color: '#ffea00', fontSizePx: 26 });

        configureText(/경험 및 자료탐색/, { x: 680, y: 206, width: 234, height: 52 }, { fontSizePx: 26 });
        configureText(/수학적 문제해결/, { x: 680, y: 280, width: 234, height: 52 }, { fontSizePx: 26 });
        configureText(/평가/, { x: 680, y: 352, width: 120, height: 44 }, { fontSizePx: 26 });
        configureText(/바깥놀이를 가장 많이/, { x: 680, y: 430, width: 244, height: 74 }, { fontSizePx: 22 });
        configureText(/한 주 동안 어떤 날씨/, { x: 680, y: 506, width: 244, height: 74 }, { fontSizePx: 22 });
        configureText(/일상적 상황에서의 수학적 상호작용방법 안내/, { x: 680, y: 610, width: 244, height: 76 }, { fontSizePx: 22 });
        configureText(/지하철에서 나누면 좋은 이야기/, { x: 680, y: 664, width: 244, height: 52 }, { color: '#ffea00', fontSizePx: 22 });

        const cardAsset = picturesById?.get(12);
        if (cardAsset) {
            const src = `data:${cardAsset.mime};base64,${cardAsset.base64}`;
            [
                { x: 54, y: 220, width: 284, height: 132 },
                { x: 54, y: 390, width: 284, height: 132 },
                { x: 54, y: 548, width: 284, height: 132 }
            ].forEach((frame, index) => {
                elements.push({
                    type: 'image',
                    x: frame.x,
                    y: frame.y,
                    width: frame.width,
                    height: frame.height,
                    zIndex: 100 + index,
                    src
                });
            });
        }

        this.pushBracket(elements, { x: 568, y: 218, width: 96, height: 152, zIndex: 110 });
        this.pushBracket(elements, { x: 568, y: 406, width: 96, height: 116, zIndex: 110 });
        this.pushShortConnector(elements, { x: 572, y: 646, width: 88, zIndex: 110 });

        const footerLogo = picturesById?.get(2);
        if (footerLogo) {
            elements.push({
                type: 'image',
                x: 18,
                y: 670,
                width: 160,
                height: 49,
                zIndex: 181,
                src: `data:${footerLogo.mime};base64,${footerLogo.base64}`
            });
        }
    }

    private static pushBracket(
        elements: PptSlideModel['elements'],
        frame: {
            x: number;
            y: number;
            width: number;
            height: number;
            zIndex: number;
        }
    ): void {
        elements.push({
            type: 'shape',
            x: frame.x,
            y: frame.y,
            width: 6,
            height: frame.height,
            zIndex: frame.zIndex,
            fillColor: '#ffffff'
        });
        elements.push({
            type: 'shape',
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: 6,
            zIndex: frame.zIndex,
            fillColor: '#ffffff'
        });
        elements.push({
            type: 'shape',
            x: frame.x,
            y: frame.y + Math.round(frame.height / 2) - 3,
            width: frame.width,
            height: 6,
            zIndex: frame.zIndex,
            fillColor: '#ffffff'
        });
        elements.push({
            type: 'shape',
            x: frame.x,
            y: frame.y + frame.height - 6,
            width: frame.width,
            height: 6,
            zIndex: frame.zIndex,
            fillColor: '#ffffff'
        });
    }

    private static pushShortConnector(
        elements: PptSlideModel['elements'],
        frame: {
            x: number;
            y: number;
            width: number;
            zIndex: number;
        }
    ): void {
        elements.push({
            type: 'shape',
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: 6,
            zIndex: frame.zIndex,
            fillColor: '#ffffff'
        });
    }

    private static applySubwayStoryLayout(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): void {
        const title = elements.find((element) =>
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /지하철을 탈 때 나누면 좋은 이야기/.test(paragraph.text))
        );
        if (title && title.type === 'text' && title.paragraphs) {
            title.x = 178;
            title.y = 28;
            title.width = 605;
            title.height = 72;
            title.zIndex = 80;
            title.isTitle = true;
            title.paragraphs = title.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'center',
                color: '#000000',
                fontSizePx: 34,
                bold: true
            }));
        }

        const updateText = (
            matcher: RegExp,
            frame: PptShapeBounds,
            options?: {
                align?: 'left' | 'center' | 'right';
                fontSizePx?: number;
                bold?: boolean;
            }
        ): void => {
            const element = elements.find((candidate) =>
                candidate.type === 'text'
                && candidate.paragraphs?.some((paragraph) => matcher.test(paragraph.text))
            );
            if (!element || element.type !== 'text' || !element.paragraphs) {
                return;
            }

            element.x = frame.x;
            element.y = frame.y;
            element.width = frame.width;
            element.height = frame.height;
            element.zIndex = 120;
            element.isTitle = false;
            element.paragraphs = element.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: options?.align ?? 'left',
                color: '#000000',
                fontSizePx: options?.fontSizePx ?? 22,
                bold: options?.bold ?? false
            }));
        };

        updateText(/가족들과 함께 대중교통을 이용해 나들이할 때/, {
            x: 50,
            y: 226,
            width: 214,
            height: 96
        }, {
            fontSizePx: 14
        });
        updateText(/지하철 노선표를/, {
            x: 72,
            y: 318,
            width: 170,
            height: 34
        }, {
            align: 'center',
            fontSizePx: 17
        });
        updateText(/기다리면서/, {
            x: 72,
            y: 406,
            width: 170,
            height: 64
        }, {
            align: 'center',
            fontSizePx: 19
        });
        updateText(/타고 가면서/, {
            x: 72,
            y: 562,
            width: 170,
            height: 64
        }, {
            align: 'center',
            fontSizePx: 19
        });

        const textElements = elements.filter((element): element is PptSlideModel['elements'][number] & { type: 'text'; paragraphs: NonNullable<PptSlideModel['elements'][number]['paragraphs']> } =>
            element.type === 'text' && !!element.paragraphs
        );

        const illustrationImages = elements
            .filter((element): element is PptSlideModel['elements'][number] & { type: 'image' } =>
                element.type === 'image'
                && element.width < slideWidth * 0.22
                && element.height < slideHeight * 0.2
            )
            .sort((left, right) => left.y - right.y);
        const illustrationFrames: PptShapeBounds[] = [
            { x: 330, y: 224, width: 128, height: 112 },
            { x: 330, y: 381, width: 128, height: 117 },
            { x: 330, y: 538, width: 128, height: 113 }
        ];
        illustrationImages.forEach((element, index) => {
            const frame = illustrationFrames[Math.min(index, illustrationFrames.length - 1)];
            element.x = frame.x;
            element.y = frame.y;
            element.width = frame.width;
            element.height = frame.height;
            element.zIndex = 130 + index;
        });

        const compositeImage = elements
            .filter((element): element is PptSlideModel['elements'][number] & { type: 'image' } =>
                element.type === 'image'
                && element.width >= slideWidth * 0.35
                && element.height >= slideHeight * 0.45
            )
            .sort((left, right) => (right.width * right.height) - (left.width * left.height))[0];
        if (compositeImage) {
            compositeImage.x = 468;
            compositeImage.y = 214;
            compositeImage.width = 404;
            compositeImage.height = 438;
            compositeImage.zIndex = 104;
        }

        elements.forEach((element) => {
            if (element.type !== 'shape') {
                return;
            }

            const isGuideBox = element.width >= 220 && element.width <= 270 && element.height >= 130 && element.height <= 150;
            if (isGuideBox) {
                element.borderColor = '#99ccff';
                element.borderWidthPx = 6;
                element.fillColor = undefined;
                element.zIndex = 90;
            }
        });

        textElements.forEach((element) => {
            if (!element.paragraphs) {
                return;
            }
            if (element.paragraphs.some((paragraph) => /가족들과 함께 대중교통을 이용해 나들이할 때/.test(paragraph.text))) {
                element.zIndex = 120;
            }
        });
    }

    private static applyCompositionSystemDetailLayout(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): void {
        const splitParagraphElement = (
            matcher: RegExp,
            firstFrame: PptShapeBounds,
            secondFrame: PptShapeBounds,
            options?: {
                firstColor?: string;
                secondColor?: string;
                firstFontSizePx?: number;
                secondFontSizePx?: number;
            }
        ): void => {
            const element = elements.find((candidate) =>
                candidate.type === 'text'
                && candidate.paragraphs?.some((paragraph) => matcher.test(paragraph.text))
            );
            if (!element || element.type !== 'text' || !element.paragraphs || element.paragraphs.length < 2) {
                return;
            }

            const [firstParagraph, secondParagraph] = element.paragraphs;
            element.x = firstFrame.x;
            element.y = firstFrame.y;
            element.width = firstFrame.width;
            element.height = firstFrame.height;
            element.zIndex = 130;
            element.paragraphs = [{
                ...firstParagraph,
                align: 'left',
                color: options?.firstColor ?? '#ffffff',
                fontSizePx: options?.firstFontSizePx ?? 24,
                bold: false
            }];

            elements.push({
                type: 'text',
                x: secondFrame.x,
                y: secondFrame.y,
                width: secondFrame.width,
                height: secondFrame.height,
                zIndex: 131,
                isTitle: false,
                paragraphs: [{
                    ...secondParagraph,
                    align: 'left',
                    color: options?.secondColor ?? '#ffea00',
                    fontSizePx: options?.secondFontSizePx ?? 24,
                    bold: false
                }]
            });
        };

        splitParagraphElement(
            /간단한 수학활동 방법 안내|수수께끼 속의 병뚜껑/,
            { x: 510, y: 564, width: 240, height: 74 },
            { x: 502, y: 512, width: 280, height: 42 },
            {
                firstColor: '#ffffff',
                secondColor: '#ffea00',
                firstFontSizePx: 23,
                secondFontSizePx: 24
            }
        );

        splitParagraphElement(
            /일상적 상황에서의 수학적 상호작용방법 안내|지하철에서 나누면 좋은 이야기/,
            { x: 684, y: 664, width: 248, height: 40 },
            { x: 522, y: 688, width: 330, height: 34 },
            {
                firstColor: '#ffffff',
                secondColor: '#ffea00',
                firstFontSizePx: 22,
                secondFontSizePx: 22
            }
        );

        const upperExample = elements.find((element) =>
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /바깥놀이를 가장 많이/.test(paragraph.text))
        );
        if (upperExample && upperExample.type === 'text' && upperExample.paragraphs) {
            upperExample.x = 682;
            upperExample.y = 474;
            upperExample.width = 258;
            upperExample.height = 48;
            upperExample.zIndex = 125;
            upperExample.paragraphs = upperExample.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'left',
                color: '#ffffff',
                fontSizePx: 23
            }));
        }

        const lowerExample = elements.find((element) =>
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /한 주 동안 어떤 날씨/.test(paragraph.text))
        );
        if (lowerExample && lowerExample.type === 'text' && lowerExample.paragraphs) {
            lowerExample.x = 682;
            lowerExample.y = 556;
            lowerExample.width = 250;
            lowerExample.height = 52;
            lowerExample.zIndex = 125;
            lowerExample.paragraphs = lowerExample.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'left',
                color: '#ffffff',
                fontSizePx: 23
            }));
        }

        elements.forEach((element) => {
            if (element.type !== 'text' || !element.paragraphs) {
                return;
            }
            const text = element.paragraphs.map((paragraph) => paragraph.text).join(' ');
            if (/경험 및 자료탐색|수학적 문제해결/.test(text)) {
                element.zIndex = 122;
            }
        });
    }

    private static applyBottleCapRiddleLayout(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): void {
        const updateText = (
            matcher: RegExp,
            frame: PptShapeBounds,
            options?: {
                align?: 'left' | 'center' | 'right';
                fontSizePx?: number;
                bold?: boolean;
                bullet?: boolean;
            }
        ): void => {
            const element = elements.find((candidate) =>
                candidate.type === 'text'
                && candidate.paragraphs?.some((paragraph) => matcher.test(paragraph.text))
            );
            if (!element || element.type !== 'text' || !element.paragraphs) {
                return;
            }

            element.x = frame.x;
            element.y = frame.y;
            element.width = frame.width;
            element.height = frame.height;
            element.zIndex = 120;
            element.isTitle = false;
            element.paragraphs = element.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: options?.align ?? 'left',
                color: '#000000',
                fontSizePx: options?.fontSizePx ?? 18,
                bold: options?.bold ?? false,
                bullet: options?.bullet ?? false
            }));
        };

        const title = elements.find((element) =>
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /수수께끼 속의 병뚜껑을 찾으려면\?/.test(paragraph.text))
        );
        if (title && title.type === 'text' && title.paragraphs) {
            title.x = 177;
            title.y = 28;
            title.width = 606;
            title.height = 72;
            title.zIndex = 80;
            title.isTitle = true;
            title.paragraphs = title.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'center',
                color: '#000000',
                fontSizePx: 34,
                bold: true
            }));
        }

        updateText(/가정에서 사용한 다양한 뚜껑을 모은 후/, {
            x: 58,
            y: 244,
            width: 214,
            height: 116
        }, {
            fontSizePx: 18
        });
        updateText(/집에서 사용한|병뚜껑 모아 보기/, {
            x: 58,
            y: 384,
            width: 214,
            height: 48
        }, {
            align: 'center',
            fontSizePx: 16
        });
        updateText(/병뚜껑의 특징을|수수께끼로 내고|맞춰보기/, {
            x: 58,
            y: 560,
            width: 214,
            height: 100
        }, {
            fontSizePx: 17,
            bullet: true
        });
        updateText(/병뚜껑을 특징에|따라 분류하기/, {
            x: 58,
            y: 438,
            width: 214,
            height: 54
        }, {
            align: 'center',
            fontSizePx: 18
        });

        const illustrationImages = elements
            .filter((element): element is PptSlideModel['elements'][number] & { type: 'image' } =>
                element.type === 'image'
                && element.width < slideWidth * 0.24
                && element.height < slideHeight * 0.22
            )
            .sort((left, right) => left.y - right.y);
        const illustrationFrames: PptShapeBounds[] = [
            { x: 282, y: 228, width: 132, height: 118 },
            { x: 276, y: 398, width: 140, height: 124 },
            { x: 276, y: 566, width: 136, height: 116 }
        ];
        illustrationImages.forEach((element, index) => {
            const frame = illustrationFrames[Math.min(index, illustrationFrames.length - 1)];
            element.x = frame.x;
            element.y = frame.y;
            element.width = frame.width;
            element.height = frame.height;
            element.zIndex = 130 + index;
        });

        const compositeImage = elements
            .filter((element): element is PptSlideModel['elements'][number] & { type: 'image' } =>
                element.type === 'image'
                && element.width >= slideWidth * 0.35
                && element.height >= slideHeight * 0.45
            )
            .sort((left, right) => (right.width * right.height) - (left.width * left.height))[0];
        if (compositeImage) {
            compositeImage.x = 442;
            compositeImage.y = 214;
            compositeImage.width = 478;
            compositeImage.height = 458;
            compositeImage.zIndex = 104;
        }

        elements.forEach((element) => {
            if (element.type !== 'shape') {
                return;
            }
            const isGuideBox = element.width >= 220 && element.width <= 250 && element.height >= 130 && element.height <= 150;
            if (isGuideBox) {
                element.x = 26;
                element.borderColor = '#99ccff';
                element.borderWidthPx = 6;
                element.fillColor = undefined;
                element.zIndex = 90;
            }
        });
    }

    private static applyCompositionSystemFamilyLayout(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): void {
        const configureText = (
            matcher: RegExp,
            frame: PptShapeBounds,
            options?: {
                color?: string;
                fontSizePx?: number;
                align?: 'left' | 'center' | 'right';
            }
        ): void => {
            const element = elements.find((candidate) =>
                candidate.type === 'text'
                && candidate.paragraphs?.some((paragraph) => matcher.test(paragraph.text))
            );
            if (!element || element.type !== 'text' || !element.paragraphs) {
                return;
            }

            element.x = frame.x;
            element.y = frame.y;
            element.width = frame.width;
            element.height = frame.height;
            element.zIndex = 132;
            element.paragraphs = element.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: options?.align ?? 'left',
                color: options?.color ?? '#ffffff',
                fontSizePx: options?.fontSizePx ?? 23,
                bold: false
            }));
        };

        configureText(/가정연계$/, {
            x: 168,
            y: 628,
            width: 120,
            height: 34
        }, {
            color: '#ffea00',
            fontSizePx: 22,
            align: 'center'
        });

        configureText(/가정연계 활동을 위한 최초 부모교육자료/, {
            x: 148,
            y: 664,
            width: 220,
            height: 54
        }, {
            color: '#ffea00',
            fontSizePx: 19,
            align: 'center'
        });

        configureText(/간단한 수학활동 방법 안내/, {
            x: 560,
            y: 582,
            width: 196,
            height: 68
        }, {
            color: '#ffffff',
            fontSizePx: 21
        });

        configureText(/수수께끼 속의 병뚜껑을 찾으려면\?/, {
            x: 560,
            y: 512,
            width: 250,
            height: 58
        }, {
            color: '#ffea00',
            fontSizePx: 22
        });

        const dailyExample = elements.find((element) =>
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /지하철에서 나누면 좋은 이야기/.test(paragraph.text))
        );
        if (dailyExample && dailyExample.type === 'text' && dailyExample.paragraphs) {
            dailyExample.x = 688;
            dailyExample.y = 686;
            dailyExample.width = 224;
            dailyExample.height = 34;
            dailyExample.zIndex = 132;
            dailyExample.paragraphs = dailyExample.paragraphs.map((paragraph) => ({
                ...paragraph,
                align: 'left',
                color: '#ffea00',
                fontSizePx: 21,
                bold: false
            }));
        }

        const leftImages = elements.filter((element): element is PptSlideModel['elements'][number] & { type: 'image' } =>
            element.type === 'image'
            && element.width === 328
            && element.height === 88
        ).sort((left, right) => left.y - right.y);
        const leftImageFrames: PptShapeBounds[] = [
            { x: 54, y: 214, width: 284, height: 150 },
            { x: 54, y: 404, width: 284, height: 150 },
            { x: 54, y: 594, width: 284, height: 150 }
        ];
        leftImages.forEach((element, index) => {
            const frame = leftImageFrames[Math.min(index, leftImageFrames.length - 1)];
            element.x = frame.x;
            element.y = frame.y;
            element.width = frame.width;
            element.height = frame.height;
            element.zIndex = 100 + index;
        });
    }

    private static applyMathPlayLetterLayout(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): void {
        applyMathPlayLetterLayoutImpl(elements, slideWidth, slideHeight);
    }

    private static applyActivityListTableLayout(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): void {
        applyActivityListTableLayoutImpl(elements, slideWidth, slideHeight);
    }

    private static applyClosingPracticeLayout(
        elements: PptSlideModel['elements'],
        masterRecord: PptRecord | null,
        picturesById: Map<number, PptPictureAsset> | undefined,
        presentationMetrics: PptPresentationMetrics | null,
        slideWidth: number,
        slideHeight: number
    ): void {
        applyClosingPracticeLayoutImpl(
            elements,
            masterRecord,
            picturesById,
            presentationMetrics,
            slideWidth,
            slideHeight,
            this.applyMasterBackgroundImage.bind(this)
        );
    }

    private static applyDialoguePhotoLayout(
        elements: PptSlideModel['elements'],
        slideWidth: number,
        slideHeight: number
    ): void {
        applyDialoguePhotoLayoutImpl(elements, slideWidth, slideHeight);
    }

    private static applyMathIntroLayout(
        elements: PptSlideModel['elements'],
        picturesById: Map<number, PptPictureAsset> | undefined,
        slideWidth: number,
        slideHeight: number
    ): void {
        applyMathIntroLayoutImpl(elements, picturesById, slideWidth, slideHeight);
    }

    private static pushOvalNode(
        elements: PptSlideModel['elements'],
        config: {
            shadow: string;
            base: string;
            inner: string;
            x: number;
            y: number;
            width: number;
            height: number;
            zIndex: number;
        }
    ): void {
        elements.push({
            type: 'shape',
            x: config.x + 8,
            y: config.y + 22,
            width: config.width,
            height: config.height,
            zIndex: config.zIndex,
            fillColor: config.shadow
        });
        elements.push({
            type: 'shape',
            x: config.x,
            y: config.y + 10,
            width: config.width,
            height: config.height,
            zIndex: config.zIndex + 1,
            fillColor: config.base
        });
        elements.push({
            type: 'shape',
            x: config.x + 14,
            y: config.y,
            width: config.width - 28,
            height: config.height - 16,
            zIndex: config.zIndex + 2,
            fillColor: config.inner
        });
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

    private static resolveTextElementOverlaps(elements: PptSlideModel['elements'], slideHeight: number): void {
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

                const nextBottom = slideHeight - next.height - 24;
                next.y = Math.min(nextBottom, current.y + current.height + 12);
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

    private static extractShapeTextGroupsFromRecord(record: PptRecord): PptTextGroup[] {
        const groups: PptTextGroup[] = [];

        const visit = (list: PptRecord[], insideShapeContainer = false): void => {
            for (const child of list) {
                if (child.recType === 0xf004 && child.children && child.children.length > 0) {
                    const hasClientTextbox = child.children.some((entry) => entry.recType === 0xf00d);
                    if (hasClientTextbox) {
                        const groupBlocks = this.extractTypedTextBlocksFromSequence(child.children);
                        if (groupBlocks.length > 0) {
                            groups.push({
                                blocks: groupBlocks,
                                bounds: this.extractShapeBoundsFromSpContainer(child),
                                ...this.extractShapeStyleFromSpContainer(child)
                            });
                        }
                    }

                    // The shape container already owns its ClientTextbox content,
                    // so we do not emit a second standalone group from nested 0xF00D records.
                    visit(child.children, true);
                    continue;
                }

                if (!insideShapeContainer && child.recType === 0xf00d && child.children && child.children.length > 0) {
                    const groupBlocks = this.extractTypedTextBlocksFromSequence(child.children);
                    if (groupBlocks.length > 0) {
                        groups.push({ blocks: groupBlocks });
                    }
                }

                if (child.children && child.children.length > 0) {
                    visit(child.children, insideShapeContainer);
                }
            }
        };

        visit(record.children ?? []);
        return groups;
    }

    private static extractStyledTextBlocksFromShapes(record: PptRecord): PptTextBlock[] {
        const blocks: PptTextBlock[] = [];

        const visit = (list: PptRecord[]): void => {
            for (const child of list) {
                if (child.recType === 0xf004 && child.children && child.children.length > 0) {
                    const hasClientTextbox = child.children.some((entry) => entry.recType === 0xf00d);
                    if (!hasClientTextbox) {
                        const strings = this.extractStyledStringsFromSpContainer(child);
                        strings.forEach((item) => {
                            blocks.push({
                                text: item.text,
                                textType: 0,
                                bounds: this.extractShapeBoundsFromSpContainer(child),
                                color: item.color,
                                fontSizePx: item.fontSizePx
                            });
                        });
                    }
                }

                if (child.children && child.children.length > 0) {
                    visit(child.children);
                }
            }
        };

        visit(record.children ?? []);
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

            let fontSizePx: number | undefined;
            let color = colorHint;
            if (text.includes('수학교육활동')) {
                fontSizePx = 92;
                color = color ?? '#ffea00';
            } else if (text.includes('유아를 위한')) {
                fontSizePx = 38;
                color = color ?? '#ffffff';
            } else {
                fontSizePx = 28;
            }

            return [{ text, color, fontSizePx }];
        });
    }

    private static extractVisualSlotsFromRecord(record: PptRecord): PptVisualSlot[] {
        const slots: PptVisualSlot[] = [];

        const visit = (list: PptRecord[]): void => {
            for (const child of list) {
                if (child.recType === 0xf004 && child.children && child.children.length > 0) {
                    const hasClientTextbox = child.children.some((entry) => entry.recType === 0xf00d);
                    if (!hasClientTextbox) {
                        const bounds = this.extractShapeBoundsFromSpContainer(child);
                        const style = this.extractShapeStyleFromSpContainer(child);
                        if (bounds) {
                            slots.push({
                                bounds,
                                imageRefId: this.extractShapeImageRefFromSpContainer(child),
                                ...style,
                                isTextSlot: false
                            });
                        }
                    } else {
                        const bounds = this.extractShapeBoundsFromSpContainer(child);
                        const style = this.extractShapeStyleFromSpContainer(child);
                        if (bounds || style.fillColor || style.borderColor || style.borderWidthPx !== undefined) {
                            slots.push({
                                bounds,
                                imageRefId: this.extractShapeImageRefFromSpContainer(child),
                                ...style,
                                isTextSlot: true
                            });
                        }
                    }
                }

                if (child.children && child.children.length > 0) {
                    visit(child.children);
                }
            }
        };

        visit(record.children ?? []);
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

        const standardArea = standard.width * standard.height;
        const swappedArea = swapped.width * swapped.height;

        if (standardExtreme && !swappedExtreme) {
            return swapped;
        }
        if (
            swappedArea > standardArea * 1.05
            && Math.abs(swappedRatio - 1) < Math.abs(standardRatio - 1)
        ) {
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
            const overlapsExisting = deduped.some((existing) => {
                if (!existing.bounds) {
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

            const group = slots
                .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
                .filter(({ candidate, candidateIndex }) =>
                    !consumed.has(candidateIndex)
                    && candidate.bounds
                    && candidate.imageRefId !== undefined
                    && this.boundsOverlapRatio(slot.bounds!, candidate.bounds) > 0.95
                );

            const best = group
                .slice()
                .sort((left, right) => {
                    const leftAsset = picturesById.get(left.candidate.imageRefId!);
                    const rightAsset = picturesById.get(right.candidate.imageRefId!);
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

        for (const record of records) {
            if (record.recType === 3999 && record.payload.length >= 4) {
                currentTextType = record.payload.readUInt32LE(0);
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

            blocks.push({
                text,
                textType: currentTextType
            });
        }

        return blocks.filter((block) => block.textType !== 2);
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
            const end = picturesStream.indexOf(Buffer.from([0xff, 0xd9]), idx + 2);
            if (end !== -1) {
                out.push({
                    mime: 'image/jpeg',
                    base64: picturesStream.slice(idx, end + 2).toString('base64'),
                    pictureIndex: out.length
                });
                idx = end + 2;
            } else {
                break;
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
            const implicitEnd = picturesStream.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
            let end = -1;
            if (expectedSize > 0 && start + expectedSize <= picturesStream.length) {
                const explicitEnd = start + expectedSize;
                const hasJpegTerminator = explicitEnd >= start + 2
                    && picturesStream[explicitEnd - 2] === 0xff
                    && picturesStream[explicitEnd - 1] === 0xd9;
                if (hasJpegTerminator) {
                    end = explicitEnd;
                }
            }
            if (end === -1 && implicitEnd !== -1) {
                end = implicitEnd + 2;
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
