import { DOMUtils } from '../utils/DOMUtils.js';
import { StyleUtils } from '../utils/StyleUtils.js';
import { ColorUtils } from '../utils/ColorUtils.js';

/**
 * Element management class
 * Handles creation, deletion, and rendering of editing elements
 */
export class ElementManager {
    constructor(editCanvas) {
        this.editCanvas = editCanvas;
        this.elements = [];
        this.nextElementId = 1;
    }
    
    /**
     * Create new element
     * @param {string} type - Element type
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {Object} properties - Element properties
     * @returns {Object} Created element
     */
    createElement(type, x, y, properties = {}) {
        const baseSize = properties.size || 100;
        const element = {
            id: this.nextElementId++,
            type: type,
            x: x,
            y: y,
            color: properties.color || '#ff0000',
            borderColor: properties.borderColor || '#000000',
            fillOpacity: properties.fillOpacity || 100,
            borderOpacity: properties.borderOpacity || 100,
            size: baseSize, // Base size (radius for circle, font size for text)
            width: baseSize, // Rectangle width
            height: baseSize, // Rectangle height
            text: properties.text || 'Text',
            fontSize: properties.fontSize || 24
        };
        
        this.elements.push(element);
        return element;
    }
    
    /**
     * Render element
     * @param {Object} element - Element to render
     */
    renderElement(element) {
        console.log('renderElement called with:', element);
        
        let elementEl;
        
        if (element.type === 'text') {
            elementEl = DOMUtils.createTextElement(element);
        } else {
            elementEl = DOMUtils.createShapeElement(element);
        }
        
        // Set base styles
        StyleUtils.setElementBaseStyles(elementEl, element);
        
        // Apply element-specific styles
        StyleUtils.updateElementStyles(elementEl, element, true);
        
        // Set attributes
        DOMUtils.setElementAttributes(elementEl, element);
        
        // Add to canvas
        DOMUtils.appendToCanvas(this.editCanvas, elementEl);
        
        console.log('Element created:', elementEl);
        
        return elementEl;
    }
    
    /**
     * Delete element
     * @param {Object} element - Element to delete
     */
    deleteElement(element) {
        const elementEl = DOMUtils.findElementById(element.id);
        if (elementEl) {
            DOMUtils.removeFromCanvas(this.editCanvas, elementEl);
        }
        
        // Remove from array
        this.elements = this.elements.filter(el => el.id !== element.id);
    }
    
    /**
     * Delete multiple elements
     * @param {Object[]} elements - Elements to delete
     */
    deleteElements(elements) {
        elements.forEach(element => this.deleteElement(element));
    }
    
    /**
     * Delete all elements
     */
    clearAllElements() {
        this.elements.forEach(element => {
            const elementEl = DOMUtils.findElementById(element.id);
            if (elementEl) {
                DOMUtils.removeFromCanvas(this.editCanvas, elementEl);
            }
        });
        this.elements = [];
        this.nextElementId = 1;
    }
    
    /**
     * Update element
     * @param {Object} element - Element to update
     * @param {Object} properties - New properties
     */
    updateElement(element, properties) {
        // Update element data
        Object.assign(element, properties);
        
        // Find DOM element
        const elementEl = DOMUtils.findElementById(element.id);
        if (elementEl) {
            // Check if size changed
            const sizeChanged = properties.size !== undefined && properties.size !== element.size;
            
            // Update styles
            StyleUtils.updateElementStyles(elementEl, element, sizeChanged);
        } else {
            // Re-render if element not found
            console.log('Element not found, re-rendering');
            this.renderElement(element);
        }
    }
    
    /**
     * Bring element to front
     * @param {Object} element - Element
     */
    bringElementToFront(element) {
        // Remove from array
        const index = this.elements.indexOf(element);
        if (index > -1) {
            this.elements.splice(index, 1);
        }
        
        // Add to end (bring to top)
        this.elements.push(element);
        
        // Update z-index
        this.updateZIndexes();
    }
    
    /**
     * Update z-index of all elements
     */
    updateZIndexes() {
        this.elements.forEach((element, index) => {
            const elementEl = DOMUtils.findElementById(element.id);
            if (elementEl) {
                DOMUtils.setZIndex(elementEl, 10000 + index);
            }
        });
    }
    
    /**
     * Find element at specific position
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object|null} Found element or null
     */
    findElementAt(x, y) {
        // Search in reverse order to check topmost elements first
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const element = this.elements[i];
            const elementEl = DOMUtils.findElementById(element.id);
            if (!elementEl) continue;
            
            if (DOMUtils.isPointInElement(elementEl, x, y, this.editCanvas)) {
                return element;
            }
        }
        return null;
    }
    
    /**
     * Get all elements
     * @returns {Object[]} Element array
     */
    getAllElements() {
        return [...this.elements];
    }
    
    /**
     * Get element count
     * @returns {number} Element count
     */
    getElementCount() {
        return this.elements.length;
    }
    
    /**
     * Find element by ID
     * @param {number} id - Element ID
     * @returns {Object|null} Found element or null
     */
    getElementById(id) {
        return this.elements.find(element => element.id === id);
    }
}
