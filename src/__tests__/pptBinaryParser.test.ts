import { PptBinaryParser } from '../utils/pptBinaryParser';

function createRecord(recType: number, payload: Buffer, recVer = 0x00, recInstance = 0x0000): Buffer {
    const header = Buffer.alloc(8);
    header.writeUInt16LE((recInstance << 4) | recVer, 0);
    header.writeUInt16LE(recType, 2);
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
}

function createOfficeArtProperty(opid: number, value: number): Buffer {
    const property = Buffer.alloc(6);
    property.writeUInt16LE(opid, 0);
    property.writeUInt32LE(value, 2);
    return property;
}

function createBsePayload(offset: number, size: number, type = 5): Buffer {
    const payload = Buffer.alloc(36);
    payload.writeUInt8(type, 0);
    payload.writeUInt8(type, 1);
    payload.writeUInt16LE(0x00ff, 18);
    payload.writeUInt32LE(size, 20);
    payload.writeUInt32LE(1, 24);
    payload.writeUInt32LE(offset, 28);
    return payload;
}

describe('PptBinaryParser incremental primitives', () => {
    it('extracts presentation size from a DocumentAtom record', () => {
        const documentAtomPayload = Buffer.alloc(8);
        documentAtomPayload.writeUInt32LE(720, 0);
        documentAtomPayload.writeUInt32LE(540, 4);

        const documentContainer = createRecord(
            1000,
            createRecord(1001, documentAtomPayload),
            0x0f
        );

        const records = (PptBinaryParser as any).parseRecords(documentContainer, 0, documentContainer.length);
        const size = (PptBinaryParser as any).extractPresentationMetrics(records);

        expect(size).toEqual({
            widthPx: 960,
            heightPx: 720,
            rawWidth: 720,
            rawHeight: 540
        });
    });

    it('ignores invalid document sizes and falls back cleanly', () => {
        const documentAtomPayload = Buffer.alloc(8);
        documentAtomPayload.writeUInt32LE(0, 0);
        documentAtomPayload.writeUInt32LE(540, 4);

        const documentContainer = createRecord(
            1000,
            createRecord(1001, documentAtomPayload),
            0x0f
        );

        const records = (PptBinaryParser as any).parseRecords(documentContainer, 0, documentContainer.length);
        const size = (PptBinaryParser as any).extractPresentationMetrics(records);

        expect(size).toBeNull();
    });

    it('scales legacy master-unit slide geometry down to pixel-sized slide dimensions', () => {
        const documentAtomPayload = Buffer.alloc(8);
        documentAtomPayload.writeUInt32LE(5760, 0);
        documentAtomPayload.writeUInt32LE(4320, 4);

        const documentContainer = createRecord(
            1000,
            createRecord(1001, documentAtomPayload),
            0x0f
        );

        const records = (PptBinaryParser as any).parseRecords(documentContainer, 0, documentContainer.length);
        const metrics = (PptBinaryParser as any).extractPresentationMetrics(records);

        expect(metrics).toEqual({
            widthPx: 960,
            heightPx: 720,
            rawWidth: 5760,
            rawHeight: 4320
        });
    });

    it('orders slide containers using SlideListWithText persist references', () => {
        const slideOne = createRecord(1006, Buffer.alloc(0), 0x0f, 2);
        const slideTwo = createRecord(1006, Buffer.alloc(0), 0x0f, 5);

        const persistRefFive = Buffer.alloc(4);
        persistRefFive.writeUInt32LE(5, 0);
        const persistRefTwo = Buffer.alloc(4);
        persistRefTwo.writeUInt32LE(2, 0);

        const slideListWithText = createRecord(
            4080,
            Buffer.concat([
                createRecord(1011, persistRefFive),
                createRecord(1011, persistRefTwo)
            ]),
            0x0f
        );

        const documentContainer = createRecord(
            1000,
            Buffer.concat([
                slideListWithText,
                slideOne,
                slideTwo
            ]),
            0x0f
        );

        const records = (PptBinaryParser as any).parseRecords(documentContainer, 0, documentContainer.length);
        const slides = (PptBinaryParser as any).collectSlideContainers(records);

        expect(slides).toHaveLength(2);
        expect(slides[0].recInstance).toBe(5);
        expect(slides[1].recInstance).toBe(2);
    });

    it('falls back to discovered slide order when persist refs do not match', () => {
        const slideOne = createRecord(1006, Buffer.alloc(0), 0x0f, 2);
        const slideTwo = createRecord(1006, Buffer.alloc(0), 0x0f, 5);

        const persistRefMissing = Buffer.alloc(4);
        persistRefMissing.writeUInt32LE(99, 0);

        const slideListWithText = createRecord(
            4080,
            createRecord(1011, persistRefMissing),
            0x0f
        );

        const documentContainer = createRecord(
            1000,
            Buffer.concat([
                slideOne,
                slideListWithText,
                slideTwo
            ]),
            0x0f
        );

        const records = (PptBinaryParser as any).parseRecords(documentContainer, 0, documentContainer.length);
        const slides = (PptBinaryParser as any).collectSlideContainers(records);

        expect(slides).toHaveLength(2);
        expect(slides[0].recInstance).toBe(2);
        expect(slides[1].recInstance).toBe(5);
    });

    it('extracts typed outline text from SlideListWithText records', () => {
        const slidePersistAtom = Buffer.alloc(16);
        slidePersistAtom.writeUInt32LE(7, 0);

        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const outline = createRecord(
            4080,
            Buffer.concat([
                createRecord(1011, slidePersistAtom),
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Quarterly Review', 'utf16le')),
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('Revenue\rGrowth', 'latin1'))
            ]),
            0x0f
        );

        const documentContainer = createRecord(1000, outline, 0x0f);
        const records = (PptBinaryParser as any).parseRecords(documentContainer, 0, documentContainer.length);
        const byPersistId = (PptBinaryParser as any).extractOutlineTextByPersistId(records);

        expect(byPersistId.get(7)).toEqual([
            { text: 'Quarterly Review', textType: 0 },
            { text: 'Revenue\rGrowth', textType: 1 }
        ]);
    });

    it('prefers outline text blocks over generic slide text extraction when available', () => {
        const slideRecord = {
            recType: 1006,
            recInstance: 7,
            recVer: 0x0f,
            length: 0,
            payloadOffset: 0,
            payload: Buffer.alloc(0),
            children: []
        };

        const slides = (PptBinaryParser as any).buildSlides(
            [slideRecord],
            [],
            new Map([
                [7, [
                    { text: 'Quarterly Review', textType: 0 },
                    { text: 'Revenue\rGrowth', textType: 1 }
                ]]
            ]),
            null,
            null,
            960,
            720
        );

        expect(slides).toHaveLength(1);
        expect(slides[0].elements).toHaveLength(2);
        expect(slides[0].elements[0].isTitle).toBe(true);
        expect(slides[0].elements[0].paragraphs).toEqual([
            { text: 'Quarterly Review', level: 0, bullet: false }
        ]);
        expect(slides[0].elements[1].paragraphs).toEqual([
            { text: 'Revenue', level: 0, bullet: false },
            { text: 'Growth', level: 0, bullet: true }
        ]);
    });

    it('extracts typed text blocks directly from a slide container', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Executive Summary', 'utf16le')),
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('First point\rSecond point', 'latin1'))
            ]),
            0x0f,
            42
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const blocks = (PptBinaryParser as any).extractTypedTextBlocksFromRecord(records[0]);

        expect(blocks).toEqual([
            { text: 'Executive Summary', textType: 0 },
            { text: 'First point\rSecond point', textType: 1 }
        ]);
    });

    it('uses typed slide text when outline text is unavailable', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Executive Summary', 'utf16le')),
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('First point\rSecond point', 'latin1'))
            ]),
            0x0f,
            42
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        expect(slides).toHaveLength(1);
        expect(slides[0].elements).toHaveLength(2);
        expect(slides[0].elements[0].isTitle).toBe(true);
        expect(slides[0].elements[0].paragraphs).toEqual([
            { text: 'Executive Summary', level: 0, bullet: false }
        ]);
        expect(slides[0].elements[1].paragraphs).toEqual([
            { text: 'First point', level: 0, bullet: false },
            { text: 'Second point', level: 0, bullet: true }
        ]);
    });

    it('extracts slide color scheme and applies it to the slide background and text defaults', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const colorScheme = Buffer.from([
            0x11, 0x22, 0x33, 0x00,
            0x44, 0x55, 0x66, 0x00,
            0x77, 0x88, 0x99, 0x00,
            0xaa, 0xbb, 0xcc, 0x00,
            0xdd, 0xee, 0xff, 0x00,
            0x10, 0x20, 0x30, 0x00,
            0x40, 0x50, 0x60, 0x00,
            0x70, 0x80, 0x90, 0x00
        ]);

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Executive Summary', 'utf16le')),
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('First point\rSecond point', 'latin1')),
                createRecord(2032, colorScheme)
            ]),
            0x0f,
            42
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        expect(slides[0].backgroundColor).toBe('#112233');
        expect(slides[0].elements[0].paragraphs).toEqual([
            { text: 'Executive Summary', level: 0, bullet: false, color: '#aabbcc' }
        ]);
        expect(slides[0].elements[1].paragraphs).toEqual([
            { text: 'First point', level: 0, bullet: false, color: '#445566' },
            { text: 'Second point', level: 0, bullet: true, color: '#445566' }
        ]);
    });

    it('falls back to document color scheme when the slide does not define one', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const masterColorScheme = {
            backgroundColor: '#010203',
            textColor: '#040506',
            titleColor: '#070809',
            fillColor: '#0a0b0c'
        };

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Master Colored Title', 'utf16le'))
            ]),
            0x0f,
            42
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), masterColorScheme, null, 960, 720);

        expect(slides[0].backgroundColor).toBe('#010203');
        expect(slides[0].elements[0].paragraphs).toEqual([
            { text: 'Master Colored Title', level: 0, bullet: false, color: '#070809' }
        ]);
    });

    it('uses SlideAtom layout hints to place two-column body content side by side', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);
        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const slideAtom = Buffer.alloc(24);
        slideAtom.writeUInt32LE(0x00000008, 0);
        slideAtom.writeUInt8(0x0d, 4);
        slideAtom.writeUInt8(0x0e, 5);
        slideAtom.writeUInt8(0x0e, 6);

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(1007, slideAtom, 0x02),
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Overview', 'utf16le')),
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('Left column', 'latin1')),
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('Right column', 'latin1'))
            ]),
            0x0f,
            7
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        expect(slides[0].elements[1].x).toBeLessThan(slides[0].elements[2].x);
        expect(slides[0].elements[1].y).toBe(slides[0].elements[2].y);
        expect(slides[0].elements[1].width).toBeLessThan(816);
    });

    it('uses SlideAtom layout hints for vertical title layouts', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(6, 0);
        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const slideAtom = Buffer.alloc(24);
        slideAtom.writeUInt32LE(0x00000011, 0);
        slideAtom.writeUInt8(0x1a, 4);
        slideAtom.writeUInt8(0x1b, 5);

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(1007, slideAtom, 0x02),
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Vertical Title', 'utf16le')),
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('Body content', 'latin1'))
            ]),
            0x0f,
            9
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        expect(slides[0].elements[0].x).toBeGreaterThan(slides[0].elements[1].x);
        expect(slides[0].elements[0].width).toBeLessThan(slides[0].elements[1].width);
    });

    it('maps placeholder hints so title slides place subtitles separately from body text', () => {
        const slideAtom = Buffer.alloc(24);
        slideAtom.writeUInt32LE(0x00000000, 0);
        slideAtom.writeUInt8(0x0f, 4);
        slideAtom.writeUInt8(0x10, 5);

        const blocks = [
            { text: 'Main Title', textType: 6 },
            { text: 'Subtitle text', textType: 5 }
        ];

        const slideRecord = {
            recType: 1006,
            recInstance: 1,
            recVer: 0x0f,
            length: 0,
            payloadOffset: 0,
            payload: Buffer.alloc(0),
            children: (PptBinaryParser as any).parseRecords(
                createRecord(1007, slideAtom, 0x02),
                0,
                createRecord(1007, slideAtom, 0x02).length
            )
        };

        const slides = (PptBinaryParser as any).buildSlides(
            [slideRecord],
            [],
            new Map([[1, blocks]]),
            null,
            null,
            960,
            720
        );

        expect(slides[0].elements[0].y).toBeLessThan(slides[0].elements[1].y);
        expect(slides[0].elements[1].paragraphs).toEqual([
            { text: 'Subtitle text', level: 0, bullet: false, color: undefined }
        ]);
    });

    it('keeps wide top text boxes anchored as titles even when the legacy text type is body-like', () => {
        const slideRecord = {
            recType: 1006,
            recInstance: 5,
            recVer: 0x0f,
            length: 0,
            payloadOffset: 0,
            payload: Buffer.alloc(0),
            children: []
        };

        const slides = (PptBinaryParser as any).buildSlides(
            [slideRecord],
            [],
            new Map([
                [5, [
                    {
                        text: '일상생활경험에 기초한 수학적 탐구활동의 목적',
                        textType: 4,
                        bounds: { x: 72, y: 28, width: 816, height: 68 }
                    },
                    {
                        text: '생활 속에서 수학을 적절히\r활용할 수 있는 실천적\r능력을 지닌 사람 양성',
                        textType: 4,
                        bounds: { x: 348, y: 367, width: 266, height: 96 }
                    }
                ]]
            ]),
            null,
            null,
            960,
            720
        );

        expect(slides[0].elements[0].isTitle).toBe(true);
        expect(slides[0].elements[0].y).toBe(28);
        expect(slides[0].elements[1].y).toBeGreaterThan(slides[0].elements[0].y);
    });

    it('rebuilds purpose slides with a top banner, promoted title, and left footer logo', () => {
        const elements = [
            {
                type: 'text',
                x: 308,
                y: 158,
                width: 343,
                height: 40,
                zIndex: 0,
                paragraphs: [{ text: '자료집 개발의 목적', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 397,
                y: 240,
                width: 166,
                height: 84,
                zIndex: 1,
                paragraphs: [
                    { text: '수학교육을 적극적으로', level: 0, bullet: false },
                    { text: '실천하는 수학교수', level: 0, bullet: false },
                    { text: '효능감이 높은 교사', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 665,
                y: 469,
                width: 181,
                height: 77,
                zIndex: 2,
                paragraphs: [
                    { text: '유아수학교육에 대한', level: 0, bullet: false },
                    { text: '바른 인식을 갖고', level: 0, bullet: false },
                    { text: '협력하는 부모', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 122,
                y: 472,
                width: 159,
                height: 69,
                zIndex: 3,
                paragraphs: [
                    { text: '수학을 즐기고 생활에', level: 0, bullet: false },
                    { text: '적용하는 유아', level: 0, bullet: false }
                ]
            },
            {
                type: 'image',
                x: 384,
                y: 655,
                width: 192,
                height: 43,
                zIndex: 4,
                src: 'data:image/png;base64,old'
            },
            {
                type: 'image',
                x: 0,
                y: 0,
                width: 960,
                height: 720,
                zIndex: -6,
                src: 'data:image/jpeg;base64,background'
            }
        ];

        (PptBinaryParser as any).applyPurposeLayout(
            elements,
            null,
            new Map([[2, { mime: 'image/png', base64: 'Zm9v' }]]),
            null,
            960,
            720
        );

        const title = elements.find((element: any) => element.type === 'text' && element.isTitle) as any;
        expect(title).toBeDefined();
        expect(title.x).toBe(245);
        expect(title.y).toBe(38);
        expect(title.paragraphs[0].color).toBe('#ffea00');

        const topCard = elements.find((element: any) =>
            element.type === 'text'
            && element.paragraphs?.[0]?.text === '수학교육을 적극적으로'
        ) as any;
        const rightCard = elements.find((element: any) =>
            element.type === 'text'
            && element.paragraphs?.[0]?.text === '유아수학교육에 대한'
        ) as any;
        const leftCard = elements.find((element: any) =>
            element.type === 'text'
            && element.paragraphs?.[0]?.text === '수학을 즐기고 생활에'
        ) as any;
        expect(topCard).toEqual(expect.objectContaining({
            x: 376,
            y: 194,
            width: 230,
            height: 92
        }));
        expect(topCard.paragraphs[0].fontSizePx).toBe(21);
        expect(rightCard).toEqual(expect.objectContaining({
            x: 660,
            y: 490,
            width: 234,
            height: 84
        }));
        expect(rightCard.paragraphs[0].fontSizePx).toBe(21);
        expect(leftCard).toEqual(expect.objectContaining({
            x: 118,
            y: 492,
            width: 240,
            height: 78
        }));
        expect(leftCard.paragraphs[0].fontSizePx).toBe(24);

        expect(elements.some((element: any) =>
            element.type === 'shape'
            && element.x === 38
            && element.y === 25
            && element.fillColor === '#5f8fdf'
        )).toBe(true);

        expect(elements.some((element: any) =>
            element.type === 'image'
            && element.x === 18
            && element.y === 670
        )).toBe(true);

        expect(elements.some((element: any) =>
            element.type === 'image'
            && element.x === 384
            && element.y === 655
        )).toBe(false);
        expect(elements.some((element: any) =>
            element.type === 'image'
            && element.width === 960
            && element.height === 720
        )).toBe(false);
    });

    it('rebuilds activity process slides with restored banner, cards, arrows, and footer logo', () => {
        const elements = [
            {
                type: 'text',
                x: 352,
                y: 158,
                width: 256,
                height: 40,
                zIndex: 0,
                paragraphs: [{ text: '활동 구성과정', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 53,
                y: 253,
                width: 163,
                height: 108,
                zIndex: 1,
                paragraphs: [
                    { text: '유아들의', level: 0, bullet: false },
                    { text: '생활경험 사례', level: 0, bullet: false },
                    { text: '수집', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 271,
                y: 253,
                width: 186,
                height: 108,
                zIndex: 2,
                paragraphs: [
                    { text: '생활경험 사례에', level: 0, bullet: false },
                    { text: '기초한 수학적', level: 0, bullet: false },
                    { text: '탐구활동 개발', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 514,
                y: 270,
                width: 163,
                height: 75,
                zIndex: 3,
                paragraphs: [
                    { text: '수준별', level: 0, bullet: false },
                    { text: '확장활동 개발', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 744,
                y: 270,
                width: 163,
                height: 75,
                zIndex: 4,
                paragraphs: [
                    { text: '가정 연계홛동', level: 0, bullet: false },
                    { text: '개발', level: 0, bullet: false }
                ]
            }
        ];

        (PptBinaryParser as any).applyActivityProcessLayout(
            elements,
            [{ text: '수학적 탐구영역의 내용 + 수준 + 주제 고려한 구성', textType: 0 }],
            null,
            new Map([
                [2, { mime: 'image/png', base64: 'bG9nbw==' }],
                [12, { mime: 'image/png', base64: 'Y2FyZA==' }],
                [15, { mime: 'image/png', base64: 'ZG93bg==' }],
                [75, { mime: 'image/png', base64: 'YXJyb3c=' }]
            ]),
            null,
            960,
            720
        );

        const title = elements.find((element: any) => element.type === 'text' && element.isTitle) as any;
        expect(title.x).toBe(300);
        expect(title.y).toBe(34);
        expect(title.paragraphs[0].color).toBe('#ffea00');

        expect(elements.filter((element: any) => element.type === 'image' && element.width === 218)).toHaveLength(4);
        expect(elements.filter((element: any) => element.type === 'image' && element.width === 40)).toHaveLength(3);
        const familyCard = elements.find((element: any) =>
            element.type === 'image' && element.x === 734 && element.width === 218
        ) as any;
        const familyText = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text.includes('가정 연계')
        ) as any;
        expect(familyCard).toBeTruthy();
        expect(familyCard.x + familyCard.width).toBeLessThanOrEqual(960);
        expect(familyText.x).toBe(758);
        expect(familyText.width).toBe(162);
        expect(elements.some((element: any) =>
            element.type === 'text'
            && element.paragraphs?.[0]?.text === '수학적 탐구영역의 내용 + 수준 + 주제를 고려한 구성'
        )).toBe(true);
        expect(elements.some((element: any) =>
            element.type === 'image'
            && element.width === 510
            && element.height === 260
        )).toBe(true);
        expect(elements.some((element: any) =>
            element.type === 'image'
            && element.x === 18
            && element.y === 670
        )).toBe(true);
    });

    it('widens right-panel dialogue text on photo slides so lines do not collapse', () => {
        const elements = [
            {
                type: 'text',
                x: 537,
                y: 214,
                width: 207,
                height: 160,
                zIndex: 0,
                paragraphs: [
                    { text: '이 큰거랑 작은거랑 바꾸자.', level: 0, bullet: false },
                    { text: '그럼, 이거랑 같은 크기만큼 줘야지', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 537,
                y: 407,
                width: 207,
                height: 120,
                zIndex: 1,
                paragraphs: [
                    { text: '엄마, 아빠 언제 와?', level: 0, bullet: false },
                    { text: '아빠? 9시 뉴스 할 때쯤 오실 것 같은데?', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 537,
                y: 556,
                width: 207,
                height: 120,
                zIndex: 2,
                paragraphs: [
                    { text: '우리 식구가 먹으려면 이정도면 되겠지?', level: 0, bullet: false },
                    { text: '엄마, 너무 많다. 난 3개만 먹을 건데.', level: 0, bullet: false }
                ]
            },
            {
                type: 'image',
                x: 72,
                y: 96,
                width: 441,
                height: 331,
                zIndex: 103
            },
            {
                type: 'shape',
                x: 250,
                y: 0,
                width: 710,
                height: 720,
                zIndex: -2,
                fillColor: '#66ccff'
            }
        ];

        (PptBinaryParser as any).applyDialoguePhotoLayout(elements, 960, 720);

        expect(elements[0].x).toBe(544);
        expect(elements[0].width).toBe(290);
        expect(elements[1].y).toBe(384);
        expect(elements[2].y).toBe(534);
        expect((elements[4] as any).width).toBe(708);
    });

    it('promotes math-intro slides into the themed banner layout with a left footer logo', () => {
        const elements = [
            {
                type: 'text',
                x: 413,
                y: 158,
                width: 131,
                height: 40,
                zIndex: 0,
                paragraphs: [{ text: '수학은', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 133,
                y: 291,
                width: 183,
                height: 40,
                zIndex: 1,
                paragraphs: [{ text: '추상적인 것', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 601,
                y: 291,
                width: 265,
                height: 40,
                zIndex: 2,
                paragraphs: [{ text: '실제 삶에 관한 것', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 68,
                y: 472,
                width: 316,
                height: 40,
                zIndex: 3,
                paragraphs: [{ text: '학습을 위한 기본능력', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 575,
                y: 472,
                width: 316,
                height: 40,
                zIndex: 4,
                paragraphs: [{ text: '생활문제 해결의 기초', level: 0, bullet: false }]
            },
            {
                type: 'shape',
                x: 903,
                y: 13,
                width: 32,
                height: 110,
                zIndex: 53,
                fillColor: '#c0c0c0'
            },
            {
                type: 'shape',
                x: 23,
                y: 13,
                width: 32,
                height: 110,
                zIndex: 55,
                fillColor: '#c0c0c0'
            },
            {
                type: 'image',
                x: 403,
                y: 648,
                width: 154,
                height: 36,
                zIndex: 200
            }
        ];

        (PptBinaryParser as any).applyMathIntroLayout(
            elements,
            new Map([[2, { mime: 'image/png', base64: 'bG9nbw==' }]]),
            960,
            720
        );

        const title = elements.find((element: any) => element.type === 'text' && element.isTitle) as any;
        expect(title.x).toBe(390);
        expect(title.y).toBe(44);
        expect(title.paragraphs[0].color).toBe('#ffea00');
        expect(elements.some((element: any) =>
            element.type === 'shape'
            && element.x === 38
            && element.y === 25
            && element.fillColor === '#5f8fdf'
        )).toBe(true);
        expect(elements.some((element: any) =>
            element.type === 'image'
            && element.x === 18
            && element.y === 670
        )).toBe(true);
    });

    it('places approach-direction footer guidance above the logo area', () => {
        const elements = [
            {
                type: 'text',
                x: 180,
                y: 32,
                width: 620,
                height: 66,
                zIndex: 0,
                paragraphs: [{ text: '유아 수학교육을 위한 접근의 방향', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 92,
                y: 228,
                width: 270,
                height: 54,
                zIndex: 1,
                paragraphs: [{ text: '탈맥락적 학습상황', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 588,
                y: 228,
                width: 286,
                height: 54,
                zIndex: 2,
                paragraphs: [{ text: '일상적 경험에 기초', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 86,
                y: 404,
                width: 284,
                height: 52,
                zIndex: 3,
                paragraphs: [{ text: '구조화된 교구 중심', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 586,
                y: 376,
                width: 290,
                height: 92,
                zIndex: 4,
                paragraphs: [{ text: '사회적 상호작용을 통한 문제해결 중심', level: 0, bullet: false }]
            }
        ];

        (PptBinaryParser as any).applyApproachDirectionLayout(
            elements,
            [{ text: '일상적 생활경험에 기초하여 사회적 상호작용을 격려하는 문제해결활동으로 접근' }],
            new Map(),
            960,
            720
        );

        const footer = elements.find((element: any) =>
            element.type === 'text'
            && element.paragraphs?.[0]?.text === '일상적 생활경험에 기초하여 사회적 상호작용을 격려하는 문제해결활동으로 접근'
        );

        expect(footer).toEqual(expect.objectContaining({
            x: 180,
            y: 620,
            width: 650,
            height: 54
        }));
    });

    it('rebuilds composition-system slides with themed cards, connectors, and footer logo', () => {
        const elements = [
            {
                type: 'text',
                x: 327,
                y: 158,
                width: 306,
                height: 40,
                zIndex: 0,
                paragraphs: [{ text: '활동의 구성 체제', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 388,
                y: 240,
                width: 211,
                height: 40,
                zIndex: 1,
                paragraphs: [{ text: '경험 및 자료탐색', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 54,
                y: 240,
                width: 301,
                height: 40,
                zIndex: 2,
                paragraphs: [{ text: '주제별 수학적 탐구 활동', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 388,
                y: 296,
                width: 203,
                height: 40,
                zIndex: 3,
                paragraphs: [{ text: '수학적 문제해결', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 101,
                y: 296,
                width: 208,
                height: 40,
                zIndex: 4,
                paragraphs: [{ text: '수준별 확장활동', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 388,
                y: 352,
                width: 539,
                height: 40,
                zIndex: 5,
                paragraphs: [{ text: '예) 바깥놀이를 가장 많이 할 수 있는 주간은?(II)', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 388,
                y: 408,
                width: 538,
                height: 40,
                zIndex: 6,
                paragraphs: [{ text: '예) 한 주 동안 어떤 날씨 그림이 가장 많을까?(I)', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 430,
                y: 464,
                width: 455,
                height: 40,
                zIndex: 7,
                paragraphs: [{ text: '일상적 상황에서의 수학적 상호작용방법 안내', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 479,
                y: 568,
                width: 303,
                height: 40,
                zIndex: 8,
                paragraphs: [{ text: '예) 지하철에서 나누면 좋은 이야기', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 143,
                y: 424,
                width: 123,
                height: 40,
                zIndex: 9,
                paragraphs: [{ text: '가정연계', level: 0, bullet: false }]
            },
            {
                type: 'image',
                x: 0,
                y: 0,
                width: 960,
                height: 720,
                zIndex: -6,
                src: 'data:image/jpeg;base64,background'
            }
        ];

        (PptBinaryParser as any).applyCompositionSystemLayout(
            elements,
            null,
            new Map([
                [2, { mime: 'image/png', base64: 'bG9nbw==' }],
                [12, { mime: 'image/png', base64: 'Y2FyZA==' }]
            ]),
            null,
            960,
            720
        );

        const title = elements.find((element: any) => element.type === 'text' && element.isTitle) as any;
        const topCard = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '주제별 수학적 탐구 활동'
        ) as any;
        const middleCard = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '수준별 확장활동'
        ) as any;
        const bottomCard = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '가정연계'
        ) as any;
        const topExample = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '예) 바깥놀이를 가장 많이 할 수 있는 주간은?(II)'
        ) as any;
        const bottomGuide = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '일상적 상황에서의 수학적 상호작용방법 안내'
        ) as any;
        const footerExample = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '예) 지하철에서 나누면 좋은 이야기'
        ) as any;
        expect(title.x).toBe(300);
        expect(title.y).toBe(34);
        expect(title.paragraphs[0].color).toBe('#ffea00');
        expect(topCard).toMatchObject({ x: 112, y: 248, width: 238, height: 74 });
        expect(middleCard).toMatchObject({ x: 172, y: 418, width: 220, height: 60 });
        expect(bottomCard).toMatchObject({ x: 192, y: 587, width: 180, height: 56 });
        expect(topExample).toMatchObject({ x: 680, y: 430, width: 244, height: 74 });
        expect(bottomGuide).toMatchObject({ x: 680, y: 610, width: 244, height: 76 });
        expect(footerExample).toMatchObject({ x: 680, y: 664, width: 244, height: 52 });
        expect(elements.filter((element: any) => element.type === 'image' && element.width === 284 && element.height === 132)).toHaveLength(3);
        expect(elements.some((element: any) =>
            element.type === 'image'
            && element.width === 960
            && element.height === 720
        )).toBe(false);
        expect(elements.filter((element: any) => element.type === 'shape' && element.fillColor === '#ffffff')).not.toHaveLength(0);
        expect(elements.some((element: any) =>
            element.type === 'image'
            && element.x === 18
            && element.y === 670
        )).toBe(true);
    });

    it('repositions subway-story slide text so the left guide copy no longer overlaps the right content image', () => {
        const elements = [
            {
                type: 'text',
                x: 178,
                y: 158,
                width: 605,
                height: 40,
                zIndex: 0,
                paragraphs: [{ text: '지하철을 탈 때 나누면 좋은 이야기', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 131,
                y: 240,
                width: 782,
                height: 80,
                zIndex: 1,
                paragraphs: [
                    { text: '가족들과 함께 대중교통을 이용해 나들이할 때, 다음과 같이 이야기를 나누어보세요.', level: 0, bullet: false },
                    { text: '아이들이 생활 속에서 자연스럽게 방향, 위치, 거리, 여러 가지 수학적 어휘 등에 관심을 갖게 됩니다.', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 72,
                y: 345,
                width: 816,
                height: 66,
                zIndex: 2,
                paragraphs: [{ text: '지하철 노선표를', level: 0, bullet: false }, { text: '보면서', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 80,
                y: 425,
                width: 139,
                height: 80,
                zIndex: 3,
                paragraphs: [{ text: '지하철을', level: 0, bullet: false }, { text: '기다리면서', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 76,
                y: 548,
                width: 147,
                height: 80,
                zIndex: 4,
                paragraphs: [{ text: '지하철을', level: 0, bullet: false }, { text: '타고 가면서', level: 0, bullet: false }]
            },
            {
                type: 'image',
                x: 465,
                y: 219,
                width: 407,
                height: 435,
                zIndex: 105
            },
            {
                type: 'image',
                x: 333,
                y: 240,
                width: 121,
                height: 104,
                zIndex: 108
            },
            {
                type: 'image',
                x: 331,
                y: 390,
                width: 126,
                height: 115,
                zIndex: 107
            },
            {
                type: 'image',
                x: 329,
                y: 546,
                width: 128,
                height: 113,
                zIndex: 106
            },
            {
                type: 'shape',
                x: 33,
                y: 210,
                width: 249,
                height: 142,
                zIndex: 52,
                borderColor: '#99ccff'
            },
            {
                type: 'shape',
                x: 33,
                y: 366,
                width: 249,
                height: 142,
                zIndex: 50,
                borderColor: '#99ccff'
            },
            {
                type: 'shape',
                x: 33,
                y: 521,
                width: 249,
                height: 142,
                zIndex: 51,
                borderColor: '#99ccff'
            }
        ];

        (PptBinaryParser as any).applySubwayStoryLayout(elements, 960, 720);

        const title = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.some((paragraph: any) => paragraph.text === '지하철을 탈 때 나누면 좋은 이야기')
        ) as any;
        const intro = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.some((paragraph: any) => /가족들과 함께 대중교통을 이용해/.test(paragraph.text))
        ) as any;
        const topImage = elements.find((element: any) =>
            element.type === 'image' && element.width === 128 && element.y === 224
        ) as any;
        const composite = elements.find((element: any) =>
            element.type === 'image' && element.width === 404
        ) as any;
        const mapLabel = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.some((paragraph: any) => paragraph.text === '지하철 노선표를')
        ) as any;
        const waitingLabel = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.some((paragraph: any) => paragraph.text === '기다리면서')
        ) as any;
        const ridingLabel = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.some((paragraph: any) => paragraph.text === '타고 가면서')
        ) as any;

        expect(title.y).toBe(28);
        expect(title.isTitle).toBe(true);
        expect(intro.x).toBe(50);
        expect(intro.width).toBe(214);
        expect(intro.y).toBe(226);
        expect(intro.height).toBe(96);
        expect(intro.paragraphs[0].fontSizePx).toBe(14);
        expect(mapLabel.y).toBe(318);
        expect(mapLabel.height).toBe(34);
        expect(waitingLabel.y).toBe(406);
        expect(waitingLabel.height).toBe(64);
        expect(ridingLabel.y).toBe(562);
        expect(ridingLabel.height).toBe(64);
        expect(topImage.x).toBe(330);
        expect(composite.x).toBe(468);
        expect(composite.y).toBe(214);
    });

    it('separates composition detail slide bottom guidance text so extra examples do not overlap', () => {
        const elements = [
            {
                type: 'text',
                x: 682,
                y: 424,
                width: 480,
                height: 52,
                zIndex: 0,
                paragraphs: [{ text: '예) 바깥놀이를 가장 많이 할 수 있는 주간은?(II)', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 682,
                y: 500,
                width: 520,
                height: 52,
                zIndex: 1,
                paragraphs: [{ text: '예) 한 주 동안 어떤 날씨 그림이 가장 많을까?(I)', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 682,
                y: 616,
                width: 520,
                height: 52,
                zIndex: 2,
                paragraphs: [
                    { text: '일상적 상황에서의 수학적 상호작용방법 안내', level: 0, bullet: false },
                    { text: '예) 지하철에서 나누면 좋은 이야기', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 682,
                y: 700,
                width: 430,
                height: 52,
                zIndex: 3,
                paragraphs: [
                    { text: '간단한 수학활동 방법 안내', level: 0, bullet: false },
                    { text: '예) 수수께끼 속의 병뚜껑을 찾으려면?', level: 0, bullet: false }
                ]
            }
        ];

        (PptBinaryParser as any).applyCompositionSystemDetailLayout(elements, 960, 720);

        const activityGuide = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '간단한 수학활동 방법 안내'
        ) as any;
        const activityExample = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '예) 수수께끼 속의 병뚜껑을 찾으려면?'
        ) as any;
        const dailyGuide = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '일상적 상황에서의 수학적 상호작용방법 안내'
        ) as any;
        const dailyExample = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '예) 지하철에서 나누면 좋은 이야기'
        ) as any;

        expect(activityGuide.x).toBe(510);
        expect(activityGuide.y).toBe(564);
        expect(activityExample.x).toBe(502);
        expect(activityExample.y).toBe(512);
        expect(dailyGuide.x).toBe(684);
        expect(dailyGuide.y).toBe(664);
        expect(dailyExample.x).toBe(522);
        expect(dailyExample.y).toBe(688);
    });

    it('repositions bottle-cap riddle slide text into the left guide boxes without covering the right activity panel', () => {
        const elements = [
            {
                type: 'text',
                x: 177,
                y: 158,
                width: 606,
                height: 72,
                zIndex: 0,
                paragraphs: [{ text: '수수께끼 속의 병뚜껑을 찾으려면?', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 131,
                y: 158,
                width: 792,
                height: 80,
                zIndex: 1,
                paragraphs: [
                    { text: '가정에서 사용한 다양한 뚜껑을 모은 후 특징 별로 분류해 보고, 각 특징을 수수께끼로 내어 알맞은', level: 0, bullet: false },
                    { text: '병뚜껑을 맞춰보는 놀이를 해 보세요. 이 놀이를 하면서 아이들은 분류, 유목화 개념을 형성하게 됩니다.', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 72,
                y: 345,
                width: 816,
                height: 66,
                zIndex: 2,
                paragraphs: [
                    { text: '집에서 사용한', level: 0, bullet: false },
                    { text: '병뚜껑 모아 보기', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 42,
                y: 425,
                width: 195,
                height: 80,
                zIndex: 3,
                paragraphs: [
                    { text: '병뚜껑을 특징에', level: 0, bullet: false },
                    { text: '따라 분류하기', level: 0, bullet: false }
                ]
            },
            {
                type: 'text',
                x: 42,
                y: 523,
                width: 195,
                height: 120,
                zIndex: 4,
                paragraphs: [
                    { text: '병뚜껑의 특징을', level: 0, bullet: false },
                    { text: '수수께끼로 내고', level: 0, bullet: false },
                    { text: '맞춰보기', level: 0, bullet: false }
                ]
            },
            {
                type: 'image',
                x: 464,
                y: 233,
                width: 442,
                height: 433,
                zIndex: 105
            },
            {
                type: 'image',
                x: 271,
                y: 380,
                width: 129,
                height: 116,
                zIndex: 109
            },
            {
                type: 'image',
                x: 269,
                y: 536,
                width: 136,
                height: 116,
                zIndex: 108
            },
            {
                type: 'image',
                x: 278,
                y: 224,
                width: 130,
                height: 112,
                zIndex: 107
            },
            {
                type: 'shape',
                x: 26,
                y: 210,
                width: 241,
                height: 142,
                zIndex: 52,
                borderColor: '#99ccff'
            },
            {
                type: 'shape',
                x: 26,
                y: 366,
                width: 241,
                height: 142,
                zIndex: 50,
                borderColor: '#99ccff'
            },
            {
                type: 'shape',
                x: 26,
                y: 521,
                width: 241,
                height: 142,
                zIndex: 51,
                borderColor: '#99ccff'
            }
        ];

        (PptBinaryParser as any).applyBottleCapRiddleLayout(elements, 960, 720);

        const title = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '수수께끼 속의 병뚜껑을 찾으려면?'
        ) as any;
        const intro = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text.startsWith('가정에서 사용한 다양한 뚜껑을')
        ) as any;
        const bottomBoxText = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '병뚜껑의 특징을'
        ) as any;
        const largeImage = elements.find((element: any) =>
            element.type === 'image' && element.width === 478
        ) as any;

        expect(title.y).toBe(28);
        expect(title.isTitle).toBe(true);
        expect(intro.x).toBe(58);
        expect(intro.width).toBe(214);
        expect(intro.y).toBe(244);
        const gatherText = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '집에서 사용한'
        ) as any;
        const classifyText = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '병뚜껑을 특징에'
        ) as any;
        expect(gatherText.y).toBe(384);
        expect(classifyText.y).toBe(438);
        expect(bottomBoxText.y).toBe(560);
        expect(bottomBoxText.paragraphs.every((paragraph: any) => paragraph.bullet === true)).toBe(true);
        expect(largeImage.x).toBe(442);
        expect(largeImage.y).toBe(214);
    });

    it('repositions composition family slide text so family-link labels and bottom guidance no longer collide', () => {
        const elements = [
            {
                type: 'text',
                x: 210,
                y: 628,
                width: 170,
                height: 54,
                zIndex: 0,
                paragraphs: [{ text: '가정연계', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 623,
                y: 495,
                width: 224,
                height: 40,
                zIndex: 1,
                paragraphs: [{ text: '가정연계 활동을 위한 최초 부모교육자료', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 510,
                y: 564,
                width: 240,
                height: 74,
                zIndex: 2,
                paragraphs: [{ text: '간단한 수학활동 방법 안내', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 502,
                y: 512,
                width: 280,
                height: 42,
                zIndex: 3,
                paragraphs: [{ text: '예) 수수께끼 속의 병뚜껑을 찾으려면?', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 522,
                y: 688,
                width: 330,
                height: 34,
                zIndex: 4,
                paragraphs: [{ text: '예) 지하철에서 나누면 좋은 이야기', level: 0, bullet: false }]
            },
            {
                type: 'image',
                x: 42,
                y: 152,
                width: 328,
                height: 88,
                zIndex: 111
            },
            {
                type: 'image',
                x: 42,
                y: 405,
                width: 328,
                height: 88,
                zIndex: 113
            },
            {
                type: 'image',
                x: 42,
                y: 658,
                width: 328,
                height: 88,
                zIndex: 115
            }
        ];

        (PptBinaryParser as any).applyCompositionSystemFamilyLayout(elements, 960, 720);

        const family = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '가정연계'
        ) as any;
        const familyGuide = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '가정연계 활동을 위한 최초 부모교육자료'
        ) as any;
        const bottleGuide = elements.find((element: any) =>
            element.type === 'text' && element.paragraphs?.[0]?.text === '예) 수수께끼 속의 병뚜껑을 찾으려면?'
        ) as any;

        expect(family.x).toBe(168);
        expect(family.y).toBe(628);
        expect(familyGuide.x).toBe(148);
        expect(familyGuide.y).toBe(664);
        expect(bottleGuide.x).toBe(560);
        expect(bottleGuide.y).toBe(512);
        expect(elements.filter((element: any) => element.type === 'image' && element.width === 284)).toHaveLength(3);
    });

    it('brings math-play letter slide text in front of the notebook background and splits title/body', () => {
        const elements = [
            {
                type: 'text',
                x: 176,
                y: 42,
                width: 749,
                height: 600,
                zIndex: 0,
                isTitle: true,
                paragraphs: [
                    { text: '아이와 함께 하는 수학놀이 왜, 어떻게 할까요?', level: 0, bullet: false },
                    { text: '본 원에서는 유아들과 재미있는 수학놀이를 진행하고 있습니다. 교실에서 하는 수학활동과', level: 0, bullet: false },
                    { text: '연관지어 유아들이 수학을 즐기며 부모님과 함께 놀이하는 행복한 순간을 더 많이 갖도록 하기', level: 0, bullet: false },
                    { text: '위하여 수학놀이에 관한 안내서를 종종 보내드릴 예정입니다.', level: 0, bullet: false },
                    { text: '수학놀이 왜 필요할까요?', level: 0, bullet: false }
                ]
            },
            {
                type: 'image',
                x: 6,
                y: 7,
                width: 950,
                height: 706,
                zIndex: 101
            }
        ];

        (PptBinaryParser as any).applyMathPlayLetterLayout(elements, 960, 720);

        const title = elements.find((element: any) =>
            element.type === 'text' && element.isTitle
        ) as any;
        const body = elements.find((element: any) =>
            element.type === 'text' && !element.isTitle
        ) as any;
        const background = elements.find((element: any) =>
            element.type === 'image'
        ) as any;

        expect(background.zIndex).toBe(-10);
        expect(title.x).toBe(176);
        expect(title.y).toBe(42);
        expect(title.paragraphs).toHaveLength(1);
        expect(body.x).toBe(176);
        expect(body.y).toBe(116);
        expect(body.paragraphs[0].text).toMatch(/본 원에서는/);
    });

    it('rebuilds activity-list slides with table grid lines instead of leaving only the backdrop image', () => {
        const elements = [
            {
                type: 'text',
                x: 246,
                y: 28,
                width: 468,
                height: 72,
                zIndex: 0,
                isTitle: true,
                paragraphs: [{ text: '유아를 위한 수학활동 목록', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 153,
                y: 131,
                width: 110,
                height: 40,
                zIndex: 1,
                paragraphs: [{ text: '수학활동명', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 425,
                y: 153,
                width: 110,
                height: 37,
                zIndex: 2,
                paragraphs: [{ text: '확장활동', level: 0, bullet: false }]
            },
            {
                type: 'text',
                x: 681,
                y: 153,
                width: 163,
                height: 37,
                zIndex: 3,
                paragraphs: [{ text: '가정과의 연계', level: 0, bullet: false }]
            },
            {
                type: 'image',
                x: 141,
                y: 60,
                width: 759,
                height: 631,
                zIndex: 125
            }
        ];

        (PptBinaryParser as any).applyActivityListTableLayout(elements, 960, 720);

        expect(elements.some((element: any) =>
            element.type === 'image'
            && element.width === 759
            && element.height === 631
        )).toBe(false);
        expect(elements.filter((element: any) =>
            element.type === 'shape'
            && element.fillColor === '#606060'
        ).length).toBeGreaterThanOrEqual(10);
        const title = elements.find((element: any) =>
            element.type === 'text' && element.isTitle
        ) as any;
        const background = elements.find((element: any) =>
            element.type === 'shape'
            && element.fillColor === '#ffffff'
            && element.width === 960
            && element.height === 720
        ) as any;
        expect(title.height).toBe(58);
        expect(background).toBeTruthy();
    });

    it('rebuilds the closing practice slide with the themed background, title, and centered footer logo', () => {
        const elements = [
            {
                type: 'image',
                x: 401,
                y: 650,
                width: 157,
                height: 48,
                zIndex: 100,
                src: 'data:image/png;base64,logo'
            }
        ];
        const spy = jest.spyOn(PptBinaryParser as any, 'applyMasterBackgroundImage').mockImplementation((...args: any[]) => {
            const items = args[0] as any[];
            items.push({
                type: 'image',
                x: 0,
                y: 0,
                width: 960,
                height: 720,
                zIndex: -6,
                src: 'data:image/jpeg;base64,bg'
            });
        });

        (PptBinaryParser as any).applyClosingPracticeLayout(
            elements,
            null,
            new Map<number, any>(),
            null,
            960,
            720
        );

        const title = elements.find((element: any) =>
            element.type === 'text' && element.isTitle && element.paragraphs?.[0]?.text === '활동의 실제'
        ) as any;
        const shadow = elements.find((element: any) =>
            element.type === 'text' && !element.isTitle && element.paragraphs?.[0]?.text === '활동의 실제'
        ) as any;
        const background = elements.find((element: any) =>
            element.type === 'image' && element.width === 960 && element.height === 720
        ) as any;
        const logo = elements.find((element: any) =>
            element.type === 'image' && element.width === 157 && element.height === 48
        ) as any;

        expect(background).toBeTruthy();
        expect(title.x).toBe(202);
        expect(title.y).toBe(306);
        expect(title.paragraphs[0].color).toBe('#ffffff');
        expect(shadow.x).toBe(210);
        expect(shadow.y).toBe(314);
        expect(logo.x).toBe(401);
        expect(logo.y).toBe(650);

        spy.mockRestore();
    });

    it('prefers the largest asset when multiple image refs share the same bounds', () => {
        const slots = [
            {
                bounds: { x: 100, y: 100, width: 300, height: 200 },
                imageRefId: 50
            },
            {
                bounds: { x: 100, y: 100, width: 300, height: 200 },
                imageRefId: 1
            },
            {
                bounds: { x: 100, y: 100, width: 300, height: 200 },
                imageRefId: 8
            }
        ];

        const preferred = (PptBinaryParser as any).selectPreferredImageRefSlots(
            slots,
            new Map([
                [1, { mime: 'image/png', base64: Buffer.alloc(20).toString('base64') }],
                [8, { mime: 'image/png', base64: Buffer.alloc(10).toString('base64') }],
                [50, { mime: 'image/png', base64: Buffer.alloc(15).toString('base64') }]
            ])
        );

        expect(preferred).toHaveLength(1);
        expect(preferred[0].imageRefId).toBe(1);
    });

    it('extracts shape-scoped text groups from OfficeArtClientTextbox containers', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);
        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const shapeOne = createRecord(
            0xf00d,
            Buffer.concat([
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Shape Title', 'utf16le'))
            ]),
            0x0f
        );

        const shapeTwo = createRecord(
            0xf00d,
            Buffer.concat([
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('Shape body 1', 'latin1')),
                createRecord(4008, Buffer.from('Shape body 2', 'latin1'))
            ]),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            Buffer.concat([shapeOne, shapeTwo]),
            0x0f,
            77
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const groups = (PptBinaryParser as any).extractShapeTextGroupsFromRecord(records[0]);

        expect(groups).toEqual([
            {
                blocks: [
                    { text: 'Shape Title', textType: 0 }
                ]
            },
            {
                blocks: [
                    { text: 'Shape body 1', textType: 1 },
                    { text: 'Shape body 2', textType: 1 }
                ]
            }
        ]);
    });

    it('does not double-count nested ClientTextbox content when a parent shape container already owns it', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const spContainer = createRecord(
            0xf004,
            createRecord(
                0xf00d,
                Buffer.concat([
                    createRecord(3999, titleHeader),
                    createRecord(4000, Buffer.from('Shape Title', 'utf16le'))
                ]),
                0x0f
            ),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            spContainer,
            0x0f,
            109
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const groups = (PptBinaryParser as any).extractShapeTextGroupsFromRecord(records[0]);

        expect(groups).toHaveLength(1);
        expect(groups[0]).toEqual({
            blocks: [
                { text: 'Shape Title', textType: 0 }
            ],
            bounds: undefined
        });
    });

    it('prefers OfficeArtClientTextbox grouping over flat direct text extraction when outline text is absent', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);
        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const shapeOne = createRecord(
            0xf00d,
            Buffer.concat([
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Shape Title', 'utf16le'))
            ]),
            0x0f
        );

        const shapeTwo = createRecord(
            0xf00d,
            Buffer.concat([
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('First bullet', 'latin1')),
                createRecord(4008, Buffer.from('Second bullet', 'latin1'))
            ]),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            Buffer.concat([shapeOne, shapeTwo]),
            0x0f,
            77
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        expect(slides).toHaveLength(1);
        expect(slides[0].elements).toHaveLength(2);
        expect(slides[0].elements[0].paragraphs).toEqual([
            { text: 'Shape Title', level: 0, bullet: false, color: undefined }
        ]);
        expect(slides[0].elements[1].paragraphs).toEqual([
            { text: 'First bullet', level: 0, bullet: false, color: undefined },
            { text: 'Second bullet', level: 0, bullet: true, color: undefined }
        ]);
    });

    it('maps grouped OfficeArtClientTextbox content onto placeholder slots for multi-column layouts', () => {
        const slideAtom = Buffer.alloc(24);
        slideAtom.writeUInt32LE(0x00000008, 0);
        slideAtom.writeUInt8(0x0d, 4);
        slideAtom.writeUInt8(0x0e, 5);
        slideAtom.writeUInt8(0x0e, 6);

        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);
        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const shapeTitle = createRecord(
            0xf00d,
            Buffer.concat([
                createRecord(3999, titleHeader),
                createRecord(4000, Buffer.from('Overview', 'utf16le'))
            ]),
            0x0f
        );

        const shapeLeft = createRecord(
            0xf00d,
            Buffer.concat([
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('Left body', 'latin1'))
            ]),
            0x0f
        );

        const shapeRight = createRecord(
            0xf00d,
            Buffer.concat([
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('Right body', 'latin1'))
            ]),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(1007, slideAtom, 0x02),
                shapeTitle,
                shapeLeft,
                shapeRight
            ]),
            0x0f,
            88
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        expect(slides[0].elements[0].paragraphs).toEqual([
            { text: 'Overview', level: 0, bullet: false, color: undefined }
        ]);
        expect(slides[0].elements[1].x).toBeLessThan(slides[0].elements[2].x);
        expect(slides[0].elements[1].paragraphs).toEqual([
            { text: 'Left body', level: 0, bullet: false, color: undefined }
        ]);
        expect(slides[0].elements[2].paragraphs).toEqual([
            { text: 'Right body', level: 0, bullet: false, color: undefined }
        ]);
    });

    it('extracts bounds from OfficeArtSpContainer anchors and applies them to text placement', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const anchor = Buffer.alloc(16);
        anchor.writeInt32LE(120, 0);
        anchor.writeInt32LE(140, 4);
        anchor.writeInt32LE(520, 8);
        anchor.writeInt32LE(260, 12);

        const spContainer = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, anchor),
                createRecord(
                    0xf00d,
                    Buffer.concat([
                        createRecord(3999, titleHeader),
                        createRecord(4000, Buffer.from('Anchored Title', 'utf16le'))
                    ]),
                    0x0f
                )
            ]),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            spContainer,
            0x0f,
            100
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const groups = (PptBinaryParser as any).extractShapeTextGroupsFromRecord(records[0]);
        expect(groups[0].bounds).toEqual({
            x: 120,
            y: 140,
            width: 400,
            height: 120
        });

        const slides = (PptBinaryParser as any).buildSlides(
            records,
            [],
            new Map(),
            null,
            { widthPx: 960, heightPx: 720, rawWidth: 960, rawHeight: 720 },
            960,
            720
        );
        expect(slides[0].elements[0].x).toBe(120);
        expect(slides[0].elements[0].y).toBe(140);
        expect(slides[0].elements[0].width).toBe(400);
        expect(slides[0].elements[0].height).toBe(120);
    });

    it('scales anchored bounds when legacy slide coordinates use master units', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const anchor = Buffer.alloc(16);
        anchor.writeInt32LE(1710, 0);
        anchor.writeInt32LE(2364, 4);
        anchor.writeInt32LE(3378, 8);
        anchor.writeInt32LE(2604, 12);

        const spContainer = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, anchor),
                createRecord(
                    0xf00d,
                    Buffer.concat([
                        createRecord(3999, titleHeader),
                        createRecord(4000, Buffer.from('Scaled Title', 'utf16le'))
                    ]),
                    0x0f
                )
            ]),
            0x0f
        );

        const slideContainer = createRecord(1006, spContainer, 0x0f, 111);
        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(
            records,
            [],
            new Map(),
            null,
            { widthPx: 960, heightPx: 720, rawWidth: 5760, rawHeight: 4320 },
            960,
            720
        );

        expect(slides[0].elements[0].x).toBe(285);
        expect(slides[0].elements[0].y).toBe(394);
        expect(slides[0].elements[0].width).toBe(278);
        expect(slides[0].elements[0].height).toBe(40);
    });

    it('uses non-text OfficeArt shape bounds to place legacy pictures', () => {
        const slideAtom = Buffer.alloc(24);
        slideAtom.writeUInt32LE(0x0000000f, 0);
        slideAtom.writeUInt8(0x08, 4);

        const anchor = Buffer.alloc(16);
        anchor.writeInt32LE(200, 0);
        anchor.writeInt32LE(180, 4);
        anchor.writeInt32LE(620, 8);
        anchor.writeInt32LE(460, 12);

        const imageSlot = createRecord(
            0xf004,
            createRecord(0xf010, anchor),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(1007, slideAtom, 0x02),
                imageSlot
            ]),
            0x0f,
            101
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(
            records,
            [{ mime: 'image/png', base64: 'ZmFrZQ==' }],
            new Map(),
            null,
            null,
            960,
            720
        );

        const image = slides[0].elements.find((element: any) => element.type === 'image');
        expect(image).toEqual({
            type: 'image',
            x: 200,
            y: 180,
            width: 420,
            height: 280,
            zIndex: 100,
            src: 'data:image/png;base64,ZmFrZQ=='
        });
    });

    it('falls back to generic image placement when no visual slot exists', () => {
        const slideContainer = createRecord(
            1006,
            Buffer.alloc(0),
            0x0f,
            102
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(
            records,
            [{ mime: 'image/png', base64: 'ZmFrZQ==' }],
            new Map(),
            null,
            null,
            960,
            720
        );

        const image = slides[0].elements.find((element: any) => element.type === 'image');
        expect(image.x).toBe(72);
        expect(image.y).toBe(180);
        expect(image.width).toBe(816);
        expect(image.height).toBe(420);
    });

    it('maps multiple legacy pictures across multiple discovered visual slots', () => {
        const slideAtom = Buffer.alloc(24);
        slideAtom.writeUInt32LE(0x00000008, 0);
        slideAtom.writeUInt8(0x08, 4);
        slideAtom.writeUInt8(0x08, 5);

        const leftAnchor = Buffer.alloc(16);
        leftAnchor.writeInt32LE(80, 0);
        leftAnchor.writeInt32LE(200, 4);
        leftAnchor.writeInt32LE(420, 8);
        leftAnchor.writeInt32LE(460, 12);

        const rightAnchor = Buffer.alloc(16);
        rightAnchor.writeInt32LE(500, 0);
        rightAnchor.writeInt32LE(200, 4);
        rightAnchor.writeInt32LE(840, 8);
        rightAnchor.writeInt32LE(460, 12);

        const leftSlot = createRecord(0xf004, createRecord(0xf010, leftAnchor), 0x0f);
        const rightSlot = createRecord(0xf004, createRecord(0xf010, rightAnchor), 0x0f);

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(1007, slideAtom, 0x02),
                leftSlot,
                rightSlot
            ]),
            0x0f,
            103
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(
            records,
            [
                { mime: 'image/png', base64: 'bGVmdA==' },
                { mime: 'image/jpeg', base64: 'cmlnaHQ=' }
            ],
            new Map(),
            null,
            null,
            960,
            720
        );

        const images = slides[0].elements.filter((element: any) => element.type === 'image');
        expect(images).toHaveLength(2);
        expect(images[0]).toEqual({
            type: 'image',
            x: 80,
            y: 200,
            width: 340,
            height: 260,
            zIndex: 100,
            src: 'data:image/png;base64,bGVmdA=='
        });
        expect(images[1]).toEqual({
            type: 'image',
            x: 500,
            y: 200,
            width: 340,
            height: 260,
            zIndex: 101,
            src: 'data:image/jpeg;base64,cmlnaHQ='
        });
    });

    it('extracts fill and line colors from OfficeArt shape properties for text boxes', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const anchor = Buffer.alloc(16);
        anchor.writeInt32LE(120, 0);
        anchor.writeInt32LE(140, 4);
        anchor.writeInt32LE(520, 8);
        anchor.writeInt32LE(260, 12);

        const fopt = Buffer.concat([
            createOfficeArtProperty(0x0181, 0x00336699),
            createOfficeArtProperty(0x01c0, 0x00cc8844)
        ]);

        const spContainer = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, anchor),
                createRecord(0xf00b, fopt, 0x03, 2),
                createRecord(
                    0xf00d,
                    Buffer.concat([
                        createRecord(3999, titleHeader),
                        createRecord(4000, Buffer.from('Styled Title', 'utf16le'))
                    ]),
                    0x0f
                )
            ]),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            spContainer,
            0x0f,
            104
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        expect(slides[0].elements[0].fillColor).toBe('#996633');
        expect(slides[0].elements[0].borderColor).toBe('#4488cc');
    });

    it('extracts border width and visibility flags from OfficeArt shape properties', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(0, 0);

        const anchor = Buffer.alloc(16);
        anchor.writeInt32LE(120, 0);
        anchor.writeInt32LE(140, 4);
        anchor.writeInt32LE(520, 8);
        anchor.writeInt32LE(260, 12);

        const fopt = Buffer.concat([
            createOfficeArtProperty(0x0181, 0x00336699),
            createOfficeArtProperty(0x01c0, 0x00cc8844),
            createOfficeArtProperty(0x01cb, 19050),
            createOfficeArtProperty(0x0180, 0),
            createOfficeArtProperty(0x01bf, 1)
        ]);

        const spContainer = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, anchor),
                createRecord(0xf00b, fopt, 0x03, 5),
                createRecord(
                    0xf00d,
                    Buffer.concat([
                        createRecord(3999, titleHeader),
                        createRecord(4000, Buffer.from('Styled Title', 'utf16le'))
                    ]),
                    0x0f
                )
            ]),
            0x0f
        );

        const slideContainer = createRecord(1006, spContainer, 0x0f, 107);
        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        expect(slides[0].elements[0].fillColor).toBeUndefined();
        expect(slides[0].elements[0].borderColor).toBe('#4488cc');
        expect(slides[0].elements[0].borderWidthPx).toBe(2);
    });

    it('hides shape borders when OfficeArt line visibility is disabled', () => {
        const anchor = Buffer.alloc(16);
        anchor.writeInt32LE(150, 0);
        anchor.writeInt32LE(220, 4);
        anchor.writeInt32LE(390, 8);
        anchor.writeInt32LE(340, 12);

        const fopt = Buffer.concat([
            createOfficeArtProperty(0x0181, 0x00ffeeaa),
            createOfficeArtProperty(0x01c0, 0x00112233),
            createOfficeArtProperty(0x01bf, 0)
        ]);

        const shapeSlot = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, anchor),
                createRecord(0xf00b, fopt, 0x03, 3)
            ]),
            0x0f
        );

        const slideContainer = createRecord(1006, shapeSlot, 0x0f, 108);
        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        const shape = slides[0].elements.find((element: any) => element.type === 'shape');
        expect(shape.fillColor).toBe('#aaeeff');
        expect(shape.borderColor).toBeUndefined();
        expect(shape.borderWidthPx).toBeUndefined();
    });

    it('emits non-text visual slots as shape elements when they have visible style', () => {
        const anchor = Buffer.alloc(16);
        anchor.writeInt32LE(150, 0);
        anchor.writeInt32LE(220, 4);
        anchor.writeInt32LE(390, 8);
        anchor.writeInt32LE(340, 12);

        const fopt = Buffer.concat([
            createOfficeArtProperty(0x0181, 0x00ffeeaa),
            createOfficeArtProperty(0x01c0, 0x00112233)
        ]);

        const shapeSlot = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, anchor),
                createRecord(0xf00b, fopt, 0x03, 2)
            ]),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            shapeSlot,
            0x0f,
            105
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, null, 960, 720);

        const shape = slides[0].elements.find((element: any) => element.type === 'shape');
        expect(shape).toEqual({
            type: 'shape',
            x: 150,
            y: 220,
            width: 240,
            height: 120,
            zIndex: 50,
            fillColor: '#aaeeff',
            borderColor: '#332211'
        });
    });

    it('does not duplicate a visual slot as both image and shape when used for a picture', () => {
        const slideAtom = Buffer.alloc(24);
        slideAtom.writeUInt32LE(0x0000000f, 0);
        slideAtom.writeUInt8(0x08, 4);

        const anchor = Buffer.alloc(16);
        anchor.writeInt32LE(100, 0);
        anchor.writeInt32LE(160, 4);
        anchor.writeInt32LE(460, 8);
        anchor.writeInt32LE(420, 12);

        const fopt = Buffer.concat([
            createOfficeArtProperty(0x0181, 0x00ffeeaa),
            createOfficeArtProperty(0x01c0, 0x00112233)
        ]);

        const pictureSlot = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, anchor),
                createRecord(0xf00b, fopt, 0x03, 2)
            ]),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(1007, slideAtom, 0x02),
                pictureSlot
            ]),
            0x0f,
            106
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(
            records,
            [{ mime: 'image/png', base64: 'ZmFrZQ==' }],
            new Map(),
            null,
            null,
            960,
            720
        );

        expect(slides[0].elements.filter((element: any) => element.type === 'image')).toHaveLength(1);
        expect(slides[0].elements.filter((element: any) => element.type === 'shape')).toHaveLength(0);
    });

    it('decodes Korean TextBytesAtom payloads using legacy byte encodings such as CP949/EUC-KR', () => {
        const koreanBytes = Buffer.from('c0afbec620bcf6c7d0', 'hex');
        const text = (PptBinaryParser as any).decodeTextAtom({
            recType: 4008,
            payload: koreanBytes
        });

        expect(text).toBe('유아 수학');
    });

    it('does not classify readable Korean text as noise', () => {
        expect((PptBinaryParser as any).isNoiseText('활동자료')).toBe(false);
    });

    it('uses decoded Korean byte text when building slides from TextBytesAtom records', () => {
        const bodyHeader = Buffer.alloc(4);
        bodyHeader.writeUInt32LE(1, 0);

        const slideContainer = createRecord(
            1006,
            Buffer.concat([
                createRecord(3999, bodyHeader),
                createRecord(4008, Buffer.from('c8b0b5bfc0dab7e1', 'hex'))
            ]),
            0x0f,
            110
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const blocks = (PptBinaryParser as any).extractTypedTextBlocksFromRecord(records[0]);
        expect(blocks).toEqual([
            { text: '활동자료', textType: 1 }
        ]);

        const slides = (PptBinaryParser as any).buildSlides([records[0]], [], new Map(), null, null, 960, 720);

        expect(slides[0].elements[0].paragraphs).toEqual([
            { text: '활동자료', level: 0, bullet: false, color: undefined }
        ]);
    });

    it('extracts picture assets from BStore entries using delayed Pictures offsets', () => {
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9cAAAAASUVORK5CYII=',
            'base64'
        );
        const jpeg = Buffer.from(
            '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUVFRUWFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGysmICYtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAgMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAByA//xAAVEAEBAAAAAAAAAAAAAAAAAAAAEf/aAAgBAQABBQL/xAAVEQEBAAAAAAAAAAAAAAAAAAABEP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQABPyF//9k=',
            'base64'
        );
        const pngEntryHeader = Buffer.alloc(25);
        const jpegEntryHeader = Buffer.alloc(25);
        const picturesStream = Buffer.concat([pngEntryHeader, png, jpegEntryHeader, jpeg]);

        const byId = (PptBinaryParser as any).extractPicturesByBlipId([
            { recType: 0xf007, payload: createBsePayload(0, png.length, 6) },
            { recType: 0xf007, payload: createBsePayload(25 + png.length, jpeg.length, 5) }
        ], picturesStream);

        expect(byId.get(1)).toEqual({
            mime: 'image/png',
            base64: png.toString('base64')
        });
        expect(byId.get(2)).toEqual({
            mime: 'image/jpeg',
            base64: jpeg.toString('base64')
        });
    });

    it('uses shape blip references before sequential image fallback when placing pictures', () => {
        const anchor = Buffer.alloc(8);
        anchor.writeInt16LE(100, 0);
        anchor.writeInt16LE(100, 2);
        anchor.writeInt16LE(400, 4);
        anchor.writeInt16LE(300, 6);

        const pictureSlot = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, anchor),
                createRecord(0xf00b, createOfficeArtProperty(0x4186, 2), 0x03, 1)
            ]),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            pictureSlot,
            0x0f,
            120
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(
            records,
            [{ mime: 'image/png', base64: 'c2VxdWVudGlhbA==' }],
            new Map(),
            null,
            null,
            960,
            720,
            new Map([[2, { mime: 'image/jpeg', base64: 'cmVmZXJlbmNlZA==' }]])
        );

        expect(slides[0].elements.filter((element: any) => element.type === 'image')).toEqual([
            expect.objectContaining({
                src: 'data:image/jpeg;base64,cmVmZXJlbmNlZA=='
            })
        ]);
    });

    it('keeps only the large backdrop image on activity list slides instead of mapping sequential pictures into each text cell', () => {
        const titleHeader = Buffer.alloc(4);
        titleHeader.writeUInt32LE(4, 0);

        const titleAnchor = Buffer.alloc(16);
        titleAnchor.writeInt32LE(1478, 0);
        titleAnchor.writeInt32LE(166, 4);
        titleAnchor.writeInt32LE(4283, 8);
        titleAnchor.writeInt32LE(574, 12);

        const backdropAnchor = Buffer.alloc(16);
        backdropAnchor.writeInt32LE(845, 0);
        backdropAnchor.writeInt32LE(362, 4);
        backdropAnchor.writeInt32LE(5400, 8);
        backdropAnchor.writeInt32LE(4148, 12);

        const cellAnchor = Buffer.alloc(16);
        cellAnchor.writeInt32LE(362, 0);
        cellAnchor.writeInt32LE(1212, 4);
        cellAnchor.writeInt32LE(2040, 8);
        cellAnchor.writeInt32LE(1579, 12);

        const titleShape = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, titleAnchor),
                createRecord(
                    0xf00d,
                    Buffer.concat([
                        createRecord(3999, titleHeader),
                        createRecord(4000, Buffer.from('유아를 위한 수학활동 목록', 'utf16le'))
                    ]),
                    0x0f
                )
            ]),
            0x0f
        );

        const backdropShape = createRecord(
            0xf004,
            createRecord(0xf010, backdropAnchor),
            0x0f
        );

        const cellShape = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, cellAnchor),
                createRecord(
                    0xf00d,
                    Buffer.concat([
                        createRecord(3999, Buffer.from([0x07, 0x00, 0x00, 0x00])),
                        createRecord(4000, Buffer.from('내 몸에서 동그라미', 'utf16le'))
                    ]),
                    0x0f
                )
            ]),
            0x0f
        );

        const slideContainer = createRecord(
            1006,
            Buffer.concat([titleShape, backdropShape, cellShape]),
            0x0f,
            121
        );

        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(
            records,
            [
                { mime: 'image/png', base64: 'YmFja2Ryb3A=' },
                { mime: 'image/png', base64: 'Y2VsbDE=' },
                { mime: 'image/png', base64: 'Y2VsbDI=' }
            ],
            new Map(),
            null,
            null,
            { widthPx: 960, heightPx: 720, rawWidth: 5760, rawHeight: 4320 },
            960,
            720
        );

        expect(slides[0].elements.filter((element: any) => element.type === 'image')).toEqual([]);
        expect(slides[0].elements.filter((element: any) =>
            element.type === 'shape' && element.fillColor === '#606060'
        ).length).toBeGreaterThanOrEqual(10);
    });

    it('does not add the same master asset twice when a slide already contains that image explicitly', () => {
        const explicitFooterAnchor = Buffer.alloc(16);
        explicitFooterAnchor.writeInt32LE(2404, 0);
        explicitFooterAnchor.writeInt32LE(3900, 4);
        explicitFooterAnchor.writeInt32LE(3344, 8);
        explicitFooterAnchor.writeInt32LE(4187, 12);

        const explicitFooter = createRecord(
            0xf004,
            Buffer.concat([
                createRecord(0xf010, explicitFooterAnchor),
                createRecord(0xf00b, createOfficeArtProperty(0x4186, 2), 0x03, 1)
            ]),
            0x0f
        );

        const masterBackgroundAnchor = Buffer.alloc(16);
        masterBackgroundAnchor.writeInt32LE(0, 0);
        masterBackgroundAnchor.writeInt32LE(0, 4);
        masterBackgroundAnchor.writeInt32LE(5760, 8);
        masterBackgroundAnchor.writeInt32LE(4320, 12);

        const masterFooterAnchor = Buffer.alloc(16);
        masterFooterAnchor.writeInt32LE(18, 0);
        masterFooterAnchor.writeInt32LE(4032, 4);
        masterFooterAnchor.writeInt32LE(958, 8);
        masterFooterAnchor.writeInt32LE(4320, 12);

        const masterContainer = createRecord(
            1016,
            Buffer.concat([
                createRecord(
                    0xf004,
                    Buffer.concat([
                        createRecord(0xf010, masterBackgroundAnchor),
                        createRecord(0xf00b, createOfficeArtProperty(0x4186, 137), 0x03, 1)
                    ]),
                    0x0f
                ),
                createRecord(
                    0xf004,
                    Buffer.concat([
                        createRecord(0xf010, masterFooterAnchor),
                        createRecord(0xf00b, createOfficeArtProperty(0x4186, 2), 0x03, 1)
                    ]),
                    0x0f
                )
            ]),
            0x0f,
            500
        );
        const masterRecord = (PptBinaryParser as any).parseRecords(masterContainer, 0, masterContainer.length)[0];

        const slideContainer = createRecord(
            1006,
            explicitFooter,
            0x0f,
            122
        );

        const backgroundBase64 = Buffer.alloc(12_000, 1).toString('base64');
        const records = (PptBinaryParser as any).parseRecords(slideContainer, 0, slideContainer.length);
        const slides = (PptBinaryParser as any).buildSlides(
            records,
            [],
            new Map(),
            null,
            masterRecord,
            { widthPx: 960, heightPx: 720, rawWidth: 5760, rawHeight: 4320 },
            960,
            720,
            new Map([
                [2, { mime: 'image/png', base64: 'Zm9vdGVy' }],
                [137, { mime: 'image/png', base64: backgroundBase64 }]
            ])
        );

        const images = slides[0].elements.filter((element: any) => element.type === 'image');
        expect(images).toHaveLength(2);
        expect(images.filter((element: any) => element.src === 'data:image/png;base64,Zm9vdGVy')).toHaveLength(1);
        expect(images.filter((element: any) => element.src === `data:image/png;base64,${backgroundBase64}`)).toHaveLength(1);
    });
});
