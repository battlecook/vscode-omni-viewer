import { render } from 'puml-canvas-js';

(function () {
    const state = {
        source: String(window.plantumlSource || ''),
        savedSource: String(window.plantumlSource || ''),
        viewMode: 'diagram',
        renderMode: 'light',
        zoom: 1,
        svg: '',
        isDirty: false,
        isApplyingHistory: false,
        lastEditorValue: String(window.plantumlSource || ''),
        undoStack: [],
        redoStack: []
    };

    const vscodeApi = typeof acquireVsCodeApi === 'function'
        ? acquireVsCodeApi()
        : window.__omniVsCode__ || null;

    const els = {
        workspace: document.getElementById('workspace'),
        diagramPanel: document.getElementById('diagramPanel'),
        sourcePanel: document.getElementById('sourcePanel'),
        sourceView: document.getElementById('sourceView'),
        diagramOutput: document.getElementById('diagramOutput'),
        diagramCaption: document.getElementById('diagramCaption'),
        sourceCaption: document.getElementById('sourceCaption'),
        messagePanel: document.getElementById('messagePanel'),
        statusBadge: document.getElementById('statusBadge'),
        summaryText: document.getElementById('summaryText'),
        renderModeSelect: document.getElementById('renderModeSelect'),
        renderBtn: document.getElementById('renderBtn'),
        saveBtn: document.getElementById('saveBtn'),
        zoomResetBtn: document.getElementById('zoomResetBtn')
    };

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
        els.saveBtn.classList.toggle('is-dirty', isDirty);

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
        els.diagramPanel.classList.toggle('is-hidden', mode === 'source');
        els.sourcePanel.classList.toggle('is-hidden', mode === 'diagram');
        document.querySelectorAll('[data-view-mode]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.viewMode === mode);
        });
    }

    function applyZoom() {
        els.diagramOutput.style.transform = `scale(${state.zoom})`;
        els.zoomResetBtn.textContent = `${Math.round(state.zoom * 100)}%`;
    }

    function normalizeRenderError(error) {
        if (!error) {
            return 'Unable to render PlantUML diagram.';
        }

        if (typeof error === 'string') {
            return error;
        }

        if (error.message) {
            return error.message;
        }

        return String(error);
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

    async function renderDiagram(options = { save: false }) {
        state.source = els.sourceView.value;
        setStatus('Rendering', '');
        showMessage('');

        try {
            const renderStartedAt = Date.now();
            els.diagramCaption.textContent = 'Rendering diagram';
            const svg = render(state.source, { document });
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', 'Rendered PlantUML diagram');
            state.svg = new XMLSerializer().serializeToString(svg);
            els.diagramOutput.replaceChildren(svg);
            setStatus('Rendered', 'valid');
            els.diagramCaption.textContent = `${state.renderMode} mode, ${Date.now() - renderStartedAt} ms`;
            els.sourceCaption.textContent = state.isDirty ? 'Rendered, unsaved' : 'Rendered';
            els.summaryText.textContent = `${state.source.split(/\r?\n/).length} lines`;

            if (options.save) {
                await saveSource();
            }
        } catch (error) {
            state.svg = '';
            els.diagramOutput.replaceChildren();
            setStatus('Invalid', 'invalid');
            showMessage(normalizeRenderError(error));
            els.diagramCaption.textContent = 'Render failed';
        }
    }

    async function writeClipboard(text) {
        await navigator.clipboard.writeText(text);
    }

    async function saveSource() {
        const source = els.sourceView.value;
        state.source = source;

        if (!vscodeApi) {
            setStatus('Save failed', 'invalid');
            showMessage('VS Code API is unavailable, so the source could not be saved.');
            return;
        }

        setStatus('Saving', '');
        els.sourceCaption.textContent = 'Saving';
        vscodeApi.postMessage({
            type: 'saveSource',
            source
        });
    }

    function bindEvents() {
        document.querySelectorAll('[data-view-mode]').forEach((button) => {
            button.addEventListener('click', () => setViewMode(button.dataset.viewMode));
        });

        els.renderModeSelect.addEventListener('change', async () => {
            state.renderMode = els.renderModeSelect.value;
            await renderDiagram();
        });

        els.renderBtn.addEventListener('click', async () => {
            await renderDiagram({ save: true });
        });

        els.saveBtn.addEventListener('click', async () => {
            await saveSource();
        });

        els.sourceView.addEventListener('input', () => {
            if (!state.isApplyingHistory) {
                pushUndoSnapshot(state.lastEditorValue);
                state.redoStack = [];
                state.lastEditorValue = els.sourceView.value;
            }

            markDirty(els.sourceView.value !== state.savedSource);
        });

        els.sourceView.addEventListener('keydown', async (event) => {
            const key = event.key.toLowerCase();
            const wantsUndo = (event.metaKey || event.ctrlKey) && key === 'z' && !event.shiftKey;
            const wantsRedo = (event.metaKey || event.ctrlKey) && (key === 'y' || key === 'z' && event.shiftKey);

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

            if (event.shiftKey && event.key === 'Enter') {
                event.preventDefault();
                await renderDiagram({ save: true });
            }
        });

        document.getElementById('zoomOutBtn').addEventListener('click', () => {
            state.zoom = Math.max(0.25, Number((state.zoom - 0.1).toFixed(2)));
            applyZoom();
        });

        document.getElementById('zoomInBtn').addEventListener('click', () => {
            state.zoom = Math.min(3, Number((state.zoom + 0.1).toFixed(2)));
            applyZoom();
        });

        els.zoomResetBtn.addEventListener('click', () => {
            state.zoom = 1;
            applyZoom();
        });

        document.getElementById('copySvgBtn').addEventListener('click', async () => {
            if (state.svg) {
                await writeClipboard(state.svg);
                els.diagramCaption.textContent = 'SVG copied';
            }
        });

        document.getElementById('copySourceBtn').addEventListener('click', async () => {
            await writeClipboard(els.sourceView.value);
            els.sourceCaption.textContent = 'Source copied';
        });
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type !== 'saveSourceResult') {
            return;
        }

        if (message.ok) {
            state.source = els.sourceView.value;
            state.savedSource = els.sourceView.value;
            state.lastEditorValue = els.sourceView.value;
            state.undoStack = [];
            state.redoStack = [];
            markDirty(false);
            setStatus('Saved', 'valid');
            els.sourceCaption.textContent = 'Saved';
            showMessage('');
            return;
        }

        setStatus('Save failed', 'invalid');
        els.sourceCaption.textContent = 'Save failed';
        showMessage(message.message || 'Unable to save PlantUML source.');
    });

    els.sourceView.value = state.source;
    setViewMode('diagram');
    applyZoom();
    bindEvents();
    renderDiagram();
})();
