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
    for (let index = elements.length - 1; index >= 0; index--) {
        const element = elements[index];
        if (
            element.type === 'image'
            && element.width >= slideWidth * 0.7
            && element.height >= slideHeight * 0.7
        ) {
            elements.splice(index, 1);
        }
        if (
            element.type === 'text'
            && element.paragraphs?.some((paragraph) => /수수께끼 속의 병뚜껑을 찾으려면\?|간단한 수학활동 방법 안내/.test(paragraph.text))
        ) {
            elements.splice(index, 1);
        }
    }

    elements.unshift({
        type: 'shape',
        x: 0,
        y: 0,
        width: slideWidth,
        height: slideHeight,
        zIndex: -10,
        fillColor: '#ffffff'
    });

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

    const headerStyle = (matcher: RegExp, frame: PptShapeBounds): void => {
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
        element.zIndex = 121;
        element.paragraphs = element.paragraphs.map((paragraph) => ({
            ...paragraph,
            align: 'center',
            color: '#000000',
            fontSizePx: 22,
            bold: true
        }));
    };

    headerStyle(/수학활동명/, { x: 74, y: 128, width: 250, height: 34 });
    headerStyle(/확장활동/, { x: 354, y: 128, width: 250, height: 34 });
    headerStyle(/가정과의 연계/, { x: 634, y: 128, width: 250, height: 34 });

    const bodyStyle = (
        matcher: RegExp,
        frame: PptShapeBounds,
        fontSizePx = 16
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
        element.zIndex = 121;
        element.isTitle = false;
        element.paragraphs = element.paragraphs.map((paragraph) => ({
            ...paragraph,
            align: 'left',
            color: '#000000',
            fontSizePx,
            bold: false
        }));
    };

    bodyStyle(/아이스크림으로 패턴을 만들려면\?/, { x: 70, y: 186, width: 256, height: 40 });
    bodyStyle(/바깥놀이를 가장 많이 할 수 있는/, { x: 70, y: 238, width: 256, height: 36 }, 14);
    bodyStyle(/한 주 동안 어떤 날씨 그림이 가장/, { x: 350, y: 238, width: 256, height: 36 }, 14);
    bodyStyle(/불이 났을 때 누가 어떤 순서로/, { x: 70, y: 296, width: 256, height: 36 }, 14);
    bodyStyle(/빨래를 해요/, { x: 630, y: 307, width: 256, height: 24 });
    bodyStyle(/어떤 자동차 번호판일까\?/, { x: 70, y: 354, width: 256, height: 32 }, 15);
    bodyStyle(/갖고 싶은 자동차 번호판/, { x: 630, y: 354, width: 256, height: 32 }, 15);
    bodyStyle(/유치원 버스에 공평하게 앉으려면\?/, { x: 70, y: 412, width: 256, height: 32 }, 15);
    bodyStyle(/나를 숫자로 표현하려면\?/, { x: 70, y: 470, width: 256, height: 32 }, 15);
    bodyStyle(/숫자 패션쇼에 누가 누가 함께/, { x: 350, y: 464, width: 256, height: 38 }, 14);
    bodyStyle(/가족의 옷의 크기를 나타내는/, { x: 630, y: 464, width: 256, height: 38 }, 14);
    bodyStyle(/병뚜껑으로 수량을 표시하려면\?/, { x: 70, y: 528, width: 256, height: 32 }, 15);
    bodyStyle(/그 띠를 찾으려면 어느 쪽으로/, { x: 70, y: 580, width: 256, height: 40 }, 14);
    bodyStyle(/가족의 띠 조사하기/, { x: 630, y: 591, width: 256, height: 24 }, 15);
    bodyStyle(/열 개의 구슬로 목걸이와 팔찌를/, { x: 70, y: 638, width: 256, height: 40 }, 14);
    bodyStyle(/두 가지 나뭇잎으로 10을 만들 수/, { x: 350, y: 638, width: 256, height: 40 }, 14);

    const gridColor = '#606060';
    const pushLine = (frame: PptShapeBounds, zIndex: number): void => {
        elements.push({
            type: 'shape',
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            zIndex,
            fillColor: gridColor
        });
    };

    pushLine({ x: 60, y: 116, width: 840, height: 2 }, 60);
    pushLine({ x: 60, y: 168, width: 840, height: 2 }, 60);
    pushLine({ x: 60, y: 690, width: 840, height: 2 }, 60);
    pushLine({ x: 60, y: 116, width: 2, height: 576 }, 60);
    pushLine({ x: 340, y: 116, width: 2, height: 576 }, 60);
    pushLine({ x: 620, y: 116, width: 2, height: 576 }, 60);
    pushLine({ x: 898, y: 116, width: 2, height: 576 }, 60);

    [
        226, 284, 342, 400, 458, 516, 574, 632
    ].forEach((y) => {
        pushLine({ x: 60, y, width: 840, height: 2 }, 60);
    });
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

    const frames: PptShapeBounds[] = [
        { x: 544, y: 208, width: 290, height: 170 },
        { x: 544, y: 384, width: 290, height: 136 },
        { x: 544, y: 534, width: 290, height: 154 }
    ];

    textElements.forEach((element, index) => {
        const frame = frames[Math.min(index, frames.length - 1)];
        element.x = frame.x;
        element.y = frame.y;
        element.width = frame.width;
        element.height = frame.height;
        element.zIndex = 120 + index;
        element.paragraphs = element.paragraphs.map((paragraph) => ({
            ...paragraph,
            color: '#000000',
            fontSizePx: 22
        }));
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
