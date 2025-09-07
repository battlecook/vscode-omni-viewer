import { ColorUtils } from './ColorUtils.js';

/**
 * Style utility class
 * Provides functionality for managing and updating DOM element styles
 */
export class StyleUtils {
    /**
     * Update text element styles
     * @param {HTMLElement} elementEl - DOM element
     * @param {Object} element - Element data
     */
    static updateTextElementStyles(elementEl, element) {
        elementEl.textContent = element.text;
        elementEl.style.fontSize = element.fontSize + 'px';
        
        // Convert hex to rgba for text color with opacity
        const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
        const textRgba = ColorUtils.hexToRgba(element.color, fillOpacity);
        elementEl.style.color = textRgba;
    }
    
    /**
     * Update circle element styles (including size)
     * @param {HTMLElement} elementEl - DOM element
     * @param {Object} element - Element data
     * @param {boolean} includeSize - Whether to include size update
     */
    static updateCircleElementStyles(elementEl, element, includeSize = false) {
        if (includeSize) {
            elementEl.style.width = element.size + 'px';
            elementEl.style.height = element.size + 'px';
            elementEl.style.borderRadius = '50%';
        }
        
        // Convert hex to rgba for background color with opacity
        const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
        const fillRgba = ColorUtils.hexToRgba(element.color, fillOpacity);
        elementEl.style.backgroundColor = fillRgba;
        
        // Convert hex to rgba for border color with opacity
        const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
        const borderRgba = ColorUtils.hexToRgba(element.borderColor || '#000000', borderOpacity);
        elementEl.style.borderColor = borderRgba;
    }
    
    /**
     * Update rectangle element styles (including size)
     * @param {HTMLElement} elementEl - DOM element
     * @param {Object} element - Element data
     * @param {boolean} includeSize - Whether to include size update
     */
    static updateRectangleElementStyles(elementEl, element, includeSize = false) {
        if (includeSize) {
            // Use width and height properties for rectangle
            const width = element.width !== undefined ? element.width : element.size;
            const height = element.height !== undefined ? element.height : element.size;
            elementEl.style.width = width + 'px';
            elementEl.style.height = height + 'px';
        }
        
        // Convert hex to rgba for background color with opacity
        const fillOpacity = (element.fillOpacity !== undefined ? element.fillOpacity : 100) / 100;
        const fillRgba = ColorUtils.hexToRgba(element.color, fillOpacity);
        elementEl.style.backgroundColor = fillRgba;
        
        // Convert hex to rgba for border color with opacity
        const borderOpacity = (element.borderOpacity !== undefined ? element.borderOpacity : 100) / 100;
        const borderRgba = ColorUtils.hexToRgba(element.borderColor || '#000000', borderOpacity);
        elementEl.style.borderColor = borderRgba;
    }
    
    /**
     * Call appropriate style update method based on element type
     * @param {HTMLElement} elementEl - DOM element
     * @param {Object} element - Element data
     * @param {boolean} includeSize - Whether to include size update
     */
    static updateElementStyles(elementEl, element, includeSize = false) {
        switch (element.type) {
            case 'text':
                this.updateTextElementStyles(elementEl, element);
                break;
            case 'circle':
                this.updateCircleElementStyles(elementEl, element, includeSize);
                break;
            case 'rectangle':
                this.updateRectangleElementStyles(elementEl, element, includeSize);
                break;
        }
    }
    
    /**
     * Set element base styles
     * @param {HTMLElement} elementEl - DOM element
     * @param {Object} element - Element data
     */
    static setElementBaseStyles(elementEl, element) {
        elementEl.style.position = 'absolute';
        elementEl.style.left = element.x + 'px';
        elementEl.style.top = element.y + 'px';
        elementEl.style.zIndex = '10000';
        elementEl.style.pointerEvents = 'auto';
        elementEl.style.cursor = 'move';
        elementEl.style.userSelect = 'none';
        
        if (element.type === 'text') {
            elementEl.style.transform = 'translate(-50%, -50%)';
        } else {
            elementEl.style.transform = 'translate(-50%, -50%)';
        }
    }
    
    /**
     * Apply selected element styles
     * @param {HTMLElement} elementEl - DOM element
     */
    static applySelectedStyles(elementEl) {
        elementEl.classList.add('selected');
    }
    
    /**
     * Remove selected element styles
     * @param {HTMLElement} elementEl - DOM element
     */
    static removeSelectedStyles(elementEl) {
        elementEl.classList.remove('selected');
    }
}
