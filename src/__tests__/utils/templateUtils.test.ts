import { TemplateUtils } from '../../utils/templateUtils';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// fs 모듈 모킹
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

// vscode 모듈 모킹
jest.mock('vscode', () => ({
  Uri: {
    file: jest.fn((filePath: string) => ({ fsPath: filePath })),
  },
}));

describe('TemplateUtils', () => {
  const mockContext = {
    extensionPath: '/path/to/extension',
  } as vscode.ExtensionContext;

  const mockWebview = {
    asWebviewUri: jest.fn((uri: any) => ({ fsPath: uri.fsPath, scheme: 'vscode-webview' })),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadTemplate', () => {
    const mockTemplate = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>{{title}}</title>
        </head>
        <body>
          <h1>{{title}}</h1>
          <p>{{content}}</p>
          <img src="{{imageSrc}}" alt="{{altText}}">
        </body>
      </html>
    `;

    beforeEach(() => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(mockTemplate);
    });

    it('should load template and replace variables correctly', async () => {
      const variables = {
        title: 'Test Page',
        content: 'This is test content',
        imageSrc: 'data:image/png;base64,test',
        altText: 'Test Image',
      };

      const result = await TemplateUtils.loadTemplate(mockContext, 'test.html', variables);

      expect(fs.promises.readFile).toHaveBeenCalledWith(
        path.join(mockContext.extensionPath, 'src', 'templates', 'test.html'),
        'utf8'
      );

      expect(result).toContain('<title>Test Page</title>');
      expect(result).toContain('<h1>Test Page</h1>');
      expect(result).toContain('<p>This is test content</p>');
      expect(result).toContain('<img src="data:image/png;base64,test" alt="Test Image">');
    });

    it('should handle template with no variables', async () => {
      const simpleTemplate = '<html><body>Hello World</body></html>';
      (fs.promises.readFile as jest.Mock).mockResolvedValue(simpleTemplate);

      const result = await TemplateUtils.loadTemplate(mockContext, 'simple.html', {});

      expect(result).toBe(simpleTemplate);
    });

    it('should handle multiple occurrences of the same variable', async () => {
      const template = 'Hello {{name}}, welcome {{name}}!';
      (fs.promises.readFile as jest.Mock).mockResolvedValue(template);

      const result = await TemplateUtils.loadTemplate(mockContext, 'greeting.html', { name: 'John' });

      expect(result).toBe('Hello John, welcome John!');
    });

    it('should handle variables with special characters', async () => {
      const template = '<p>{{content}}</p>';
      (fs.promises.readFile as jest.Mock).mockResolvedValue(template);

      const result = await TemplateUtils.loadTemplate(mockContext, 'special.html', {
        content: 'Text with "quotes" and <tags>',
      });

      expect(result).toBe('<p>Text with "quotes" and <tags></p>');
    });

    it('should throw error when template file not found', async () => {
      const error = new Error('ENOENT: no such file or directory');
      (fs.promises.readFile as jest.Mock).mockRejectedValue(error);

      await expect(
        TemplateUtils.loadTemplate(mockContext, 'nonexistent.html', {})
      ).rejects.toThrow('Failed to load template: nonexistent.html');
    });

    it('should log error when template loading fails', async () => {
      const error = new Error('Permission denied');
      (fs.promises.readFile as jest.Mock).mockRejectedValue(error);

      await expect(
        TemplateUtils.loadTemplate(mockContext, 'protected.html', {})
      ).rejects.toThrow('Failed to load template: protected.html');

      expect(console.error).toHaveBeenCalledWith(
        'Error loading template protected.html:',
        error
      );
    });

    it('should handle empty variables object', async () => {
      const template = '<html><body>{{title}}</body></html>';
      (fs.promises.readFile as jest.Mock).mockResolvedValue(template);

      const result = await TemplateUtils.loadTemplate(mockContext, 'empty.html', {});

      expect(result).toBe('<html><body>{{title}}</body></html>');
    });
  });

  describe('getWebviewUri', () => {
    it('should convert file path to webview URI', () => {
      const filePath = '/path/to/resource.js';
      const result = TemplateUtils.getWebviewUri(mockContext, mockWebview, filePath);

      expect(vscode.Uri.file).toHaveBeenCalledWith(filePath);
      expect(mockWebview.asWebviewUri).toHaveBeenCalledWith({ fsPath: filePath });
      expect(result).toEqual({ fsPath: filePath, scheme: 'vscode-webview' });
    });

    it('should handle relative paths', () => {
      const filePath = 'relative/path/to/resource.css';
      const result = TemplateUtils.getWebviewUri(mockContext, mockWebview, filePath);

      expect(vscode.Uri.file).toHaveBeenCalledWith(filePath);
      expect(result).toEqual({ fsPath: filePath, scheme: 'vscode-webview' });
    });
  });

  describe('getWebviewOptions', () => {
    it('should return correct webview options', () => {
      const result = TemplateUtils.getWebviewOptions(mockContext);

      expect(result).toEqual({
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(mockContext.extensionPath, 'media')),
          vscode.Uri.file(path.join(mockContext.extensionPath, 'node_modules')),
          vscode.Uri.file(path.join(mockContext.extensionPath, 'src', 'templates')),
        ],
      });
    });

    it('should include all required resource roots', () => {
      const result = TemplateUtils.getWebviewOptions(mockContext);

      expect(result.localResourceRoots).toHaveLength(3);
      expect(result.localResourceRoots).toContainEqual(
        vscode.Uri.file(path.join(mockContext.extensionPath, 'media'))
      );
      expect(result.localResourceRoots).toContainEqual(
        vscode.Uri.file(path.join(mockContext.extensionPath, 'node_modules'))
      );
      expect(result.localResourceRoots).toContainEqual(
        vscode.Uri.file(path.join(mockContext.extensionPath, 'src', 'templates'))
      );
    });

    it('should enable scripts', () => {
      const result = TemplateUtils.getWebviewOptions(mockContext);
      expect(result.enableScripts).toBe(true);
    });
  });
});
