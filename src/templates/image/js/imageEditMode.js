export class ImageEditMode {
    constructor(image, imageWrapper) {
        this.image = image;
        this.imageWrapper = imageWrapper;
        
        // Edit Mode Variables
        this.isEditMode = false;
        this.currentTool = 'select';
        this.selectedElement = null;
        this.elements = [];
        this.nextElementId = 1;
        
        // Edit Mode DOM Elements
        this.toggleEditModeBtn = document.getElementById('toggleEditMode');
        this.editControls = document.getElementById('editControls');
        this.editCanvas = document.getElementById('editCanvas');
        this.addTextBtn = document.getElementById('addText');
        this.addCircleBtn = document.getElementById('addCircle');
        this.addRectangleBtn = document.getElementById('addRectangle');
        this.selectToolBtn = document.getElementById('selectTool');
        this.deleteSelectedBtn = document.getElementById('deleteSelected');
        this.editProperties = document.getElementById('editProperties');
        this.shapeColor = document.getElementById('shapeColor');
        this.borderColor = document.getElementById('borderColor');
        this.fillOpacity = document.getElementById('fillOpacity');
        this.borderOpacity = document.getElementById('borderOpacity');
        this.fillOpacityValue = document.getElementById('fillOpacityValue');
        this.borderOpacityValue = document.getElementById('borderOpacityValue');
        this.shapeSize = document.getElementById('shapeSize');
        this.textInput = document.getElementById('textInput');
        this.fontSize = document.getElementById('fontSize');
        this.fontSizeInput = document.getElementById('fontSizeInput');
    }
    
    setupEventListeners() {
        console.log('Setting up edit mode event listeners...');
        
        // Check if elements exist
        console.log('addTextBtn:', this.addTextBtn);
        console.log('addCircleBtn:', this.addCircleBtn);
        console.log('addRectangleBtn:', this.addRectangleBtn);
        console.log('editCanvas:', this.editCanvas);
        
        if (this.addTextBtn) {
            this.addTextBtn.addEventListener('click', () => {
                console.log('Text button clicked');
                this.setTool('text');
                if (this.onLogMessage) {
                    this.onLogMessage('Text tool selected');
                }
            });
        }
        
        if (this.addCircleBtn) {
            this.addCircleBtn.addEventListener('click', () => {
                console.log('Circle button clicked');
                this.setTool('circle');
                if (this.onLogMessage) {
                    this.onLogMessage('Circle tool selected');
                }
            });
        }
        
        if (this.addRectangleBtn) {
            this.addRectangleBtn.addEventListener('click', () => {
                console.log('Rectangle button clicked');
                this.setTool('rectangle');
                if (this.onLogMessage) {
                    this.onLogMessage('Rectangle tool selected');
                }
            });
        }
        
        if (this.selectToolBtn) {
            this.selectToolBtn.addEventListener('click', () => {
                console.log('Select button clicked');
                this.setTool('select');
                if (this.onLogMessage) {
                    this.onLogMessage('Select tool selected');
                }
            });
        }
        
        if (this.deleteSelectedBtn) {
            this.deleteSelectedBtn.addEventListener('click', () => this.deleteSelectedElement());
        }
        
        // Property change listeners
        if (this.shapeColor) {
            this.shapeColor.addEventListener('change', () => this.updateSelectedElement());
        }
        if (this.borderColor) {
            this.borderColor.addEventListener('change', () => this.updateSelectedElement());
        }
        if (this.fillOpacity) {
            this.fillOpacity.addEventListener('input', (e) => {
                if (this.fillOpacityValue) {
                    this.fillOpacityValue.textContent = e.target.value + '%';
                }
                this.updateSelectedElement();
            });
        }
        if (this.borderOpacity) {
            this.borderOpacity.addEventListener('input', (e) => {
                if (this.borderOpacityValue) {
                    this.borderOpacityValue.textContent = e.target.value + '%';
                }
                this.updateSelectedElement();
            });
        }
        if (this.shapeSize) {
            this.shapeSize.addEventListener('input', () => this.updateSelectedElement());
        }
        if (this.textInput) {
            this.textInput.addEventListener('input', () => this.updateSelectedElement());
        }
        if (this.fontSize) {
            this.fontSize.addEventListener('input', (e) => {
                if (this.fontSizeInput) {
                    this.fontSizeInput.value = e.target.value;
                }
                this.updateSelectedElement();
            });
        }
        if (this.fontSizeInput) {
            this.fontSizeInput.addEventListener('input', (e) => {
                if (this.fontSize) {
                    this.fontSize.value = e.target.value;
                }
                this.updateSelectedElement();
            });
        }
        
        // Canvas event listeners
        if (this.editCanvas) {
            this.editCanvas.addEventListener('click', (e) => this.handleCanvasClick(e));
            console.log('Canvas click listener added');
        }
        
        console.log('Edit mode event listeners setup complete');
    }
    
    setupEditCanvas() {
        // Wait for image to be fully loaded and positioned
        setTimeout(() => {
            const rect = this.image.getBoundingClientRect();
            const wrapperRect = this.imageWrapper.getBoundingClientRect();
            
            console.log('Image rect:', rect);
            console.log('Wrapper rect:', wrapperRect);
            console.log('Image natural size:', this.image.naturalWidth, 'x', this.image.naturalHeight);
            console.log('Image offset size:', this.image.offsetWidth, 'x', this.image.offsetHeight);
            
            // Use the actual displayed image size
            const canvasWidth = rect.width;
            const canvasHeight = rect.height;
            
            this.editCanvas.style.width = canvasWidth + 'px';
            this.editCanvas.style.height = canvasHeight + 'px';
            this.editCanvas.style.left = rect.left - wrapperRect.left + 'px';
            this.editCanvas.style.top = rect.top - wrapperRect.top + 'px';
            
            vscode.postMessage({ command: 'log', text: `Canvas setup: ${canvasWidth}x${canvasHeight} at (${rect.left - wrapperRect.left}, ${rect.top - wrapperRect.top})` });
            
            // Re-render all elements
            this.elements.forEach(element => {
                const existingElement = document.querySelector(`[data-element-id="${element.id}"]`);
                if (existingElement) {
                    existingElement.remove();
                }
                this.renderElement(element);
            });
            
            // Ensure canvas is visible and clickable
            this.editCanvas.style.pointerEvents = 'auto';
            this.editCanvas.style.zIndex = '9999';
            
            console.log('Canvas final setup:', {
                styleWidth: this.editCanvas.style.width,
                styleHeight: this.editCanvas.style.height,
                styleLeft: this.editCanvas.style.left,
                styleTop: this.editCanvas.style.top
            });
        }, 100);
    }
    
    setTool(tool) {
        console.log('Setting tool to:', tool);
        this.currentTool = tool;
        
        // Update button states
        [this.addTextBtn, this.addCircleBtn, this.addRectangleBtn, this.selectToolBtn].forEach(btn => {
            if (btn) {
                btn.classList.remove('active');
            }
        });
        
        switch (tool) {
            case 'text':
                if (this.addTextBtn) this.addTextBtn.classList.add('active');
                if (this.editCanvas) this.editCanvas.classList.remove('select-mode');
                break;
            case 'circle':
                if (this.addCircleBtn) this.addCircleBtn.classList.add('active');
                if (this.editCanvas) this.editCanvas.classList.remove('select-mode');
                break;
            case 'rectangle':
                if (this.addRectangleBtn) this.addRectangleBtn.classList.add('active');
                if (this.editCanvas) this.editCanvas.classList.remove('select-mode');
                break;
            case 'select':
                if (this.selectToolBtn) this.selectToolBtn.classList.add('active');
                if (this.editCanvas) this.editCanvas.classList.add('select-mode');
                break;
        }
        
        // Show/hide properties panel
        if (this.editProperties) {
            this.editProperties.style.display = (tool === 'select' && this.selectedElement) ? 'flex' : 'none';
        }
        
        console.log('Tool set to:', this.currentTool);
    }
    
    handleCanvasClick(e) {
        console.log('Canvas clicked!');
        console.log('isEditMode:', this.isEditMode);
        console.log('currentTool:', this.currentTool);
        
        if (!this.isEditMode) {
            console.log('Edit mode not active');
            if (this.onLogMessage) {
                this.onLogMessage('Edit mode not active');
            }
            return;
        }
        
        // Get canvas position relative to the image wrapper
        const canvasRect = this.editCanvas.getBoundingClientRect();
        const imageRect = this.image.getBoundingClientRect();
        
        console.log('Canvas rect:', canvasRect);
        console.log('Image rect:', imageRect);
        
        // Calculate position relative to canvas
        const x = e.clientX - canvasRect.left;
        const y = e.clientY - canvasRect.top;
        
        // Ensure coordinates are within canvas bounds
        if (x < 0 || x > canvasRect.width || y < 0 || y > canvasRect.height) {
            console.log('Click outside canvas bounds');
            return;
        }
        
        console.log(`Canvas click: (${x}, ${y}), tool: ${this.currentTool}`);
        if (this.onLogMessage) {
            this.onLogMessage(`Canvas click: (${x}, ${y}), tool: ${this.currentTool}, canvas rect: ${canvasRect.left},${canvasRect.top}`);
        }
        
        if (this.currentTool === 'select') {
            this.selectElementAt(x, y);
        } else {
            this.addElementAt(x, y);
        }
    }
    
    addElementAt(x, y) {
        console.log('addElementAt called with:', x, y, this.currentTool);
        
        const element = {
            id: this.nextElementId++,
            type: this.currentTool,
            x: x,
            y: y,
            color: this.shapeColor ? this.shapeColor.value || '#ff0000' : '#ff0000',
            borderColor: this.borderColor ? this.borderColor.value || '#000000' : '#000000',
            fillOpacity: this.fillOpacity ? parseInt(this.fillOpacity.value) : 100,
            borderOpacity: this.borderOpacity ? parseInt(this.borderOpacity.value) : 100,
            size: this.shapeSize ? parseInt(this.shapeSize.value) || 100 : 100,
            text: this.textInput ? this.textInput.value || 'Text' : 'Text',
            fontSize: this.fontSize ? parseInt(this.fontSize.value) || 24 : 24
        };
        
        console.log('Created element:', element);
        
        this.elements.push(element);
        console.log('Elements array:', this.elements);
        
        this.renderElement(element);
        
        // Select the newly created element
        this.selectedElement = element;
        if (this.currentTool === 'select') {
            const elementEl = document.querySelector(`[data-element-id="${element.id}"]`);
            if (elementEl) {
                elementEl.classList.add('selected');
            }
            this.updatePropertiesPanel();
        }
        
        if (this.onLogMessage) {
            this.onLogMessage(`Added ${this.currentTool} element at (${x}, ${y}), total elements: ${this.elements.length}, color: ${element.color}, size: ${element.size}`);
        }
    }
    
    selectElementAt(x, y) {
        console.log('selectElementAt called with:', x, y);
        
        // Deselect current element
        if (this.selectedElement) {
            const element = document.querySelector(`[data-element-id="${this.selectedElement.id}"]`);
            if (element) {
                element.classList.remove('selected');
                // Hide resize handles
                const handles = element.querySelectorAll('.resize-handle');
                handles.forEach(handle => handle.style.display = 'none');
            }
        }
        
        // Find element at position (reverse order to get topmost element first)
        this.selectedElement = null;
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const element = this.elements[i];
            const elementEl = document.querySelector(`[data-element-id="${element.id}"]`);
            if (!elementEl) continue;
            
            const rect = elementEl.getBoundingClientRect();
            const canvasRect = this.editCanvas.getBoundingClientRect();
            
            const isInside = x >= rect.left - canvasRect.left && 
                            x <= rect.right - canvasRect.left &&
                            y >= rect.top - canvasRect.top && 
                            y <= rect.bottom - canvasRect.top;
            
            console.log(`Element ${element.id} hit test:`, isInside);
            if (isInside) {
                this.selectedElement = element;
                break; // Found the topmost element, stop searching
            }
        }
        
        if (this.selectedElement) {
            console.log('Selected element:', this.selectedElement);
            const element = document.querySelector(`[data-element-id="${this.selectedElement.id}"]`);
            if (element) {
                element.classList.add('selected');
                // Show resize handles for rectangle
                if (this.selectedElement.type === 'rectangle') {
                    const handles = element.querySelectorAll('.resize-handle');
                    handles.forEach(handle => handle.style.display = 'block');
                }
                
                // Bring selected element to front
                this.bringElementToFront(this.selectedElement);
            }
            this.updatePropertiesPanel();
            if (this.onLogMessage) {
                this.onLogMessage(`Selected ${this.selectedElement.type} element and brought to front`);
            }
        } else {
            console.log('No element selected');
            if (this.editProperties) {
                this.editProperties.style.display = 'none';
            }
        }
    }
    
    renderElement(element) {
        console.log('renderElement called with:', element);
        
        let elementEl;
        
        if (element.type === 'text') {
            console.log('Creating text element');
            elementEl = document.createElement('div');
            elementEl.className = 'text-element';
            elementEl.textContent = element.text;
            elementEl.style.fontSize = element.fontSize + 'px';
            
            // Convert hex to rgba for text color with opacity
            const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
            const textRgba = this.hexToRgba(element.color, fillOpacity);
            elementEl.style.color = textRgba;
            
            elementEl.style.position = 'absolute';
            elementEl.style.left = element.x + 'px';
            elementEl.style.top = element.y + 'px';
            elementEl.style.transform = 'translate(-50%, -50%)';
            elementEl.style.zIndex = '10000';
            elementEl.style.pointerEvents = 'auto';
            elementEl.style.cursor = 'move';
            elementEl.style.userSelect = 'none';
        } else {
            console.log('Creating shape element:', element.type);
            elementEl = document.createElement('div');
            elementEl.className = 'shape-element';
            elementEl.style.position = 'absolute';
            elementEl.style.left = element.x + 'px';
            elementEl.style.top = element.y + 'px';
            elementEl.style.zIndex = '10000';
            elementEl.style.pointerEvents = 'auto';
            elementEl.style.cursor = 'move';
            elementEl.style.userSelect = 'none';
            
            if (element.type === 'circle') {
                elementEl.style.width = element.size + 'px';
                elementEl.style.height = element.size + 'px';
                elementEl.style.borderRadius = '50%';
                
                // Convert hex to rgba for background color with opacity
                const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
                const fillRgba = this.hexToRgba(element.color, fillOpacity);
                elementEl.style.backgroundColor = fillRgba;
                
                // Convert hex to rgba for border color with opacity
                const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
                const borderRgba = this.hexToRgba(element.borderColor || '#000000', borderOpacity);
                elementEl.style.borderColor = borderRgba;
                
                elementEl.style.transform = 'translate(-50%, -50%)';
            } else if (element.type === 'rectangle') {
                elementEl.style.width = element.size + 'px';
                elementEl.style.height = element.size + 'px';
                
                // Convert hex to rgba for background color with opacity
                const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
                const fillRgba = this.hexToRgba(element.color, fillOpacity);
                elementEl.style.backgroundColor = fillRgba;
                
                // Convert hex to rgba for border color with opacity
                const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
                const borderRgba = this.hexToRgba(element.borderColor || '#000000', borderOpacity);
                elementEl.style.borderColor = borderRgba;
                
                elementEl.style.transform = 'translate(-50%, -50%)';
                
                // Add resize handles for rectangle
                this.addResizeHandles(elementEl, element);
            }
        }
        
        elementEl.setAttribute('data-element-id', element.id);
        
        console.log('Element created:', elementEl);
        console.log('Element styles:', elementEl.style.cssText);
        
        // Add drag functionality
        this.makeElementDraggable(elementEl, element);
        
        console.log('Adding element to canvas:', this.editCanvas);
        this.editCanvas.appendChild(elementEl);
        
        console.log('Canvas children count:', this.editCanvas.children.length);
        console.log('Canvas innerHTML length:', this.editCanvas.innerHTML.length);
        
        if (this.onLogMessage) {
            this.onLogMessage(`Rendered ${element.type} element with ID ${element.id} at (${element.x}, ${element.y})`);
        }
    }
    
    makeElementDraggable(elementEl, element) {
        let isDragging = false;
        let startX, startY;
        
        elementEl.addEventListener('mousedown', (e) => {
            if (this.currentTool === 'select') {
                isDragging = true;
                startX = e.clientX - element.x;
                startY = e.clientY - element.y;
                e.stopPropagation();
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging && this.selectedElement && this.selectedElement.id === element.id) {
                element.x = e.clientX - startX;
                element.y = e.clientY - startY;
                elementEl.style.left = element.x + 'px';
                elementEl.style.top = element.y + 'px';
            }
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
        
        // Double click to edit text
        if (element.type === 'text') {
            elementEl.addEventListener('dblclick', (e) => {
                if (this.currentTool === 'select') {
                    this.makeTextEditable(elementEl, element);
                    e.stopPropagation();
                }
            });
        }
    }
    
    makeTextEditable(elementEl, element) {
        elementEl.classList.add('editing');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = element.text;
        input.style.fontSize = element.fontSize + 'px';
        input.style.color = element.color;
        
        input.addEventListener('blur', () => {
            element.text = input.value;
            elementEl.textContent = input.value;
            elementEl.classList.remove('editing');
            elementEl.removeChild(input);
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });
        
        elementEl.textContent = '';
        elementEl.appendChild(input);
        input.focus();
        input.select();
    }
    
    updatePropertiesPanel() {
        console.log('updatePropertiesPanel called');
        console.log('selectedElement:', this.selectedElement);
        console.log('editProperties:', this.editProperties);
        
        if (!this.selectedElement || !this.editProperties) {
            console.log('No selected element or editProperties not found');
            return;
        }
        
        console.log('Updating properties panel with:', {
            color: this.selectedElement.color,
            size: this.selectedElement.size,
            text: this.selectedElement.text,
            fontSize: this.selectedElement.fontSize
        });
        
        // Show/hide property groups based on element type
        const propertyGroups = this.editProperties.querySelectorAll('.property-group');
        
        propertyGroups.forEach(group => {
            const fillColorInput = group.querySelector('input[type="color"][id="shapeColor"]');
            const borderColorInput = group.querySelector('input[type="color"][id="borderColor"]');
            const borderOpacityInput = group.querySelector('input[type="range"][id="borderOpacity"]');
            const textInput = group.querySelector('input[type="text"]');
            const fontSizeInput = group.querySelector('input[type="range"][id="fontSize"]');
            
            if (fillColorInput) {
                // Always show fill color for all element types
                group.style.display = 'flex';
            } else if (borderColorInput || borderOpacityInput) {
                // Show border properties only for non-text elements
                group.style.display = this.selectedElement.type !== 'text' ? 'flex' : 'none';
            } else if (textInput || fontSizeInput) {
                // Show text-related properties only for text elements
                group.style.display = this.selectedElement.type === 'text' ? 'flex' : 'none';
            }
        });
        
        // Update values
        if (this.shapeColor) {
            this.shapeColor.value = this.selectedElement.color;
            console.log('Set shapeColor to:', this.shapeColor.value);
        }
        if (this.borderColor) {
            this.borderColor.value = this.selectedElement.borderColor || '#000000';
            console.log('Set borderColor to:', this.borderColor.value);
        }
        if (this.fillOpacity) {
            this.fillOpacity.value = this.selectedElement.fillOpacity !== undefined ? this.selectedElement.fillOpacity : 100;
            if (this.fillOpacityValue) {
                this.fillOpacityValue.textContent = (this.selectedElement.fillOpacity !== undefined ? this.selectedElement.fillOpacity : 100) + '%';
            }
            console.log('Set fillOpacity to:', this.fillOpacity.value);
        }
        if (this.borderOpacity) {
            this.borderOpacity.value = this.selectedElement.borderOpacity !== undefined ? this.selectedElement.borderOpacity : 100;
            if (this.borderOpacityValue) {
                this.borderOpacityValue.textContent = (this.selectedElement.borderOpacity !== undefined ? this.selectedElement.borderOpacity : 100) + '%';
            }
            console.log('Set borderOpacity to:', this.borderOpacity.value);
        }
        if (this.shapeSize) {
            this.shapeSize.value = this.selectedElement.size;
            console.log('Set shapeSize to:', this.shapeSize.value);
        }
        if (this.textInput && this.selectedElement.type === 'text') {
            this.textInput.value = this.selectedElement.text || '';
            console.log('Set textInput to:', this.textInput.value);
        }
        if (this.fontSize && this.selectedElement.type === 'text') {
            this.fontSize.value = this.selectedElement.fontSize || 24;
            if (this.fontSizeInput) {
                this.fontSizeInput.value = this.selectedElement.fontSize || 24;
            }
            console.log('Set fontSize to:', this.fontSize.value);
        }
        
        this.editProperties.style.display = 'flex';
        console.log('Properties panel displayed');
        
        if (this.onLogMessage) {
            this.onLogMessage(`Properties panel updated for ${this.selectedElement.type} element`);
        }
    }
    
    deleteSelectedElement() {
        if (!this.selectedElement) return;
        
        const elementEl = document.querySelector(`[data-element-id="${this.selectedElement.id}"]`);
        if (elementEl) {
            this.editCanvas.removeChild(elementEl);
        }
        
        this.elements = this.elements.filter(el => el.id !== this.selectedElement.id);
        this.selectedElement = null;
        this.editProperties.style.display = 'none';
        
        if (this.onLogMessage) {
            this.onLogMessage('Element deleted');
        }
    }
    
    updateSelectedElement() {
        console.log('updateSelectedElement called');
        console.log('selectedElement:', this.selectedElement);
        
        if (!this.selectedElement) {
            console.log('No selected element');
            return;
        }
        
        console.log('Before update - color:', this.selectedElement.color);
        console.log('shapeColor value:', this.shapeColor ? this.shapeColor.value : 'shapeColor not found');
        
        // Check if size is being changed
        let sizeChanged = false;
        if (this.shapeSize && parseInt(this.shapeSize.value) !== this.selectedElement.size) {
            sizeChanged = true;
        }
        
        if (this.shapeColor) {
            this.selectedElement.color = this.handleTransparentColor(this.shapeColor.value);
            console.log('Updated color to:', this.selectedElement.color);
        }
        if (this.borderColor) {
            this.selectedElement.borderColor = this.handleTransparentColor(this.borderColor.value);
            console.log('Updated border color to:', this.selectedElement.borderColor);
        }
        if (this.fillOpacity) {
            this.selectedElement.fillOpacity = parseInt(this.fillOpacity.value);
            console.log('Updated fill opacity to:', this.selectedElement.fillOpacity);
        }
        if (this.borderOpacity) {
            this.selectedElement.borderOpacity = parseInt(this.borderOpacity.value);
            console.log('Updated border opacity to:', this.selectedElement.borderOpacity);
        }
        if (this.shapeSize) {
            this.selectedElement.size = parseInt(this.shapeSize.value);
        }
        
        // Only update text-related properties for text elements
        if (this.selectedElement.type === 'text') {
            if (this.textInput) this.selectedElement.text = this.textInput.value;
            if (this.fontSize) this.selectedElement.fontSize = parseInt(this.fontSize.value);
            if (this.fontSizeInput) this.selectedElement.fontSize = parseInt(this.fontSizeInput.value);
        }
        
        console.log('After update - element:', this.selectedElement);
        
        // Get the existing element
        const elementEl = document.querySelector(`[data-element-id="${this.selectedElement.id}"]`);
        if (elementEl) {
            if (sizeChanged) {
                // If size changed, update size-related styles
                this.updateElementStylesWithSize(elementEl, this.selectedElement);
            } else {
                // If only colors/opacity changed, update only those styles
                this.updateElementStyles(elementEl, this.selectedElement);
            }
        } else {
            // If element doesn't exist, re-render it
            console.log('Element not found, re-rendering');
            this.renderElement(this.selectedElement);
            
            // Re-select the element
            const newElementEl = document.querySelector(`[data-element-id="${this.selectedElement.id}"]`);
            if (newElementEl) {
                newElementEl.classList.add('selected');
            }
        }
        
        if (this.onLogMessage) {
            this.onLogMessage(`Updated element color to ${this.selectedElement.color}`);
        }
    }
    
    updateElementStyles(elementEl, element) {
        console.log('updateElementStyles called for:', element.type);
        
        if (element.type === 'text') {
            // Update text element styles
            elementEl.textContent = element.text;
            elementEl.style.fontSize = element.fontSize + 'px';
            
            // Convert hex to rgba for text color with opacity
            const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
            const textRgba = this.hexToRgba(element.color, fillOpacity);
            elementEl.style.color = textRgba;
        } else {
            // Update shape element styles - only update colors and opacity, not size
            if (element.type === 'circle') {
                // Don't update width/height/borderRadius - keep current size
                
                // Convert hex to rgba for background color with opacity
                const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
                const fillRgba = this.hexToRgba(element.color, fillOpacity);
                elementEl.style.backgroundColor = fillRgba;
                
                // Convert hex to rgba for border color with opacity
                const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
                const borderRgba = this.hexToRgba(element.borderColor || '#000000', borderOpacity);
                elementEl.style.borderColor = borderRgba;
            } else if (element.type === 'rectangle') {
                // Don't update width/height - keep current size
                
                // Convert hex to rgba for background color with opacity
                const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
                const fillRgba = this.hexToRgba(element.color, fillOpacity);
                elementEl.style.backgroundColor = fillRgba;
                
                // Convert hex to rgba for border color with opacity
                const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
                const borderRgba = this.hexToRgba(element.borderColor || '#000000', borderOpacity);
                elementEl.style.borderColor = borderRgba;
            }
        }
        
        console.log('Element styles updated');
    }
    
    updateElementStylesWithSize(elementEl, element) {
        console.log('updateElementStylesWithSize called for:', element.type);
        
        if (element.type === 'text') {
            // Update text element styles including size
            elementEl.textContent = element.text;
            elementEl.style.fontSize = element.fontSize + 'px';
            
            // Convert hex to rgba for text color with opacity
            const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
            const textRgba = this.hexToRgba(element.color, fillOpacity);
            elementEl.style.color = textRgba;
        } else {
            // Update shape element styles including size
            if (element.type === 'circle') {
                elementEl.style.width = element.size + 'px';
                elementEl.style.height = element.size + 'px';
                elementEl.style.borderRadius = '50%';
                
                // Convert hex to rgba for background color with opacity
                const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
                const fillRgba = this.hexToRgba(element.color, fillOpacity);
                elementEl.style.backgroundColor = fillRgba;
                
                // Convert hex to rgba for border color with opacity
                const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
                const borderRgba = this.hexToRgba(element.borderColor || '#000000', borderOpacity);
                elementEl.style.borderColor = borderRgba;
            } else if (element.type === 'rectangle') {
                elementEl.style.width = element.size + 'px';
                elementEl.style.height = element.size + 'px';
                
                // Convert hex to rgba for background color with opacity
                const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
                const fillRgba = this.hexToRgba(element.color, fillOpacity);
                elementEl.style.backgroundColor = fillRgba;
                
                // Convert hex to rgba for border color with opacity
                const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
                const borderRgba = this.hexToRgba(element.borderColor || '#000000', borderOpacity);
                elementEl.style.borderColor = borderRgba;
            }
        }
        
        console.log('Element styles with size updated');
    }
    
    addResizeHandles(elementEl, element) {
        const handles = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
        
        handles.forEach(handleType => {
            const handle = document.createElement('div');
            handle.className = `resize-handle ${handleType}`;
            handle.setAttribute('data-handle-type', handleType);
            handle.style.display = 'none'; // Initially hidden
            elementEl.appendChild(handle);
            
            // Add resize functionality
            this.makeHandleResizable(handle, elementEl, element, handleType);
        });
    }
    
    makeHandleResizable(handle, elementEl, element, handleType) {
        let isResizing = false;
        let startX, startY, startWidth, startHeight, startElementX, startElementY;
        
        handle.addEventListener('mousedown', (e) => {
            if (this.currentTool === 'select') {
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;
                startWidth = element.size;
                startHeight = element.size;
                startElementX = element.x;
                startElementY = element.y;
                
                e.stopPropagation();
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isResizing) {
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                
                let newWidth = startWidth;
                let newHeight = startHeight;
                let newX = startElementX;
                let newY = startElementY;
                
                // Calculate new size and position based on handle type
                switch (handleType) {
                    case 'bottom-right':
                        newWidth = Math.max(20, startWidth + deltaX);
                        newHeight = Math.max(20, startHeight + deltaY);
                        break;
                    case 'bottom-left':
                        newWidth = Math.max(20, startWidth - deltaX);
                        newHeight = Math.max(20, startHeight + deltaY);
                        newX = startElementX + (startWidth - newWidth);
                        break;
                    case 'top-right':
                        newWidth = Math.max(20, startWidth + deltaX);
                        newHeight = Math.max(20, startHeight - deltaY);
                        newY = startElementY + (startHeight - newHeight);
                        break;
                    case 'top-left':
                        newWidth = Math.max(20, startWidth - deltaX);
                        newHeight = Math.max(20, startHeight - deltaY);
                        newX = startElementX + (startWidth - newWidth);
                        newY = startElementY + (startHeight - newHeight);
                        break;
                }
                
                // Update element
                element.size = newWidth;
                element.x = newX;
                element.y = newY;
                
                // Update visual
                elementEl.style.width = newWidth + 'px';
                elementEl.style.height = newHeight + 'px';
                elementEl.style.left = newX + 'px';
                elementEl.style.top = newY + 'px';
            }
        });
        
        document.addEventListener('mouseup', () => {
            isResizing = false;
        });
    }
    
    bringElementToFront(element) {
        // Remove element from current position
        const index = this.elements.indexOf(element);
        if (index > -1) {
            this.elements.splice(index, 1);
        }
        
        // Add element to the end (top of the stack)
        this.elements.push(element);
        
        // Update z-index of all elements to maintain proper stacking order
        this.elements.forEach((el, i) => {
            const elementEl = document.querySelector(`[data-element-id="${el.id}"]`);
            if (elementEl) {
                elementEl.style.zIndex = 10000 + i;
            }
        });
        
        console.log('Element brought to front:', element.id);
        if (this.onLogMessage) {
            this.onLogMessage(`Element ${element.id} brought to front`);
        }
    }
    
    enableEditMode() {
        this.isEditMode = true;
        this.editCanvas.classList.add('active');
        // Clear existing elements and setup canvas
        this.elements = [];
        this.nextElementId = 1;
        this.editCanvas.innerHTML = '';
        this.setupEditCanvas();
        // Set default tool to select
        this.setTool('select');
    }
    
    disableEditMode() {
        this.isEditMode = false;
        this.editCanvas.classList.remove('active');
        this.selectedElement = null;
        if (this.editProperties) {
            this.editProperties.style.display = 'none';
        }
    }
    
    // Helper function to handle transparent colors
    handleTransparentColor(colorValue) {
        // If the color is completely transparent (alpha = 0), return 'transparent'
        if (colorValue === '#00000000' || colorValue === 'rgba(0,0,0,0)') {
            return 'transparent';
        }
        return colorValue;
    }
    
    // Helper function to convert hex color to rgba
    hexToRgba(hex, alpha) {
        // Remove # if present
        hex = hex.replace('#', '');
        
        // Parse hex values
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}
