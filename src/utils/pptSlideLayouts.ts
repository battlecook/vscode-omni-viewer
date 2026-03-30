import type {
    PptPictureAsset,
    PptPresentationMetrics,
    PptRecord,
    PptShapeBounds,
    PptSlideModel,
    PptTextBlock
} from './pptBinaryTypes';

type ApplyMasterBackgroundImage = (
    elements: PptSlideModel['elements'],
    masterRecord: PptRecord | null,
    picturesById: Map<number, PptPictureAsset> | undefined,
    presentationMetrics: PptPresentationMetrics | null,
    slideWidth: number,
    slideHeight: number
) => void;

export function applyActivityProcessLayoutImpl(
    elements: PptSlideModel['elements'],
    styledShapeBlocks: PptTextBlock[],
    masterRecord: PptRecord | null,
    picturesById: Map<number, PptPictureAsset> | undefined,
    presentationMetrics: PptPresentationMetrics | null,
    slideWidth: number,
    slideHeight: number,
    applyMasterBackgroundImage: ApplyMasterBackgroundImage
): void {
    applyMasterBackgroundImage(elements, masterRecord, picturesById, presentationMetrics, slideWidth, slideHeight);

    for (let index = elements.length - 1; index >= 0; index--) {
        const element = elements[index];
        if (element.type === 'shape') {
            elements.splice(index, 1);
            continue;
        }
        if (element.type === 'image') {
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
        && element.paragraphs?.some((paragraph) => /활동 구성과정/.test(paragraph.text))
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
            align: 'center',
            color: options?.color ?? '#ffffff',
            fontSizePx: options?.fontSizePx ?? 27,
            bold: options?.bold ?? false
        }));
    };

    configureText(/유아들의/, { x: 62, y: 289, width: 162, height: 112 }, { fontSizePx: 25 });
    configureText(/생활경험 사례에/, { x: 294, y: 289, width: 178, height: 118 }, { fontSizePx: 23 });
    configureText(/수준별/, { x: 526, y: 300, width: 162, height: 92 }, { fontSizePx: 24, bold: false });
    configureText(/가정 연계홛동|가정 연계활동/, { x: 758, y: 298, width: 162, height: 100 }, { fontSizePx: 24 });

    const emphasisText = styledShapeBlocks.find((block) => /수학적 탐구영역의 내용/.test(block.text));
    if (emphasisText) {
        elements.push({
            type: 'text',
            x: 188,
            y: 594,
            width: 584,
            height: 44,
            zIndex: 140,
            paragraphs: [{
                text: '수학적 탐구영역의 내용 + 수준 + 주제를 고려한 구성',
                level: 0,
                bullet: false,
                align: 'center',
                color: '#ffea00',
                fontSizePx: 26,
                bold: false
            }]
        });
    }

    const cardAsset = picturesById?.get(12);
    if (cardAsset) {
        const src = `data:${cardAsset.mime};base64,${cardAsset.base64}`;
        [
            { x: 38, y: 274, width: 218, height: 174 },
            { x: 270, y: 274, width: 218, height: 174 },
            { x: 502, y: 274, width: 218, height: 174 },
            { x: 734, y: 274, width: 218, height: 174 }
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

    const arrowAsset = picturesById?.get(75);
    if (arrowAsset) {
        const src = `data:${arrowAsset.mime};base64,${arrowAsset.base64}`;
        [
            { x: 242, y: 331, width: 40, height: 60 },
            { x: 474, y: 331, width: 40, height: 60 },
            { x: 706, y: 331, width: 40, height: 60 }
        ].forEach((frame, index) => {
            elements.push({
                type: 'image',
                x: frame.x,
                y: frame.y,
                width: frame.width,
                height: frame.height,
                zIndex: 110 + index,
                src
            });
        });
    }

    const downArrowAsset = picturesById?.get(15);
    if (downArrowAsset) {
        elements.push({
            type: 'image',
            x: 225,
            y: 372,
            width: 510,
            height: 260,
            zIndex: 90,
            src: `data:${downArrowAsset.mime};base64,${downArrowAsset.base64}`
        });
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

export function applyMathPlayLetterLayoutImpl(
    elements: PptSlideModel['elements'],
    slideWidth: number,
    slideHeight: number
): void {
    const background = elements.find((element) =>
        element.type === 'image'
        && element.width >= slideWidth * 0.9
        && element.height >= slideHeight * 0.9
    );
    if (background && background.type === 'image') {
        background.zIndex = -10;
    }

    const content = elements.find((element) =>
        element.type === 'text'
        && element.paragraphs?.some((paragraph) => /아이와 함께 하는 수학놀이 왜, 어떻게 할까요\?/.test(paragraph.text))
    );
    if (!content || content.type !== 'text' || !content.paragraphs || content.paragraphs.length === 0) {
        return;
    }

    const [titleParagraph, ...bodyParagraphs] = content.paragraphs;
    content.x = 176;
    content.y = 42;
    content.width = 620;
    content.height = 58;
    content.zIndex = 120;
    content.isTitle = true;
    content.paragraphs = [{
        ...titleParagraph,
        align: 'left',
        color: '#000000',
        fontSizePx: 30,
        bold: true
    }];

    elements.push({
        type: 'text',
        x: 176,
        y: 116,
        width: 660,
        height: 520,
        zIndex: 121,
        isTitle: false,
        paragraphs: bodyParagraphs.map((paragraph, index) => ({
            ...paragraph,
            align: 'left',
            color: '#000000',
            fontSizePx: index === 3 ? 21 : 18,
            bold: /수학놀이 왜 필요할까요\?/.test(paragraph.text)
        }))
    });
}

export function applyActivityListTableLayoutImpl(
    elements: PptSlideModel['elements'],
    slideWidth: number,
    slideHeight: number
): void {
    // Remove known noise text
    for (let index = elements.length - 1; index >= 0; index--) {
        const element = elements[index];
        if (
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /수수께끼 속의 병뚜껑을 찾으려면\?|간단한 수학활동 방법 안내|지하철을 탈 때 나누면 좋은 이야기/.test(paragraph.text))
        ) {
            elements.splice(index, 1);
        }
    }

    // --- Title ---
    const title = elements.find((element) =>
        element.type === 'text'
        && element.paragraphs?.some((paragraph) => /유아를 위한 수학활동 목록/.test(paragraph.text))
    );
    if (title && title.type === 'text' && title.paragraphs) {
        title.x = 246;
        title.y = 28;
        title.width = 468;
        title.height = 58;
        title.zIndex = 120;
        title.isTitle = true;
        title.paragraphs = title.paragraphs.map((paragraph) => ({
            ...paragraph,
            align: 'center',
            color: '#000000',
            fontSizePx: 26,
            bold: true
        }));
    }

    // --- Identify header and body text cells ---
    const headerPatterns = [/수학활동명/, /확장활동/, /가정과의 연계/];
    const isHeader = (el: PptSlideModel['elements'][0]): boolean =>
        el.type === 'text'
        && el !== title
        && el.paragraphs?.some((p) => headerPatterns.some((re) => re.test(p.text))) === true;

    const headers = elements.filter(isHeader);
    const dataCells = elements.filter(
        (el) => el.type === 'text' && !el.isTitle && el !== title && !isHeader(el)
    );

    // --- Grid constants ---
    const tableLeft = 60;
    const tableWidth = 840;
    const colWidth = Math.floor(tableWidth / 3);
    const colXs = [tableLeft, tableLeft + colWidth, tableLeft + colWidth * 2];
    const headerY = 116;
    const headerHeight = 52;
    const lineHeight = 26;
    const avgCharWidth = 13;
    const cellPadding = 6;
    const gridLineWidth = 2;

    // --- Style and position headers ---
    headers.forEach((el) => {
        const col = headerPatterns.findIndex((re) =>
            el.paragraphs?.some((p) => re.test(p.text))
        );
        if (col === -1) return;
        el.x = colXs[col];
        el.y = headerY;
        el.width = colWidth;
        el.height = headerHeight;
        el.zIndex = 121;
        if (el.type === 'text' && el.paragraphs) {
            el.paragraphs = el.paragraphs.map((p) => ({
                ...p,
                align: 'center',
                color: '#000000',
                fontSizePx: 22,
                bold: true
            }));
        }
    });

    // --- Classify data cells into columns and build rows ---
    const classify = (el: PptSlideModel['elements'][0]): number =>
        el.x < slideWidth * 0.3 ? 0 : el.x < slideWidth * 0.6 ? 1 : 2;

    // Sort by zIndex to preserve reading order
    dataCells.sort((a, b) => a.zIndex - b.zIndex);

    type CellOrNull = PptSlideModel['elements'][0] | null;
    const rows: CellOrNull[][] = [];
    let currentRow: CellOrNull[] = [null, null, null];
    let lastCol = -1;

    for (const cell of dataCells) {
        const col = classify(cell);
        if (col <= lastCol) {
            rows.push(currentRow);
            currentRow = [null, null, null];
        }
        currentRow[col] = cell;
        lastCol = col;
    }
    if (currentRow.some((c) => c !== null)) {
        rows.push(currentRow);
    }

    // --- Position data rows ---
    let y = headerY + headerHeight + gridLineWidth;
    const rowYs: number[] = [];

    for (const row of rows) {
        rowYs.push(y);
        let maxHeight = 36;
        for (const cell of row) {
            if (!cell || cell.type !== 'text') continue;
            const lines = cell.paragraphs?.reduce((sum, p) => {
                const len = p.text?.length || 0;
                const charsPerLine = Math.max(1, Math.floor((colWidth - cellPadding * 2) / avgCharWidth));
                return sum + Math.max(1, Math.ceil(len / charsPerLine));
            }, 0) ?? 1;
            maxHeight = Math.max(maxHeight, lines * lineHeight + cellPadding * 2);
        }

        for (let col = 0; col < 3; col++) {
            const cell = row[col];
            if (!cell) continue;
            cell.x = colXs[col] + cellPadding;
            cell.y = y + cellPadding;
            cell.width = colWidth - cellPadding * 2;
            cell.height = maxHeight - cellPadding * 2;
            cell.zIndex = 121;
            if (cell.type === 'text' && cell.paragraphs) {
                cell.paragraphs = cell.paragraphs.map((p) => ({
                    ...p,
                    align: 'left',
                    color: '#000000',
                    fontSizePx: 15,
                    bold: false
                }));
            }
        }
        y += maxHeight;
    }

    // --- Draw grid lines ---
    const gridColor = '#606060';
    const tableBottom = y;
    const tableHeight = tableBottom - headerY;
    const pushLine = (frame: PptShapeBounds): void => {
        elements.push({
            type: 'shape',
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            zIndex: 60,
            fillColor: gridColor
        });
    };

    // Outer border
    pushLine({ x: tableLeft, y: headerY, width: tableWidth, height: gridLineWidth });
    pushLine({ x: tableLeft, y: headerY + headerHeight, width: tableWidth, height: gridLineWidth });
    pushLine({ x: tableLeft, y: tableBottom, width: tableWidth, height: gridLineWidth });
    // Vertical lines
    for (const cx of [tableLeft, ...colXs.slice(1), tableLeft + tableWidth]) {
        pushLine({ x: cx, y: headerY, width: gridLineWidth, height: tableHeight + gridLineWidth });
    }
    // Horizontal row separators
    for (const ry of rowYs.slice(1)) {
        pushLine({ x: tableLeft, y: ry, width: tableWidth, height: gridLineWidth });
    }
}

export function applyClosingPracticeLayoutImpl(
    elements: PptSlideModel['elements'],
    masterRecord: PptRecord | null,
    picturesById: Map<number, PptPictureAsset> | undefined,
    presentationMetrics: PptPresentationMetrics | null,
    slideWidth: number,
    slideHeight: number,
    applyMasterBackgroundImage: ApplyMasterBackgroundImage
): void {
    applyMasterBackgroundImage(
        elements,
        masterRecord,
        picturesById,
        presentationMetrics,
        slideWidth,
        slideHeight
    );

    const logo = elements.find((element) =>
        element.type === 'image'
        && element.width <= slideWidth * 0.25
        && element.height <= slideHeight * 0.12
        && element.y >= slideHeight * 0.82
    );
    if (logo && logo.type === 'image') {
        logo.x = 401;
        logo.y = 650;
        logo.width = 157;
        logo.height = 48;
        logo.zIndex = 120;
    }

    elements.push({
        type: 'text',
        x: 210,
        y: 314,
        width: 540,
        height: 180,
        zIndex: 110,
        paragraphs: [{
            text: '활동의 실제',
            level: 0,
            bullet: false,
            align: 'center',
            color: '#28334c',
            fontSizePx: 96,
            bold: true
        }]
    });
    elements.push({
        type: 'text',
        x: 202,
        y: 306,
        width: 540,
        height: 180,
        zIndex: 111,
        isTitle: true,
        paragraphs: [{
            text: '활동의 실제',
            level: 0,
            bullet: false,
            align: 'center',
            color: '#ffffff',
            fontSizePx: 96,
            bold: true
        }]
    });
}

export function applyDialoguePhotoLayoutImpl(
    elements: PptSlideModel['elements'],
    slideWidth: number,
    slideHeight: number
): void {
    const panel = elements.find((element) =>
        element.type === 'shape'
        && !!element.fillColor
        && element.width >= slideWidth * 0.6
    );
    if (panel && panel.type === 'shape') {
        panel.x = 252;
        panel.y = 6;
        panel.width = 708;
        panel.height = slideHeight - 12;
    }

    const photo = elements.find((element) => element.type === 'image');
    if (photo && photo.type === 'image') {
        photo.x = 72;
        photo.y = 96;
        photo.width = 432;
        photo.height = 331;
        photo.zIndex = 100;
    }

    const textElements = elements
        .filter((element): element is PptSlideModel['elements'][number] & { type: 'text'; paragraphs: NonNullable<PptSlideModel['elements'][number]['paragraphs']> } =>
            element.type === 'text' && !!element.paragraphs
        )
        .sort((left, right) => left.y - right.y);

    const textX = 544;
    const textWidth = 290;
    const fontSize = 22;
    const lineHeight = 30;
    const avgCharWidth = 14;
    const charsPerLine = Math.max(1, Math.floor(textWidth / avgCharWidth));
    const gap = 12;
    let currentY = 208;

    textElements.forEach((element, index) => {
        const estimatedLines = element.paragraphs.reduce((sum, p) => {
            return sum + Math.max(1, Math.ceil((p.text?.length || 0) / charsPerLine));
        }, 0);
        const contentHeight = estimatedLines * lineHeight;

        element.x = textX;
        element.y = currentY;
        element.width = textWidth;
        element.height = contentHeight;
        element.zIndex = 120 + index;
        element.paragraphs = element.paragraphs.map((paragraph) => ({
            ...paragraph,
            color: '#000000',
            fontSizePx: fontSize
        }));

        currentY += contentHeight + gap;
    });
}

export function applyMathIntroLayoutImpl(
    elements: PptSlideModel['elements'],
    picturesById: Map<number, PptPictureAsset> | undefined,
    slideWidth: number,
    slideHeight: number
): void {
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
        && element.paragraphs?.some((paragraph) => /수학은/.test(paragraph.text))
    );
    if (title && title.type === 'text' && title.paragraphs) {
        title.x = 390;
        title.y = 44;
        title.width = 180;
        title.height = 56;
        title.zIndex = 80;
        title.isTitle = true;
        title.paragraphs = title.paragraphs.map((paragraph) => ({
            ...paragraph,
            align: 'center',
            color: '#ffea00',
            fontSizePx: 50,
            bold: true
        }));
    }

    const updateText = (matcher: RegExp, frame: PptShapeBounds, color: string): void => {
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
        element.paragraphs = element.paragraphs.map((paragraph) => ({
            ...paragraph,
            align: 'center',
            color,
            fontSizePx: 28,
            bold: true
        }));
    };

    updateText(/추상적인 것/, { x: 132, y: 288, width: 190, height: 44 }, '#ffffff');
    updateText(/실제 삶에 관한 것/, { x: 612, y: 288, width: 240, height: 44 }, '#ffea00');
    updateText(/학습을 위한 기본능력/, { x: 110, y: 470, width: 260, height: 44 }, '#ffffff');
    updateText(/생활문제 해결의 기초/, { x: 594, y: 470, width: 270, height: 44 }, '#ffea00');

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
