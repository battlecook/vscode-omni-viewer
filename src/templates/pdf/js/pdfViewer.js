(function () {
    'use strict';

    const pdfDataEl = document.getElementById('pdf-data');
    const pdfData = JSON.parse(pdfDataEl.textContent);
    const pdfBase64 = pdfData.base64;
    const fileName = pdfData.fileName || 'document.pdf';

    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const pdfBody = document.getElementById('pdfBody');
    const pagesContainer = document.getElementById('pagesContainer');
    const thumbnailList = document.getElementById('thumbnailList');
    const pageInfoEl = document.getElementById('pageInfo');
    const zoomLevelEl = document.getElementById('zoomLevel');
    const btnView = document.getElementById('btnView');
    const btnText = document.getElementById('btnText');
    const btnSignature = document.getElementById('btnSignature');
    const btnMerge = document.getElementById('btnMerge');
    const btnSave = document.getElementById('btnSave');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const mergePdfInput = document.getElementById('mergePdfInput');

    const textModal = document.getElementById('textModal');
    const textInput = document.getElementById('textInput');
    const textConfirm = document.getElementById('textConfirm');
    const textCancel = document.getElementById('textCancel');
    const signatureModal = document.getElementById('signatureModal');
    const signatureCanvasWrap = document.getElementById('signatureCanvasWrap');
    const signatureConfirm = document.getElementById('signatureConfirm');
    const signatureCancelBtn = document.getElementById('signatureCancel');

    let pdfDocs = [];
    let sourcePdfBase64List = [];
    let pageEntries = []; // { sourceDocIndex, sourcePageIndex }

    let scale = 1;
    const MIN_SCALE = 0.5;
    const MAX_SCALE = 3;
    const SCALE_STEP = 0.25;

    let mode = 'view'; // 'view' | 'text' | 'signature'
    let pageData = []; // { pdfWidth, pdfHeight, viewWidth, viewHeight, wrapper }
    const annotations = { texts: [], signatures: [] };

    let pendingTextPosition = null;
    let pendingSignaturePosition = null;
    let signatureCanvas = null;
    let isDraggingAnnotation = false;
    let dragEndedAt = 0;
    let signatureCanceledAt = 0;
    let draggedThumbnailIndex = null;

    function base64ToUint8Array(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function uint8ArrayToBase64(bytes) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    function getVscodeApi() {
        return typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;
    }

    function postMessage(msg) {
        const vscode = getVscodeApi();
        if (vscode) vscode.postMessage(msg);
    }

    function setMode(m) {
        mode = m;
        btnView.classList.toggle('active', m === 'view');
        btnText.classList.toggle('active', m === 'text');
        btnSignature.classList.toggle('active', m === 'signature');
    }

    function entryKey(entry) {
        return entry.sourceDocIndex + ':' + entry.sourcePageIndex;
    }

    function viewToPdfCoords(pageIndex, viewX, viewY, viewW, viewH) {
        if (pageIndex < 0 || pageIndex >= pageData.length) return { x: 0, y: 0 };
        const p = pageData[pageIndex];
        const x = (viewX / viewW) * p.pdfWidth;
        const y = p.pdfHeight - (viewY / viewH) * p.pdfHeight;
        return { x, y };
    }

    function pdfToViewCoords(pageIndex, pdfX, pdfY) {
        if (pageIndex < 0 || pageIndex >= pageData.length) return { x: 0, y: 0 };
        const p = pageData[pageIndex];
        const x = (pdfX / p.pdfWidth) * p.viewWidth;
        const y = ((p.pdfHeight - pdfY) / p.pdfHeight) * p.viewHeight;
        return { x, y };
    }

    function remapAnnotations(oldEntries) {
        const newIndexByKey = new Map();
        pageEntries.forEach(function (entry, idx) {
            newIndexByKey.set(entryKey(entry), idx);
        });

        annotations.texts.forEach(function (ann) {
            if (ann.pageIndex < 0 || ann.pageIndex >= oldEntries.length) return;
            const newIndex = newIndexByKey.get(entryKey(oldEntries[ann.pageIndex]));
            if (typeof newIndex === 'number') ann.pageIndex = newIndex;
        });

        annotations.signatures.forEach(function (ann) {
            if (ann.pageIndex < 0 || ann.pageIndex >= oldEntries.length) return;
            const newIndex = newIndexByKey.get(entryKey(oldEntries[ann.pageIndex]));
            if (typeof newIndex === 'number') ann.pageIndex = newIndex;
        });
    }

    function makeAnnotationDraggable(el) {
        const type = el.dataset.type;
        const pageIndex = parseInt(el.dataset.pageIndex, 10);
        const annIndex = parseInt(el.dataset.annotationIndex, 10);
        if (isNaN(pageIndex) || pageIndex < 0 || pageIndex >= pageData.length) return;
        const p = pageData[pageIndex];

        let startX;
        let startY;
        let startLeft;
        let startTop;

        function updateAnnotationFromPosition() {
            const viewX = parseInt(el.style.left, 10) || 0;
            const viewY = parseInt(el.style.top, 10) || 0;
            const pdfPos = viewToPdfCoords(pageIndex, viewX, viewY, p.viewWidth, p.viewHeight);

            if (type === 'text') {
                annotations.texts[annIndex] = Object.assign({}, annotations.texts[annIndex], {
                    x: pdfPos.x,
                    y: pdfPos.y
                });
            } else if (type === 'signature') {
                const viewW = el.offsetWidth;
                const viewH = el.offsetHeight;
                const pdfW = (viewW / p.viewWidth) * p.pdfWidth;
                const pdfH = (viewH / p.viewHeight) * p.pdfHeight;
                annotations.signatures[annIndex] = Object.assign({}, annotations.signatures[annIndex], {
                    x: pdfPos.x,
                    y: pdfPos.y,
                    width: pdfW,
                    height: pdfH
                });
            }
        }

        function onMouseMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let newLeft = startLeft + dx;
            let newTop = startTop + dy;
            const maxLeft = p.viewWidth - el.offsetWidth;
            const maxTop = p.viewHeight - el.offsetHeight;
            newLeft = Math.max(0, Math.min(maxLeft, newLeft));
            newTop = Math.max(0, Math.min(maxTop, newTop));
            el.style.left = newLeft + 'px';
            el.style.top = newTop + 'px';
            updateAnnotationFromPosition();
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            isDraggingAnnotation = false;
            dragEndedAt = Date.now();
        }

        el.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            if (mode !== 'view') return;
            e.preventDefault();
            e.stopPropagation();
            isDraggingAnnotation = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(el.style.left, 10) || 0;
            startTop = parseInt(el.style.top, 10) || 0;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    function createTextAnnotationElement(textAnn, idx) {
        const p = pageData[textAnn.pageIndex];
        if (!p) return;
        const pos = pdfToViewCoords(textAnn.pageIndex, textAnn.x, textAnn.y);
        const div = document.createElement('div');
        div.className = 'annotation-text';
        div.textContent = textAnn.text;
        div.style.fontSize = (textAnn.fontSize || 12) + 'px';
        div.style.left = pos.x + 'px';
        div.style.top = pos.y + 'px';
        div.dataset.type = 'text';
        div.dataset.pageIndex = String(textAnn.pageIndex);
        div.dataset.annotationIndex = String(idx);
        p.wrapper.appendChild(div);
        makeAnnotationDraggable(div);
    }

    function createSignatureAnnotationElement(sigAnn, idx) {
        const p = pageData[sigAnn.pageIndex];
        if (!p) return;
        const pos = pdfToViewCoords(sigAnn.pageIndex, sigAnn.x, sigAnn.y);
        const viewW = (sigAnn.width / p.pdfWidth) * p.viewWidth;
        const viewH = (sigAnn.height / p.pdfHeight) * p.viewHeight;

        const wrap = document.createElement('div');
        wrap.className = 'annotation-signature';
        wrap.style.left = pos.x + 'px';
        wrap.style.top = pos.y + 'px';
        wrap.style.width = viewW + 'px';
        wrap.style.height = viewH + 'px';
        wrap.dataset.type = 'signature';
        wrap.dataset.pageIndex = String(sigAnn.pageIndex);
        wrap.dataset.annotationIndex = String(idx);

        const img = document.createElement('img');
        img.src = 'data:image/png;base64,' + sigAnn.imageBase64;
        img.draggable = false;
        img.style.pointerEvents = 'none';
        wrap.appendChild(img);

        p.wrapper.appendChild(wrap);
        makeAnnotationDraggable(wrap);
    }

    function renderAnnotations() {
        annotations.texts.forEach(function (t, idx) {
            createTextAnnotationElement(t, idx);
        });
        annotations.signatures.forEach(function (s, idx) {
            createSignatureAnnotationElement(s, idx);
        });
    }

    function addTextAnnotation(pageIndex, viewX, viewY, text, fontSize) {
        if (!text || pageIndex < 0 || pageIndex >= pageData.length) return;
        const p = pageData[pageIndex];
        const pdfPos = viewToPdfCoords(pageIndex, viewX, viewY, p.viewWidth, p.viewHeight);

        annotations.texts.push({
            pageIndex: pageIndex,
            x: pdfPos.x,
            y: pdfPos.y,
            text: text,
            fontSize: fontSize || 12
        });

        createTextAnnotationElement(annotations.texts[annotations.texts.length - 1], annotations.texts.length - 1);
    }

    function addSignatureAnnotation(pageIndex, imageBase64, viewX, viewY, viewW, viewH) {
        if (pageIndex < 0 || pageIndex >= pageData.length) return;
        const p = pageData[pageIndex];
        const pdfPos = viewToPdfCoords(pageIndex, viewX, viewY, p.viewWidth, p.viewHeight);
        const pdfW = (viewW / p.viewWidth) * p.pdfWidth;
        const pdfH = (viewH / p.viewHeight) * p.pdfHeight;

        annotations.signatures.push({
            pageIndex: pageIndex,
            imageBase64: imageBase64,
            x: pdfPos.x,
            y: pdfPos.y,
            width: pdfW,
            height: pdfH
        });

        createSignatureAnnotationElement(annotations.signatures[annotations.signatures.length - 1], annotations.signatures.length - 1);
    }

    function showTextModal(pageIndex, viewX, viewY) {
        pendingTextPosition = { pageIndex: pageIndex, viewX: viewX, viewY: viewY };
        textInput.value = '';
        textModal.style.display = 'flex';
        textInput.focus();
    }

    function hideTextModal() {
        textModal.style.display = 'none';
        pendingTextPosition = null;
    }

    function startSignaturePad(pageIndex, viewX, viewY) {
        if (!signatureModal || !signatureCanvasWrap) return;
        pendingSignaturePosition = { pageIndex: pageIndex, viewX: viewX, viewY: viewY };
        signatureCanvasWrap.innerHTML = '';

        const w = 320;
        const h = 140;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.className = 'signature-canvas-el';
        signatureCanvasWrap.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        let drawing = false;

        function getPos(e) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        }

        canvas.addEventListener('mousedown', function (e) {
            drawing = true;
            const pos = getPos(e);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
        });

        canvas.addEventListener('mousemove', function (e) {
            if (!drawing) return;
            const pos = getPos(e);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        });

        canvas.addEventListener('mouseup', function () {
            drawing = false;
        });

        canvas.addEventListener('mouseleave', function () {
            drawing = false;
        });

        signatureCanvas = canvas;
        signatureModal.style.display = 'flex';
    }

    function hideSignatureModal() {
        if (signatureModal) signatureModal.style.display = 'none';
        if (signatureCanvasWrap) signatureCanvasWrap.innerHTML = '';
        signatureCanvas = null;
        pendingSignaturePosition = null;
    }

    function onPageClick(pageIndex, viewX, viewY, e) {
        if (isDraggingAnnotation || (Date.now() - dragEndedAt < 150)) return;
        if (e && e.target && e.target.closest && e.target.closest('.annotation-text, .annotation-signature')) return;

        if (mode === 'text') {
            showTextModal(pageIndex, viewX, viewY);
        } else if (mode === 'signature') {
            if (Date.now() - signatureCanceledAt < 300) return;
            startSignaturePad(pageIndex, viewX, viewY);
        }
    }

    async function loadPdfDocumentFromBase64(base64) {
        const pdfjsLib = window['pdfjsLib'];
        if (!pdfjsLib) throw new Error('Failed to load PDF.js.');
        const bytes = base64ToUint8Array(base64);
        return await pdfjsLib.getDocument({ data: bytes }).promise;
    }

    function updatePageInfo() {
        pageInfoEl.textContent = '1 / ' + pageEntries.length;
    }

    function setupMainPdf(doc) {
        pdfDocs = [doc];
        sourcePdfBase64List = [pdfBase64];
        pageEntries = [];
        for (let i = 0; i < doc.numPages; i++) {
            pageEntries.push({ sourceDocIndex: 0, sourcePageIndex: i });
        }
        updatePageInfo();
    }

    async function appendSecondPdf(base64) {
        if (sourcePdfBase64List.length >= 2) {
            postMessage({ command: 'warning', text: 'Only one additional PDF can be merged at a time.' });
            return;
        }

        const secondDoc = await loadPdfDocumentFromBase64(base64);
        const sourceDocIndex = pdfDocs.length;
        pdfDocs.push(secondDoc);
        sourcePdfBase64List.push(base64);

        for (let i = 0; i < secondDoc.numPages; i++) {
            pageEntries.push({ sourceDocIndex: sourceDocIndex, sourcePageIndex: i });
        }

        updatePageInfo();
        renderPagesSync();
    }

    function reorderPageEntries(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        if (fromIndex < 0 || fromIndex >= pageEntries.length) return;
        if (toIndex < 0 || toIndex >= pageEntries.length) return;

        const oldEntries = pageEntries.slice();
        const moved = pageEntries.splice(fromIndex, 1)[0];
        pageEntries.splice(toIndex, 0, moved);
        remapAnnotations(oldEntries);
        renderPagesSync();
    }

    const THUMB_SCALE = 0.2;

    function clearThumbnailStates() {
        thumbnailList.querySelectorAll('.thumbnail-item.drop-target').forEach(function (el) {
            el.classList.remove('drop-target');
        });
    }

    function renderThumbnails() {
        if (!thumbnailList) return;
        thumbnailList.innerHTML = '';

        function addThumb(idx) {
            if (idx >= pageEntries.length) return;

            const entry = pageEntries[idx];
            const sourceDoc = pdfDocs[entry.sourceDocIndex];
            sourceDoc.getPage(entry.sourcePageIndex + 1).then(function (page) {
                const viewport = page.getViewport({ scale: THUMB_SCALE });

                const div = document.createElement('div');
                div.className = 'thumbnail-item';
                div.dataset.pageIndex = String(idx);
                div.draggable = true;

                const canvas = document.createElement('canvas');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                const ctx = canvas.getContext('2d');
                div.appendChild(canvas);

                const label = document.createElement('div');
                label.className = 'page-num';
                label.textContent = String(idx + 1);
                div.appendChild(label);

                div.addEventListener('click', function () {
                    if (pageData[idx] && pageData[idx].wrapper) {
                        pageData[idx].wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    thumbnailList.querySelectorAll('.thumbnail-item.active').forEach(function (el) {
                        el.classList.remove('active');
                    });
                    div.classList.add('active');
                });

                div.addEventListener('dragstart', function () {
                    draggedThumbnailIndex = idx;
                    div.classList.add('dragging');
                });

                div.addEventListener('dragend', function () {
                    draggedThumbnailIndex = null;
                    div.classList.remove('dragging');
                    clearThumbnailStates();
                });

                div.addEventListener('dragover', function (e) {
                    e.preventDefault();
                    clearThumbnailStates();
                    div.classList.add('drop-target');
                });

                div.addEventListener('dragleave', function () {
                    div.classList.remove('drop-target');
                });

                div.addEventListener('drop', function (e) {
                    e.preventDefault();
                    div.classList.remove('drop-target');
                    const dropIndex = idx;
                    if (typeof draggedThumbnailIndex === 'number') {
                        reorderPageEntries(draggedThumbnailIndex, dropIndex);
                    }
                });

                thumbnailList.appendChild(div);

                page.render({
                    canvasContext: ctx,
                    viewport: viewport
                }).promise.then(function () {
                    addThumb(idx + 1);
                });
            });
        }

        addThumb(0);
    }

    function renderPagesSync() {
        pagesContainer.innerHTML = '';
        pageData = [];
        updatePageInfo();

        function renderOne(idx) {
            if (idx >= pageEntries.length) {
                renderThumbnails();
                renderAnnotations();
                setMode(mode);
                return;
            }

            const entry = pageEntries[idx];
            const sourceDoc = pdfDocs[entry.sourceDocIndex];
            sourceDoc.getPage(entry.sourcePageIndex + 1).then(function (page) {
                const viewport = page.getViewport({ scale: scale });
                const wrapper = document.createElement('div');
                wrapper.className = 'page-wrapper';
                wrapper.dataset.pageIndex = String(idx);

                const canvas = document.createElement('canvas');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                canvas.style.width = viewport.width + 'px';
                canvas.style.height = viewport.height + 'px';

                const ctx = canvas.getContext('2d');
                wrapper.appendChild(canvas);
                pagesContainer.appendChild(wrapper);

                pageData.push({
                    pdfWidth: viewport.width,
                    pdfHeight: viewport.height,
                    viewWidth: viewport.width,
                    viewHeight: viewport.height,
                    wrapper: wrapper
                });

                wrapper.addEventListener('click', function (e) {
                    if (mode === 'view') return;
                    const rect = wrapper.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    onPageClick(idx, x, y, e);
                });

                page.render({
                    canvasContext: ctx,
                    viewport: viewport
                }).promise.then(function () {
                    renderOne(idx + 1);
                });
            });
        }

        renderOne(0);
    }

    function doSave() {
        const hasMerge = sourcePdfBase64List.length > 1;
        const hasPageOrderChange = pageEntries.some(function (entry, idx) {
            return entry.sourceDocIndex !== 0 || entry.sourcePageIndex !== idx;
        });
        const hasAnnotations = annotations.texts.length > 0 || annotations.signatures.length > 0;

        if (!hasAnnotations && !hasMerge && !hasPageOrderChange) {
            postMessage({ command: 'info', text: 'No changes to save.' });
            return;
        }

        const sourcePageOffsets = [];
        let offset = 0;
        for (let i = 0; i < pdfDocs.length; i++) {
            sourcePageOffsets.push(offset);
            offset += pdfDocs[i].numPages;
        }

        const pageOrder = pageEntries.map(function (entry) {
            return sourcePageOffsets[entry.sourceDocIndex] + entry.sourcePageIndex;
        });

        postMessage({
            type: 'savePdf',
            command: 'savePdf',
            data: {
                texts: annotations.texts,
                signatures: annotations.signatures,
                pageOrder: pageOrder,
                extraPdfBase64List: sourcePdfBase64List.slice(1)
            }
        });
    }

    btnView.addEventListener('click', function () { setMode('view'); });
    btnText.addEventListener('click', function () { setMode('text'); });
    btnSignature.addEventListener('click', function () { setMode('signature'); });
    btnMerge.addEventListener('click', function () {
        if (sourcePdfBase64List.length >= 2) {
            postMessage({ command: 'warning', text: 'Only one additional PDF can be merged at a time.' });
            return;
        }
        mergePdfInput.click();
    });

    mergePdfInput.addEventListener('change', async function (event) {
        const target = event.target;
        const file = target.files && target.files[0];
        target.value = '';

        if (!file) return;

        try {
            const arrayBuffer = await file.arrayBuffer();
            const base64 = uint8ArrayToBase64(new Uint8Array(arrayBuffer));
            await appendSecondPdf(base64);
            postMessage({ command: 'info', text: 'Second PDF merged into the preview. Click Save to write file.' });
        } catch (err) {
            postMessage({
                command: 'error',
                text: 'Failed to merge selected PDF: ' + (err && err.message ? err.message : String(err))
            });
        }
    });

    btnSave.addEventListener('click', doSave);

    zoomInBtn.addEventListener('click', function () {
        if (scale >= MAX_SCALE) return;
        scale += SCALE_STEP;
        zoomLevelEl.textContent = Math.round(scale * 100) + '%';
        renderPagesSync();
    });

    zoomOutBtn.addEventListener('click', function () {
        if (scale <= MIN_SCALE) return;
        scale -= SCALE_STEP;
        zoomLevelEl.textContent = Math.round(scale * 100) + '%';
        renderPagesSync();
    });

    textConfirm.addEventListener('click', function () {
        const text = textInput.value.trim();
        if (pendingTextPosition && text) {
            addTextAnnotation(
                pendingTextPosition.pageIndex,
                pendingTextPosition.viewX,
                pendingTextPosition.viewY,
                text,
                12
            );
            setMode('view');
        }
        hideTextModal();
    });

    textCancel.addEventListener('click', hideTextModal);
    textInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') textConfirm.click();
        if (e.key === 'Escape') hideTextModal();
    });

    signatureConfirm.addEventListener('click', function () {
        if (!pendingSignaturePosition || !signatureCanvas) return;
        const dataUrl = signatureCanvas.toDataURL('image/png');
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const w = 320;
        const h = 140;

        addSignatureAnnotation(
            pendingSignaturePosition.pageIndex,
            base64,
            pendingSignaturePosition.viewX,
            pendingSignaturePosition.viewY,
            w,
            h
        );
        hideSignatureModal();
        setMode('view');
    });

    signatureCancelBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        signatureCanceledAt = Date.now();
        hideSignatureModal();
    });

    async function initialize() {
        try {
            const mainDoc = await loadPdfDocumentFromBase64(pdfBase64);
            setupMainPdf(mainDoc);
            loadingEl.style.display = 'none';
            pdfBody.style.display = 'flex';
            zoomLevelEl.textContent = Math.round(scale * 100) + '%';
            renderPagesSync();
        } catch (err) {
            loadingEl.style.display = 'none';
            errorEl.textContent = 'Failed to load PDF: ' + (err && err.message ? err.message : String(err));
            errorEl.style.display = 'block';
        }
    }

    initialize();
})();
