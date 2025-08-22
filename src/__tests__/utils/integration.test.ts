import { FileUtils } from '../../utils/fileUtils';
import { TemplateUtils } from '../../utils/templateUtils';
import { MessageHandler, WebviewMessage } from '../../utils/messageHandler';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// 모듈 모킹
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock('vscode', () => ({
  Uri: {
    file: jest.fn((filePath: string) => ({ fsPath: filePath })),
  },
  window: {
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
  },
}));

describe('Utils Integration Tests', () => {
  const mockContext = {
    extensionPath: '/path/to/extension',
  } as vscode.ExtensionContext;

  const mockWebview = {
    asWebviewUri: jest.fn((uri: any) => ({ fsPath: uri.fsPath, scheme: 'vscode-webview' })),
    postMessage: jest.fn(),
    onDidReceiveMessage: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('File processing and template generation workflow', () => {
    it('should process audio file and generate template correctly', async () => {
      // Mock file content
      const mockBuffer = Buffer.from('fake audio content');
      (fs.promises.readFile as jest.Mock).mockResolvedValue(mockBuffer);

      // Mock template
      const mockTemplate = `
        <!DOCTYPE html>
        <html>
          <head><title>{{fileName}}</title></head>
          <body>
            <audio src="{{audioSrc}}"></audio>
          </body>
        </html>
      `;
      (fs.promises.readFile as jest.Mock)
        .mockResolvedValueOnce(mockBuffer) // For fileToDataUrl
        .mockResolvedValueOnce(mockTemplate); // For loadTemplate

      // Step 1: Get MIME type
      const mimeType = FileUtils.getAudioMimeType('/path/to/audio.mp3');
      expect(mimeType).toBe('audio/mpeg');

      // Step 2: Convert file to data URL
      const dataUrl = await FileUtils.fileToDataUrl('/path/to/audio.mp3', mimeType);
      expect(dataUrl).toContain('data:audio/mpeg;base64,');

      // Step 3: Load template with variables
      const html = await TemplateUtils.loadTemplate(mockContext, 'audioViewer.html', {
        fileName: 'audio.mp3',
        audioSrc: dataUrl,
      });

      expect(html).toContain('<title>audio.mp3</title>');
      expect(html).toContain(dataUrl);
    });

    it('should process image file and generate template correctly', async () => {
      // Mock file content
      const mockBuffer = Buffer.from('fake image content');
      (fs.promises.readFile as jest.Mock).mockResolvedValue(mockBuffer);

      // Mock template
      const mockTemplate = `
        <!DOCTYPE html>
        <html>
          <head><title>{{fileName}}</title></head>
          <body>
            <img src="{{imageSrc}}" alt="{{fileName}}">
          </body>
        </html>
      `;
      (fs.promises.readFile as jest.Mock)
        .mockResolvedValueOnce(mockBuffer) // For fileToDataUrl
        .mockResolvedValueOnce(mockTemplate); // For loadTemplate

      // Step 1: Get MIME type
      const mimeType = FileUtils.getImageMimeType('/path/to/image.png');
      expect(mimeType).toBe('image/png');

      // Step 2: Convert file to data URL
      const dataUrl = await FileUtils.fileToDataUrl('/path/to/image.png', mimeType);
      expect(dataUrl).toContain('data:image/png;base64,');

      // Step 3: Load template with variables
      const html = await TemplateUtils.loadTemplate(mockContext, 'imageViewer.html', {
        fileName: 'image.png',
        imageSrc: dataUrl,
      });

      expect(html).toContain('<title>image.png</title>');
      expect(html).toContain(dataUrl);
    });

    it('should handle file processing errors gracefully', async () => {
      // Mock file read error
      const error = new Error('File not found');
      (fs.promises.readFile as jest.Mock).mockRejectedValue(error);

      // Should throw error for file processing
      await expect(
        FileUtils.fileToDataUrl('/path/to/nonexistent.mp3', 'audio/mpeg')
      ).rejects.toThrow('File not found');

      // Should handle template loading error
      (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error('Template not found'));

      await expect(
        TemplateUtils.loadTemplate(mockContext, 'nonexistent.html', {})
      ).rejects.toThrow('Failed to load template: nonexistent.html');
    });
  });

  describe('Message handling integration', () => {
    it('should handle webview messages and show appropriate notifications', () => {
      // Setup message listener
      MessageHandler.setupMessageListener(mockWebview);
      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

      // Test error message
      const errorMessage: WebviewMessage = {
        command: 'error',
        text: 'File processing failed',
      };

      messageHandler(errorMessage);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Webview Error: File processing failed');

      // Test info message
      const infoMessage: WebviewMessage = {
        command: 'info',
        text: 'File loaded successfully',
      };

      messageHandler(infoMessage);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Webview: File loaded successfully');
    });

    it('should handle custom message handlers', () => {
      const customHandler = jest.fn();
      const customHandlers = {
        fileLoaded: customHandler,
      };

      MessageHandler.setupMessageListener(mockWebview, customHandlers);
      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

      const message: WebviewMessage = {
        command: 'fileLoaded',
        text: 'Audio file loaded',
        data: { duration: 120, format: 'mp3' },
      };

      messageHandler(message);
      expect(customHandler).toHaveBeenCalledWith(message);
    });
  });

  describe('Webview options and URI handling', () => {
    it('should configure webview options correctly', () => {
      const options = TemplateUtils.getWebviewOptions(mockContext);

      expect(options.enableScripts).toBe(true);
      expect(options.localResourceRoots).toHaveLength(3);
      expect(options.localResourceRoots).toContainEqual(
        vscode.Uri.file(path.join(mockContext.extensionPath, 'media'))
      );
    });

    it('should convert file paths to webview URIs', () => {
      const filePath = '/path/to/resource.js';
      const uri = TemplateUtils.getWebviewUri(mockContext, mockWebview, filePath);

      expect(vscode.Uri.file).toHaveBeenCalledWith(filePath);
      expect(mockWebview.asWebviewUri).toHaveBeenCalled();
      expect(uri).toBeDefined();
    });
  });

  describe('File size and format validation', () => {
    it('should validate file sizes correctly', async () => {
      // Test file within limit
      const smallBuffer = Buffer.alloc(1024); // 1KB
      (fs.promises.readFile as jest.Mock).mockResolvedValue(smallBuffer);

      await expect(
        FileUtils.fileToDataUrl('/path/to/small.mp3', 'audio/mpeg')
      ).resolves.toBeDefined();

      // Test file exceeding limit
      const largeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51MB
      (fs.promises.readFile as jest.Mock).mockResolvedValue(largeBuffer);

      await expect(
        FileUtils.fileToDataUrl('/path/to/large.mp3', 'audio/mpeg')
      ).rejects.toThrow('File too large');
    });

    it('should format file sizes correctly', () => {
      expect(FileUtils.formatFileSize(0)).toBe('0 Bytes');
      expect(FileUtils.formatFileSize(1024)).toBe('1 KB');
      expect(FileUtils.formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(FileUtils.formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });
  });

  describe('Error handling and logging', () => {
    it('should log appropriate messages during file processing', async () => {
      const mockBuffer = Buffer.alloc(1024);
      (fs.promises.readFile as jest.Mock).mockResolvedValue(mockBuffer);

      await FileUtils.fileToDataUrl('/path/to/test.mp3', 'audio/mpeg');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('File loaded: 0.00MB, MIME type: audio/mpeg')
      );
    });

    it('should handle template loading errors with proper logging', async () => {
      const error = new Error('Template not found');
      (fs.promises.readFile as jest.Mock).mockRejectedValue(error);

      await expect(
        TemplateUtils.loadTemplate(mockContext, 'missing.html', {})
      ).rejects.toThrow('Failed to load template: missing.html');

      expect(console.error).toHaveBeenCalledWith(
        'Error loading template missing.html:',
        error
      );
    });
  });
});
