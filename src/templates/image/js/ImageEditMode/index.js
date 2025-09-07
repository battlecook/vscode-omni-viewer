import { ToolManager } from './managers/ToolManager.js';
import { ElementManager } from './managers/ElementManager.js';
import { SelectionManager } from './managers/SelectionManager.js';
import { PropertiesPanel } from './managers/PropertiesPanel.js';
import { DragDropManager } from './managers/DragDropManager.js';
import { ResizeManager } from './managers/ResizeManager.js';
import { EventManager } from './managers/EventManager.js';
import { ColorUtils } from './utils/ColorUtils.js';

/**
 * Main image edit mode class
 * Controller that manages all editing functionality
 */
export class ImageEditMode {
    constructor(image, imageWrapper) {
        this.image = image;
        this.imageWrapper = imageWrapper;
        
        // Edit Mode Variables
        this.isEditMode = false;
        
        // DOM Elements
        this.toggleEditModeBtn = document.getElementById('toggleEditMode');
        this.editControls = document.getElementById('editControls');
        this.editCanvas = document.getElementById('editCanvas');
        this.deleteSelectedBtn = document.getElementById('deleteSelected');
        
        // Initialize managers
        this.toolManager = new ToolManager();
        this.elementManager = new ElementManager(this.editCanvas);
        this.selectionManager = new SelectionManager();
        this.propertiesPanel = new PropertiesPanel();
        this.dragDropManager = new DragDropManager(this.editCanvas, this.elementManager, this.selectionManager);
        this.resizeManager = new ResizeManager();
        this.eventManager = new EventManager();
        
        // Callback for log messages
        this.onLogMessage = null;
    }
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        console.log('Setting up edit mode event listeners...');
        
        // Tool manager events
        this.toolManager.setupEventListeners((tool) => {
            if (this.onLogMessage) {
                this.onLogMessage(`${tool} tool selected`);
            }
        });
        
        // Properties panel events
        this.propertiesPanel.setupEventListeners(() => {
            this.updateSelectedElements();
        });
        
        // Event manager events
        this.eventManager.setupKeyboardListeners({
            onDelete: () => this.deleteSelectedElements(),
            onEscape: () => this.clearAllSelections()
        });
        
        this.eventManager.setupCanvasListeners(this.editCanvas, {
            onCanvasClick: (x, y, isMultiSelect) => this.handleCanvasClick(x, y, isMultiSelect),
            onLogMessage: (message) => {
                if (this.onLogMessage) {
                    this.onLogMessage(message);
                }
            }
        });
        
        this.eventManager.setupDeleteButtonListener(this.deleteSelectedBtn, () => {
            this.deleteSelectedElements();
        });
        
        this.eventManager.setupEditModeToggleListener(
            this.toggleEditModeBtn,
            this.editControls,
            {
                onEnableEditMode: () => this.enableEditMode(),
                onDisableEditMode: () => this.disableEditMode()
            }
        );
        
        console.log('Edit mode event listeners setup complete');
    }
    
    /**
     * Setup edit canvas
     */
    setupEditCanvas() {
        // Wait for image to be fully loaded and positioned
        setTimeout(() => {
            const rect = this.image.getBoundingClientRect();
            const wrapperRect = this.imageWrapper.getBoundingClientRect();
            
            console.log('Image rect:', rect);
            console.log('Wrapper rect:', wrapperRect);
            
            // Use the actual displayed image size
            const canvasWidth = rect.width;
            const canvasHeight = rect.height;
            
            this.editCanvas.style.width = canvasWidth + 'px';
            this.editCanvas.style.height = canvasHeight + 'px';
            this.editCanvas.style.left = rect.left - wrapperRect.left + 'px';
            this.editCanvas.style.top = rect.top - wrapperRect.top + 'px';
            
            if (this.onLogMessage) {
                this.onLogMessage(`Canvas setup: ${canvasWidth}x${canvasHeight} at (${rect.left - wrapperRect.left}, ${rect.top - wrapperRect.top})`);
            }
            
            // Re-render all elements
            this.elementManager.getAllElements().forEach(element => {
                this.elementManager.renderElement(element);
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
    
    /**
     * Handle canvas click
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {boolean} isMultiSelect - Multi-select mode
     */
    handleCanvasClick(x, y, isMultiSelect) {
        if (!this.isEditMode) {
            console.log('Edit mode not active');
            if (this.onLogMessage) {
                this.onLogMessage('Edit mode not active');
            }
            return;
        }
        
        console.log(`Canvas click: (${x}, ${y}), tool: ${this.toolManager.getCurrentTool()}`);
        
        if (this.toolManager.isSelectTool()) {
            this.selectElementAt(x, y, isMultiSelect);
        } else {
            this.addElementAt(x, y);
        }
    }
    
    /**
     * Add element
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     */
    addElementAt(x, y) {
        console.log('addElementAt called with:', x, y, this.toolManager.getCurrentTool());
        
        const properties = this.propertiesPanel.getCurrentProperties();
        const element = this.elementManager.createElement(
            this.toolManager.getCurrentTool(),
            x,
            y,
            properties
        );
        
        console.log('Created element:', element);
        
        // Render element
        const elementEl = this.elementManager.renderElement(element);
        
        // Add drag functionality
        this.dragDropManager.makeElementDraggable(elementEl, element);
        
        // Add resize handles for rectangle
        if (element.type === 'rectangle') {
            this.resizeManager.addResizeHandles(elementEl, element);
        }
        
        // Add double-click edit functionality for text
        if (element.type === 'text') {
            elementEl.addEventListener('dblclick', (e) => {
                if (this.toolManager.isSelectTool()) {
                    this.dragDropManager.makeTextEditable(elementEl, element);
                    e.stopPropagation();
                }
            });
        }
        
        // Select newly created element
        this.selectionManager.selectElement(element, false);
        this.propertiesPanel.updateProperties(this.selectionManager.getSelectedElements());
        
        // Change tool to select (update UI button state as well)
        this.toolManager.setTool('select');
        
        if (this.onLogMessage) {
            this.onLogMessage(`Added ${element.type} element at (${x}, ${y}), total elements: ${this.elementManager.getElementCount()}`);
        }
    }
    
    /**
     * Select element at specific position
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {boolean} isMultiSelect - Multi-select mode
     */
    selectElementAt(x, y, isMultiSelect) {
        console.log('selectElementAt called with:', x, y, 'multiSelect:', isMultiSelect);
        
        const clickedElement = this.elementManager.findElementAt(x, y);
        
        if (clickedElement) {
            this.selectionManager.selectElement(clickedElement, isMultiSelect);
            
            // Bring selected element to front
            this.elementManager.bringElementToFront(clickedElement);
            this.propertiesPanel.updateProperties(this.selectionManager.getSelectedElements());
            
            if (this.onLogMessage) {
                this.onLogMessage(`Selected ${clickedElement.type} element (${this.selectionManager.getSelectedCount()} total selected)`);
            }
        } else {
            // Click on empty space - clear all selections only if not multi-select
            if (!isMultiSelect) {
                this.clearAllSelections();
            }
        }
    }
    
    /**
     * Update selected elements
     */
    updateSelectedElements() {
        console.log('updateSelectedElements called');
        
        const selectedElements = this.selectionManager.getSelectedElements();
        if (selectedElements.length === 0) {
            console.log('No selected elements');
            return;
        }
        
        const properties = this.propertiesPanel.getCurrentProperties();
        
        // Apply properties to all selected elements
        selectedElements.forEach(element => {
            this.elementManager.updateElement(element, properties);
        });
        
        if (this.onLogMessage) {
            this.onLogMessage(`Updated ${selectedElements.length} element(s)`);
        }
    }
    
    /**
     * Delete selected elements
     */
    deleteSelectedElements() {
        const selectedElements = this.selectionManager.getSelectedElements();
        if (selectedElements.length === 0) return;
        
        this.elementManager.deleteElements(selectedElements);
        this.selectionManager.clearAllSelections();
        this.propertiesPanel.show(false);
        
        if (this.onLogMessage) {
            this.onLogMessage(`${selectedElements.length} element(s) deleted`);
        }
    }
    
    /**
     * Clear all selections
     */
    clearAllSelections() {
        this.selectionManager.clearAllSelections();
        this.propertiesPanel.show(false);
    }
    
    /**
     * Enable edit mode
     */
    enableEditMode() {
        console.log('enableEditMode called');
        this.isEditMode = true;
        this.eventManager.setEditMode(true);
        this.editCanvas.classList.add('active');
        
        console.log('Edit mode state:', this.isEditMode);
        console.log('Canvas class list:', this.editCanvas.classList.toString());
        
        // Clear existing elements and setup canvas
        this.elementManager.clearAllElements();
        this.selectionManager.clearAllSelections();
        this.editCanvas.innerHTML = '';
        this.setupEditCanvas();
        
        // Set default tool to select
        this.toolManager.setTool('select');
        
        if (this.onLogMessage) {
            this.onLogMessage('Edit mode enabled');
        }
        
        console.log('Edit mode enabled successfully');
    }
    
    /**
     * Disable edit mode
     */
    disableEditMode() {
        this.isEditMode = false;
        this.eventManager.setEditMode(false);
        this.editCanvas.classList.remove('active');
        this.selectionManager.clearAllSelections();
        this.propertiesPanel.show(false);
        
        if (this.onLogMessage) {
            this.onLogMessage('Edit mode disabled');
        }
    }
    
    /**
     * Get all elements (for saving)
     * @returns {Object[]} All elements
     */
    getAllElements() {
        return this.elementManager.getAllElements();
    }
}
