import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountLatexViewer } from 'omni-viewer-core/viewers/latex';
import { loadLatexViewerDeps } from 'omni-viewer-core/viewers/latex/self-loading';

// Webview entry for the omni-viewer-core LaTeX viewer. Bundled by webpack into
// latexViewer.js and inlined by the extension template. KaTeX and DOMPurify are
// bundled here (loadLatexViewerDeps imports them); KaTeX's stylesheet and fonts
// stay in node_modules and are linked at runtime — see the shadow-root note below.

(function () {
    'use strict';

    const dataEl = document.getElementById('latex-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'document.tex';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('latex-root');

    const vscodeApi = window.__omniVsCode__
        || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);

    function post(message) {
        if (vscodeApi) {
            vscodeApi.postMessage(message);
        }
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
        if (message.type !== 'latexHostResponse' || !message.requestId) {
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

    const decoder = new TextDecoder();

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
                    fn('[latex]', message);
                } catch (e) {
                    // console may be unavailable; logging is best-effort.
                }
            }
        },
        clipboard: {
            writeText: function (text) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    return navigator.clipboard.writeText(text).catch(function () {
                        return hostRequest('latexHostClipboard', { text: text }).then(function () { });
                    });
                }
                return hostRequest('latexHostClipboard', { text: text }).then(function () { });
            }
        },
        navigation: {
            openExternalUrl: function (url) {
                return hostRequest('latexHostOpenExternal', { url: url }).then(function () { });
            }
        },
        writeback: {
            write: function (data) {
                return hostRequest('latexHostWriteback', {
                    content: decoder.decode(data)
                }).then(function () { });
            }
        },
        save: {
            saveFile: function (name, data) {
                return hostRequest('latexHostSave', {
                    name: name,
                    content: decoder.decode(data)
                });
            }
        }
    };

    // KaTeX lays out with its own stylesheet and fonts. The viewer renders into
    // a shadow root, which a <link> in the document head cannot reach, and the
    // stylesheet references its fonts relatively — so it is linked (not inlined)
    // from node_modules inside the shadow root, letting `url(fonts/...)` resolve
    // against the stylesheet's own webview URI. Attaching the root here is
    // deliberate: mountLatexViewer reuses an existing open shadow root, so the
    // stylesheet is in place before the first formula renders.
    function attachKatexStylesheet() {
        if (!parsed.katexCssUri || typeof container.attachShadow !== 'function') {
            return;
        }
        const root = container.shadowRoot || container.attachShadow({ mode: 'open' });
        if (root.querySelector('link[data-omni-katex]')) {
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = parsed.katexCssUri;
        link.setAttribute('data-omni-katex', '');
        root.append(link);
    }

    attachKatexStylesheet();

    const input = {
        fileName: fileName,
        data: new TextEncoder().encode(parsed.source || '')
    };

    loadLatexViewerDeps()
        .then(function (deps) {
            return mountLatexViewer(input, container, ctx, {
                deps: deps,
                styleIsolation: 'shadow'
            });
        })
        .catch(function (err) {
            const message = err && err.message ? err.message : String(err);
            container.textContent = 'Failed to load LaTeX document: ' + message;
        });
})();
