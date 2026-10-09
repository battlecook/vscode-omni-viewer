import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountPteDocument } from 'omni-viewer-core/viewers/pte';

// The host parses the FlatBuffer and sends only the JSON-safe document model
// into the webview, leaving constant, delegate, and named data segments on disk.
(function () {
    'use strict';

    const dataEl = document.getElementById('pte-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'model.pte';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('pte-root');

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
                    fn('[pte]', message);
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
        mountPteDocument(parsed.model, fileName, container, ctx, {
            styleIsolation: 'shadow'
        });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        container.textContent = 'Failed to render ExecuTorch program: ' + message;
    }
})();
