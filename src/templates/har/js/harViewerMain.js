import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountHarDocument } from 'omni-viewer-core/viewers/har';

// The host parses the archive in a worker and sends the parse result in — the
// document model with bodies already cut to the preview limit — so a large
// archive never has to be re-read or re-parsed inside the webview.
(function () {
    'use strict';

    const dataEl = document.getElementById('har-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'archive.har';
    const locale = parsed.locale || 'en';
    const result = parsed.result;
    const container = document.getElementById('har-root');

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
                    fn('[har]', message);
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

    function renderFailure(failure, diagnostics) {
        const box = document.createElement('div');
        box.className = 'omni-har-failure';
        const heading = document.createElement('h2');
        heading.textContent = ctx.i18n.t('har.unreadable');
        box.appendChild(heading);
        const lines = [ctx.i18n.t(failure.messageKey, failure.args)];
        // The JSON layer records where the archive broke (`@<offset>`); keep
        // it, as the core's own failure view does, so a large archive can be
        // repaired.
        (diagnostics || []).forEach(function (diagnostic) {
            const text = ctx.i18n.t(diagnostic.messageKey, diagnostic.args);
            lines.push(diagnostic.location ? text + ' (' + diagnostic.location + ')' : text);
        });
        lines.forEach(function (line) {
            const p = document.createElement('p');
            p.textContent = line;
            box.appendChild(p);
        });
        container.replaceChildren(box);
    }

    try {
        if (!result || result.status === 'failed') {
            renderFailure(
                result ? result.failure : { messageKey: 'har.unreadable' },
                result ? result.diagnostics : []
            );
            return;
        }
        mountHarDocument(result.document, fileName, container, ctx, {
            styleIsolation: 'shadow'
        }, result.diagnostics);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        container.textContent = 'Failed to render HAR archive: ' + message;
    }
})();
