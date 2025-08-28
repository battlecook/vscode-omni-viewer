const vscode = acquireVsCodeApi();

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

// Filter elements
const filterControls = document.getElementById('filterControls');
const toggleFiltersBtn = document.getElementById('toggleFilters');
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
const presetReset = document.getElementById('presetReset');

// Modal elements
const filenameModal = document.getElementById('filenameModal');
const filenameInput = document.getElementById('filenameInput');
const cancelSaveBtn = document.getElementById('cancelSave');
const confirmSaveBtn = document.getElementById('confirmSave');
const currentPathSpan = document.getElementById('currentPath');

// Initialize the image viewer
function initImageViewer() {
    // Set up event listeners
    setupEventListeners();
    
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

    // Save filtered image
    saveFilteredBtn.addEventListener('click', () => {
        saveFilteredImage();
    });

    // Toggle filters
    toggleFiltersBtn.addEventListener('click', () => {
        const isVisible = filterControls.style.display !== 'none';
        filterControls.style.display = isVisible ? 'none' : 'flex';
        toggleFiltersBtn.classList.toggle('active', !isVisible);
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
    presetReset.addEventListener('click', () => applyPreset('reset'));

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
        case 'reset':
            brightness = 100; contrast = 100; saturation = 100; grayscale = 0;
            presetReset.classList.add('active');
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
    applyPreset('reset');
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
    const defaultFileName = `${nameWithoutExt}_filtered_${timestamp}${extension}`;
    
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

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initImageViewer);

// Log to VSCode console
vscode.postMessage({ command: 'log', text: 'Image viewer initialized' });
