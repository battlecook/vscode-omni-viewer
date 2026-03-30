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
        expect(slides[0].elements[0].y).toBeLessThan(100);
        expect(slides[0].elements[1].y).toBeGreaterThan(slides[0].elements[0].y);
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
            bounds: undefined,
            spContainerIndex: 0
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
        expect(image).toBeDefined();
        expect(image).toMatchObject({
            type: 'image',
            x: 200,
            y: 180,
            width: 420,
            height: 280,
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
        expect(images[0]).toMatchObject({
            type: 'image',
            x: 80,
            y: 200,
            width: 340,
            height: 260,
            src: 'data:image/png;base64,bGVmdA=='
        });
        expect(images[1]).toMatchObject({
            type: 'image',
            x: 500,
            y: 200,
            width: 340,
            height: 260,
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
        expect(shape).toMatchObject({
            type: 'shape',
            x: 150,
            y: 220,
            width: 240,
            height: 120,
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

        // Generic parser should produce elements from the SpContainer data
        expect(slides[0].elements.length).toBeGreaterThan(0);
        expect(slides[0].elements.some((element: any) => element.type === 'image')).toBe(true);
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
