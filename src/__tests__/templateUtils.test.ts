import { escapeJsonForHtmlScriptTag } from '../utils/htmlEscaping';

describe('escapeJsonForHtmlScriptTag', () => {
    it('escapes HTML-significant characters so script tags cannot terminate JSON blocks', () => {
        const raw = JSON.stringify({
            text: '<script>alert(1)</script><!--x-->&'
        });

        const escaped = escapeJsonForHtmlScriptTag(raw);

        expect(escaped).not.toContain('<script>');
        expect(escaped).not.toContain('</script>');
        expect(escaped).not.toContain('<!--');
        expect(escaped).toContain('\\u003Cscript\\u003E');
        expect(escaped).toContain('\\u003C/script\\u003E');
        expect(escaped).toContain('\\u003C!--x--\\u003E');
        expect(JSON.parse(escaped)).toEqual({
            text: '<script>alert(1)</script><!--x-->&'
        });
    });
});
