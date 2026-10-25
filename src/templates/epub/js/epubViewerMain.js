import DOMPurify from 'dompurify';
import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountEpubViewer } from 'omni-viewer-core/viewers/epub';

// Webview entry for the omni-viewer-core EPUB viewer. Bundled by webpack into
// epubViewer.js. Chapters are sanitized by DOMPurify before they reach the
// page, publisher CSS and scripts are dropped, and remote images are blocked —
// the book is read, never executed. DOMPurify is injected here rather than
// through loadEpubViewerDeps so it is bundled statically.

const epubDeps = {
    createDOMPurify: DOMPurify
};

(function () {
    'use strict';

    const dataEl = document.getElementById('epub-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'book.epub';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('epub-root');

    const vscodeApi = window.__omniVsCode__
        || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);

    // ---- host request/response bridge --------------------------------------
    let requestSeq = 0;
    const pending = new Map();

    function hostRequest(type, payload) {
        return new Promise(function (resolve, reject) {
            if (!vscodeApi) {
                reject(new Error('VS Code API is unavailable'));
                return;
            }
            const requestId = type + ':' + (++requestSeq);
            pending.set(requestId, { resolve: resolve, reject: reject });
            vscodeApi.postMessage(Object.assign({ type: type, requestId: requestId }, payload));
        });
    }

    window.addEventListener('message', function (event) {
        const message = event.data || {};
        if (message.type !== 'epubHostResponse' || !message.requestId) {
            return;
        }
        const entry = pending.get(message.requestId);
        if (!entry) {
            return;
        }
        pending.delete(message.requestId);
        if (message.ok) {
            entry.resolve(message.result);
        } else {
            entry.reject(new Error(message.error || 'Host request failed'));
        }
    });

    // ---- host context (services) -------------------------------------------
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
                    fn('[epub]', message);
                } catch (e) {
                    // Logging is best-effort in the webview.
                }
            }
        },
        navigation: {
            openExternalUrl: function (url) {
                return hostRequest('epubHostOpenExternal', { url: url }).then(function () { });
            }
        }
    };

    function showFailure(err) {
        const message = err && err.message ? err.message : String(err);
        const target = container.shadowRoot || container;
        const notice = document.createElement('p');
        notice.textContent = 'Failed to open EPUB book: ' + message;
        target.append(notice);
    }

    let handle = null;
    let mounting = false;
    window.addEventListener('unload', function () {
        if (handle) {
            handle.dispose();
        }
    });

    // The host posts the file bytes in reply to `epubReady` rather than
    // inlining them into the page (see EpubViewerProvider).
    window.addEventListener('message', function (event) {
        const message = event.data || {};
        if (mounting) {
            return;
        }
        if (message.type === 'epubSourceError') {
            mounting = true;
            showFailure(new Error(message.message || 'Unable to read the book'));
            return;
        }
        if (message.type !== 'epubSource') {
            return;
        }
        mounting = true;
        const input = {
            fileName: fileName,
            data: message.data instanceof Uint8Array ? message.data : new Uint8Array(message.data || [])
        };
        mountEpubViewer(input, container, ctx, epubDeps, {
            styleIsolation: 'shadow'
        })
            .then(function (mounted) {
                handle = mounted;
            })
            .catch(showFailure);
    });

    if (vscodeApi) {
        vscodeApi.postMessage({ type: 'epubReady' });
    } else {
        showFailure(new Error('VS Code API is unavailable'));
    }
})();
