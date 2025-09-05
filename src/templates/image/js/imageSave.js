export class ImageSave {
    constructor(image, vscode, imageFilters = null) {
        this.image = image;
        this.vscode = vscode;
        this.imageFilters = imageFilters;
        
        // Modal elements
        this.filenameModal = document.getElementById('filenameModal');
        this.filenameInput = document.getElementById('filenameInput');
        this.cancelSaveBtn = document.getElementById('cancelSave');
        this.confirmSaveBtn = document.getElementById('confirmSave');
        this.currentPathSpan = document.getElementById('currentPath');
        
        this.setupModalEventListeners();
    }
    
    setupModalEventListeners() {
        // Modal event listeners
        this.cancelSaveBtn.addEventListener('click', () => {
            this.filenameModal.style.display = 'none';
            this.filenameInput.value = '';
        });

        this.confirmSaveBtn.addEventListener('click', () => {
            const fileName = this.filenameInput.value.trim();
            if (fileName) {
                this.filenameModal.style.display = 'none';
                this.saveFilteredImageWithName(fileName);
            }
        });

        // Close modal on overlay click
        this.filenameModal.addEventListener('click', (e) => {
            if (e.target === this.filenameModal) {
                this.filenameModal.style.display = 'none';
                this.filenameInput.value = '';
            }
        });

        // Handle Enter key in modal
        this.filenameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.confirmSaveBtn.click();
            } else if (e.key === 'Escape') {
                this.cancelSaveBtn.click();
            }
        });

        // Update path when filename changes
        this.filenameInput.addEventListener('input', () => this.updateSavePath());
    }
    
    saveFilteredImage(originalWidth, originalHeight, currentRotation, isFlippedHorizontal, isFlippedVertical, filterString) {
        // Generate default filename with timestamp
        const originalName = '{{fileName}}';
        const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
        const extension = originalName.substring(originalName.lastIndexOf('.'));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const defaultFileName = `${nameWithoutExt}_saved_${timestamp}${extension}`;
        
        // Store the parameters for use in saveFilteredImageWithName
        this.currentRotation = currentRotation;
        this.isFlippedHorizontal = isFlippedHorizontal;
        this.isFlippedVertical = isFlippedVertical;
        this.filterString = filterString;
        
        // Show modal with default filename
        this.filenameInput.value = defaultFileName;
        this.filenameInput.focus();
        this.filenameInput.select();
        this.filenameModal.style.display = 'flex';
        
        // Update path display
        this.updateSavePath();
    }
    
    updateSavePath() {
        const fileName = this.filenameInput.value.trim() || 'filename.png';
        
        // Show workspace path
        const workspacePath = '{{workspacePath}}';
        if (workspacePath) {
            this.currentPathSpan.textContent = `${workspacePath}/${fileName}`;
        } else {
            this.currentPathSpan.textContent = `[Workspace folder]/${fileName}`;
        }
    }
    
    updatePathFromVSCode(path) {
        this.currentPathSpan.textContent = path;
    }
    
    saveFilteredImageWithName(fileName) {
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
        canvas.width = this.image.naturalWidth;
        canvas.height = this.image.naturalHeight;
        
        // Apply current filters to canvas context
        ctx.filter = this.filterString || (this.imageFilters ? this.imageFilters.getFilterString() : '');
        
        // Apply transformations
        ctx.save();
        
        // Move to center for rotation
        ctx.translate(canvas.width / 2, canvas.height / 2);
        
        // Apply rotation
        ctx.rotate(((this.currentRotation || 0) * Math.PI) / 180);
        
        // Apply flips
        const scaleX = (this.isFlippedHorizontal || false) ? -1 : 1;
        const scaleY = (this.isFlippedVertical || false) ? -1 : 1;
        ctx.scale(scaleX, scaleY);
        
        // Draw image centered
        ctx.drawImage(this.image, -this.image.naturalWidth / 2, -this.image.naturalHeight / 2, this.image.naturalWidth, this.image.naturalHeight);
        
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
                    this.vscode.postMessage({ 
                        command: 'saveFilteredImage', 
                        fileName: fileName,
                        imageData: base64Content
                    });
                    
                    this.vscode.postMessage({ command: 'log', text: `Filtered image saved as ${fileName}` });
                };
                reader.readAsDataURL(blob);
            } else {
                this.vscode.postMessage({ command: 'error', text: 'Failed to create filtered image' });
            }
        }, 'image/png', 0.9);
    }
    
    saveEditedImage(elements, originalWidth, originalHeight, currentRotation, isFlippedHorizontal, isFlippedVertical, filterString) {
        // Create canvas with image and elements
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas size to original image size
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        
        // Apply current filters and transformations
        ctx.filter = filterString;
        
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((currentRotation * Math.PI) / 180);
        const scaleX = isFlippedHorizontal ? -1 : 1;
        const scaleY = isFlippedVertical ? -1 : 1;
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(this.image, -originalWidth / 2, -originalHeight / 2, originalWidth, originalHeight);
        ctx.restore();
        
        // Draw elements
        const editCanvas = document.getElementById('editCanvas');
        const canvasRect = editCanvas.getBoundingClientRect();
        const scaleX2 = canvas.width / canvasRect.width;
        const scaleY2 = canvas.height / canvasRect.height;
        
        elements.forEach(element => {
            ctx.save();
            ctx.translate(element.x * scaleX2, element.y * scaleY2);
            
            if (element.type === 'text') {
                ctx.font = `${element.fontSize * scaleX2}px Arial`;
                ctx.fillStyle = element.color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(element.text, 0, 0);
            } else if (element.type === 'circle') {
                ctx.fillStyle = element.color;
                ctx.beginPath();
                ctx.arc(0, 0, element.size * scaleX2 / 2, 0, 2 * Math.PI);
                ctx.fill();
            } else if (element.type === 'rectangle') {
                ctx.fillStyle = element.color;
                ctx.fillRect(-element.size * scaleX2 / 2, -element.size * scaleY2 / 2, element.size * scaleX2, element.size * scaleY2);
            }
            
            ctx.restore();
        });
        
        // Save the image
        canvas.toBlob((blob) => {
            if (blob) {
                const reader = new FileReader();
                reader.onload = () => {
                    const base64Data = reader.result;
                    const base64Content = base64Data.split(',')[1];
                    
                    const fileName = '{{fileName}}'.replace(/\.[^/.]+$/, '_saved.png');
                    
                    this.vscode.postMessage({ 
                        command: 'saveFilteredImage', 
                        fileName: fileName,
                        imageData: base64Content
                    });
                    
                    this.vscode.postMessage({ command: 'log', text: `Edited image saved as ${fileName}` });
                };
                reader.readAsDataURL(blob);
            } else {
                this.vscode.postMessage({ command: 'error', text: 'Failed to create edited image' });
            }
        }, 'image/png', 0.9);
    }
}
