(function() {
    'use strict';

    // Elements
    const hwpContent = document.getElementById('hwpContent');
    const loading = document.getElementById('loading');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const zoomResetBtn = document.getElementById('zoomReset');
    const zoomLevelSpan = document.getElementById('zoomLevel');
    const printBtn = document.getElementById('printBtn');

    // State
    let currentZoom = 100;
    const MIN_ZOOM = 25;
    const MAX_ZOOM = 200;
    const ZOOM_STEP = 10;

    // Initialize
    function init() {
        // Hide loading indicator
        if (loading) {
            loading.style.display = 'none';
        }

        // Setup event listeners
        setupEventListeners();
    }

    function setupEventListeners() {
        // Zoom controls
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', zoomIn);
        }
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', zoomOut);
        }
        if (zoomResetBtn) {
            zoomResetBtn.addEventListener('click', zoomReset);
        }
        if (printBtn) {
            printBtn.addEventListener('click', printDocument);
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboard);

        // Mouse wheel zoom with Ctrl
        document.addEventListener('wheel', handleWheel, { passive: false });
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

    function applyZoom() {
        if (hwpContent) {
            hwpContent.style.transform = `scale(${currentZoom / 100})`;
        }
        if (zoomLevelSpan) {
            zoomLevelSpan.textContent = `${currentZoom}%`;
        }
    }

    function handleKeyboard(e) {
        // Ctrl + Plus: Zoom in
        if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
            e.preventDefault();
            zoomIn();
        }
        // Ctrl + Minus: Zoom out
        else if (e.ctrlKey && e.key === '-') {
            e.preventDefault();
            zoomOut();
        }
        // Ctrl + 0: Reset zoom
        else if (e.ctrlKey && e.key === '0') {
            e.preventDefault();
            zoomReset();
        }
        // Ctrl + P: Print
        else if (e.ctrlKey && e.key === 'p') {
            e.preventDefault();
            printDocument();
        }
    }

    function handleWheel(e) {
        if (e.ctrlKey) {
            e.preventDefault();
            if (e.deltaY < 0) {
                zoomIn();
            } else {
                zoomOut();
            }
        }
    }

    function printDocument() {
        window.print();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
