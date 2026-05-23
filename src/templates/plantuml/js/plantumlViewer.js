(function () {
    const state = {
        source: String(window.plantumlSource || ''),
        viewMode: 'diagram',
        renderMode: 'light',
        zoom: 1,
        initialized: false,
        objectUrl: ''
    };

    const els = {
        workspace: document.getElementById('workspace'),
        diagramPanel: document.getElementById('diagramPanel'),
        sourcePanel: document.getElementById('sourcePanel'),
        sourceView: document.getElementById('sourceView'),
        diagramImage: document.getElementById('diagramImage'),
        diagramOutput: document.getElementById('diagramOutput'),
        diagramCaption: document.getElementById('diagramCaption'),
        sourceCaption: document.getElementById('sourceCaption'),
        messagePanel: document.getElementById('messagePanel'),
        statusBadge: document.getElementById('statusBadge'),
        summaryText: document.getElementById('summaryText'),
        renderModeSelect: document.getElementById('renderModeSelect'),
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

    function getCheerpjPlantumlPath() {
        const base = new URL('vendor/', document.baseURI);
        const vendorPath = base.pathname.replace(/\/$/, '');
        return `/app${vendorPath.replace(/\/$/, '')}`;
    }

    async function initializeRenderer() {
        if (state.initialized) {
            return;
        }

        if (!window.cheerpjInit || !window.plantuml) {
            throw new Error('PlantUML browser renderer could not be loaded.');
        }

        setStatus('Loading engine', '');
        els.diagramCaption.textContent = 'Loading PlantUML runtime';
        await window.plantuml.initialize(getCheerpjPlantumlPath());
        state.initialized = true;
    }

    async function renderDiagram() {
        setStatus('Rendering', '');
        showMessage('');

        try {
            await initializeRenderer();
            const renderStartedAt = Date.now();
            els.diagramCaption.textContent = 'Rendering diagram';
            const blob = await window.plantuml.renderPng(state.source, state.renderMode);

            if (state.objectUrl) {
                URL.revokeObjectURL(state.objectUrl);
            }

            state.objectUrl = URL.createObjectURL(blob);
            els.diagramImage.src = state.objectUrl;
            els.diagramImage.classList.remove('is-hidden');
            setStatus('Rendered', 'valid');
            els.diagramCaption.textContent = `${state.renderMode} mode, ${Date.now() - renderStartedAt} ms`;
            els.summaryText.textContent = `${state.source.split(/\r?\n/).length} lines`;
        } catch (error) {
            els.diagramImage.removeAttribute('src');
            els.diagramImage.classList.add('is-hidden');
            setStatus('Invalid', 'invalid');
            showMessage(normalizeRenderError(error));
            els.diagramCaption.textContent = 'Render failed';
        }
    }

    async function writeClipboard(text) {
        await navigator.clipboard.writeText(text);
    }

    function bindEvents() {
        document.querySelectorAll('[data-view-mode]').forEach((button) => {
            button.addEventListener('click', () => setViewMode(button.dataset.viewMode));
        });

        els.renderModeSelect.addEventListener('change', async () => {
            state.renderMode = els.renderModeSelect.value;
            await renderDiagram();
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

        document.getElementById('copySourceBtn').addEventListener('click', async () => {
            await writeClipboard(state.source);
            els.sourceCaption.textContent = 'Source copied';
        });
    }

    window.addEventListener('beforeunload', () => {
        if (state.objectUrl) {
            URL.revokeObjectURL(state.objectUrl);
        }
    });

    els.sourceView.value = state.source;
    setViewMode('diagram');
    applyZoom();
    bindEvents();
    renderDiagram();
})();
