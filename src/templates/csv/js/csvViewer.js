// CSV Viewer JavaScript
class CsvViewer {
    constructor() {
        this.csvData = null;
        this.filteredData = [];
        this.currentPage = 1;
        this.rowsPerPage = 100;
        this.sortColumn = null;
        this.sortDirection = 'asc';
        this.searchTerm = '';
        
        this.init();
    }

    init() {
        this.loadCsvData();
        this.setupEventListeners();
    }

    loadCsvData() {
        try {
            const dataScript = document.getElementById('csv-data');
            if (dataScript) {
                this.csvData = JSON.parse(dataScript.textContent);
                this.filteredData = [...this.csvData.rows];
                this.updateFileInfo();
                this.renderTable();
                this.hideLoading();
            } else {
                this.showError('CSV data not found');
            }
        } catch (error) {
            console.error('Error loading CSV data:', error);
            this.showError('Failed to load CSV data: ' + error.message);
        }
    }

    updateFileInfo() {
        const rowCountEl = document.getElementById('rowCount');
        const columnCountEl = document.getElementById('columnCount');
        const fileSizeEl = document.getElementById('fileSize');

        if (rowCountEl) rowCountEl.textContent = `${this.csvData.totalRows} rows`;
        if (columnCountEl) columnCountEl.textContent = `${this.csvData.totalColumns} columns`;
        if (fileSizeEl) fileSizeEl.textContent = this.csvData.fileSize;
    }

    renderTable() {
        const headerEl = document.getElementById('tableHeader');
        const bodyEl = document.getElementById('tableBody');
        const tableWrapper = document.getElementById('tableWrapper');

        if (!headerEl || !bodyEl || !tableWrapper) return;

        // Render headers
        headerEl.innerHTML = '';
        const headerRow = document.createElement('tr');
        this.csvData.headers.forEach((header, index) => {
            const th = document.createElement('th');
            th.textContent = header;
            th.className = 'sortable';
            th.onclick = () => this.sortTable(index);
            
            if (this.sortColumn === index) {
                th.classList.add(`sort-${this.sortDirection}`);
            }
            
            headerRow.appendChild(th);
        });
        headerEl.appendChild(headerRow);

        // Render data rows
        this.renderDataRows();

        tableWrapper.style.display = 'block';
    }

    renderDataRows() {
        const bodyEl = document.getElementById('tableBody');
        if (!bodyEl) return;

        bodyEl.innerHTML = '';

        const startIndex = (this.currentPage - 1) * this.rowsPerPage;
        const endIndex = startIndex + this.rowsPerPage;
        const pageData = this.filteredData.slice(startIndex, endIndex);

        pageData.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            
            row.forEach((cell, cellIndex) => {
                const td = document.createElement('td');
                td.textContent = cell || '';
                td.title = cell || ''; // Tooltip for truncated content
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

    sortTable(columnIndex) {
        if (this.sortColumn === columnIndex) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = columnIndex;
            this.sortDirection = 'asc';
        }

        this.filteredData.sort((a, b) => {
            const aVal = a[columnIndex] || '';
            const bVal = b[columnIndex] || '';
            
            let comparison = 0;
            
            // Try numeric comparison first
            const aNum = parseFloat(aVal);
            const bNum = parseFloat(bVal);
            
            if (!isNaN(aNum) && !isNaN(bNum)) {
                comparison = aNum - bNum;
            } else {
                comparison = aVal.localeCompare(bVal);
            }
            
            return this.sortDirection === 'asc' ? comparison : -comparison;
        });

        this.currentPage = 1;
        this.renderTable();
    }

    searchTable(term) {
        this.searchTerm = term.toLowerCase();
        this.currentPage = 1;

        if (!term) {
            this.filteredData = [...this.csvData.rows];
        } else {
            this.filteredData = this.csvData.rows.filter(row => 
                this.rowMatchesSearch(row)
            );
        }

        this.renderDataRows();
    }

    rowMatchesSearch(row) {
        return row.some(cell => 
            (cell || '').toLowerCase().includes(this.searchTerm)
        );
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
        const headers = this.csvData.headers.join('\t');
        const rows = this.filteredData.map(row => 
            row.map(cell => cell || '').join('\t')
        ).join('\n');
        
        const clipboardContent = `${headers}\n${rows}`;
        
        navigator.clipboard.writeText(clipboardContent).then(() => {
            this.showNotification('Data copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Failed to copy to clipboard:', err);
            this.showNotification('Failed to copy to clipboard', 'error');
        });
    }

    showStats() {
        const stats = {
            totalRows: this.csvData.totalRows,
            filteredRows: this.filteredData.length,
            columns: this.csvData.totalColumns,
            fileSize: this.csvData.fileSize,
            searchActive: this.searchTerm !== '',
            sortActive: this.sortColumn !== null
        };

        const statsText = `
📊 CSV Statistics:
• Total Rows: ${stats.totalRows}
• Filtered Rows: ${stats.filteredRows}
• Columns: ${stats.columns}
• File Size: ${stats.fileSize}
• Search Active: ${stats.searchActive ? 'Yes' : 'No'}
• Sort Active: ${stats.sortActive ? `Column ${this.sortColumn + 1} (${this.sortDirection})` : 'No'}
        `.trim();

        this.showNotification(statsText, 'info');
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 16px;
            border-radius: 4px;
            color: white;
            font-size: 14px;
            z-index: 1000;
            max-width: 300px;
            word-wrap: break-word;
            white-space: pre-line;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;

        // Set background color based on type
        switch (type) {
            case 'success':
                notification.style.background = '#28a745';
                break;
            case 'error':
                notification.style.background = '#dc3545';
                break;
            case 'info':
            default:
                notification.style.background = '#17a2b8';
                break;
        }

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
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

        // Show stats button
        const showStatsBtn = document.getElementById('showStats');
        if (showStatsBtn) {
            showStatsBtn.addEventListener('click', () => this.showStats());
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
}

// Initialize the CSV viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new CsvViewer();
});
