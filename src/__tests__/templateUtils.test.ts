import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import { escapeJsonForHtmlScriptTag } from '../utils/htmlEscaping';
import { TemplateUtils } from '../utils/templateUtils';

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

describe('TemplateUtils.loadTemplate', () => {
    let extensionPath: string;

    beforeEach(() => {
        extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-template-'));
        fs.mkdirSync(path.join(extensionPath, 'src', 'templates'), { recursive: true });
        fs.writeFileSync(
            path.join(extensionPath, 'src', 'templates', 'page.html'),
            '<html><head></head><body>{{omniShareButtons}}<script id="data" type="application/json">{{data}}</script></body></html>'
        );
    });

    afterEach(() => {
        fs.rmSync(extensionPath, { recursive: true, force: true });
    });

    it('leaves a share-button placeholder inside file content untouched', async () => {
        const data = escapeJsonForHtmlScriptTag(JSON.stringify({ source: 'see {{omniShareButtons}} here' }));
        const html = await TemplateUtils.loadTemplate(
            { extensionPath } as never,
            'page.html',
            { data }
        );

        expect(html).toContain('data-omni-action="share"');
        const json = /<script id="data" type="application\/json">(.*?)<\/script>/.exec(html)?.[1] ?? '';
        expect(JSON.parse(json)).toEqual({ source: 'see {{omniShareButtons}} here' });
    });
});
