export class ImageUtils {
    constructor() {
        // Utility functions for image processing
    }
    
    // Helper function to handle transparent colors
    handleTransparentColor(colorValue) {
        // If the color is completely transparent (alpha = 0), return 'transparent'
        if (colorValue === '#00000000' || colorValue === 'rgba(0,0,0,0)') {
            return 'transparent';
        }
        return colorValue;
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
    
    // Helper function to validate filename
    validateFilename(fileName, originalExtension) {
        if (!fileName.toLowerCase().endsWith(originalExtension.toLowerCase())) {
            return `Filename should end with ${originalExtension}`;
        }
        
        const invalidChars = /[<>:"/\\|?*]/;
        if (invalidChars.test(fileName)) {
            return 'Filename contains invalid characters';
        }
        
        return null; // No error
    }
    
    // Helper function to generate default filename with timestamp
    generateDefaultFilename(originalName) {
        const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
        const extension = originalName.substring(originalName.lastIndexOf('.'));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `${nameWithoutExt}_saved_${timestamp}${extension}`;
    }
    
    // Helper function to get workspace path
    getWorkspacePath() {
        return '{{workspacePath}}';
    }
    
    // Helper function to get file name
    getFileName() {
        return '{{fileName}}';
    }
    
    // Helper function to get file size
    getFileSize() {
        return '{{fileSize}}';
    }
}
