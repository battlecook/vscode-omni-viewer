// Parquet Viewer JavaScript
const vscode = acquireVsCodeApi();

class ParquetViewer {
    constructor() {
        this.parquetData = null;
        this.filteredData = [];
        this.currentPage = 1;
        this.rowsPerPage = 100;
        this.searchTerm = '';
        this.isTableView = true; // true for table view, false for raw view
        
        this.init();
    }

    init() {
        this.loadParquetData();
        this.setupEventListeners();
    }

    loadParquetData() {
        try {
            const dataScript = document.getElementById('parquet-data');
            if (dataScript) {
                console.log('Loading Parquet data from script tag...');
                this.parquetData = JSON.parse(dataScript.textContent);
                console.log('Parquet data loaded:', {
                    headers: this.parquetData.headers?.length || 0,
                    rows: this.parquetData.rows?.length || 0,
                    totalRows: this.parquetData.totalRows,
                    totalColumns: this.parquetData.totalColumns
                });
                
                if (!this.parquetData.headers || this.parquetData.headers.length === 0) {
                    console.warn('No headers found in Parquet data');
                    this.showError('No columns found in Parquet file');
                    this.hideLoading();
                    return;
                }
                
                if (!this.parquetData.rows || this.parquetData.rows.length === 0) {
                    console.warn('No rows found in Parquet data');
                    this.showError('No data rows found in Parquet file');
                    this.hideLoading();
                    return;
                }
                
                this.filteredData = [...this.parquetData.rows];
                this.updateFileInfo();
                this.showLimitWarning();
                this.renderTable();
                this.hideLoading();
            } else {
                console.error('Parquet data script tag not found');
                this.showError('Parquet data not found');
            }
        } catch (error) {
            console.error('Error loading Parquet data:', error);
            this.showError('Failed to load Parquet data: ' + error.message);
        }
    }

    updateFileInfo() {
        const rowCountEl = document.getElementById('rowCount');
        const columnCountEl = document.getElementById('columnCount');
        const fileSizeEl = document.getElementById('fileSize');

        // Show actual total rows if limited, otherwise show displayed rows
        const displayRows = this.parquetData.isLimited && this.parquetData.actualTotalRows 
            ? `${this.parquetData.totalRows.toLocaleString()} / ${this.parquetData.actualTotalRows.toLocaleString()}`
            : this.parquetData.totalRows.toLocaleString();
        
        if (rowCountEl) rowCountEl.textContent = `${displayRows} rows`;
        if (columnCountEl) columnCountEl.textContent = `${this.parquetData.totalColumns} columns`;
        if (fileSizeEl) fileSizeEl.textContent = this.parquetData.fileSize;
    }

    showLimitWarning() {
        const limitWarningEl = document.getElementById('limitWarning');
        const limitMessageEl = document.getElementById('limitMessage');
        
        if (this.parquetData.isLimited && this.parquetData.limitMessage) {
            if (limitWarningEl) {
                limitWarningEl.style.display = 'flex';
            }
            if (limitMessageEl) {
                limitMessageEl.textContent = this.parquetData.limitMessage;
            }
        } else {
            if (limitWarningEl) {
                limitWarningEl.style.display = 'none';
            }
        }
    }

    renderTable() {
        const headerEl = document.getElementById('tableHeader');
        const bodyEl = document.getElementById('tableBody');
        const tableWrapper = document.getElementById('tableWrapper');

        if (!headerEl || !bodyEl || !tableWrapper) {
            console.error('Required DOM elements not found:', { headerEl, bodyEl, tableWrapper });
            return;
        }

        console.log('Rendering table with', this.parquetData.headers.length, 'headers and', this.parquetData.rows.length, 'rows');

        // Render headers
        headerEl.innerHTML = '';
        const headerRow = document.createElement('tr');
        this.parquetData.headers.forEach((header) => {
            const th = document.createElement('th');
            th.textContent = header || '';
            th.title = header || ''; // Tooltip for truncated content
            headerRow.appendChild(th);
        });
        headerEl.appendChild(headerRow);

        // Render data rows
        this.renderDataRows();

        // Set initial view
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
            
            row.forEach((cell) => {
                const td = document.createElement('td');
                // Handle different data types (null, objects, arrays, etc.)
                if (cell === null || cell === undefined) {
                    td.textContent = '';
                    td.style.color = 'var(--vscode-descriptionForeground)';
                    td.style.fontStyle = 'italic';
                } else if (typeof cell === 'object') {
                    td.textContent = JSON.stringify(cell);
                } else {
                    td.textContent = String(cell);
                }
                td.title = td.textContent; // Tooltip for truncated content
                tr.appendChild(td);
            });

            // Highlight search matches
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

        if (!term) {
            this.filteredData = [...this.parquetData.rows];
        } else {
            this.filteredData = this.parquetData.rows.filter(row => 
                this.rowMatchesSearch(row)
            );
        }

        if (this.isTableView) {
            this.renderDataRows();
        } else {
            this.renderRawData();
        }
    }

    rowMatchesSearch(row) {
        return row.some(cell => {
            const cellStr = cell === null || cell === undefined 
                ? '' 
                : typeof cell === 'object' 
                    ? JSON.stringify(cell) 
                    : String(cell);
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
        const headers = this.parquetData.headers.join('\t');
        const rows = this.filteredData.map(row => 
            row.map(cell => {
                if (cell === null || cell === undefined) return '';
                if (typeof cell === 'object') return JSON.stringify(cell);
                return String(cell);
            }).join('\t')
        ).join('\n');
        
        const clipboardContent = `${headers}\n${rows}`;
        
        navigator.clipboard.writeText(clipboardContent).then(() => {
            this.showNotification('Data copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Failed to copy to clipboard:', err);
            this.showNotification('Failed to copy to clipboard', 'error');
        });
    }

    exportToJson() {
        const exportData = {
            headers: this.parquetData.headers,
            rows: this.filteredData,
            schema: this.parquetData.schema,
            metadata: {
                totalRows: this.parquetData.totalRows,
                filteredRows: this.filteredData.length,
                columns: this.parquetData.totalColumns,
                fileSize: this.parquetData.fileSize,
                searchActive: this.searchTerm !== '',
                exportDate: new Date().toISOString()
            }
        };

        const jsonString = JSON.stringify(exportData, null, 2);
        const dataSize = new Blob([jsonString]).size;
        const maxSize = 1024 * 1024; // 1MB limit

        if (dataSize > maxSize) {
            this.showNotification(`JSON data is too large (${(dataSize / 1024 / 1024).toFixed(2)}MB). Cannot copy to clipboard.`, 'error');
            return;
        }

        // Copy to clipboard
        navigator.clipboard.writeText(jsonString).then(() => {
            this.showNotification(`JSON data copied to clipboard! (${(dataSize / 1024).toFixed(1)}KB)`, 'success');
        }).catch(err => {
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
            // Show table view
            if (tableWrapper) tableWrapper.style.display = 'block';
            if (rawDataWrapper) rawDataWrapper.style.display = 'none';
            if (toggleBtn) toggleBtn.textContent = '📄 Raw View';
            if (pagination) pagination.style.display = 'flex';
            if (searchContainer) searchContainer.style.display = 'flex';
            this.renderDataRows();
        } else {
            // Show raw view
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
        if (!rawDataEl) return;

        // Create JSON representation of the data
        const rawData = {
            schema: this.parquetData.schema,
            headers: this.parquetData.headers,
            rows: this.filteredData,
            metadata: {
                totalRows: this.parquetData.totalRows,
                filteredRows: this.filteredData.length,
                columns: this.parquetData.totalColumns,
                fileSize: this.parquetData.fileSize
            }
        };
        
        const jsonString = JSON.stringify(rawData, null, 2);
        rawDataEl.textContent = jsonString;
    }

    setupEventListeners() {
        // Search functionality
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTable(e.target.value);
            });
        }

        const clearSearchBtn = document.getElementById('clearSearch');
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    this.searchTable('');
                }
            });
        }

        // Copy to clipboard button
        const copyToClipboardBtn = document.getElementById('copyToClipboard');
        if (copyToClipboardBtn) {
            copyToClipboardBtn.addEventListener('click', () => this.copyToClipboard());
        }

        // Export JSON button
        const exportJsonBtn = document.getElementById('exportJson');
        if (exportJsonBtn) {
            exportJsonBtn.addEventListener('click', () => this.exportToJson());
        }

        // Toggle view button
        const toggleViewBtn = document.getElementById('toggleView');
        if (toggleViewBtn) {
            toggleViewBtn.addEventListener('click', () => this.toggleView());
        }

        // Pagination buttons
        const prevPageBtn = document.getElementById('prevPage');
        if (prevPageBtn) {
            prevPageBtn.addEventListener('click', () => this.goToPage(this.currentPage - 1));
        }

        const nextPageBtn = document.getElementById('nextPage');
        if (nextPageBtn) {
            nextPageBtn.addEventListener('click', () => this.goToPage(this.currentPage + 1));
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'f':
                        e.preventDefault();
                        if (searchInput) searchInput.focus();
                        break;
                    case 'c':
                        e.preventDefault();
                        this.copyToClipboard();
                        break;
                    case 'j':
                        e.preventDefault();
                        this.exportToJson();
                        break;
                }
            }
        });
    }

    hideLoading() {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
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

    showNotification(message, type = 'info') {
        // Simple notification using VSCode API
        vscode.postMessage({
            type: type === 'error' ? 'error' : 'info',
            text: message
        });
    }
}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ParquetViewer();
});

