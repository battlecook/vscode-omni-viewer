import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ImageViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.imageViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
            ]
        };

        const imageUri = document.uri;
        const imagePath = imageUri.fsPath;
        const imageFileName = path.basename(imagePath);

        // Read the image file and convert to base64
        let imageData: string;
        try {
            const imageBuffer = await fs.promises.readFile(imagePath);
            const mimeType = this.getMimeType(imagePath);
            imageData = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
        } catch (error) {
            console.error('Error reading image file:', error);
            imageData = '';
        }

        // Get the webview content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, imageData, imageFileName);

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'log':
                        console.log('Image Viewer:', message.text);
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(`Image Viewer Error: ${message.text}`);
                        break;
                }
            }
        );
    }

    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: { [key: string]: string } = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
        };
        return mimeTypes[ext] || 'image/jpeg';
    }

    private getHtmlForWebview(webview: vscode.Webview, imageData: string, fileName: string): string {
        const imageSrc = imageData;
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Viewer - ${fileName}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            overflow: hidden;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
            padding: 20px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .title {
            font-size: 18px;
            font-weight: 600;
        }

        .controls {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .control-group {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .control-group label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn:disabled {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: not-allowed;
        }

        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .image-container {
            flex: 1;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            position: relative;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .image-wrapper {
            position: relative;
            max-width: 100%;
            max-height: 100%;
            transform-origin: center center;
        }

        #image {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            transition: transform 0.3s ease;
        }

        .image-info {
            position: absolute;
            bottom: 10px;
            left: 10px;
            background: var(--vscode-notifications-background);
            color: var(--vscode-notifications-foreground);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            opacity: 0.8;
        }

        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            font-size: 16px;
            color: var(--vscode-descriptionForeground);
        }

        .error {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            color: var(--vscode-errorForeground);
            text-align: center;
            padding: 20px;
        }

        .zoom-controls {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 15px;
            background: var(--vscode-panel-background);
            border-radius: 8px;
            border: 1px solid var(--vscode-panel-border);
        }

        .zoom-slider {
            width: 150px;
        }

        .zoom-value {
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 14px;
            color: var(--vscode-editor-foreground);
            min-width: 60px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="title">🖼️ ${fileName}</div>
            <div class="controls">
                <div class="control-group">
                    <button id="rotateLeft" class="btn">🔄 Left</button>
                    <button id="rotateRight" class="btn">🔄 Right</button>
                </div>
                <div class="control-group">
                    <button id="flipHorizontal" class="btn">↔️ Flip H</button>
                    <button id="flipVertical" class="btn">↕️ Flip V</button>
                </div>
                <div class="control-group">
                    <button id="reset" class="btn">🔄 Reset</button>
                    <button id="fitToScreen" class="btn">📐 Fit</button>
                </div>
            </div>
        </div>

        <div class="main-content">
            <div class="image-container">
                <div id="loading" class="loading">Loading image...</div>
                <div id="error" class="error" style="display: none;"></div>
                <div id="imageWrapper" class="image-wrapper" style="display: none;">
                    <img id="image" src="${imageSrc}" alt="${fileName}">
                    <div id="imageInfo" class="image-info"></div>
                </div>
            </div>

            <div class="zoom-controls">
                <button id="zoomOut" class="btn">🔍-</button>
                <input type="range" id="zoomSlider" class="zoom-slider" min="10" max="500" value="100" step="10">
                <button id="zoomIn" class="btn">🔍+</button>
                <div id="zoomValue" class="zoom-value">100%</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Image state
        let currentZoom = 100;
        let currentRotation = 0;
        let isFlippedHorizontal = false;
        let isFlippedVertical = false;
        let originalWidth = 0;
        let originalHeight = 0;
        
        // DOM elements
        const image = document.getElementById('image');
        const imageWrapper = document.getElementById('imageWrapper');
        const loadingDiv = document.getElementById('loading');
        const errorDiv = document.getElementById('error');
        const imageInfoDiv = document.getElementById('imageInfo');
        const zoomSlider = document.getElementById('zoomSlider');
        const zoomValue = document.getElementById('zoomValue');
        const zoomInBtn = document.getElementById('zoomIn');
        const zoomOutBtn = document.getElementById('zoomOut');
        const rotateLeftBtn = document.getElementById('rotateLeft');
        const rotateRightBtn = document.getElementById('rotateRight');
        const flipHorizontalBtn = document.getElementById('flipHorizontal');
        const flipVerticalBtn = document.getElementById('flipVertical');
        const resetBtn = document.getElementById('reset');
        const fitToScreenBtn = document.getElementById('fitToScreen');

        // Initialize the image viewer
        function initImageViewer() {
            // Set up event listeners
            setupEventListeners();
            
            // Load image
            image.onload = function() {
                originalWidth = image.naturalWidth;
                originalHeight = image.naturalHeight;
                
                loadingDiv.style.display = 'none';
                imageWrapper.style.display = 'block';
                
                updateImageInfo();
                fitToScreen();
                
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
            zoomSlider.addEventListener('input', (e) => {
                currentZoom = parseInt(e.target.value);
                updateZoom();
            });

            zoomInBtn.addEventListener('click', () => {
                currentZoom = Math.min(500, currentZoom + 25);
                zoomSlider.value = currentZoom;
                updateZoom();
            });

            zoomOutBtn.addEventListener('click', () => {
                currentZoom = Math.max(10, currentZoom - 25);
                zoomSlider.value = currentZoom;
                updateZoom();
            });

            // Rotation controls
            rotateLeftBtn.addEventListener('click', () => {
                currentRotation = (currentRotation - 90) % 360;
                updateTransform();
            });

            rotateRightBtn.addEventListener('click', () => {
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
                        rotateLeftBtn.click();
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        rotateRightBtn.click();
                        break;
                }
            });
        }

        function updateZoom() {
            zoomValue.textContent = currentZoom + '%';
            updateTransform();
        }

        function updateTransform() {
            const scale = currentZoom / 100;
            const rotation = currentRotation;
            const flipH = isFlippedHorizontal ? -1 : 1;
            const flipV = isFlippedVertical ? -1 : 1;
            
            image.style.transform = \`scale(\${scale * flipH}, \${scale * flipV}) rotate(\${rotation}deg)\`;
        }

        function updateImageInfo() {
            const displayWidth = Math.round(originalWidth * currentZoom / 100);
            const displayHeight = Math.round(originalHeight * currentZoom / 100);
            
            imageInfoDiv.textContent = \`\${originalWidth}×\${originalHeight} | \${displayWidth}×\${displayHeight} | \${currentZoom}%\`;
        }

        function resetImage() {
            currentZoom = 100;
            currentRotation = 0;
            isFlippedHorizontal = false;
            isFlippedVertical = false;
            
            zoomSlider.value = currentZoom;
            updateZoom();
            updateImageInfo();
        }

        function fitToScreen() {
            const container = imageWrapper.parentElement;
            const containerWidth = container.clientWidth - 40; // padding
            const containerHeight = container.clientHeight - 40; // padding
            
            const scaleX = containerWidth / originalWidth;
            const scaleY = containerHeight / originalHeight;
            const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%
            
            currentZoom = Math.round(scale * 100);
            zoomSlider.value = currentZoom;
            updateZoom();
            updateImageInfo();
        }

        // Initialize when page loads
        document.addEventListener('DOMContentLoaded', initImageViewer);

        // Log to VSCode console
        vscode.postMessage({ command: 'log', text: 'Image viewer initialized' });
    </script>
</body>
</html>`;
    }
}
