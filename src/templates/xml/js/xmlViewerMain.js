import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountXmlViewer } from 'omni-viewer-core/viewers/xml';

// Webview entry for the omni-viewer-core XML viewer. Bundled by webpack into
// xmlViewer.js. The parser has no DOM dependency and never loads external
// entities, so the document is parsed here from the raw bytes the host posts.

(function () {
    'use strict';

    const dataEl = document.getElementById('xml-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'document.xml';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('xml-root');

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
        if (message.type !== 'xmlHostResponse' || !message.requestId) {
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
                    fn('[xml]', message);
                } catch (e) {
                    // Logging is best-effort in the webview.
                }
            }
        },
        clipboard: {
            writeText: function (text) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    return navigator.clipboard.writeText(text).catch(function () {
                        return hostRequest('xmlHostClipboard', { text: text }).then(function () { });
                    });
                }
                return hostRequest('xmlHostClipboard', { text: text }).then(function () { });
            }
        }
    };

    function showFailure(err) {
        const message = err && err.message ? err.message : String(err);
        const target = container.shadowRoot || container;
        const notice = document.createElement('p');
        notice.textContent = 'Failed to open XML document: ' + message;
        target.append(notice);
    }

    let handle = null;
    let mounting = false;
    window.addEventListener('unload', function () {
        if (handle) {
            handle.dispose();
        }
    });

    // The host posts the file bytes in reply to `xmlReady` rather than
    // inlining them into the page (see XmlViewerProvider).
    window.addEventListener('message', function (event) {
        const message = event.data || {};
        if (mounting) {
            return;
        }
        if (message.type === 'xmlSourceError') {
            mounting = true;
            showFailure(new Error(message.message || 'Unable to read the document'));
            return;
        }
        if (message.type !== 'xmlSource') {
            return;
        }
        mounting = true;
        const input = {
            fileName: fileName,
            data: message.data instanceof Uint8Array ? message.data : new Uint8Array(message.data || [])
        };
        mountXmlViewer(input, container, ctx, {
            styleIsolation: 'shadow'
        })
            .then(function (mounted) {
                handle = mounted;
            })
            .catch(showFailure);
    });

    if (vscodeApi) {
        vscodeApi.postMessage({ type: 'xmlReady' });
    } else {
        showFailure(new Error('VS Code API is unavailable'));
    }
})();
