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
        const size = (PptBinaryParser as any).extractPresentationSize(records);

        expect(size).toEqual({
            widthPx: 960,
            heightPx: 720
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
        const size = (PptBinaryParser as any).extractPresentationSize(records);

        expect(size).toBeNull();
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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), 960, 720);

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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), 960, 720);

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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), masterColorScheme, 960, 720);

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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, 960, 720);

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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, 960, 720);

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
            960,
            720
        );

        expect(slides[0].elements[0].y).toBeLessThan(slides[0].elements[1].y);
        expect(slides[0].elements[1].paragraphs).toEqual([
            { text: 'Subtitle text', level: 0, bullet: false, color: undefined }
        ]);
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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, 960, 720);

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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, 960, 720);

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

        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, 960, 720);
        expect(slides[0].elements[0].x).toBe(120);
        expect(slides[0].elements[0].y).toBe(140);
        expect(slides[0].elements[0].width).toBe(400);
        expect(slides[0].elements[0].height).toBe(120);
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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, 960, 720);

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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, 960, 720);

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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, 960, 720);

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
        const slides = (PptBinaryParser as any).buildSlides(records, [], new Map(), null, 960, 720);

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
            960,
            720
        );

        expect(slides[0].elements.filter((element: any) => element.type === 'image')).toHaveLength(1);
        expect(slides[0].elements.filter((element: any) => element.type === 'shape')).toHaveLength(0);
    });
});
