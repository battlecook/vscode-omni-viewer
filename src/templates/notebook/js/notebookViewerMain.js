import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import fsharp from 'highlight.js/lib/languages/fsharp';
import go from 'highlight.js/lib/languages/go';
import haskell from 'highlight.js/lib/languages/haskell';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import julia from 'highlight.js/lib/languages/julia';
import katex from 'katex';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import { marked } from 'marked';
import matlab from 'highlight.js/lib/languages/matlab';
import perl from 'highlight.js/lib/languages/perl';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createCatalogI18n } from 'omni-viewer-core/i18n';
import { mountNotebookViewer } from 'omni-viewer-core/viewers/notebook';

// Webview entry for the omni-viewer-core Jupyter notebook viewer. Bundled by
// webpack into notebookViewer.js. The viewer is read-only: code is shown as
// text and outputs are the results saved in the file — nothing is executed.
//
// The dependencies are injected here rather than through
// loadNotebookViewerDeps, which pulls in every highlight.js grammar; the
// highlight.js core with the kernel languages notebooks are written in keeps
// the bundle a fraction of the size. Kernel names resolve case-insensitively
// through the grammars' aliases (`R`, `c++`, `C#`, `F#`). KaTeX's stylesheet
// and fonts stay in node_modules and are linked into the shadow root at runtime.

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('fsharp', fsharp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('haskell', haskell);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('julia', julia);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('latex', latex);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('matlab', matlab);
hljs.registerLanguage('perl', perl);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('r', r);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerAliases(['octave'], { languageName: 'matlab' });
hljs.registerAliases(['ipython', 'ipython3', 'python3'], { languageName: 'python' });

const notebookDeps = {
    render: {
        parse: function (text) {
            return marked.parse(text, { async: false });
        }
    },
    createDOMPurify: DOMPurify,
    highlighter: hljs,
    math: {
        renderToHtml: function (source, displayMode) {
            return katex.renderToString(source, {
                displayMode: displayMode,
                throwOnError: false,
                output: 'htmlAndMathml',
                trust: false
            });
        }
    }
};

(function () {
    'use strict';

    const dataEl = document.getElementById('notebook-data');
    const parsed = JSON.parse(dataEl.textContent);
    const fileName = parsed.fileName || 'notebook.ipynb';
    const locale = parsed.locale || 'en';
    const container = document.getElementById('notebook-root');

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
        if (message.type !== 'notebookHostResponse' || !message.requestId) {
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

    function base64ToBytes(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    // ---- host context (services) -------------------------------------------
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
                    fn('[notebook]', message);
                } catch (e) {
                    // Logging is best-effort in the webview.
                }
            }
        },
        clipboard: {
            writeText: function (text) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    return navigator.clipboard.writeText(text).catch(function () {
                        return hostRequest('notebookHostClipboard', { text: text }).then(function () { });
                    });
                }
                return hostRequest('notebookHostClipboard', { text: text }).then(function () { });
            }
        },
        navigation: {
            openExternalUrl: function (url) {
                return hostRequest('notebookHostOpenExternal', { url: url }).then(function () { });
            }
        },
        // Images a Markdown cell references relative to the notebook. The host
        // reads them from disk (confined to the notebook's folder) and the
        // webview turns the bytes into a blob URL the viewer releases on close.
        documentAssets: {
            resolve: function (assetPath) {
                return hostRequest('notebookHostResolveAsset', { url: assetPath }).then(function (asset) {
                    if (!asset || !asset.dataBase64) {
                        return null;
                    }
                    const url = URL.createObjectURL(new Blob([base64ToBytes(asset.dataBase64)], { type: asset.mimeType }));
                    return {
                        url: url,
                        dispose: function () {
                            URL.revokeObjectURL(url);
                        }
                    };
                });
            }
        }
    };

    // KaTeX lays out with its own stylesheet and fonts. The viewer renders into
    // a shadow root, which a <link> in the document head cannot reach, so the
    // stylesheet is linked inside the shadow root before mounting —
    // mountNotebookViewer reuses an existing open shadow root.
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

    function showFailure(err) {
        const message = err && err.message ? err.message : String(err);
        const target = container.shadowRoot || container;
        const notice = document.createElement('p');
        notice.textContent = 'Failed to render Jupyter notebook: ' + message;
        target.append(notice);
    }

    let handle = null;
    let mounting = false;
    window.addEventListener('unload', function () {
        if (handle) {
            handle.dispose();
        }
    });

    // The host posts the file bytes in reply to `notebookReady` rather than
    // inlining them into the page (see NotebookViewerProvider).
    window.addEventListener('message', function (event) {
        const message = event.data || {};
        if (mounting) {
            return;
        }
        if (message.type === 'notebookSourceError') {
            mounting = true;
            showFailure(new Error(message.message || 'Unable to read the notebook'));
            return;
        }
        if (message.type !== 'notebookSource') {
            return;
        }
        mounting = true;
        const input = {
            fileName: fileName,
            data: message.data instanceof Uint8Array ? message.data : new Uint8Array(message.data || [])
        };
        mountNotebookViewer(input, container, ctx, notebookDeps, {
            styleIsolation: 'shadow'
        })
            .then(function (mounted) {
                handle = mounted;
            })
            .catch(showFailure);
    });

    if (vscodeApi) {
        vscodeApi.postMessage({ type: 'notebookReady' });
    } else {
        showFailure(new Error('VS Code API is unavailable'));
    }
})();
