console.log('Image viewer script loading...');

const vscode = acquireVsCodeApi();

console.log('VSCode API acquired');

// Import modules
import { ImageFilters } from './imageFilters.js';
import { ImageEditMode } from './imageEditMode.js';
import { ImageUtils } from './imageUtils.js';
import { ImageSave } from './imageSave.js';

// Image state
let currentZoom = 100;
let currentRotation = 0;
let isFlippedHorizontal = false;
let isFlippedVertical = false;
let originalWidth = 0;
let originalHeight = 0;
let imageFormat = '';
let fileSize = '';

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

// Initialize modules
const imageFilters = new ImageFilters(image);
const imageEditMode = new ImageEditMode(image, imageWrapper);
const imageUtils = new ImageUtils();
const imageSave = new ImageSave(image, vscode, imageFilters);

// Set up callback for log messages
imageEditMode.onLogMessage = (message) => {
    vscode.postMessage({ command: 'log', text: message });
};

// Initialize the image viewer
function initImageViewer() {
    console.log('Initializing image viewer...');
    
    // Set up event listeners
    setupEventListeners();
    imageEditMode.setupEventListeners();
    
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
            imageEditMode.setupEditCanvas();
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
        if (imageEditMode.elements.length > 0) {
            // If there are edit elements, save with them
            imageSave.saveEditedImage(imageEditMode.elements, originalWidth, originalHeight, currentRotation, isFlippedHorizontal, isFlippedVertical, imageFilters.getFilterString());
        } else {
            // If no edit elements, save filtered image only
            imageSave.saveFilteredImage(originalWidth, originalHeight, currentRotation, isFlippedHorizontal, isFlippedVertical, imageFilters.getFilterString());
        }
    });

    // Toggle edit mode (includes filters)
    const toggleEditModeBtn = document.getElementById('toggleEditMode');
    const editControls = document.getElementById('editControls');
    
    toggleEditModeBtn.addEventListener('click', () => {
        const isVisible = editControls.style.display !== 'none';
        editControls.style.display = isVisible ? 'none' : 'flex';
        toggleEditModeBtn.classList.toggle('active', !isVisible);
        
        if (!isVisible) {
            // Enable edit mode
            imageEditMode.enableEditMode();
            vscode.postMessage({ command: 'log', text: 'Edit mode enabled' });
        } else {
            // Disable edit mode
            imageEditMode.disableEditMode();
            vscode.postMessage({ command: 'log', text: 'Edit mode disabled' });
        }
    });

    // Filter controls
    imageFilters.setupEventListeners();

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
    if (imageEditMode.isEditMode) {
        imageEditMode.setupEditCanvas();
    }
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
    imageFilters.resetFilters();
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

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');
    initImageViewer();
});

// Log to VSCode console
vscode.postMessage({ command: 'log', text: 'Image viewer initialized' });
