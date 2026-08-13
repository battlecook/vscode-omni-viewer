jest.mock('vscode', () => ({
    CancellationTokenSource: class {
        public readonly token = {};
    }
}), { virtual: true });
jest.mock('music-metadata', () => ({}), { virtual: true });
jest.mock('hyparquet', () => ({}), { virtual: true });
jest.mock('hyparquet-compressors', () => ({}), { virtual: true });
jest.mock('hwp.js', () => ({}), { virtual: true });
jest.mock('xlsx', () => ({}), { virtual: true });
jest.mock('jszip', () => ({}), { virtual: true });

import { renderErrorHtml } from '../viewerProviderUtils';

describe('renderErrorHtml', () => {
    it('escapes every dynamic value and prevents scripts in error webviews', () => {
        const html = renderErrorHtml(
            '<img src=x onerror=alert(1)>.tflite',
            '</div><script>alert(2)</script>',
            {
                title: '<b>Failed</b>',
                message: '<svg onload=alert(3)>',
                icon: '<iframe srcdoc=bad>',
                lang: 'en" onload="alert(4)'
            }
        );

        expect(html).toContain("default-src 'none'");
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img src=x');
        expect(html).not.toContain('<svg onload');
        expect(html).not.toContain('<iframe');
        expect(html).not.toContain('lang="en" onload=');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.tflite');
        expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    });
});
