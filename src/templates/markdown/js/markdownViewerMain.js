import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import mermaid from 'mermaid';
import { marked } from 'marked';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import { render as renderPlantuml } from 'puml-canvas-js';
import shell from 'highlight.js/lib/languages/shell';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { sanitizeUrl } from '@braintree/sanitize-url';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

(function () {
    const state = {
        source: String(window.markdownSource || ''),
        savedSource: String(window.markdownSource || ''),
        renderedHtml: '',
        diagramCount: 0,
        isDirty: false,
        isApplyingHistory: false,
        lastEditorValue: String(window.markdownSource || ''),
        undoStack: [],
        redoStack: [],
        viewMode: 'preview'
    };

    const vscodeApi = typeof acquireVsCodeApi === 'function'
        ? acquireVsCodeApi()
        : window.__omniVsCode__ || null;

    const els = {
        workspace: document.getElementById('workspace'),
        previewPanel: document.getElementById('previewPanel'),
        sourcePanel: document.getElementById('sourcePanel'),
        markdownPreview: document.getElementById('markdownPreview'),
        sourceView: document.getElementById('sourceView'),
        previewCaption: document.getElementById('previewCaption'),
        sourceCaption: document.getElementById('sourceCaption'),
        statusBadge: document.getElementById('statusBadge'),
        summaryText: document.getElementById('summaryText'),
        messagePanel: document.getElementById('messagePanel'),
        renderBtn: document.getElementById('renderBtn'),
        copyHtmlBtn: document.getElementById('copyHtmlBtn'),
        copySourceBtn: document.getElementById('copySourceBtn')
    };

    marked.setOptions({
        async: false,
        breaks: false,
        gfm: true,
        mangle: false,
        headerIds: false
    });

    function setStatus(text, status) {
        els.statusBadge.textContent = text;
        els.statusBadge.classList.toggle('is-valid', status === 'valid');
        els.statusBadge.classList.toggle('is-invalid', status === 'invalid');
    }

    function showMessage(message) {
        els.messagePanel.textContent = message || '';
        els.messagePanel.classList.toggle('is-hidden', !message);
    }

    function markDirty(isDirty) {
        state.isDirty = isDirty;
        els.renderBtn.classList.toggle('is-dirty', isDirty);

        if (isDirty) {
            setStatus('Modified', '');
            els.sourceCaption.textContent = 'Edited';
        } else if (els.statusBadge.textContent === 'Modified') {
            setStatus('Ready', '');
            els.sourceCaption.textContent = 'Editable';
        }
    }

    function setViewMode(mode) {
        state.viewMode = mode;
        els.workspace.classList.toggle('is-split', mode === 'split');
        els.previewPanel.classList.toggle('is-hidden', mode === 'source');
        els.sourcePanel.classList.toggle('is-hidden', mode === 'preview');

        document.querySelectorAll('[data-view-mode]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.viewMode === mode);
        });
    }

    function sanitizeRenderedHtml(html) {
        return DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true },
            ADD_ATTR: ['target', 'rel'],
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'],
            FORBID_ATTR: ['style', 'srcdoc']
        });
    }

    function hardenLinksAndImages(root) {
        root.querySelectorAll('a[href]').forEach((link) => {
            const safeHref = sanitizeUrl(link.getAttribute('href') || '');
            if (safeHref === 'about:blank') {
                link.removeAttribute('href');
                return;
            }

            link.setAttribute('href', safeHref);
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noreferrer noopener');
        });

        root.querySelectorAll('img[src]').forEach((image) => {
            const safeSrc = sanitizeUrl(image.getAttribute('src') || '');
            if (safeSrc === 'about:blank') {
                image.removeAttribute('src');
                image.setAttribute('alt', image.getAttribute('alt') || 'Blocked image');
                return;
            }

            image.setAttribute('src', safeSrc);
        });
    }

    function sanitizeSvg(svg) {
        return DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ['foreignObject'],
            ADD_ATTR: ['dominant-baseline', 'text-anchor', 'viewBox', 'xmlns', 'role', 'aria-roledescription']
        });
    }

    function isDiagramLanguage(language) {
        return language === 'mermaid' || language === 'plantuml' || language === 'puml' || language === 'uml';
    }

    function getCodeLanguage(block) {
        for (const className of block.classList) {
            if (className.startsWith('language-')) {
                return className.slice('language-'.length).toLowerCase();
            }

            if (className.startsWith('lang-')) {
                return className.slice('lang-'.length).toLowerCase();
            }
        }

        return '';
    }

    function renderCodeHighlights(root) {
        root.querySelectorAll('pre > code').forEach((block) => {
            const language = getCodeLanguage(block);
            if (isDiagramLanguage(language)) {
                return;
            }

            const source = block.textContent || '';
            let result;
            if (language && hljs.getLanguage(language)) {
                result = hljs.highlight(source, {
                    language,
                    ignoreIllegals: true
                });
            } else {
                result = hljs.highlightAuto(source);
            }

            block.innerHTML = result.value;
            block.classList.add('hljs');
            if (result.language) {
                block.dataset.language = result.language;
            }
        });
    }

    async function renderMermaidBlocks(root) {
        const blocks = Array.from(root.querySelectorAll('pre > code.language-mermaid, pre > code.lang-mermaid'));
        state.diagramCount = blocks.length;

        if (blocks.length === 0) {
            return;
        }

        mermaid.initialize({
            startOnLoad: false,
            theme: 'base',
            securityLevel: 'strict',
            fontFamily: 'var(--vscode-font-family)',
            maxTextSize: 200000,
            themeVariables: {
                background: '#ffffff',
                mainBkg: '#f4f4ff',
                secondBkg: '#ffffff',
                primaryColor: '#f4f4ff',
                primaryBorderColor: '#7c6fbd',
                primaryTextColor: '#111111',
                lineColor: '#333333',
                textColor: '#111111',
                secondaryTextColor: '#111111',
                tertiaryTextColor: '#111111',
                labelTextColor: '#111111',
                nodeTextColor: '#111111',
                stateLabelColor: '#111111',
                stateBkg: '#f4f4ff',
                stateBorder: '#7c6fbd',
                compositeBackground: '#ffffff',
                edgeLabelBackground: '#ffffff',
                actorBkg: '#f4f4ff',
                actorBorder: '#7c6fbd',
                actorTextColor: '#111111',
                signalColor: '#333333',
                signalTextColor: '#111111',
                noteBkgColor: '#fff7cc',
                noteTextColor: '#111111'
            }
        });

        await Promise.all(blocks.map(async (block, index) => {
            const source = block.textContent || '';
            const pre = block.closest('pre');
            const diagram = document.createElement('div');
            diagram.className = 'mermaid-diagram';
            diagram.setAttribute('role', 'img');

            try {
                const renderId = `omni-md-mermaid-${Date.now()}-${index}-${Math.floor(Math.random() * 100000)}`;
                const result = await mermaid.render(renderId, source);
                diagram.innerHTML = sanitizeSvg(result.svg);
            } catch (error) {
                diagram.classList.add('is-invalid');
                diagram.textContent = error instanceof Error ? error.message : 'Unable to render Mermaid diagram.';
            }

            if (pre) {
                pre.replaceWith(diagram);
            }
        }));
    }

    function renderPlantumlBlocks(root) {
        const blocks = Array.from(root.querySelectorAll('pre > code.language-plantuml, pre > code.lang-plantuml, pre > code.language-puml, pre > code.lang-puml, pre > code.language-uml, pre > code.lang-uml'));
        state.diagramCount += blocks.length;

        blocks.forEach((block) => {
            const source = block.textContent || '';
            const pre = block.closest('pre');
            const diagram = document.createElement('div');
            diagram.className = 'plantuml-diagram';
            diagram.setAttribute('role', 'img');

            try {
                const svg = renderPlantuml(source, { document });
                svg.setAttribute('role', 'img');
                svg.setAttribute('aria-label', 'Rendered PlantUML diagram');
                const serialized = new XMLSerializer().serializeToString(svg);
                diagram.innerHTML = sanitizeSvg(serialized);
            } catch (error) {
                diagram.classList.add('is-invalid');
                diagram.textContent = error instanceof Error ? error.message : 'Unable to render PlantUML diagram.';
            }

            if (pre) {
                pre.replaceWith(diagram);
            }
        });
    }

    async function copyText(text, successText) {
        await navigator.clipboard.writeText(text);
        setStatus(successText, 'valid');
        window.setTimeout(() => setStatus('Rendered', 'valid'), 1600);
    }

    function pushUndoSnapshot(value) {
        if (state.undoStack[state.undoStack.length - 1] === value) {
            return;
        }

        state.undoStack.push(value);
        if (state.undoStack.length > 100) {
            state.undoStack.shift();
        }
    }

    function setEditorValue(value) {
        state.isApplyingHistory = true;
        els.sourceView.value = value;
        state.source = value;
        state.lastEditorValue = value;
        state.isApplyingHistory = false;
        markDirty(value !== state.savedSource);
    }

    function undoEditorChange() {
        if (state.undoStack.length === 0) {
            return;
        }

        state.redoStack.push(els.sourceView.value);
        setEditorValue(state.undoStack.pop());
    }

    function redoEditorChange() {
        if (state.redoStack.length === 0) {
            return;
        }

        state.undoStack.push(els.sourceView.value);
        setEditorValue(state.redoStack.pop());
    }

    async function saveSource() {
        if (!vscodeApi) {
            setStatus('Save failed', 'invalid');
            showMessage('VS Code API is unavailable, so the source could not be saved.');
            return;
        }

        setStatus('Saving', '');
        els.sourceCaption.textContent = 'Saving';
        vscodeApi.postMessage({
            type: 'saveSource',
            source: state.source
        });
    }

    async function renderMarkdown(options = { save: false }) {
        try {
            state.source = els.sourceView.value;
            const rawHtml = marked.parse(state.source);
            state.renderedHtml = sanitizeRenderedHtml(rawHtml);
            els.markdownPreview.innerHTML = state.renderedHtml;
            hardenLinksAndImages(els.markdownPreview);
            renderCodeHighlights(els.markdownPreview);
            await renderMermaidBlocks(els.markdownPreview);
            renderPlantumlBlocks(els.markdownPreview);

            const lineCount = state.source.length === 0 ? 0 : state.source.split(/\r?\n/).length;
            const wordCount = (state.source.match(/\S+/g) || []).length;
            els.summaryText.textContent = `${lineCount} lines, ${wordCount} words`;
            els.previewCaption.textContent = state.diagramCount > 0
                ? `HTML rendered, ${state.diagramCount} diagram(s)`
                : 'HTML rendered';
            els.sourceCaption.textContent = state.isDirty ? 'Rendered, saving' : 'Rendered';
            setStatus('Rendered', 'valid');
            showMessage('');

            if (options.save) {
                await saveSource();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to render Markdown.';
            els.markdownPreview.textContent = '';
            state.renderedHtml = '';
            els.previewCaption.textContent = 'Render failed';
            setStatus('Invalid', 'invalid');
            showMessage(message);
        }
    }

    function bindEvents() {
        document.querySelectorAll('[data-view-mode]').forEach((button) => {
            button.addEventListener('click', () => setViewMode(button.dataset.viewMode));
        });

        els.renderBtn.addEventListener('click', async () => {
            await renderMarkdown({ save: true });
        });

        els.sourceView.addEventListener('input', () => {
            if (!state.isApplyingHistory) {
                pushUndoSnapshot(state.lastEditorValue);
                state.redoStack = [];
                state.lastEditorValue = els.sourceView.value;
                state.source = els.sourceView.value;
            }

            markDirty(els.sourceView.value !== state.savedSource);
        });

        els.sourceView.addEventListener('keydown', async (event) => {
            const key = event.key.toLowerCase();
            const wantsUndo = (event.metaKey || event.ctrlKey) && key === 'z' && !event.shiftKey;
            const wantsRedo = (event.metaKey || event.ctrlKey) && (key === 'y' || key === 'z' && event.shiftKey);
            const wantsSave = (event.metaKey || event.ctrlKey) && key === 's';
            const wantsRender = event.shiftKey && event.key === 'Enter';

            if (wantsUndo) {
                event.preventDefault();
                undoEditorChange();
                return;
            }

            if (wantsRedo) {
                event.preventDefault();
                redoEditorChange();
                return;
            }

            if (wantsSave || wantsRender) {
                event.preventDefault();
                await renderMarkdown({ save: true });
            }
        });

        els.copyHtmlBtn.addEventListener('click', async () => {
            await copyText(state.renderedHtml, 'HTML copied');
        });

        els.copySourceBtn.addEventListener('click', async () => {
            await copyText(els.sourceView.value, 'Source copied');
        });
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type !== 'saveSourceResult') {
            return;
        }

        if (message.ok) {
            state.savedSource = state.source;
            state.lastEditorValue = state.source;
            markDirty(false);
            setStatus('Saved', 'valid');
            els.sourceCaption.textContent = 'Saved';
            showMessage('');
            return;
        }

        setStatus('Save failed', 'invalid');
        els.sourceCaption.textContent = 'Save failed';
        showMessage(message.message || 'Unable to save Markdown source.');
    });

    els.sourceView.value = state.source;
    bindEvents();
    setViewMode('preview');
    renderMarkdown({ save: false });
})();
