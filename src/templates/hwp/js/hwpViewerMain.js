(function() {
    'use strict';

    const viewerPayload = window.__HWP_VIEWER_DATA__ || {};
    const hwpContent = document.getElementById('hwpContent');
    const hwpViewport = document.getElementById('hwpViewport');
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const zoomResetBtn = document.getElementById('zoomReset');
    const zoomLevelSpan = document.getElementById('zoomLevel');
    const pageCountSpan = document.getElementById('pageCount');
    const documentContainer = document.getElementById('documentContainer');

    let currentZoom = 100;
    const MIN_ZOOM = 25;
    const MAX_ZOOM = 300;
    const ZOOM_STEP = 10;

    function showLoading(visible) {
        if (loading) {
            loading.style.display = visible ? 'flex' : 'none';
        }
    }

    function showError(message) {
        if (error) {
            error.textContent = message;
            error.style.display = 'flex';
        }

        if (pageCountSpan) {
            pageCountSpan.textContent = '오류';
        }
    }

    function hideError() {
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }
    }

    function applyZoom() {
        if (hwpContent) {
            hwpContent.style.transform = `scale(${currentZoom / 100})`;
        }

        if (zoomLevelSpan) {
            zoomLevelSpan.textContent = `${currentZoom}%`;
        }
    }

    function zoomIn() {
        if (currentZoom < MAX_ZOOM) {
            currentZoom += ZOOM_STEP;
            applyZoom();
        }
    }

    function zoomOut() {
        if (currentZoom > MIN_ZOOM) {
            currentZoom -= ZOOM_STEP;
            applyZoom();
        }
    }

    function zoomReset() {
        currentZoom = 100;
        applyZoom();
    }

    function handleKeyboard(event) {
        if (event.ctrlKey && (event.key === '+' || event.key === '=')) {
            event.preventDefault();
            zoomIn();
        } else if (event.ctrlKey && event.key === '-') {
            event.preventDefault();
            zoomOut();
        } else if (event.ctrlKey && event.key === '0') {
            event.preventDefault();
            zoomReset();
        }
    }

    function handleWheel(event) {
        if (!event.ctrlKey) {
            return;
        }

        event.preventDefault();

        if (event.deltaY < 0) {
            zoomIn();
        } else {
            zoomOut();
        }
    }

    function installMeasureTextWidth() {
        let context = null;
        let lastFont = '';

        globalThis.measureTextWidth = (font, text) => {
            if (!context) {
                context = document.createElement('canvas').getContext('2d');
            }

            if (!context) {
                return String(text || '').length * 10;
            }

            if (font && font !== lastFont) {
                context.font = font;
                lastFont = font;
            }

            return context.measureText(String(text || '')).width;
        };
    }

    function setPageCount(count) {
        if (!pageCountSpan) {
            return;
        }

        if (!Number.isFinite(count)) {
            pageCountSpan.textContent = '페이지 수 확인 불가';
            return;
        }

        pageCountSpan.textContent = `${count} page${count === 1 ? '' : 's'}`;
    }

    function createPageElement(pageIndex, svgMarkup) {
        const pageElement = document.createElement('section');
        pageElement.className = 'rhwp-page';
        pageElement.dataset.pageIndex = String(pageIndex);
        pageElement.innerHTML = svgMarkup;

        const svgElement = pageElement.querySelector('svg');
        if (svgElement) {
            svgElement.classList.add('rhwp-page-svg');
            svgElement.setAttribute('preserveAspectRatio', 'xMidYMin meet');
        }

        return pageElement;
    }

    function importRhwpModule(moduleUri) {
        return new Function('modulePath', 'return import(/* webpackIgnore: true */ modulePath);')(moduleUri);
    }

    async function renderDocument() {
        if (!viewerPayload.documentUri || !viewerPayload.rhwpModuleUri || !viewerPayload.rhwpWasmUri) {
            throw new Error('HWP viewer payload is incomplete.');
        }

        installMeasureTextWidth();

        const rhwpModule = await importRhwpModule(viewerPayload.rhwpModuleUri);
        await rhwpModule.default({ module_or_path: viewerPayload.rhwpWasmUri });

        const response = await fetch(viewerPayload.documentUri);
        if (!response.ok) {
            throw new Error(`문서를 읽지 못했습니다. (${response.status})`);
        }

        const doc = new rhwpModule.HwpDocument(new Uint8Array(await response.arrayBuffer()));

        try {
            const pageCount = doc.pageCount();
            setPageCount(pageCount);
            hwpViewport.innerHTML = '';

            for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
                hwpViewport.appendChild(createPageElement(pageIndex, doc.renderPageSvg(pageIndex)));
            }
        } finally {
            if (typeof doc.free === 'function') {
                doc.free();
            }
        }
    }

    async function initialize() {
        showLoading(true);
        hideError();
        applyZoom();

        try {
            await renderDocument();
        } catch (renderError) {
            const message = renderError instanceof Error ? renderError.message : '알 수 없는 오류가 발생했습니다.';
            showError(message);
        } finally {
            showLoading(false);
        }
    }

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', zoomIn);
    }

    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', zoomOut);
    }

    if (zoomResetBtn) {
        zoomResetBtn.addEventListener('click', zoomReset);
    }

    document.addEventListener('keydown', handleKeyboard);

    if (documentContainer) {
        documentContainer.addEventListener('wheel', handleWheel, { passive: false });
    }

    initialize();
})();
