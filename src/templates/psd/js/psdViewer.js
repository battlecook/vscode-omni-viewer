(function () {
    'use strict';

    if (typeof agPsd === 'undefined') {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').textContent = 'Failed to load ag-psd. Please reload the extension.';
        document.getElementById('error').style.display = 'block';
        return;
    }

    var readPsd = agPsd.readPsd;

    function base64ToUint8Array(base64) {
        var binary = atob(base64);
        var len = binary.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    /** Flatten layer/group tree into draw order (bottom to top) */
    function flattenLayers(nodes, out, depth) {
        depth = depth || 0;
        if (!nodes || !nodes.length) return;
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            out.push({ layer: node, depth: depth, index: out.length });
            if (node.children && node.children.length) {
                flattenLayers(node.children, out, depth + 1);
            }
        }
    }

    var state = {
        psd: null,
        flatLayers: [],
        visibility: [],
        docWidth: 0,
        docHeight: 0
    };

    function allLayersVisible() {
        for (var i = 0; i < state.visibility.length; i++) {
            if (!state.visibility[i]) return false;
        }
        return true;
    }

    function renderMainCanvas() {
        var mainCanvas = document.getElementById('mainCanvas');
        var ctx = mainCanvas.getContext('2d');
        var w = state.docWidth;
        var h = state.docHeight;

        mainCanvas.width = w;
        mainCanvas.height = h;
        ctx.clearRect(0, 0, w, h);

        // Default: show composite image. When eye toggles hide a layer, redraw from layers.
        if (state.psd.canvas && allLayersVisible()) {
            ctx.drawImage(state.psd.canvas, 0, 0);
        } else {
            // Draw only leaf layers (skip groups/folders). Group canvases are merged
            // images of their children; drawing them would show hidden children or
            // make the whole folder disappear when toggling one child.
            for (var i = state.flatLayers.length - 1; i >= 0; i--) {
                if (!state.visibility[i]) continue;
                var item = state.flatLayers[i];
                var layer = item.layer;
                if (!layer.canvas) continue;
                if (layer.children && layer.children.length > 0) continue; /* skip group */
                ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
            }
        }
    }

    function buildLayerList() {
        var listEl = document.getElementById('layerList');
        listEl.innerHTML = '';

        for (var i = 0; i < state.flatLayers.length; i++) {
            var item = state.flatLayers[i];
            var layer = item.layer;
            var depth = item.depth;
            var idx = i;
            var isGroup = layer.children && layer.children.length > 0;
            var hasCanvas = !!layer.canvas;
            var name = layer.name || ('Layer ' + (i + 1));

            var row = document.createElement('div');
            row.className = 'layer-item' + (isGroup ? ' group' : '');
            row.style.paddingLeft = (12 + depth * 16) + 'px';

            var eyeBtn = document.createElement('button');
            eyeBtn.className = 'layer-eye' + (state.visibility[idx] ? '' : ' hidden');
            eyeBtn.setAttribute('aria-label', state.visibility[idx] ? 'Hide' : 'Show');
            eyeBtn.textContent = state.visibility[idx] ? '👁' : '👁‍🗨';
            eyeBtn.setAttribute('data-idx', String(idx));
            (function (layerIndex) {
                eyeBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    state.visibility[layerIndex] = !state.visibility[layerIndex];
                    this.textContent = state.visibility[layerIndex] ? '👁' : '👁‍🗨';
                    this.classList.toggle('hidden', !state.visibility[layerIndex]);
                    renderMainCanvas();
                });
            })(idx);

            var spacer = document.createElement('span');
            spacer.className = 'layer-spacer';
            if (!hasCanvas) {
                spacer.style.visibility = 'hidden';
            }

            var nameSpan = document.createElement('span');
            nameSpan.className = 'layer-name';
            nameSpan.title = name;
            nameSpan.textContent = name;

            var viewBtn = document.createElement('button');
            viewBtn.className = 'layer-view-btn';
            viewBtn.textContent = 'View';
            viewBtn.style.display = hasCanvas ? '' : 'none';
            viewBtn.setAttribute('data-idx', String(idx));
            (function (layerIndex) {
                viewBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openLayerModal(layerIndex);
                });
            })(idx);

            if (hasCanvas) {
                row.appendChild(eyeBtn);
            } else {
                row.appendChild(spacer);
            }
            row.appendChild(nameSpan);
            row.appendChild(viewBtn);
            listEl.appendChild(row);
        }
    }

    function openLayerModal(layerIndex) {
        var item = state.flatLayers[layerIndex];
        if (!item || !item.layer.canvas) return;

        var layer = item.layer;
        var c = layer.canvas;
        var modal = document.getElementById('layerModal');
        var modalCanvas = document.getElementById('layerModalCanvas');
        var modalTitle = document.getElementById('layerModalTitle');

        modalTitle.textContent = layer.name || 'Layer ' + (layerIndex + 1);
        modalCanvas.width = c.width;
        modalCanvas.height = c.height;
        modalCanvas.getContext('2d').drawImage(c, 0, 0);
        modal.style.display = 'flex';
    }

    function closeLayerModal() {
        document.getElementById('layerModal').style.display = 'none';
    }

    function init() {
        var loading = document.getElementById('loading');
        var error = document.getElementById('error');
        var wrapper = document.getElementById('canvasWrapper');

        try {
            var base64 = window.PSD_BASE64;
            if (!base64) {
                throw new Error('No PSD data.');
            }
            var bytes = base64ToUint8Array(base64);
            var psd = readPsd(bytes.buffer);
            state.psd = psd;

            state.docWidth = psd.width || 1;
            state.docHeight = psd.height || 1;

            state.flatLayers = [];
            flattenLayers(psd.children || [], state.flatLayers);

            state.visibility = state.flatLayers.map(function (item) {
                return item.layer.hidden !== true;
            });

            renderMainCanvas();
            buildLayerList();

            document.getElementById('dimensions').textContent = state.docWidth + ' × ' + state.docHeight + ' px';
            wrapper.classList.add('checker');
            wrapper.style.display = 'block';
            loading.style.display = 'none';
        } catch (e) {
            loading.style.display = 'none';
            error.textContent = e && e.message ? e.message : String(e);
            error.style.display = 'block';
        }

        document.getElementById('layerModalClose').addEventListener('click', closeLayerModal);
        document.getElementById('layerModal').addEventListener('click', function (e) {
            if (e.target === this) closeLayerModal();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
