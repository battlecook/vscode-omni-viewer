(function () {
    'use strict';

    const pdfDataEl = document.getElementById('pdf-data');
    const pdfData = JSON.parse(pdfDataEl.textContent);
    const pdfBase64 = pdfData.base64;
    const fileName = pdfData.fileName || 'document.pdf';

    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const pdfBody = document.getElementById('pdfBody');
    const pdfContainer = document.getElementById('pdfContainer');
    const pagesContainer = document.getElementById('pagesContainer');
    const thumbnailList = document.getElementById('thumbnailList');
    const overlayLayer = document.getElementById('overlayLayer');
    const pageInfoEl = document.getElementById('pageInfo');
    const zoomLevelEl = document.getElementById('zoomLevel');
    const btnView = document.getElementById('btnView');
    const btnText = document.getElementById('btnText');
    const btnSignature = document.getElementById('btnSignature');
    const btnSave = document.getElementById('btnSave');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const textModal = document.getElementById('textModal');
    const textInput = document.getElementById('textInput');
    const textConfirm = document.getElementById('textConfirm');
    const textCancel = document.getElementById('textCancel');

    let pdfDoc = null;
    let scale = 1;
    const MIN_SCALE = 0.5;
    const MAX_SCALE = 3;
    const SCALE_STEP = 0.25;

    let mode = 'view'; // 'view' | 'text' | 'signature'
    let pageData = []; // { pdfWidth, pdfHeight, viewWidth, viewHeight, wrapper }
    let annotations = { texts: [], signatures: [] };
    let pendingTextPosition = null;
    let signaturePad = null;
    let signatureCanvas = null;
    let isDraggingAnnotation = false;
    let dragEndedAt = 0;
    let signatureCanceledAt = 0;

    function base64ToUint8Array(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function getVscodeApi() {
        return typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;
    }

    function postMessage(msg) {
        const vscode = getVscodeApi();
        if (vscode) vscode.postMessage(msg);
    }

    function viewToPdfCoords(pageIndex, viewX, viewY, viewW, viewH) {
        if (pageIndex < 0 || pageIndex >= pageData.length) return { x: 0, y: 0 };
        const p = pageData[pageIndex];
        const x = (viewX / viewW) * p.pdfWidth;
        const y = p.pdfHeight - (viewY / viewH) * p.pdfHeight;
        return { x, y };
    }

    function setMode(m) {
        mode = m;
        btnView.classList.toggle('active', m === 'view');
        btnText.classList.toggle('active', m === 'text');
        btnSignature.classList.toggle('active', m === 'signature');
    }

    function makeAnnotationDraggable(el) {
        const type = el.dataset.type;
        const pageIndex = parseInt(el.dataset.pageIndex, 10);
        const annIndex = parseInt(el.dataset.annotationIndex, 10);
        if (isNaN(pageIndex) || pageIndex < 0 || pageIndex >= pageData.length) return;
        const p = pageData[pageIndex];
        let startX, startY, startLeft, startTop;

        function updateAnnotationFromPosition() {
            const viewX = parseInt(el.style.left, 10) || 0;
            const viewY = parseInt(el.style.top, 10) || 0;
            const { x: pdfX, y: pdfY } = viewToPdfCoords(pageIndex, viewX, viewY, p.viewWidth, p.viewHeight);
            if (type === 'text') {
                annotations.texts[annIndex] = Object.assign({}, annotations.texts[annIndex], { x: pdfX, y: pdfY });
            } else if (type === 'signature') {
                const viewW = el.offsetWidth;
                const viewH = el.offsetHeight;
                const pdfW = (viewW / p.viewWidth) * p.pdfWidth;
                const pdfH = (viewH / p.viewHeight) * p.pdfHeight;
                annotations.signatures[annIndex] = Object.assign({}, annotations.signatures[annIndex], { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
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
        if (mode !== 'view') return; // only drag annotations in View mode
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

    function addTextAnnotation(pageIndex, viewX, viewY, text, fontSize) {
        if (!text || pageIndex < 0 || pageIndex >= pageData.length) return;
        const p = pageData[pageIndex];
        const { x: pdfX, y: pdfY } = viewToPdfCoords(pageIndex, viewX, viewY, p.viewWidth, p.viewHeight);
        annotations.texts.push({
            pageIndex,
            x: pdfX,
            y: pdfY,
            text,
            fontSize: fontSize || 12
        });
        const idx = annotations.texts.length - 1;
        const div = document.createElement('div');
        div.className = 'annotation-text';
        div.textContent = text;
        div.style.fontSize = (fontSize || 12) + 'px';
        div.style.left = viewX + 'px';
        div.style.top = viewY + 'px';
        div.dataset.type = 'text';
        div.dataset.pageIndex = String(pageIndex);
        div.dataset.annotationIndex = String(idx);
        p.wrapper.appendChild(div);
        makeAnnotationDraggable(div);
    }

    function addSignatureAnnotation(pageIndex, imageBase64, viewX, viewY, viewW, viewH) {
        if (pageIndex < 0 || pageIndex >= pageData.length) return;
        const p = pageData[pageIndex];
        const { x: pdfX, y: pdfY } = viewToPdfCoords(pageIndex, viewX, viewY, p.viewWidth, p.viewHeight);
        const pdfW = (viewW / p.viewWidth) * p.pdfWidth;
        const pdfH = (viewH / p.viewHeight) * p.pdfHeight;
        annotations.signatures.push({
            pageIndex,
            imageBase64,
            x: pdfX,
            y: pdfY,
            width: pdfW,
            height: pdfH
        });
        const idx = annotations.signatures.length - 1;
        const wrap = document.createElement('div');
        wrap.className = 'annotation-signature';
        wrap.style.left = viewX + 'px';
        wrap.style.top = viewY + 'px';
        wrap.style.width = viewW + 'px';
        wrap.style.height = viewH + 'px';
        wrap.dataset.type = 'signature';
        wrap.dataset.pageIndex = String(pageIndex);
        wrap.dataset.annotationIndex = String(idx);
        const img = document.createElement('img');
        img.src = 'data:image/png;base64,' + imageBase64;
        img.draggable = false;
        img.style.pointerEvents = 'none';
        wrap.appendChild(img);
        p.wrapper.appendChild(wrap);
        makeAnnotationDraggable(wrap);
    }

    function showTextModal(pageIndex, viewX, viewY) {
        pendingTextPosition = { pageIndex, viewX, viewY };
        textInput.value = '';
        textModal.style.display = 'flex';
        textInput.focus();
    }

    function hideTextModal() {
        textModal.style.display = 'none';
        pendingTextPosition = null;
    }

    function startSignaturePad(pageIndex, viewX, viewY) {
        if (signaturePad) return;
        const w = 280;
        const h = 120;
        const wrap = document.createElement('div');
        wrap.className = 'signature-canvas-wrap';
        wrap.style.left = viewX + 'px';
        wrap.style.top = viewY + 'px';
        wrap.style.width = w + 'px';
        wrap.style.height = h + 'px';
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        wrap.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        let drawing = false;
        function getPos(e) {
            const r = canvas.getBoundingClientRect();
            const scaleX = canvas.width / r.width;
            const scaleY = canvas.height / r.height;
            return {
                x: (e.clientX - r.left) * scaleX,
                y: (e.clientY - r.top) * scaleY
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
        canvas.addEventListener('mouseup', function () { drawing = false; });
        canvas.addEventListener('mouseleave', function () { drawing = false; });

        const btnWrap = document.createElement('div');
        btnWrap.style.marginTop = '4px';
        btnWrap.style.textAlign = 'center';
        const btnOk = document.createElement('button');
        btnOk.className = 'btn primary';
        btnOk.textContent = 'Add Signature';
        btnOk.addEventListener('click', function () {
            const dataUrl = canvas.toDataURL('image/png');
            const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
            const p = pageData[pageIndex];
            const rect = wrap.getBoundingClientRect();
            const pageRect = p.wrapper.getBoundingClientRect();
            const viewX = rect.left - pageRect.left;
            const viewY = rect.top - pageRect.top;
            addSignatureAnnotation(pageIndex, base64, viewX, viewY, w, h);
            wrap.remove();
            signaturePad = null;
            signatureCanvas = null;
            setMode('view');
        });
        const btnCancel = document.createElement('button');
        btnCancel.className = 'btn';
        btnCancel.textContent = 'Cancel';
        btnCancel.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            signatureCanceledAt = Date.now();
            wrap.remove();
            signaturePad = null;
            signatureCanvas = null;
        });
        btnWrap.appendChild(btnOk);
        btnWrap.appendChild(btnCancel);
        wrap.appendChild(btnWrap);

        if (pageIndex >= 0 && pageIndex < pageData.length) {
            pageData[pageIndex].wrapper.appendChild(wrap);
            signaturePad = wrap;
            signatureCanvas = canvas;
        }
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

    function loadPdf() {
        const pdfjsLib = window['pdfjsLib'];
        if (!pdfjsLib) {
            errorEl.textContent = 'Failed to load PDF.js.';
            errorEl.style.display = 'block';
            loadingEl.style.display = 'none';
            return;
        }
        const bytes = base64ToUint8Array(pdfBase64);
        pdfjsLib.getDocument({ data: bytes }).promise.then(function (doc) {
            pdfDoc = doc;
            loadingEl.style.display = 'none';
            pdfBody.style.display = 'flex';
            zoomLevelEl.textContent = Math.round(scale * 100) + '%';
            renderPagesSync();
        }).catch(function (err) {
            loadingEl.textContent = '';
            loadingEl.style.display = 'none';
            errorEl.textContent = 'Failed to load PDF: ' + (err && err.message ? err.message : String(err));
            errorEl.style.display = 'block';
        });
    }

    const THUMB_SCALE = 0.2;

    function renderThumbnails() {
        if (!pdfDoc || !thumbnailList) return;
        thumbnailList.innerHTML = '';
        const numPages = pdfDoc.numPages;
        function addThumb(idx) {
            if (idx >= numPages) return;
            const i = idx + 1;
            pdfDoc.getPage(i).then(function (page) {
                const viewport = page.getViewport({ scale: THUMB_SCALE });
                const div = document.createElement('div');
                div.className = 'thumbnail-item';
                div.dataset.pageIndex = String(idx);
                const canvas = document.createElement('canvas');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                const ctx = canvas.getContext('2d');
                div.appendChild(canvas);
                const label = document.createElement('div');
                label.className = 'page-num';
                label.textContent = String(idx + 1);
                div.appendChild(label);
                thumbnailList.appendChild(div);
                div.addEventListener('click', function () {
                    if (pageData[idx] && pageData[idx].wrapper) {
                        pageData[idx].wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    thumbnailList.querySelectorAll('.thumbnail-item.active').forEach(function (el) { el.classList.remove('active'); });
                    div.classList.add('active');
                });
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
        if (!pdfDoc) return;
        pagesContainer.innerHTML = '';
        pageData = [];
        const numPages = pdfDoc.numPages;
        pageInfoEl.textContent = '1 / ' + numPages;

        function renderOne(idx) {
            if (idx >= numPages) {
                renderThumbnails();
                setMode(mode);
                return;
            }
            const i = idx + 1;
            pdfDoc.getPage(i).then(function (page) {
                const viewport = page.getViewport({ scale: scale });
                const wrapper = document.createElement('div');
                wrapper.className = 'page-wrapper';
                wrapper.dataset.pageIndex = String(idx);

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                canvas.style.width = viewport.width + 'px';
                canvas.style.height = viewport.height + 'px';
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
        if (annotations.texts.length === 0 && annotations.signatures.length === 0) {
            postMessage({ command: 'info', text: 'No text or signature added yet.' });
            return;
        }
        postMessage({
            type: 'savePdf',
            command: 'savePdf',
            data: {
                texts: annotations.texts,
                signatures: annotations.signatures
            }
        });
    }

    btnView.addEventListener('click', function () { setMode('view'); });
    btnText.addEventListener('click', function () { setMode('text'); });
    btnSignature.addEventListener('click', function () { setMode('signature'); });
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
            addTextAnnotation(pendingTextPosition.pageIndex, pendingTextPosition.viewX, pendingTextPosition.viewY, text, 12);
            setMode('view');
        }
        hideTextModal();
    });
    textCancel.addEventListener('click', hideTextModal);
    textInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') textConfirm.click();
        if (e.key === 'Escape') hideTextModal();
    });

    loadPdf();
})();
