/**
 * Color utility class
 * Provides functionality for converting hex colors to rgba and handling transparency
 */
export class ColorUtils {
    /**
     * Convert hex color to rgba
     * @param {string} hex - Hex color code (with or without #)
     * @param {number} alpha - Transparency (0-1)
     * @returns {string} rgba color string
     */
    static hexToRgba(hex, alpha) {
        // Remove # if present
        hex = hex.replace('#', '');
        
        // Parse hex values
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    
    /**
     * Handle transparent color
     * @param {string} colorValue - Color value
     * @returns {string} Processed color value
     */
    static handleTransparentColor(colorValue) {
        // If the color is completely transparent (alpha = 0), return 'transparent'
        if (colorValue === '#00000000' || colorValue === 'rgba(0,0,0,0)') {
            return 'transparent';
        }
        return colorValue;
    }
    
    /**
     * Check if color is transparent
     * @param {string} color - Color value
     * @returns {boolean} Whether color is transparent
     */
    static isTransparent(color) {
        return color === 'transparent' || 
               color === '#00000000' || 
               color === 'rgba(0,0,0,0)';
    }
    
    /**
     * Find common color from color array
     * @param {string[]} colors - Color array
     * @returns {string} Common color or 'mixed'
     */
    static getCommonColor(colors) {
        if (colors.length === 0) return '#ff0000';
        if (colors.length === 1) return colors[0];
        
        const allSame = colors.every(color => color === colors[0]);
        return allSame ? colors[0] : 'mixed';
    }
}
