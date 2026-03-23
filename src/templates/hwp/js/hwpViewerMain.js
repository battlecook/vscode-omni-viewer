(function() {
    'use strict';

    const viewerPayload = window.__HWP_VIEWER_DATA__ || {};
    const layoutDocument = viewerPayload.document || null;

    const hwpContent = document.getElementById('hwpContent');
    const hwpViewport = document.getElementById('hwpViewport');
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const zoomResetBtn = document.getElementById('zoomReset');
    const zoomLevelSpan = document.getElementById('zoomLevel');
    const printBtn = document.getElementById('printBtn');

    let currentZoom = 100;
    const MIN_ZOOM = 25;
    const MAX_ZOOM = 200;
    const ZOOM_STEP = 10;

    function showLoading(visible) {
        if (loading) {
            loading.style.display = visible ? 'flex' : 'none';
        }
    }

    function showError(message) {
        if (!error) {
            return;
        }

        error.textContent = message;
        error.style.display = 'block';
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

    function printDocument() {
        window.print();
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
        } else if (event.ctrlKey && event.key === 'p') {
            event.preventDefault();
            printDocument();
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

    function createRunElement(run) {
        const span = document.createElement('span');
        span.textContent = run.text || '';

        if (run.fontSizePt) {
            span.style.fontSize = `${run.fontSizePt}pt`;
        }

        if (run.fontFamily) {
            span.style.fontFamily = run.fontFamily;
        }

        if (run.fontWeight) {
            span.style.fontWeight = run.fontWeight;
        }

        if (run.fontStyle) {
            span.style.fontStyle = run.fontStyle;
        }

        if (run.color) {
            span.style.color = run.color;
        }

        if (run.backgroundColor) {
            span.style.backgroundColor = run.backgroundColor;
        }

        return span;
    }

    function resolveAnchorReference(pageElement, anchorScope, page) {
        const pageRect = pageElement.getBoundingClientRect();
        const resolveRelativePosition = (element, fallbackLeft, fallbackTop) => {
            if (!element) {
                return { leftPt: fallbackLeft, topPt: fallbackTop };
            }

            const elementRect = element.getBoundingClientRect();
            return {
                leftPt: elementRect.left - pageRect.left,
                topPt: elementRect.top - pageRect.top
            };
        };

        if (anchorScope === 'cell') {
            return resolveRelativePosition(
                pageElement.querySelector('.layout-table-cell'),
                page?.paddingPt?.left || 0,
                page?.paddingPt?.top || 0
            );
        }

        if (anchorScope === 'character') {
            return resolveRelativePosition(
                pageElement.querySelector('.layout-paragraph span'),
                page?.paddingPt?.left || 0,
                page?.paddingPt?.top || 0
            );
        }

        if (anchorScope === 'paragraph') {
            return resolveRelativePosition(
                pageElement.querySelector('.layout-paragraph'),
                page?.paddingPt?.left || 0,
                page?.paddingPt?.top || 0
            );
        }

        return {
            leftPt: 0,
            topPt: 0
        };
    }

    function resolveAbsoluteOffsets(block, page, pageElement) {
        const paddingLeft = page?.paddingPt?.left || 0;
        const paddingTop = page?.paddingPt?.top || 0;
        const anchorScope = block.anchorScope || 'page';
        const anchorReference = resolveAnchorReference(pageElement, anchorScope, page);

        if (anchorScope === 'page') {
            return {
                leftPt: block.leftPt || 0,
                topPt: block.topPt || 0
            };
        }

        if (anchorScope === 'cell') {
            return {
                leftPt: (block.leftPt || 0) + anchorReference.leftPt + 12,
                topPt: (block.topPt || 0) + anchorReference.topPt + 8
            };
        }

        if (anchorScope === 'character') {
            return {
                leftPt: (block.leftPt || 0) + anchorReference.leftPt + 6,
                topPt: (block.topPt || 0) + anchorReference.topPt + 2
            };
        }

        return {
            leftPt: (block.leftPt || 0) + (anchorReference.leftPt || paddingLeft),
            topPt: (block.topPt || 0) + (anchorReference.topPt || paddingTop)
        };
    }

    function createParagraphElement(paragraph) {
        const element = document.createElement('p');
        element.className = 'layout-paragraph';
        element.dataset.paragraphId = paragraph.id;
        element.style.textAlign = paragraph.align || 'left';
        element.style.lineHeight = String(paragraph.lineHeight || 1.65);
        element.style.marginTop = `${paragraph.marginTopPt || 0}pt`;
        element.style.marginBottom = `${paragraph.marginBottomPt || 0}pt`;
        element.style.marginLeft = `${paragraph.marginLeftPt || 0}pt`;
        element.style.marginRight = `${paragraph.marginRightPt || 0}pt`;
        element.style.textIndent = `${paragraph.textIndentPt || 0}pt`;

        if (paragraph.fontSizePt) {
            element.style.fontSize = `${paragraph.fontSizePt}pt`;
        }

        const runs = Array.isArray(paragraph.runs) ? paragraph.runs : [];
        if (runs.length === 0) {
            element.innerHTML = '&nbsp;';
            return element;
        }

        for (const run of runs) {
            element.appendChild(createRunElement(run));
        }

        return element;
    }

    function createTableElement(table) {
        const wrapper = document.createElement('div');
        wrapper.className = 'layout-table-block';
        wrapper.style.marginTop = `${table.marginTopPt || 0}pt`;
        wrapper.style.marginBottom = `${table.marginBottomPt || 0}pt`;

        const tableElement = document.createElement('table');
        tableElement.className = 'layout-table';

        if (table.widthPt) {
            tableElement.style.width = `${table.widthPt}pt`;
        }

        for (const row of table.rows || []) {
            const tr = document.createElement('tr');

            for (const cell of row.cells || []) {
                const td = document.createElement('td');
                td.textContent = cell.text || '';
                td.className = 'layout-table-cell';

                if (cell.widthPt) {
                    td.style.width = `${cell.widthPt}pt`;
                }

                if (cell.heightPt) {
                    td.style.minHeight = `${cell.heightPt}pt`;
                }

                if (cell.backgroundColor) {
                    td.style.backgroundColor = cell.backgroundColor;
                }

                if (cell.borderColor) {
                    td.style.borderColor = cell.borderColor;
                }

                if (cell.borderWidthPt) {
                    td.style.borderWidth = `${cell.borderWidthPt}pt`;
                }

                if (cell.textAlign) {
                    td.style.textAlign = cell.textAlign;
                }

                if (cell.colSpan && cell.colSpan > 1) {
                    td.colSpan = cell.colSpan;
                }

                if (cell.rowSpan && cell.rowSpan > 1) {
                    td.rowSpan = cell.rowSpan;
                }

                tr.appendChild(td);
            }

            tableElement.appendChild(tr);
        }

        wrapper.appendChild(tableElement);
        return wrapper;
    }

    function createImageElement(image, page, pageElement) {
        const wrapper = document.createElement('figure');
        wrapper.className = 'layout-image-block';
        if (image.anchorScope) {
            wrapper.dataset.anchorScope = image.anchorScope;
        }
        wrapper.style.marginTop = `${image.marginTopPt || 0}pt`;
        wrapper.style.marginBottom = `${image.marginBottomPt || 0}pt`;

        if (image.positioning === 'absolute') {
            const absoluteOffsets = resolveAbsoluteOffsets(image, page, pageElement);
            wrapper.classList.add('layout-image-block-absolute');
            wrapper.style.left = `${absoluteOffsets.leftPt}pt`;
            wrapper.style.top = `${absoluteOffsets.topPt}pt`;
            wrapper.style.zIndex = `${image.zIndex || 1}`;
            wrapper.style.marginTop = '0';
            wrapper.style.marginBottom = '0';
        }

        if (image.src) {
            const img = document.createElement('img');
            img.src = image.src;
            img.alt = image.alt || 'embedded image';
            img.className = 'layout-image';

            if (image.widthPt) {
                img.style.width = `${image.widthPt}pt`;
            }

            if (image.heightPt) {
                img.style.height = `${image.heightPt}pt`;
            }

            wrapper.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'layout-image-placeholder';
            placeholder.textContent = image.alt || 'embedded image';
            wrapper.appendChild(placeholder);
        }

        return wrapper;
    }

    function createTextBoxElement(textBox, page, pageElement) {
        const wrapper = document.createElement('section');
        wrapper.className = 'layout-textbox-block';
        if (textBox.anchorScope) {
            wrapper.dataset.anchorScope = textBox.anchorScope;
        }
        if (textBox.shapeType) {
            wrapper.classList.add(`layout-textbox-shape-${textBox.shapeType}`);
        }
        wrapper.style.marginTop = `${textBox.marginTopPt || 0}pt`;
        wrapper.style.marginBottom = `${textBox.marginBottomPt || 0}pt`;
        wrapper.style.textAlign = textBox.textAlign || 'left';
        const content = document.createElement('div');
        content.className = 'layout-textbox-content';
        content.textContent = textBox.text || '';

        if (textBox.widthPt) {
            wrapper.style.width = `${textBox.widthPt}pt`;
        }

        if (textBox.heightPt) {
            wrapper.style.minHeight = `${textBox.heightPt}pt`;
        }

        if (textBox.color) {
            wrapper.style.color = textBox.color;
        }

        if (textBox.backgroundColor) {
            wrapper.style.backgroundColor = textBox.backgroundColor;
        }

        if (textBox.backgroundImage) {
            wrapper.style.backgroundImage = textBox.backgroundImage;
        }

        if (textBox.borderColor) {
            wrapper.style.borderColor = textBox.borderColor;
        }

        if (textBox.borderWidthPt) {
            wrapper.style.borderWidth = `${textBox.borderWidthPt}pt`;
        }

        if (textBox.borderStyle) {
            wrapper.style.borderStyle = textBox.borderStyle;
        }

        if (textBox.borderRadiusPt) {
            wrapper.style.borderRadius = `${textBox.borderRadiusPt}pt`;
        }

        if (textBox.paddingPt) {
            wrapper.style.padding = `${textBox.paddingPt}pt`;
        }

        if (typeof textBox.opacity === 'number') {
            wrapper.style.opacity = `${textBox.opacity}`;
        }

        if (textBox.boxShadowCss) {
            wrapper.style.boxShadow = textBox.boxShadowCss;
        }

        if (typeof textBox.rotateDeg === 'number' && Number.isFinite(textBox.rotateDeg)) {
            wrapper.style.transform = `rotate(${textBox.rotateDeg}deg)`;
            wrapper.style.transformOrigin = 'center center';
        }

        if (textBox.positioning === 'absolute') {
            const absoluteOffsets = resolveAbsoluteOffsets(textBox, page, pageElement);
            wrapper.classList.add('layout-textbox-block-absolute');
            wrapper.style.left = `${absoluteOffsets.leftPt}pt`;
            wrapper.style.top = `${absoluteOffsets.topPt}pt`;
            wrapper.style.zIndex = `${textBox.zIndex || 1}`;
            wrapper.style.marginTop = '0';
            wrapper.style.marginBottom = '0';
        }

        if (textBox.markerStart) {
            wrapper.appendChild(createTextBoxMarker(textBox.markerStart, 'start'));
        }

        wrapper.appendChild(content);

        if (textBox.markerEnd) {
            wrapper.appendChild(createTextBoxMarker(textBox.markerEnd, 'end'));
        }

        return wrapper;
    }

    function createTextBoxMarker(markerType, side) {
        const marker = document.createElement('span');
        marker.className = `layout-textbox-marker layout-textbox-marker-${side}`;
        marker.dataset.markerType = markerType;
        marker.textContent = markerType === 'diamond' ? '◆' : markerType === 'circle' ? '●' : '▶';
        return marker;
    }

    function createLineElement(line, page, pageElement) {
        const wrapper = document.createElement('div');
        wrapper.className = 'layout-line-block';
        if (line.anchorScope) {
            wrapper.dataset.anchorScope = line.anchorScope;
        }
        wrapper.style.marginTop = `${line.marginTopPt || 0}pt`;
        wrapper.style.marginBottom = `${line.marginBottomPt || 0}pt`;

        if (line.positioning === 'absolute') {
            const absoluteOffsets = resolveAbsoluteOffsets(line, page, pageElement);
            wrapper.classList.add('layout-line-block-absolute');
            wrapper.style.left = `${absoluteOffsets.leftPt}pt`;
            wrapper.style.top = `${absoluteOffsets.topPt}pt`;
            wrapper.style.zIndex = `${line.zIndex || 1}`;
            wrapper.style.marginTop = '0';
            wrapper.style.marginBottom = '0';
        }

        const width = Math.max(line.widthPt || Math.abs((line.x2Pt || 0) - (line.x1Pt || 0)) || 80, 1);
        const height = Math.max(line.heightPt || Math.abs((line.y2Pt || 0) - (line.y1Pt || 0)) || 8, 8);
        const x1 = typeof line.x1Pt === 'number' ? line.x1Pt : 0;
        const y1 = typeof line.y1Pt === 'number' ? line.y1Pt : height / 2;
        const x2 = typeof line.x2Pt === 'number' ? line.x2Pt : width;
        const y2 = typeof line.y2Pt === 'number' ? line.y2Pt : height / 2;
        wrapper.style.width = `${width}pt`;
        wrapper.style.height = `${height}pt`;

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'layout-line-svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', `${width}pt`);
        svg.setAttribute('height', `${height}pt`);

        const defs = document.createElementNS(svgNS, 'defs');
        const color = line.color || '#333';
        const markerPrefix = `line-${Math.random().toString(36).slice(2, 9)}`;

        if (line.markerStart) {
            defs.appendChild(createSvgMarker(svgNS, `${markerPrefix}-start`, line.markerStart, color));
        }

        if (line.markerEnd) {
            defs.appendChild(createSvgMarker(svgNS, `${markerPrefix}-end`, line.markerEnd, color));
        }

        if (defs.childNodes.length > 0) {
            svg.appendChild(defs);
        }

        const stroke = document.createElementNS(svgNS, line.pathD ? 'path' : 'line');
        stroke.setAttribute('class', 'layout-line-stroke');
        if (line.pathD) {
            stroke.setAttribute('d', line.pathD);
            stroke.setAttribute('fill', 'none');
        } else {
            stroke.setAttribute('x1', `${x1}`);
            stroke.setAttribute('y1', `${y1}`);
            stroke.setAttribute('x2', `${x2}`);
            stroke.setAttribute('y2', `${y2}`);
        }
        stroke.setAttribute('stroke', color);
        stroke.setAttribute('stroke-width', `${Math.max(line.lineWidthPt || 1, 1)}`);
        stroke.setAttribute('stroke-linecap', 'round');

        if (line.lineStyle === 'dashed') {
            stroke.setAttribute('stroke-dasharray', '8 4');
        } else if (line.lineStyle === 'dotted') {
            stroke.setAttribute('stroke-dasharray', '1 5');
        }

        if (line.markerStart) {
            stroke.setAttribute('marker-start', `url(#${markerPrefix}-start)`);
        }

        if (line.markerEnd) {
            stroke.setAttribute('marker-end', `url(#${markerPrefix}-end)`);
        }

        svg.appendChild(stroke);

        if (typeof line.rotateDeg === 'number' && Number.isFinite(line.rotateDeg)) {
            wrapper.style.transform = `rotate(${line.rotateDeg}deg)`;
            wrapper.style.transformOrigin = 'left center';
        }

        wrapper.appendChild(svg);

        return wrapper;
    }

    function createSvgMarker(svgNS, id, markerType, color) {
        const marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', id);
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '8');
        marker.setAttribute('refX', '6');
        marker.setAttribute('refY', '4');
        marker.setAttribute('orient', 'auto');

        const shape = document.createElementNS(svgNS, markerType === 'circle' ? 'circle' : 'path');
        if (markerType === 'circle') {
            shape.setAttribute('cx', '4');
            shape.setAttribute('cy', '4');
            shape.setAttribute('r', '2.5');
            shape.setAttribute('fill', color);
        } else if (markerType === 'diamond') {
            shape.setAttribute('d', 'M 1 4 L 4 1 L 7 4 L 4 7 Z');
            shape.setAttribute('fill', color);
        } else {
            shape.setAttribute('d', 'M 0 0 L 8 4 L 0 8 Z');
            shape.setAttribute('fill', color);
        }

        marker.appendChild(shape);
        return marker;
    }

    function createBlockElement(block, page, pageElement) {
        if (block.kind === 'table') {
            return createTableElement(block);
        }

        if (block.kind === 'image') {
            return createImageElement(block, page, pageElement);
        }

        if (block.kind === 'line') {
            return createLineElement(block, page, pageElement);
        }

        if (block.kind === 'textbox') {
            return createTextBoxElement(block, page, pageElement);
        }

        return createParagraphElement(block);
    }

    function createPageElement(page, pageIndex) {
        const pageElement = document.createElement('section');
        pageElement.className = 'layout-page';
        pageElement.dataset.pageId = page.id;
        pageElement.setAttribute('aria-label', `${pageIndex + 1} page`);
        pageElement.style.width = `${page.widthPt || 595}pt`;
        pageElement.style.minHeight = `${page.minHeightPt || 842}pt`;
        pageElement.style.paddingTop = `${page.paddingPt?.top || 56}pt`;
        pageElement.style.paddingRight = `${page.paddingPt?.right || 56}pt`;
        pageElement.style.paddingBottom = `${page.paddingPt?.bottom || 56}pt`;
        pageElement.style.paddingLeft = `${page.paddingPt?.left || 56}pt`;

        if (page.headerText) {
            const headerBand = document.createElement('div');
            headerBand.className = 'layout-page-header';
            headerBand.textContent = page.headerText;
            headerBand.style.textAlign = page.headerAlign || 'left';
            pageElement.appendChild(headerBand);
        }

        if (page.footerText) {
            const footerBand = document.createElement('div');
            footerBand.className = 'layout-page-footer';
            footerBand.textContent = page.footerText;
            footerBand.style.textAlign = page.footerAlign || 'right';
            pageElement.appendChild(footerBand);
        }

        const pageNumber = document.createElement('div');
        pageNumber.className = 'layout-page-number';
        pageNumber.textContent = `${pageIndex + 1}`;
        pageElement.appendChild(pageNumber);

        const flowBlocks = [];
        const overlayBlocks = [];

        for (const block of page.blocks || []) {
            if (block.positioning === 'absolute') {
                overlayBlocks.push(block);
            } else {
                flowBlocks.push(block);
            }
        }

        for (const block of flowBlocks) {
            pageElement.appendChild(createBlockElement(block, page, pageElement));
        }

        overlayBlocks.sort((left, right) => (left.zIndex || 0) - (right.zIndex || 0));
        for (const block of overlayBlocks) {
            pageElement.appendChild(createBlockElement(block, page, pageElement));
        }

        return pageElement;
    }

    function renderWarnings(warnings) {
        if (!Array.isArray(warnings) || warnings.length === 0 || !hwpViewport) {
            return;
        }

        const warningBox = document.createElement('div');
        warningBox.className = 'layout-warning-box';
        warningBox.textContent = `현재 ${layoutDocument.stage} 단계 엔진으로 렌더링 중입니다. ${warnings.join(' ')}`;
        hwpViewport.appendChild(warningBox);
    }

    function renderViewer() {
        if (!hwpViewport) {
            throw new Error('HWP viewport element is missing.');
        }

        if (!layoutDocument || !Array.isArray(layoutDocument.pages)) {
            throw new Error('레이아웃 문서 데이터가 비어 있습니다.');
        }

        hwpViewport.innerHTML = '';
        hwpViewport.dataset.format = layoutDocument.format || 'hwp';
        hwpViewport.dataset.stage = layoutDocument.stage || 'step2-paragraph-layout';

        renderWarnings(layoutDocument.warnings);

        for (const [pageIndex, page] of layoutDocument.pages.entries()) {
            hwpViewport.appendChild(createPageElement(page, pageIndex));
        }
    }

    function setupEventListeners() {
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

        document.addEventListener('keydown', handleKeyboard);
        document.addEventListener('wheel', handleWheel, { passive: false });
    }

    function init() {
        showLoading(true);
        hideError();
        setupEventListeners();
        applyZoom();

        try {
            renderViewer();
            showLoading(false);
        } catch (renderError) {
            console.error('[HWP Viewer] Failed to render document:', renderError);
            showLoading(false);
            showError(renderError instanceof Error ? renderError.message : 'HWP/HWPX 렌더링 중 오류가 발생했습니다.');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
