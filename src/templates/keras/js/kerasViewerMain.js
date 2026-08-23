import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountKerasDocument } from 'omni-viewer-core/viewers/keras';

// The host reads the archive (or the legacy HDF5 store) in a worker and sends
// only the JSON-safe document model in, so no weight payload reaches the webview.
(function () {
    'use strict';

    const dataEl = document.getElementById('keras-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'model.keras';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('keras-root');

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
                    fn('[keras]', message);
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
        mountKerasDocument(parsed.model, fileName, container, ctx, {
            styleIsolation: 'shadow'
        });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        container.textContent = 'Failed to render Keras model: ' + message;
    }
})();
