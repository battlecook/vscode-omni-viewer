(function () {
    'use strict';

    const pdfDataEl = document.getElementById('pdf-data');
    const pdfData = JSON.parse(pdfDataEl.textContent);
    let currentPdfBase64 = pdfData.base64;
    let fileName = pdfData.fileName || 'document.pdf';
    const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;

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
    const btnSaveAs = document.getElementById('btnSaveAs');
    const textColorInput = document.getElementById('textColorInModal');
    const signatureColorInput = document.getElementById('signatureColorInModal');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');

    const textModal = document.getElementById('textModal');
    const textInput = document.getElementById('textInput');
    const textSizeInput = document.getElementById('textSizeInModal');
    const textConfirm = document.getElementById('textConfirm');
    const textCancel = document.getElementById('textCancel');
    const signatureModal = document.getElementById('signatureModal');
    const signatureCanvasWrap = document.getElementById('signatureCanvasWrap');
    const signatureConfirm = document.getElementById('signatureConfirm');
    const signatureCancelBtn = document.getElementById('signatureCancel');
    const passwordModal = document.getElementById('passwordModal');
    const passwordPromptLabel = document.getElementById('passwordPromptLabel');
    const passwordInput = document.getElementById('passwordInput');
    const passwordHint = document.getElementById('passwordHint');
    const passwordConfirm = document.getElementById('passwordConfirm');
    const passwordCancel = document.getElementById('passwordCancel');

    let pdfDocs = [];
    let sourcePdfBase64List = [];
    let pageEntries = []; // { sourceDocIndex, sourcePageIndex }
    let hasMergeInExtensionCache = false;

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
    let signaturePadCtx = null;
    let selectedAnnotation = null;
    let isDraggingAnnotation = false;
    let dragEndedAt = 0;
    let signatureCanceledAt = 0;
    let draggedThumbnailIndex = null;
    let passwordRequestState = null;

    async function getPdfJsLib() {
        const ready = window.__OMNI_PDFJS_READY__;
        if (!ready || typeof ready.then !== 'function') {
            throw new Error('PDF.js module loader was not initialized.');
        }

        const pdfjsLib = await ready;
        if (!pdfjsLib) {
            throw new Error('Failed to load PDF.js.');
        }
        return pdfjsLib;
    }

    function base64ToUint8Array(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function postMessage(msg) {
        if (vscode) vscode.postMessage(msg);
    }

    function getTextColor() {
        return (textColorInput && textColorInput.value) ? textColorInput.value : '#000000';
    }

    function getTextSize() {
        const raw = textSizeInput && textSizeInput.value ? Number(textSizeInput.value) : 12;
        if (!Number.isFinite(raw)) return 12;
        return Math.max(8, Math.min(96, raw));
    }

    function getSignatureColor() {
        return (signatureColorInput && signatureColorInput.value) ? signatureColorInput.value : '#000000';
    }

    function setMode(m) {
        mode = m;
        clearAnnotationSelection();
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

    function clearAnnotationSelection() {
        selectedAnnotation = null;
        document.querySelectorAll('.annotation-text.selected, .annotation-signature.selected').forEach(function (el) {
            el.classList.remove('selected');
        });
        document.querySelectorAll('.annotation-delete-btn').forEach(function (el) {
            el.remove();
        });
    }

    function removeAnnotation(type, index) {
        clearAnnotationSelection();
        if (type === 'text') {
            if (index < 0 || index >= annotations.texts.length) return;
            annotations.texts.splice(index, 1);
        } else if (type === 'signature') {
            if (index < 0 || index >= annotations.signatures.length) return;
            annotations.signatures.splice(index, 1);
        }
        renderPagesSync();
    }

    function selectAnnotation(el, type, annIndex) {
        clearAnnotationSelection();
        selectedAnnotation = { type: type, index: annIndex };
        el.classList.add('selected');

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'annotation-delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Delete annotation';
        deleteBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            removeAnnotation(type, annIndex);
        });
        el.appendChild(deleteBtn);
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
                if (!annotations.texts[annIndex]) return;
                annotations.texts[annIndex] = Object.assign({}, annotations.texts[annIndex], {
                    x: pdfPos.x,
                    y: pdfPos.y
                });
            } else if (type === 'signature') {
                if (!annotations.signatures[annIndex]) return;
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
            if (e.target && e.target.closest && e.target.closest('.annotation-delete-btn')) return;
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
        div.style.color = textAnn.color || '#000000';
        div.style.left = pos.x + 'px';
        div.style.top = pos.y + 'px';
        div.dataset.type = 'text';
        div.dataset.pageIndex = String(textAnn.pageIndex);
        div.dataset.annotationIndex = String(idx);
        div.addEventListener('click', function (e) {
            if (mode !== 'view') return;
            e.preventDefault();
            e.stopPropagation();
            selectAnnotation(div, 'text', idx);
        });
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
        wrap.addEventListener('click', function (e) {
            if (mode !== 'view') return;
            e.preventDefault();
            e.stopPropagation();
            selectAnnotation(wrap, 'signature', idx);
        });

        const img = document.createElement('img');
        img.src = 'data:image/png;base64,' + sigAnn.imageBase64;
        img.draggable = false;
        img.style.pointerEvents = 'none';
        wrap.appendChild(img);

        p.wrapper.appendChild(wrap);
        makeAnnotationDraggable(wrap);
    }

    function renderAnnotations() {
        clearAnnotationSelection();
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
            fontSize: fontSize || 12,
            color: getTextColor()
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
        if (textSizeInput) {
            textSizeInput.value = '12';
        }
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
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = getSignatureColor();
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        signaturePadCtx = ctx;

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

    function trimSignatureCanvas(canvas) {
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const alpha = pixels[(y * width + x) * 4 + 3];
                if (alpha === 0) continue;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }

        if (maxX < minX || maxY < minY) {
            return null;
        }

        const padding = 4;
        const cropX = Math.max(0, minX - padding);
        const cropY = Math.max(0, minY - padding);
        const cropWidth = Math.min(width - cropX, (maxX - minX + 1) + padding * 2);
        const cropHeight = Math.min(height - cropY, (maxY - minY + 1) + padding * 2);

        const trimmedCanvas = document.createElement('canvas');
        trimmedCanvas.width = cropWidth;
        trimmedCanvas.height = cropHeight;
        const trimmedCtx = trimmedCanvas.getContext('2d');
        trimmedCtx.drawImage(
            canvas,
            cropX,
            cropY,
            cropWidth,
            cropHeight,
            0,
            0,
            cropWidth,
            cropHeight
        );

        return {
            base64: trimmedCanvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
            width: cropWidth,
            height: cropHeight
        };
    }

    function hideSignatureModal() {
        if (signatureModal) signatureModal.style.display = 'none';
        if (signatureCanvasWrap) signatureCanvasWrap.innerHTML = '';
        signatureCanvas = null;
        signaturePadCtx = null;
        pendingSignaturePosition = null;
    }

    function showPasswordModal(reason, onSubmit, onCancel) {
        if (!passwordModal || !passwordInput || !passwordHint || !passwordPromptLabel) {
            throw new Error('Password UI is not available.');
        }

        passwordRequestState = {
            onSubmit: onSubmit,
            onCancel: onCancel
        };

        const incorrect = reason === 'incorrect';
        passwordPromptLabel.textContent = incorrect ? 'Incorrect password. Try again:' : 'Enter PDF password:';
        passwordHint.textContent = incorrect
            ? 'The password did not match this PDF.'
            : 'This PDF is password protected.';
        passwordHint.classList.toggle('error', incorrect);
        passwordHint.style.display = 'block';
        passwordInput.value = '';
        passwordModal.style.display = 'flex';
        setTimeout(function () {
            passwordInput.focus();
            passwordInput.select();
        }, 0);
    }

    function hidePasswordModal() {
        if (!passwordModal || !passwordInput || !passwordHint) return;
        passwordModal.style.display = 'none';
        passwordInput.value = '';
        passwordHint.style.display = 'none';
        passwordHint.classList.remove('error');
        passwordRequestState = null;
    }

    function submitPassword() {
        if (!passwordRequestState || !passwordInput) return;
        const password = passwordInput.value;
        if (!password) {
            passwordHint.textContent = 'Please enter a password.';
            passwordHint.classList.add('error');
            passwordHint.style.display = 'block';
            passwordInput.focus();
            return;
        }

        const submit = passwordRequestState.onSubmit;
        hidePasswordModal();
        submit(password);
    }

    function cancelPasswordPrompt() {
        if (!passwordRequestState) return;
        const cancel = passwordRequestState.onCancel;
        hidePasswordModal();
        if (typeof cancel === 'function') cancel();
    }

    function isAbortedPdfLoad(err) {
        if (!err) return false;
        const message = err && err.message ? String(err.message) : String(err);
        return message === 'Loading aborted' || message === 'Worker was destroyed';
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
        const pdfjsLib = await getPdfJsLib();
        const bytes = base64ToUint8Array(base64);
        const loadingTask = pdfjsLib.getDocument({ data: bytes, isEvalSupported: false });
        loadingTask.onPassword = function (updatePassword, reasonCode) {
            const responses = pdfjsLib.PasswordResponses || {};
            const isIncorrect = reasonCode === responses.INCORRECT_PASSWORD;
            showPasswordModal(
                isIncorrect ? 'incorrect' : 'required',
                function (password) {
                    updatePassword(password);
                },
                function () {
                    loadingTask.destroy();
                }
            );
        };
        return await loadingTask.promise;
    }

    function updatePageInfo() {
        pageInfoEl.textContent = '1 / ' + pageEntries.length;
    }

    function setupMainPdf(doc) {
        pdfDocs = [doc];
        sourcePdfBase64List = [currentPdfBase64];
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

    function deletePageAtIndex(index) {
        if (index < 0 || index >= pageEntries.length) return;
        if (pageEntries.length <= 1) {
            postMessage({ command: 'warning', text: 'At least one page must remain.' });
            return;
        }

        const oldEntries = pageEntries.slice();
        const removedEntry = oldEntries[index];
        const removedKey = entryKey(removedEntry);

        pageEntries.splice(index, 1);

        const newIndexByKey = new Map();
        pageEntries.forEach(function (entry, newIndex) {
            newIndexByKey.set(entryKey(entry), newIndex);
        });

        annotations.texts = annotations.texts
            .map(function (ann) {
                const oldEntry = oldEntries[ann.pageIndex];
                if (!oldEntry) return null;
                const key = entryKey(oldEntry);
                if (key === removedKey) return null;
                const newPageIndex = newIndexByKey.get(key);
                if (typeof newPageIndex !== 'number') return null;
                return Object.assign({}, ann, { pageIndex: newPageIndex });
            })
            .filter(function (ann) { return !!ann; });

        annotations.signatures = annotations.signatures
            .map(function (ann) {
                const oldEntry = oldEntries[ann.pageIndex];
                if (!oldEntry) return null;
                const key = entryKey(oldEntry);
                if (key === removedKey) return null;
                const newPageIndex = newIndexByKey.get(key);
                if (typeof newPageIndex !== 'number') return null;
                return Object.assign({}, ann, { pageIndex: newPageIndex });
            })
            .filter(function (ann) { return !!ann; });

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

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'thumbnail-delete-btn';
                deleteBtn.title = 'Delete this page';
                deleteBtn.textContent = '×';
                deleteBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    deletePageAtIndex(idx);
                });
                div.appendChild(deleteBtn);

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
                    pdfWidth: page.view[2],
                    pdfHeight: page.view[3],
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

    function doSave(saveAs) {
        function buildTextStamps() {
            return annotations.texts.map(function (t) {
                const fontSize = t.fontSize || 12;
                const color = t.color || '#000000';
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                ctx.font = fontSize + 'px sans-serif';
                const padding = 3;
                const measuredWidth = Math.ceil(ctx.measureText(t.text || '').width);
                const canvasWidth = Math.max(1, measuredWidth + padding * 2);
                const canvasHeight = Math.max(1, Math.ceil(fontSize * 1.6) + padding * 2);
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;

                const drawCtx = canvas.getContext('2d');
                drawCtx.clearRect(0, 0, canvasWidth, canvasHeight);
                drawCtx.font = fontSize + 'px sans-serif';
                drawCtx.fillStyle = color;
                drawCtx.textBaseline = 'top';
                drawCtx.fillText(t.text || '', padding, padding);

                const pngBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
                const pdfWidth = canvasWidth * 0.75;
                const pdfHeight = canvasHeight * 0.75;
                return {
                    pageIndex: t.pageIndex,
                    x: t.x,
                    y: t.y - pdfHeight,
                    width: pdfWidth,
                    height: pdfHeight,
                    imageBase64: pngBase64
                };
            });
        }

        const hasMergePreview = sourcePdfBase64List.length > 1;
        const hasMerge = hasMergePreview || hasMergeInExtensionCache;
        const totalSourcePages = pdfDocs.reduce(function (sum, doc) { return sum + doc.numPages; }, 0);
        const hasPageDeletion = pageEntries.length !== totalSourcePages;
        const hasPageOrderChange = pageEntries.some(function (entry, idx) {
            return entry.sourceDocIndex !== 0 || entry.sourcePageIndex !== idx;
        });
        const hasAnnotations = annotations.texts.length > 0 || annotations.signatures.length > 0;

        if (!saveAs && !hasAnnotations && !hasMerge && !hasPageOrderChange && !hasPageDeletion) {
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
        const textStamps = buildTextStamps();

        const saveCommand = saveAs ? 'savePdfAs' : 'savePdf';
        postMessage({
            type: saveCommand,
            command: saveCommand,
            data: {
                texts: annotations.texts,
                textStamps: textStamps,
                signatures: annotations.signatures,
                pageOrder: pageOrder,
                hasMerge: hasMerge,
                previewIncludesMergedPages: hasMergePreview,
                saveAs: saveAs,
                sourceFileName: fileName
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
        postMessage({ command: 'selectMergePdf' });
    });

    btnSave.addEventListener('click', function () { doSave(false); });
    btnSaveAs.addEventListener('click', function () { doSave(true); });
    document.addEventListener('keydown', function (e) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotation && mode === 'view') {
            e.preventDefault();
            removeAnnotation(selectedAnnotation.type, selectedAnnotation.index);
        }
    });

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
                getTextSize()
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
        const trimmed = trimSignatureCanvas(signatureCanvas);
        if (!trimmed) {
            postMessage({ command: 'warning', text: 'Please draw a signature first.' });
            return;
        }

        addSignatureAnnotation(
            pendingSignaturePosition.pageIndex,
            trimmed.base64,
            pendingSignaturePosition.viewX,
            pendingSignaturePosition.viewY,
            trimmed.width,
            trimmed.height
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

    if (signatureColorInput) {
        signatureColorInput.addEventListener('input', function () {
            if (signaturePadCtx) {
                signaturePadCtx.strokeStyle = getSignatureColor();
            }
        });
    }

    if (passwordConfirm) {
        passwordConfirm.addEventListener('click', submitPassword);
    }

    if (passwordCancel) {
        passwordCancel.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            cancelPasswordPrompt();
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') submitPassword();
            if (e.key === 'Escape') cancelPasswordPrompt();
        });
    }

    async function initialize() {
        try {
            postMessage({ command: 'resetMergePdfCache' });
            hasMergeInExtensionCache = false;
            const mainDoc = await loadPdfDocumentFromBase64(currentPdfBase64);
            setupMainPdf(mainDoc);
            loadingEl.style.display = 'none';
            pdfBody.style.display = 'flex';
            zoomLevelEl.textContent = Math.round(scale * 100) + '%';
            renderPagesSync();
        } catch (err) {
            loadingEl.style.display = 'none';
            if (isAbortedPdfLoad(err)) {
                errorEl.textContent = 'PDF opening was cancelled.';
            } else {
                errorEl.textContent = 'Failed to load PDF: ' + (err && err.message ? err.message : String(err));
            }
            errorEl.style.display = 'block';
        }
    }

    window.addEventListener('message', async function (event) {
        const message = event.data || {};
        if (message.type === 'pdfSaved') {
            if (!message.data || !message.data.base64) return;
            try {
                currentPdfBase64 = String(message.data.base64);
                if (message.data.fileName) {
                    fileName = String(message.data.fileName);
                    const titleEl = document.querySelector('.title');
                    if (titleEl) {
                        titleEl.textContent = '📄 ' + fileName;
                    }
                }
                annotations.texts = [];
                annotations.signatures = [];
                hasMergeInExtensionCache = false;
                const mainDoc = await loadPdfDocumentFromBase64(currentPdfBase64);
                setupMainPdf(mainDoc);
                renderPagesSync();
            } catch (err) {
                postMessage({
                    command: 'error',
                    text: 'Saved PDF reload failed: ' + (err && err.message ? err.message : String(err))
                });
            }
            return;
        }

        if (message.type === 'selectedMergePdf') {
            if (!message.data || !message.data.base64) return;

            try {
                await appendSecondPdf(message.data.base64);
                hasMergeInExtensionCache = false;
                const mergedName = message.data.fileName ? String(message.data.fileName) : 'selected file';
                postMessage({ command: 'info', text: mergedName + ' merged into preview. Click Save/Save As to apply.' });
            } catch (err) {
                if (isAbortedPdfLoad(err)) return;
                postMessage({
                    command: 'error',
                    text: 'Failed to merge selected PDF: ' + (err && err.message ? err.message : String(err))
                });
            }
            return;
        }

        if (message.type === 'selectedMergePdfMeta') {
            hasMergeInExtensionCache = true;
            const mergedName = message.data && message.data.fileName ? String(message.data.fileName) : 'selected file';
            postMessage({
                command: 'info',
                text: mergedName + ' selected for merge. It will be applied on Save/Save As.'
            });
        }
    });

    initialize();
})();
