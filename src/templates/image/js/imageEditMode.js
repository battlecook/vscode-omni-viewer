export class ImageEditMode {
    constructor(image, imageWrapper) {
        this.image = image;
        this.imageWrapper = imageWrapper;
        
        // Edit Mode Variables
        this.isEditMode = false;
        this.currentTool = 'select';
        this.selectedElement = null;
        this.selectedElements = []; // 다중 선택을 위한 배열
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
        this.selectionInfo = document.getElementById('selectionInfo');
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
        
        // 키보드 이벤트 리스너 추가
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        
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
            this.selectElementAt(x, y, e.metaKey || e.ctrlKey); // Cmd 또는 Ctrl 키 확인
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
    
    selectElementAt(x, y, isMultiSelect = false) {
        console.log('selectElementAt called with:', x, y, 'multiSelect:', isMultiSelect);
        
        // Find element at position (reverse order to get topmost element first)
        let clickedElement = null;
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
                clickedElement = element;
                break; // Found the topmost element, stop searching
            }
        }
        
        if (clickedElement) {
            if (isMultiSelect) {
                // 다중 선택 모드
                const isAlreadySelected = this.selectedElements.some(el => el.id === clickedElement.id);
                if (isAlreadySelected) {
                    // 이미 선택된 요소라면 선택 해제
                    this.deselectElement(clickedElement);
                } else {
                    // 새로운 요소 선택 추가
                    this.selectedElements.push(clickedElement);
                    this.selectElement(clickedElement);
                }
            } else {
                // 단일 선택 모드 - 기존 선택 모두 해제
                this.clearAllSelections();
                this.selectedElements = [clickedElement];
                this.selectElement(clickedElement);
            }
            
            // Bring selected element to front
            this.bringElementToFront(clickedElement);
            this.updatePropertiesPanel();
            
            if (this.onLogMessage) {
                this.onLogMessage(`Selected ${clickedElement.type} element (${this.selectedElements.length} total selected)`);
            }
        } else {
            // 빈 공간 클릭 - 다중 선택이 아닌 경우에만 모든 선택 해제
            if (!isMultiSelect) {
                this.clearAllSelections();
                if (this.editProperties) {
                    this.editProperties.style.display = 'none';
                }
            }
        }
    }
    
    // 다중 선택을 위한 헬퍼 메서드들
    selectElement(element) {
        const elementEl = document.querySelector(`[data-element-id="${element.id}"]`);
        if (elementEl) {
            elementEl.classList.add('selected');
            // Show resize handles for rectangle
            if (element.type === 'rectangle') {
                const handles = elementEl.querySelectorAll('.resize-handle');
                handles.forEach(handle => handle.style.display = 'block');
            }
        }
        this.updateSelectionInfo();
    }
    
    deselectElement(element) {
        const elementEl = document.querySelector(`[data-element-id="${element.id}"]`);
        if (elementEl) {
            elementEl.classList.remove('selected');
            // Hide resize handles
            const handles = elementEl.querySelectorAll('.resize-handle');
            handles.forEach(handle => handle.style.display = 'none');
        }
        
        // 배열에서 제거
        this.selectedElements = this.selectedElements.filter(el => el.id !== element.id);
        this.updateSelectionInfo();
    }
    
    clearAllSelections() {
        this.selectedElements.forEach(element => {
            this.deselectElement(element);
        });
        this.selectedElements = [];
        this.selectedElement = null;
        this.updateSelectionInfo();
    }
    
    updateSelectionInfo() {
        if (this.selectionInfo) {
            const count = this.selectedElements.length;
            if (count > 0) {
                this.selectionInfo.textContent = `${count} selected`;
                this.selectionInfo.style.display = 'inline';
            } else {
                this.selectionInfo.style.display = 'none';
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
        let initialPositions = []; // 다중 선택 시 초기 위치 저장
        
        elementEl.addEventListener('mousedown', (e) => {
            if (this.currentTool === 'select') {
                isDragging = true;
                startX = e.clientX - element.x;
                startY = e.clientY - element.y;
                
                // 다중 선택된 요소들의 초기 위치 저장
                if (this.selectedElements.length > 1) {
                    initialPositions = this.selectedElements.map(el => ({
                        id: el.id,
                        x: el.x,
                        y: el.y
                    }));
                }
                
                e.stopPropagation();
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging && this.selectedElements.some(el => el.id === element.id)) {
                const deltaX = e.clientX - startX - element.x;
                const deltaY = e.clientY - startY - element.y;
                
                if (this.selectedElements.length > 1) {
                    // 다중 선택 시 모든 선택된 요소들을 함께 이동
                    this.selectedElements.forEach(selectedEl => {
                        const initialPos = initialPositions.find(pos => pos.id === selectedEl.id);
                        if (initialPos) {
                            selectedEl.x = initialPos.x + deltaX;
                            selectedEl.y = initialPos.y + deltaY;
                            
                            const selectedElementEl = document.querySelector(`[data-element-id="${selectedEl.id}"]`);
                            if (selectedElementEl) {
                                selectedElementEl.style.left = selectedEl.x + 'px';
                                selectedElementEl.style.top = selectedEl.y + 'px';
                            }
                        }
                    });
                } else {
                    // 단일 선택 시 기존 로직
                    element.x = e.clientX - startX;
                    element.y = e.clientY - startY;
                    elementEl.style.left = element.x + 'px';
                    elementEl.style.top = element.y + 'px';
                }
            }
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
            initialPositions = [];
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
        console.log('selectedElements:', this.selectedElements);
        console.log('editProperties:', this.editProperties);
        
        if (this.selectedElements.length === 0 || !this.editProperties) {
            console.log('No selected elements or editProperties not found');
            this.editProperties.style.display = 'none';
            return;
        }
        
        // 다중 선택 시 공통 속성 표시, 단일 선택 시 개별 속성 표시
        const selectedElement = this.selectedElements[0];
        
        // 다중 선택 시 공통 속성 계산
        let displayProperties = {
            color: selectedElement.color,
            borderColor: selectedElement.borderColor || '#000000',
            fillOpacity: selectedElement.fillOpacity !== undefined ? selectedElement.fillOpacity : 100,
            borderOpacity: selectedElement.borderOpacity !== undefined ? selectedElement.borderOpacity : 100,
            size: selectedElement.size,
            text: selectedElement.text || '',
            fontSize: selectedElement.fontSize || 24
        };
        
        if (this.selectedElements.length > 1) {
            // 다중 선택 시 공통 속성 계산
            const colors = this.selectedElements.map(el => el.color);
            const borderColors = this.selectedElements.map(el => el.borderColor || '#000000');
            const fillOpacities = this.selectedElements.map(el => el.fillOpacity !== undefined ? el.fillOpacity : 100);
            const borderOpacities = this.selectedElements.map(el => el.borderOpacity !== undefined ? el.borderOpacity : 100);
            const sizes = this.selectedElements.map(el => el.size);
            const texts = this.selectedElements.map(el => el.text || '');
            const fontSizes = this.selectedElements.map(el => el.fontSize || 24);
            
            // 모든 값이 같은지 확인
            const allColorsSame = colors.every(color => color === colors[0]);
            const allBorderColorsSame = borderColors.every(color => color === borderColors[0]);
            const allFillOpacitiesSame = fillOpacities.every(opacity => opacity === fillOpacities[0]);
            const allBorderOpacitiesSame = borderOpacities.every(opacity => opacity === borderOpacities[0]);
            const allSizesSame = sizes.every(size => size === sizes[0]);
            const allTextsSame = texts.every(text => text === texts[0]);
            const allFontSizesSame = fontSizes.every(size => size === fontSizes[0]);
            
            displayProperties = {
                color: allColorsSame ? colors[0] : 'mixed',
                borderColor: allBorderColorsSame ? borderColors[0] : 'mixed',
                fillOpacity: allFillOpacitiesSame ? fillOpacities[0] : Math.round(fillOpacities.reduce((a, b) => a + b, 0) / fillOpacities.length),
                borderOpacity: allBorderOpacitiesSame ? borderOpacities[0] : Math.round(borderOpacities.reduce((a, b) => a + b, 0) / borderOpacities.length),
                size: allSizesSame ? sizes[0] : Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length),
                text: allTextsSame ? texts[0] : 'mixed',
                fontSize: allFontSizesSame ? fontSizes[0] : Math.round(fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length)
            };
        }
        
        console.log('Updating properties panel with:', displayProperties);
        
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
                // Show border properties for non-text elements or mixed selection
                const hasTextElements = this.selectedElements.some(el => el.type === 'text');
                const hasNonTextElements = this.selectedElements.some(el => el.type !== 'text');
                group.style.display = (hasNonTextElements || (hasTextElements && hasNonTextElements)) ? 'flex' : 'none';
            } else if (textInput || fontSizeInput) {
                // Show text-related properties for text elements or mixed selection
                const hasTextElements = this.selectedElements.some(el => el.type === 'text');
                group.style.display = hasTextElements ? 'flex' : 'none';
            }
        });
        
        // Update values
        if (this.shapeColor) {
            this.shapeColor.value = displayProperties.color === 'mixed' ? '#ff0000' : displayProperties.color;
            console.log('Set shapeColor to:', this.shapeColor.value);
        }
        if (this.borderColor) {
            this.borderColor.value = displayProperties.borderColor === 'mixed' ? '#000000' : displayProperties.borderColor;
            console.log('Set borderColor to:', this.borderColor.value);
        }
        if (this.fillOpacity) {
            this.fillOpacity.value = displayProperties.fillOpacity;
            if (this.fillOpacityValue) {
                this.fillOpacityValue.textContent = displayProperties.fillOpacity + '%';
            }
            console.log('Set fillOpacity to:', this.fillOpacity.value);
        }
        if (this.borderOpacity) {
            this.borderOpacity.value = displayProperties.borderOpacity;
            if (this.borderOpacityValue) {
                this.borderOpacityValue.textContent = displayProperties.borderOpacity + '%';
            }
            console.log('Set borderOpacity to:', this.borderOpacity.value);
        }
        if (this.shapeSize) {
            this.shapeSize.value = displayProperties.size;
            console.log('Set shapeSize to:', this.shapeSize.value);
        }
        if (this.textInput) {
            this.textInput.value = displayProperties.text === 'mixed' ? '' : displayProperties.text;
            console.log('Set textInput to:', this.textInput.value);
        }
        if (this.fontSize) {
            this.fontSize.value = displayProperties.fontSize;
            if (this.fontSizeInput) {
                this.fontSizeInput.value = displayProperties.fontSize;
            }
            console.log('Set fontSize to:', this.fontSize.value);
        }
        
        this.editProperties.style.display = 'flex';
        console.log('Properties panel displayed');
        
        if (this.onLogMessage) {
            this.onLogMessage(`Properties panel updated for ${this.selectedElements.length} element(s)`);
        }
    }
    
    deleteSelectedElement() {
        if (this.selectedElements.length === 0) return;
        
        // 선택된 모든 요소들을 삭제
        this.selectedElements.forEach(element => {
            const elementEl = document.querySelector(`[data-element-id="${element.id}"]`);
            if (elementEl) {
                this.editCanvas.removeChild(elementEl);
            }
            
            // elements 배열에서 제거
            this.elements = this.elements.filter(el => el.id !== element.id);
        });
        
        const deletedCount = this.selectedElements.length;
        this.selectedElements = [];
        this.selectedElement = null;
        this.editProperties.style.display = 'none';
        this.updateSelectionInfo();
        
        if (this.onLogMessage) {
            this.onLogMessage(`${deletedCount} element(s) deleted`);
        }
    }
    
    updateSelectedElement() {
        console.log('updateSelectedElement called');
        console.log('selectedElements:', this.selectedElements);
        
        if (this.selectedElements.length === 0) {
            console.log('No selected elements');
            return;
        }
        
        // 다중 선택 시 모든 선택된 요소들에 속성 적용
        const selectedElement = this.selectedElements[0];
        
        console.log('Before update - color:', selectedElement.color);
        console.log('shapeColor value:', this.shapeColor ? this.shapeColor.value : 'shapeColor not found');
        
        // 모든 선택된 요소들에 속성 적용
        this.selectedElements.forEach(element => {
            // Check if size is being changed
            let sizeChanged = false;
            if (this.shapeSize && parseInt(this.shapeSize.value) !== element.size) {
                sizeChanged = true;
            }
            
            if (this.shapeColor) {
                element.color = this.handleTransparentColor(this.shapeColor.value);
                console.log('Updated color to:', element.color);
            }
            if (this.borderColor) {
                element.borderColor = this.handleTransparentColor(this.borderColor.value);
                console.log('Updated border color to:', element.borderColor);
            }
            if (this.fillOpacity) {
                element.fillOpacity = parseInt(this.fillOpacity.value);
                console.log('Updated fill opacity to:', element.fillOpacity);
            }
            if (this.borderOpacity) {
                element.borderOpacity = parseInt(this.borderOpacity.value);
                console.log('Updated border opacity to:', element.borderOpacity);
            }
            if (this.shapeSize) {
                element.size = parseInt(this.shapeSize.value);
            }
            
            // Only update text-related properties for text elements
            if (element.type === 'text') {
                if (this.textInput) element.text = this.textInput.value;
                if (this.fontSize) element.fontSize = parseInt(this.fontSize.value);
                if (this.fontSizeInput) element.fontSize = parseInt(this.fontSizeInput.value);
            }
            
            console.log('After update - element:', element);
            
            // Get the existing element
            const elementEl = document.querySelector(`[data-element-id="${element.id}"]`);
            if (elementEl) {
                if (sizeChanged) {
                    // If size changed, update size-related styles
                    this.updateElementStylesWithSize(elementEl, element);
                } else {
                    // If only colors/opacity changed, update only those styles
                    this.updateElementStyles(elementEl, element);
                }
            } else {
                // If element doesn't exist, re-render it
                console.log('Element not found, re-rendering');
                this.renderElement(element);
                
                // Re-select the element
                const newElementEl = document.querySelector(`[data-element-id="${element.id}"]`);
                if (newElementEl) {
                    newElementEl.classList.add('selected');
                }
            }
        });
        
        if (this.onLogMessage) {
            this.onLogMessage(`Updated ${this.selectedElements.length} element(s) color to ${this.shapeColor ? this.shapeColor.value : 'N/A'}`);
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
        this.selectedElements = [];
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
    
    // 키보드 이벤트 핸들러
    handleKeyDown(e) {
        if (!this.isEditMode) return;
        
        // Delete 키 처리
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.deleteSelectedElement();
        }
        
        // Escape 키로 선택 해제
        if (e.key === 'Escape') {
            this.clearAllSelections();
            if (this.editProperties) {
                this.editProperties.style.display = 'none';
            }
        }
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
