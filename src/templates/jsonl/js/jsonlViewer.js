class JsonlViewer {
    constructor() {
        this.currentHoverTimeout = null;
        this.currentLineData = null;
        this.mousePosition = { x: 0, y: 0 };
        this.editingLine = null;
        this.vscode = null;
        this.isPopupEditing = false;
        this.originalJsonContent = '';
        this.selectedLines = new Set();
        this.lastSelectedLine = null;
        this.isMultiSelecting = false;
        this.contextMenu = null;
        // Drag and drop properties
        this.draggedLine = null;
        this.dragStartY = 0;
        this.dragOffset = 0;
        this.isDragging = false;
        this.dragPreview = null;
        this.init();
    }

    init() {
        this.setupVSCodeAPI();
        this.setupEventListeners();
        this.setupContextMenu();
        this.updatePreviewBanner();
        this.renderJsonlLines();
    }

    setupVSCodeAPI() {
        // Get VSCode API
        this.vscode = acquireVsCodeApi();
    }

    setupContextMenu() {
        this.contextMenu = document.getElementById('contextMenu');
        const deleteMenuItem = document.getElementById('deleteMenuItem');
        
        // Delete menu item click handler
        deleteMenuItem.addEventListener('click', () => {
            this.hideContextMenu();
            this.deleteSelectedLines();
        });
        
        // Hide context menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
        
        // Hide context menu on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideContextMenu();
            }
        });
    }

    showContextMenu(x, y) {
        // Only show context menu if there are selected lines
        if (this.selectedLines.size === 0) {
            return;
        }
        
        // Position the context menu
        this.contextMenu.style.left = x + 'px';
        this.contextMenu.style.top = y + 'px';
        this.contextMenu.classList.add('show');
        
        console.log('📋 Context menu shown for', this.selectedLines.size, 'selected lines');
    }

    hideContextMenu() {
        this.contextMenu.classList.remove('show');
    }

    setupEventListeners() {
        const loadMoreButton = document.getElementById('loadMoreButton');
        const loadAllButton = document.getElementById('loadAllButton');
        loadMoreButton.addEventListener('click', () => {
            this.loadMoreContent(loadMoreButton);
        });
        loadAllButton.addEventListener('click', () => {
            this.loadAllContent(loadAllButton);
        });

        // Track mouse position
        document.addEventListener('mousemove', (e) => {
            this.mousePosition.x = e.clientX;
            this.mousePosition.y = e.clientY;
            
            // Hide popup when mouse moves to empty space
            const editorContent = document.getElementById('editorContent');
            if (editorContent.contains(e.target)) {
                const hoveredLine = e.target.closest('.line');
                if (!hoveredLine) {
                    // Mouse is over empty space, hide popup
                    this.hideJsonPopup();
                }
            }
        });

        // Close popup button
        document.getElementById('closePopup').addEventListener('click', () => {
            this.hideJsonPopup();
        });

        // JSON content click to edit
        document.getElementById('jsonContent').addEventListener('click', () => {
            this.startPopupEditing();
        });

        // Save button
        document.getElementById('saveBtn').addEventListener('click', () => {
            this.savePopupEdit();
        });

        // Cancel button
        document.getElementById('cancelBtn').addEventListener('click', () => {
            this.cancelPopupEdit();
        });

        // Close popup with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isPopupEditing) {
                    this.cancelPopupEdit();
                } else {
                    this.hideJsonPopup();
                }
            } else if (e.key === 'Enter' && e.ctrlKey && this.isPopupEditing) {
                this.savePopupEdit();
            } else if (e.key === 'Delete' && !this.editingLine) {
                // Delete selected lines when not editing
                if (this.selectedLines.size > 0) {
                    e.preventDefault();
                    this.deleteSelectedLines();
                }
            } else if (e.key === 'Enter' && !this.editingLine && e.ctrlKey) {
                // Add new line at the end with Ctrl+Enter
                e.preventDefault();
                this.addNewLineAtEnd();
            }
        });

        // Close popup when clicking outside
        document.addEventListener('click', (e) => {
            const popup = document.getElementById('jsonPopup');
            const editorContent = document.getElementById('editorContent');
            
            // Check if popup is visible and click is outside popup
            if (popup.classList.contains('show') && !popup.contains(e.target)) {
                // If clicking on editor content (not on a line), close popup
                if (editorContent.contains(e.target)) {
                    const clickedLine = e.target.closest('.line');
                    if (!clickedLine) {
                        this.hideJsonPopup();
                    }
                } else {
                    // If clicking anywhere else outside popup, close popup
                    this.hideJsonPopup();
                }
            } else if (!popup.classList.contains('show')) {
                // If popup is not visible and clicking on empty space, add new line
                if (editorContent.contains(e.target)) {
                    const clickedLine = e.target.closest('.line');
                    if (!clickedLine) {
                        this.addNewLineAtEnd();
                    }
                }
            }
        });

        // Listen for messages from VSCode
        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.type) {
                case 'updateData':
                    this.updateData(message.data);
                    break;
            }
        });
    }

    isPreviewMode() {
        return Boolean(jsonlData && jsonlData.isPreview);
    }

    getSizeText(bytes) {
        if (bytes === 0) {
            return '0 B';
        }

        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
    }

    updatePreviewBanner() {
        const banner = document.getElementById('previewBanner');
        const bannerText = document.getElementById('previewBannerText');
        const loadMoreButton = document.getElementById('loadMoreButton');
        const loadAllButton = document.getElementById('loadAllButton');
        const shouldShowPreviewBanner = Boolean(jsonlData && jsonlData.isPreview && jsonlData.hasMoreContent);

        if (!shouldShowPreviewBanner) {
            banner.classList.add('hidden');
            return;
        }

        const loadedSizeText = this.getSizeText(jsonlData?.loadedBytes ?? 0);
        const fileSizeText = jsonlData?.fileSize ? ` Total file size: ${jsonlData.fileSize}.` : '';
        bannerText.textContent = `Currently previewing up to ${loadedSizeText}.${fileSizeText} Use the buttons to load 1MB more at a time or load the entire file. Editing is disabled in preview mode.`;
        loadMoreButton.disabled = false;
        loadMoreButton.textContent = 'Load 1MB More';
        loadAllButton.disabled = false;
        loadAllButton.textContent = 'Load All';
        banner.classList.remove('hidden');
    }

    ensureFullLoad(actionLabel = 'edit') {
        if (!this.isPreviewMode()) {
            return true;
        }

        alert(`This file is still in 1MB preview mode. To ${actionLabel}, load the rest of the file using "Load 1MB More" or "Load All".`);
        return false;
    }

    loadMoreContent(button) {
        if (!this.isPreviewMode()) {
            return;
        }

        const loadAllButton = document.getElementById('loadAllButton');
        button.disabled = true;
        button.textContent = 'Loading...';
        loadAllButton.disabled = true;
        this.vscode.postMessage({
            command: 'loadMoreJsonl'
        });
    }

    loadAllContent(button) {
        if (!this.isPreviewMode()) {
            return;
        }

        const loadMoreButton = document.getElementById('loadMoreButton');
        button.disabled = true;
        button.textContent = 'Loading...';
        loadMoreButton.disabled = true;
        this.vscode.postMessage({
            command: 'loadAllJsonl'
        });
    }

    renderJsonlLines() {
        const container = document.getElementById('editorContent');
        container.innerHTML = '';

        if (!jsonlData || !jsonlData.lines) {
            container.innerHTML = '<div class="line"><div class="line-number">1</div><div class="line-content">Unable to load JSONL data.</div></div>';
            return;
        }

        // Clear selection when re-rendering
        this.selectedLines.clear();
        this.lastSelectedLine = null;
        this.isMultiSelecting = false;

        // Re-number lines sequentially
        jsonlData.lines.forEach((line, index) => {
            line.lineNumber = index + 1;
            const lineElement = this.createLineElement(line);
            container.appendChild(lineElement);
        });
    }

    createLineElement(line) {
        const lineDiv = document.createElement('div');
        lineDiv.className = `line ${line.isValid ? 'valid' : 'invalid'}`;
        lineDiv.dataset.lineNumber = line.lineNumber;

        // Add click event for line selection (only when clicking on line background, not textarea)
        lineDiv.addEventListener('click', (e) => {
            // Only handle line selection if not clicking on textarea
            if (e.target !== lineContent) {
                e.preventDefault();
                e.stopPropagation();
                this.handleLineClick(line.lineNumber, e.shiftKey, e.ctrlKey || e.metaKey);
            }
        });

        // Add context menu event for right-click
        lineDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Only show context menu if not editing and there are selected lines
            if (!this.editingLine && this.selectedLines.size > 0) {
                this.showContextMenu(e.clientX, e.clientY);
            }
        });

        // Line number
        const lineNumber = document.createElement('div');
        lineNumber.className = 'line-number';
        lineNumber.textContent = line.lineNumber;
        lineNumber.title = 'Line selection (Shift: range, Ctrl: individual) | Drag to reorder';
        lineNumber.draggable = !this.isPreviewMode();
        
        // Add click event to line number for selection
        lineNumber.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleLineClick(line.lineNumber, e.shiftKey, e.ctrlKey || e.metaKey);
        });

        // Add drag events to line number
        lineNumber.addEventListener('dragstart', (e) => {
            this.handleDragStart(e, line.lineNumber, lineDiv);
        });

        lineNumber.addEventListener('dragend', (e) => {
            this.handleDragEnd(e);
        });

        // Line content (editable)
        const lineContentWrapper = document.createElement('div');
        lineContentWrapper.className = 'line-content-wrapper';

        const lineHighlight = document.createElement('div');
        lineHighlight.className = 'line-highlight';
        lineHighlight.dataset.lineNumber = line.lineNumber;
        lineHighlight.innerHTML = this.renderLineSyntax(line.content, line.isValid);
        lineHighlight.title = this.isPreviewMode() ? '' : 'Click to edit';
        lineHighlight.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startEditing(lineContent, line.lineNumber);
        });

        const lineContent = document.createElement('textarea');
        lineContent.className = 'line-content';
        lineContent.value = line.content;
        lineContent.dataset.lineNumber = line.lineNumber;
        lineContent.style.cursor = this.isPreviewMode() ? 'not-allowed' : 'text';
        lineContent.readOnly = this.isPreviewMode();

        // Add edit event listeners
        lineContent.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        lineContent.addEventListener('blur', () => {
            this.finishEditing(lineContent, line.lineNumber);
        });

        lineContent.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.finishEditing(lineContent, line.lineNumber);
            } else if (e.key === 'Escape') {
                this.cancelEditing(lineContent, line.lineNumber);
            } else if (e.key === 'Delete' && e.ctrlKey) {
                e.preventDefault();
                this.deleteLine(line.lineNumber);
            }
        });

        lineContent.addEventListener('input', () => {
            this.updateLineHighlighting(lineContent, line.lineNumber);
        });

        lineContent.addEventListener('paste', (e) => {
            this.handlePaste(e, lineContent, line.lineNumber);
        });

        // Add drop events to line
        lineDiv.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleDragOver(e);
        });

        lineDiv.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        lineDiv.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleDrop(e, line.lineNumber);
        });

        lineContentWrapper.appendChild(lineHighlight);
        lineContentWrapper.appendChild(lineContent);

        lineDiv.appendChild(lineNumber);
        lineDiv.appendChild(lineContentWrapper);

        // Add hover event for JSON popup
        if (line.isValid && line.parsedJson) {
            lineDiv.addEventListener('mouseenter', () => {
                // Don't show popup if multiple lines are selected
                if (this.isMultiSelecting) return;
                
                // Clear any existing timeout
                if (this.currentHoverTimeout) {
                    clearTimeout(this.currentHoverTimeout);
                }
                
                this.currentHoverTimeout = setTimeout(() => {
                    this.updateJsonPopup(line.parsedJson, line.lineNumber, lineDiv);
                }, 200); // 200ms delay
            });

            lineDiv.addEventListener('mouseleave', () => {
                if (this.currentHoverTimeout) {
                    clearTimeout(this.currentHoverTimeout);
                    this.currentHoverTimeout = null;
                }
            });
        }

        return lineDiv;
    }

    renderLineSyntax(content, isValid) {
        const escapedContent = this.escapeHtml(content ?? '');
        if (!escapedContent) {
            return '';
        }

        if (!isValid) {
            return escapedContent;
        }

        return escapedContent
            .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
                let cls = 'json-number';
                if (/^"/.test(match)) {
                    cls = /:$/.test(match) ? 'json-key' : 'json-string';
                } else if (/^(true|false)$/.test(match)) {
                    cls = 'json-boolean';
                } else if (match === 'null') {
                    cls = 'json-null';
                }

                return `<span class="${cls}">${match}</span>`;
            })
            .replace(/([{}[\]])/g, '<span class="json-bracket">$1</span>')
            .replace(/([,:])/g, '<span class="json-comma">$1</span>');
    }

    escapeHtml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    updateJsonPopup(jsonData, lineNumber, anchorElement) {
        const popup = document.getElementById('jsonPopup');
        const content = document.getElementById('jsonContent');
        
        // Format and highlight JSON
        const formattedJson = JSON.stringify(jsonData, null, 2);
        const highlightedJson = this.highlightJson(formattedJson);
        
        content.innerHTML = highlightedJson;
        
        // Store current line data
        this.currentLineData = { jsonData, lineNumber };
        
        // Position popup to the right of the hovered line
        this.positionPopup(popup, anchorElement);
        
        // Show popup if not already visible
        if (!popup.classList.contains('show')) {
            popup.classList.add('show');
        }
    }

    positionPopup(popup, anchorElement) {
        const popupWidth = 500;
        const popupHeight = 400;
        const margin = 20;
        const anchorRect = anchorElement?.getBoundingClientRect();
        const preferredLeft = Math.max(
            anchorRect ? anchorRect.left + 48 : this.mousePosition.x + 24,
            this.mousePosition.x + 24
        );
        let left = Math.min(preferredLeft, window.innerWidth - popupWidth - margin);
        let top = anchorRect ? anchorRect.top : this.mousePosition.y - 10;

        if (top + popupHeight > window.innerHeight - margin) {
            top = window.innerHeight - popupHeight - margin;
        }
        
        if (top < margin) {
            top = margin;
        }
        
        if (left < margin) {
            left = margin;
        }
        
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        popup.style.width = popupWidth + 'px';
        popup.style.height = popupHeight + 'px';
    }

    hideJsonPopup() {
        const popup = document.getElementById('jsonPopup');
        popup.classList.remove('show');
        this.currentLineData = null;
        this.exitPopupEditing();
    }

    startPopupEditing() {
        if (!this.currentLineData) return;
        if (!this.ensureFullLoad('edit')) return;
        
        this.isPopupEditing = true;
        this.originalJsonContent = JSON.stringify(this.currentLineData.jsonData, null, 2);
        
        // Show edit area and hide content
        const jsonContent = document.getElementById('jsonContent');
        const jsonEditArea = document.getElementById('jsonEditArea');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        
        jsonContent.classList.add('hide');
        jsonEditArea.classList.add('show');
        jsonEditArea.value = this.originalJsonContent;
        
        saveBtn.style.display = 'inline-block';
        cancelBtn.style.display = 'inline-block';
        
        // Focus and select all text
        jsonEditArea.focus();
        jsonEditArea.select();
    }

    savePopupEdit() {
        if (!this.isPopupEditing || !this.currentLineData) return;
        
        const jsonEditArea = document.getElementById('jsonEditArea');
        const editedContent = jsonEditArea.value.trim();
        
        try {
            // Validate JSON
            const parsedJson = JSON.parse(editedContent);
            const newContent = JSON.stringify(parsedJson);
            
            // Update the original line content
            const lineNumber = this.currentLineData.lineNumber;
            const lineElement = document.querySelector(`[data-line-number="${lineNumber}"] .line-content`);
            
            if (lineElement) {
                lineElement.value = newContent;
                this.updateLineHighlighting(lineElement, lineNumber);
                
                // Update jsonlData with new content
                const lineIndex = jsonlData.lines.findIndex(line => line.lineNumber === lineNumber);
                if (lineIndex !== -1) {
                    jsonlData.lines[lineIndex].content = newContent;
                    jsonlData.lines[lineIndex].isValid = true;
                    jsonlData.lines[lineIndex].parsedJson = parsedJson;
                }
                
                // Update the document
                this.updateDocument(lineNumber, newContent);
                
                // Update current line data
                this.currentLineData.jsonData = parsedJson;
                
                // Update popup content
                const formattedJson = JSON.stringify(parsedJson, null, 2);
                const highlightedJson = this.highlightJson(formattedJson);
                document.getElementById('jsonContent').innerHTML = highlightedJson;
            }
            
            this.exitPopupEditing();
            
        } catch (error) {
            // Show error message (you could add a toast notification here)
            alert('Invalid JSON format: ' + error.message);
        }
    }

    cancelPopupEdit() {
        this.exitPopupEditing();
    }

    exitPopupEditing() {
        this.isPopupEditing = false;
        this.originalJsonContent = '';
        
        // Show content and hide edit area
        const jsonContent = document.getElementById('jsonContent');
        const jsonEditArea = document.getElementById('jsonEditArea');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        
        jsonContent.classList.remove('hide');
        jsonEditArea.classList.remove('show');
        
        saveBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
    }

    updateData(newData) {
        const parsedData = typeof newData === 'string' ? JSON.parse(newData) : newData;
        window.jsonlData = parsedData;
        jsonlData = window.jsonlData;
        this.updatePreviewBanner();
        this.renderJsonlLines();
    }

    startEditing(textarea, lineNumber) {
        if (!this.ensureFullLoad('edit')) {
            return;
        }

        if (this.editingLine && this.editingLine !== lineNumber) {
            const previousTextarea = document.querySelector(`[data-line-number="${this.editingLine}"] .line-content`);
            if (previousTextarea) {
                this.finishEditing(previousTextarea, this.editingLine);
            }
        }
        
        // Clear selection when starting to edit
        this.selectedLines.clear();
        this.lastSelectedLine = null;
        this.isMultiSelecting = false;
        this.updateLineSelectionStyles();
        
        this.editingLine = lineNumber;
        textarea.closest('.line-content-wrapper')?.classList.add('editing');
        textarea.classList.add('editing');
        textarea.style.display = 'block';
        textarea.focus();
        textarea.select();
    }

    finishEditing(textarea, lineNumber) {
        if (!textarea) {
            console.error('❌ Textarea is null in finishEditing');
            return;
        }
        
        const newContent = textarea.value;
        textarea.closest('.line-content-wrapper')?.classList.remove('editing');
        textarea.classList.remove('editing');
        textarea.style.display = 'none';
        
        // If content is empty, delete the line
        if (!newContent.trim()) {
            this.deleteLine(lineNumber);
            return;
        }
        
        // Validate JSON if it's not empty
        let isValid = false;
        let parsedJson = null;
        if (newContent.trim()) {
            try {
                parsedJson = JSON.parse(newContent);
                textarea.parentElement.classList.remove('invalid');
                textarea.parentElement.classList.add('valid');
                isValid = true;
            } catch (error) {
                textarea.parentElement.classList.remove('valid');
                textarea.parentElement.classList.add('invalid');
                isValid = false;
            }
        }

        // Update jsonlData with new content
        const lineIndex = jsonlData.lines.findIndex(line => line.lineNumber === lineNumber);
        if (lineIndex !== -1) {
            jsonlData.lines[lineIndex].content = newContent;
            jsonlData.lines[lineIndex].isValid = isValid;
            jsonlData.lines[lineIndex].parsedJson = parsedJson;
        }

        this.updateLineSyntaxView(textarea, newContent, isValid);

        // Update the document
        this.updateDocument(lineNumber, newContent);
        this.editingLine = null;
    }

    cancelEditing(textarea, lineNumber) {
        // Restore original content
        const originalLine = jsonlData.lines.find(line => line.lineNumber === lineNumber);
        if (originalLine) {
            textarea.value = originalLine.content;
        }
        this.updateLineSyntaxView(textarea, textarea.value, originalLine?.isValid ?? false);
        textarea.closest('.line-content-wrapper')?.classList.remove('editing');
        textarea.classList.remove('editing');
        textarea.style.display = 'none';
        this.editingLine = null;
    }

    updateLineHighlighting(textarea, lineNumber) {
        const content = textarea.value;
        let isValid = false;
        let parsedJson = null;
        
        if (content.trim()) {
            try {
                parsedJson = JSON.parse(content);
                textarea.parentElement.classList.remove('invalid');
                textarea.parentElement.classList.add('valid');
                isValid = true;
            } catch (error) {
                textarea.parentElement.classList.remove('valid');
                textarea.parentElement.classList.add('invalid');
                isValid = false;
            }
        } else {
            textarea.parentElement.classList.remove('valid', 'invalid');
        }
        
        // Update jsonlData in real-time
        const lineIndex = jsonlData.lines.findIndex(line => line.lineNumber === lineNumber);
        if (lineIndex !== -1) {
            jsonlData.lines[lineIndex].content = content;
            jsonlData.lines[lineIndex].isValid = isValid;
            jsonlData.lines[lineIndex].parsedJson = parsedJson;
        }

        this.updateLineSyntaxView(textarea, content, isValid);
    }

    updateLineSyntaxView(textarea, content, isValid) {
        const wrapper = textarea.closest('.line-content-wrapper');
        const highlight = wrapper?.querySelector('.line-highlight');
        if (highlight) {
            highlight.innerHTML = this.renderLineSyntax(content, isValid);
        }
    }

    deleteLine(lineNumber) {
        if (!this.ensureFullLoad('delete')) {
            return;
        }

        console.log('🗑️ Deleting single line:', lineNumber);
        
        // Remove line from jsonlData
        const lineIndex = jsonlData.lines.findIndex(line => line.lineNumber === lineNumber);
        if (lineIndex !== -1) {
            jsonlData.lines.splice(lineIndex, 1);
            console.log('✅ Removed line', lineNumber, 'at index', lineIndex);
        }
        
        // Re-render all lines to update line numbers
        this.renderJsonlLines();
        
        // Save the entire document instead of sending individual delete messages
        // This avoids line number synchronization issues
        this.saveEntireDocument();
    }

    handlePaste(event, textarea, lineNumber) {
        event.preventDefault();
        
        const clipboardData = event.clipboardData || window.clipboardData;
        const pastedText = clipboardData.getData('text');
        
        // Check if pasted text contains multiple JSON objects (JSONL format)
        const lines = pastedText.split('\n').filter(line => line.trim());
        
        if (lines.length > 1) {
            // Multiple lines detected - treat as JSONL format
            this.handleJsonlPaste(lines, textarea, lineNumber);
        } else {
            // Single line - normal paste behavior
            this.insertTextAtCursor(textarea, pastedText);
        }
    }

    handleJsonlPaste(jsonLines, textarea, currentLineNumber) {
        const validJsonLines = [];
        const invalidLines = [];
        
        // Validate each line as JSON
        jsonLines.forEach((line, index) => {
            const trimmedLine = line.trim();
            if (trimmedLine) {
                try {
                    JSON.parse(trimmedLine);
                    validJsonLines.push(trimmedLine);
                } catch (error) {
                    invalidLines.push({ line: trimmedLine, index: index + 1 });
                }
            }
        });
        
        if (invalidLines.length > 0) {
            // Show warning about invalid JSON lines
            const invalidLineNumbers = invalidLines.map(item => item.index).join(', ');
            alert(`Warning: ${invalidLines.length} invalid JSON line(s) found (lines: ${invalidLineNumbers}). Only valid JSON lines will be added.`);
        }
        
        if (validJsonLines.length > 0) {
            // Get current cursor position
            const cursorPosition = textarea.selectionStart;
            const currentContent = textarea.value;
            const beforeCursor = currentContent.substring(0, cursorPosition);
            const afterCursor = currentContent.substring(cursorPosition);
            
            // If current line is empty, replace it with first JSON line
            if (!currentContent.trim()) {
                textarea.value = validJsonLines[0];
                this.updateLineHighlighting(textarea, currentLineNumber);
                
                // Add remaining lines as new lines
                if (validJsonLines.length > 1) {
                    this.addNewLines(validJsonLines.slice(1), currentLineNumber);
                }
            } else {
                // Insert first JSON line at cursor position
                const newContent = beforeCursor + validJsonLines[0] + afterCursor;
                textarea.value = newContent;
                this.updateLineHighlighting(textarea, currentLineNumber);
                
                // Add remaining lines as new lines
                if (validJsonLines.length > 1) {
                    this.addNewLines(validJsonLines.slice(1), currentLineNumber);
                }
            }
            
            // Update the document
            this.saveEntireDocument();
        }
    }

    addNewLines(jsonLines, afterLineNumber) {
        // Find the current line index
        const currentLineIndex = jsonlData.lines.findIndex(line => line.lineNumber === afterLineNumber);
        
        console.log('🔍 addNewLines called:', {
            jsonLines: jsonLines,
            afterLineNumber: afterLineNumber,
            currentLineIndex: currentLineIndex,
            totalLines: jsonlData.lines.length
        });
        
        if (currentLineIndex !== -1) {
            // Create new line objects
            const newLines = jsonLines.map((content, index) => {
                try {
                    const parsedJson = JSON.parse(content);
                    return {
                        lineNumber: afterLineNumber + index + 1, // Will be renumbered later
                        content: content,
                        isValid: true,
                        parsedJson: parsedJson
                    };
                } catch (error) {
                    return {
                        lineNumber: afterLineNumber + index + 1, // Will be renumbered later
                        content: content,
                        isValid: false,
                        parsedJson: null
                    };
                }
            });
            
            // Insert new lines after current line
            jsonlData.lines.splice(currentLineIndex + 1, 0, ...newLines);
            
            // Re-render to update line numbers
            this.renderJsonlLines();
            
            // Save the entire document instead of inserting individual lines
            // This avoids line number synchronization issues
            this.saveEntireDocument();
        }
    }

    insertTextAtCursor(textarea, text) {
        const cursorPosition = textarea.selectionStart;
        const currentContent = textarea.value;
        const beforeCursor = currentContent.substring(0, cursorPosition);
        const afterCursor = currentContent.substring(cursorPosition);
        
        textarea.value = beforeCursor + text + afterCursor;
        
        // Set cursor position after inserted text
        const newCursorPosition = cursorPosition + text.length;
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
    }

    handleLineClick(lineNumber, isShiftKey, isCtrlKey) {
        if (isShiftKey && this.lastSelectedLine !== null) {
            // Range selection with Shift key
            this.selectLineRange(this.lastSelectedLine, lineNumber);
        } else if (isCtrlKey) {
            // Toggle selection with Ctrl key
            this.toggleLineSelection(lineNumber);
        } else {
            // Single selection
            this.selectSingleLine(lineNumber);
        }
        
        this.lastSelectedLine = lineNumber;
        this.updateLineSelectionStyles();
    }

    selectSingleLine(lineNumber) {
        this.selectedLines.clear();
        this.selectedLines.add(lineNumber);
        this.isMultiSelecting = false;
        
        // Hide popup when selecting single line (will be shown on hover if valid JSON)
        this.hideJsonPopup();
    }

    selectLineRange(startLine, endLine) {
        const start = Math.min(startLine, endLine);
        const end = Math.max(startLine, endLine);
        
        this.selectedLines.clear();
        for (let i = start; i <= end; i++) {
            this.selectedLines.add(i);
        }
        this.isMultiSelecting = this.selectedLines.size > 1;
        
        // Hide popup when multiple lines are selected
        if (this.isMultiSelecting) {
            this.hideJsonPopup();
        }
    }

    toggleLineSelection(lineNumber) {
        if (this.selectedLines.has(lineNumber)) {
            this.selectedLines.delete(lineNumber);
        } else {
            this.selectedLines.add(lineNumber);
        }
        this.isMultiSelecting = this.selectedLines.size > 1;
        
        // Hide popup when multiple lines are selected
        if (this.isMultiSelecting) {
            this.hideJsonPopup();
        }
    }

    updateLineSelectionStyles() {
        // Remove all selection styles
        document.querySelectorAll('.line').forEach(line => {
            line.classList.remove('selected', 'in-range');
        });

        // Add selection styles
        this.selectedLines.forEach(lineNumber => {
            const lineElement = document.querySelector(`[data-line-number="${lineNumber}"]`);
            if (lineElement) {
                if (lineNumber === this.lastSelectedLine) {
                    lineElement.classList.add('selected');
                } else {
                    lineElement.classList.add('in-range');
                }
            }
        });
        
        // Hide popup if no lines are selected or multiple lines are selected
        if (this.selectedLines.size === 0 || this.isMultiSelecting) {
            this.hideJsonPopup();
        }
    }

    deleteSelectedLines() {
        if (!this.ensureFullLoad('delete')) {
            return;
        }

        if (this.selectedLines.size === 0) return;

        console.log('🗑️ Deleting selected lines:', Array.from(this.selectedLines));

        // Get line numbers as array and sort in descending order to avoid index shifting issues
        const lineNumbers = Array.from(this.selectedLines).sort((a, b) => b - a);
        
        // Remove lines from jsonlData (from highest to lowest index)
        lineNumbers.forEach(lineNumber => {
            const lineIndex = jsonlData.lines.findIndex(line => line.lineNumber === lineNumber);
            if (lineIndex !== -1) {
                jsonlData.lines.splice(lineIndex, 1);
                console.log('✅ Removed line', lineNumber, 'at index', lineIndex);
            }
        });

        // Clear selection
        this.selectedLines.clear();
        this.lastSelectedLine = null;
        this.isMultiSelecting = false;

        // Re-render all lines to update line numbers
        this.renderJsonlLines();

        // Save the entire document instead of sending individual delete messages
        // This avoids line number synchronization issues
        this.saveEntireDocument();
    }

    addNewLineAtEnd() {
        if (!this.ensureFullLoad('add')) {
            return;
        }

        // Create new empty line
        const newLineNumber = jsonlData.lines.length + 1;
        const newLine = {
            lineNumber: newLineNumber,
            content: '',
            isValid: false,
            parsedJson: null
        };
        
        // Add to jsonlData
        jsonlData.lines.push(newLine);
        
        // Re-render all lines to update line numbers
        this.renderJsonlLines();
        
        // Save the entire document instead of inserting individual lines
        // This avoids line number synchronization issues
        this.saveEntireDocument();
        
        // Focus on the new line and start editing
        setTimeout(() => {
            const newLineElement = document.querySelector(`[data-line-number="${newLineNumber}"] .line-content`);
            if (newLineElement) {
                this.startEditing(newLineElement, newLineNumber);
            }
        }, 100);
    }

    updateDocument(lineNumber, newContent) {
        // Find the actual line index in the data array
        const lineIndex = jsonlData.lines.findIndex(line => line.lineNumber === lineNumber);
        if (lineIndex === -1) {
            console.error('❌ Line not found in data:', lineNumber);
            return;
        }
        
        console.log('📝 Updating document:', {
            displayLineNumber: lineNumber,
            actualLineIndex: lineIndex,
            content: newContent,
            totalLines: jsonlData.lines.length
        });
        
        // Instead of updating individual lines, let's save the entire document
        // This avoids line number synchronization issues
        this.saveEntireDocument();
    }
    
    saveEntireDocument() {
        // Convert all lines to a single string
        const allContent = jsonlData.lines.map(line => line.content).join('\n');
        
        console.log('💾 Saving entire document:', {
            totalLines: jsonlData.lines.length,
            contentLength: allContent.length
        });
        
        // Send message to VSCode to save the entire document
        this.vscode.postMessage({
            type: 'saveChanges',
            data: {
                content: allContent
            }
        });
    }

    highlightJson(jsonString) {
        // Enhanced JSON syntax highlighting
        return jsonString
            .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
                let cls = 'json-number';
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'json-key';
                    } else {
                        cls = 'json-string';
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'json-boolean';
                } else if (/null/.test(match)) {
                    cls = 'json-null';
                }
                return '<span class="' + cls + '">' + match + '</span>';
            })
            .replace(/([{}[\]])/g, '<span class="json-bracket">$1</span>')
            .replace(/([,:])/g, '<span class="json-comma">$1</span>');
    }

    // Drag and Drop Methods
    handleDragStart(e, lineNumber, lineElement) {
        if (!this.ensureFullLoad('reorder')) {
            e.preventDefault();
            return;
        }

        this.draggedLine = lineNumber;
        this.dragStartY = e.clientY;
        this.isDragging = true;
        
        // Create drag preview
        this.dragPreview = lineElement.cloneNode(true);
        this.dragPreview.style.position = 'absolute';
        this.dragPreview.style.top = '-1000px';
        this.dragPreview.style.opacity = '0.5';
        this.dragPreview.style.pointerEvents = 'none';
        this.dragPreview.style.zIndex = '1000';
        document.body.appendChild(this.dragPreview);
        
        // Set drag data
        e.dataTransfer.setData('text/plain', lineNumber.toString());
        e.dataTransfer.effectAllowed = 'move';
        
        // Add dragging class to original line
        lineElement.classList.add('dragging');
        
        console.log('🚀 Drag started for line:', lineNumber);
    }

    handleDragEnd(e) {
        // Clean up
        if (this.dragPreview) {
            document.body.removeChild(this.dragPreview);
            this.dragPreview = null;
        }
        
        // Remove dragging class from all lines
        document.querySelectorAll('.line').forEach(line => {
            line.classList.remove('dragging', 'drag-over');
        });
        
        this.isDragging = false;
        this.draggedLine = null;
        
        console.log('🏁 Drag ended');
    }

    handleDragOver(e) {
        e.dataTransfer.dropEffect = 'move';
        
        // Remove drag-over class from all lines first
        document.querySelectorAll('.line').forEach(line => {
            line.classList.remove('drag-over');
        });
        
        // Add visual feedback only to the current target line
        const lineElement = e.currentTarget;
        if (lineElement.dataset.lineNumber !== this.draggedLine?.toString()) {
            lineElement.classList.add('drag-over');
        }
        
        console.log('🔄 Drag over line:', lineElement.dataset.lineNumber);
    }

    handleDrop(e, targetLineNumber) {
        e.preventDefault();
        if (!this.ensureFullLoad('reorder')) {
            return;
        }
        
        console.log('📦 Drop event triggered on line:', targetLineNumber);
        
        const draggedLineNumber = parseInt(e.dataTransfer.getData('text/plain'));
        const targetLine = parseInt(targetLineNumber);
        
        console.log('📦 Drop data:', { draggedLineNumber, targetLine });
        
        if (draggedLineNumber === targetLine) {
            console.log('⚠️ Same line, no action needed');
            return;
        }
        
        console.log('📦 Drop:', draggedLineNumber, '->', targetLine);
        
        // Move the line in the data
        this.moveLine(draggedLineNumber, targetLine);
        
        // Remove drag-over class
        e.currentTarget.classList.remove('drag-over');
    }

    moveLine(fromLineNumber, toLineNumber) {
        // Find indices in the data array
        const fromIndex = window.jsonlData.lines.findIndex(line => line.lineNumber === fromLineNumber);
        const toIndex = window.jsonlData.lines.findIndex(line => line.lineNumber === toLineNumber);
        
        if (fromIndex === -1 || toIndex === -1) {
            console.error('❌ Line not found:', { fromLineNumber, toLineNumber, fromIndex, toIndex });
            return;
        }
        
        // Remove the line from its current position
        const [movedLine] = window.jsonlData.lines.splice(fromIndex, 1);
        
        // Insert it at the new position
        window.jsonlData.lines.splice(toIndex, 0, movedLine);
        
        console.log('✅ Line moved:', {
            from: fromLineNumber,
            to: toLineNumber,
            fromIndex,
            toIndex,
            totalLines: window.jsonlData.lines.length
        });
        
        // Re-render to update line numbers and save
        this.renderJsonlLines();
        this.saveEntireDocument();
    }
}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new JsonlViewer();
});
