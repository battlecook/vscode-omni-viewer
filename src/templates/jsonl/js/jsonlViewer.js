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
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderJsonlLines();
        this.setupVSCodeAPI();
        this.setupContextMenu();
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
        // Track mouse position
        document.addEventListener('mousemove', (e) => {
            this.mousePosition.x = e.clientX;
            this.mousePosition.y = e.clientY;
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

    renderJsonlLines() {
        const container = document.getElementById('editorContent');
        container.innerHTML = '';

        if (!jsonlData || !jsonlData.lines) {
            container.innerHTML = '<div class="line"><div class="line-number">1</div><div class="line-content">JSONL 데이터를 불러올 수 없습니다.</div></div>';
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
        lineNumber.title = '라인 선택 (Shift: 범위 선택, Ctrl: 개별 선택)';
        
        // Add click event to line number for selection
        lineNumber.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleLineClick(line.lineNumber, e.shiftKey, e.ctrlKey || e.metaKey);
        });

        // Line content (editable)
        const lineContent = document.createElement('textarea');
        lineContent.className = 'line-content';
        lineContent.value = line.content;
        lineContent.dataset.lineNumber = line.lineNumber;
        lineContent.style.cursor = 'text';

        // Add edit event listeners
        lineContent.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startEditing(lineContent, line.lineNumber);
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

        lineDiv.appendChild(lineNumber);
        lineDiv.appendChild(lineContent);

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
                    this.updateJsonPopup(line.parsedJson, line.lineNumber);
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

    updateJsonPopup(jsonData, lineNumber) {
        const popup = document.getElementById('jsonPopup');
        const content = document.getElementById('jsonContent');
        
        // Format and highlight JSON
        const formattedJson = JSON.stringify(jsonData, null, 2);
        const highlightedJson = this.highlightJson(formattedJson);
        
        content.innerHTML = highlightedJson;
        
        // Store current line data
        this.currentLineData = { jsonData, lineNumber };
        
        // Position popup near mouse cursor
        this.positionPopup(popup);
        
        // Show popup if not already visible
        if (!popup.classList.contains('show')) {
            popup.classList.add('show');
        }
    }

    positionPopup(popup) {
        const popupWidth = 500;
        const popupHeight = 400;
        const margin = 20;
        
        let left = this.mousePosition.x + 15;
        let top = this.mousePosition.y - 10;
        
        // Adjust if popup would go off screen
        if (left + popupWidth > window.innerWidth - margin) {
            left = this.mousePosition.x - popupWidth - 15;
        }
        
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
            alert('유효하지 않은 JSON 형식입니다: ' + error.message);
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
        const parsedData = JSON.parse(newData);
        jsonlData.lines = parsedData.lines;
        this.renderJsonlLines();
    }

    startEditing(textarea, lineNumber) {
        if (this.editingLine && this.editingLine !== lineNumber) {
            this.finishEditing(document.querySelector(`[data-line-number="${this.editingLine}"]`), this.editingLine);
        }
        
        // Clear selection when starting to edit
        this.selectedLines.clear();
        this.lastSelectedLine = null;
        this.isMultiSelecting = false;
        this.updateLineSelectionStyles();
        
        this.editingLine = lineNumber;
        textarea.classList.add('editing');
        textarea.focus();
        textarea.select();
    }

    finishEditing(textarea, lineNumber) {
        const newContent = textarea.value;
        textarea.classList.remove('editing');
        
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
        textarea.classList.remove('editing');
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
    }

    deleteLine(lineNumber) {
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
            alert(`경고: ${invalidLines.length}개의 유효하지 않은 JSON 라인이 있습니다 (라인: ${invalidLineNumbers}). 유효한 JSON 라인만 추가됩니다.`);
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
}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new JsonlViewer();
});
