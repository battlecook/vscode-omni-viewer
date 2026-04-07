// Excel Viewer JavaScript
const vscode = acquireVsCodeApi();

class ExcelViewer {
    constructor() {
        this.excelData = null;
        this.currentSheetIndex = 0;
        this.filteredData = [];
        this.currentPage = 1;
        this.rowsPerPage = 100;
        this.searchTerm = '';
        this.isTableView = true;
        this.sheetColumnWidths = {};
        this.resizeState = null;

        this.init();
    }

    get currentSheet() {
        if (!this.excelData || !this.excelData.sheets || !this.excelData.sheets.length) return null;
        return this.excelData.sheets[this.currentSheetIndex] || this.excelData.sheets[0];
    }

    init() {
        this.loadExcelData();
        this.setupEventListeners();
    }

    loadExcelData() {
        try {
            const dataScript = document.getElementById('excel-data');
            if (dataScript) {
                this.excelData = JSON.parse(dataScript.textContent);
                this.restoreViewState();
                if (!this.excelData.sheets || this.excelData.sheets.length === 0) {
                    this.showError('No sheets found in Excel file');
                    this.hideLoading();
                    return;
                }
                this.populateSheetSelect();
                this.currentSheetIndex = 0;
                const sheet = this.currentSheet;
                this.filteredData = sheet ? [...sheet.rows] : [];
                this.currentPage = 1;
                this.searchTerm = '';
                this.updateFileInfo();
                this.renderTable();
                this.hideLoading();
            } else {
                this.showError('Excel data not found');
            }
        } catch (error) {
            console.error('Error loading Excel data:', error);
            this.showError('Failed to load Excel data: ' + error.message);
        }
    }

    populateSheetSelect() {
        const select = document.getElementById('sheetSelect');
        if (!select || !this.excelData.sheetNames) return;
        select.innerHTML = '';
        this.excelData.sheetNames.forEach((name, index) => {
            const opt = document.createElement('option');
            opt.value = index;
            opt.textContent = name;
            select.appendChild(opt);
        });
        select.addEventListener('change', (e) => {
            this.switchSheet(parseInt(e.target.value, 10));
        });
    }

    switchSheet(index) {
        if (index < 0 || index >= (this.excelData.sheets || []).length) return;
        this.currentSheetIndex = index;
        const sheet = this.currentSheet;
        this.filteredData = sheet ? [...sheet.rows] : [];
        this.currentPage = 1;
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        this.searchTerm = '';
        this.updateFileInfo();
        this.renderTable();
        if (this.isTableView) {
            this.renderDataRows();
        } else {
            this.renderRawData();
        }
        const select = document.getElementById('sheetSelect');
        if (select) select.value = String(index);
    }

    updateFileInfo() {
        const sheetInfo = document.getElementById('sheetInfo');
        const rowCountEl = document.getElementById('rowCount');
        const columnCountEl = document.getElementById('columnCount');
        const fileSizeEl = document.getElementById('fileSize');
        const sheet = this.currentSheet;
        if (sheetInfo && sheet) sheetInfo.textContent = sheet.name;
        if (rowCountEl) rowCountEl.textContent = sheet ? `${sheet.totalRows.toLocaleString()} rows` : '0 rows';
        if (columnCountEl) columnCountEl.textContent = sheet ? `${sheet.totalColumns} columns` : '0 columns';
        if (fileSizeEl && this.excelData) fileSizeEl.textContent = this.excelData.fileSize || '';
    }

    renderTable() {
        const headerEl = document.getElementById('tableHeader');
        const bodyEl = document.getElementById('tableBody');
        const tableWrapper = document.getElementById('tableWrapper');
        const tableEl = document.getElementById('excelTable');
        const sheet = this.currentSheet;
        if (!headerEl || !bodyEl || !tableWrapper || !tableEl) return;
        if (!sheet) return;

        this.syncCurrentSheetColumnWidths();
        this.renderColumnGroup(tableEl);
        headerEl.innerHTML = '';
        const headerRow = document.createElement('tr');
        (sheet.headers || []).forEach((header, index) => {
            const th = document.createElement('th');
            th.textContent = header || '';
            th.title = header || '';
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'column-resize-handle';
            resizeHandle.setAttribute('data-col', index);
            resizeHandle.title = 'Drag to resize column';
            resizeHandle.addEventListener('mousedown', (event) => {
                this.startColumnResize(event, index, th);
            });
            th.appendChild(resizeHandle);
            headerRow.appendChild(th);
        });
        headerEl.appendChild(headerRow);

        this.renderDataRows();
        this.initializeColumnWidthsFromRenderedTable();
        this.updateView();
    }

    renderDataRows() {
        const bodyEl = document.getElementById('tableBody');
        if (!bodyEl) return;

        bodyEl.innerHTML = '';
        const startIndex = (this.currentPage - 1) * this.rowsPerPage;
        const endIndex = startIndex + this.rowsPerPage;
        const pageData = this.filteredData.slice(startIndex, endIndex);

        pageData.forEach((row) => {
            const tr = document.createElement('tr');
            (row || []).forEach((cell) => {
                const td = document.createElement('td');
                if (cell === null || cell === undefined) {
                    td.textContent = '';
                } else if (typeof cell === 'object') {
                    td.textContent = JSON.stringify(cell);
                } else {
                    td.textContent = String(cell);
                }
                td.title = td.textContent;
                tr.appendChild(td);
            });
            if (this.searchTerm && this.rowMatchesSearch(row)) {
                tr.classList.add('highlight');
            }
            bodyEl.appendChild(tr);
        });

        this.updatePagination();
    }

    searchTable(term) {
        this.searchTerm = term.toLowerCase();
        this.currentPage = 1;
        const sheet = this.currentSheet;
        if (!sheet) return;
        if (!term) {
            this.filteredData = [...sheet.rows];
        } else {
            this.filteredData = sheet.rows.filter((row) => this.rowMatchesSearch(row));
        }
        if (this.isTableView) {
            this.renderDataRows();
        } else {
            this.renderRawData();
        }
    }

    rowMatchesSearch(row) {
        return (row || []).some((cell) => {
            const cellStr = cell === null || cell === undefined ? '' : typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
            return cellStr.toLowerCase().includes(this.searchTerm);
        });
    }

    updatePagination() {
        const paginationEl = document.getElementById('pagination');
        const pageInfoEl = document.getElementById('pageInfo');
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        if (!paginationEl || !pageInfoEl || !prevBtn || !nextBtn) return;

        const totalPages = Math.ceil(this.filteredData.length / this.rowsPerPage);
        if (totalPages <= 1) {
            paginationEl.style.display = 'none';
            return;
        }
        paginationEl.style.display = 'flex';
        pageInfoEl.textContent = `Page ${this.currentPage} of ${totalPages}`;
        prevBtn.disabled = this.currentPage <= 1;
        nextBtn.disabled = this.currentPage >= totalPages;
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.filteredData.length / this.rowsPerPage);
        if (page >= 1 && page <= totalPages) {
            this.currentPage = page;
            this.renderDataRows();
        }
    }

    copyToClipboard() {
        const sheet = this.currentSheet;
        if (!sheet) return;
        const headers = (sheet.headers || []).join('\t');
        const rows = this.filteredData.map((row) =>
            (row || []).map((cell) => {
                if (cell === null || cell === undefined) return '';
                if (typeof cell === 'object') return JSON.stringify(cell);
                return String(cell);
            }).join('\t')
        ).join('\n');
        const clipboardContent = `${headers}\n${rows}`;
        navigator.clipboard.writeText(clipboardContent).then(() => {
            this.showNotification('Data copied to clipboard!', 'success');
        }).catch((err) => {
            console.error('Failed to copy to clipboard:', err);
            this.showNotification('Failed to copy to clipboard', 'error');
        });
    }

    exportToJson() {
        const sheet = this.currentSheet;
        if (!sheet) return;
        const exportData = {
            sheetName: sheet.name,
            headers: sheet.headers,
            rows: this.filteredData,
            metadata: {
                totalRows: sheet.totalRows,
                filteredRows: this.filteredData.length,
                columns: sheet.totalColumns,
                fileSize: this.excelData.fileSize,
                searchActive: this.searchTerm !== '',
                exportDate: new Date().toISOString()
            }
        };
        const jsonString = JSON.stringify(exportData, null, 2);
        const dataSize = new Blob([jsonString]).size;
        const maxSize = 1024 * 1024;
        if (dataSize > maxSize) {
            this.showNotification(`JSON data is too large (${(dataSize / 1024 / 1024).toFixed(2)}MB). Cannot copy to clipboard.`, 'error');
            return;
        }
        navigator.clipboard.writeText(jsonString).then(() => {
            this.showNotification(`JSON data copied to clipboard! (${(dataSize / 1024).toFixed(1)}KB)`, 'success');
        }).catch((err) => {
            console.error('Failed to copy JSON to clipboard:', err);
            this.showNotification('Failed to copy to clipboard.', 'error');
        });
    }

    toggleView() {
        this.isTableView = !this.isTableView;
        this.updateView();
    }

    updateView() {
        const tableWrapper = document.getElementById('tableWrapper');
        const rawDataWrapper = document.getElementById('rawDataWrapper');
        const toggleBtn = document.getElementById('toggleView');
        const pagination = document.getElementById('pagination');
        const searchContainer = document.getElementById('searchContainer');
        if (this.isTableView) {
            if (tableWrapper) tableWrapper.style.display = 'block';
            if (rawDataWrapper) rawDataWrapper.style.display = 'none';
            if (toggleBtn) toggleBtn.textContent = '📄 Raw View';
            if (pagination) pagination.style.display = 'flex';
            if (searchContainer) searchContainer.style.display = 'flex';
            this.renderDataRows();
        } else {
            if (tableWrapper) tableWrapper.style.display = 'none';
            if (rawDataWrapper) rawDataWrapper.style.display = 'block';
            if (toggleBtn) toggleBtn.textContent = '📊 Table View';
            if (pagination) pagination.style.display = 'none';
            if (searchContainer) searchContainer.style.display = 'none';
            this.renderRawData();
        }
    }

    renderRawData() {
        const rawDataEl = document.getElementById('rawData');
        const sheet = this.currentSheet;
        if (!rawDataEl || !sheet) return;
        const rawData = {
            sheetName: sheet.name,
            headers: sheet.headers,
            rows: this.filteredData,
            metadata: {
                totalRows: sheet.totalRows,
                filteredRows: this.filteredData.length,
                columns: sheet.totalColumns,
                fileSize: this.excelData.fileSize
            }
        };
        rawDataEl.textContent = JSON.stringify(rawData, null, 2);
    }

    restoreViewState() {
        const viewState = vscode.getState();
        if (viewState?.sheetColumnWidths && typeof viewState.sheetColumnWidths === 'object') {
            this.sheetColumnWidths = { ...viewState.sheetColumnWidths };
        }
    }

    persistViewState() {
        vscode.setState({
            sheetColumnWidths: this.sheetColumnWidths
        });
    }

    getCurrentSheetWidthKey() {
        return String(this.currentSheetIndex);
    }

    getCurrentSheetColumnWidths() {
        const key = this.getCurrentSheetWidthKey();
        const widths = this.sheetColumnWidths[key];
        if (!Array.isArray(widths)) {
            this.sheetColumnWidths[key] = [];
        }
        return this.sheetColumnWidths[key];
    }

    syncCurrentSheetColumnWidths() {
        const sheet = this.currentSheet;
        const columnCount = sheet?.headers?.length || 0;
        const currentWidths = this.getCurrentSheetColumnWidths();
        const nextWidths = new Array(columnCount).fill(null);

        for (let index = 0; index < columnCount; index += 1) {
            const width = currentWidths[index];
            nextWidths[index] = Number.isFinite(width) ? width : null;
        }

        this.sheetColumnWidths[this.getCurrentSheetWidthKey()] = nextWidths;
        this.persistViewState();
    }

    renderColumnGroup(tableEl) {
        const existingColGroup = tableEl.querySelector('colgroup');
        if (existingColGroup) {
            existingColGroup.remove();
        }

        const colGroup = document.createElement('colgroup');
        let totalWidth = 0;
        let hasExplicitWidths = true;
        this.getCurrentSheetColumnWidths().forEach((width) => {
            const col = document.createElement('col');
            if (Number.isFinite(width)) {
                col.style.width = `${width}px`;
                totalWidth += width;
            } else {
                hasExplicitWidths = false;
            }
            colGroup.appendChild(col);
        });

        tableEl.insertBefore(colGroup, tableEl.firstChild);
        tableEl.style.width = hasExplicitWidths ? `${totalWidth}px` : '';
    }

    initializeColumnWidthsFromRenderedTable() {
        const widths = this.getCurrentSheetColumnWidths();
        const headerCells = Array.from(document.querySelectorAll('#tableHeader th'));
        if (headerCells.length === 0) {
            return;
        }

        this.sheetColumnWidths[this.getCurrentSheetWidthKey()] = widths.map((width, index) => {
            const estimatedWidth = this.estimateExcelColumnWidth(index, headerCells[index]);
            return Number.isFinite(width)
                ? this.clampColumnWidth(Math.max(width, estimatedWidth))
                : estimatedWidth;
        });

        this.persistViewState();
        const tableEl = document.getElementById('excelTable');
        if (tableEl) {
            this.renderColumnGroup(tableEl);
        }
    }

    startColumnResize(event, columnIndex, th) {
        event.preventDefault();
        event.stopPropagation();

        this.resizeState = {
            columnIndex,
            startX: event.clientX,
            startWidth: Math.round(th.getBoundingClientRect().width)
        };

        document.body.classList.add('is-resizing-columns');
    }

    handleColumnResize(event) {
        if (!this.resizeState) {
            return;
        }

        event.preventDefault();
        const widths = this.getCurrentSheetColumnWidths();
        const deltaX = event.clientX - this.resizeState.startX;
        const nextWidth = this.clampColumnWidth(this.resizeState.startWidth + deltaX);
        widths[this.resizeState.columnIndex] = nextWidth;
        this.persistViewState();
        this.updateRenderedColumnWidth(this.resizeState.columnIndex, nextWidth);
    }

    stopColumnResize() {
        if (!this.resizeState) {
            return;
        }

        this.resizeState = null;
        document.body.classList.remove('is-resizing-columns');
    }

    clampColumnWidth(width) {
        return Math.max(80, Math.min(1200, Math.round(width)));
    }

    estimateExcelColumnWidth(columnIndex, headerCell) {
        const sheet = this.currentSheet;
        const headerText = sheet?.headers?.[columnIndex] || '';
        const sampleValues = (sheet?.rows || [])
            .slice(0, 50)
            .map((row) => {
                const cell = row?.[columnIndex];
                if (cell === null || cell === undefined) {
                    return '';
                }
                return typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
            });

        return this.estimateColumnWidth(headerText, sampleValues, headerCell, {
            extraWidth: 28
        });
    }

    estimateColumnWidth(headerText, sampleValues, referenceCell, options = {}) {
        const {
            extraWidth = 28,
            maxSamples = 50
        } = options;

        const canvas = this.measureCanvas || (this.measureCanvas = document.createElement('canvas'));
        const context = canvas.getContext('2d');
        if (!context) {
            return this.clampColumnWidth(referenceCell?.getBoundingClientRect().width || 120);
        }

        const computedStyle = referenceCell ? window.getComputedStyle(referenceCell) : window.getComputedStyle(document.body);
        context.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;

        let widestText = this.measureTextWidth(context, headerText);
        sampleValues.slice(0, maxSamples).forEach((value) => {
            widestText = Math.max(widestText, this.measureTextWidth(context, value));
        });

        const estimatedWidth = widestText + extraWidth;
        return this.clampColumnWidth(Math.max(estimatedWidth, referenceCell?.getBoundingClientRect().width || 0, 120));
    }

    measureTextWidth(context, value) {
        return context.measureText(String(value || '')).width;
    }

    updateRenderedColumnWidth(columnIndex, width) {
        const tableEl = document.getElementById('excelTable');
        const col = tableEl?.querySelector(`colgroup col:nth-child(${columnIndex + 1})`);
        if (col) {
            col.style.width = `${width}px`;
        }
        if (tableEl) {
            const totalWidth = this.getCurrentSheetColumnWidths().reduce((sum, currentWidth) => (
                sum + (Number.isFinite(currentWidth) ? currentWidth : 0)
            ), 0);
            tableEl.style.width = totalWidth > 0 ? `${totalWidth}px` : '';
        }
    }

    setupEventListeners() {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.searchTable(e.target.value));
        }
        const clearSearchBtn = document.getElementById('clearSearch');
        if (clearSearchBtn && searchInput) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                this.searchTable('');
            });
        }
        const copyToClipboardBtn = document.getElementById('copyToClipboard');
        if (copyToClipboardBtn) copyToClipboardBtn.addEventListener('click', () => this.copyToClipboard());
        const exportJsonBtn = document.getElementById('exportJson');
        if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => this.exportToJson());
        const toggleViewBtn = document.getElementById('toggleView');
        if (toggleViewBtn) toggleViewBtn.addEventListener('click', () => this.toggleView());
        const prevPageBtn = document.getElementById('prevPage');
        if (prevPageBtn) prevPageBtn.addEventListener('click', () => this.goToPage(this.currentPage - 1));
        const nextPageBtn = document.getElementById('nextPage');
        if (nextPageBtn) nextPageBtn.addEventListener('click', () => this.goToPage(this.currentPage + 1));
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'f') {
                    e.preventDefault();
                    if (searchInput) searchInput.focus();
                } else if (e.key === 'c') {
                    e.preventDefault();
                    this.copyToClipboard();
                } else if (e.key === 'j') {
                    e.preventDefault();
                    this.exportToJson();
                }
            }
        });
        document.addEventListener('mousemove', (event) => {
            this.handleColumnResize(event);
        });
        document.addEventListener('mouseup', () => {
            this.stopColumnResize();
        });
    }

    hideLoading() {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }

    showError(message) {
        const errorEl = document.getElementById('error');
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'flex';
        }
    }

    showNotification(message, type) {
        vscode.postMessage({
            type: type === 'error' ? 'error' : 'info',
            text: message
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ExcelViewer();
});
