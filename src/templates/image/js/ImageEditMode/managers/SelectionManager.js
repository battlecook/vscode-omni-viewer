import { DOMUtils } from '../utils/DOMUtils.js';
import { StyleUtils } from '../utils/StyleUtils.js';

/**
 * Selection management class
 * Handles multi-selection and selection state management
 */
export class SelectionManager {
    constructor() {
        this.selectedElements = [];
        this.selectionInfo = document.getElementById('selectionInfo');
    }
    
    /**
     * Select element
     * @param {Object} element - Element to select
     * @param {boolean} isMultiSelect - Multi-select mode
     */
    selectElement(element, isMultiSelect = false) {
        if (isMultiSelect) {
            // Multi-select mode
            const isAlreadySelected = this.selectedElements.some(el => el.id === element.id);
            if (isAlreadySelected) {
                // Deselect if already selected
                this.deselectElement(element);
            } else {
                // Add new element to selection
                this.selectedElements.push(element);
                this.applySelectionStyles(element);
            }
        } else {
            // Single select mode - clear all existing selections
            this.clearAllSelections();
            this.selectedElements = [element];
            this.applySelectionStyles(element);
        }
        
        this.updateSelectionInfo();
    }
    
    /**
     * 요소 선택 해제
     * @param {Object} element - 선택 해제할 요소
     */
    deselectElement(element) {
        const elementEl = DOMUtils.findElementById(element.id);
        if (elementEl) {
            StyleUtils.removeSelectedStyles(elementEl);
            // Hide resize handles
            this.hideResizeHandles(elementEl);
        }
        
        // Remove from array
        this.selectedElements = this.selectedElements.filter(el => el.id !== element.id);
        this.updateSelectionInfo();
    }
    
    /**
     * Clear all selections
     */
    clearAllSelections() {
        this.selectedElements.forEach(element => {
            this.deselectElement(element);
        });
        this.selectedElements = [];
        this.updateSelectionInfo();
    }
    
    /**
     * Get selected elements
     * @returns {Object[]} Selected elements
     */
    getSelectedElements() {
        return [...this.selectedElements];
    }
    
    /**
     * Get selected element count
     * @returns {number} Selected element count
     */
    getSelectedCount() {
        return this.selectedElements.length;
    }
    
    /**
     * Check if there are selected elements
     * @returns {boolean} Whether selected elements exist
     */
    hasSelection() {
        return this.selectedElements.length > 0;
    }
    
    /**
     * Get first selected element
     * @returns {Object|null} First selected element or null
     */
    getFirstSelected() {
        return this.selectedElements.length > 0 ? this.selectedElements[0] : null;
    }
    
    /**
     * Apply selection styles
     * @param {Object} element - Element
     */
    applySelectionStyles(element) {
        const elementEl = DOMUtils.findElementById(element.id);
        if (elementEl) {
            StyleUtils.applySelectedStyles(elementEl);
            // Show resize handles for rectangle
            if (element.type === 'rectangle') {
                this.showResizeHandles(elementEl);
            }
        }
    }
    
    /**
     * Show resize handles
     * @param {HTMLElement} elementEl - Element
     */
    showResizeHandles(elementEl) {
        const handles = elementEl.querySelectorAll('.resize-handle');
        handles.forEach(handle => handle.style.display = 'block');
    }
    
    /**
     * Hide resize handles
     * @param {HTMLElement} elementEl - Element
     */
    hideResizeHandles(elementEl) {
        const handles = elementEl.querySelectorAll('.resize-handle');
        handles.forEach(handle => handle.style.display = 'none');
    }
    
    /**
     * Update selection info
     */
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
    
    /**
     * Check if all selected elements are the same type
     * @returns {boolean} Whether all are the same type
     */
    areAllSameType() {
        if (this.selectedElements.length <= 1) return true;
        const firstType = this.selectedElements[0].type;
        return this.selectedElements.every(element => element.type === firstType);
    }
    
    /**
     * Check if there are text elements among selected elements
     * @returns {boolean} Whether text elements exist
     */
    hasTextElements() {
        return this.selectedElements.some(element => element.type === 'text');
    }
    
    /**
     * Check if there are non-text elements among selected elements
     * @returns {boolean} Whether non-text elements exist
     */
    hasNonTextElements() {
        return this.selectedElements.some(element => element.type !== 'text');
    }
}
