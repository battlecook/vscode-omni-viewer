// CSV Viewer JavaScript
const vscode = acquireVsCodeApi();

class CsvViewer {
    constructor() {
        this.csvData = null;
        this.filteredData = [];
        this.currentPage = 1;
        this.rowsPerPage = 100;
        this.sortColumn = null;
        this.sortDirection = 'asc';
        this.searchTerm = '';
        this.isTableView = true; // true for table view, false for raw view
        this.contextMenuTarget = null; // Store the target element for context menu
        
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

        pageData.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            
            row.forEach((cell, cellIndex) => {
                const td = document.createElement('td');
                td.textContent = cell || '';
                td.title = cell || ''; // Tooltip for truncated content
                td.className = 'editable-cell';
                td.setAttribute('data-row', startIndex + rowIndex);
                td.setAttribute('data-col', cellIndex);
                
                // Store the original row index for proper data mapping
                // Find the original row index by comparing with the original data
                const originalRowIndex = this.findOriginalRowIndex(row);
                td.setAttribute('data-original-row', originalRowIndex);
                
                // Add click event for cell editing
                td.addEventListener('click', (e) => {
                    if (this.isTableView) {
                        this.startCellEdit(td, startIndex + rowIndex, cellIndex, originalRowIndex);
                    }
                });
                
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
        if (this.isTableView) {
            this.renderDataRows();
        } else {
            this.renderRawData();
        }
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

        if (this.isTableView) {
            this.renderDataRows();
        } else {
            this.renderRawData();
        }
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

    exportToJson() {
        const exportData = {
            headers: this.csvData.headers,
            rows: this.filteredData,
            metadata: {
                totalRows: this.csvData.totalRows,
                filteredRows: this.filteredData.length,
                columns: this.csvData.totalColumns,
                fileSize: this.csvData.fileSize,
                searchActive: this.searchTerm !== '',
                sortActive: this.sortColumn !== null,
                sortColumn: this.sortColumn,
                sortDirection: this.sortDirection,
                exportDate: new Date().toISOString()
            }
        };

        const jsonString = JSON.stringify(exportData, null, 2);
        const dataSize = new Blob([jsonString]).size;
        const maxSize = 1024 * 1024; // 1MB 제한

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

        // Create raw CSV format
        const headers = this.csvData.headers.join(',');
        const rows = this.filteredData.map(row => 
            row.map(cell => {
                // Escape commas and quotes in CSV format
                if (cell && (cell.includes(',') || cell.includes('"'))) {
                    return `"${cell.replace(/"/g, '""')}"`;
                }
                return cell || '';
            }).join(',')
        ).join('\n');
        
        const rawCsv = `${headers}\n${rows}`;
        
        // Check if element is already a textarea
        if (rawDataEl.tagName !== 'TEXTAREA') {
            // Convert pre to textarea
            const textarea = document.createElement('textarea');
            textarea.id = 'rawData';
            textarea.className = 'raw-data editable';
            textarea.value = rawCsv;
            textarea.placeholder = 'Edit CSV data here...';
            
            // Add change event listener for real-time saving
            textarea.addEventListener('input', () => {
                this.saveRawDataChanges();
            });
            
            // Replace the pre element with textarea
            rawDataEl.parentNode.replaceChild(textarea, rawDataEl);
        } else {
            // Update existing textarea value
            rawDataEl.value = rawCsv;
        }
    }

    updateSaveButton() {
        const saveBtn = document.getElementById('saveRawData');
        if (saveBtn) {
            saveBtn.style.display = this.isRawDataModified ? 'inline-block' : 'none';
        }
    }



    parseCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    current += '"';
                    i++; // Skip next quote
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                // End of field
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        
        // Add the last field
        result.push(current);
        
        return result;
    }

    // Context Menu Methods
    showContextMenu(event, target) {
        event.preventDefault();
        this.contextMenuTarget = target;
        
        const contextMenu = document.getElementById('contextMenu');
        if (!contextMenu) return;
        
        // Clear existing menu items
        contextMenu.innerHTML = '';
        
        // Add menu items based on current view
        if (this.isTableView) {
            // Table view menu items
            this.addMenuItem(contextMenu, 'addRow', '➕ Add Row');
            this.addMenuItem(contextMenu, 'addColumn', '➕ Add Column');
            this.addSeparator(contextMenu);
            this.addMenuItem(contextMenu, 'insertRowAbove', '⬆️ Insert Row Above');
            this.addMenuItem(contextMenu, 'insertRowBelow', '⬇️ Insert Row Below');
            this.addMenuItem(contextMenu, 'insertColumnLeft', '⬅️ Insert Column Left');
            this.addMenuItem(contextMenu, 'insertColumnRight', '➡️ Insert Column Right');
        } else {
            // Raw view menu items
            this.addMenuItem(contextMenu, 'paste', '📋 Paste');
            this.addSeparator(contextMenu);
            this.addMenuItem(contextMenu, 'addRow', '➕ Add Row');
            this.addMenuItem(contextMenu, 'addColumn', '➕ Add Column');
            this.addSeparator(contextMenu);
            this.addMenuItem(contextMenu, 'deleteRow', '🗑️ Delete Row');
            this.addMenuItem(contextMenu, 'deleteColumn', '🗑️ Delete Column');
            this.addSeparator(contextMenu);
            this.addMenuItem(contextMenu, 'insertRowAbove', '⬆️ Insert Row Above');
            this.addMenuItem(contextMenu, 'insertRowBelow', '⬇️ Insert Row Below');
            this.addMenuItem(contextMenu, 'insertColumnLeft', '⬅️ Insert Column Left');
            this.addMenuItem(contextMenu, 'insertColumnRight', '➡️ Insert Column Right');
        }
        
        // Position the context menu
        contextMenu.style.left = event.pageX + 'px';
        contextMenu.style.top = event.pageY + 'px';
        contextMenu.style.display = 'block';
        
        // Add click outside listener
        setTimeout(() => {
            document.addEventListener('click', this.hideContextMenu.bind(this), { once: true });
        }, 0);
    }

    addMenuItem(container, action, text) {
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item';
        menuItem.setAttribute('data-action', action);
        menuItem.textContent = text;
        container.appendChild(menuItem);
    }

    addSeparator(container) {
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        container.appendChild(separator);
    }

    hideContextMenu() {
        const contextMenu = document.getElementById('contextMenu');
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
        this.contextMenuTarget = null;
    }

    handleContextMenuAction(action) {
        if (!this.contextMenuTarget) return;
        
        switch (action) {
            case 'paste':
                this.pasteFromClipboard();
                break;
            case 'addRow':
                this.addRow();
                break;
            case 'addColumn':
                this.addColumn();
                break;
            case 'deleteRow':
                this.deleteRow();
                break;
            case 'deleteColumn':
                this.deleteColumn();
                break;
            case 'insertRowAbove':
                this.insertRowAbove();
                break;
            case 'insertRowBelow':
                this.insertRowBelow();
                break;
            case 'insertColumnLeft':
                this.insertColumnLeft();
                break;
            case 'insertColumnRight':
                this.insertColumnRight();
                break;
        }
        
        this.hideContextMenu();
    }

    addRow() {
        const newRow = new Array(this.csvData.headers.length).fill('');
        this.csvData.rows.push(newRow);
        this.csvData.totalRows++;
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification('New row added', 'success');
    }

    addColumn() {
        const columnName = `Column${this.csvData.headers.length + 1}`;
        this.csvData.headers.push(columnName);
        this.csvData.totalColumns++;
        
        // Add empty cells to all rows
        this.csvData.rows.forEach(row => {
            row.push('');
        });
        
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification(`New column "${columnName}" added`, 'success');
    }

    deleteRow() {
        if (this.csvData.rows.length <= 1) {
            this.showNotification('Cannot delete the last row', 'error');
            return;
        }
        
        this.csvData.rows.pop();
        this.csvData.totalRows--;
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification('Last row deleted', 'success');
    }

    deleteColumn() {
        if (this.csvData.headers.length <= 1) {
            this.showNotification('Cannot delete the last column', 'error');
            return;
        }
        
        this.csvData.headers.pop();
        this.csvData.totalColumns--;
        
        // Remove last cell from all rows
        this.csvData.rows.forEach(row => {
            row.pop();
        });
        
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification('Last column deleted', 'success');
    }

    insertRowAbove() {
        const newRow = new Array(this.csvData.headers.length).fill('');
        this.csvData.rows.unshift(newRow);
        this.csvData.totalRows++;
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification('Row inserted at the top', 'success');
    }

    insertRowBelow() {
        const newRow = new Array(this.csvData.headers.length).fill('');
        this.csvData.rows.push(newRow);
        this.csvData.totalRows++;
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification('Row inserted at the bottom', 'success');
    }

    insertColumnLeft() {
        const columnName = `Column${this.csvData.headers.length + 1}`;
        this.csvData.headers.unshift(columnName);
        this.csvData.totalColumns++;
        
        // Add empty cells to the beginning of all rows
        this.csvData.rows.forEach(row => {
            row.unshift('');
        });
        
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification(`Column "${columnName}" inserted at the left`, 'success');
    }

    insertColumnRight() {
        const columnName = `Column${this.csvData.headers.length + 1}`;
        this.csvData.headers.push(columnName);
        this.csvData.totalColumns++;
        
        // Add empty cells to the end of all rows
        this.csvData.rows.forEach(row => {
            row.push('');
        });
        
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification(`Column "${columnName}" inserted at the right`, 'success');
    }

    refreshView() {
        if (this.isTableView) {
            this.renderTable();
        } else {
            this.renderRawData();
        }
    }

    async pasteFromClipboard() {
        try {
            const clipboardText = await navigator.clipboard.readText();
            if (!clipboardText) {
                this.showNotification('No text in clipboard.', 'error');
                return;
            }

            if (this.isTableView) {
                // In table view, show notification that paste is only available in raw view
                this.showNotification('Paste is only available in Raw View.', 'info');
                return;
            }

            // In raw view, paste the text
            const rawDataEl = document.getElementById('rawData');
            if (rawDataEl && rawDataEl.tagName === 'TEXTAREA') {
                // Get cursor position
                const start = rawDataEl.selectionStart;
                const end = rawDataEl.selectionEnd;
                const currentValue = rawDataEl.value;
                
                // Check if all text is selected
                const isAllSelected = (start === 0 && end === currentValue.length);
                
                let newValue;
                let newCursorPos;
                
                if (isAllSelected) {
                    // Replace all content
                    newValue = clipboardText;
                    newCursorPos = clipboardText.length;
                } else {
                    // Insert at cursor position
                    newValue = currentValue.substring(0, start) + clipboardText + currentValue.substring(end);
                    newCursorPos = start + clipboardText.length;
                }
                
                rawDataEl.value = newValue;
                rawDataEl.setSelectionRange(newCursorPos, newCursorPos);
                
                // Mark as modified and save
                this.isRawDataModified = true;
                this.updateSaveButton();
                
                // Save changes immediately
                this.saveRawDataChanges();
                
                // Focus back to textarea
                rawDataEl.focus();
                
                this.showNotification('Content pasted from clipboard.', 'success');
            }
        } catch (error) {
            console.error('Failed to paste from clipboard:', error);
            this.showNotification('Failed to paste from clipboard.', 'error');
        }
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



        // Context menu
        const contextMenu = document.getElementById('contextMenu');
        if (contextMenu) {
            contextMenu.addEventListener('click', (e) => {
                const menuItem = e.target.closest('.context-menu-item');
                if (menuItem) {
                    const action = menuItem.getAttribute('data-action');
                    if (action) {
                        this.handleContextMenuAction(action);
                    }
                }
            });
        }

        // Disable default context menu and add custom one
        document.addEventListener('contextmenu', (e) => {
            // Only show context menu on table area (not raw data area)
            const target = e.target;
            const isTableArea = target.closest('#tableWrapper');
            
            if (isTableArea) {
                this.showContextMenu(e, target);
            }
        });

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
                    case 'v':
                        e.preventDefault();
                        if (this.isTableView) {
                            this.toggleView();
                        } else {
                            this.pasteFromClipboard();
                        }
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

    findOriginalRowIndex(filteredRow) {
        // Find the original row index by comparing with the original data
        for (let i = 0; i < this.csvData.rows.length; i++) {
            if (JSON.stringify(this.csvData.rows[i]) === JSON.stringify(filteredRow)) {
                return i;
            }
        }
        // If not found, return -1
        return -1;
    }

    startCellEdit(td, rowIndex, colIndex, originalRowIndex) {
        // Don't edit if already editing
        if (td.querySelector('input')) return;

        const originalValue = td.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalValue;
        input.className = 'cell-edit-input';
        
        // Style the input to match the cell
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.border = 'none';
        input.style.outline = 'none';
        input.style.padding = '0';
        input.style.margin = '0';
        input.style.fontSize = 'inherit';
        input.style.fontFamily = 'inherit';
        input.style.backgroundColor = 'var(--vscode-input-background)';
        input.style.color = 'var(--vscode-input-foreground)';
        
        // Clear the cell content and add input
        td.innerHTML = '';
        td.appendChild(input);
        input.focus();
        input.select();

        // Handle input events
        const handleInput = (e) => {
            if (e.key === 'Enter') {
                this.finishCellEdit(td, rowIndex, colIndex, input.value, originalRowIndex);
            } else if (e.key === 'Escape') {
                this.cancelCellEdit(td, originalValue);
            }
        };

        const handleBlur = () => {
            this.finishCellEdit(td, rowIndex, colIndex, input.value, originalRowIndex);
        };

        input.addEventListener('keydown', handleInput);
        input.addEventListener('blur', handleBlur);
    }

    finishCellEdit(td, rowIndex, colIndex, newValue, originalRowIndex) {
        // Update the filtered data
        if (rowIndex < this.filteredData.length) {
            this.filteredData[rowIndex][colIndex] = newValue;
        }

        // Update the original data using the provided original row index
        if (originalRowIndex !== -1 && originalRowIndex < this.csvData.rows.length) {
            this.csvData.rows[originalRowIndex][colIndex] = newValue;
        } else {
            console.warn('Invalid original row index:', originalRowIndex);
        }

        // Update the cell display
        td.innerHTML = '';
        td.textContent = newValue;
        td.title = newValue;

        // Save changes immediately
        this.saveChanges();
    }

    cancelCellEdit(td, originalValue) {
        td.innerHTML = '';
        td.textContent = originalValue;
        td.title = originalValue;
    }

    saveChanges() { 
        // Send the updated data to the extension
        console.log('Sending saveChanges message:', {
            headers: this.csvData.headers,
            rows: this.csvData.rows
        });
        
        vscode.postMessage({
            command: 'saveChanges',
            data: {
                headers: this.csvData.headers,
                rows: this.csvData.rows
            }
        });
    }

    saveRawDataChanges() {
        const rawDataEl = document.getElementById('rawData');
        if (!rawDataEl || rawDataEl.tagName !== 'TEXTAREA') {
            return;
        }

        const rawCsvText = rawDataEl.value.trim();
        if (!rawCsvText) {
            return;
        }

        try {
            // Parse the raw CSV text
            const lines = rawCsvText.split('\n').filter(line => line.trim());
            if (lines.length === 0) {
                return;
            }

            // Parse headers
            const headers = this.parseCsvLine(lines[0]);
            if (headers.length === 0) {
                return;
            }

            // Parse data rows
            const newRows = [];
            for (let i = 1; i < lines.length; i++) {
                const row = this.parseCsvLine(lines[i]);
                if (row.length > 0) {
                    // Pad row if it's shorter than headers
                    while (row.length < headers.length) {
                        row.push('');
                    }
                    // Truncate row if it's longer than headers
                    newRows.push(row.slice(0, headers.length));
                }
            }

            // Update the data
            this.csvData.headers = headers;
            this.csvData.rows = newRows;
            this.filteredData = [...newRows];

            // Save changes immediately
            this.saveChanges();
        } catch (error) {
            console.error('Error parsing raw CSV data:', error);
        }
    }
}

// Initialize the CSV viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new CsvViewer();
});
