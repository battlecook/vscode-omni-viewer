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
        borderWidthPx?: number;
    }>;
}

interface PptTextBlock {
    text: string;
    textType?: number;
    placeholderType?: number;
    bounds?: PptShapeBounds;
    fillColor?: string;
    borderColor?: string;
    borderWidthPx?: number;
    fillVisible?: boolean;
    borderVisible?: boolean;
}

interface PptTextGroup {
    blocks: PptTextBlock[];
    placeholderType?: number;
    bounds?: PptShapeBounds;
    fillColor?: string;
    borderColor?: string;
    borderWidthPx?: number;
    fillVisible?: boolean;
    borderVisible?: boolean;
}

interface PptShapeBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface PptVisualSlot {
    placeholderType?: number;
    bounds?: PptShapeBounds;
    fillColor?: string;
    borderColor?: string;
    isTextSlot?: boolean;
    borderWidthPx?: number;
    fillVisible?: boolean;
    borderVisible?: boolean;
}

interface PptColorScheme {
    backgroundColor?: string;
    textColor?: string;
    titleColor?: string;
    fillColor?: string;
}

interface PptSlideLayoutInfo {
    geom: number;
    placeholders: number[];
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
        const pictures = this.extractPictures(cfb.getStream('Pictures'));
        const outlineTextByPersistId = this.extractOutlineTextByPersistId(records);
        const defaultColorScheme = this.extractDocumentColorScheme(records);

        const presentationSize = this.extractPresentationSize(records);
        const widthPx = presentationSize?.widthPx ?? 960;
        const heightPx = presentationSize?.heightPx ?? 720;
        const slides = this.buildSlides(slideRecords, pictures, outlineTextByPersistId, defaultColorScheme, widthPx, heightPx);

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

    private static extractPresentationSize(records: PptRecord[]): { widthPx: number; heightPx: number } | null {
        for (const record of records) {
            if (record.recType === 1000 && record.children && record.children.length > 0) {
                const documentAtom = record.children.find((child) => child.recType === 1001 && child.payload.length >= 8);
                if (!documentAtom) {
                    continue;
                }

                const widthPoints = documentAtom.payload.readUInt32LE(0);
                const heightPoints = documentAtom.payload.readUInt32LE(4);
                const widthPx = this.pointsToPixels(widthPoints);
                const heightPx = this.pointsToPixels(heightPoints);

                if (widthPx && heightPx) {
                    return { widthPx, heightPx };
                }
            }

            if (record.children && record.children.length > 0) {
                const nestedSize = this.extractPresentationSize(record.children);
                if (nestedSize) {
                    return nestedSize;
                }
            }
        }

        return null;
    }

    private static pointsToPixels(points: number): number | null {
        if (!Number.isFinite(points) || points <= 0) {
            return null;
        }

        return Math.max(1, Math.round(points * this.POINTS_TO_PX));
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
        pictures: Array<{ mime: string; base64: string }>,
        outlineTextByPersistId: Map<number, PptTextBlock[]>,
        defaultColorScheme: PptColorScheme | null,
        widthPx: number,
        heightPx: number
    ): PptSlideModel[] {
        const slides: PptSlideModel[] = [];
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
            const textBlocks: PptTextBlock[] = outlineBlocks.length > 0
                ? this.decorateTextBlocksWithPlaceholders(this.normalizeTextBlocks(outlineBlocks), layout)
                : shapeTextGroups.length > 0
                    ? this.flattenTextGroups(shapeTextGroups)
                : directBlocks.length > 0
                    ? this.decorateTextBlocksWithPlaceholders(this.normalizeTextBlocks(directBlocks), layout)
                    : this.extractTextsFromRecord(slideRecord).slice(0, 24).map((text) => ({ text }));
            const elements: PptSlideModel['elements'] = [];
            const titleBlocks = textBlocks.filter((block) => {
                const role = this.classifyPlaceholderType(block.placeholderType);
                return role === 'title' || role === 'subtitle' || this.isTitleTextType(block.textType);
            });
            const bodyBlocks = textBlocks.filter((block) => {
                const role = this.classifyPlaceholderType(block.placeholderType);
                return role !== 'title' && role !== 'subtitle' && !this.isTitleTextType(block.textType);
            });

            if (textBlocks.length > 0) {
                textBlocks.forEach((block, idx) => {
                    const placeholderRole = this.classifyPlaceholderType(block.placeholderType);
                    const isTitle = placeholderRole === 'title'
                        || this.isTitleTextType(block.textType)
                        || (idx === 0 && titleBlocks.length === 0);
                    const defaultTextColor = isTitle ? colorScheme?.titleColor : colorScheme?.textColor;
                    const paragraphs = this.createParagraphsFromText(
                        block.text,
                        this.isBulletTextType(block.textType, !isTitle) && placeholderRole !== 'subtitle',
                        defaultTextColor
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
                    const positionedFrame = block.bounds
                        ? this.normalizeBounds(block.bounds, widthPx, heightPx)
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
                        borderWidthPx: block.borderVisible === false ? undefined : block.borderWidthPx
                    });
                });
            }

            // Minimal image support: use discovered picture/object frames when available.
            const preferredSlots = visualSlots.filter((slot) => this.isVisualPlaceholder(slot.placeholderType) && !!slot.bounds);
            const boundedSlots = preferredSlots.length > 0
                ? preferredSlots
                : visualSlots.filter((slot) => !!slot.bounds);
            const usedImageSlots = new Set<PptVisualSlot>();

            if (boundedSlots.length > 0) {
                boundedSlots.slice(0, pictures.length).forEach((slot, imageIndex) => {
                    const img = pictures[imageIndex];
                    if (!img || !slot.bounds) {
                        return;
                    }

                    const imageFrame = this.normalizeBounds(slot.bounds, widthPx, heightPx);
                    elements.push({
                        type: 'image',
                        x: imageFrame.x,
                        y: imageFrame.y,
                        width: imageFrame.width,
                        height: imageFrame.height,
                        zIndex: 100 + imageIndex,
                        src: `data:${img.mime};base64,${img.base64}`
                    });
                    usedImageSlots.add(slot);
                });
            } else {
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
            }

            visualSlots.forEach((slot, index) => {
                if (!slot.bounds || usedImageSlots.has(slot) || slot.isTextSlot) {
                    return;
                }
                if (!slot.fillColor && !slot.borderColor) {
                    return;
                }

                const shapeFrame = this.normalizeBounds(slot.bounds, widthPx, heightPx);
                elements.push({
                    type: 'shape',
                    x: shapeFrame.x,
                    y: shapeFrame.y,
                    width: shapeFrame.width,
                    height: shapeFrame.height,
                    zIndex: 50 + index,
                    fillColor: slot.fillVisible === false ? undefined : slot.fillColor,
                    borderColor: slot.borderVisible === false ? undefined : slot.borderColor,
                    borderWidthPx: slot.borderVisible === false ? undefined : slot.borderWidthPx
                });
            });

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
                textType: block.textType
            });
        });

        return normalized;
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
                    fillVisible: titleCandidate.fillVisible ?? group.fillVisible,
                    borderVisible: titleCandidate.borderVisible ?? group.borderVisible
                });
                flattened.push({
                    text: bodyCandidates.map((block) => block.text).join('\r'),
                    textType: bodyCandidates[0].textType,
                    placeholderType: bodyCandidates[0].placeholderType ?? group.placeholderType,
                    bounds: bodyCandidates[0].bounds ?? group.bounds,
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
                fillColor: normalizedBlocks[0].fillColor ?? group.fillColor,
                borderColor: normalizedBlocks[0].borderColor ?? group.borderColor,
                borderWidthPx: normalizedBlocks[0].borderWidthPx ?? group.borderWidthPx,
                fillVisible: normalizedBlocks[0].fillVisible ?? group.fillVisible,
                borderVisible: normalizedBlocks[0].borderVisible ?? group.borderVisible
            });
        });

        return flattened;
    }

    private static createParagraphsFromText(
        text: string,
        defaultBullet: boolean,
        defaultColor?: string
    ): NonNullable<PptSlideModel['elements'][number]['paragraphs']> {
        return text
            .split('\r')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
            .map((part, index) => ({
                text: part,
                level: 0,
                bullet: defaultBullet && index > 0,
                color: defaultColor
            }));
    }

    private static isTitleTextType(textType?: number): boolean {
        return textType === 0 || textType === 6;
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

            return record.payload.toString('latin1');
        }

        return null;
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
                            slots.push({ bounds, ...style, isTextSlot: false });
                        }
                    } else {
                        const bounds = this.extractShapeBoundsFromSpContainer(child);
                        const style = this.extractShapeStyleFromSpContainer(child);
                        if (bounds || style.fillColor || style.borderColor || style.borderWidthPx !== undefined) {
                            slots.push({
                                bounds,
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

        const left = payload.readInt16LE(0);
        const top = payload.readInt16LE(2);
        const right = payload.readInt16LE(4);
        const bottom = payload.readInt16LE(6);
        return this.makeBounds(left, top, right, bottom);
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

    private static normalizeBounds(bounds: PptShapeBounds, slideWidth: number, slideHeight: number): PptShapeBounds {
        const width = Math.max(24, Math.min(slideWidth, bounds.width));
        const height = Math.max(24, Math.min(slideHeight, bounds.height));
        const maxX = Math.max(0, slideWidth - width);
        const maxY = Math.max(0, slideHeight - height);
        const x = Math.max(0, Math.min(maxX, bounds.x));
        const y = Math.max(0, Math.min(maxY, bounds.y));

        return { x, y, width, height };
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
