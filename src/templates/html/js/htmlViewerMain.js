import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountHtmlViewer } from 'omni-viewer-core/viewers/html';

(function () {
    'use strict';

    const parsed = JSON.parse(document.getElementById('html-data').textContent);
    const container = document.getElementById('html-root');
    const vscodeApi = window.__omniVsCode__
        || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);
    const ctx = {
        assets: { resolveAssetUrl: assetPath => Promise.resolve(assetPath) },
        i18n: createCatalogI18n(parsed.locale || 'en'),
        logger: {
            log: (level, message) => {
                const log = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
                log('[html]', message);
            }
        }
    };

    function showFailure(error) {
        const notice = document.createElement('p');
        notice.textContent = 'Failed to open HTML document: ' + (error && error.message ? error.message : String(error));
        (container.shadowRoot || container).append(notice);
    }

    let handle = null;
    let mounting = false;
    let disposed = false;
    window.addEventListener('unload', () => {
        disposed = true;
        if (handle) handle.dispose();
    });
    window.addEventListener('message', event => {
        const message = event.data || {};
        if (mounting || disposed) return;
        if (message.type === 'htmlSourceError') {
            mounting = true;
            showFailure(new Error(message.message || 'Unable to read the document'));
            return;
        }
        if (message.type !== 'htmlSource') return;
        mounting = true;
        mountHtmlViewer({
            fileName: parsed.fileName || 'document.html',
            data: message.data instanceof Uint8Array ? message.data : new Uint8Array(message.data || [])
        }, container, ctx, { styleIsolation: 'shadow' })
            .then(mounted => {
                if (disposed) mounted.dispose();
                else handle = mounted;
            })
            .catch(showFailure);
    });

    if (vscodeApi) vscodeApi.postMessage({ type: 'htmlReady' });
    else showFailure(new Error('VS Code API is unavailable'));
})();
