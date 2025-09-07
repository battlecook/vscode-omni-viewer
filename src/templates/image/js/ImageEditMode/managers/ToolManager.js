
/**
 * Tool management class
 * Handles editing tool selection and state management
 */
export class ToolManager {
    constructor() {
        this.currentTool = 'select';
        this.tools = ['select', 'text', 'circle', 'rectangle'];
        
        // DOM elements
        this.addTextBtn = document.getElementById('addText');
        this.addCircleBtn = document.getElementById('addCircle');
        this.addRectangleBtn = document.getElementById('addRectangle');
        this.selectToolBtn = document.getElementById('selectTool');
        this.editCanvas = document.getElementById('editCanvas');
    }
    
    /**
     * Set tool
     * @param {string} tool - Tool name
     */
    setTool(tool) {
        if (!this.tools.includes(tool)) {
            console.warn(`Unknown tool: ${tool}`);
            return;
        }
        
        console.log('Setting tool to:', tool);
        this.currentTool = tool;
        
        // Update button states
        this.updateButtonStates();
        this.updateCanvasClass();
        
        console.log('Tool set to:', this.currentTool);
        console.log('Button states updated');
    }
    
    /**
     * Get current tool
     * @returns {string} Current tool
     */
    getCurrentTool() {
        return this.currentTool;
    }
    
    /**
     * Update button states
     */
    updateButtonStates() {
        const buttons = [
            { btn: this.addTextBtn, tool: 'text' },
            { btn: this.addCircleBtn, tool: 'circle' },
            { btn: this.addRectangleBtn, tool: 'rectangle' },
            { btn: this.selectToolBtn, tool: 'select' }
        ];
        
        console.log('Updating button states for tool:', this.currentTool);
        
        buttons.forEach(({ btn, tool }) => {
            if (btn) {
                const isActive = tool === this.currentTool;
                btn.classList.toggle('active', isActive);
                console.log(`Button ${tool}:`, btn, 'active:', isActive);
            } else {
                console.warn(`Button for tool ${tool} not found`);
            }
        });
    }
    
    /**
     * Update canvas class
     */
    updateCanvasClass() {
        if (this.editCanvas) {
            this.editCanvas.classList.toggle('select-mode', this.currentTool === 'select');
        }
    }
    
    /**
     * Check if tool is select tool
     * @returns {boolean} Is select tool
     */
    isSelectTool() {
        return this.currentTool === 'select';
    }
    
    /**
     * Check if tool is text tool
     * @returns {boolean} Is text tool
     */
    isTextTool() {
        return this.currentTool === 'text';
    }
    
    /**
     * Check if tool is circle tool
     * @returns {boolean} Is circle tool
     */
    isCircleTool() {
        return this.currentTool === 'circle';
    }
    
    /**
     * Check if tool is rectangle tool
     * @returns {boolean} Is rectangle tool
     */
    isRectangleTool() {
        return this.currentTool === 'rectangle';
    }
    
    /**
     * Setup tool change event listeners
     * @param {Function} onToolChange - Tool change callback
     */
    setupEventListeners(onToolChange) {
        const toolButtons = [
            { btn: this.addTextBtn, tool: 'text' },
            { btn: this.addCircleBtn, tool: 'circle' },
            { btn: this.addRectangleBtn, tool: 'rectangle' },
            { btn: this.selectToolBtn, tool: 'select' }
        ];
        
        toolButtons.forEach(({ btn, tool }) => {
            if (btn) {
                btn.addEventListener('click', () => {
                    console.log(`${tool} button clicked`);
                    this.setTool(tool);
                    if (onToolChange) {
                        onToolChange(tool);
                    }
                });
            }
        });
    }
}
