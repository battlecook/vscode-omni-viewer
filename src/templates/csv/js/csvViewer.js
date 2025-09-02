// CSV Viewer JavaScript
const vscode = acquireVsCodeApi();

class CsvViewer {
    constructor() {
        this.csvData = null;
        this.filteredData = [];
        this.currentPage = 1;
        this.rowsPerPage = 100;
        this.searchTerm = '';
        this.isTableView = true; // true for table view, false for raw view
        this.contextMenuTarget = null; // Store the target element for context menu
        this.saveRawDataTimeout = null; // Debounce timer for raw data saving
        this.isPasting = false; // Flag to prevent double processing during paste
        
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
            th.className = 'editable-header';
            th.setAttribute('data-col', index);
            th.title = header || ''; // Tooltip for truncated content
            
            // Add click event for header editing
            th.addEventListener('click', (e) => {
                if (this.isTableView) {
                    this.startHeaderEdit(th, index);
                }
            });
            
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
        
        // Normalize the CSV text to prevent line ending issues
        const normalizedCsv = rawCsv
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\n+/g, '\n');
        
        // Check if element is already a textarea
        if (rawDataEl.tagName !== 'TEXTAREA') {
            // Convert pre to textarea
            const textarea = document.createElement('textarea');
            textarea.id = 'rawData';
            textarea.className = 'raw-data editable';
            textarea.value = normalizedCsv;
            textarea.placeholder = 'Edit CSV data here...';
            
            // Add change event listener for real-time saving (only once)
            if (!textarea.hasAttribute('data-input-listener-added')) {
                const inputListener = () => {
                    // Skip processing if currently pasting to prevent double processing
                    if (this.isPasting) {
                        return;
                    }
                    this.saveRawDataChanges();
                };
                textarea.addEventListener('input', inputListener);
                textarea.setAttribute('data-input-listener-added', 'true');
            }
            
            // Replace the pre element with textarea
            rawDataEl.parentNode.replaceChild(textarea, rawDataEl);
        } else {
            // Update existing textarea value without triggering input event
            const currentValue = rawDataEl.value;
            if (currentValue !== normalizedCsv) {
                // Clear completely and set new value to prevent any residue
                rawDataEl.value = '';
                rawDataEl.value = normalizedCsv;
            }
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
        const targetInfo = this.getTargetCellInfo();
        if (!targetInfo) {
            this.showNotification('Please right-click on a table cell', 'error');
            return;
        }

        const newRow = new Array(this.csvData.headers.length).fill('');
        this.csvData.rows.splice(targetInfo.rowIndex, 0, newRow);
        this.csvData.totalRows++;
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification(`Row inserted above row ${targetInfo.rowIndex + 1}`, 'success');
    }

    insertRowBelow() {
        const targetInfo = this.getTargetCellInfo();
        if (!targetInfo) {
            this.showNotification('Please right-click on a table cell', 'error');
            return;
        }

        const newRow = new Array(this.csvData.headers.length).fill('');
        this.csvData.rows.splice(targetInfo.rowIndex + 1, 0, newRow);
        this.csvData.totalRows++;
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification(`Row inserted below row ${targetInfo.rowIndex + 1}`, 'success');
    }

    insertColumnLeft() {
        const targetInfo = this.getTargetCellInfo();
        if (!targetInfo) {
            this.showNotification('Please right-click on a table cell', 'error');
            return;
        }

        const columnName = `Column${this.csvData.headers.length + 1}`;
        this.csvData.headers.splice(targetInfo.colIndex, 0, columnName);
        this.csvData.totalColumns++;
        
        // Add empty cells to the specified position in all rows
        this.csvData.rows.forEach(row => {
            row.splice(targetInfo.colIndex, 0, '');
        });
        
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification(`Column "${columnName}" inserted to the left of column ${targetInfo.colIndex + 1}`, 'success');
    }

    insertColumnRight() {
        const targetInfo = this.getTargetCellInfo();
        if (!targetInfo) {
            this.showNotification('Please right-click on a table cell', 'error');
            return;
        }

        const columnName = `Column${this.csvData.headers.length + 1}`;
        this.csvData.headers.splice(targetInfo.colIndex + 1, 0, columnName);
        this.csvData.totalColumns++;
        
        // Add empty cells to the specified position in all rows
        this.csvData.rows.forEach(row => {
            row.splice(targetInfo.colIndex + 1, 0, '');
        });
        
        this.filteredData = [...this.csvData.rows];
        this.updateFileInfo();
        this.refreshView();
        this.saveChanges();
        this.showNotification(`Column "${columnName}" inserted to the right of column ${targetInfo.colIndex + 1}`, 'success');
    }

    getTargetCellInfo() {
        if (!this.contextMenuTarget) return null;
        
        // Find the closest td or th element
        const cell = this.contextMenuTarget.closest('td, th');
        if (!cell) return null;
        
        // Find the row (tr) containing this cell
        const row = cell.closest('tr');
        if (!row) return null;
        
        // Get row index
        let rowIndex = -1;
        if (row.parentElement.tagName === 'THEAD') {
            // Header row
            rowIndex = 0;
        } else {
            // Data row - find the actual row index in the original data
            const rowCells = Array.from(row.cells);
            const rowData = rowCells.map(cell => cell.textContent || '');
            
            // Find the original row index
            for (let i = 0; i < this.csvData.rows.length; i++) {
                if (JSON.stringify(this.csvData.rows[i]) === JSON.stringify(rowData)) {
                    rowIndex = i;
                    break;
                }
            }
        }
        
        // Get column index
        const colIndex = Array.from(row.cells).indexOf(cell);
        
        if (rowIndex === -1 || colIndex === -1) return null;
        
        return { rowIndex, colIndex };
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

            // Debug: Log clipboard content
            console.log('Clipboard content:', {
                text: clipboardText,
                length: clipboardText.length,
                lines: clipboardText.split('\n').length,
                hasDuplicateLines: this.checkForDuplicateLines(clipboardText),
                normalizedLines: clipboardText
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n')
                    .replace(/\n+/g, '\n')
                    .split('\n')
                    .filter(line => line.trim() !== '').length
            });

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
                
                // Always replace all content when pasting to prevent duplication
                newValue = clipboardText;
                newCursorPos = clipboardText.length;
                
                // Debug: Log before and after values
                console.log('Before paste:', {
                    currentValue: currentValue,
                    currentValueLength: currentValue.length,
                    start: start,
                    end: end,
                    isAllSelected: isAllSelected,
                    willReplaceAll: true
                });
                console.log('After paste:', {
                    newValue: newValue,
                    newValueLength: newValue.length,
                    clipboardTextLength: clipboardText.length
                });
                
                // Set a flag to prevent input event processing during paste
                this.isPasting = true;
                
                // Clear the textarea completely and set new value
                rawDataEl.value = '';
                rawDataEl.value = newValue;
                rawDataEl.setSelectionRange(newCursorPos, newCursorPos);
                
                // Mark as modified and save
                this.isRawDataModified = true;
                this.updateSaveButton();
                
                // Focus back to textarea
                rawDataEl.focus();
                
                // Manually trigger save after paste (without triggering input event)
                this.saveRawDataChanges();
                
                // Reset the flag after a short delay to allow normal input processing
                setTimeout(() => {
                    this.isPasting = false;
                }, 100);
                
                this.showNotification('Content pasted from clipboard.', 'success');
            }
        } catch (error) {
            console.error('Failed to paste from clipboard:', error);
            this.showNotification('Failed to paste from clipboard.', 'error');
        }
    }

    checkForDuplicateLines(text) {
        const lines = text.split('\n');
        const uniqueLines = new Set(lines);
        return {
            totalLines: lines.length,
            uniqueLines: uniqueLines.size,
            hasDuplicates: lines.length !== uniqueLines.size,
            duplicateLines: lines.filter((line, index) => lines.indexOf(line) !== index)
        };
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

    startHeaderEdit(th, colIndex) {
        // Don't edit if already editing
        if (th.querySelector('input')) return;

        const originalValue = th.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalValue;
        input.className = 'header-edit-input';
        
        // Style the input to match the header
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.border = 'none';
        input.style.outline = 'none';
        input.style.padding = '0';
        input.style.margin = '0';
        input.style.fontSize = 'inherit';
        input.style.fontFamily = 'inherit';
        input.style.fontWeight = 'bold';
        input.style.backgroundColor = 'var(--vscode-input-background)';
        input.style.color = 'var(--vscode-input-foreground)';
        
        // Clear the header content and add input
        th.innerHTML = '';
        th.appendChild(input);
        input.focus();
        input.select();

        // Handle input events
        const handleInput = (e) => {
            if (e.key === 'Enter') {
                this.finishHeaderEdit(th, colIndex, input.value, originalValue);
            } else if (e.key === 'Escape') {
                this.cancelHeaderEdit(th, originalValue);
            }
        };

        const handleBlur = () => {
            this.finishHeaderEdit(th, colIndex, input.value, originalValue);
        };

        input.addEventListener('keydown', handleInput);
        input.addEventListener('blur', handleBlur);
    }

    finishHeaderEdit(th, colIndex, newValue, originalValue) {
        // Update the header data
        this.csvData.headers[colIndex] = newValue;

        // Update the header display
        th.innerHTML = '';
        th.textContent = newValue;
        th.title = newValue;

        // Save changes immediately
        this.saveChanges();
    }

    cancelHeaderEdit(th, originalValue) {
        th.innerHTML = '';
        th.textContent = originalValue;
        th.title = originalValue;
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
        // Clear existing timeout to prevent multiple rapid calls
        if (this.saveRawDataTimeout) {
            clearTimeout(this.saveRawDataTimeout);
        }

        // Debounce the save operation
        this.saveRawDataTimeout = setTimeout(() => {
            this._performRawDataSave();
        }, 300); // Wait 300ms after last input
    }

    _performRawDataSave() {
        const rawDataEl = document.getElementById('rawData');
        if (!rawDataEl || rawDataEl.tagName !== 'TEXTAREA') {
            return;
        }

        const rawCsvText = rawDataEl.value.trim();
        if (!rawCsvText) {
            return;
        }

        try {
            // Normalize line endings and parse the raw CSV text with detailed debugging
            const normalizedText = rawCsvText
                .replace(/\r\n/g, '\n')  // Windows line endings
                .replace(/\r/g, '\n')    // Mac line endings
                .replace(/\n+/g, '\n');  // Multiple consecutive newlines to single
            
            const rawLines = normalizedText.split('\n');
            const lines = rawLines.filter(line => line.trim() !== '');
            
            console.log('Raw CSV text analysis:', {
                originalLength: rawCsvText.length,
                normalizedLength: normalizedText.length,
                rawLinesCount: rawLines.length,
                filteredLinesCount: lines.length,
                emptyLinesCount: rawLines.length - lines.length,
                rawLines: rawLines.map((line, index) => ({
                    index,
                    content: line,
                    length: line.length,
                    trimmed: line.trim(),
                    isEmpty: line.trim() === '',
                    hasHiddenChars: line.length !== line.trim().length
                }))
            });
            
            if (lines.length === 0) {
                return;
            }

            // Parse headers
            const headers = this.parseCsvLine(lines[0]);
            if (headers.length === 0) {
                return;
            }

            console.log('Parsed headers:', headers);

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

            console.log('Parsed rows:', {
                totalRows: newRows.length,
                sampleRows: newRows.slice(0, 3),
                lastRow: newRows[newRows.length - 1]
            });

            // IMPORTANT: Completely replace the data, don't append
            this.csvData.headers = [...headers]; // Create new array
            this.csvData.rows = [...newRows];    // Create new array
            this.filteredData = [...newRows];    // Create new array

            // Reset pagination
            this.currentPage = 1;

            // Validate data integrity
            if (this.csvData.rows.length !== newRows.length) {
                console.warn('Data integrity check failed: rows count mismatch');
                this.csvData.rows = [...newRows];
                this.filteredData = [...newRows];
            }

            // Additional validation: check if the data makes sense
            if (newRows.length > 1000) {
                console.warn('Suspiciously large number of rows:', newRows.length);
            }
            
            // Log the actual data being saved
            console.log('Final data to be saved:', {
                headersCount: this.csvData.headers.length,
                rowsCount: this.csvData.rows.length,
                firstRow: this.csvData.rows[0],
                lastRow: this.csvData.rows[this.csvData.rows.length - 1],
                totalDataSize: JSON.stringify(this.csvData).length
            });

            console.log('Data updated successfully:', {
                headers: this.csvData.headers,
                rowsCount: this.csvData.rows.length,
                filteredCount: this.filteredData.length
            });

            // Save changes immediately
            this.saveChanges();
        } catch (error) {
            console.error('Error parsing raw CSV data:', error);
            this.showNotification('CSV 파싱 오류: ' + error.message, 'error');
        }
    }
}

// Initialize the CSV viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new CsvViewer();
});
