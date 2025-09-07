/**
 * DOM manipulation utility class
 * Provides functionality for DOM element creation, manipulation, and event handling
 */
export class DOMUtils {
    /**
     * Create text element
     * @param {Object} element - Element data
     * @returns {HTMLElement} Created text element
     */
    static createTextElement(element) {
        const elementEl = document.createElement('div');
        elementEl.className = 'text-element';
        elementEl.textContent = element.text;
        elementEl.style.fontSize = element.fontSize + 'px';
        
        return elementEl;
    }
    
    /**
     * Create shape element
     * @param {Object} element - Element data
     * @returns {HTMLElement} Created shape element
     */
    static createShapeElement(element) {
        const elementEl = document.createElement('div');
        elementEl.className = 'shape-element';
        
        if (element.type === 'circle') {
            elementEl.style.width = element.size + 'px';
            elementEl.style.height = element.size + 'px';
            elementEl.style.borderRadius = '50%';
        } else if (element.type === 'rectangle') {
            // Use width and height properties for rectangle
            const width = element.width !== undefined ? element.width : element.size;
            const height = element.height !== undefined ? element.height : element.size;
            elementEl.style.width = width + 'px';
            elementEl.style.height = height + 'px';
        }
        
        return elementEl;
    }
    
    /**
     * Set element attributes
     * @param {HTMLElement} elementEl - DOM element
     * @param {Object} element - Element data
     */
    static setElementAttributes(elementEl, element) {
        elementEl.setAttribute('data-element-id', element.id);
    }
    
    /**
     * Append element to canvas
     * @param {HTMLElement} canvas - Canvas element
     * @param {HTMLElement} elementEl - Element to add
     */
    static appendToCanvas(canvas, elementEl) {
        canvas.appendChild(elementEl);
    }
    
    /**
     * Remove element from canvas
     * @param {HTMLElement} canvas - Canvas element
     * @param {HTMLElement} elementEl - Element to remove
     */
    static removeFromCanvas(canvas, elementEl) {
        if (elementEl && canvas.contains(elementEl)) {
            canvas.removeChild(elementEl);
        }
    }
    
    /**
     * Find element by ID
     * @param {string} elementId - Element ID
     * @returns {HTMLElement|null} Found element or null
     */
    static findElementById(elementId) {
        return document.querySelector(`[data-element-id="${elementId}"]`);
    }
    
    /**
     * Get element bounding rect
     * @param {HTMLElement} element - Element
     * @returns {DOMRect} Bounding rect information
     */
    static getBoundingRect(element) {
        return element.getBoundingClientRect();
    }
    
    /**
     * Check if point is inside element
     * @param {HTMLElement} element - Element
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {HTMLElement} canvas - Canvas element
     * @returns {boolean} Whether point is inside element
     */
    static isPointInElement(element, x, y, canvas) {
        const rect = element.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        
        return x >= rect.left - canvasRect.left && 
               x <= rect.right - canvasRect.left &&
               y >= rect.top - canvasRect.top && 
               y <= rect.bottom - canvasRect.top;
    }
    
    /**
     * Add event listener (safely)
     * @param {HTMLElement} element - Element
     * @param {string} event - Event type
     * @param {Function} handler - Event handler
     * @param {Object} options - Event options
     */
    static addEventListener(element, event, handler, options = {}) {
        if (element && typeof handler === 'function') {
            element.addEventListener(event, handler, options);
        }
    }
    
    /**
     * Set element z-index
     * @param {HTMLElement} element - Element
     * @param {number} zIndex - z-index value
     */
    static setZIndex(element, zIndex) {
        if (element) {
            element.style.zIndex = zIndex.toString();
        }
    }
    
    /**
     * Set element position
     * @param {HTMLElement} element - Element
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     */
    static setPosition(element, x, y) {
        if (element) {
            element.style.left = x + 'px';
            element.style.top = y + 'px';
        }
    }
    
    /**
     * Set element size
     * @param {HTMLElement} element - Element
     * @param {number} width - Width
     * @param {number} height - Height
     */
    static setSize(element, width, height) {
        if (element) {
            element.style.width = width + 'px';
            element.style.height = height + 'px';
        }
    }
}
