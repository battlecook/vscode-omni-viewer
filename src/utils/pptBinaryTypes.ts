export interface CfbEntry {
    name: string;
    type: number;
    leftId: number;
    rightId: number;
    childId: number;
    startSector: number;
    size: number;
}

export interface CfbParseResult {
    getStream(name: string): Buffer | null;
}

export interface PptRecord {
    recType: number;
    recInstance: number;
    recVer: number;
    length: number;
    payloadOffset: number;
    payload: Buffer;
    children?: PptRecord[];
}

export interface PptShapeBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PptTextBlock {
    text: string;
    textType?: number;
    placeholderType?: number;
    bounds?: PptShapeBounds;
    color?: string;
    fontSizePx?: number;
    fillColor?: string;
    borderColor?: string;
    borderWidthPx?: number;
    fillVisible?: boolean;
    borderVisible?: boolean;
}

export interface PptTextGroup {
    blocks: PptTextBlock[];
    placeholderType?: number;
    bounds?: PptShapeBounds;
    fillColor?: string;
    borderColor?: string;
    borderWidthPx?: number;
    fillVisible?: boolean;
    borderVisible?: boolean;
}

export interface PptVisualSlot {
    placeholderType?: number;
    bounds?: PptShapeBounds;
    fillColor?: string;
    borderColor?: string;
    imageRefId?: number;
    isTextSlot?: boolean;
    borderWidthPx?: number;
    fillVisible?: boolean;
    borderVisible?: boolean;
}

export interface PptColorScheme {
    backgroundColor?: string;
    textColor?: string;
    titleColor?: string;
    fillColor?: string;
}

export interface PptSlideLayoutInfo {
    geom: number;
    placeholders: number[];
}

export interface PptPictureAsset {
    mime: string;
    base64: string;
    pictureIndex?: number;
}

export interface PptSlideElementParagraph {
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
}

export interface PptSlideElement {
    type: 'text' | 'image' | 'shape';
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    isTitle?: boolean;
    paragraphs?: PptSlideElementParagraph[];
    src?: string;
    fillColor?: string;
    borderColor?: string;
    borderWidthPx?: number;
    textStylePreset?: string;
}

export interface PptSlideModel {
    slideNumber: number;
    widthPx: number;
    heightPx: number;
    backgroundColor: string;
    elements: PptSlideElement[];
}

export interface PptPresentationMetrics {
    widthPx: number;
    heightPx: number;
    rawWidth: number;
    rawHeight: number;
}
