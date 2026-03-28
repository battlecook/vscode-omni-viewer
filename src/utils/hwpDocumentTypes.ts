export type HwpSourceFormat = 'hwp' | 'hwpx';

export interface HwpLayoutRun {
    text: string;
    sourceIndex?: number;
    textOffset?: number;
    noteRefId?: string;
    noteMarker?: string;
    noteKind?: 'footnote' | 'endnote';
    fontSizePt?: number;
    fontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
    textDecoration?: string;
    verticalAlign?: 'super' | 'sub';
    letterSpacingEm?: number;
    backgroundColor?: string;
    color?: string;
}

export interface HwpLayoutParagraph {
    id: string;
    kind: 'paragraph';
    sourceIndex?: number;
    semanticRole?: 'body' | 'header' | 'footer' | 'caption' | 'list-item';
    styleSource?: 'direct' | 'referenced' | 'mixed' | 'default';
    align: 'left' | 'center' | 'right' | 'justify';
    lineHeight: number;
    fontSizePt?: number;
    marginTopPt?: number;
    marginBottomPt?: number;
    marginLeftPt?: number;
    marginRightPt?: number;
    textIndentPt?: number;
    tabStopsPt?: number[];
    runs: HwpLayoutRun[];
    inlineBlocks?: Array<HwpLayoutImageBlock | HwpLayoutLineBlock | HwpLayoutTextBoxBlock>;
}

export interface HwpLayoutTableCell {
    id?: string;
    text: string;
    paragraphs?: HwpLayoutTableCellParagraph[];
    sourceStart?: number;
    sourceEnd?: number;
    colSpan?: number;
    rowSpan?: number;
    rowStart?: number;
    rowEnd?: number;
    colStart?: number;
    colEnd?: number;
    totalRows?: number;
    totalCols?: number;
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

export interface HwpLayoutTableCellParagraph {
    id?: string;
    text: string;
    align?: 'left' | 'center' | 'right' | 'justify';
    lineHeight?: number;
    textIndentPt?: number;
    tabStopsPt?: number[];
    runs: HwpLayoutRun[];
    inlineBlocks?: Array<HwpLayoutImageBlock | HwpLayoutTextBoxBlock | HwpLayoutLineBlock>;
}

export interface HwpLayoutTableBlock {
    id: string;
    kind: 'table';
    sourceIndex?: number;
    semanticRole?: 'body' | 'header' | 'footer' | 'caption';
    rows: HwpLayoutTableRow[];
    anchorParagraphId?: string;
    widthPt?: number;
    marginTopPt?: number;
    marginBottomPt?: number;
}

export interface HwpLayoutImageBlock {
    id: string;
    kind: 'image';
    sourceIndex?: number;
    inlineOffset?: number;
    inlineTextOffset?: number;
    src?: string;
    alt: string;
    positioning?: 'inline' | 'absolute';
    anchorScope?: 'page' | 'paragraph' | 'cell' | 'character';
    anchorParagraphId?: string;
    anchorCellId?: string;
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
    sourceIndex?: number;
    inlineOffset?: number;
    inlineTextOffset?: number;
    positioning?: 'inline' | 'absolute';
    anchorScope?: 'page' | 'paragraph' | 'cell' | 'character';
    anchorParagraphId?: string;
    anchorCellId?: string;
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
    sourceIndex?: number;
    inlineOffset?: number;
    inlineTextOffset?: number;
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
    anchorParagraphId?: string;
    anchorCellId?: string;
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
    sectionIndex?: number;
    sourcePageIndex?: number;
    splitPageIndex?: number;
    sectionType?: 'single-column' | 'multi-column';
    columnCount?: number;
    columnGapPt?: number;
    pageNumberStart?: number;
    headerFooterVariant?: 'default' | 'first' | 'odd' | 'even';
    footnoteCount?: number;
    endnoteCount?: number;
    footnotes?: Array<{ id: string; marker: string; text: string }>;
    endnotes?: Array<{ id: string; marker: string; text: string }>;
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
    layoutSignature?: string;
    semanticSummary?: string;
    blocks: HwpLayoutBlock[];
}

export interface HwpLayoutDocument {
    format: HwpSourceFormat;
    stage: 'step2-paragraph-layout';
    fileName: string;
    fileSize: string;
    layoutSignature?: string;
    semanticSummary?: string;
    pages: HwpLayoutPage[];
    warnings: string[];
}

export type HwpxParagraphStyle = Omit<HwpLayoutParagraph, 'id' | 'kind' | 'runs'>;

export interface HwpxExtractedParagraph extends HwpxParagraphStyle {
    sourceIndex: number;
    runs: HwpLayoutRun[];
}

export interface HwpxStyleIndex {
    styleBlocksByRefId: Map<string, string[]>;
    paragraphStyleCache: Map<string, HwpxParagraphStyle>;
}
