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

    function createRunElement(run) {
        const span = document.createElement('span');
        span.className = 'layout-run';
        span.textContent = run.text || '';
        if (typeof run.sourceIndex === 'number') {
            span.dataset.sourceIndex = String(run.sourceIndex);
        }
        if (typeof run.textOffset === 'number') {
            span.dataset.textOffset = String(run.textOffset);
            span.dataset.textEndOffset = String(run.textOffset + String(run.text || '').length);
        }
        if (run.noteKind) {
            span.dataset.noteKind = run.noteKind;
            span.classList.add('layout-note-ref');
        }
        if (run.noteRefId) {
            span.dataset.noteRefId = run.noteRefId;
        }
        if (run.noteMarker) {
            span.dataset.noteMarker = run.noteMarker;
        }

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

        if (run.textDecoration) {
            span.style.textDecoration = run.textDecoration;
        }

        if (run.verticalAlign) {
            span.style.verticalAlign = run.verticalAlign;
        }

        if (typeof run.letterSpacingEm === 'number') {
            span.style.letterSpacing = `${run.letterSpacingEm}em`;
        }

        if (run.color) {
            span.style.color = run.color;
        }

        if (run.backgroundColor) {
            span.style.backgroundColor = run.backgroundColor;
        }

        return span;
    }

    function wirePageNoteReferences(pageElement) {
        const noteRefs = [...pageElement.querySelectorAll('.layout-note-ref[data-note-ref-id]')];
        if (noteRefs.length === 0) {
            return;
        }

        const noteItems = [...pageElement.querySelectorAll('.layout-page-note-item[data-note-id]')];
        const noteMap = new Map(noteItems.map(noteItem => [noteItem.dataset.noteId, noteItem]));
        for (const noteRef of noteRefs) {
            const noteId = noteRef.dataset.noteRefId;
            if (!noteId) {
                continue;
            }
            const noteItem = noteMap.get(noteId);
            if (!noteItem) {
                noteRef.dataset.noteLinked = 'false';
                continue;
            }

            noteRef.dataset.noteLinked = 'true';
            noteRef.dataset.noteTarget = noteId;
            noteItem.dataset.noteLinked = 'true';

            const activate = () => {
                noteRef.dataset.noteActive = 'true';
                noteItem.dataset.noteActive = 'true';
            };
            const deactivate = () => {
                delete noteRef.dataset.noteActive;
                delete noteItem.dataset.noteActive;
            };

            noteRef.addEventListener('mouseenter', activate);
            noteRef.addEventListener('mouseleave', deactivate);
            noteItem.addEventListener('mouseenter', activate);
            noteItem.addEventListener('mouseleave', deactivate);
        }
    }

    function resolveAnchorTargetOffset(block) {
        return block?.inlineTextOffset
            ?? block?.inlineOffset
            ?? block?.sourceIndex
            ?? 0;
    }

    function estimateRenderedTextWidthPt(text, contextElement) {
        const sample = String(text || '').replace(/\s/g, ' ');
        const computedStyle = contextElement ? window.getComputedStyle(contextElement) : null;
        const fontSizePx = parseFloat(computedStyle?.fontSize || '14') || 14;
        const latinCount = (sample.match(/[A-Za-z0-9]/g) || []).length;
        const wideCount = Math.max(sample.length - latinCount, 0);
        const pxWidth = (latinCount * fontSizePx * 0.52) + (wideCount * fontSizePx * 0.9);
        return Number((pxWidth * 0.75).toFixed(2));
    }

    function resolveParagraphTabStops(target) {
        const paragraphElement = target?.closest?.('[data-tab-stops]');
        const rawStops = paragraphElement?.dataset?.tabStops;
        if (!rawStops) {
            return [];
        }

        return rawStops
            .split(',')
            .map(value => Number(value))
            .filter(value => Number.isFinite(value) && value > 0)
            .sort((left, right) => left - right);
    }

    function resolveTabAdvancePt(target) {
        const textWidthPt = estimateRenderedTextWidthPt(target?.textContent || '', target);
        const explicitStops = resolveParagraphTabStops(target);
        const nextExplicitStop = explicitStops.find(stop => stop > textWidthPt + 0.5);
        if (nextExplicitStop) {
            return Number(Math.max(8, nextExplicitStop - textWidthPt).toFixed(2));
        }

        const stopPt = 36;
        const remainder = textWidthPt % stopPt;
        return Number((remainder < 6 ? stopPt : stopPt - remainder).toFixed(2));
    }

    function applyParagraphMetrics(element, paragraph) {
        if (!element || !paragraph) {
            return;
        }

        const align = paragraph.align || 'left';
        element.dataset.align = align;
        if (paragraph.styleSource) {
            element.dataset.styleSource = paragraph.styleSource;
        }
        if (Array.isArray(paragraph.tabStopsPt) && paragraph.tabStopsPt.length > 0) {
            element.dataset.tabStops = paragraph.tabStopsPt.join(',');
        }
        element.style.textAlign = align;
        element.style.lineHeight = String(paragraph.lineHeight || 1.65);
        element.style.marginTop = `${paragraph.marginTopPt || 0}pt`;
        element.style.marginBottom = `${paragraph.marginBottomPt || 0}pt`;
        element.style.marginLeft = `${paragraph.marginLeftPt || 0}pt`;
        element.style.marginRight = `${paragraph.marginRightPt || 0}pt`;
        element.style.setProperty('--paragraph-indent', `${paragraph.textIndentPt || 0}pt`);
        element.style.setProperty('--paragraph-font-size', `${paragraph.fontSizePt || 11}pt`);
        if (paragraph.fontSizePt) {
            element.style.fontSize = `${paragraph.fontSizePt}pt`;
        }
    }

    function applyLineTypographyMeta(lineElement) {
        if (!lineElement) {
            return;
        }

        const text = String(lineElement.textContent || '');
        const trimmed = text.trim();
        const textLength = trimmed.length;
        lineElement.dataset.textLength = String(textLength);
        lineElement.dataset.leadingPunctuation = /^[)\]}>»〉》」』、】【,.!?;:'"%]/.test(trimmed) ? 'true' : 'false';
        lineElement.dataset.trailingPunctuation = /[(<«〈《「『【]$/.test(trimmed) ? 'true' : 'false';
        lineElement.dataset.lineDensity = textLength >= 48 ? 'dense' : textLength >= 20 ? 'medium' : 'loose';
    }

    function finalizeParagraphTypography(paragraphElement) {
        if (!paragraphElement) {
            return;
        }

        const lines = [...paragraphElement.querySelectorAll('.layout-paragraph-line, .layout-table-cell-line')];
        for (const [index, lineElement] of lines.entries()) {
            applyLineTypographyMeta(lineElement);
            lineElement.dataset.lineRole = index === 0 ? 'first' : index === lines.length - 1 ? 'last' : 'middle';
        }

        if (lines.length >= 2) {
            const firstLineLength = Number(lines[0].dataset.textLength || 0);
            const lastLineLength = Number(lines[lines.length - 1].dataset.textLength || 0);
            paragraphElement.dataset.paragraphBalance = lastLineLength > 0 && firstLineLength > 0 && lastLineLength < (firstLineLength * 0.34)
                ? 'ragged-last'
                : 'balanced';
        }
    }

    function createTextFragmentNode(text, className) {
        const fragment = document.createElement('span');
        fragment.className = className;
        fragment.textContent = text;
        if (/^[)\]}>»〉》」』、】【,.!?;:'"%]+$/.test(text)) {
            fragment.dataset.punctuationRole = 'closing';
        } else if (/^[(<«〈《「『【]+$/.test(text)) {
            fragment.dataset.punctuationRole = 'opening';
        }
        return fragment;
    }

    function decorateBlockDiagnostics(element, block) {
        if (!element || !block) {
            return;
        }

        element.dataset.blockKind = block.kind;
        element.dataset.blockSourceIndex = String(block.sourceIndex || 0);
        if (block.positioning) {
            element.dataset.blockPositioning = block.positioning;
        }

        const signatureParts = [
            block.kind,
            block.semanticRole || 'body',
            block.styleSource || 'n/a',
            block.positioning || 'flow',
            block.anchorScope || 'none',
            String(block.zIndex || 0),
            String(block.sourceIndex || 0)
        ];
        element.dataset.renderSignature = signatureParts.join(':');
    }

    function resolveTableColumnWidths(rows) {
        const columnWidths = [];
        for (const placements of rows) {
            for (const placement of placements) {
                const colSpan = Math.max(1, placement.cell.colSpan || 1);
                const widthPerColumn = placement.cell.widthPt
                    ? placement.cell.widthPt / colSpan
                    : 0;
                for (let offset = 0; offset < colSpan; offset += 1) {
                    const columnIndex = placement.colStart + offset;
                    columnWidths[columnIndex] = Math.max(columnWidths[columnIndex] || 0, widthPerColumn);
                }
            }
        }

        return columnWidths;
    }

    function shouldCenterTableCellContent(cell) {
        if (!cell) {
            return false;
        }

        const paragraphCount = Array.isArray(cell.paragraphs) ? cell.paragraphs.length : 0;
        const textLength = String(cell.text || '').trim().length;
        return Boolean(cell.heightPt && cell.heightPt >= 54 && paragraphCount <= 1 && textLength <= 80);
    }

    function pageHasExplicitPageNumber(page, pageIndex) {
        const pageNumberText = String(pageIndex + 1);
        const combined = `${page?.headerText || ''} ${page?.footerText || ''}`;
        return new RegExp(`\\b${pageNumberText}\\b`).test(combined) || /(page|쪽|페이지)/i.test(combined);
    }

    function resolveSpanAnchorReference(paragraphElement, block, pageRect, fallbackLeft, fallbackTop) {
        if (!paragraphElement || !pageRect) {
            return { leftPt: fallbackLeft, topPt: fallbackTop };
        }

        const spanElements = [...paragraphElement.querySelectorAll('span')];
        if (spanElements.length === 0) {
            const paragraphRect = paragraphElement.getBoundingClientRect();
            return {
                leftPt: paragraphRect.left - pageRect.left,
                topPt: paragraphRect.top - pageRect.top
            };
        }

        const targetOffset = resolveAnchorTargetOffset(block);
        const paragraphRect = paragraphElement.getBoundingClientRect();
        const expectedLeft = paragraphRect.left + Math.max((block?.leftPt || 0) * (96 / 72), 0);
        const expectedTop = paragraphRect.top + Math.max((block?.topPt || 0) * (96 / 72), 0);
        let bestSpan = spanElements[0];
        let bestScore = Number.POSITIVE_INFINITY;

        for (const [index, spanElement] of spanElements.entries()) {
            const spanRect = spanElement.getBoundingClientRect();
            const spanStart = Number(spanElement.dataset.textOffset ?? spanElement.dataset.sourceIndex ?? 0);
            const spanEnd = Number(spanElement.dataset.textEndOffset ?? spanStart);
            const offsetPenalty = targetOffset < spanStart
                ? spanStart - targetOffset
                : targetOffset > spanEnd
                    ? targetOffset - spanEnd
                    : 0;
            const horizontalPenalty = Math.abs(spanRect.left - expectedLeft) * 0.055;
            const verticalPenalty = Math.abs(spanRect.top - expectedTop) * 0.09;
            const flowPenalty = index * 0.0025;
            const score = offsetPenalty + horizontalPenalty + verticalPenalty + flowPenalty;
            if (score < bestScore) {
                bestScore = score;
                bestSpan = spanElement;
            }
        }

        const bestRect = bestSpan.getBoundingClientRect();
        return {
            leftPt: bestRect.left - pageRect.left,
            topPt: bestRect.top - pageRect.top
        };
    }

    function resolveBlockAnchorInsets(block, anchorScope) {
        const kind = block?.kind || 'image';
        const widthPt = block?.widthPt || 0;
        const heightPt = block?.heightPt || 0;
        const rotation = Math.abs(resolveFiniteRotation(block));
        const rotationFactor = Math.min(rotation / 90, 1.2);
        const kindInsets = kind === 'line'
            ? { x: 2.4, y: 1.4 }
            : kind === 'textbox'
                ? { x: 4.2, y: 2.8 }
                : { x: 3.2, y: 2.2 };
        const sizeFactorX = Math.min(widthPt / 180, 1.1);
        const sizeFactorY = Math.min(heightPt / 120, 1.1);

        if (anchorScope === 'character') {
            return {
                x: roundStyleNumber(kindInsets.x + (sizeFactorX * 1.4) + (rotationFactor * 0.85)),
                y: roundStyleNumber(kindInsets.y + (sizeFactorY * 0.75) + (rotationFactor * 0.55))
            };
        }

        if (anchorScope === 'cell') {
            return {
                x: roundStyleNumber(8.4 + kindInsets.x + (sizeFactorX * 2.4) + (rotationFactor * 0.8)),
                y: roundStyleNumber(5.4 + kindInsets.y + (sizeFactorY * 1.6) + (rotationFactor * 0.7))
            };
        }

        if (anchorScope === 'paragraph') {
            return {
                x: roundStyleNumber(kindInsets.x + (sizeFactorX * 1.8) + (rotationFactor * 0.55)),
                y: roundStyleNumber(kindInsets.y + (sizeFactorY * 1.1) + (rotationFactor * 0.45))
            };
        }

        return {
            x: 0,
            y: 0
        };
    }

    function clampPageAbsoluteOffsets(offsets, block, page, metrics) {
        if (!offsets || !page || !metrics) {
            return offsets;
        }

        const pageWidthPt = metrics.pageWidthPt || page.widthPt || 595;
        const pageHeightPt = metrics.pageHeightPt || page.minHeightPt || 842;
        const widthPt = block?.widthPt || 0;
        const heightPt = block?.heightPt || 0;
        const rotation = Math.abs(resolveFiniteRotation(block));
        const rotationWeight = Math.abs(Math.sin((rotation * Math.PI) / 180));
        const baseSlack = block?.kind === 'line' ? 6 : block?.kind === 'textbox' ? 3.5 : 2.5;
        const horizontalSlack = roundStyleNumber(baseSlack + (rotationWeight * (block?.kind === 'line' ? 10 : 5.5)));
        const verticalSlack = roundStyleNumber((baseSlack * 0.9) + (rotationWeight * (block?.kind === 'line' ? 8.5 : 4.5)));
        const minLeftPt = -horizontalSlack;
        const minTopPt = -verticalSlack;
        const maxLeftPt = Math.max(minLeftPt, pageWidthPt - widthPt + horizontalSlack);
        const maxTopPt = Math.max(minTopPt, pageHeightPt - heightPt + verticalSlack);
        return {
            leftPt: roundStyleNumber(Math.min(Math.max(offsets.leftPt || 0, minLeftPt), maxLeftPt)),
            topPt: roundStyleNumber(Math.min(Math.max(offsets.topPt || 0, minTopPt), maxTopPt))
        };
    }

    function resolveAnchorReference(pageElement, block, page) {
        const anchorScope = block.anchorScope || 'page';
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

        const anchoredParagraph = block.anchorParagraphId
            ? pageElement.querySelector(`[data-paragraph-id="${block.anchorParagraphId}"]`)
            : null;
        if (anchoredParagraph && (anchorScope === 'paragraph' || anchorScope === 'character')) {
            if (anchorScope === 'character') {
                return resolveSpanAnchorReference(
                    anchoredParagraph,
                    block,
                    pageRect,
                    page?.paddingPt?.left || 0,
                    page?.paddingPt?.top || 0
                );
            }

            return resolveRelativePosition(
                anchoredParagraph,
                page?.paddingPt?.left || 0,
                page?.paddingPt?.top || 0
            );
        }

        const paragraphElements = [...pageElement.querySelectorAll('[data-paragraph-id]')];
        if (anchorScope === 'character' && paragraphElements.length > 0) {
            const targetOffset = resolveAnchorTargetOffset(block);
            let bestParagraph = paragraphElements[0];
            let bestScore = Number.POSITIVE_INFINITY;

            for (const [index, paragraphElement] of paragraphElements.entries()) {
                const paragraphRect = paragraphElement.getBoundingClientRect();
                const paragraphTopPt = paragraphRect.top - pageRect.top;
                const paragraphLeftPt = paragraphRect.left - pageRect.left;
                const verticalPenalty = Math.abs(paragraphTopPt - (block?.topPt || 0));
                const horizontalPenalty = Math.abs(paragraphLeftPt - (block?.leftPt || 0)) * 0.18;
                const firstSpan = paragraphElement.querySelector('span');
                const spanStart = Number(firstSpan?.dataset?.textOffset ?? firstSpan?.dataset?.sourceIndex ?? 0);
                const offsetPenalty = Math.abs(spanStart - targetOffset) * 0.06;
                const flowPenalty = index * 0.01;
                const score = verticalPenalty + horizontalPenalty + offsetPenalty + flowPenalty;
                if (score < bestScore) {
                    bestScore = score;
                    bestParagraph = paragraphElement;
                }
            }

            return resolveSpanAnchorReference(
                bestParagraph,
                block,
                pageRect,
                page?.paddingPt?.left || 0,
                page?.paddingPt?.top || 0
            );
        }

        if (anchorScope === 'paragraph' && paragraphElements.length > 0) {
            let bestParagraph = paragraphElements[0];
            let bestScore = Number.POSITIVE_INFINITY;
            for (const [index, paragraphElement] of paragraphElements.entries()) {
                const paragraphRect = paragraphElement.getBoundingClientRect();
                const paragraphTopPt = paragraphRect.top - pageRect.top;
                const paragraphLeftPt = paragraphRect.left - pageRect.left;
                const verticalPenalty = Math.abs(paragraphTopPt - (block?.topPt || 0));
                const horizontalPenalty = Math.abs(paragraphLeftPt - (block?.leftPt || 0)) * 0.16;
                const flowPenalty = index * 0.01;
                const score = verticalPenalty + horizontalPenalty + flowPenalty;
                if (score < bestScore) {
                    bestScore = score;
                    bestParagraph = paragraphElement;
                }
            }

            return resolveRelativePosition(
                bestParagraph,
                page?.paddingPt?.left || 0,
                page?.paddingPt?.top || 0
            );
        }

        const anchoredCell = block.anchorCellId
            ? pageElement.querySelector(`[data-cell-id="${block.anchorCellId}"]`)
            : null;
        if (anchoredCell && anchorScope === 'cell') {
            return resolveRelativePosition(
                anchoredCell,
                page?.paddingPt?.left || 0,
                page?.paddingPt?.top || 0
            );
        }

        if (anchorScope === 'cell') {
            return resolveRelativePosition(
                pageElement.querySelector('.layout-table-cell'),
                page?.paddingPt?.left || 0,
                page?.paddingPt?.top || 0
            );
        }

        if (anchorScope === 'character') {
            return resolveSpanAnchorReference(
                pageElement.querySelector('.layout-paragraph'),
                block,
                pageRect,
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
        const anchorReference = resolveAnchorReference(pageElement, block, page);
        const anchorInsets = resolveBlockAnchorInsets(block, anchorScope);
        const pageAbsoluteMetrics = resolvePageAbsoluteMetrics(block, page, pageElement, anchorReference);
        const clampResult = offsets => clampPageAbsoluteOffsets(offsets, block, page, pageAbsoluteMetrics);

        if (anchorScope === 'page') {
            return clampResult(applyPageAnchorBias({
                leftPt: block.leftPt || 0,
                topPt: block.topPt || 0
            }, pageAbsoluteMetrics, block));
        }

        if (anchorScope === 'cell') {
            return clampResult(applyPageAnchorBias({
                leftPt: (block.leftPt || 0) + anchorReference.leftPt + anchorInsets.x,
                topPt: (block.topPt || 0) + anchorReference.topPt + anchorInsets.y
            }, pageAbsoluteMetrics, block));
        }

        if (anchorScope === 'character') {
            return clampResult(applyPageAnchorBias({
                leftPt: (block.leftPt || 0) + anchorReference.leftPt + anchorInsets.x,
                topPt: (block.topPt || 0) + anchorReference.topPt + anchorInsets.y
            }, pageAbsoluteMetrics, block));
        }

        return clampResult(applyPageAnchorBias({
            leftPt: (block.leftPt || 0) + (anchorReference.leftPt || paddingLeft) + anchorInsets.x,
            topPt: (block.topPt || 0) + (anchorReference.topPt || paddingTop) + anchorInsets.y
        }, pageAbsoluteMetrics, block));
    }

    function resolvePageAbsoluteMetrics(block, page, pageElement, anchorReference) {
        const anchorScope = block?.anchorScope || 'page';
        const paddingLeft = page?.paddingPt?.left || 0;
        const paddingTop = page?.paddingPt?.top || 0;
        const resolvedLeft = anchorScope === 'page'
            ? (block?.leftPt || 0)
            : anchorScope === 'cell'
                ? (block?.leftPt || 0) + (anchorReference?.leftPt || paddingLeft) + 12
                : anchorScope === 'character'
                    ? (block?.leftPt || 0) + (anchorReference?.leftPt || paddingLeft) + 6
                    : (block?.leftPt || 0) + (anchorReference?.leftPt || paddingLeft);
        const resolvedTop = anchorScope === 'page'
            ? (block?.topPt || 0)
            : anchorScope === 'cell'
                ? (block?.topPt || 0) + (anchorReference?.topPt || paddingTop) + 8
                : anchorScope === 'character'
                    ? (block?.topPt || 0) + (anchorReference?.topPt || paddingTop) + 2
                    : (block?.topPt || 0) + (anchorReference?.topPt || paddingTop);
        const dx = Math.abs(block?.leftPt || 0);
        const dy = Math.abs(block?.topPt || 0);
        const dominantAxis = dx === dy ? 'balanced' : dx > dy ? 'horizontal' : 'vertical';
        const distance = dx + dy;
        const tier = distance >= 160 ? 'far' : distance >= 48 ? 'mid' : 'near';
        const pageWidthPt = page?.widthPt || (pageElement ? pageElement.getBoundingClientRect().width * 0.75 : 595);
        const pageHeightPt = page?.minHeightPt || (pageElement ? pageElement.getBoundingClientRect().height * 0.75 : 842);
        const blockWidthPt = block?.widthPt || 0;
        const blockHeightPt = block?.heightPt || 0;
        const edgeDistances = {
            left: resolvedLeft,
            right: Math.max(0, pageWidthPt - (resolvedLeft + blockWidthPt)),
            top: resolvedTop,
            bottom: Math.max(0, pageHeightPt - (resolvedTop + blockHeightPt))
        };
        const nearestEdge = Object.entries(edgeDistances).sort((left, right) => left[1] - right[1])[0]?.[0] || 'left';
        const edgeDistance = edgeDistances[nearestEdge];
        const edgeProximity = edgeDistance <= 24 ? 'edge' : edgeDistance <= 72 ? 'near' : 'center';
        const horizontalCornerEdge = edgeDistances.left <= edgeDistances.right ? 'left' : 'right';
        const verticalCornerEdge = edgeDistances.top <= edgeDistances.bottom ? 'top' : 'bottom';
        const cornerDistance = Math.max(
            Math.min(edgeDistances.left, edgeDistances.right),
            Math.min(edgeDistances.top, edgeDistances.bottom)
        );
        const nearestCorner = `${verticalCornerEdge}-${horizontalCornerEdge}`;
        const cornerProximity = cornerDistance <= 28 ? 'corner' : cornerDistance <= 80 ? 'near-corner' : 'center';
        return {
            anchorScope,
            anchorReference,
            dominantAxis,
            distance,
            tier,
            nearestEdge,
            edgeDistance,
            edgeDistances,
            edgeProximity,
            nearestCorner,
            cornerDistance,
            cornerProximity,
            pageWidthPt,
            pageHeightPt
        };
    }

    function roundStyleNumber(value) {
        return Number(value.toFixed(2));
    }

    function resolveFiniteRotation(block) {
        const rotation = Number(block?.rotateDeg);
        return Number.isFinite(rotation) ? rotation : 0;
    }

    function normalizeSignedRotation(rotation) {
        if (!Number.isFinite(rotation)) {
            return 0;
        }

        let normalized = rotation % 360;
        if (normalized > 180) {
            normalized -= 360;
        } else if (normalized < -180) {
            normalized += 360;
        }

        return normalized;
    }

    function resolveProximityStrength(distance, strongDistance, softDistance) {
        if (!Number.isFinite(distance)) {
            return 0;
        }

        if (distance <= strongDistance) {
            return 1;
        }

        if (distance >= softDistance) {
            return 0;
        }

        return roundStyleNumber(1 - ((distance - strongDistance) / (softDistance - strongDistance)));
    }

    function resolvePageAbsoluteVisualProfile(block, metrics) {
        const kind = block?.kind || 'image';
        const rotation = normalizeSignedRotation(resolveFiniteRotation(block));
        const rotationSign = rotation === 0 ? 0 : Math.sign(rotation);
        const absRotation = Math.abs(rotation);
        const diagonalWeight = Math.abs(Math.sin((absRotation * Math.PI) / 90));
        const scopeFactor = metrics?.anchorScope === 'page' ? 1 : 0.72;
        const tierFactor = metrics?.tier === 'far' ? 1.08 : metrics?.tier === 'mid' ? 1.02 : 0.97;
        const kindBase = kind === 'line' ? 0.9 : kind === 'textbox' ? 0.7 : 0.38;
        const edgeDistances = metrics?.edgeDistances || {};
        const edgeStrengths = {
            left: resolveProximityStrength(edgeDistances.left, 18, 86),
            right: resolveProximityStrength(edgeDistances.right, 18, 86),
            top: resolveProximityStrength(edgeDistances.top, 18, 86),
            bottom: resolveProximityStrength(edgeDistances.bottom, 18, 86)
        };
        const cornerStrength = metrics?.cornerProximity === 'corner'
            ? 1
            : metrics?.cornerProximity === 'near-corner'
                ? resolveProximityStrength(metrics?.cornerDistance, 30, 88)
                : 0;
        const horizontalPressure = edgeStrengths.left - edgeStrengths.right;
        const verticalPressure = edgeStrengths.top - edgeStrengths.bottom;
        const desiredCornerSign = metrics?.nearestCorner === 'top-left' || metrics?.nearestCorner === 'bottom-right' ? 1 : -1;
        const lineVectorX = (block?.x2Pt || 0) - (block?.x1Pt || 0);
        const lineVectorY = (block?.y2Pt || 0) - (block?.y1Pt || 0);
        const lineDiagonalSign = lineVectorX === 0 || lineVectorY === 0 ? 1 : Math.sign(lineVectorX * lineVectorY);
        const desiredRotationSign = kind === 'line' ? desiredCornerSign * lineDiagonalSign : desiredCornerSign;
        const signDelta = rotationSign === 0
            ? desiredRotationSign * 0.55
            : (desiredRotationSign - rotationSign) / 2;
        const rotationAdjust = roundStyleNumber(
            signDelta
            * (kind === 'line' ? 1.85 : kind === 'textbox' ? 1.2 : 0.5)
            * scopeFactor
            * tierFactor
            * (0.24 + (cornerStrength * 0.76))
            * (0.35 + (diagonalWeight * 0.65))
        );
        const nudgeScale = kindBase * scopeFactor * tierFactor * (0.52 + (cornerStrength * 0.48));
        const nudgeX = roundStyleNumber((horizontalPressure * nudgeScale) + (cornerStrength * 0.18 * desiredCornerSign));
        const nudgeY = roundStyleNumber((verticalPressure * nudgeScale) + (cornerStrength * 0.18 * (metrics?.nearestCorner?.startsWith('top') ? 1 : -1)));
        const clipScale = scopeFactor * tierFactor * (0.58 + (diagonalWeight * 0.42));
        const clipWeights = {
            left: edgeStrengths.left * clipScale,
            right: edgeStrengths.right * clipScale,
            top: edgeStrengths.top * clipScale,
            bottom: edgeStrengths.bottom * clipScale
        };
        const baseClip = kind === 'textbox' ? 0.68 : kind === 'line' ? 0.48 : 0.24;
        const cornerBoost = 1 + (cornerStrength * (kind === 'line' ? 0.85 : 0.55));
        const clipInsets = kind === 'line'
            ? {
                left: roundStyleNumber((clipWeights.left > 0 ? clipWeights.left * baseClip * cornerBoost : -0.45 * clipScale * (0.35 + (diagonalWeight * 0.65)))),
                right: roundStyleNumber((clipWeights.right > 0 ? clipWeights.right * baseClip * cornerBoost : -0.45 * clipScale * (0.35 + (diagonalWeight * 0.65)))),
                top: roundStyleNumber((clipWeights.top > 0 ? clipWeights.top * baseClip * cornerBoost : -0.38 * clipScale * (0.35 + (diagonalWeight * 0.65)))),
                bottom: roundStyleNumber((clipWeights.bottom > 0 ? clipWeights.bottom * baseClip * cornerBoost : -0.38 * clipScale * (0.35 + (diagonalWeight * 0.65))))
            }
            : {
                left: roundStyleNumber(clipWeights.left * baseClip * cornerBoost),
                right: roundStyleNumber(clipWeights.right * baseClip * cornerBoost),
                top: roundStyleNumber(clipWeights.top * baseClip * cornerBoost),
                bottom: roundStyleNumber(clipWeights.bottom * baseClip * cornerBoost)
            };
        const transformOrigin = cornerStrength > 0.34
            ? metrics.nearestCorner.replace('-', ' ')
            : edgeStrengths.left >= edgeStrengths.right && edgeStrengths.left >= 0.34
                ? 'left center'
                : edgeStrengths.right > edgeStrengths.left && edgeStrengths.right >= 0.34
                    ? 'right center'
                    : edgeStrengths.top >= edgeStrengths.bottom && edgeStrengths.top >= 0.34
                        ? 'center top'
                        : edgeStrengths.bottom > edgeStrengths.top && edgeStrengths.bottom >= 0.34
                            ? 'center bottom'
                            : kind === 'line'
                                ? 'left center'
                                : 'center center';
        return {
            rotation,
            rotationAdjust,
            nudgeX,
            nudgeY,
            transformOrigin,
            clipInsets
        };
    }

    function applyPageAnchorBias(offsets, metrics, block) {
        if (!metrics || metrics.anchorScope === 'page') {
            return offsets;
        }

        const tierFactor = metrics.tier === 'far' ? 1.2 : metrics.tier === 'mid' ? 1.08 : 1;
        const kindFactor = block?.kind === 'line' ? 1.12 : block?.kind === 'textbox' ? 1.05 : 0.97;
        const axisFactorX = metrics.dominantAxis === 'horizontal' ? 1.12 : metrics.dominantAxis === 'vertical' ? 0.9 : 1;
        const axisFactorY = metrics.dominantAxis === 'vertical' ? 1.12 : metrics.dominantAxis === 'horizontal' ? 0.9 : 1;
        const edgeFactor = metrics.edgeProximity === 'edge' ? 1.16 : metrics.edgeProximity === 'near' ? 1.06 : 1;
        const cornerFactor = metrics.cornerProximity === 'corner' ? 1.12 : metrics.cornerProximity === 'near-corner' ? 1.04 : 1;
        const strength = Math.min((metrics.distance / 60) * tierFactor * kindFactor * edgeFactor * cornerFactor, 6.8);
        const edgeNudgeX = metrics.nearestEdge === 'left' ? 0.7 : metrics.nearestEdge === 'right' ? -0.7 : 0;
        const edgeNudgeY = metrics.nearestEdge === 'top' ? 0.7 : metrics.nearestEdge === 'bottom' ? -0.7 : 0;
        const cornerNudgeX = metrics.cornerProximity === 'corner'
            ? (metrics.nearestCorner.endsWith('left') ? 0.35 : -0.35)
            : 0;
        const cornerNudgeY = metrics.cornerProximity === 'corner'
            ? (metrics.nearestCorner.startsWith('top') ? 0.35 : -0.35)
            : 0;
        return {
            leftPt: (offsets.leftPt || 0) + (Math.sign(block?.leftPt || 0) * strength * axisFactorX) + edgeNudgeX + cornerNudgeX,
            topPt: (offsets.topPt || 0) + (Math.sign(block?.topPt || 0) * strength * 0.8 * axisFactorY) + edgeNudgeY + cornerNudgeY
        };
    }

    function applyPageAbsoluteDatasets(element, block, page, pageElement) {
        if (!element || !block || block.positioning !== 'absolute') {
            return;
        }

        const metrics = resolvePageAbsoluteMetrics(
            block,
            page,
            pageElement,
            resolveAnchorReference(pageElement, block, page)
        );
        element.dataset.pageTransferAxis = metrics.dominantAxis;
        element.dataset.pageTransferTier = metrics.tier;
        element.dataset.pageAnchorScope = metrics.anchorScope;
        element.dataset.pageEdge = metrics.nearestEdge;
        element.dataset.pageEdgeProximity = metrics.edgeProximity;
        element.dataset.pageCorner = metrics.nearestCorner;
        element.dataset.pageCornerProximity = metrics.cornerProximity;
        element.dataset.pageKind = block.kind;

        const visualProfile = resolvePageAbsoluteVisualProfile(block, metrics);
        element.style.setProperty('--page-nudge-x', `${visualProfile.nudgeX}pt`);
        element.style.setProperty('--page-nudge-y', `${visualProfile.nudgeY}pt`);
        element.style.setProperty('--page-rotation-adjust', `${visualProfile.rotationAdjust}deg`);
        element.style.setProperty('--page-transform-origin', visualProfile.transformOrigin);
        element.style.setProperty('--page-clip-left', `${visualProfile.clipInsets.left}pt`);
        element.style.setProperty('--page-clip-right', `${visualProfile.clipInsets.right}pt`);
        element.style.setProperty('--page-clip-top', `${visualProfile.clipInsets.top}pt`);
        element.style.setProperty('--page-clip-bottom', `${visualProfile.clipInsets.bottom}pt`);
    }

    function resolveCellAbsoluteOffsets(block, cellElement, contentElement, options) {
        const sourceCellElement = options?.sourceCellElement || cellElement;
        const sourceContentElement = options?.sourceContentElement || contentElement;
        const transferMetrics = options?.transferMetrics || resolveCellTransferMetrics(sourceCellElement, cellElement);
        const pxToPt = value => Math.max(0, Number((value * 0.75).toFixed(2)));
        const sourceMetrics = resolveCellLayoutMetrics(sourceCellElement, sourceContentElement, pxToPt);
        const targetMetrics = resolveCellLayoutMetrics(cellElement, contentElement, pxToPt);
        const sourceHorizontalInsetPt = sourceMetrics.horizontalInsetPt;
        const sourceVerticalInsetPt = sourceMetrics.verticalInsetPt;
        const targetHorizontalInsetPt = targetMetrics.horizontalInsetPt;
        const targetVerticalInsetPt = targetMetrics.verticalInsetPt;
        const resolveRelativePosition = (element, fallbackLeft, fallbackTop) => {
            const contentRect = sourceContentElement?.getBoundingClientRect();
            if (!element || !contentRect) {
                return {
                    leftPt: fallbackLeft,
                    topPt: fallbackTop
                };
            }

            const rect = element.getBoundingClientRect();
            return {
                leftPt: Math.max(0, rect.left - contentRect.left),
                topPt: Math.max(0, rect.top - contentRect.top)
            };
        };

        const anchorScope = block.anchorScope || 'cell';
        const translateAcrossCells = offsets => {
            if (!sourceContentElement || !contentElement || sourceContentElement === contentElement) {
                return applyTransferEntryBias(offsets, transferMetrics, block);
            }

            const sourceContentRect = sourceContentElement.getBoundingClientRect();
            const targetContentRect = contentElement.getBoundingClientRect();
            return applyTransferEntryBias({
                leftPt: (offsets.leftPt || 0) + pxToPt(sourceContentRect.left - targetContentRect.left),
                topPt: (offsets.topPt || 0) + pxToPt(sourceContentRect.top - targetContentRect.top)
            }, transferMetrics, block);
        };

        if (anchorScope === 'cell') {
            const baseLeft = (block.leftPt || 0) + sourceHorizontalInsetPt;
            const baseTop = (block.topPt || 0) + sourceVerticalInsetPt;
            return clampCellAbsoluteOffsets(block, {
                ...translateAcrossCells({
                    leftPt: baseLeft,
                    topPt: baseTop
                })
            }, contentElement, pxToPt, targetHorizontalInsetPt, targetVerticalInsetPt, transferMetrics);
        }

        if (anchorScope === 'paragraph' || anchorScope === 'character') {
            const anchoredParagraph = resolveNearestCellParagraph(sourceContentElement, block, pxToPt);
            if (anchoredParagraph) {
                if (anchorScope === 'character') {
                    const characterTarget = resolveNearestCellCharacter(anchoredParagraph, block, pxToPt) || anchoredParagraph;
                    const anchorReference = resolveRelativePosition(characterTarget, 0, 0);
                    return clampCellAbsoluteOffsets(block, {
                        ...translateAcrossCells({
                            leftPt: (block.leftPt || 0) + anchorReference.leftPt + Math.max(4, sourceHorizontalInsetPt - 2),
                            topPt: (block.topPt || 0) + anchorReference.topPt + Math.max(2, sourceVerticalInsetPt - 2)
                        })
                    }, contentElement, pxToPt, targetHorizontalInsetPt, targetVerticalInsetPt, transferMetrics);
                }

                const anchorReference = resolveRelativePosition(anchoredParagraph, 0, 0);
                return clampCellAbsoluteOffsets(block, {
                    ...translateAcrossCells({
                        leftPt: (block.leftPt || 0) + anchorReference.leftPt + sourceHorizontalInsetPt + 2,
                        topPt: (block.topPt || 0) + anchorReference.topPt + sourceVerticalInsetPt
                    })
                }, contentElement, pxToPt, targetHorizontalInsetPt, targetVerticalInsetPt, transferMetrics);
            }
        }

        return clampCellAbsoluteOffsets(block, {
            ...translateAcrossCells({
                leftPt: block.leftPt || 0,
                topPt: block.topPt || 0
            })
        }, contentElement, pxToPt, targetHorizontalInsetPt, targetVerticalInsetPt, transferMetrics);
    }

    function resolveNearestCellParagraph(contentElement, block, pxToPt) {
        if (!contentElement) {
            return null;
        }

        if (block.anchorParagraphId) {
            const anchoredParagraph = contentElement.querySelector(`[data-paragraph-id="${block.anchorParagraphId}"]`);
            if (anchoredParagraph) {
                return anchoredParagraph;
            }
        }

        const paragraphElements = [...contentElement.querySelectorAll('[data-paragraph-id]')];
        if (paragraphElements.length === 0) {
            return null;
        }

        const contentRect = contentElement.getBoundingClientRect();
        const targetTopPt = block.topPt || 0;
        const targetLeftPt = block.leftPt || 0;
        let bestParagraph = paragraphElements[0];
        let bestScore = Number.POSITIVE_INFINITY;

        for (const [index, paragraphElement] of paragraphElements.entries()) {
            const rect = paragraphElement.getBoundingClientRect();
            const paragraphTopPt = pxToPt(rect.top - contentRect.top);
            const paragraphLeftPt = pxToPt(rect.left - contentRect.left);
            const verticalDistance = Math.abs(paragraphTopPt - targetTopPt);
            const horizontalDistance = Math.abs(paragraphLeftPt - targetLeftPt);
            const flowPenalty = index * 0.01;
            const backwardPenalty = paragraphTopPt > targetTopPt ? 0.35 : 0;
            const kindBias = resolveBlockKindAnchorBias(block, 'paragraph');
            const score = verticalDistance + (horizontalDistance * 0.08) + flowPenalty + backwardPenalty + kindBias;
            if (score < bestScore) {
                bestScore = score;
                bestParagraph = paragraphElement;
            }
        }

        return bestParagraph;
    }

    function resolveNearestCellCharacter(paragraphElement, block, pxToPt) {
        const spanElements = [...paragraphElement.querySelectorAll('span')];
        if (spanElements.length === 0) {
            return null;
        }

        const paragraphRect = paragraphElement.getBoundingClientRect();
        const targetLeftPt = block.leftPt || 0;
        const targetTopPt = block.topPt || 0;
        let bestSpan = spanElements[0];
        let bestScore = Number.POSITIVE_INFINITY;

        for (const [index, spanElement] of spanElements.entries()) {
            const rect = spanElement.getBoundingClientRect();
            const spanLeftPt = pxToPt(rect.left - paragraphRect.left);
            const spanTopPt = pxToPt(rect.top - paragraphRect.top);
            const horizontalDistance = Math.abs(spanLeftPt - targetLeftPt);
            const verticalDistance = Math.abs(spanTopPt - targetTopPt);
            const flowPenalty = index * 0.01;
            const kindBias = resolveBlockKindAnchorBias(block, 'character');
            const score = horizontalDistance + (verticalDistance * 0.18) + flowPenalty + kindBias;
            if (score < bestScore) {
                bestScore = score;
                bestSpan = spanElement;
            }
        }

        return bestSpan;
    }

    function resolveBlockKindAnchorBias(block, anchorTarget) {
        if (!block || !block.kind) {
            return 0;
        }

        if (block.kind === 'textbox') {
            return anchorTarget === 'paragraph' ? -0.18 : -0.08;
        }

        if (block.kind === 'image') {
            return anchorTarget === 'paragraph' ? -0.12 : 0.04;
        }

        if (block.kind === 'line') {
            return anchorTarget === 'character' ? -0.14 : 0.06;
        }

        return 0;
    }

    function applyTransferEntryBias(offsets, transferMetrics, block) {
        if (!transferMetrics || transferMetrics.transferDistance < 1) {
            return offsets;
        }

        const tier = resolveTransferDistanceTier(transferMetrics);
        const boundaryWeight = Math.max(transferMetrics.crossedBoundaries || 0, 1);
        const strengthBase = Math.min((boundaryWeight * 1.9) + (transferMetrics.transferDistance * 0.55), 9);
        const tierFactor = tier === 'far'
            ? 1.3
            : tier === 'mid'
                ? 1.1
                : 1;
        const kindFactor = block?.kind === 'line'
            ? 1.2
            : block?.kind === 'textbox'
                ? 1.08
                : block?.kind === 'image'
                    ? 0.94
                    : 1;
        const strength = strengthBase * tierFactor * kindFactor;
        const horizontalFactor = resolveTransferAxisFactor(transferMetrics, block, 'horizontal');
        const verticalFactor = resolveTransferAxisFactor(transferMetrics, block, 'vertical');
        return {
            leftPt: (offsets.leftPt || 0) + (-Math.sign(transferMetrics.colDelta || 0) * strength * horizontalFactor),
            topPt: (offsets.topPt || 0) + (-Math.sign(transferMetrics.rowDelta || 0) * strength * 0.85 * verticalFactor)
        };
    }

    function resolveTransferAxisDirection(transferMetrics) {
        const crossedCols = transferMetrics?.crossedCols || 0;
        const crossedRows = transferMetrics?.crossedRows || 0;
        if (crossedCols === crossedRows) {
            return 'balanced';
        }
        return crossedCols > crossedRows ? 'horizontal' : 'vertical';
    }

    function resolveTransferAxisFactor(transferMetrics, block, axis) {
        const dominantAxis = resolveTransferAxisDirection(transferMetrics);
        const axisMatch = dominantAxis === axis;
        const kind = block?.kind || '';
        if (dominantAxis === 'balanced') {
            return 1;
        }

        if (kind === 'line') {
            return axisMatch ? 1.28 : 0.82;
        }

        if (kind === 'textbox') {
            return axisMatch ? 1.14 : 0.9;
        }

        if (kind === 'image') {
            return axisMatch ? 1.06 : 0.94;
        }

        return axisMatch ? 1.08 : 0.92;
    }

    function clampCellAbsoluteOffsets(block, offsets, contentElement, pxToPt, horizontalInsetPt, verticalInsetPt, transferMetrics) {
        if (!contentElement || typeof pxToPt !== 'function') {
            return offsets;
        }

        const contentRect = contentElement.getBoundingClientRect();
        const contentWidthPt = pxToPt(contentRect.width);
        const contentHeightPt = pxToPt(contentRect.height);
        const blockWidthPt = block.widthPt || 0;
        const blockHeightPt = block.heightPt || 0;
        const safeHorizontalInsetPt = typeof horizontalInsetPt === 'number' ? horizontalInsetPt : 0;
        const safeVerticalInsetPt = typeof verticalInsetPt === 'number' ? verticalInsetPt : 0;
        const horizontalSlackPt = transferMetrics?.transferDistance ? Math.min(transferMetrics.transferDistance * 1.25, 6) : 0;
        const verticalSlackPt = transferMetrics?.transferDistance ? Math.min(transferMetrics.transferDistance, 5) : 0;
        const minLeftPt = Math.max(0, safeHorizontalInsetPt - (transferMetrics?.colDelta && transferMetrics.colDelta < 0 ? horizontalSlackPt : 0));
        const minTopPt = Math.max(0, safeVerticalInsetPt - (transferMetrics?.rowDelta && transferMetrics.rowDelta < 0 ? verticalSlackPt : 0));
        const maxLeftPt = Math.max(minLeftPt, (contentWidthPt - blockWidthPt) + (transferMetrics?.colDelta && transferMetrics.colDelta > 0 ? horizontalSlackPt : 0));
        const maxTopPt = Math.max(minTopPt, (contentHeightPt - blockHeightPt) + (transferMetrics?.rowDelta && transferMetrics.rowDelta > 0 ? verticalSlackPt : 0));

        return {
            leftPt: Math.max(minLeftPt, Math.min(offsets.leftPt || 0, maxLeftPt)),
            topPt: Math.max(minTopPt, Math.min(offsets.topPt || 0, maxTopPt))
        };
    }

    function resolveCellLayoutMetrics(cellElement, contentElement, pxToPt) {
        const computedStyle = cellElement ? window.getComputedStyle(cellElement) : null;
        const borderLeftPx = parseFloat(computedStyle?.borderLeftWidth || '0') || 0;
        const borderTopPx = parseFloat(computedStyle?.borderTopWidth || '0') || 0;
        const contentRect = contentElement?.getBoundingClientRect();
        const cellRect = cellElement?.getBoundingClientRect();
        const contentOffsetLeftPx = cellRect && contentRect ? Math.max(0, contentRect.left - cellRect.left) : borderLeftPx;
        const contentOffsetTopPx = cellRect && contentRect ? Math.max(0, contentRect.top - cellRect.top) : borderTopPx;
        const colSpan = Math.max(1, Number(cellElement?.dataset?.colSpan || 1));
        const rowSpan = Math.max(1, Number(cellElement?.dataset?.rowSpan || 1));

        return {
            horizontalInsetPt: pxToPt(contentOffsetLeftPx) + Math.min((colSpan - 1) * 1.5, 6),
            verticalInsetPt: pxToPt(contentOffsetTopPx) + Math.min((rowSpan - 1) * 1.5, 6),
            borderLeftPx,
            borderTopPx,
            borderRightPx: parseFloat(computedStyle?.borderRightWidth || '0') || 0,
            borderBottomPx: parseFloat(computedStyle?.borderBottomWidth || '0') || 0
        };
    }

    function createInlineBlockElement(block) {
        if (block.kind === 'image') {
            return createImageElement(block, null, null, { inlineContext: true });
        }

        if (block.kind === 'line') {
            return createLineElement(block, null, null, { inlineContext: true });
        }

        if (block.kind === 'textbox') {
            return createTextBoxElement(block, null, null, { inlineContext: true });
        }

        return null;
    }

    function applyInlineFlowStyles(wrapper, block) {
        const widthPt = block.widthPt || 0;
        const heightPt = block.heightPt || 0;
        const isLargeInlineObject = widthPt >= 180 || heightPt >= 28;
        const heightBucket = heightPt >= 72 ? 'tall' : heightPt >= 28 ? 'medium' : 'small';
        const widthBucket = widthPt >= 220 ? 'wide' : widthPt >= 120 ? 'medium' : 'narrow';

        wrapper.classList.add('layout-inline-object');
        if (isLargeInlineObject) {
            wrapper.classList.add('layout-inline-object-large');
        }
        wrapper.classList.add(`layout-inline-height-${heightBucket}`);
        wrapper.classList.add(`layout-inline-width-${widthBucket}`);
        wrapper.dataset.inlineHeight = `${Math.round(heightPt || 0)}`;
        wrapper.dataset.inlineWidth = `${Math.round(widthPt || 0)}`;

        wrapper.style.display = 'inline-flex';
        wrapper.style.verticalAlign = heightPt >= 48 ? '-0.22em' : heightPt >= 20 ? '-0.12em' : 'middle';
        wrapper.style.lineHeight = '1';
        wrapper.style.maxWidth = isLargeInlineObject ? '100%' : 'min(100%, max-content)';
        wrapper.style.marginTop = '0';
        wrapper.style.marginBottom = '0';
        wrapper.style.marginRight = isLargeInlineObject ? '0' : '6pt';

        if (isLargeInlineObject) {
            wrapper.style.marginLeft = '0';
            wrapper.style.paddingTop = '2pt';
            wrapper.style.paddingBottom = '2pt';
        } else if (heightPt >= 18) {
            wrapper.style.paddingTop = '1pt';
            wrapper.style.paddingBottom = '1pt';
        }
    }

    function appendInlineBlock(element, block, context) {
        const inlineElement = createInlineBlockElement(block);
        if (!inlineElement) {
            return;
        }

        const widthPt = block.widthPt || 0;
        const heightPt = block.heightPt || 0;
        const isLargeInlineObject = widthPt >= 180 || heightPt >= 28;

        if (!context.hasVisibleTextBefore) {
            inlineElement.classList.add('layout-inline-object-leading');
        }

        if (!context.hasVisibleTextAfter) {
            inlineElement.classList.add('layout-inline-object-trailing');
        }

        if (!context.hasVisibleTextBefore && !context.hasVisibleTextAfter) {
            inlineElement.classList.add('layout-inline-object-isolated');
        }

        if (context.hasVisibleTextBefore && context.hasVisibleTextAfter) {
            inlineElement.classList.add('layout-inline-object-between-text');
        } else if (context.hasVisibleTextBefore) {
            inlineElement.classList.add('layout-inline-object-after-text');
        } else if (context.hasVisibleTextAfter) {
            inlineElement.classList.add('layout-inline-object-before-text');
        }

        if (isLargeInlineObject) {
            inlineElement.classList.add('layout-inline-object-wrap-strong');
        } else {
            inlineElement.classList.add('layout-inline-object-wrap-soft');
        }

        if (widthPt >= 220) {
            inlineElement.classList.add('layout-inline-object-push-strong');
        } else if (widthPt >= 120) {
            inlineElement.classList.add('layout-inline-object-push-medium');
        }

        if (isLargeInlineObject && context.hasVisibleTextBefore) {
            element.appendChild(createInlineBreakHint('before'));
        }

        element.appendChild(inlineElement);

        if (isLargeInlineObject && context.hasVisibleTextAfter) {
            element.appendChild(createInlineBreakHint('after'));
        }
    }

    function createInlineBreakHint(side) {
        const hint = document.createElement('span');
        hint.className = `layout-inline-break-hint layout-inline-break-hint-${side}`;
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = '\u200b';
        return hint;
    }

    function createParagraphFlowLine(paragraph, role) {
        const line = document.createElement('div');
        line.className = 'layout-paragraph-line';
        line.classList.add(`layout-paragraph-line-${role}`);

        const textIndentPt = paragraph?.textIndentPt || 0;
        if (role === 'first' && textIndentPt > 0) {
            line.style.paddingLeft = `${textIndentPt}pt`;
        } else if (role === 'first' && textIndentPt < 0) {
            line.style.marginLeft = `${textIndentPt}pt`;
        }

        return line;
    }

    function lineHasVisibleContent(line) {
        return Boolean(line && ((line.textContent && /\S/.test(line.textContent)) || line.querySelector('.layout-inline-object')));
    }

    function shouldSplitAroundInlineBlock(block, context) {
        const widthPt = block.widthPt || 0;
        const heightPt = block.heightPt || 0;
        const isLargeInlineObject = widthPt >= 180 || heightPt >= 28;

        if (!isLargeInlineObject) {
            return false;
        }

        return widthPt >= 220 || (context.hasVisibleTextBefore && context.hasVisibleTextAfter);
    }

    function createParagraphElement(paragraph) {
        const element = document.createElement('div');
        element.className = 'layout-paragraph';
        element.dataset.paragraphId = paragraph.id;
        applyParagraphMetrics(element, paragraph);
        decorateBlockDiagnostics(element, paragraph);

        const runs = Array.isArray(paragraph.runs) ? paragraph.runs : [];
        const inlineBlocks = Array.isArray(paragraph.inlineBlocks) ? [...paragraph.inlineBlocks] : [];
        if (runs.length === 0) {
            element.innerHTML = '&nbsp;';
            return element;
        }

        const visibleRunIndexes = runs
            .map((run, index) => (/\S/.test(run.text || '') ? index : -1))
            .filter(index => index >= 0);
        let currentLine = createParagraphFlowLine(paragraph, 'first');
        element.appendChild(currentLine);
        let inlineIndex = 0;
        let hasVisibleTextBefore = false;
        for (const [runIndex, run] of runs.entries()) {
            const runOffset = run.textOffset ?? run.sourceIndex ?? Number.MAX_SAFE_INTEGER;
            const hasVisibleTextAfter = visibleRunIndexes.some(index => index >= runIndex);
            while (
                inlineIndex < inlineBlocks.length
                && (
                    inlineBlocks[inlineIndex].inlineTextOffset
                    ?? inlineBlocks[inlineIndex].inlineOffset
                    ?? inlineBlocks[inlineIndex].sourceIndex
                    ?? Number.MAX_SAFE_INTEGER
                ) <= runOffset
            ) {
                const block = inlineBlocks[inlineIndex];
                const context = {
                    hasVisibleTextBefore,
                    hasVisibleTextAfter
                };
                if (shouldSplitAroundInlineBlock(block, context) && lineHasVisibleContent(currentLine)) {
                    currentLine = createParagraphFlowLine(paragraph, 'inline');
                    currentLine.classList.add('layout-paragraph-inline-row', 'layout-paragraph-line-continuation');
                    element.appendChild(currentLine);
                }
                appendInlineBlock(currentLine, block, context);
                if (shouldSplitAroundInlineBlock(block, context)) {
                    currentLine = createParagraphFlowLine(paragraph, 'post-inline');
                    currentLine.classList.add('layout-paragraph-post-inline-row', 'layout-paragraph-line-continuation');
                    element.appendChild(currentLine);
                }
                inlineIndex += 1;
            }
            currentLine.appendChild(createRunElement(run));
            if (/\S/.test(run.text || '')) {
                hasVisibleTextBefore = true;
            }
        }

        while (inlineIndex < inlineBlocks.length) {
            const block = inlineBlocks[inlineIndex];
            const context = {
                hasVisibleTextBefore,
                hasVisibleTextAfter: false
            };
            if (shouldSplitAroundInlineBlock(block, context) && lineHasVisibleContent(currentLine)) {
                currentLine = createParagraphFlowLine(paragraph, 'inline');
                currentLine.classList.add('layout-paragraph-inline-row', 'layout-paragraph-line-continuation');
                element.appendChild(currentLine);
            }
            appendInlineBlock(currentLine, block, context);
            if (shouldSplitAroundInlineBlock(block, context)) {
                currentLine = createParagraphFlowLine(paragraph, 'post-inline');
                currentLine.classList.add('layout-paragraph-post-inline-row', 'layout-paragraph-line-continuation');
                element.appendChild(currentLine);
            }
            inlineIndex += 1;
        }

        const paragraphLines = [...element.querySelectorAll('.layout-paragraph-line')];
        const lastLine = paragraphLines[paragraphLines.length - 1];
        if (lastLine && !lineHasVisibleContent(lastLine) && paragraphLines.length > 1) {
            lastLine.remove();
        }

        finalizeParagraphTypography(element);

        return element;
    }

    function estimateLeadingIndentPt(text) {
        const match = String(text || '').match(/^ +/);
        if (!match) {
            return 0;
        }

        return Math.min(match[0].length * 3.2, 24);
    }

    function createSimpleParagraphElement(textOrParagraph, options) {
        const paragraphData = typeof textOrParagraph === 'string'
            ? { text: textOrParagraph }
            : (textOrParagraph || {});
        const paragraphText = String(paragraphData.text || '');
        const paragraphRuns = Array.isArray(paragraphData.runs) && paragraphData.runs.length > 0
            ? paragraphData.runs
            : [{ text: paragraphText, textOffset: 0 }];
        const lineRuns = splitRunsByLine(paragraphRuns);
        const paragraphElement = document.createElement('div');
        paragraphElement.className = options?.paragraphClassName || 'layout-simple-paragraph';
        if (paragraphData.id) {
            paragraphElement.dataset.paragraphId = paragraphData.id;
        }
        paragraphElement.dataset.align = paragraphData.align || 'left';
        if (Array.isArray(paragraphData.tabStopsPt) && paragraphData.tabStopsPt.length > 0) {
            paragraphElement.dataset.tabStops = paragraphData.tabStopsPt.join(',');
        }

        const indentPt = typeof paragraphData.textIndentPt === 'number'
            ? paragraphData.textIndentPt
            : estimateLeadingIndentPt(paragraphText);
        const listMatch = paragraphText.match(/^\s*((?:[-*•·◦▪]|\d+[.)]|[A-Za-z][.)]|[가-힣][.)]))\s+/);
        const listMarker = listMatch ? listMatch[1] : '';
        if (indentPt > 0) {
            paragraphElement.style.paddingLeft = `${indentPt}pt`;
        }
        if (paragraphData.align) {
            paragraphElement.style.textAlign = paragraphData.align;
        }
        if (paragraphData.lineHeight) {
            paragraphElement.style.lineHeight = String(paragraphData.lineHeight);
        }
        paragraphElement.style.setProperty('--paragraph-indent', `${indentPt || 0}pt`);
        if (listMarker) {
            paragraphElement.classList.add(options?.listParagraphClassName || 'layout-simple-paragraph-list');
            paragraphElement.style.setProperty('--list-marker-width', `${Math.max(18, listMarker.length * 7)}pt`);
        }

        const lines = paragraphText.split('\n');
        const inlineBlocks = Array.isArray(paragraphData.inlineBlocks) ? [...paragraphData.inlineBlocks] : [];
        inlineBlocks.sort((left, right) => (
            (left.inlineTextOffset ?? left.inlineOffset ?? left.sourceIndex ?? Number.MAX_SAFE_INTEGER)
            - (right.inlineTextOffset ?? right.inlineOffset ?? right.sourceIndex ?? Number.MAX_SAFE_INTEGER)
        ));
        let inlineIndex = 0;
        for (const [lineIndex, lineText] of lines.entries()) {
            let lineElement = createSimpleFlowLine(options, lineIndex === 0 ? 'first' : 'continuation');
            paragraphElement.appendChild(lineElement);

            const normalizedLineText = lineText.replace(/^ +/, '');
            const lineTextValue = lineIndex === 0 && listMarker
                ? normalizedLineText.replace(/^\s*((?:[-*•·◦▪]|\d+[.)]|[A-Za-z][.)]|[가-힣][.)]))\s+/, '')
                : normalizedLineText;
            const lineRunList = lineRuns[lineIndex] || [{ text: lineTextValue || '\u00a0', textOffset: 0 }];
            const lineStartOffset = typeof lineRunList[0]?.textOffset === 'number'
                ? lineRunList[0].textOffset
                : 0;
            const lineEndOffset = lineRunList.reduce((maxOffset, run) => {
                const startOffset = typeof run.textOffset === 'number' ? run.textOffset : maxOffset;
                return Math.max(maxOffset, startOffset + String(run.text || '').length);
            }, lineStartOffset);
            if (!/\S/.test(normalizedLineText)) {
                lineElement.classList.add(options?.emptyLineClassName || 'layout-simple-line-empty');
            }

            if (lineIndex === 0 && listMarker) {
                const markerElement = document.createElement('span');
                markerElement.className = options?.listMarkerClassName || 'layout-simple-list-marker';
                markerElement.textContent = listMarker;
                const textElement = document.createElement('span');
                textElement.className = options?.listTextClassName || 'layout-simple-list-text';
                lineElement.appendChild(markerElement);
                lineElement.appendChild(textElement);
                const flowResult = appendRichInlineRunsWithBlocks(
                    paragraphElement,
                    textElement,
                    lineRunList,
                    inlineBlocks,
                    inlineIndex,
                    {
                        lineStartOffset,
                        lineEndOffset,
                        treatTrailingAsWithinLine: lineIndex === lines.length - 1
                    },
                    options,
                    {
                        tabClassName: options?.tabClassName,
                        placeholderClassName: options?.placeholderClassName,
                        textRunClassName: options?.textRunClassName
                    }
                );
                inlineIndex = flowResult.inlineIndex;
                lineElement = flowResult.currentLineElement;
                const listTextTarget = flowResult.currentLineElement === textElement
                    ? textElement
                    : flowResult.currentLineElement;
                if (!listTextTarget.childNodes.length) {
                    appendRichInlineText(listTextTarget, lineTextValue || '\u00a0', {
                        tabClassName: options?.tabClassName,
                        placeholderClassName: options?.placeholderClassName,
                        textRunClassName: options?.textRunClassName
                    });
                }
            } else {
                const flowResult = appendRichInlineRunsWithBlocks(
                    paragraphElement,
                    lineElement,
                    lineRunList,
                    inlineBlocks,
                    inlineIndex,
                    {
                        lineStartOffset,
                        lineEndOffset,
                        treatTrailingAsWithinLine: lineIndex === lines.length - 1
                    },
                    options,
                    {
                        tabClassName: options?.tabClassName,
                        placeholderClassName: options?.placeholderClassName,
                        textRunClassName: options?.textRunClassName
                    }
                );
                inlineIndex = flowResult.inlineIndex;
                lineElement = flowResult.currentLineElement;
                if (!lineElement.childNodes.length) {
                    appendRichInlineText(lineElement, lineTextValue || '\u00a0', {
                        tabClassName: options?.tabClassName,
                        placeholderClassName: options?.placeholderClassName,
                        textRunClassName: options?.textRunClassName
                    });
                }
            }
        }

        if (inlineIndex < inlineBlocks.length) {
            const inlineBlockRow = document.createElement('div');
            inlineBlockRow.className = options?.inlineBlockRowClassName || 'layout-simple-inline-block-row';
            for (const block of inlineBlocks.slice(inlineIndex)) {
                const inlineElement = createInlineBlockElement(block);
                if (inlineElement) {
                    inlineBlockRow.appendChild(inlineElement);
                }
            }
            if (inlineBlockRow.childNodes.length > 0) {
                paragraphElement.appendChild(inlineBlockRow);
            }
        }

        finalizeParagraphTypography(paragraphElement);

        return paragraphElement;
    }

    function createSimpleFlowLine(options, role) {
        const lineElement = document.createElement('div');
        lineElement.className = options?.lineClassName || 'layout-simple-line';
        if (role === 'first') {
            lineElement.classList.add(options?.firstLineClassName || 'layout-simple-line-first');
        } else {
            lineElement.classList.add(options?.continuationLineClassName || 'layout-simple-line-continuation');
        }

        if (role === 'inline') {
            lineElement.classList.add('layout-table-cell-inline-row');
        }

        if (role === 'post-inline') {
            lineElement.classList.add('layout-table-cell-post-inline-row');
        }

        return lineElement;
    }

    function appendRichInlineRunsWithBlocks(paragraphElement, target, runs, inlineBlocks, startInlineIndex, lineRange, lineOptions, textOptions) {
        const safeRuns = Array.isArray(runs) && runs.length > 0 ? runs : [{ text: '\u00a0', textOffset: 0 }];
        const visibleRunIndexes = safeRuns
            .map((run, index) => (/\S/.test(run.text || '') ? index : -1))
            .filter(index => index >= 0);
        let inlineIndex = startInlineIndex;
        let hasVisibleTextBefore = false;
        let currentTarget = target;

        for (const [runIndex, run] of safeRuns.entries()) {
            const runOffset = run.textOffset ?? run.sourceIndex ?? Number.MAX_SAFE_INTEGER;
            const hasVisibleTextAfter = visibleRunIndexes.some(index => index >= runIndex);

            while (inlineIndex < inlineBlocks.length) {
                const block = inlineBlocks[inlineIndex];
                const blockOffset = block.inlineTextOffset ?? block.inlineOffset ?? block.sourceIndex ?? Number.MAX_SAFE_INTEGER;
                const isLastLineTrailingBlock = lineRange?.treatTrailingAsWithinLine
                    && inlineIndex === inlineBlocks.length - 1
                    && blockOffset >= (lineRange?.lineEndOffset ?? Number.MAX_SAFE_INTEGER);
                const blockBelongsToLine = blockOffset >= (lineRange?.lineStartOffset ?? 0)
                    && (blockOffset < (lineRange?.lineEndOffset ?? Number.MAX_SAFE_INTEGER) || isLastLineTrailingBlock);

                if (!blockBelongsToLine || blockOffset > runOffset) {
                    break;
                }

                const context = {
                    hasVisibleTextBefore,
                    hasVisibleTextAfter
                };
                if (shouldSplitAroundInlineBlock(block, context) && lineHasVisibleContent(currentTarget)) {
                    currentTarget = createSimpleFlowLine(lineOptions, 'inline');
                    paragraphElement.appendChild(currentTarget);
                }
                appendInlineBlock(currentTarget, block, context);
                if (shouldSplitAroundInlineBlock(block, context)) {
                    currentTarget = createSimpleFlowLine(lineOptions, 'post-inline');
                    paragraphElement.appendChild(currentTarget);
                }
                inlineIndex += 1;
            }

            appendRichInlineText(currentTarget, [run], textOptions);
            if (/\S/.test(run.text || '')) {
                hasVisibleTextBefore = true;
            }
        }

        while (inlineIndex < inlineBlocks.length) {
            const block = inlineBlocks[inlineIndex];
            const blockOffset = block.inlineTextOffset ?? block.inlineOffset ?? block.sourceIndex ?? Number.MAX_SAFE_INTEGER;
            const isLastLineTrailingBlock = lineRange?.treatTrailingAsWithinLine
                && inlineIndex === inlineBlocks.length - 1
                && blockOffset >= (lineRange?.lineEndOffset ?? Number.MAX_SAFE_INTEGER);
            const blockBelongsToLine = blockOffset >= (lineRange?.lineStartOffset ?? 0)
                && (blockOffset < (lineRange?.lineEndOffset ?? Number.MAX_SAFE_INTEGER) || isLastLineTrailingBlock);

            if (!blockBelongsToLine) {
                break;
            }

            const context = {
                hasVisibleTextBefore,
                hasVisibleTextAfter: false
            };
            if (shouldSplitAroundInlineBlock(block, context) && lineHasVisibleContent(currentTarget)) {
                currentTarget = createSimpleFlowLine(lineOptions, 'inline');
                paragraphElement.appendChild(currentTarget);
            }
            appendInlineBlock(currentTarget, block, context);
            if (shouldSplitAroundInlineBlock(block, context)) {
                currentTarget = createSimpleFlowLine(lineOptions, 'post-inline');
                paragraphElement.appendChild(currentTarget);
            }
            inlineIndex += 1;
        }

        return {
            inlineIndex,
            currentLineElement: currentTarget
        };
    }

    function splitRunsByLine(runs) {
        if (!Array.isArray(runs) || runs.length === 0) {
            return [];
        }

        const lines = [[]];
        for (const run of runs) {
            const text = String(run.text || '');
            const parts = text.split('\n');
            let localOffset = 0;
            for (const [index, part] of parts.entries()) {
                if (part) {
                    lines[lines.length - 1].push({
                        ...run,
                        text: part,
                        textOffset: typeof run.textOffset === 'number'
                            ? run.textOffset + localOffset
                            : run.textOffset
                    });
                }
                localOffset += part.length;
                if (index < parts.length - 1) {
                    localOffset += 1;
                    lines.push([]);
                }
            }
        }

        return lines;
    }

    function appendRichInlineText(target, textOrRuns, options) {
        const runs = Array.isArray(textOrRuns)
            ? textOrRuns
            : [{ text: String(textOrRuns || '') }];
        const value = runs.map(run => run.text || '').join('');
        const tokenPattern = /(\t|\uFFFC|\[(?:이미지|image|img|도형|shape|object)\])/gi;
        const parts = value.split(tokenPattern).filter(part => part !== '');

        if (parts.length === 0) {
            target.textContent = '\u00a0';
            return;
        }

        let remainingRuns = runs
            .map(run => ({ ...run, text: String(run.text || '') }))
            .filter(run => run.text.length > 0);

        for (const part of parts) {
            if (part === '\t') {
                const tab = document.createElement('span');
                tab.className = options?.tabClassName || 'layout-simple-tab';
                tab.setAttribute('aria-hidden', 'true');
                tab.textContent = '\u00a0';
                tab.style.width = `${resolveTabAdvancePt(target)}pt`;
                target.appendChild(tab);
                continue;
            }

            if (part === '\uFFFC' || /^\[(?:이미지|image|img|도형|shape|object)\]$/i.test(part)) {
                const placeholder = document.createElement('span');
                placeholder.className = options?.placeholderClassName || 'layout-simple-placeholder';
                placeholder.textContent = part === '\uFFFC' ? 'Object' : part.replace(/^\[|\]$/g, '');
                target.appendChild(placeholder);
                continue;
            }

            let remainingText = part;
            while (remainingText && remainingRuns.length > 0) {
                const currentRun = remainingRuns[0];
                const chunk = currentRun.text.slice(0, remainingText.length);
                const textNode = createRunElement({
                    ...currentRun,
                    text: chunk
                });
                const wrapper = document.createElement('span');
                wrapper.className = options?.textRunClassName || 'layout-simple-text-run';
                const textParts = chunk.match(/([)\]}>»〉》」』、】【,.!?;:'"%]+|[(<«〈《「『【]+|\s+|[^)\]}>»〉》」』、】【,.!?;:'"%(<«〈《「『【\s]+)/g) || [chunk];
                for (const textPart of textParts) {
                    if (/^\s+$/.test(textPart)) {
                        const whitespaceNode = document.createElement('span');
                        whitespaceNode.className = `${options?.textRunClassName || 'layout-simple-text-run'}-space`;
                        whitespaceNode.textContent = textPart;
                        wrapper.appendChild(whitespaceNode);
                    } else {
                        const fragmentNode = createTextFragmentNode(textPart, `${options?.textRunClassName || 'layout-simple-text-run'}-fragment`);
                        wrapper.appendChild(fragmentNode);
                    }
                }
                if (!wrapper.childNodes.length) {
                    wrapper.appendChild(textNode);
                }
                target.appendChild(wrapper);

                remainingText = remainingText.slice(chunk.length);
                currentRun.text = currentRun.text.slice(chunk.length);
                if (!currentRun.text) {
                    remainingRuns.shift();
                }
            }

            if (remainingText) {
                const textNode = createTextFragmentNode(remainingText, options?.textRunClassName || 'layout-simple-text-run');
                target.appendChild(textNode);
            }
        }
    }

    function createTableCellContent(text, cell) {
        const content = document.createElement('div');
        content.className = 'layout-table-cell-content';
        const flowLayer = document.createElement('div');
        flowLayer.className = 'layout-table-cell-flow-layer';
        const overlayLayer = document.createElement('div');
        overlayLayer.className = 'layout-table-cell-overlay-layer';
        if (cell?.textAlign) {
            content.style.textAlign = cell.textAlign;
            content.dataset.align = cell.textAlign;
        }
        if (shouldCenterTableCellContent(cell)) {
            content.dataset.balance = 'centered';
        }
        if (cell?.heightPt) {
            content.style.minHeight = `${cell.heightPt}pt`;
        }

        const structuredParagraphs = Array.isArray(cell?.paragraphs) ? cell.paragraphs : [];
        const overlayBlocks = [];

        if (structuredParagraphs.length > 0) {
            for (const paragraph of structuredParagraphs) {
                const flowParagraph = {
                    ...paragraph,
                    inlineBlocks: (paragraph.inlineBlocks || []).filter(block => block.positioning !== 'absolute')
                };
                overlayBlocks.push(...(paragraph.inlineBlocks || []).filter(block => block.positioning === 'absolute'));
                flowLayer.appendChild(createSimpleParagraphElement(flowParagraph, {
                    paragraphClassName: 'layout-table-cell-paragraph',
                    lineClassName: 'layout-table-cell-line',
                    firstLineClassName: 'layout-table-cell-line-first',
                    continuationLineClassName: 'layout-table-cell-line-continuation',
                    emptyLineClassName: 'layout-table-cell-line-empty',
                    listParagraphClassName: 'layout-table-cell-paragraph-list',
                    listMarkerClassName: 'layout-table-cell-list-marker',
                    listTextClassName: 'layout-table-cell-list-text',
                    inlineBlockRowClassName: 'layout-table-cell-inline-block-row',
                    tabClassName: 'layout-table-cell-tab',
                    placeholderClassName: 'layout-table-cell-placeholder',
                    textRunClassName: 'layout-table-cell-text-run'
                }));
            }
            content.appendChild(flowLayer);
            content.appendChild(overlayLayer);
            scheduleCellOverlayRender(content, flowLayer, overlayLayer, overlayBlocks);
            return content;
        }

        const normalizedText = String(text || '').replace(/\r\n/g, '\n');
        const paragraphs = normalizedText.split('\n\n');

        for (const paragraphText of paragraphs) {
            flowLayer.appendChild(createSimpleParagraphElement(paragraphText, {
                paragraphClassName: 'layout-table-cell-paragraph',
                lineClassName: 'layout-table-cell-line',
                firstLineClassName: 'layout-table-cell-line-first',
                continuationLineClassName: 'layout-table-cell-line-continuation',
                emptyLineClassName: 'layout-table-cell-line-empty',
                listParagraphClassName: 'layout-table-cell-paragraph-list',
                listMarkerClassName: 'layout-table-cell-list-marker',
                listTextClassName: 'layout-table-cell-list-text',
                inlineBlockRowClassName: 'layout-table-cell-inline-block-row',
                tabClassName: 'layout-table-cell-tab',
                placeholderClassName: 'layout-table-cell-placeholder',
                textRunClassName: 'layout-table-cell-text-run'
            }));
        }

        if (!flowLayer.childNodes.length) {
            flowLayer.appendChild(createSimpleParagraphElement('', {
                paragraphClassName: 'layout-table-cell-paragraph',
                lineClassName: 'layout-table-cell-line',
                firstLineClassName: 'layout-table-cell-line-first',
                continuationLineClassName: 'layout-table-cell-line-continuation',
                emptyLineClassName: 'layout-table-cell-line-empty',
                listParagraphClassName: 'layout-table-cell-paragraph-list',
                listMarkerClassName: 'layout-table-cell-list-marker',
                listTextClassName: 'layout-table-cell-list-text',
                inlineBlockRowClassName: 'layout-table-cell-inline-block-row',
                tabClassName: 'layout-table-cell-tab',
                placeholderClassName: 'layout-table-cell-placeholder',
                textRunClassName: 'layout-table-cell-text-run'
            }));
        }

        content.appendChild(flowLayer);
        content.appendChild(overlayLayer);
        return content;
    }

    function scheduleCellOverlayRender(content, flowLayer, overlayLayer, blocks) {
        if (!Array.isArray(blocks) || blocks.length === 0) {
            return;
        }

        const render = () => renderCellOverlayBlocks(content, flowLayer, overlayLayer, blocks);
        queueMicrotask(render);

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                render();
                requestAnimationFrame(render);
            });
        }

        if (typeof ResizeObserver === 'function' && !overlayLayer._cellOverlayObserver) {
            const observer = new ResizeObserver(() => render());
            observer.observe(content);
            observer.observe(flowLayer);
            overlayLayer._cellOverlayObserver = observer;
        }

        if (typeof window !== 'undefined' && !overlayLayer._cellOverlayResizeHandler) {
            let rafId = 0;
            const resizeHandler = () => {
                if (typeof cancelAnimationFrame === 'function' && rafId) {
                    cancelAnimationFrame(rafId);
                }

                if (typeof requestAnimationFrame === 'function') {
                    rafId = requestAnimationFrame(() => {
                        rafId = 0;
                        render();
                    });
                    return;
                }

                render();
            };

            window.addEventListener('resize', resizeHandler, { passive: true });
            overlayLayer._cellOverlayResizeHandler = resizeHandler;
        }
    }

    function renderCellOverlayBlocks(content, flowLayer, overlayLayer, blocks) {
        if (!overlayLayer || !Array.isArray(blocks) || blocks.length === 0) {
            return;
        }

        const defaultCellElement = content.closest('.layout-table-cell');
        if (!defaultCellElement) {
            return;
        }
        const ownerCellId = defaultCellElement.dataset.cellId || '';
        const tableElement = defaultCellElement.closest('.layout-table');
        if (tableElement && ownerCellId) {
            for (const previousElement of tableElement.querySelectorAll(`[data-overlay-owner-cell-id="${ownerCellId}"]`)) {
                previousElement.remove();
            }
        } else {
            overlayLayer.replaceChildren();
        }

        const metrics = resolveCellLayoutMetrics(defaultCellElement, flowLayer, value => value);
        overlayLayer.style.left = `${metrics.borderLeftPx}px`;
        overlayLayer.style.top = `${metrics.borderTopPx}px`;
        overlayLayer.style.right = `${metrics.borderRightPx}px`;
        overlayLayer.style.bottom = `${metrics.borderBottomPx}px`;
        const baseCellMeta = readCellGridMeta(defaultCellElement);
        const { colSpan, rowSpan, colStart, colEnd, rowStart, rowEnd, totalCols, totalRows } = baseCellMeta;
        overlayLayer.dataset.colSpan = String(colSpan);
        overlayLayer.dataset.rowSpan = String(rowSpan);
        overlayLayer.dataset.colStart = String(colStart);
        overlayLayer.dataset.colEnd = String(colEnd);
        overlayLayer.dataset.rowStart = String(rowStart);
        overlayLayer.dataset.rowEnd = String(rowEnd);
        const clipInsetX = Math.min(Math.max(colSpan - 1, 0) * 2, 6);
        const clipInsetY = Math.min(Math.max(rowSpan - 1, 0) * 2, 6);
        overlayLayer.dataset.edgeLeft = colStart === 0 ? 'outer' : 'inner';
        overlayLayer.dataset.edgeRight = colEnd >= totalCols - 1 ? 'outer' : 'inner';
        overlayLayer.dataset.edgeTop = rowStart === 0 ? 'outer' : 'inner';
        overlayLayer.dataset.edgeBottom = rowEnd >= totalRows - 1 ? 'outer' : 'inner';
        const leftInset = colStart === 0 ? 0 : clipInsetX;
        const rightInset = colEnd >= totalCols - 1 ? 0 : clipInsetX;
        const topInset = rowStart === 0 ? 0 : clipInsetY;
        const bottomInset = rowEnd >= totalRows - 1 ? 0 : clipInsetY;
        overlayLayer.style.clipPath = `inset(${topInset}px ${rightInset}px ${bottomInset}px ${leftInset}px)`;

        const anchorPriority = scope => (
            scope === 'cell' ? 0
                : scope === 'paragraph' ? 2
                    : scope === 'character' ? 3
                        : 0
        );
        const blockKindPriority = kind => (
            kind === 'image' ? 0
                : kind === 'textbox' ? 1
                    : kind === 'line' ? 2
                        : 0
        );
        const blockAnchorBlendPriority = block => {
            const kindBase = block.kind === 'textbox'
                ? 2
                : block.kind === 'line'
                    ? 1
                    : 0;
            const scopeBase = block.anchorScope === 'character'
                ? 2
                : block.anchorScope === 'paragraph'
                    ? 1
                    : 0;
            return kindBase + scopeBase;
        };
        const blockEdgePriority = block => {
            const touchesOuterEdge = (
                overlayLayer.dataset.edgeLeft === 'outer'
                || overlayLayer.dataset.edgeRight === 'outer'
                || overlayLayer.dataset.edgeTop === 'outer'
                || overlayLayer.dataset.edgeBottom === 'outer'
            );
            if (!touchesOuterEdge) {
                return 0;
            }

            if (block.kind === 'line') {
                return -2;
            }

            if (block.kind === 'textbox') {
                return -1;
            }

            return 0;
        };
        const blockTransferDistance = block => {
            const sourceCellElement = resolveBlockSourceCellElement(defaultCellElement, block) || defaultCellElement;
            const targetCellElement = resolveBlockTargetCellElement(defaultCellElement, block) || defaultCellElement;
            return resolveCellTransferMetrics(sourceCellElement, targetCellElement).crossedBoundaries;
        };
        const blockTransferTierPriority = block => {
            const sourceCellElement = resolveBlockSourceCellElement(defaultCellElement, block) || defaultCellElement;
            const targetCellElement = resolveBlockTargetCellElement(defaultCellElement, block) || defaultCellElement;
            const transferMetrics = resolveCellTransferMetrics(sourceCellElement, targetCellElement);
            const tier = resolveTransferDistanceTier(transferMetrics);
            const tierBase = tier === 'far' ? -2 : tier === 'mid' ? -1 : 0;
            const dominantAxis = resolveTransferAxisDirection(transferMetrics);
            const kindBias = block.kind === 'line'
                ? (dominantAxis === 'horizontal' ? -1.25 : dominantAxis === 'vertical' ? -1.1 : -1)
                : block.kind === 'textbox'
                    ? (dominantAxis === 'vertical' ? -0.75 : -0.5)
                    : 0;
            return tierBase + kindBias;
        };
        const sortedBlocks = [...blocks].sort((left, right) => {
            const zOrder = (left.zIndex || 0) - (right.zIndex || 0);
            if (zOrder !== 0) {
                return zOrder;
            }

            const kindOrder = blockKindPriority(left.kind) - blockKindPriority(right.kind);
            if (kindOrder !== 0) {
                return kindOrder;
            }

            const scopeOrder = anchorPriority(left.anchorScope) - anchorPriority(right.anchorScope);
            if (scopeOrder !== 0) {
                return scopeOrder;
            }

            const blendOrder = blockAnchorBlendPriority(left) - blockAnchorBlendPriority(right);
            if (blendOrder !== 0) {
                return blendOrder;
            }

            const edgeOrder = blockEdgePriority(left) - blockEdgePriority(right);
            if (edgeOrder !== 0) {
                return edgeOrder;
            }

            const transferOrder = blockTransferDistance(left) - blockTransferDistance(right);
            if (transferOrder !== 0) {
                return transferOrder;
            }

            const transferTierOrder = blockTransferTierPriority(left) - blockTransferTierPriority(right);
            if (transferTierOrder !== 0) {
                return transferTierOrder;
            }

            return (left.sourceIndex || 0) - (right.sourceIndex || 0);
        });
        const touchedOverlayLayers = new Set();
        for (const block of sortedBlocks) {
            const sourceCellElement = resolveBlockSourceCellElement(defaultCellElement, block);
            const sourceFlowLayer = sourceCellElement?.querySelector('.layout-table-cell-flow-layer') || flowLayer;
            const targetCellElement = resolveBlockTargetCellElement(defaultCellElement, block);
            const targetFlowLayer = targetCellElement?.querySelector('.layout-table-cell-flow-layer') || flowLayer;
            const targetOverlayLayer = targetCellElement?.querySelector('.layout-table-cell-overlay-layer') || overlayLayer;
            const transferMetrics = resolveCellTransferMetrics(
                sourceCellElement || defaultCellElement,
                targetCellElement || defaultCellElement
            );
            const targetCellMeta = transferMetrics.targetMeta;
            const options = {
                absoluteResolver: currentBlock => resolveCellAbsoluteOffsets(
                    currentBlock,
                    targetCellElement || defaultCellElement,
                    targetFlowLayer,
                    {
                        sourceCellElement: sourceCellElement || defaultCellElement,
                        sourceContentElement: sourceFlowLayer || flowLayer,
                        transferMetrics
                    }
                )
            };
            let element = null;

            if (block.kind === 'image') {
                element = createImageElement(block, null, targetCellElement || defaultCellElement, options);
            } else if (block.kind === 'textbox') {
                element = createTextBoxElement(block, null, targetCellElement || defaultCellElement, options);
            } else if (block.kind === 'line') {
                element = createLineElement(block, null, targetCellElement || defaultCellElement, options);
            }

            if (element) {
                const transferEdges = resolveTransferEntryEdges(transferMetrics);
                const transferTier = resolveTransferDistanceTier(transferMetrics);
                element.dataset.cellAnchorScope = block.anchorScope || 'cell';
                element.dataset.cellZIndex = String(block.zIndex || 0);
                element.dataset.cellKind = block.kind;
                element.dataset.cellClipProfile = resolveTransferAwareCellClipProfile(
                    block.kind,
                    sourceCellElement || defaultCellElement,
                    targetCellElement || defaultCellElement
                );
                element.dataset.edgeLeft = targetCellMeta.colStart === 0 ? 'outer' : 'inner';
                element.dataset.edgeRight = targetCellMeta.colEnd >= targetCellMeta.totalCols - 1 ? 'outer' : 'inner';
                element.dataset.edgeTop = targetCellMeta.rowStart === 0 ? 'outer' : 'inner';
                element.dataset.edgeBottom = targetCellMeta.rowEnd >= targetCellMeta.totalRows - 1 ? 'outer' : 'inner';
                element.dataset.anchorCellId = block.anchorCellId || '';
                element.dataset.sourceCellId = sourceCellElement?.dataset?.cellId || ownerCellId;
                element.dataset.cellTransferDistance = String(transferMetrics.transferDistance || 0);
                element.dataset.cellCrossedBoundaries = String(transferMetrics.crossedBoundaries || 0);
                element.dataset.cellTransferColDelta = String(transferMetrics.colDelta || 0);
                element.dataset.cellTransferRowDelta = String(transferMetrics.rowDelta || 0);
                element.dataset.cellCrossedCols = String(transferMetrics.crossedCols || 0);
                element.dataset.cellCrossedRows = String(transferMetrics.crossedRows || 0);
                element.dataset.transferX = transferEdges.horizontal;
                element.dataset.transferY = transferEdges.vertical;
                element.dataset.transferTier = transferTier;
                element.dataset.transferAxis = resolveTransferAxisDirection(transferMetrics);
                element.dataset.overlayOwnerCellId = ownerCellId;
                element.dataset.sourceIndex = String(block.sourceIndex || 0);
                targetOverlayLayer.appendChild(element);
                touchedOverlayLayers.add(targetOverlayLayer);
            }
        }

        for (const layer of touchedOverlayLayers) {
            sortOverlayLayerChildren(layer);
        }
    }

    function sortOverlayLayerChildren(overlayLayer) {
        if (!overlayLayer) {
            return;
        }

        const anchorPriority = scope => (
            scope === 'cell' ? 0
                : scope === 'paragraph' ? 2
                    : scope === 'character' ? 3
                        : 0
        );
        const blockKindPriority = kind => (
            kind === 'image' ? 0
                : kind === 'textbox' ? 1
                    : kind === 'line' ? 2
                        : 0
        );
        const blockAnchorBlendPriority = element => {
            const kind = element.dataset.cellKind || '';
            const scope = element.dataset.cellAnchorScope || '';
            const kindBase = kind === 'textbox'
                ? 2
                : kind === 'line'
                    ? 1
                    : 0;
            const scopeBase = scope === 'character'
                ? 2
                : scope === 'paragraph'
                    ? 1
                    : 0;
            return kindBase + scopeBase;
        };
        const blockEdgePriority = element => {
            const touchesOuterEdge = (
                element.dataset.edgeLeft === 'outer'
                || element.dataset.edgeRight === 'outer'
                || element.dataset.edgeTop === 'outer'
                || element.dataset.edgeBottom === 'outer'
            );
            if (!touchesOuterEdge) {
                return 0;
            }

            if (element.dataset.cellKind === 'line') {
                return -2;
            }

            if (element.dataset.cellKind === 'textbox') {
                return -1;
            }

            return 0;
        };
        const blockTransferTierPriority = element => {
            const tier = element.dataset.transferTier || 'near';
            const kind = element.dataset.cellKind || '';
            const dominantAxis = element.dataset.transferAxis || 'balanced';
            const tierBase = tier === 'far' ? -2 : tier === 'mid' ? -1 : 0;
            const kindBias = kind === 'line'
                ? (dominantAxis === 'horizontal' ? -1.25 : dominantAxis === 'vertical' ? -1.1 : -1)
                : kind === 'textbox'
                    ? (dominantAxis === 'vertical' ? -0.75 : -0.5)
                    : 0;
            return tierBase + kindBias;
        };

        const orderedChildren = [...overlayLayer.children].sort((left, right) => {
            const zOrder = Number(left.dataset.cellZIndex || 0) - Number(right.dataset.cellZIndex || 0);
            if (zOrder !== 0) {
                return zOrder;
            }

            const kindOrder = blockKindPriority(left.dataset.cellKind || '') - blockKindPriority(right.dataset.cellKind || '');
            if (kindOrder !== 0) {
                return kindOrder;
            }

            const scopeOrder = anchorPriority(left.dataset.cellAnchorScope || '') - anchorPriority(right.dataset.cellAnchorScope || '');
            if (scopeOrder !== 0) {
                return scopeOrder;
            }

            const blendOrder = blockAnchorBlendPriority(left) - blockAnchorBlendPriority(right);
            if (blendOrder !== 0) {
                return blendOrder;
            }

            const edgeOrder = blockEdgePriority(left) - blockEdgePriority(right);
            if (edgeOrder !== 0) {
                return edgeOrder;
            }

            const transferOrder = Number(left.dataset.cellCrossedBoundaries || 0) - Number(right.dataset.cellCrossedBoundaries || 0);
            if (transferOrder !== 0) {
                return transferOrder;
            }

            const transferTierOrder = blockTransferTierPriority(left) - blockTransferTierPriority(right);
            if (transferTierOrder !== 0) {
                return transferTierOrder;
            }

            return Number(left.dataset.sourceIndex || 0) - Number(right.dataset.sourceIndex || 0);
        });

        for (const child of orderedChildren) {
            overlayLayer.appendChild(child);
        }
    }

    function readCellGridMeta(cellElement) {
        const colStart = Math.max(0, Number(cellElement?.dataset?.colStart || 0));
        const colEnd = Math.max(colStart, Number(cellElement?.dataset?.colEnd || colStart));
        const rowStart = Math.max(0, Number(cellElement?.dataset?.rowStart || 0));
        const rowEnd = Math.max(rowStart, Number(cellElement?.dataset?.rowEnd || rowStart));
        return {
            colSpan: Math.max(1, Number(cellElement?.dataset?.colSpan || 1)),
            rowSpan: Math.max(1, Number(cellElement?.dataset?.rowSpan || 1)),
            colStart,
            colEnd,
            rowStart,
            rowEnd,
            totalCols: Math.max(1, Number(cellElement?.dataset?.totalCols || colEnd + 1)),
            totalRows: Math.max(1, Number(cellElement?.dataset?.totalRows || rowEnd + 1))
        };
    }

    function resolveCellTransferMetrics(sourceCellElement, targetCellElement) {
        const sourceMeta = readCellGridMeta(sourceCellElement);
        const targetMeta = readCellGridMeta(targetCellElement);
        const sourceColCenter = (sourceMeta.colStart + sourceMeta.colEnd) / 2;
        const sourceRowCenter = (sourceMeta.rowStart + sourceMeta.rowEnd) / 2;
        const targetColCenter = (targetMeta.colStart + targetMeta.colEnd) / 2;
        const targetRowCenter = (targetMeta.rowStart + targetMeta.rowEnd) / 2;
        const colDelta = targetColCenter - sourceColCenter;
        const rowDelta = targetRowCenter - sourceRowCenter;
        const crossedCols = targetMeta.colStart > sourceMeta.colEnd
            ? targetMeta.colStart - sourceMeta.colEnd
            : sourceMeta.colStart > targetMeta.colEnd
                ? sourceMeta.colStart - targetMeta.colEnd
                : 0;
        const crossedRows = targetMeta.rowStart > sourceMeta.rowEnd
            ? targetMeta.rowStart - sourceMeta.rowEnd
            : sourceMeta.rowStart > targetMeta.rowEnd
                ? sourceMeta.rowStart - targetMeta.rowEnd
                : 0;
        return {
            sourceMeta,
            targetMeta,
            colDelta,
            rowDelta,
            crossedCols,
            crossedRows,
            transferDistance: Math.abs(colDelta) + Math.abs(rowDelta),
            crossedBoundaries: crossedCols + crossedRows
        };
    }

    function resolveTransferAwareCellClipProfile(kind, sourceCellElement, targetCellElement) {
        const transferMetrics = resolveCellTransferMetrics(sourceCellElement, targetCellElement);
        const baseProfile = resolveCellClipProfile(kind, transferMetrics.targetMeta.colSpan, transferMetrics.targetMeta.rowSpan);
        if (transferMetrics.transferDistance < 1) {
            return baseProfile;
        }

        if (kind === 'image') {
            return 'strict';
        }

        if (kind === 'textbox') {
            return transferMetrics.transferDistance >= 2 ? 'balanced' : baseProfile;
        }

        if (kind === 'line') {
            return transferMetrics.transferDistance >= 2 ? 'balanced' : baseProfile;
        }

        return baseProfile;
    }

    function resolveTransferEntryEdges(transferMetrics) {
        return {
            horizontal: transferMetrics?.colDelta > 0
                ? 'from-left'
                : transferMetrics?.colDelta < 0
                    ? 'from-right'
                    : 'none',
            vertical: transferMetrics?.rowDelta > 0
                ? 'from-top'
                : transferMetrics?.rowDelta < 0
                    ? 'from-bottom'
                    : 'none'
        };
    }

    function resolveTransferDistanceTier(transferMetrics) {
        const crossedBoundaries = transferMetrics?.crossedBoundaries || 0;
        const distance = transferMetrics?.transferDistance || 0;
        if (crossedBoundaries >= 3 || distance >= 4) {
            return 'far';
        }
        if (crossedBoundaries >= 1 || distance >= 1.5) {
            return 'mid';
        }
        return 'near';
    }

    function resolveBlockTargetCellElement(defaultCellElement, block) {
        if (!defaultCellElement || !block?.anchorCellId) {
            return defaultCellElement;
        }

        const tableElement = defaultCellElement.closest('.layout-table');
        if (!tableElement) {
            return defaultCellElement;
        }

        return tableElement.querySelector(`[data-cell-id="${block.anchorCellId}"]`) || defaultCellElement;
    }

    function resolveBlockSourceCellElement(defaultCellElement, block) {
        if (!defaultCellElement || !block) {
            return defaultCellElement;
        }

        const tableElement = defaultCellElement.closest('.layout-table');
        if (!tableElement) {
            return defaultCellElement;
        }

        if (block.anchorParagraphId) {
            const anchoredParagraph = tableElement.querySelector(`[data-paragraph-id="${block.anchorParagraphId}"]`);
            const paragraphCell = anchoredParagraph?.closest('.layout-table-cell');
            if (paragraphCell) {
                return paragraphCell;
            }
        }

        if (block.anchorCellId) {
            return tableElement.querySelector(`[data-cell-id="${block.anchorCellId}"]`) || defaultCellElement;
        }

        return defaultCellElement;
    }

    function resolveCellClipProfile(kind, colSpan, rowSpan) {
        const isMergedCell = (colSpan || 1) > 1 || (rowSpan || 1) > 1;
        if (kind === 'image') {
            return isMergedCell ? 'strict' : 'balanced';
        }

        if (kind === 'textbox') {
            return isMergedCell ? 'balanced' : 'soft';
        }

        if (kind === 'line') {
            return isMergedCell ? 'soft' : 'loose';
        }

        return 'balanced';
    }

    function createTableElement(table) {
        const wrapper = document.createElement('div');
        wrapper.className = 'layout-table-block';
        wrapper.style.marginTop = `${table.marginTopPt || 0}pt`;
        wrapper.style.marginBottom = `${table.marginBottomPt || 0}pt`;

        const tableElement = document.createElement('table');
        tableElement.className = 'layout-table';
        const tableRows = table.rows || [];
        const occupancy = [];
        const layoutRows = [];
        let totalCols = 0;

        for (const [rowIndex, row] of tableRows.entries()) {
            let colCursor = 0;
            const placements = [];

            for (const cell of row.cells || []) {
                while ((occupancy[colCursor] || 0) > 0) {
                    colCursor += 1;
                }

                const colSpan = Math.max(1, Number(cell.colSpan || 1));
                const rowSpan = Math.max(1, Number(cell.rowSpan || 1));
                placements.push({
                    cell,
                    rowStart: rowIndex,
                    rowEnd: rowIndex + rowSpan - 1,
                    colStart: colCursor,
                    colEnd: colCursor + colSpan - 1
                });

                for (let offset = 0; offset < colSpan; offset += 1) {
                    occupancy[colCursor + offset] = Math.max(occupancy[colCursor + offset] || 0, rowSpan - 1);
                }

                colCursor += colSpan;
                totalCols = Math.max(totalCols, colCursor);
            }

            layoutRows.push(placements);

            for (let columnIndex = 0; columnIndex < occupancy.length; columnIndex += 1) {
                if ((occupancy[columnIndex] || 0) > 0) {
                    occupancy[columnIndex] -= 1;
                }
            }
        }
        const totalRows = layoutRows.length;

        if (table.widthPt) {
            tableElement.style.width = `${table.widthPt}pt`;
        }

        tableElement.dataset.totalRows = String(totalRows);
        tableElement.dataset.totalCols = String(totalCols);
        const columnWidths = resolveTableColumnWidths(layoutRows);
        if (columnWidths.some(width => width > 0)) {
            const colGroup = document.createElement('colgroup');
            for (const width of columnWidths) {
                const col = document.createElement('col');
                if (width > 0) {
                    col.style.width = `${Number(width.toFixed(2))}pt`;
                }
                colGroup.appendChild(col);
            }
            tableElement.appendChild(colGroup);
        }

        for (const placements of layoutRows) {
            const tr = document.createElement('tr');
            tr.dataset.rowKind = placements.some(placement => (placement.cell.rowSpan || 1) > 1) ? 'merged' : 'regular';
            tr.dataset.cellCount = String(placements.length);

            for (const placement of placements) {
                const { cell, rowStart, rowEnd, colStart, colEnd } = placement;
                const td = document.createElement('td');
                td.className = 'layout-table-cell';
                if (cell.id) {
                    td.dataset.cellId = cell.id;
                }

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
                if (shouldCenterTableCellContent(cell)) {
                    td.dataset.verticalAlign = 'middle';
                    td.style.verticalAlign = 'middle';
                }

                if (cell.colSpan && cell.colSpan > 1) {
                    td.colSpan = cell.colSpan;
                }

                if (cell.rowSpan && cell.rowSpan > 1) {
                    td.rowSpan = cell.rowSpan;
                }

                td.dataset.colSpan = String(cell.colSpan || 1);
                td.dataset.rowSpan = String(cell.rowSpan || 1);
                td.dataset.rowStart = String(cell.rowStart ?? rowStart);
                td.dataset.rowEnd = String(cell.rowEnd ?? rowEnd);
                td.dataset.colStart = String(cell.colStart ?? colStart);
                td.dataset.colEnd = String(cell.colEnd ?? colEnd);
                td.dataset.totalRows = String(cell.totalRows ?? totalRows);
                td.dataset.totalCols = String(cell.totalCols ?? totalCols);
                if (cell.heightPt) {
                    td.dataset.heightPt = String(cell.heightPt);
                }
                td.dataset.contentWeight = String(
                    Math.max(
                        String(cell.text || '').trim().length,
                        Array.isArray(cell.paragraphs) ? cell.paragraphs.length * 12 : 0
                    )
                );

                td.appendChild(createTableCellContent(cell.text || '', cell));
                tr.appendChild(td);
            }

            tableElement.appendChild(tr);
        }

        wrapper.appendChild(tableElement);
        return wrapper;
    }

    function createImageElement(image, page, pageElement, options) {
        const inlineContext = Boolean(options && options.inlineContext);
        const absoluteResolver = options && options.absoluteResolver;
        const wrapper = document.createElement(inlineContext ? 'span' : 'figure');
        wrapper.className = 'layout-image-block';
        decorateBlockDiagnostics(wrapper, image);
        if (image.anchorScope) {
            wrapper.dataset.anchorScope = image.anchorScope;
        }
        wrapper.style.marginTop = `${image.marginTopPt || 0}pt`;
        wrapper.style.marginBottom = `${image.marginBottomPt || 0}pt`;

        if (inlineContext) {
            wrapper.classList.add('layout-image-block-inline');
            applyInlineFlowStyles(wrapper, image);
        }

        if (image.positioning === 'absolute') {
            const absoluteOffsets = typeof absoluteResolver === 'function'
                ? absoluteResolver(image)
                : resolveAbsoluteOffsets(image, page, pageElement);
            wrapper.classList.add('layout-image-block-absolute');
            wrapper.style.left = `${absoluteOffsets.leftPt}pt`;
            wrapper.style.top = `${absoluteOffsets.topPt}pt`;
            wrapper.style.zIndex = `${image.zIndex || 1}`;
            wrapper.style.marginTop = '0';
            wrapper.style.marginBottom = '0';
            applyPageAbsoluteDatasets(wrapper, image, page, pageElement);
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

    function createTextBoxElement(textBox, page, pageElement, options) {
        const inlineContext = Boolean(options && options.inlineContext);
        const absoluteResolver = options && options.absoluteResolver;
        const wrapper = document.createElement(inlineContext ? 'span' : 'section');
        wrapper.className = 'layout-textbox-block';
        decorateBlockDiagnostics(wrapper, textBox);
        if (textBox.anchorScope) {
            wrapper.dataset.anchorScope = textBox.anchorScope;
        }
        if (textBox.shapeType) {
            wrapper.classList.add(`layout-textbox-shape-${textBox.shapeType}`);
        }
        wrapper.style.marginTop = `${textBox.marginTopPt || 0}pt`;
        wrapper.style.marginBottom = `${textBox.marginBottomPt || 0}pt`;
        wrapper.style.textAlign = textBox.textAlign || 'left';

        if (inlineContext) {
            wrapper.classList.add('layout-textbox-block-inline');
            applyInlineFlowStyles(wrapper, textBox);
        }

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
            wrapper.style.backgroundSize = 'cover';
            wrapper.style.backgroundPosition = 'center center';
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

        const textBoxRotation = resolveFiniteRotation(textBox);
        if (textBoxRotation) {
            wrapper.style.setProperty('--base-rotate-deg', `${textBoxRotation}`);
        }

        if (textBox.positioning === 'absolute') {
            const absoluteOffsets = typeof absoluteResolver === 'function'
                ? absoluteResolver(textBox)
                : resolveAbsoluteOffsets(textBox, page, pageElement);
            wrapper.classList.add('layout-textbox-block-absolute');
            wrapper.style.left = `${absoluteOffsets.leftPt}pt`;
            wrapper.style.top = `${absoluteOffsets.topPt}pt`;
            wrapper.style.zIndex = `${textBox.zIndex || 1}`;
            wrapper.style.marginTop = '0';
            wrapper.style.marginBottom = '0';
            applyPageAbsoluteDatasets(wrapper, textBox, page, pageElement);
        } else if (textBoxRotation) {
            wrapper.style.transform = `rotate(${textBoxRotation}deg)`;
            wrapper.style.transformOrigin = 'center center';
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

    function createLineElement(line, page, pageElement, options) {
        const inlineContext = Boolean(options && options.inlineContext);
        const absoluteResolver = options && options.absoluteResolver;
        const wrapper = document.createElement(inlineContext ? 'span' : 'div');
        wrapper.className = 'layout-line-block';
        decorateBlockDiagnostics(wrapper, line);
        if (line.anchorScope) {
            wrapper.dataset.anchorScope = line.anchorScope;
        }
        wrapper.style.marginTop = `${line.marginTopPt || 0}pt`;
        wrapper.style.marginBottom = `${line.marginBottomPt || 0}pt`;

        if (inlineContext) {
            wrapper.classList.add('layout-line-block-inline');
            applyInlineFlowStyles(wrapper, line);
        }

        if (line.positioning === 'absolute') {
            const absoluteOffsets = typeof absoluteResolver === 'function'
                ? absoluteResolver(line)
                : resolveAbsoluteOffsets(line, page, pageElement);
            wrapper.classList.add('layout-line-block-absolute');
            wrapper.style.left = `${absoluteOffsets.leftPt}pt`;
            wrapper.style.top = `${absoluteOffsets.topPt}pt`;
            wrapper.style.zIndex = `${line.zIndex || 1}`;
            wrapper.style.marginTop = '0';
            wrapper.style.marginBottom = '0';
            applyPageAbsoluteDatasets(wrapper, line, page, pageElement);
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
        stroke.setAttribute('stroke-linejoin', 'round');
        stroke.setAttribute('stroke-miterlimit', '2');

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

        const lineRotation = resolveFiniteRotation(line);
        if (lineRotation) {
            wrapper.style.setProperty('--base-rotate-deg', `${lineRotation}`);
        }

        if (line.positioning !== 'absolute' && lineRotation) {
            wrapper.style.transform = `rotate(${lineRotation}deg)`;
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
        pageElement.dataset.sectionIndex = String(page.sectionIndex || pageIndex + 1);
        pageElement.dataset.sourcePageIndex = String(page.sourcePageIndex || pageIndex + 1);
        pageElement.dataset.splitPageIndex = String(page.splitPageIndex || 1);
        pageElement.dataset.sectionType = page.sectionType || 'single-column';
        pageElement.dataset.columnCount = String(page.columnCount || 1);
        pageElement.dataset.pageNumberStart = String(page.pageNumberStart || pageIndex + 1);
        pageElement.dataset.headerFooterVariant = page.headerFooterVariant || 'default';
        pageElement.dataset.footnoteCount = String(page.footnoteCount || 0);
        pageElement.dataset.endnoteCount = String(page.endnoteCount || 0);
        pageElement.dataset.absoluteCount = String((page.blocks || []).filter(block => block.positioning === 'absolute').length);
        pageElement.dataset.flowCount = String((page.blocks || []).filter(block => block.positioning !== 'absolute').length);
        pageElement.dataset.pageDensity = (page.blocks || []).length >= 24 ? 'dense' : (page.blocks || []).length >= 12 ? 'medium' : 'light';
        if (page.layoutSignature) {
            pageElement.dataset.layoutSignature = page.layoutSignature;
        }
        if (page.semanticSummary) {
            pageElement.dataset.semanticSummary = page.semanticSummary;
        }
        pageElement.setAttribute('aria-label', `${pageIndex + 1} page`);
        pageElement.style.width = `${page.widthPt || 595}pt`;
        pageElement.style.minHeight = `${page.minHeightPt || 842}pt`;
        pageElement.style.paddingTop = `${page.paddingPt?.top || 56}pt`;
        pageElement.style.paddingRight = `${page.paddingPt?.right || 56}pt`;
        pageElement.style.paddingBottom = `${page.paddingPt?.bottom || 56}pt`;
        pageElement.style.paddingLeft = `${page.paddingPt?.left || 56}pt`;
        if (page.columnGapPt) {
            pageElement.style.setProperty('--page-column-gap', `${page.columnGapPt}pt`);
        }

        const contentLayer = document.createElement('div');
        contentLayer.className = 'layout-page-content';
        const overlayLayer = document.createElement('div');
        overlayLayer.className = 'layout-page-overlay-layer';

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

        if (!pageHasExplicitPageNumber(page, pageIndex)) {
            const pageNumber = document.createElement('div');
            pageNumber.className = 'layout-page-number';
            pageNumber.textContent = `${pageIndex + 1}`;
            pageElement.appendChild(pageNumber);
        }

        if ((page.footnoteCount || 0) > 0 || (page.endnoteCount || 0) > 0) {
            const noteSummary = document.createElement('div');
            noteSummary.className = 'layout-page-note-summary';
            noteSummary.textContent = [
                page.footnoteCount ? `footnotes ${page.footnoteCount}` : '',
                page.endnoteCount ? `endnotes ${page.endnoteCount}` : ''
            ].filter(Boolean).join(' | ');
            pageElement.appendChild(noteSummary);
        }

        const footnotes = Array.isArray(page.footnotes) ? page.footnotes.filter(Boolean) : [];
        const endnotes = Array.isArray(page.endnotes) ? page.endnotes.filter(Boolean) : [];
        if (footnotes.length > 0 || endnotes.length > 0) {
            const noteArea = document.createElement('aside');
            noteArea.className = 'layout-page-note-area';

            for (const note of footnotes) {
                const noteItem = document.createElement('div');
                noteItem.className = 'layout-page-note-item';
                noteItem.dataset.noteKind = 'footnote';
                noteItem.dataset.noteId = note.id;
                const marker = document.createElement('span');
                marker.className = 'layout-page-note-marker';
                marker.textContent = `${note.marker || '?'}.`;
                const text = document.createElement('span');
                text.className = 'layout-page-note-text';
                text.textContent = note.text || '';
                noteItem.appendChild(marker);
                noteItem.appendChild(document.createTextNode(' '));
                noteItem.appendChild(text);
                noteArea.appendChild(noteItem);
            }

            for (const note of endnotes) {
                const noteItem = document.createElement('div');
                noteItem.className = 'layout-page-note-item';
                noteItem.dataset.noteKind = 'endnote';
                noteItem.dataset.noteId = note.id;
                const marker = document.createElement('span');
                marker.className = 'layout-page-note-marker';
                marker.textContent = `${note.marker || '?'}.`;
                const text = document.createElement('span');
                text.className = 'layout-page-note-text';
                text.textContent = note.text || '';
                noteItem.appendChild(marker);
                noteItem.appendChild(document.createTextNode(' '));
                noteItem.appendChild(text);
                noteArea.appendChild(noteItem);
            }

            pageElement.appendChild(noteArea);
        }

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
            contentLayer.appendChild(createBlockElement(block, page, pageElement));
        }

        const pageOverlayPriority = block => {
            const metrics = resolvePageAbsoluteMetrics(
                block,
                page,
                pageElement,
                resolveAnchorReference(pageElement, block, page)
            );
            const tierBase = metrics.tier === 'far' ? -2 : metrics.tier === 'mid' ? -1 : 0;
            const axisBias = metrics.dominantAxis === 'horizontal'
                ? (block.kind === 'line' ? -1 : 0)
                : metrics.dominantAxis === 'vertical'
                    ? (block.kind === 'textbox' ? -1 : 0)
                    : 0;
            return tierBase + axisBias;
        };
        overlayBlocks.sort((left, right) => {
            const zOrder = (left.zIndex || 0) - (right.zIndex || 0);
            if (zOrder !== 0) {
                return zOrder;
            }

            const priorityOrder = pageOverlayPriority(left) - pageOverlayPriority(right);
            if (priorityOrder !== 0) {
                return priorityOrder;
            }

            return (left.sourceIndex || 0) - (right.sourceIndex || 0);
        });
        for (const block of overlayBlocks) {
            overlayLayer.appendChild(createBlockElement(block, page, pageElement));
        }

        pageElement.appendChild(contentLayer);
        pageElement.appendChild(overlayLayer);
        wirePageNoteReferences(pageElement);

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

    function renderDiagnostics(documentData) {
        if (!hwpViewport || !documentData) {
            return;
        }

        const diagnosticsBox = document.createElement('div');
        diagnosticsBox.className = 'layout-warning-box layout-diagnostics-box';
        const pages = Array.isArray(documentData.pages) ? documentData.pages.length : 0;
        const signature = documentData.layoutSignature || '';
        const summary = documentData.semanticSummary || '';
        diagnosticsBox.textContent = [
            `signature: ${signature || 'n/a'}`,
            `summary: ${summary || 'n/a'}`,
            `pages: ${pages}`
        ].join(' | ');
        hwpViewport.appendChild(diagnosticsBox);
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
        if (layoutDocument.layoutSignature) {
            hwpViewport.dataset.layoutSignature = layoutDocument.layoutSignature;
        }
        if (layoutDocument.semanticSummary) {
            hwpViewport.dataset.semanticSummary = layoutDocument.semanticSummary;
        }

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
