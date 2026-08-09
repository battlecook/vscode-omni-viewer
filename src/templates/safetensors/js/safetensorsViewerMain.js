import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountSafetensorsDocument } from 'omni-viewer-core/viewers/safetensors';

// Webview entry for the omni-viewer-core Safetensors viewer. Bundled by webpack
// into safetensorsViewer.js and loaded by the extension template. The host reads
// only the safetensors header via a range reader, so just the JSON-safe document
// model crosses into the webview — the tensor payload never does.

(function () {
    'use strict';

    const dataEl = document.getElementById('safetensors-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'model.safetensors';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('safetensors-root');

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
                    fn('[safetensors]', message);
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
        mountSafetensorsDocument(parsed.model, fileName, container, ctx, {
            styleIsolation: 'shadow'
        });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        container.textContent = 'Failed to render Safetensors model: ' + message;
    }
})();
