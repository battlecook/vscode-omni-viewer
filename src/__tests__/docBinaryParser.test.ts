jest.mock('xlsx', () => ({}), { virtual: true });

import { DocBinaryParser } from '../utils/docBinaryParser';

describe('DocBinaryParser encoding selection', () => {
    it('prefers readable Hangul text over mojibake for legacy ANSI pieces', () => {
        const parser = DocBinaryParser as unknown as {
            selectBestDecodedCandidate(
                candidates: Map<string, string[]>,
                segments: Map<string, Array<{ text: string; cpStart: number; fcStart: number; bytesPerChar: number }>>,
                startsAtZero: boolean,
                pieceCount: number
            ): { text: string; score: number } | null;
        };
        const candidates = new Map<string, string[]>([
            ['windows-1252', ['Å×½ºÆ® ¹®¼­ÀÔ´Ï´Ù legacy word content Å×½ºÆ® ¹®¼­ÀÔ´Ï´Ù']],
            ['euc-kr', ['테스트 문서입니다. 이 문서는 한글 인코딩 선택 테스트를 위한 예시입니다.']],
            ['shift_jis', ['ﾅﾗｽﾄ ﾑｸｼﾇ ﾅﾗｽﾄ ﾑｸｼﾇ ﾅﾗｽﾄ']]
        ]);
        const segments = new Map<string, Array<{ text: string; cpStart: number; fcStart: number; bytesPerChar: number }>>([
            ['windows-1252', []],
            ['euc-kr', []],
            ['shift_jis', []]
        ]);

        const selected = parser.selectBestDecodedCandidate(candidates, segments, true, 1);

        expect(selected).not.toBeNull();
        if (!selected) {
            throw new Error('Expected a decoded candidate');
        }
        expect(selected.text).toContain('테스트 문서입니다');
    });

    it('renders text color and background color from character styles', () => {
        const parser = DocBinaryParser as unknown as {
            renderInlineStyleAttribute(style?: {
                color?: string;
                backgroundColor?: string;
                bold?: boolean;
                textAlign?: string;
                marginLeftTwips?: number;
                firstLineIndentTwips?: number;
                highlightColor?: string;
            }): string;
        };

        const styleAttr = parser.renderInlineStyleAttribute({
            color: '#112233',
            backgroundColor: '#ffeeaa',
            highlightColor: '#fff200',
            bold: true,
            textAlign: 'center',
            marginLeftTwips: 720,
            firstLineIndentTwips: 240
        });

        expect(styleAttr).toContain('color:#112233');
        expect(styleAttr).toContain('background-color:#ffeeaa');
        expect(styleAttr).toContain('background-color:#fff200');
        expect(styleAttr).toContain('font-weight:700');
        expect(styleAttr).toContain('text-align:center');
        expect(styleAttr).toContain('margin-left:36.0pt');
        expect(styleAttr).toContain('text-indent:12.0pt');
    });

    it('suppresses near-black background colors for legacy document paper safety', () => {
        const parser = DocBinaryParser as unknown as {
            renderInlineStyleAttribute(style?: {
                backgroundColor?: string;
                highlightColor?: string;
            }): string;
        };

        const styleAttr = parser.renderInlineStyleAttribute({
            backgroundColor: '#000000',
            highlightColor: '#111111'
        });

        expect(styleAttr).not.toContain('background-color:#000000');
        expect(styleAttr).not.toContain('background-color:#111111');
    });

    it('parses table definitions that include the legacy leading offset bytes', () => {
        const parser = DocBinaryParser as unknown as {
            parseTDefTableOperand(buffer: Buffer): {
                columnCount: number;
                columnWidthsTwips: number[];
                cellMerges: Array<{ horzMerge: number; vertMerge: number }>;
            } | undefined;
        };

        const operand = Buffer.alloc(93);
        operand[0] = 0x5c;
        operand[1] = 0x00;
        operand[2] = 0x04;
        [0, 720, 6390, 7950, 9645].forEach((boundary, index) => {
            operand.writeInt16LE(boundary, 3 + index * 2);
        });
        operand.writeUInt16LE(0x0000, 13);
        operand.writeUInt16LE(0x0001, 33);
        operand.writeUInt16LE(0x0040, 53);
        operand.writeUInt16LE(0x0000, 73);

        const parsed = parser.parseTDefTableOperand(operand);

        expect(parsed).toBeDefined();
        expect(parsed?.columnCount).toBe(4);
        expect(parsed?.columnWidthsTwips).toEqual([720, 5670, 1560, 1695]);
        expect(parsed?.cellMerges).toEqual([
            { horzMerge: 0, vertMerge: 0 },
            { horzMerge: 1, vertMerge: 0 },
            { horzMerge: 0, vertMerge: 2 },
            { horzMerge: 0, vertMerge: 0 }
        ]);
    });

    it('propagates row-level table metadata to table paragraphs before the terminator', () => {
        const parser = DocBinaryParser as unknown as {
            enrichStructuredTableParagraphs(paragraphs: Array<{
                text: string;
                inTable?: boolean;
                isTableTerminator?: boolean;
                tableColumnCount?: number;
                tableColumnWidthsTwips?: number[];
                tableCellMerges?: Array<{ horzMerge: number; vertMerge: number }>;
                style?: { backgroundColor?: string };
            }>): Array<{
                tableColumnCount?: number;
                tableColumnWidthsTwips?: number[];
                tableCellMerges?: Array<{ horzMerge: number; vertMerge: number }>;
                style?: { backgroundColor?: string };
            }>;
        };

        const paragraphs = parser.enrichStructuredTableParagraphs([
            { text: 'A1', inTable: true },
            { text: 'A2', inTable: true },
            {
                text: '',
                inTable: true,
                isTableTerminator: true,
                tableColumnCount: 2,
                tableColumnWidthsTwips: [1440, 2880],
                tableCellMerges: [{ horzMerge: 0, vertMerge: 0 }, { horzMerge: 1, vertMerge: 0 }],
                style: { backgroundColor: '#ffeeaa' }
            },
            { text: 'outside' }
        ]);

        expect(paragraphs[0].tableColumnCount).toBe(2);
        expect(paragraphs[0].tableColumnWidthsTwips).toEqual([1440, 2880]);
        expect(paragraphs[0].tableCellMerges).toEqual([{ horzMerge: 0, vertMerge: 0 }, { horzMerge: 1, vertMerge: 0 }]);
        expect(paragraphs[0].style?.backgroundColor).toBe('#ffeeaa');
        expect(paragraphs[1].tableColumnCount).toBe(2);
        expect(paragraphs[2].tableColumnCount).toBe(2);
    });

    it('keeps empty structured table cells so merge alignment is preserved', () => {
        const parser = DocBinaryParser as unknown as {
            splitStructuredTableRow(
                line: { text: string; runs?: Array<{ text: string }> },
                expectedColumnCount?: number
            ): string[];
        };

        expect(parser.splitStructuredTableRow({ text: 'left\t\tright' }, 3)).toEqual(['left', '', 'right']);
        expect(parser.splitStructuredTableRow({ text: 'left\t\t' }, 3)).toEqual(['left', '', '']);
    });

    it('removes field code noise from paragraph normalization', () => {
        const parser = DocBinaryParser as unknown as {
            normalizeParagraphText(raw: string, preserveTabs?: boolean): string;
        };

        const normalized = parser.normalizeParagraphText('HYPERLINK "https://example.com" Mauris id ex erat.');

        expect(normalized).toBe('Mauris id ex erat.');
    });

    it('removes field code noise from inline runs before rendering', () => {
        const parser = DocBinaryParser as unknown as {
            renderInlineStyledText(
                runs: Array<{ text: string; style?: { color?: string } }> | undefined,
                fallbackText: string
            ): string;
        };

        const rendered = parser.renderInlineStyledText(
            [{ text: 'HYPERLINK "https://example.com" Mauris id ex erat.' }],
            'fallback'
        );

        expect(rendered).toBe('Mauris id ex erat.');
    });

    it('groups in-table paragraphs into a single row until the row terminator', () => {
        const parser = DocBinaryParser as unknown as {
            buildStructuredTableRow(
                lines: Array<{ text: string; isTableTerminator?: boolean }>,
                expectedColumnCount?: number
            ): string[];
        };

        const row = parser.buildStructuredTableRow([
            { text: 'Header A' },
            { text: 'Header B' },
            { text: '', isTableTerminator: true }
        ], 2);

        expect(row).toEqual(['Header A', 'Header B']);
    });

    it('wraps rendered legacy blocks so the viewer can paginate the document', () => {
        const parser = DocBinaryParser as unknown as {
            renderBlocks(blocks: Array<
                | { kind: 'heading'; text: string }
                | { kind: 'paragraph'; text: string; pageBreakBefore?: boolean }
                | { kind: 'table'; rows: Array<Array<{ text: string }>> }
            >): string;
        };

        const rendered = parser.renderBlocks([
            { kind: 'heading', text: 'Title' },
            { kind: 'paragraph', text: 'Body text', pageBreakBefore: true },
            { kind: 'table', rows: [[{ text: 'A' }, { text: 'B' }], [{ text: '1' }, { text: '2' }]] }
        ]);

        expect(rendered).toContain('ov-doc-legacy-block');
        expect(rendered).toContain('ov-doc-legacy-block-table');
        expect(rendered).toContain('data-ov-page-break-before="true"');
        expect(rendered).toContain('<h1');
        expect(rendered).toContain('<p');
        expect(rendered).toContain('<table>');
        expect(rendered).toContain('<thead>');
        expect(rendered).toContain('<tbody>');
    });

    it('renders complex table headers through the table render model', () => {
        const parser = DocBinaryParser as unknown as {
            renderBlocks(blocks: Array<
                | {
                    kind: 'table';
                    rows: Array<Array<{ text: string; colspan?: number; rowspan?: number }>>;
                    columnWidthsTwips?: number[];
                }
            >): string;
        };

        const rendered = parser.renderBlocks([
            {
                kind: 'table',
                columnWidthsTwips: [2400, 2400, 2400],
                rows: [
                    [{ text: 'Region', rowspan: 2 }, { text: 'Revenue', colspan: 2 }],
                    [{ text: 'Q1' }, { text: 'Q2' }],
                    [{ text: 'APAC' }, { text: '10' }, { text: '12' }]
                ]
            }
        ]);

        expect(rendered).toContain('data-ov-table-header-rows="2"');
        expect(rendered).toContain('<thead><tr><th rowspan="2">Region</th><th colspan="2">Revenue</th></tr><tr><th>Q1</th><th>Q2</th></tr></thead>');
        expect(rendered).toContain('<tbody><tr><td>APAC</td><td>10</td><td>12</td></tr></tbody>');
    });

    it('renders embedded sheet tables with thead and tbody', () => {
        const parser = DocBinaryParser as unknown as {
            buildRenderedBlockModel(block: {
                kind: 'sheet';
                title?: string;
                rows?: string[][];
                headerRowCount?: number;
            }): { html: string } | undefined;
        };

        const model = parser.buildRenderedBlockModel({
            kind: 'sheet',
            title: 'Embedded Sheet',
            headerRowCount: 1,
            rows: [
                ['Name', 'Value'],
                ['A', '10'],
                ['B', '20']
            ]
        });

        expect(model?.html).toContain('<thead><tr><th>Name</th><th>Value</th></tr></thead>');
        expect(model?.html).toContain('<tbody><tr><td>A</td><td>10</td></tr><tr><td>B</td><td>20</td></tr></tbody>');
    });

    it('detects multi-row embedded sheet headers when the opening rows are label rows', () => {
        const parser = DocBinaryParser as unknown as {
            detectEmbeddedSheetHeaderRowCount(rows?: string[][]): number;
        };

        expect(parser.detectEmbeddedSheetHeaderRowCount([
            ['Region', 'Revenue', 'Revenue'],
            ['', 'Q1', 'Q2'],
            ['APAC', '10', '12']
        ])).toBe(2);
        expect(parser.detectEmbeddedSheetHeaderRowCount([
            ['Region', 'Revenue'],
            ['APAC', '10']
        ])).toBe(1);
    });

    it('builds a semantic table model before rendering html', () => {
        const parser = DocBinaryParser as unknown as {
            buildSemanticTableModel(block: {
                kind: 'table';
                rows: Array<Array<{ text: string; colspan?: number; rowspan?: number }>>;
                columnWidthsTwips?: number[];
            }): {
                columnCount: number;
                headerRowCount: number;
                columnWidthsTwips?: number[];
                rows: Array<{ rowKind: 'header' | 'body'; cells: Array<{ text: string; colspan?: number; rowspan?: number }> }>;
            };
        };

        const model = parser.buildSemanticTableModel({
            kind: 'table',
            columnWidthsTwips: [2400, 2400, 2400],
            rows: [
                [{ text: 'Region', rowspan: 2 }, { text: 'Revenue', colspan: 2 }],
                [{ text: 'Q1' }, { text: 'Q2' }],
                [{ text: 'APAC' }, { text: '10' }, { text: '12' }]
            ]
        });

        expect(model.columnCount).toBe(3);
        expect(model.headerRowCount).toBe(2);
        expect(model.rows[0].rowKind).toBe('header');
        expect(model.rows[2].rowKind).toBe('body');
        expect(model.rows[0].cells[1].colspan).toBe(2);
    });

    it('builds a semantic block model before emitting legacy html', () => {
        const parser = DocBinaryParser as unknown as {
            buildSemanticBlockModel(
                block:
                    | { kind: 'paragraph'; text: string; style?: { bold?: boolean }; pageBreakBefore?: boolean }
                    | { kind: 'heading'; text: string; style?: { bold?: boolean }; pageBreakBefore?: boolean },
                isFirstRenderableBlock: boolean
            ): { kind: string; tag?: string; text?: string; pageBreakBefore?: boolean; style?: { bold?: boolean }; semanticRole?: string; inlineTokens?: Array<{ kind: string; text?: string }> } | undefined;
        };

        const model = parser.buildSemanticBlockModel(
            { kind: 'paragraph', text: 'Figure 1. Hello world', style: { bold: true }, pageBreakBefore: true },
            false
        );

        expect(model).toBeDefined();
        expect(model?.kind).toBe('content');
        expect(model?.tag).toBe('p');
        expect(model?.pageBreakBefore).toBe(true);
        expect(model?.text).toContain('Hello world');
        expect(model?.semanticRole).toBe('caption');
        expect(model?.inlineTokens?.[0]).toEqual({ kind: 'text', text: 'Figure 1. Hello world' });
    });

    it('builds a rendered block model from semantic content', () => {
        const parser = DocBinaryParser as unknown as {
            buildRenderedBlockModel(block: {
                kind: 'content';
                tag: 'p';
                text: string;
                pageBreakBefore?: boolean;
                style?: { bold?: boolean };
                semanticRole?: string;
                inlineTokens?: Array<{ kind: string; text?: string; field?: string }>;
            }): { kind: string; html: string; pageBreakBefore?: boolean; style?: { bold?: boolean }; semanticKind?: string; semanticTag?: string; semanticRole?: string; hasInlineField?: boolean; hasInlineBreak?: boolean } | undefined;
        };

        const model = parser.buildRenderedBlockModel({
            kind: 'content',
            tag: 'p',
            text: 'Line 1\nPAGE',
            pageBreakBefore: true,
            style: { bold: true },
            semanticRole: 'caption',
            inlineTokens: [{ kind: 'text', text: 'Line 1' }, { kind: 'line-break' }, { kind: 'field', field: 'PAGE' }]
        });

        expect(model).toBeDefined();
        expect(model?.kind).toBe('content');
        expect(model?.pageBreakBefore).toBe(true);
        expect(model?.html).toContain('<p');
        expect(model?.html).toContain('Line 1');
        expect(model?.html).toContain('<br>');
        expect(model?.semanticKind).toBe('content');
        expect(model?.semanticTag).toBe('p');
        expect(model?.semanticRole).toBe('caption');
        expect(model?.hasInlineField).toBe(true);
        expect(model?.hasInlineBreak).toBe(true);
    });

    it('marks anchored images as floating media in rendered blocks', () => {
        const parser = DocBinaryParser as unknown as {
            buildRenderedBlockModel(block: {
                kind: 'image';
                src: string;
                alt: string;
                floating?: boolean;
                floatingSide?: 'left' | 'right' | 'center';
                floatingWidthMode?: 'narrow' | 'regular' | 'wide';
                floatingPlacement?: 'edge-wrap' | 'center-block';
                floatingClearancePx?: number;
            }): { html: string; semanticRole?: string; floatingSide?: string; floatingWidthMode?: string; floatingPlacement?: string; floatingClearancePx?: number } | undefined;
        };

        const model = parser.buildRenderedBlockModel({
            kind: 'image',
            src: 'image.png',
            alt: 'Anchored image',
            floating: true,
            floatingSide: 'left',
            floatingWidthMode: 'narrow',
            floatingPlacement: 'edge-wrap',
            floatingClearancePx: 8
        });

        expect(model?.semanticRole).toBe('floating-media');
        expect(model?.floatingSide).toBe('left');
        expect(model?.floatingWidthMode).toBe('narrow');
        expect(model?.floatingPlacement).toBe('edge-wrap');
        expect(model?.floatingClearancePx).toBe(8);
        expect(model?.html).toContain('ov-doc-legacy-image-floating');
        expect(model?.html).toContain('ov-doc-legacy-image-floating-left');
        expect(model?.html).toContain('ov-doc-legacy-image-floating-narrow');
    });

    it('builds a semantic document model from legacy sections', () => {
        const parser = DocBinaryParser as unknown as {
            buildSemanticDocumentModel(sections: Array<{
                sectionIndex?: number;
                layout: {
                    pageWidthTwips: number;
                    pageHeightTwips: number;
                    marginTopTwips: number;
                    marginRightTwips: number;
                    marginBottomTwips: number;
                    marginLeftTwips: number;
                    gutterTwips: number;
                    headerTopTwips: number;
                    footerBottomTwips: number;
                    columns: number;
                    columnGapTwips: number;
                    lineBetweenColumns: boolean;
                    rtlGutter: boolean;
                    explicitColumnWidthsTwips: number[];
                    explicitColumnSpacingsTwips: number[];
                };
                headerFooter?: { oddHeaderText?: string };
                blocks: Array<{ kind: 'paragraph'; text: string }>;
            }>): { sections: Array<{ blocks: Array<{ kind: string; tag?: string; text?: string }>; headerFooter?: { oddHeaderTokens?: Array<{ kind: string; value?: string; field?: string }> } }> };
        };

        const documentModel = parser.buildSemanticDocumentModel([{
            sectionIndex: 0,
            layout: {
                pageWidthTwips: 11906,
                pageHeightTwips: 16838,
                marginTopTwips: 1440,
                marginRightTwips: 1440,
                marginBottomTwips: 1440,
                marginLeftTwips: 1440,
                gutterTwips: 0,
                headerTopTwips: 720,
                footerBottomTwips: 720,
                columns: 1,
                columnGapTwips: 720,
                lineBetweenColumns: false,
                rtlGutter: false,
                explicitColumnWidthsTwips: [],
                explicitColumnSpacingsTwips: []
            },
            headerFooter: { oddHeaderText: 'Header' },
            blocks: [{ kind: 'paragraph', text: 'Body' }]
        }]);

        expect(documentModel.sections).toHaveLength(1);
        expect(documentModel.sections[0].headerFooter?.oddHeaderTokens).toEqual([{ kind: 'text', value: 'Header' }]);
        expect(documentModel.sections[0].blocks).toHaveLength(1);
        expect(documentModel.sections[0].blocks[0].kind).toBe('content');
        expect(documentModel.sections[0].blocks[0].tag).toBe('p');
        expect(documentModel.sections[0].blocks[0].text).toContain('Body');
    });

    it('builds a rendered document model from semantic sections', () => {
        const parser = DocBinaryParser as unknown as {
            buildRenderedDocumentModel(documentModel: {
                sections: Array<{
                    sectionIndex?: number;
                    layout: {
                        pageWidthTwips: number;
                        pageHeightTwips: number;
                        marginTopTwips: number;
                        marginRightTwips: number;
                        marginBottomTwips: number;
                        marginLeftTwips: number;
                        gutterTwips: number;
                        headerTopTwips: number;
                        footerBottomTwips: number;
                        columns: number;
                        columnGapTwips: number;
                        lineBetweenColumns: boolean;
                        rtlGutter: boolean;
                        explicitColumnWidthsTwips: number[];
                        explicitColumnSpacingsTwips: number[];
                    };
                    headerFooter?: { oddHeaderTokens?: Array<{ kind: 'text' | 'field'; value?: string; field?: string }> };
                    blocks: Array<{ kind: 'content'; tag: 'p'; text: string }>;
                }>;
            }): { sections: Array<{ renderedBlocks: Array<{ kind: string; html: string }>; headerFooter?: { oddHeaderText?: string } }> };
        };

        const documentModel = parser.buildRenderedDocumentModel({
            sections: [{
                sectionIndex: 0,
                layout: {
                    pageWidthTwips: 11906,
                    pageHeightTwips: 16838,
                    marginTopTwips: 1440,
                    marginRightTwips: 1440,
                    marginBottomTwips: 1440,
                    marginLeftTwips: 1440,
                    gutterTwips: 0,
                    headerTopTwips: 720,
                    footerBottomTwips: 720,
                    columns: 1,
                    columnGapTwips: 720,
                    lineBetweenColumns: false,
                    rtlGutter: false,
                    explicitColumnWidthsTwips: [],
                    explicitColumnSpacingsTwips: []
                },
                headerFooter: { oddHeaderTokens: [{ kind: 'text', value: 'Header' }] },
                blocks: [{ kind: 'content', tag: 'p', text: 'Body' }]
            }]
        });

        expect(documentModel.sections).toHaveLength(1);
        expect(documentModel.sections[0].headerFooter?.oddHeaderText).toBe('Header');
        expect(documentModel.sections[0].renderedBlocks).toHaveLength(1);
        expect(documentModel.sections[0].renderedBlocks[0].kind).toBe('content');
        expect(documentModel.sections[0].renderedBlocks[0].html).toContain('Body');
    });

    it('tokenizes header and footer field text into semantic tokens', () => {
        const parser = DocBinaryParser as unknown as {
            tokenizeHeaderFooterText(raw: string | undefined): Array<{ kind: string; value?: string; field?: string }>;
        };

        expect(parser.tokenizeHeaderFooterText('Page PAGE of NUMPAGES')).toEqual([
            { kind: 'text', value: 'Page ' },
            { kind: 'field', field: 'PAGE' },
            { kind: 'text', value: ' of ' },
            { kind: 'field', field: 'NUMPAGES' }
        ]);
        expect(parser.tokenizeHeaderFooterText('SECTION / SECTIONS')).toEqual([
            { kind: 'field', field: 'SECTION' },
            { kind: 'text', value: ' / ' },
            { kind: 'field', field: 'SECTIONS' }
        ]);
        expect(parser.tokenizeHeaderFooterText('Page SECTIONPAGE of SECTIONPAGES')).toEqual([
            { kind: 'text', value: 'Page ' },
            { kind: 'field', field: 'SECTIONPAGE' },
            { kind: 'text', value: ' of ' },
            { kind: 'field', field: 'SECTIONPAGES' }
        ]);
    });

    it('builds semantic inline tokens from styled runs', () => {
        const parser = DocBinaryParser as unknown as {
            buildSemanticInlineTokens(
                runs: Array<{ text: string; style?: { bold?: boolean } }> | undefined,
                fallbackText: string
            ): Array<{ kind: string; text?: string; style?: { bold?: boolean }; field?: string }> | undefined;
        };

        expect(parser.buildSemanticInlineTokens(
            [{ text: 'Hello', style: { bold: true } }, { text: ' world' }],
            'fallback'
        )).toEqual([
            { kind: 'text', text: 'Hello', style: { bold: true } },
            { kind: 'text', text: ' world', style: undefined }
        ]);
        expect(parser.buildSemanticInlineTokens(undefined, 'Plain text')).toEqual([
            { kind: 'text', text: 'Plain text' }
        ]);
        expect(parser.buildSemanticInlineTokens(undefined, 'A\tPAGE\nB')).toEqual([
            { kind: 'text', text: 'A' },
            { kind: 'tab' },
            { kind: 'field', field: 'PAGE', style: undefined },
            { kind: 'line-break' },
            { kind: 'text', text: 'B' }
        ]);
        expect(parser.buildSemanticInlineTokens(undefined, 'SECTIONPAGE / SECTIONPAGES')).toEqual([
            { kind: 'field', field: 'SECTIONPAGE', style: undefined },
            { kind: 'text', text: ' / ' },
            { kind: 'field', field: 'SECTIONPAGES', style: undefined }
        ]);
    });

    it('preserves floating side metadata when styled paragraphs become renderable lines', () => {
        const parser = DocBinaryParser as unknown as {
            buildRenderableLines(
                rawText: string,
                styledParagraphs?: Array<{
                    text: string;
                    embeddedImageAnchor?: boolean;
                    floatingSide?: 'left' | 'right' | 'center';
                    floatingWidthMode?: 'narrow' | 'regular' | 'wide';
                    floatingPlacement?: 'edge-wrap' | 'center-block';
                    floatingClearancePx?: number;
                }>
            ): Array<{ embeddedImageAnchor?: boolean; floatingSide?: string; floatingWidthMode?: string; floatingPlacement?: string; floatingClearancePx?: number }>;
        };

        const lines = parser.buildRenderableLines('', [{
            text: '',
            embeddedImageAnchor: true,
            floatingSide: 'left',
            floatingWidthMode: 'wide',
            floatingPlacement: 'center-block',
            floatingClearancePx: 18
        }]);

        expect(lines).toHaveLength(1);
        expect(lines[0].embeddedImageAnchor).toBe(true);
        expect(lines[0].floatingSide).toBe('left');
        expect(lines[0].floatingWidthMode).toBe('wide');
        expect(lines[0].floatingPlacement).toBe('center-block');
        expect(lines[0].floatingClearancePx).toBe(18);
    });

    it('emits semantic metadata attributes on wrapped legacy blocks', () => {
        const parser = DocBinaryParser as unknown as {
            wrapLegacyBlock(block: {
                kind: 'content';
                html: string;
                semanticKind?: string;
                semanticTag?: string;
                semanticRole?: string;
                textLength?: number;
                hasInlineField?: boolean;
                hasInlineBreak?: boolean;
                floatingPlacement?: 'edge-wrap' | 'center-block';
                floatingClearancePx?: number;
            }): string;
        };

        const html = parser.wrapLegacyBlock({
            kind: 'content',
            html: '<p>Figure 1</p>',
            semanticKind: 'content',
            semanticTag: 'p',
            semanticRole: 'caption',
            textLength: 8,
            hasInlineField: true,
            hasInlineBreak: true,
            floatingPlacement: 'center-block',
            floatingClearancePx: 18
        });

        expect(html).toContain('data-ov-semantic-kind="content"');
        expect(html).toContain('data-ov-semantic-tag="p"');
        expect(html).toContain('data-ov-semantic-role="caption"');
        expect(html).toContain('data-ov-text-length="8"');
        expect(html).toContain('data-ov-inline-field="true"');
        expect(html).toContain('data-ov-inline-break="true"');
        expect(html).toContain('data-ov-floating-placement="center-block"');
        expect(html).toContain('data-ov-floating-clearance="18"');
    });

    it('emits block size metadata for lists tables and images', () => {
        const parser = DocBinaryParser as unknown as {
            buildRenderedBlockModel(block:
                | { kind: 'list'; ordered: boolean; items: Array<{ text: string; level: number }> }
                | { kind: 'table'; table: { columnCount: number; headerRowCount: number; rows: Array<{ rowKind: 'header' | 'body'; cells: Array<{ text: string }> }> } }
                | { kind: 'images'; images: Array<{ src: string; alt: string }> }
            ): { itemCount?: number; rowCount?: number; mediaCount?: number; estimatedHeightPx?: number; minimumFragmentHeightPx?: number } | undefined;
            wrapLegacyBlock(block: {
                kind: 'content' | 'table' | 'images';
                html: string;
                itemCount?: number;
                rowCount?: number;
                mediaCount?: number;
                estimatedHeightPx?: number;
                minimumFragmentHeightPx?: number;
            }): string;
        };

        const listModel = parser.buildRenderedBlockModel({
            kind: 'list',
            ordered: false,
            items: [{ text: 'A', level: 0 }, { text: 'B', level: 0 }]
        });
        const tableModel = parser.buildRenderedBlockModel({
            kind: 'table',
            table: {
                columnCount: 1,
                headerRowCount: 1,
                rows: [
                    { rowKind: 'header', cells: [{ text: 'H' }] },
                    { rowKind: 'body', cells: [{ text: '1' }] },
                    { rowKind: 'body', cells: [{ text: '2' }] }
                ]
            }
        });
        const imagesModel = parser.buildRenderedBlockModel({
            kind: 'images',
            images: [{ src: 'a.png', alt: 'A' }, { src: 'b.png', alt: 'B' }]
        });

        expect(listModel?.itemCount).toBe(2);
        expect(tableModel?.rowCount).toBe(3);
        expect(imagesModel?.mediaCount).toBe(2);
        expect(listModel?.estimatedHeightPx).toBeGreaterThan(0);
        expect(tableModel?.estimatedHeightPx).toBeGreaterThan(0);
        expect(imagesModel?.estimatedHeightPx).toBeGreaterThan(0);
        expect(listModel?.minimumFragmentHeightPx).toBeGreaterThan(0);
        expect(tableModel?.minimumFragmentHeightPx).toBeGreaterThan(0);
        expect(imagesModel?.minimumFragmentHeightPx).toBeGreaterThan(0);

        const wrapped = parser.wrapLegacyBlock({
            kind: 'images',
            html: '<section></section>',
            itemCount: 2,
            rowCount: 3,
            mediaCount: 2,
            estimatedHeightPx: 240,
            minimumFragmentHeightPx: 180
        });
        expect(wrapped).toContain('data-ov-item-count="2"');
        expect(wrapped).toContain('data-ov-row-count="3"');
        expect(wrapped).toContain('data-ov-media-count="2"');
        expect(wrapped).toContain('data-ov-estimated-height="240"');
        expect(wrapped).toContain('data-ov-min-fragment-height="180"');
    });

    it('marks the paragraph after a form-feed as starting on a new page', () => {
        const parser = DocBinaryParser as unknown as {
            buildStyledParagraphsFromSegments(
                segments: Array<{ text: string; cpStart: number; fcStart: number; bytesPerChar: number }>,
                styleRuns: Array<{ fcStart: number; fcEnd: number; style: Record<string, unknown> }>,
                paragraphStyleRuns: Array<{ fcStart: number; fcEnd: number; style: Record<string, unknown> }>,
                sectionBoundaries: Array<{ sectionIndex: number; cpStart: number; cpEnd: number }>
            ): Array<{ text: string; pageBreakBefore?: boolean }>;
        };

        const paragraphs = parser.buildStyledParagraphsFromSegments([
            { text: 'First paragraph\r\u000cSecond paragraph\r', cpStart: 0, fcStart: 0, bytesPerChar: 2 }
        ], [], [], []);

        expect(paragraphs).toHaveLength(2);
        expect(paragraphs[0].text).toBe('First paragraph');
        expect(paragraphs[0].pageBreakBefore).toBeFalsy();
        expect(paragraphs[1].text).toBe('Second paragraph');
        expect(paragraphs[1].pageBreakBefore).toBe(true);
    });

    it('keeps generic asset anchors as position markers without inventing page breaks', () => {
        const parser = DocBinaryParser as unknown as {
            buildStyledParagraphsFromSegments(
                segments: Array<{ text: string; cpStart: number; fcStart: number; bytesPerChar: number }>,
                styleRuns: Array<unknown>,
                paragraphStyleRuns: Array<unknown>,
                sectionBoundaries: Array<unknown>
            ): Array<{ embeddedAssetAnchor?: boolean; pageBreakBefore?: boolean }>;
        };

        const paragraphs = parser.buildStyledParagraphsFromSegments([
            { text: `Before\r\r\b\r\rAfter`, cpStart: 0, fcStart: 0, bytesPerChar: 1 }
        ], [], [], []);

        expect(paragraphs.some((paragraph) => paragraph.embeddedAssetAnchor && paragraph.pageBreakBefore)).toBe(false);
    });

    it('treats large blank 0x08 gaps as chart-preferred anchors without forcing page breaks', () => {
        const parser = DocBinaryParser as unknown as {
            buildStyledParagraphsFromSegments(
                segments: Array<{ text: string; cpStart: number; fcStart: number; bytesPerChar: number }>,
                styleRuns: Array<unknown>,
                paragraphStyleRuns: Array<unknown>,
                sectionBoundaries: Array<unknown>
            ): Array<{ embeddedAssetAnchor?: boolean; embeddedAssetPreference?: 'chart' | 'image'; pageBreakBefore?: boolean; text?: string }>;
        };

        const paragraphs = parser.buildStyledParagraphsFromSegments([
            { text: `Before\r\b\r\r\r\r\r\r\r\r\rAfter`, cpStart: 0, fcStart: 0, bytesPerChar: 1 }
        ], [], [], []);

        expect(paragraphs.some((paragraph) => paragraph.embeddedAssetAnchor && paragraph.embeddedAssetPreference === 'chart')).toBe(true);
        expect(paragraphs.some((paragraph) => paragraph.embeddedAssetAnchor && paragraph.embeddedAssetPreference === 'chart' && paragraph.pageBreakBefore)).toBe(false);
    });

    it('does not automatically promote the first paragraph to a heading without strong title styling', () => {
        const parser = DocBinaryParser as unknown as {
            renderHtml(
                rawText: string,
                images: Array<{ src: string; alt: string }>,
                styledParagraphs?: Array<{
                    text: string;
                    style?: { bold?: boolean; textAlign?: 'left' | 'center' | 'right' | 'justify'; fontSizeHalfPoints?: number };
                }>
            ): string;
        };

        const html = parser.renderHtml('', [], [
            { text: 'Intro paragraph', style: { bold: false, textAlign: 'left', fontSizeHalfPoints: 22 } },
            { text: 'This is the document body and should remain a paragraph.' }
        ]);

        expect(html).not.toContain('<h1');
        expect(html).toContain('Intro paragraph');
    });

    it('promotes lead paragraphs with keep-with-next cues into bold larger content', () => {
        const parser = DocBinaryParser as unknown as {
            buildDocumentBlocks(
                rawText: string,
                images: Array<{ src: string; alt: string }>,
                styledParagraphs?: Array<{
                    text: string;
                    style?: { keepWithNext?: boolean; firstLineIndentTwips?: number; bold?: boolean; fontSizeHalfPoints?: number };
                    runs?: Array<{ text: string; style?: { bold?: boolean; fontSizeHalfPoints?: number } }>;
                }>
            ): Array<{ kind: string; text?: string; style?: { bold?: boolean; fontSizeHalfPoints?: number }; runs?: Array<{ text: string; style?: { bold?: boolean; fontSizeHalfPoints?: number } }> }>;
        };

        const blocks = parser.buildDocumentBlocks('', [], [
            { text: 'Title' },
            {
                text: 'Lead paragraph',
                style: { keepWithNext: true, firstLineIndentTwips: 360 },
                runs: [{ text: 'Lead paragraph' }]
            },
            { text: 'This is a long body paragraph that should keep the previous line as a promoted lead paragraph rather than flattening it into plain body text.' }
        ]);

        expect(blocks[1]).toEqual(expect.objectContaining({
            kind: 'paragraph',
            text: 'Lead paragraph',
            style: expect.objectContaining({ bold: true, fontSizeHalfPoints: 36 })
        }));
        expect(blocks[1].runs?.[0].style).toEqual(expect.objectContaining({ bold: true, fontSizeHalfPoints: 36 }));
    });

    it('promotes sparse section lead paragraphs between long body paragraphs to headings', () => {
        const parser = DocBinaryParser as unknown as {
            buildBlocks(
                lines: Array<{ text: string; style?: { fontSizeHalfPoints?: number } }>
            ): Array<{ kind: string; text?: string; style?: { bold?: boolean; fontSizeHalfPoints?: number } }>;
        };

        const blocks = parser.buildBlocks([
            { text: 'This is a long body paragraph that provides enough surrounding context for the next short line to be treated as a section lead paragraph in the legacy importer.' },
            { text: 'Section lead', style: {} },
            { text: 'This is another long body paragraph that follows the short lead and should cause that line to be promoted into a heading-style block.' }
        ]);

        const promoted = blocks.find((block) => block.text === 'Section lead');
        expect(promoted).toEqual(expect.objectContaining({
            kind: 'heading',
            text: 'Section lead',
            style: expect.objectContaining({ bold: true, fontSizeHalfPoints: 32 })
        }));
    });

    it('anchors extracted images inline when picture markers are present in legacy text', () => {
        const parser = DocBinaryParser as unknown as {
            buildDocumentBlocks(
                rawText: string,
                images: Array<{ src: string; alt: string }>,
                styledParagraphs?: Array<{
                    text: string;
                    embeddedImageAnchor?: boolean;
                    pageBreakBefore?: boolean;
                    sectionIndex?: number;
                }>
            ): Array<unknown>;
            composeDocumentBlocks(
                baseBlocks: Array<unknown>,
                packageCharts: Array<unknown>,
                workbookTables: Array<unknown>,
                images?: Array<{ src: string; alt: string }>
            ): Array<unknown>;
            renderBlocks(blocks: Array<unknown>): string;
        };

        const images = [{ src: 'data:image/png;base64,AAAA', alt: 'Picture 1' }];
        const baseBlocks = parser.buildDocumentBlocks('', images, [
            { text: 'Before image' },
            { text: '', embeddedImageAnchor: true },
            { text: 'After image' }
        ]);
        const composed = parser.composeDocumentBlocks(baseBlocks, [], [], images);
        const html = parser.renderBlocks(composed);

        expect(html).toContain('ov-doc-legacy-image-inline');
        expect(html).toContain('Picture 1');
        expect(html).not.toContain('<h2>Images</h2>');
    });

    it('preserves tabs and repeated spaces in inline legacy runs', () => {
        const parser = DocBinaryParser as unknown as {
            renderInlineStyledText(
                runs: Array<{ text: string; style?: { bold?: boolean } }> | undefined,
                fallbackText: string
            ): string;
        };

        const rendered = parser.renderInlineStyledText(
            [{ text: 'A\t  B', style: { bold: true } }],
            'fallback'
        );

        expect(rendered).toContain('A\t  B');
    });

    it('does not infer plain tab-delimited flowing text as a table block', () => {
        const parser = DocBinaryParser as unknown as {
            buildDocumentBlocks(
                rawText: string,
                images: Array<{ src: string; alt: string }>,
                styledParagraphs?: Array<{ text: string }>
            ): Array<{ kind: string }>;
        };

        const blocks = parser.buildDocumentBlocks('', [], [
            { text: 'Lorem ipsum dolor sit amet\t1' },
            { text: 'Consectetur adipiscing elit\t2' },
            { text: 'Sed do eiusmod tempor\t3' }
        ]);

        expect(blocks.every((block) => block.kind !== 'table')).toBe(true);
    });

    it('does not render in-table paragraphs as a table without row terminator metadata', () => {
        const parser = DocBinaryParser as unknown as {
            buildDocumentBlocks(
                rawText: string,
                images: Array<{ src: string; alt: string }>,
                styledParagraphs?: Array<{
                    text: string;
                    inTable?: boolean;
                    tableColumnCount?: number;
                    tableColumnWidthsTwips?: number[];
                }>
            ): Array<{ kind: string }>;
        };

        const blocks = parser.buildDocumentBlocks('', [], [
            { text: 'Lorem ipsum dolor sit amet\t1', inTable: true, tableColumnCount: 2, tableColumnWidthsTwips: [7200, 1440] },
            { text: 'Vivamus dapibus sodales ex\t2', inTable: true, tableColumnCount: 2, tableColumnWidthsTwips: [7200, 1440] },
            { text: 'Mauris diam felis\t3', inTable: true, tableColumnCount: 2, tableColumnWidthsTwips: [7200, 1440] }
        ]);

        expect(blocks.every((block) => block.kind !== 'table')).toBe(true);
    });

    it('assigns section indexes from binary section boundaries', () => {
        const parser = DocBinaryParser as unknown as {
            buildStyledParagraphsFromSegments(
                segments: Array<{ text: string; cpStart: number; fcStart: number; bytesPerChar: number }>,
                styleRuns: Array<{ fcStart: number; fcEnd: number; style: Record<string, unknown> }>,
                paragraphStyleRuns: Array<{ fcStart: number; fcEnd: number; style: Record<string, unknown> }>,
                sectionBoundaries: Array<{ sectionIndex: number; cpStart: number; cpEnd: number }>
            ): Array<{ text: string; sectionIndex?: number }>;
        };

        const paragraphs = parser.buildStyledParagraphsFromSegments([
            { text: 'Section one\rSection two\r', cpStart: 0, fcStart: 0, bytesPerChar: 2 }
        ], [], [], [
            { sectionIndex: 0, cpStart: 0, cpEnd: 12 },
            { sectionIndex: 1, cpStart: 12, cpEnd: 30 }
        ]);

        expect(paragraphs).toHaveLength(2);
        expect(paragraphs[0].sectionIndex).toBe(0);
        expect(paragraphs[1].sectionIndex).toBe(1);
    });

    it('parses section property exceptions into explicit page metrics', () => {
        const parser = DocBinaryParser as unknown as {
            parseSectionGrpprl(buffer: Buffer): {
                pageWidthTwips: number;
                pageHeightTwips: number;
                marginTopTwips: number;
                marginRightTwips: number;
                marginBottomTwips: number;
                marginLeftTwips: number;
            } | undefined;
        };

        const grpprl = Buffer.alloc(23);
        let offset = 0;
        grpprl.writeUInt16LE(0xB01F, offset); offset += 2; grpprl.writeUInt16LE(11906, offset); offset += 2;
        grpprl.writeUInt16LE(0xB020, offset); offset += 2; grpprl.writeUInt16LE(16838, offset); offset += 2;
        grpprl.writeUInt16LE(0xB021, offset); offset += 2; grpprl.writeUInt16LE(1440, offset); offset += 2;
        grpprl.writeUInt16LE(0xB022, offset); offset += 2; grpprl.writeUInt16LE(1800, offset); offset += 2;
        grpprl.writeUInt16LE(0x9023, offset); offset += 2; grpprl.writeInt16LE(720, offset); offset += 2;
        grpprl.writeUInt16LE(0x301D, offset); offset += 2; grpprl.writeUInt8(1, offset);

        const layout = parser.parseSectionGrpprl(grpprl);

        expect(layout).toBeDefined();
        expect(layout?.pageWidthTwips).toBe(16838);
        expect(layout?.pageHeightTwips).toBe(11906);
        expect(layout?.marginLeftTwips).toBe(1440);
        expect(layout?.marginRightTwips).toBe(1800);
        expect(layout?.marginTopTwips).toBe(720);
    });

    it('parses gutter header footer and columns from section property exceptions', () => {
        const parser = DocBinaryParser as unknown as {
            parseSectionGrpprl(buffer: Buffer): {
                gutterTwips: number;
                headerTopTwips: number;
                footerBottomTwips: number;
                columns: number;
                columnGapTwips: number;
                lineBetweenColumns: boolean;
                rtlGutter: boolean;
            } | undefined;
        };

        const grpprl = Buffer.alloc(29);
        let offset = 0;
        grpprl.writeUInt16LE(0x500B, offset); offset += 2; grpprl.writeUInt16LE(2, offset); offset += 2;
        grpprl.writeUInt16LE(0x900C, offset); offset += 2; grpprl.writeUInt16LE(540, offset); offset += 2;
        grpprl.writeUInt16LE(0xB017, offset); offset += 2; grpprl.writeUInt16LE(900, offset); offset += 2;
        grpprl.writeUInt16LE(0xB018, offset); offset += 2; grpprl.writeUInt16LE(1080, offset); offset += 2;
        grpprl.writeUInt16LE(0xB025, offset); offset += 2; grpprl.writeUInt16LE(720, offset); offset += 2;
        grpprl.writeUInt16LE(0x3019, offset); offset += 2; grpprl.writeUInt8(1, offset); offset += 1;
        grpprl.writeUInt16LE(0x322A, offset); offset += 2; grpprl.writeUInt8(1, offset);

        const layout = parser.parseSectionGrpprl(grpprl);

        expect(layout).toBeDefined();
        expect(layout?.columns).toBe(2);
        expect(layout?.columnGapTwips).toBe(540);
        expect(layout?.headerTopTwips).toBe(900);
        expect(layout?.footerBottomTwips).toBe(1080);
        expect(layout?.gutterTwips).toBe(720);
        expect(layout?.lineBetweenColumns).toBe(true);
        expect(layout?.rtlGutter).toBe(true);
    });

    it('parses explicit non-even column widths and spacings from section sprms', () => {
        const parser = DocBinaryParser as unknown as {
            parseSectionGrpprl(buffer: Buffer): {
                explicitColumnWidthsTwips: number[];
                explicitColumnSpacingsTwips: number[];
                columns: number;
            } | undefined;
        };

        const grpprl = Buffer.alloc(19);
        let offset = 0;
        grpprl.writeUInt16LE(0x500B, offset); offset += 2; grpprl.writeUInt16LE(2, offset); offset += 2;
        grpprl.writeUInt16LE(0xF203, offset); offset += 2; grpprl.writeUInt8(0, offset); offset += 1; grpprl.writeUInt16LE(2200, offset); offset += 2;
        grpprl.writeUInt16LE(0xF203, offset); offset += 2; grpprl.writeUInt8(1, offset); offset += 1; grpprl.writeUInt16LE(3400, offset); offset += 2;
        grpprl.writeUInt16LE(0xF204, offset); offset += 2; grpprl.writeUInt8(0, offset); offset += 1; grpprl.writeUInt16LE(540, offset);

        const layout = parser.parseSectionGrpprl(grpprl);

        expect(layout).toBeDefined();
        expect(layout?.columns).toBe(2);
        expect(layout?.explicitColumnWidthsTwips).toEqual([2200, 3400]);
        expect(layout?.explicitColumnSpacingsTwips).toEqual([540]);
    });

    it('emits dynamic page metrics for wide legacy tables', () => {
        const parser = DocBinaryParser as unknown as {
            renderHtml(
                rawText: string,
                images: Array<{ src: string; alt: string }>,
                styledParagraphs?: Array<{
                    text: string;
                    inTable?: boolean;
                    isTableTerminator?: boolean;
                    tableColumnCount?: number;
                    tableColumnWidthsTwips?: number[];
                }>
            ): string;
        };

        const html = parser.renderHtml('', [], [
            { text: 'Wide 1', inTable: true, tableColumnCount: 2, tableColumnWidthsTwips: [8000, 4200] },
            { text: 'Wide 2', inTable: true, tableColumnCount: 2, tableColumnWidthsTwips: [8000, 4200] },
            { text: '', inTable: true, isTableTerminator: true, tableColumnCount: 2, tableColumnWidthsTwips: [8000, 4200] }
        ]);

        expect(html).toContain('--ov-page-width-mm:297.00mm');
        expect(html).toContain('--ov-page-height-mm:210.01mm');
    });

    it('does not split a legacy section only because a block starts on a new page', () => {
        const parser = DocBinaryParser as unknown as {
            buildLegacySections(blocks: Array<
                | { kind: 'paragraph'; text: string; pageBreakBefore?: boolean; sectionIndex?: number }
                | { kind: 'table'; rows: Array<Array<{ text: string }>>; columnWidthsTwips?: number[]; pageBreakBefore?: boolean; sectionIndex?: number }
            >): Array<{ sectionIndex?: number; blocks: Array<unknown> }>;
        };

        const sections = parser.buildLegacySections([
            { kind: 'paragraph', text: 'Intro', sectionIndex: 0 },
            { kind: 'paragraph', text: 'Starts on a new page', pageBreakBefore: true, sectionIndex: 0 },
            { kind: 'table', rows: [[{ text: 'A' }]], pageBreakBefore: false, sectionIndex: 0 }
        ]);

        expect(sections).toHaveLength(1);
        expect(sections[0].sectionIndex).toBe(0);
        expect(sections[0].blocks).toHaveLength(3);
    });

    it('splits legacy layout into sections with independent page metrics', () => {
        const parser = DocBinaryParser as unknown as {
            renderBlocks(blocks: Array<
                | { kind: 'paragraph'; text: string; pageBreakBefore?: boolean; sectionIndex?: number }
                | { kind: 'table'; rows: Array<Array<{ text: string }>>; columnWidthsTwips?: number[]; pageBreakBefore?: boolean; sectionIndex?: number }
            >): string;
            buildLegacySections(blocks: Array<
                | { kind: 'paragraph'; text: string; pageBreakBefore?: boolean; sectionIndex?: number }
                | { kind: 'table'; rows: Array<Array<{ text: string }>>; columnWidthsTwips?: number[]; pageBreakBefore?: boolean; sectionIndex?: number }
            >): Array<{ layout: { pageWidthTwips: number; pageHeightTwips: number; marginTopTwips: number; marginRightTwips: number; marginBottomTwips: number; marginLeftTwips: number }; blocks: Array<unknown> }>;
            wrapLegacyHtml(sections: Array<{ layout: { pageWidthTwips: number; pageHeightTwips: number; marginTopTwips: number; marginRightTwips: number; marginBottomTwips: number; marginLeftTwips: number }; blocks: Array<unknown> }>): string;
        };

        const blocks = [
            { kind: 'paragraph' as const, text: 'Portrait intro', sectionIndex: 0 },
            { kind: 'table' as const, rows: [[{ text: 'A' }]], columnWidthsTwips: [2200], pageBreakBefore: true, sectionIndex: 0 },
            { kind: 'table' as const, rows: [[{ text: 'B' }]], columnWidthsTwips: [8000, 4200], sectionIndex: 1 }
        ];

        const sections = parser.buildLegacySections(blocks);
        const html = parser.wrapLegacyHtml(sections);

        expect(sections).toHaveLength(2);
        expect(sections[0].layout.pageWidthTwips).toBe(11906);
        expect(sections[1].layout.pageWidthTwips).toBe(16838);
        expect(html).toContain('ov-doc-legacy-section');
        expect(html).toContain('--ov-page-width-mm:210.01mm');
        expect(html).toContain('--ov-page-width-mm:297.00mm');
        expect(html).toContain('data-ov-gutter-side="left"');
    });

    it('extracts section header and footer stories from the header subdocument', () => {
        const parser = DocBinaryParser as unknown as {
            extractHeaderFooterBySection(
                segments: Array<{ text: string; cpStart: number; fcStart: number; bytesPerChar: number }>,
                tableStream: Buffer,
                fib: { ccpText: number; ccpFtn: number; ccpHdd: number; fcPlcfHdd: number; lcbPlcfHdd: number }
            ): Map<number, {
                sectionNumber?: number;
                sectionCount?: number;
                oddHeaderText?: string;
                oddFooterText?: string;
                firstHeaderText?: string;
                firstFooterText?: string;
            }>;
        };

        const tableStream = Buffer.alloc(56);
        const cps = [0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 6, 9, 12, 12];
        cps.forEach((cp, index) => tableStream.writeUInt32LE(cp, index * 4));

        const segments = [
            { text: 'OH\rOF\rFH\rFF\r', cpStart: 100, fcStart: 0, bytesPerChar: 2 }
        ];

        const stories = parser.extractHeaderFooterBySection(segments, tableStream, {
            ccpText: 100,
            ccpFtn: 0,
            ccpHdd: 36,
            fcPlcfHdd: 0,
            lcbPlcfHdd: 56
        });

        expect(stories.get(0)?.oddHeaderText).toBe('OH');
        expect(stories.get(0)?.oddFooterText).toBe('OF');
        expect(stories.get(0)?.firstHeaderText).toBe('FH');
        expect(stories.get(0)?.firstFooterText).toBe('FF');
        expect(stories.get(0)?.sectionNumber).toBe(1);
        expect(stories.get(0)?.sectionCount).toBe(1);
    });

    it('embeds section header footer metadata in rendered legacy html', () => {
        const parser = DocBinaryParser as unknown as {
            wrapLegacyHtml(sections: Array<{
                layout: {
                    pageWidthTwips: number;
                    pageHeightTwips: number;
                    marginTopTwips: number;
                    marginRightTwips: number;
                    marginBottomTwips: number;
                    marginLeftTwips: number;
                    gutterTwips: number;
                    headerTopTwips: number;
                    footerBottomTwips: number;
                    columns: number;
                    columnGapTwips: number;
                    lineBetweenColumns: boolean;
                    rtlGutter: boolean;
                    explicitColumnWidthsTwips: number[];
                    explicitColumnSpacingsTwips: number[];
                };
                blocks: Array<{ kind: 'paragraph'; text: string }>;
                headerFooter?: { sectionNumber?: number; sectionCount?: number; oddHeaderText?: string; oddFooterText?: string };
            }>): string;
        };

        const html = parser.wrapLegacyHtml([{
            layout: {
                pageWidthTwips: 11906,
                pageHeightTwips: 16838,
                marginTopTwips: 1440,
                marginRightTwips: 1440,
                marginBottomTwips: 1440,
                marginLeftTwips: 1440,
                gutterTwips: 0,
                headerTopTwips: 720,
                footerBottomTwips: 720,
                columns: 1,
                columnGapTwips: 720,
                lineBetweenColumns: false,
                rtlGutter: false,
                explicitColumnWidthsTwips: [2200, 3400],
                explicitColumnSpacingsTwips: [540]
            },
            blocks: [{ kind: 'paragraph', text: 'Body' }],
            headerFooter: { sectionNumber: 2, sectionCount: 3, oddHeaderText: 'PAGE / NUMPAGES', oddFooterText: 'Footer line' }
        }]);

        expect(html).toContain('ov-doc-legacy-section-meta');
        expect(html).toContain('PAGE / NUMPAGES');
        expect(html).toContain('Footer line');
        expect(html).toContain('sectionNumber');
        expect(html).toContain('data-ov-custom-columns="true"');
        expect(html).toContain('data-ov-column-widths=');
    });

    it('parses ODF chart package content into an embedded chart block', () => {
        const parser = DocBinaryParser as unknown as {
            parseOdfChartContent(contentXml: string): {
                title: string;
                rows: string[][];
                showTable: boolean;
                chart?: {
                    type: 'bar' | 'line';
                    categories: string[];
                    series: Array<{ name: string; values: number[]; color: string }>;
                };
            } | undefined;
        };

        const parsed = parser.parseOdfChartContent(`
            <office:document-content>
                <chart:chart>
                    <chart:plot-area>
                        <chart:series chart:class="chart:bar" />
                    </chart:plot-area>
                </chart:chart>
                <table:table-row>
                    <table:table-cell><text:p/></table:table-cell>
                    <table:table-cell><text:p>Column 1</text:p></table:table-cell>
                    <table:table-cell><text:p>Column 2</text:p></table:table-cell>
                    <table:table-cell><text:p>Column 3</text:p></table:table-cell>
                </table:table-row>
                <table:table-row>
                    <table:table-cell><text:p>Row 1</text:p></table:table-cell>
                    <table:table-cell><text:p>9.1</text:p></table:table-cell>
                    <table:table-cell><text:p>3.2</text:p></table:table-cell>
                    <table:table-cell><text:p>4.54</text:p></table:table-cell>
                </table:table-row>
                <table:table-row>
                    <table:table-cell><text:p>Row 2</text:p></table:table-cell>
                    <table:table-cell><text:p>2.4</text:p></table:table-cell>
                    <table:table-cell><text:p>8.8</text:p></table:table-cell>
                    <table:table-cell><text:p>9.65</text:p></table:table-cell>
                </table:table-row>
            </office:document-content>
        `);

        expect(parsed).toBeDefined();
        expect(parsed?.showTable).toBe(false);
        expect(parsed?.title).toBeUndefined();
        expect(parsed?.rows).toEqual([
            ['', 'Column 1', 'Column 2', 'Column 3'],
            ['Row 1', '9.1', '3.2', '4.54'],
            ['Row 2', '2.4', '8.8', '9.65']
        ]);
        expect(parsed?.chart?.type).toBe('bar');
        expect(parsed?.chart?.categories).toEqual(['Row 1', 'Row 2']);
        expect(parsed?.chart?.series.map((series) => series.name)).toEqual(['Column 1', 'Column 2', 'Column 3']);
    });

    it('appends package charts after the main body when no explicit chart anchor is present', () => {
        const parser = DocBinaryParser as unknown as {
            composeDocumentBlocks(
                baseBlocks: Array<{ kind: string; rows?: string[][]; text?: string }>,
                packageCharts: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>,
                workbookTables: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>
            ): Array<{ kind: string }>;
        };

        const combined = parser.composeDocumentBlocks(
            [
                { kind: 'paragraph', text: 'This is a long body paragraph that should remain before the chart because it is not a compact table lead-in block. It intentionally contains enough explanatory filler text to exceed the compact-heading threshold used by the parser.' },
                { kind: 'paragraph', text: 'Section lead-in' },
                { kind: 'table', rows: [['header'], ['value']] },
                { kind: 'paragraph', text: 'after' }
            ],
            [
                {
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false,
                    chart: {
                        type: 'bar',
                        categories: ['Row 1'],
                        series: [{ name: 'Column 1', values: [9.1], color: '#004586' }]
                    }
                }
            ],
            []
        );

        expect(combined.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'table', 'embedded-sheet', 'paragraph']);
    });

    it('replaces embedded chart anchor blocks with parsed package charts', () => {
        const parser = DocBinaryParser as unknown as {
            composeDocumentBlocks(
                baseBlocks: Array<{ kind: string; rows?: string[][]; text?: string; objectClass?: string }>,
                packageCharts: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>,
                workbookTables: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>
            ): Array<{ kind: string }>;
            readFieldInstruction(text: string, startIndex: number): { fieldCode: string; fieldEndIndex: number } | undefined;
            parseEmbeddedChartObjectClass(fieldCode: string): string | undefined;
        };

        const field = parser.readFieldInstruction('\u0013 EMBED LibreOffice.ChartDocument.1\u0000 \u0014\u0001\u0015', 0);

        expect(field).toBeDefined();
        expect(field?.fieldCode).toBe('EMBED LibreOffice.ChartDocument.1');
        expect(parser.parseEmbeddedChartObjectClass(field?.fieldCode || '')).toBe('LibreOffice.ChartDocument.1');

        const combined = parser.composeDocumentBlocks(
            [
                { kind: 'paragraph', text: 'before' },
                { kind: 'embedded-chart-anchor', objectClass: 'LibreOffice.ChartDocument.1' },
                { kind: 'paragraph', text: 'after' }
            ],
            [
                {
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false,
                    chart: {
                        type: 'bar',
                        categories: ['Row 1'],
                        series: [{ name: 'Column 1', values: [9.1], color: '#004586' }]
                    }
                }
            ],
            []
        );

        expect(combined.map((block) => block.kind)).toEqual(['paragraph', 'embedded-sheet', 'paragraph']);
    });

    it('treats plain EMBED chart paragraphs as anchor fallbacks when field controls are missing', () => {
        const parser = DocBinaryParser as unknown as {
            buildDocumentBlocks(
                rawText: string,
                images: Array<{ src: string; alt: string }>,
                styledParagraphs?: Array<{
                    text: string;
                    pageBreakBefore?: boolean;
                    sectionIndex?: number;
                }>
            ): Array<{ kind: string; objectClass?: string }>;
            composeDocumentBlocks(
                baseBlocks: Array<{ kind: string; objectClass?: string }>,
                packageCharts: Array<{
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>,
                workbookTables: Array<unknown>
            ): Array<{ kind: string }>;
        };

        const baseBlocks = parser.buildDocumentBlocks('', [], [
            { text: 'This paragraph appears before the embedded chart anchor and should remain in the rendered flow.' },
            { text: 'EMBED LibreOffice.ChartDocument.1' },
            { text: 'This paragraph appears after the embedded chart anchor and should stay after the chart block.' }
        ]);

        expect(baseBlocks.map((block) => block.kind)).toEqual(['paragraph', 'embedded-chart-anchor', 'paragraph']);
        expect(baseBlocks[1]?.objectClass).toBe('LibreOffice.ChartDocument.1');

        const combined = parser.composeDocumentBlocks(
            baseBlocks,
            [
                {
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false,
                    chart: {
                        type: 'bar',
                        categories: ['Row 1'],
                        series: [{ name: 'Column 1', values: [9.1], color: '#004586' }]
                    }
                }
            ],
            []
        );

        expect(combined.map((block) => block.kind)).toEqual(['paragraph', 'embedded-sheet', 'paragraph']);
    });

    it('preserves section metadata when embedded chart anchors are replaced', () => {
        const parser = DocBinaryParser as unknown as {
            composeDocumentBlocks(
                baseBlocks: Array<{
                    kind: string;
                    rows?: string[][];
                    text?: string;
                    objectClass?: string;
                    sectionIndex?: number;
                    sectionLayout?: { pageWidthTwips: number };
                }>,
                packageCharts: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                }>,
                workbookTables: Array<unknown>
            ): Array<{ kind: string; sectionIndex?: number; sectionLayout?: { pageWidthTwips: number } }>;
            buildLegacySections(blocks: Array<{ kind: string; sectionIndex?: number; sectionLayout?: { pageWidthTwips: number } }>): Array<{ sectionIndex?: number; blocks: Array<unknown> }>;
        };

        const combined = parser.composeDocumentBlocks(
            [
                { kind: 'paragraph', text: 'before', sectionIndex: 0, sectionLayout: { pageWidthTwips: 11906 } },
                { kind: 'embedded-chart-anchor', objectClass: 'LibreOffice.ChartDocument.1', sectionIndex: 0, sectionLayout: { pageWidthTwips: 11906 } },
                { kind: 'paragraph', text: 'after', sectionIndex: 1, sectionLayout: { pageWidthTwips: 16838 } }
            ],
            [
                {
                    title: 'Embedded chart',
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false
                }
            ],
            []
        );

        expect(combined[1]).toMatchObject({
            kind: 'embedded-sheet',
            sectionIndex: 0,
            sectionLayout: { pageWidthTwips: 11906 }
        });

        const sections = parser.buildLegacySections(combined);
        expect(sections).toHaveLength(2);
        expect(sections[0].sectionIndex).toBe(0);
        expect(sections[1].sectionIndex).toBe(1);
    });

    it('keeps non-anchored extracted images visible when no reliable anchor is found', () => {
        const parser = DocBinaryParser as unknown as {
            buildDocumentBlocks(
                rawText: string,
                images: Array<{ src: string; alt: string }>,
                styledParagraphs?: Array<{ text: string }>
            ): Array<{ kind: string; text?: string }>;
            composeDocumentBlocks(
                baseBlocks: Array<{ kind: string; text?: string }>,
                packageCharts: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>,
                workbookTables: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                }>,
                images?: Array<{ src: string; alt: string }>
            ): Array<{ kind: string }>;
        };

        const images = [{ src: 'data:image/png;base64,AAAA', alt: 'Picture 1' }];
        const baseBlocks = parser.buildDocumentBlocks('', images, [
            { text: 'Before asset blocks' }
        ]);
        const combined = parser.composeDocumentBlocks(
            baseBlocks,
            [
                {
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false,
                    chart: {
                        type: 'bar',
                        categories: ['Row 1'],
                        series: [{ name: 'Column 1', values: [9.1], color: '#004586' }]
                    }
                }
            ],
            [],
            images
        );

        expect(combined.map((block) => block.kind)).toEqual(['paragraph', 'embedded-sheet', 'image']);
    });

    it('places fallback chart and image assets after matching caption paragraphs', () => {
        const parser = DocBinaryParser as unknown as {
            composeDocumentBlocks(
                baseBlocks: Array<{ kind: string; text?: string }>,
                packageCharts: Array<{
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>,
                workbookTables: Array<unknown>,
                images?: Array<{ src: string; alt: string }>
            ): Array<{ kind: string }>;
        };

        const combined = parser.composeDocumentBlocks(
            [
                { kind: 'paragraph', text: 'Figure 1. Architecture overview' },
                { kind: 'paragraph', text: 'Body paragraph before chart caption.' },
                { kind: 'paragraph', text: 'Chart 1. Sales summary' },
                { kind: 'paragraph', text: 'Body paragraph after chart caption.' }
            ],
            [
                {
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false,
                    chart: {
                        type: 'bar',
                        categories: ['Row 1'],
                        series: [{ name: 'Column 1', values: [9.1], color: '#004586' }]
                    }
                }
            ],
            [],
            [{ src: 'data:image/png;base64,AAAA', alt: 'Picture 1' }]
        );

        expect(combined.map((block) => block.kind)).toEqual([
            'paragraph',
            'image',
            'paragraph',
            'paragraph',
            'embedded-sheet',
            'paragraph'
        ]);
    });

    it('fills generic asset anchors using their preferred asset type', () => {
        const parser = DocBinaryParser as unknown as {
            composeDocumentBlocks(
                baseBlocks: Array<{ kind: string; pageBreakBefore?: boolean; sectionIndex?: number; assetPreference?: 'chart' | 'image' }>,
                packageCharts: Array<{
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>,
                workbookTables: Array<unknown>,
                images?: Array<{ src: string; alt: string }>
            ): Array<{ kind: string }>;
        };

        const combined = parser.composeDocumentBlocks(
            [
                { kind: 'paragraph' },
                { kind: 'embedded-asset-anchor', assetPreference: 'chart' },
                { kind: 'paragraph' },
                { kind: 'embedded-asset-anchor', assetPreference: 'image' },
                { kind: 'embedded-chart-anchor' }
            ],
            [
                {
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false,
                    chart: {
                        type: 'bar',
                        categories: ['Row 1'],
                        series: [{ name: 'Column 1', values: [9.1], color: '#004586' }]
                    }
                }
            ],
            [],
            [{ src: 'data:image/png;base64,AAAA', alt: 'Picture 1' }]
        );

        expect(combined.map((block) => block.kind)).toEqual([
            'paragraph',
            'embedded-sheet',
            'paragraph',
            'image',
        ]);
    });

    it('preserves page breaks when asset and chart anchors are replaced', () => {
        const parser = DocBinaryParser as unknown as {
            composeDocumentBlocks(
                baseBlocks: Array<{ kind: string; pageBreakBefore?: boolean }>,
                packageCharts: Array<{
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>,
                workbookTables: Array<unknown>,
                images?: Array<{ src: string; alt: string }>
            ): Array<{ kind: string; pageBreakBefore?: boolean }>;
        };

        const combined = parser.composeDocumentBlocks(
            [
                { kind: 'embedded-asset-anchor', pageBreakBefore: true },
                { kind: 'embedded-chart-anchor', pageBreakBefore: true }
            ],
            [
                {
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false,
                    chart: {
                        type: 'bar',
                        categories: ['Row 1'],
                        series: [{ name: 'Column 1', values: [9.1], color: '#004586' }]
                    }
                }
            ],
            [],
            [{ src: 'data:image/png;base64,AAAA', alt: 'Picture 1' }]
        );

        expect(combined).toEqual([
            expect.objectContaining({ kind: 'image', pageBreakBefore: true }),
            expect.objectContaining({ kind: 'embedded-sheet', pageBreakBefore: true })
        ]);
    });

    it('keeps an explicit trailing chart anchor in document order', () => {
        const parser = DocBinaryParser as unknown as {
            composeDocumentBlocks(
                baseBlocks: Array<{ kind: string; text?: string; objectClass?: string; rows?: string[][] }>,
                packageCharts: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>,
                workbookTables: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                }>,
                images?: Array<{ src: string; alt: string }>
            ): Array<{ kind: string }>;
        };

        const combined = parser.composeDocumentBlocks(
            [
                { kind: 'paragraph', text: 'before' },
                { kind: 'table', rows: [['header'], ['value']] },
                { kind: 'paragraph', text: 'after table text' },
                { kind: 'embedded-chart-anchor', objectClass: 'LibreOffice.ChartDocument.1' }
            ],
            [
                {
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false,
                    chart: {
                        type: 'bar',
                        categories: ['Row 1'],
                        series: [{ name: 'Column 1', values: [9.1], color: '#004586' }]
                    }
                }
            ],
            []
        );

        expect(combined.map((block) => block.kind)).toEqual(['paragraph', 'table', 'paragraph', 'embedded-sheet']);
    });

    it('keeps a trailing chart near its anchor when it is far from the last table', () => {
        const parser = DocBinaryParser as unknown as {
            composeDocumentBlocks(
                baseBlocks: Array<{ kind: string; text?: string; objectClass?: string; rows?: string[][] }>,
                packageCharts: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                    chart?: {
                        type: 'bar' | 'line';
                        categories: string[];
                        series: Array<{ name: string; values: number[]; color: string }>;
                    };
                }>,
                workbookTables: Array<{
                    title?: string;
                    rows: string[][];
                    showTable: boolean;
                }>,
                images?: Array<{ src: string; alt: string }>
            ): Array<{ kind: string }>;
        };

        const combined = parser.composeDocumentBlocks(
            [
                { kind: 'paragraph', text: 'before' },
                { kind: 'table', rows: [['header'], ['value']] },
                { kind: 'paragraph', text: 'middle 1' },
                { kind: 'paragraph', text: 'middle 2' },
                { kind: 'paragraph', text: 'middle 3' },
                { kind: 'embedded-chart-anchor', objectClass: 'LibreOffice.ChartDocument.1' }
            ],
            [
                {
                    rows: [['', 'Column 1'], ['Row 1', '9.1']],
                    showTable: false,
                    chart: {
                        type: 'bar',
                        categories: ['Row 1'],
                        series: [{ name: 'Column 1', values: [9.1], color: '#004586' }]
                    }
                }
            ],
            []
        );

        expect(combined.map((block) => block.kind)).toEqual([
            'paragraph',
            'table',
            'paragraph',
            'paragraph',
            'paragraph',
            'embedded-sheet'
        ]);
    });

    it('detects drawing-anchor capable documents from embedded stream markers', () => {
        const parser = DocBinaryParser as unknown as {
            detectEmbeddedObjectPlacementMode(
                cfb: {
                    listStreams(): Array<{ name: string; size: number }>;
                    getStream(name: string): Buffer | null;
                },
                fileBuffer: Buffer
            ): 'text-flow' | 'drawing-anchor';
        };

        const mode = parser.detectEmbeddedObjectPlacementMode({
            listStreams: () => [{ name: 'WordDocument', size: 32 }, { name: 'ObjectPool', size: 64 }],
            getStream: (name: string) => name === 'WordDocument' ? Buffer.from('plain text') : null
        }, Buffer.from('plain text'));

        expect(mode).toBe('drawing-anchor');
    });

    it('marks package charts as text-flow when no drawing markers are present', async () => {
        const parser = DocBinaryParser as unknown as {
            detectEmbeddedObjectPlacementMode(
                cfb: {
                    listStreams(): Array<{ name: string; size: number }>;
                    getStream(name: string): Buffer | null;
                },
                fileBuffer: Buffer
            ): 'text-flow' | 'drawing-anchor';
            parseOdfChartContent(
                contentXml: string,
                objectPlacementMode: 'text-flow' | 'drawing-anchor'
            ): { objectPlacementMode?: string; chart?: unknown; rows: string[][] } | undefined;
            buildRenderedBlockModel(block: {
                kind: 'sheet';
                rows?: string[][];
                chart?: {
                    type: 'bar' | 'line';
                    categories: string[];
                    series: Array<{ name: string; values: number[]; color: string }>;
                };
                objectPlacementMode?: 'text-flow' | 'drawing-anchor';
            }): { objectPlacementMode?: string } | undefined;
            wrapLegacyBlock(block: {
                kind: 'sheet';
                html: string;
                objectPlacementMode?: 'text-flow' | 'drawing-anchor';
            }): string;
        };

        const mode = parser.detectEmbeddedObjectPlacementMode({
            listStreams: () => [{ name: 'WordDocument', size: 64 }, { name: '1Table', size: 32 }],
            getStream: (name: string) => {
                if (name === 'WordDocument') return Buffer.from('LibreOffice.ChartDocument.1');
                if (name === '1Table') return Buffer.from('no drawing markers here');
                return null;
            }
        }, Buffer.from('LibreOffice.ChartDocument.1'));

        const parsed = parser.parseOdfChartContent(`
            <office:document-content>
                <table:table-row><table:table-cell office:value-type="string"><text:p>Label</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Value</text:p></table:table-cell></table:table-row>
                <table:table-row><table:table-cell office:value-type="string"><text:p>Row 1</text:p></table:table-cell><table:table-cell office:value-type="float"><text:p>9.1</text:p></table:table-cell></table:table-row>
            </office:document-content>
        `, mode);

        expect(mode).toBe('text-flow');
        expect(parsed?.objectPlacementMode).toBe('text-flow');

        const rendered = parser.buildRenderedBlockModel({
            kind: 'sheet',
            rows: parsed?.rows,
            chart: parsed?.chart as {
                type: 'bar' | 'line';
                categories: string[];
                series: Array<{ name: string; values: number[]; color: string }>;
            } | undefined,
            objectPlacementMode: parsed?.objectPlacementMode as 'text-flow' | 'drawing-anchor'
        });
        expect(rendered?.objectPlacementMode).toBe('text-flow');

        const wrapped = parser.wrapLegacyBlock({
            kind: 'sheet',
            html: '<section></section>',
            objectPlacementMode: 'text-flow'
        });
        expect(wrapped).toContain('data-ov-object-placement="text-flow"');
    });

});
