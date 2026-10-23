import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountNumpyDocument } from 'omni-viewer-core/viewers/numpy';

// The host parses the array file and sends only the JSON-safe document model
// into the webview, with the value preview capped by the core parser. NaN,
// infinities, and negative zero arrive as strings, which the viewer prints as-is.
(function () {
    'use strict';

    const dataEl = document.getElementById('numpy-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'array.npy';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('numpy-root');

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
                    fn('[numpy]', message);
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
        mountNumpyDocument(parsed.model, fileName, container, ctx, {
            styleIsolation: 'shadow'
        });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        container.textContent = 'Failed to render NumPy arrays: ' + message;
    }
})();
