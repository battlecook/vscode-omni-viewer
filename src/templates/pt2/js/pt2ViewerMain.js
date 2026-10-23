import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountPt2Document } from 'omni-viewer-core/viewers/pt2';

// The host parses the package and sends only the JSON-safe document model
// into the webview; weight payloads stay on disk beyond their short previews.
(function () {
    'use strict';

    const dataEl = document.getElementById('pt2-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'model.pt2';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('pt2-root');

    const ctx = {
        assets: {
            resolveAssetUrl: function (assetPath) {
                return Promise.resolve(assetPath);
            }
        },
        i18n: createCatalogI18n(locale),
        logger: {
            log: function (level, message) {
                try {
                    const fn = level === 'error' ? console.error
                        : level === 'warn' ? console.warn
                        : console.log;
                    fn('[pt2]', message);
                } catch (e) {
                    // Logging is best-effort in the webview.
                }
            }
        },
        clipboard: {
            writeText: function (value) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    return navigator.clipboard.writeText(value);
                }
                return Promise.reject(new Error('Clipboard is unavailable in this webview.'));
            }
        }
    };

    try {
        mountPt2Document(parsed.model, fileName, container, ctx, {
            styleIsolation: 'shadow'
        });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        container.textContent = 'Failed to render PyTorch Export package: ' + message;
    }
})();
