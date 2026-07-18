const vscode = acquireVsCodeApi();

class ShpViewer {
    constructor() {
        this.data = this.readInitialData();
        this.features = [...(this.data.features || [])];
        this.layerByIndex = new Map();
        this.selectedLayer = null;
        this.isLoadingMore = false;
        this.map = null;
        this.geoJsonLayer = null;
        this.propertyColumns = [];

        this.init();
    }

    readInitialData() {
        const script = document.getElementById('shp-data');
        if (!script) {
            return { features: [], metadata: { warnings: [], projection: {} }, files: [] };
        }
        return JSON.parse(script.textContent || '{}');
    }

    init() {
        this.initMap();
        this.renderAll();
        this.bindEvents();
        window.addEventListener('message', (event) => this.handleMessage(event.data));
    }

    initMap() {
        const useLocalCrs = this.shouldUseLocalCrs();
        this.map = L.map('map', {
            crs: useLocalCrs ? L.CRS.Simple : L.CRS.EPSG3857,
            zoomControl: true,
            attributionControl: false
        });
        this.geoJsonLayer = L.geoJSON(null, {
            coordsToLatLng: useLocalCrs
                ? (coords) => L.latLng(coords[1], coords[0], coords[2])
                : undefined,
            style: () => ({
                color: '#3a8dde',
                weight: 2,
                fillColor: '#67b7dc',
                fillOpacity: 0.22
            }),
            pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
                radius: 5,
                color: '#3a8dde',
                weight: 2,
                fillColor: '#67b7dc',
                fillOpacity: 0.65
            }),
            onEachFeature: (feature, layer) => this.bindFeature(feature, layer)
        }).addTo(this.map);
    }

    shouldUseLocalCrs() {
        const status = this.data.metadata?.projection?.status;
        if (status === 'projected' || status === 'assumed-wgs84') {
            return false;
        }
        return !this.bboxLooksLonLat(this.data.bbox || this.data.sourceBBox);
    }

    bboxLooksLonLat(bbox) {
        return Array.isArray(bbox)
            && bbox.length === 4
            && bbox[0] >= -180
            && bbox[2] <= 180
            && bbox[1] >= -90
            && bbox[3] <= 90;
    }

    bindFeature(feature, layer) {
        const index = Number(feature.__omniIndex);
        if (Number.isFinite(index)) {
            this.layerByIndex.set(index, layer);
        }
        layer.on('click', () => {
            this.selectFeature(feature, layer);
        });
    }

    renderAll() {
        this.renderHeader();
        this.renderStatus();
        this.renderFiles();
        this.renderMap();
        this.renderFeatureTable();
        this.renderLoadMore();
    }

    renderHeader() {
        const info = document.getElementById('fileInfo');
        if (!info) return;
        const loaded = this.features.length.toLocaleString();
        const next = this.data.metadata?.nextFeatureStart?.toLocaleString?.() || loaded;
        info.textContent = `${loaded} loaded • ${next} scanned • ${this.data.fileSize || ''}`;
    }

    renderStatus() {
        const strip = document.getElementById('statusStrip');
        const summary = document.getElementById('datasetSummary');
        if (!strip || !summary) return;

        const metadata = this.data.metadata || {};
        const projection = metadata.projection || {};
        const geometrySummary = Object.entries(metadata.geometryTypes || {})
            .map(([type, count]) => `${type} ${Number(count).toLocaleString()}`)
            .join(', ') || 'No geometry';

        strip.innerHTML = '';
        strip.appendChild(this.createPill(projection.message || 'Projection not available', projection.status === 'projected' ? 'ok' : 'warning'));
        for (const warning of metadata.warnings || []) {
            strip.appendChild(this.createPill(warning, 'warning'));
        }

        summary.innerHTML = '';
        this.addSummaryRow(summary, 'Features', `${this.features.length.toLocaleString()} loaded`);
        this.addSummaryRow(summary, 'Geometry', geometrySummary);
        this.addSummaryRow(summary, 'BBox', this.formatBBox(this.data.bbox || this.data.sourceBBox));
        this.addSummaryRow(summary, 'Projection', projection.status || 'unknown');
    }

    createPill(text, kind) {
        const pill = document.createElement('div');
        pill.className = `status-pill ${kind || ''}`.trim();
        pill.textContent = text;
        return pill;
    }

    addSummaryRow(parent, label, value) {
        const row = document.createElement('div');
        row.className = 'summary-row';
        row.innerHTML = `<div class="summary-label"></div><div class="summary-value"></div>`;
        row.children[0].textContent = label;
        row.children[1].textContent = value || '-';
        parent.appendChild(row);
    }

    formatBBox(bbox) {
        if (!Array.isArray(bbox)) {
            return '-';
        }
        return bbox.map((value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })).join(', ');
    }

    renderFiles() {
        const list = document.getElementById('fileList');
        if (!list) return;
        list.innerHTML = '';
        for (const file of this.data.files || []) {
            const row = document.createElement('div');
            row.className = `file-row ${file.exists ? '' : 'missing'}`.trim();
            const state = file.exists ? (file.size || 'present') : 'missing';
            row.innerHTML = `<div></div><div></div>`;
            row.children[0].textContent = file.name;
            row.children[1].textContent = state;
            list.appendChild(row);
        }
    }

    renderMap() {
        this.layerByIndex.clear();
        this.geoJsonLayer.clearLayers();
        const empty = document.getElementById('emptyMap');

        const indexedFeatures = this.features.map((feature, index) => ({
            ...feature,
            __omniIndex: index
        }));

        if (indexedFeatures.length === 0) {
            if (empty) empty.hidden = false;
            this.map.setView([0, 0], 1);
            return;
        }

        if (empty) empty.hidden = true;
        this.geoJsonLayer.addData(indexedFeatures);

        const bounds = this.geoJsonLayer.getBounds();
        if (bounds.isValid()) {
            this.map.fitBounds(bounds.pad(0.08));
        } else {
            this.map.setView([0, 0], 1);
        }
        setTimeout(() => this.map.invalidateSize(), 0);
    }

    renderFeatureTable() {
        const head = document.getElementById('featureTableHead');
        const body = document.getElementById('featureTableBody');
        if (!head || !body) return;

        this.propertyColumns = (this.data.metadata?.propertyNames || []).slice(0, 5);
        const headers = ['#', 'Geometry', ...this.propertyColumns];
        head.innerHTML = `<tr>${headers.map((header) => `<th>${this.escapeHtml(header)}</th>`).join('')}</tr>`;
        body.innerHTML = '';

        this.features.slice(0, 500).forEach((feature, index) => {
            const row = document.createElement('tr');
            const values = [
                String(index + 1),
                feature.geometry?.type || '-',
                ...this.propertyColumns.map((column) => this.formatValue(feature.properties?.[column]))
            ];
            row.innerHTML = values.map((value) => `<td title="${this.escapeAttribute(value)}">${this.escapeHtml(value)}</td>`).join('');
            row.addEventListener('click', () => {
                const layer = this.layerByIndex.get(index);
                if (layer) {
                    this.selectFeature(feature, layer);
                    this.map.fitBounds(layer.getBounds ? layer.getBounds().pad(0.2) : L.latLngBounds([layer.getLatLng()]));
                }
            });
            body.appendChild(row);
        });
    }

    renderLoadMore() {
        const button = document.getElementById('loadMoreButton');
        if (!button) return;
        const hasMore = Boolean(this.data.metadata?.hasMoreFeatures);
        button.style.display = hasMore ? 'block' : 'none';
        button.disabled = this.isLoadingMore;
        button.textContent = this.isLoadingMore ? 'Loading...' : 'Load Next 10,000 Features';
    }

    bindEvents() {
        const button = document.getElementById('loadMoreButton');
        if (button) {
            button.addEventListener('click', () => this.loadMore());
        }
    }

    loadMore() {
        if (this.isLoadingMore || !this.data.metadata?.hasMoreFeatures) {
            return;
        }
        this.isLoadingMore = true;
        this.renderLoadMore();
        vscode.postMessage({ command: 'loadMoreShapefile' });
    }

    handleMessage(message) {
        if (!message || message.type !== 'appendShapefileData') {
            return;
        }

        const next = message.data;
        this.features.push(...(next.features || []));
        this.data.features = this.features;
        this.data.bbox = this.mergeBBox(this.data.bbox, next.bbox);
        this.data.metadata = {
            ...this.data.metadata,
            loadedFeatures: this.features.length,
            nextFeatureStart: next.metadata?.nextFeatureStart ?? this.data.metadata?.nextFeatureStart,
            hasMoreFeatures: Boolean(next.metadata?.hasMoreFeatures),
            propertyNames: Array.from(new Set([
                ...(this.data.metadata?.propertyNames || []),
                ...(next.metadata?.propertyNames || [])
            ])).sort(),
            geometryTypes: this.mergeCounts(this.data.metadata?.geometryTypes, next.metadata?.geometryTypes),
            warnings: Array.from(new Set([
                ...(this.data.metadata?.warnings || []),
                ...(next.metadata?.warnings || [])
            ]))
        };
        this.isLoadingMore = false;
        this.renderAll();
    }

    mergeCounts(first = {}, second = {}) {
        const result = { ...first };
        for (const [key, value] of Object.entries(second)) {
            result[key] = (result[key] || 0) + Number(value || 0);
        }
        return result;
    }

    mergeBBox(first, second) {
        if (!Array.isArray(first)) return second || first;
        if (!Array.isArray(second)) return first;
        return [
            Math.min(first[0], second[0]),
            Math.min(first[1], second[1]),
            Math.max(first[2], second[2]),
            Math.max(first[3], second[3])
        ];
    }

    selectFeature(feature, layer) {
        if (this.selectedLayer?.setStyle) {
            this.selectedLayer.setStyle({ color: '#3a8dde', weight: 2, fillOpacity: 0.22 });
        }
        this.selectedLayer = layer;
        if (layer.setStyle) {
            layer.setStyle({ color: '#f48771', weight: 3, fillOpacity: 0.35 });
        }
        this.renderProperties(feature);
    }

    renderProperties(feature) {
        const panel = document.getElementById('propertiesPanel');
        if (!panel) return;
        const properties = feature.properties || {};
        const entries = Object.entries(properties);
        if (entries.length === 0) {
            panel.textContent = 'No properties.';
            return;
        }
        panel.innerHTML = '';
        for (const [key, value] of entries) {
            const row = document.createElement('div');
            row.className = 'property-row';
            row.innerHTML = `<div class="property-key"></div><div class="property-value"></div>`;
            row.children[0].textContent = key;
            row.children[1].textContent = this.formatValue(value);
            panel.appendChild(row);
        }
    }

    formatValue(value) {
        if (value === null || value === undefined) return '';
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttribute(value) {
        return this.escapeHtml(value).replace(/`/g, '&#96;');
    }
}

new ShpViewer();
