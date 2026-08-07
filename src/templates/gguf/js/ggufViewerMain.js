import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountGgufDocument } from 'omni-viewer-core/viewers/gguf';

// Webview entry for the omni-viewer-core GGUF viewer. Bundled by webpack into
// ggufViewer.js and loaded by the extension template. The host parses the file
// with the Node range reader (metadata + tensor index only), so the webview
// receives just the JSON-safe document model — never the tensor payload.

(function () {
    'use strict';

    const dataEl = document.getElementById('gguf-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'model.gguf';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('gguf-root');

    const ctx = {
        assets: {
            // The viewer bundles everything it needs; nothing is resolved from disk.
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
                    fn('[gguf]', message);
                } catch (e) {
                    // console may be unavailable; logging is best-effort.
                }
            }
        },
        clipboard: {
            writeText: function (text) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    return navigator.clipboard.writeText(text);
                }
                return Promise.reject(new Error('Clipboard is unavailable in this webview.'));
            }
        }
    };

    try {
        mountGgufDocument(parsed.model, fileName, container, ctx, {
            styleIsolation: 'shadow'
        });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        container.textContent = 'Failed to render GGUF model: ' + message;
    }
})();
