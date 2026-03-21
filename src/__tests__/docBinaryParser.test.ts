jest.mock('xlsx', () => ({}), { virtual: true });

import { DocBinaryParser } from '../utils/docBinaryParser';

describe('DocBinaryParser encoding selection', () => {
    it('prefers readable Hangul text over mojibake for legacy ANSI pieces', () => {
        const parser = DocBinaryParser as unknown as {
            selectBestDecodedCandidate(
                candidates: Map<string, string[]>,
                segments: Map<string, Array<{ text: string; fcStart: number; bytesPerChar: number }>>,
                startsAtZero: boolean,
                pieceCount: number
            ): { text: string; score: number } | null;
        };
        const candidates = new Map<string, string[]>([
            ['windows-1252', ['Å×½ºÆ® ¹®¼­ÀÔ´Ï´Ù legacy word content Å×½ºÆ® ¹®¼­ÀÔ´Ï´Ù']],
            ['euc-kr', ['테스트 문서입니다. 이 문서는 한글 인코딩 선택 테스트를 위한 예시입니다.']],
            ['shift_jis', ['ﾅﾗｽﾄ ﾑｸｼﾇ ﾅﾗｽﾄ ﾑｸｼﾇ ﾅﾗｽﾄ']]
        ]);
        const segments = new Map<string, Array<{ text: string; fcStart: number; bytesPerChar: number }>>([
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
});
