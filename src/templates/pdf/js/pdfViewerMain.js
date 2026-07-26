import { mountPdfViewer } from 'omni-viewer-core/viewers/pdf';
import { createCatalogI18n } from 'omni-viewer-core/i18n';

// Webview entry for the omni-viewer-core PDF viewer. Bundled by webpack into
// pdfViewer.js and inlined by the extension template. pdf.js is loaded at
// runtime from the extension's node_modules (webview URI globals set in the
// HTML head); pdf-lib is bundled here so all editing runs in the webview.

(function () {
    'use strict';

    const dataEl = document.getElementById('pdf-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'document.pdf';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('pdf-root');

    const vscodeApi = window.__omniVsCode__
        || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);

    function post(message) {
        if (vscodeApi) {
            vscodeApi.postMessage(message);
        }
    }

    function base64ToBytes(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function bytesToBase64(bytes) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    // ---- host request/response bridge --------------------------------------
    let requestSeq = 0;
    const pending = new Map();

    function hostRequest(type, payload) {
        return new Promise(function (resolve, reject) {
            const requestId = type + ':' + (++requestSeq);
            pending.set(requestId, { resolve: resolve, reject: reject });
            post(Object.assign({ type: type, requestId: requestId }, payload));
        });
    }

    window.addEventListener('message', function (event) {
        const message = event.data || {};
        if (message.type !== 'pdfHostResponse' || !message.requestId) {
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
    const workerSrc = window.__OMNI_PDFJS_WORKER__;

    const ctx = {
        assets: {
            resolveAssetUrl: function () {
                return Promise.resolve(workerSrc);
            }
        },
        i18n: createCatalogI18n(locale),
        logger: {
            log: function (level, message) {
                try {
                    const fn = level === 'error' ? console.error
                        : level === 'warn' ? console.warn
                        : console.log;
                    fn('[pdf]', message);
                } catch (e) {
                    // console may be unavailable; logging is best-effort.
                }
            }
        },
        save: {
            saveFile: function (name, data, mimeType) {
                return hostRequest('pdfHostSave', {
                    name: name,
                    dataBase64: bytesToBase64(data),
                    mimeType: mimeType
                });
            }
        },
        writeback: {
            write: function (data) {
                return hostRequest('pdfHostWriteback', {
                    dataBase64: bytesToBase64(data)
                }).then(function () { });
            }
        },
        filePick: {
            pickFile: function (options) {
                return hostRequest('pdfHostPickFile', {
                    accept: (options && options.accept) ? Array.from(options.accept) : ['.pdf'],
                    maxBytes: options ? options.maxBytes : undefined
                }).then(function (result) {
                    if (!result) {
                        return undefined;
                    }
                    return {
                        fileName: result.fileName,
                        data: base64ToBytes(result.dataBase64),
                        mimeType: result.mimeType
                    };
                });
            }
        },
        clipboard: {
            writeText: function (text) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    return navigator.clipboard.writeText(text).catch(function () {
                        return hostRequest('pdfHostClipboard', { text: text }).then(function () { });
                    });
                }
                return hostRequest('pdfHostClipboard', { text: text }).then(function () { });
            }
        }
    };

    const deps = {
        loadPdfjs: function () {
            return window.__OMNI_PDFJS_READY__;
        },
        loadPdfLib: function () {
            return import('pdf-lib');
        }
    };

    const options = {
        workerSrc: workerSrc,
        isEvalSupported: false,
        // 'hybrid' embeds a re-editable sidecar (layer JSON + base PDF) so
        // text/highlight/underline/strikeout annotations stay removable and
        // editable when the saved PDF is reopened here or in another omni
        // viewer. External readers still only see the flattened pages.
        saveMode: 'hybrid',
        styleIsolation: 'shadow'
    };

    const input = {
        fileName: fileName,
        data: base64ToBytes(parsed.base64)
    };

    mountPdfViewer(input, container, ctx, deps, options).catch(function (err) {
        const message = err && err.message ? err.message : String(err);
        container.textContent = 'Failed to load PDF: ' + message;
    });
})();
