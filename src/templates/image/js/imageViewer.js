console.log('Image viewer script loading...');

const vscode = acquireVsCodeApi();

console.log('VSCode API acquired');

// Image state
let currentZoom = 100;
let currentRotation = 0;
let isFlippedHorizontal = false;
let isFlippedVertical = false;
let originalWidth = 0;
let originalHeight = 0;
let imageFormat = '';
let fileSize = '';

// Filter state
let brightness = 100;
let contrast = 100;
let saturation = 100;
let grayscale = 0;

// DOM elements
const image = document.getElementById('image');
const imageWrapper = document.getElementById('imageWrapper');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const fileInfoDiv = document.getElementById('fileInfo');
const sizeInfoDiv = document.getElementById('sizeInfo');
const formatInfoDiv = document.getElementById('formatInfo');
const fileSizeInfoDiv = document.getElementById('fileSizeInfo');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const rotateBtn = document.getElementById('rotate');
const flipHorizontalBtn = document.getElementById('flipHorizontal');
const flipVerticalBtn = document.getElementById('flipVertical');
const resetBtn = document.getElementById('reset');
const fitToScreenBtn = document.getElementById('fitToScreen');
const saveFilteredBtn = document.getElementById('saveFiltered');

// Filter elements (now part of edit controls)
const brightnessSlider = document.getElementById('brightnessSlider');
const contrastSlider = document.getElementById('contrastSlider');
const saturationSlider = document.getElementById('saturationSlider');
const grayscaleSlider = document.getElementById('grayscaleSlider');

// Preset buttons
const presetNormal = document.getElementById('presetNormal');
const presetBright = document.getElementById('presetBright');
const presetDark = document.getElementById('presetDark');
const presetVintage = document.getElementById('presetVintage');
const presetBw = document.getElementById('presetBw');

// Modal elements
const filenameModal = document.getElementById('filenameModal');
const filenameInput = document.getElementById('filenameInput');
const cancelSaveBtn = document.getElementById('cancelSave');
const confirmSaveBtn = document.getElementById('confirmSave');
const currentPathSpan = document.getElementById('currentPath');

// Initialize the image viewer
function initImageViewer() {
    console.log('Initializing image viewer...');
    
    // Set up event listeners
    setupEventListeners();
    setupEditModeEventListeners();
    
    console.log('Event listeners setup complete');
    
    // Load image
    image.onload = function() {
        originalWidth = image.naturalWidth;
        originalHeight = image.naturalHeight;
        
        // Get image format from file extension
        const fileName = '{{fileName}}';
        const extension = fileName.split('.').pop().toUpperCase();
        imageFormat = extension;
        
        // Get file size from template variable
        fileSize = '{{fileSize}}';
        
        loadingDiv.style.display = 'none';
        imageWrapper.style.display = 'block';
        fileInfoDiv.style.display = 'flex';
        
        updateImageInfo();
        fitToScreen();
        
        // Setup edit canvas after image is loaded
        setTimeout(() => {
            setupEditCanvas();
        }, 200);
        
        vscode.postMessage({ command: 'log', text: 'Image loaded successfully' });
    };
    
    image.onerror = function() {
        loadingDiv.style.display = 'none';
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'Error loading image file';
        vscode.postMessage({ command: 'error', text: 'Failed to load image' });
    };
}

function setupEventListeners() {
    // Zoom controls
    zoomInBtn.addEventListener('click', () => {
        currentZoom = Math.min(500, currentZoom + 25);
        updateZoom();
    });

    zoomOutBtn.addEventListener('click', () => {
        currentZoom = Math.max(10, currentZoom - 25);
        updateZoom();
    });

    // Mouse wheel zoom
    imageWrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const zoomChange = e.ctrlKey ? 10 : 25; // Ctrl+wheel for fine control
        currentZoom = Math.max(10, Math.min(500, currentZoom + (delta * zoomChange)));
        updateZoom();
    });

    // Rotation controls
    rotateBtn.addEventListener('click', () => {
        currentRotation = (currentRotation + 90) % 360;
        updateTransform();
    });

    // Flip controls
    flipHorizontalBtn.addEventListener('click', () => {
        isFlippedHorizontal = !isFlippedHorizontal;
        updateTransform();
    });

    flipVerticalBtn.addEventListener('click', () => {
        isFlippedVertical = !isFlippedVertical;
        updateTransform();
    });

    // Reset and fit controls
    resetBtn.addEventListener('click', () => {
        resetImage();
    });

    fitToScreenBtn.addEventListener('click', () => {
        fitToScreen();
    });

    // Save image (with or without edit elements)
    saveFilteredBtn.addEventListener('click', () => {
        if (elements.length > 0) {
            // If there are edit elements, save with them
            saveEditedImage();
        } else {
            // If no edit elements, save filtered image only
            saveFilteredImage();
        }
    });

    // Toggle edit mode (includes filters)
    toggleEditModeBtn.addEventListener('click', () => {
        const isVisible = editControls.style.display !== 'none';
        editControls.style.display = isVisible ? 'none' : 'flex';
        toggleEditModeBtn.classList.toggle('active', !isVisible);
        
        if (!isVisible) {
            // Enable edit mode
            isEditMode = true;
            editCanvas.classList.add('active');
            // Clear existing elements and setup canvas
            elements = [];
            nextElementId = 1;
            editCanvas.innerHTML = '';
            setupEditCanvas();
            // Set default tool to select
            setTool('select');
            vscode.postMessage({ command: 'log', text: 'Edit mode enabled' });
        } else {
            // Disable edit mode
            isEditMode = false;
            editCanvas.classList.remove('active');
            selectedElement = null;
            if (editProperties) {
                editProperties.style.display = 'none';
            }
            vscode.postMessage({ command: 'log', text: 'Edit mode disabled' });
        }
    });

    // Filter controls
    brightnessSlider.addEventListener('input', (e) => {
        brightness = parseInt(e.target.value);
        updateFilters();
    });

    contrastSlider.addEventListener('input', (e) => {
        contrast = parseInt(e.target.value);
        updateFilters();
    });

    saturationSlider.addEventListener('input', (e) => {
        saturation = parseInt(e.target.value);
        updateFilters();
    });

    grayscaleSlider.addEventListener('input', (e) => {
        grayscale = parseInt(e.target.value);
        updateFilters();
    });

    // Preset buttons
    presetNormal.addEventListener('click', () => applyPreset('normal'));
    presetBright.addEventListener('click', () => applyPreset('bright'));
    presetDark.addEventListener('click', () => applyPreset('dark'));
    presetVintage.addEventListener('click', () => applyPreset('vintage'));
    presetBw.addEventListener('click', () => applyPreset('bw'));

    // Modal event listeners
    cancelSaveBtn.addEventListener('click', () => {
        filenameModal.style.display = 'none';
        filenameInput.value = '';
    });

    confirmSaveBtn.addEventListener('click', () => {
        const fileName = filenameInput.value.trim();
        if (fileName) {
            filenameModal.style.display = 'none';
            saveFilteredImageWithName(fileName);
        }
    });

    // Close modal on overlay click
    filenameModal.addEventListener('click', (e) => {
        if (e.target === filenameModal) {
            filenameModal.style.display = 'none';
            filenameInput.value = '';
        }
    });

    // Handle Enter key in modal
    filenameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmSaveBtn.click();
        } else if (e.key === 'Escape') {
            cancelSaveBtn.click();
        }
    });

    // Update path when filename changes
    filenameInput.addEventListener('input', updateSavePath);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        switch(e.key) {
            case '+':
            case '=':
                e.preventDefault();
                zoomInBtn.click();
                break;
            case '-':
                e.preventDefault();
                zoomOutBtn.click();
                break;
            case '0':
                e.preventDefault();
                resetBtn.click();
                break;
            case 'f':
                e.preventDefault();
                fitToScreenBtn.click();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                rotateBtn.click();
                break;
            case 'ArrowRight':
                e.preventDefault();
                rotateBtn.click();
                break;
            case 's':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    saveFilteredBtn.click();
                }
                break;
        }
    });
}

function updateZoom() {
    updateTransform();
}

function updateTransform() {
    const scale = currentZoom / 100;
    const rotation = currentRotation;
    const flipH = isFlippedHorizontal ? -1 : 1;
    const flipV = isFlippedVertical ? -1 : 1;
    
    image.style.transform = `scale(${scale * flipH}, ${scale * flipV}) rotate(${rotation}deg)`;
    
    // Update edit canvas if in edit mode
    if (isEditMode) {
        setupEditCanvas();
    }
}

function updateFilters() {
    const filterString = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%)`;
    image.style.filter = filterString;
}

function applyPreset(preset) {
    // Remove active class from all preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    
    switch(preset) {
        case 'normal':
            brightness = 100; contrast = 100; saturation = 100; grayscale = 0;
            presetNormal.classList.add('active');
            break;
        case 'bright':
            brightness = 130; contrast = 110; saturation = 100; grayscale = 0;
            presetBright.classList.add('active');
            break;
        case 'dark':
            brightness = 70; contrast = 120; saturation = 100; grayscale = 0;
            presetDark.classList.add('active');
            break;
        case 'vintage':
            brightness = 110; contrast = 90; saturation = 70; grayscale = 10;
            presetVintage.classList.add('active');
            break;
        case 'bw':
            brightness = 100; contrast = 120; saturation = 0; grayscale = 100;
            presetBw.classList.add('active');
            break;
    }
    
    // Update sliders
    brightnessSlider.value = brightness;
    contrastSlider.value = contrast;
    saturationSlider.value = saturation;
    grayscaleSlider.value = grayscale;
    
    updateFilters();
}

function updateImageInfo() {
    sizeInfoDiv.textContent = `${originalWidth}×${originalHeight}`;
    formatInfoDiv.textContent = imageFormat;
    fileSizeInfoDiv.textContent = fileSize;
}

function resetImage() {
    currentZoom = 100;
    currentRotation = 0;
    isFlippedHorizontal = false;
    isFlippedVertical = false;
    
    updateZoom();
    updateImageInfo();
    
    // Reset filters
    applyPreset('normal');
}

function fitToScreen() {
    const container = imageWrapper.parentElement;
    const containerWidth = container.clientWidth - 40; // padding
    const containerHeight = container.clientHeight - 40; // padding
    
    const scaleX = containerWidth / originalWidth;
    const scaleY = containerHeight / originalHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%
    
    currentZoom = Math.round(scale * 100);
    updateZoom();
    updateImageInfo();
}

function saveFilteredImage() {
    // Generate default filename with timestamp
    const originalName = '{{fileName}}';
    const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
    const extension = originalName.substring(originalName.lastIndexOf('.'));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultFileName = `${nameWithoutExt}_saved_${timestamp}${extension}`;
    
    // Show modal with default filename
    filenameInput.value = defaultFileName;
    filenameInput.focus();
    filenameInput.select();
    filenameModal.style.display = 'flex';
    
    // Update path display
    updateSavePath();
}

function updateSavePath() {
    const fileName = filenameInput.value.trim() || 'filename.png';
    
    // Show workspace path
    const workspacePath = '{{workspacePath}}';
    if (workspacePath) {
        currentPathSpan.textContent = `${workspacePath}/${fileName}`;
    } else {
        currentPathSpan.textContent = `[Workspace folder]/${fileName}`;
    }
}

function updatePathFromVSCode(path) {
    currentPathSpan.textContent = path;
}

function saveFilteredImageWithName(fileName) {
    // Validate filename
    const originalName = '{{fileName}}';
    const extension = originalName.substring(originalName.lastIndexOf('.'));
    
    if (!fileName.toLowerCase().endsWith(extension.toLowerCase())) {
        alert(`Filename should end with ${extension}`);
        return;
    }
    
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(fileName)) {
        alert('Filename contains invalid characters');
        return;
    }
    
    // Create canvas to apply filters
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size to original image size
    canvas.width = originalWidth;
    canvas.height = originalHeight;
    
    // Apply current filters to canvas context
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%)`;
    
    // Apply transformations
    ctx.save();
    
    // Move to center for rotation
    ctx.translate(canvas.width / 2, canvas.height / 2);
    
    // Apply rotation
    ctx.rotate((currentRotation * Math.PI) / 180);
    
    // Apply flips
    const scaleX = isFlippedHorizontal ? -1 : 1;
    const scaleY = isFlippedVertical ? -1 : 1;
    ctx.scale(scaleX, scaleY);
    
    // Draw image centered
    ctx.drawImage(image, -originalWidth / 2, -originalHeight / 2, originalWidth, originalHeight);
    
    ctx.restore();
    
    // Convert to blob and save
    canvas.toBlob((blob) => {
        if (blob) {
            // Convert blob to base64 for sending to VSCode extension
            const reader = new FileReader();
            reader.onload = () => {
                const base64Data = reader.result;
                const base64Content = base64Data.split(',')[1]; // Remove data URL prefix
                
                // Send message to VSCode extension to save in workspace
                vscode.postMessage({ 
                    command: 'saveFilteredImage', 
                    fileName: fileName,
                    imageData: base64Content
                });
                
                vscode.postMessage({ command: 'log', text: `Filtered image saved as ${fileName}` });
            };
            reader.readAsDataURL(blob);
        } else {
            vscode.postMessage({ command: 'error', text: 'Failed to create filtered image' });
        }
    }, 'image/png', 0.9);
}

// Edit Mode Variables
let isEditMode = false;
let currentTool = 'select';
let selectedElement = null;
let elements = [];
let nextElementId = 1;

// Edit Mode DOM Elements
const toggleEditModeBtn = document.getElementById('toggleEditMode');
const editControls = document.getElementById('editControls');
const editCanvas = document.getElementById('editCanvas');
const addTextBtn = document.getElementById('addText');
const addCircleBtn = document.getElementById('addCircle');
const addRectangleBtn = document.getElementById('addRectangle');
const selectToolBtn = document.getElementById('selectTool');
const deleteSelectedBtn = document.getElementById('deleteSelected');
const editProperties = document.getElementById('editProperties');
const shapeColor = document.getElementById('shapeColor');
const borderColor = document.getElementById('borderColor');
const fillOpacity = document.getElementById('fillOpacity');
const borderOpacity = document.getElementById('borderOpacity');
const fillOpacityValue = document.getElementById('fillOpacityValue');
const borderOpacityValue = document.getElementById('borderOpacityValue');
const shapeSize = document.getElementById('shapeSize');
const textInput = document.getElementById('textInput');
const fontSize = document.getElementById('fontSize');
const fontSizeInput = document.getElementById('fontSizeInput');

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');
    initImageViewer();
});

// Log to VSCode console
vscode.postMessage({ command: 'log', text: 'Image viewer initialized' });

// Edit Mode Functions
function setupEditModeEventListeners() {
    console.log('Setting up edit mode event listeners...');
    
    // Check if elements exist
    console.log('addTextBtn:', addTextBtn);
    console.log('addCircleBtn:', addCircleBtn);
    console.log('addRectangleBtn:', addRectangleBtn);
    console.log('editCanvas:', editCanvas);
    
    if (addTextBtn) {
        addTextBtn.addEventListener('click', () => {
            console.log('Text button clicked');
            setTool('text');
            vscode.postMessage({ command: 'log', text: 'Text tool selected' });
        });
    }
    
    if (addCircleBtn) {
        addCircleBtn.addEventListener('click', () => {
            console.log('Circle button clicked');
            setTool('circle');
            vscode.postMessage({ command: 'log', text: 'Circle tool selected' });
        });
    }
    
    if (addRectangleBtn) {
        addRectangleBtn.addEventListener('click', () => {
            console.log('Rectangle button clicked');
            setTool('rectangle');
            vscode.postMessage({ command: 'log', text: 'Rectangle tool selected' });
        });
    }
    
    if (selectToolBtn) {
        selectToolBtn.addEventListener('click', () => {
            console.log('Select button clicked');
            setTool('select');
            vscode.postMessage({ command: 'log', text: 'Select tool selected' });
        });
    }
    
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', deleteSelectedElement);
    }
    
    // Property change listeners
    if (shapeColor) {
        shapeColor.addEventListener('change', updateSelectedElement);
    }
    if (borderColor) {
        borderColor.addEventListener('change', updateSelectedElement);
    }
    if (fillOpacity) {
        fillOpacity.addEventListener('input', (e) => {
            if (fillOpacityValue) {
                fillOpacityValue.textContent = e.target.value + '%';
            }
            updateSelectedElement();
        });
    }
    if (borderOpacity) {
        borderOpacity.addEventListener('input', (e) => {
            if (borderOpacityValue) {
                borderOpacityValue.textContent = e.target.value + '%';
            }
            updateSelectedElement();
        });
    }
    if (shapeSize) {
        shapeSize.addEventListener('input', updateSelectedElement);
    }
    if (textInput) {
        textInput.addEventListener('input', updateSelectedElement);
    }
    if (fontSize) {
        fontSize.addEventListener('input', (e) => {
            if (fontSizeInput) {
                fontSizeInput.value = e.target.value;
            }
            updateSelectedElement();
        });
    }
    if (fontSizeInput) {
        fontSizeInput.addEventListener('input', (e) => {
            if (fontSize) {
                fontSize.value = e.target.value;
            }
            updateSelectedElement();
        });
    }
    
    // Canvas event listeners
    if (editCanvas) {
        editCanvas.addEventListener('click', handleCanvasClick);
        console.log('Canvas click listener added');
    }
    
    console.log('Edit mode event listeners setup complete');
}

function setupEditCanvas() {
    // Wait for image to be fully loaded and positioned
    setTimeout(() => {
        const rect = image.getBoundingClientRect();
        const wrapperRect = imageWrapper.getBoundingClientRect();
        
        console.log('Image rect:', rect);
        console.log('Wrapper rect:', wrapperRect);
        console.log('Image natural size:', image.naturalWidth, 'x', image.naturalHeight);
        console.log('Image offset size:', image.offsetWidth, 'x', image.offsetHeight);
        
        // Use the actual displayed image size
        const canvasWidth = rect.width;
        const canvasHeight = rect.height;
        
        editCanvas.style.width = canvasWidth + 'px';
        editCanvas.style.height = canvasHeight + 'px';
        editCanvas.style.left = rect.left - wrapperRect.left + 'px';
        editCanvas.style.top = rect.top - wrapperRect.top + 'px';
        
        vscode.postMessage({ command: 'log', text: `Canvas setup: ${canvasWidth}x${canvasHeight} at (${rect.left - wrapperRect.left}, ${rect.top - wrapperRect.top})` });
        
        // Re-render all elements
        elements.forEach(element => {
            const existingElement = document.querySelector(`[data-element-id="${element.id}"]`);
            if (existingElement) {
                existingElement.remove();
            }
            renderElement(element);
        });
        
        // Ensure canvas is visible and clickable
        editCanvas.style.pointerEvents = 'auto';
        editCanvas.style.zIndex = '9999';
        
        console.log('Canvas final setup:', {
            styleWidth: editCanvas.style.width,
            styleHeight: editCanvas.style.height,
            styleLeft: editCanvas.style.left,
            styleTop: editCanvas.style.top
        });
    }, 100);
}

function setTool(tool) {
    console.log('Setting tool to:', tool);
    currentTool = tool;
    
    // Update button states
    [addTextBtn, addCircleBtn, addRectangleBtn, selectToolBtn].forEach(btn => {
        if (btn) {
            btn.classList.remove('active');
        }
    });
    
    switch (tool) {
        case 'text':
            if (addTextBtn) addTextBtn.classList.add('active');
            if (editCanvas) editCanvas.classList.remove('select-mode');
            break;
        case 'circle':
            if (addCircleBtn) addCircleBtn.classList.add('active');
            if (editCanvas) editCanvas.classList.remove('select-mode');
            break;
        case 'rectangle':
            if (addRectangleBtn) addRectangleBtn.classList.add('active');
            if (editCanvas) editCanvas.classList.remove('select-mode');
            break;
        case 'select':
            if (selectToolBtn) selectToolBtn.classList.add('active');
            if (editCanvas) editCanvas.classList.add('select-mode');
            break;
    }
    
    // Show/hide properties panel
    if (editProperties) {
        editProperties.style.display = (tool === 'select' && selectedElement) ? 'flex' : 'none';
    }
    
    console.log('Tool set to:', currentTool);
}

function handleCanvasClick(e) {
    console.log('Canvas clicked!');
    console.log('isEditMode:', isEditMode);
    console.log('currentTool:', currentTool);
    
    if (!isEditMode) {
        console.log('Edit mode not active');
        vscode.postMessage({ command: 'log', text: 'Edit mode not active' });
        return;
    }
    
    // Get canvas position relative to the image wrapper
    const canvasRect = editCanvas.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    
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
    
    console.log(`Canvas click: (${x}, ${y}), tool: ${currentTool}`);
    vscode.postMessage({ command: 'log', text: `Canvas click: (${x}, ${y}), tool: ${currentTool}, canvas rect: ${canvasRect.left},${canvasRect.top}` });
    
    if (currentTool === 'select') {
        selectElementAt(x, y);
    } else {
        addElementAt(x, y);
    }
}

function addElementAt(x, y) {
    console.log('addElementAt called with:', x, y, currentTool);
    
    const element = {
        id: nextElementId++,
        type: currentTool,
        x: x,
        y: y,
        color: shapeColor ? shapeColor.value || '#ff0000' : '#ff0000',
        borderColor: borderColor ? borderColor.value || '#000000' : '#000000',
        fillOpacity: fillOpacity ? parseInt(fillOpacity.value) : 100,
        borderOpacity: borderOpacity ? parseInt(borderOpacity.value) : 100,
        size: shapeSize ? parseInt(shapeSize.value) || 100 : 100,
        text: textInput ? textInput.value || 'Text' : 'Text',
        fontSize: fontSize ? parseInt(fontSize.value) || 24 : 24
    };
    
    console.log('Created element:', element);
    
    elements.push(element);
    console.log('Elements array:', elements);
    
    renderElement(element);
    
    // Select the newly created element
    selectedElement = element;
    if (currentTool === 'select') {
        const elementEl = document.querySelector(`[data-element-id="${element.id}"]`);
        if (elementEl) {
            elementEl.classList.add('selected');
        }
        updatePropertiesPanel();
    }
    
    vscode.postMessage({ command: 'log', text: `Added ${currentTool} element at (${x}, ${y}), total elements: ${elements.length}, color: ${element.color}, size: ${element.size}` });
}

function selectElementAt(x, y) {
    console.log('selectElementAt called with:', x, y);
    
    // Deselect current element
    if (selectedElement) {
        const element = document.querySelector(`[data-element-id="${selectedElement.id}"]`);
        if (element) {
            element.classList.remove('selected');
            // Hide resize handles
            const handles = element.querySelectorAll('.resize-handle');
            handles.forEach(handle => handle.style.display = 'none');
        }
    }
    
    // Find element at position (reverse order to get topmost element first)
    selectedElement = null;
    for (let i = elements.length - 1; i >= 0; i--) {
        const element = elements[i];
        const elementEl = document.querySelector(`[data-element-id="${element.id}"]`);
        if (!elementEl) continue;
        
        const rect = elementEl.getBoundingClientRect();
        const canvasRect = editCanvas.getBoundingClientRect();
        
        const isInside = x >= rect.left - canvasRect.left && 
                        x <= rect.right - canvasRect.left &&
                        y >= rect.top - canvasRect.top && 
                        y <= rect.bottom - canvasRect.top;
        
        console.log(`Element ${element.id} hit test:`, isInside);
        if (isInside) {
            selectedElement = element;
            break; // Found the topmost element, stop searching
        }
    }
    
    if (selectedElement) {
        console.log('Selected element:', selectedElement);
        const element = document.querySelector(`[data-element-id="${selectedElement.id}"]`);
        if (element) {
            element.classList.add('selected');
            // Show resize handles for rectangle
            if (selectedElement.type === 'rectangle') {
                const handles = element.querySelectorAll('.resize-handle');
                handles.forEach(handle => handle.style.display = 'block');
            }
            
            // Bring selected element to front
            bringElementToFront(selectedElement);
        }
        updatePropertiesPanel();
        vscode.postMessage({ command: 'log', text: `Selected ${selectedElement.type} element and brought to front` });
    } else {
        console.log('No element selected');
        if (editProperties) {
            editProperties.style.display = 'none';
        }
    }
}

function renderElement(element) {
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
        const textRgba = hexToRgba(element.color, fillOpacity);
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
            const fillRgba = hexToRgba(element.color, fillOpacity);
            elementEl.style.backgroundColor = fillRgba;
            
            // Convert hex to rgba for border color with opacity
            const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
            const borderRgba = hexToRgba(element.borderColor || '#000000', borderOpacity);
            elementEl.style.borderColor = borderRgba;
            
            elementEl.style.transform = 'translate(-50%, -50%)';
        } else if (element.type === 'rectangle') {
            elementEl.style.width = element.size + 'px';
            elementEl.style.height = element.size + 'px';
            
            // Convert hex to rgba for background color with opacity
            const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
            const fillRgba = hexToRgba(element.color, fillOpacity);
            elementEl.style.backgroundColor = fillRgba;
            
            // Convert hex to rgba for border color with opacity
            const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
            const borderRgba = hexToRgba(element.borderColor || '#000000', borderOpacity);
            elementEl.style.borderColor = borderRgba;
            
            elementEl.style.transform = 'translate(-50%, -50%)';
            
            // Add resize handles for rectangle
            addResizeHandles(elementEl, element);
        }
    }
    
    elementEl.setAttribute('data-element-id', element.id);
    
    console.log('Element created:', elementEl);
    console.log('Element styles:', elementEl.style.cssText);
    
    // Add drag functionality
    makeElementDraggable(elementEl, element);
    
    console.log('Adding element to canvas:', editCanvas);
    editCanvas.appendChild(elementEl);
    
    console.log('Canvas children count:', editCanvas.children.length);
    console.log('Canvas innerHTML length:', editCanvas.innerHTML.length);
    
    vscode.postMessage({ command: 'log', text: `Rendered ${element.type} element with ID ${element.id} at (${element.x}, ${element.y})` });
}

function makeElementDraggable(elementEl, element) {
    let isDragging = false;
    let startX, startY;
    
    elementEl.addEventListener('mousedown', (e) => {
        if (currentTool === 'select') {
            isDragging = true;
            startX = e.clientX - element.x;
            startY = e.clientY - element.y;
            e.stopPropagation();
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging && selectedElement && selectedElement.id === element.id) {
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
            if (currentTool === 'select') {
                makeTextEditable(elementEl, element);
                e.stopPropagation();
            }
        });
    }
}

function makeTextEditable(elementEl, element) {
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

function updatePropertiesPanel() {
    if (!selectedElement) return;
    
    shapeColor.value = selectedElement.color;
    shapeSize.value = selectedElement.size;
    textInput.value = selectedElement.text || '';
    fontSize.value = selectedElement.fontSize || 16;
    editProperties.style.display = 'flex';
}



function deleteSelectedElement() {
    if (!selectedElement) return;
    
    const elementEl = document.querySelector(`[data-element-id="${selectedElement.id}"]`);
    if (elementEl) {
        editCanvas.removeChild(elementEl);
    }
    
    elements = elements.filter(el => el.id !== selectedElement.id);
    selectedElement = null;
    editProperties.style.display = 'none';
    
    vscode.postMessage({ command: 'log', text: 'Element deleted' });
}

function saveEditedImage() {
    // Create canvas with image and elements
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size to original image size
    canvas.width = originalWidth;
    canvas.height = originalHeight;
    
    // Apply current filters and transformations
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%)`;
    
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((currentRotation * Math.PI) / 180);
    const scaleX = isFlippedHorizontal ? -1 : 1;
    const scaleY = isFlippedVertical ? -1 : 1;
    ctx.scale(scaleX, scaleY);
    ctx.drawImage(image, -originalWidth / 2, -originalHeight / 2, originalWidth, originalHeight);
    ctx.restore();
    
    // Draw elements
    const canvasRect = editCanvas.getBoundingClientRect();
    const scaleX2 = canvas.width / canvasRect.width;
    const scaleY2 = canvas.height / canvasRect.height;
    
    elements.forEach(element => {
        ctx.save();
        ctx.translate(element.x * scaleX2, element.y * scaleY2);
        
        if (element.type === 'text') {
            ctx.font = `${element.fontSize * scaleX2}px Arial`;
            ctx.fillStyle = element.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(element.text, 0, 0);
        } else if (element.type === 'circle') {
            ctx.fillStyle = element.color;
            ctx.beginPath();
            ctx.arc(0, 0, element.size * scaleX2 / 2, 0, 2 * Math.PI);
            ctx.fill();
        } else if (element.type === 'rectangle') {
            ctx.fillStyle = element.color;
            ctx.fillRect(-element.size * scaleX2 / 2, -element.size * scaleY2 / 2, element.size * scaleX2, element.size * scaleY2);
        }
        
        ctx.restore();
    });
    
    // Save the image
    canvas.toBlob((blob) => {
        if (blob) {
            const reader = new FileReader();
            reader.onload = () => {
                const base64Data = reader.result;
                const base64Content = base64Data.split(',')[1];
                
                const fileName = '{{fileName}}'.replace(/\.[^/.]+$/, '_saved.png');
                
                vscode.postMessage({ 
                    command: 'saveFilteredImage', 
                    fileName: fileName,
                    imageData: base64Content
                });
                
                vscode.postMessage({ command: 'log', text: `Edited image saved as ${fileName}` });
            };
            reader.readAsDataURL(blob);
        } else {
            vscode.postMessage({ command: 'error', text: 'Failed to create edited image' });
        }
    }, 'image/png', 0.9);
}

// Handle canvas mouse events for better interaction
function handleCanvasMouseDown(e) {
    if (!isEditMode || currentTool !== 'select') return;
    // Mouse down handling is done in makeElementDraggable
}

function handleCanvasMouseMove(e) {
    if (!isEditMode) return;
    // Mouse move handling is done in makeElementDraggable
}

function handleCanvasMouseUp(e) {
    if (!isEditMode) return;
    // Mouse up handling is done in makeElementDraggable
}

function updatePropertiesPanel() {
    console.log('updatePropertiesPanel called');
    console.log('selectedElement:', selectedElement);
    console.log('editProperties:', editProperties);
    
    if (!selectedElement || !editProperties) {
        console.log('No selected element or editProperties not found');
        return;
    }
    
    console.log('Updating properties panel with:', {
        color: selectedElement.color,
        size: selectedElement.size,
        text: selectedElement.text,
        fontSize: selectedElement.fontSize
    });
    
    // Show/hide property groups based on element type
    const propertyGroups = editProperties.querySelectorAll('.property-group');
    
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
            group.style.display = selectedElement.type !== 'text' ? 'flex' : 'none';
        } else if (textInput || fontSizeInput) {
            // Show text-related properties only for text elements
            group.style.display = selectedElement.type === 'text' ? 'flex' : 'none';
        }
    });
    
    // Update values
    if (shapeColor) {
        shapeColor.value = selectedElement.color;
        console.log('Set shapeColor to:', shapeColor.value);
    }
    if (borderColor) {
        borderColor.value = selectedElement.borderColor || '#000000';
        console.log('Set borderColor to:', borderColor.value);
    }
    if (fillOpacity) {
        fillOpacity.value = selectedElement.fillOpacity !== undefined ? selectedElement.fillOpacity : 100;
        if (fillOpacityValue) {
            fillOpacityValue.textContent = (selectedElement.fillOpacity !== undefined ? selectedElement.fillOpacity : 100) + '%';
        }
        console.log('Set fillOpacity to:', fillOpacity.value);
    }
    if (borderOpacity) {
        borderOpacity.value = selectedElement.borderOpacity !== undefined ? selectedElement.borderOpacity : 100;
        if (borderOpacityValue) {
            borderOpacityValue.textContent = (selectedElement.borderOpacity !== undefined ? selectedElement.borderOpacity : 100) + '%';
        }
        console.log('Set borderOpacity to:', borderOpacity.value);
    }
    if (shapeSize) {
        shapeSize.value = selectedElement.size;
        console.log('Set shapeSize to:', shapeSize.value);
    }
    if (textInput && selectedElement.type === 'text') {
        textInput.value = selectedElement.text || '';
        console.log('Set textInput to:', textInput.value);
    }
    if (fontSize && selectedElement.type === 'text') {
        fontSize.value = selectedElement.fontSize || 24;
        if (fontSizeInput) {
            fontSizeInput.value = selectedElement.fontSize || 24;
        }
        console.log('Set fontSize to:', fontSize.value);
    }
    
    editProperties.style.display = 'flex';
    console.log('Properties panel displayed');
    
    vscode.postMessage({ command: 'log', text: `Properties panel updated for ${selectedElement.type} element` });
}

// Helper function to handle transparent colors
function handleTransparentColor(colorValue) {
    // If the color is completely transparent (alpha = 0), return 'transparent'
    if (colorValue === '#00000000' || colorValue === 'rgba(0,0,0,0)') {
        return 'transparent';
    }
    return colorValue;
}

// Helper function to convert hex color to rgba
function hexToRgba(hex, alpha) {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Parse hex values
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateSelectedElement() {
    console.log('updateSelectedElement called');
    console.log('selectedElement:', selectedElement);
    
    if (!selectedElement) {
        console.log('No selected element');
        return;
    }
    
    console.log('Before update - color:', selectedElement.color);
    console.log('shapeColor value:', shapeColor ? shapeColor.value : 'shapeColor not found');
    
    if (shapeColor) {
        selectedElement.color = handleTransparentColor(shapeColor.value);
        console.log('Updated color to:', selectedElement.color);
    }
    if (borderColor) {
        selectedElement.borderColor = handleTransparentColor(borderColor.value);
        console.log('Updated border color to:', selectedElement.borderColor);
    }
    if (fillOpacity) {
        selectedElement.fillOpacity = parseInt(fillOpacity.value);
        console.log('Updated fill opacity to:', selectedElement.fillOpacity);
    }
    if (borderOpacity) {
        selectedElement.borderOpacity = parseInt(borderOpacity.value);
        console.log('Updated border opacity to:', selectedElement.borderOpacity);
    }
    if (shapeSize) selectedElement.size = parseInt(shapeSize.value);
    
    // Only update text-related properties for text elements
    if (selectedElement.type === 'text') {
        if (textInput) selectedElement.text = textInput.value;
        if (fontSize) selectedElement.fontSize = parseInt(fontSize.value);
        if (fontSizeInput) selectedElement.fontSize = parseInt(fontSizeInput.value);
    }
    
    console.log('After update - element:', selectedElement);
    
    // Re-render the element
    const elementEl = document.querySelector(`[data-element-id="${selectedElement.id}"]`);
    if (elementEl) {
        console.log('Removing old element');
        elementEl.remove();
    }
    
    console.log('Rendering updated element');
    renderElement(selectedElement);
    
    // Re-select the element
    const newElementEl = document.querySelector(`[data-element-id="${selectedElement.id}"]`);
    if (newElementEl) {
        console.log('Re-selecting element');
        newElementEl.classList.add('selected');
    }
    
    vscode.postMessage({ command: 'log', text: `Updated element color to ${selectedElement.color}` });
}

function addResizeHandles(elementEl, element) {
    const handles = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    
    handles.forEach(handleType => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${handleType}`;
        handle.setAttribute('data-handle-type', handleType);
        handle.style.display = 'none'; // Initially hidden
        elementEl.appendChild(handle);
        
        // Add resize functionality
        makeHandleResizable(handle, elementEl, element, handleType);
    });
}

function makeHandleResizable(handle, elementEl, element, handleType) {
    let isResizing = false;
    let startX, startY, startWidth, startHeight, startElementX, startElementY;
    
    handle.addEventListener('mousedown', (e) => {
        if (currentTool === 'select') {
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

function bringElementToFront(element) {
    // Remove element from current position
    const index = elements.indexOf(element);
    if (index > -1) {
        elements.splice(index, 1);
    }
    
    // Add element to the end (top of the stack)
    elements.push(element);
    
    // Update z-index of all elements to maintain proper stacking order
    elements.forEach((el, i) => {
        const elementEl = document.querySelector(`[data-element-id="${el.id}"]`);
        if (elementEl) {
            elementEl.style.zIndex = 10000 + i;
        }
    });
    
    console.log('Element brought to front:', element.id);
    vscode.postMessage({ command: 'log', text: `Element ${element.id} brought to front` });
}
