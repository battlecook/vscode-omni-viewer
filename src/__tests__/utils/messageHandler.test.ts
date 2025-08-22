import { MessageHandler, WebviewMessage } from '../../utils/messageHandler';
import * as vscode from 'vscode';

// vscode 모듈 모킹
jest.mock('vscode', () => ({
  window: {
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
  },
}));

describe('MessageHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleWebviewMessage', () => {
    it('should handle log messages', () => {
      const message: WebviewMessage = {
        command: 'log',
        text: 'Test log message',
      };

      MessageHandler.handleWebviewMessage(message);

      expect(console.log).toHaveBeenCalledWith('Webview:', 'Test log message');
    });

    it('should handle error messages', () => {
      const message: WebviewMessage = {
        command: 'error',
        text: 'Test error message',
      };

      MessageHandler.handleWebviewMessage(message);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Webview Error: Test error message');
    });

    it('should handle info messages', () => {
      const message: WebviewMessage = {
        command: 'info',
        text: 'Test info message',
      };

      MessageHandler.handleWebviewMessage(message);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Webview: Test info message');
    });

    it('should handle warning messages', () => {
      const message: WebviewMessage = {
        command: 'warning',
        text: 'Test warning message',
      };

      MessageHandler.handleWebviewMessage(message);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Webview: Test warning message');
    });

    it('should handle unknown commands', () => {
      const message: WebviewMessage = {
        command: 'unknown',
        text: 'Unknown command',
      };

      MessageHandler.handleWebviewMessage(message);

      expect(console.log).toHaveBeenCalledWith('Unknown message command:', 'unknown');
    });

    it('should handle messages without text', () => {
      const message: WebviewMessage = {
        command: 'log',
      };

      MessageHandler.handleWebviewMessage(message);

      expect(console.log).toHaveBeenCalledWith('Webview:', undefined);
    });

    it('should handle messages with data', () => {
      const message: WebviewMessage = {
        command: 'log',
        text: 'Test message',
        data: { key: 'value' },
      };

      MessageHandler.handleWebviewMessage(message);

      expect(console.log).toHaveBeenCalledWith('Webview:', 'Test message');
    });
  });

  describe('postMessage', () => {
    it('should post message to webview', () => {
      const mockWebview = {
        postMessage: jest.fn(),
      } as any;

      const message: WebviewMessage = {
        command: 'test',
        text: 'Test message',
      };

      MessageHandler.postMessage(mockWebview, message);

      expect(mockWebview.postMessage).toHaveBeenCalledWith(message);
    });

    it('should post message with data', () => {
      const mockWebview = {
        postMessage: jest.fn(),
      } as any;

      const message: WebviewMessage = {
        command: 'data',
        data: { result: 'success' },
      };

      MessageHandler.postMessage(mockWebview, message);

      expect(mockWebview.postMessage).toHaveBeenCalledWith(message);
    });
  });

  describe('setupMessageListener', () => {
    it('should setup message listener with default handlers', () => {
      const mockWebview = {
        onDidReceiveMessage: jest.fn(() => ({ dispose: jest.fn() })),
      } as any;

      const disposable = MessageHandler.setupMessageListener(mockWebview);

      expect(mockWebview.onDidReceiveMessage).toHaveBeenCalled();
      expect(disposable).toBeDefined();
    });

    it('should use custom handler when provided', () => {
      const mockWebview = {
        onDidReceiveMessage: jest.fn(),
      } as any;

      const customHandler = jest.fn();
      const customHandlers = {
        custom: customHandler,
      };

      MessageHandler.setupMessageListener(mockWebview, customHandlers);

      // Simulate message received
      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      const message: WebviewMessage = {
        command: 'custom',
        text: 'Custom message',
      };

      messageHandler(message);

      expect(customHandler).toHaveBeenCalledWith(message);
      expect(console.log).not.toHaveBeenCalledWith('Unknown message command:', 'custom');
    });

    it('should fall back to default handler for unknown commands', () => {
      const mockWebview = {
        onDidReceiveMessage: jest.fn(),
      } as any;

      const customHandler = jest.fn();
      const customHandlers = {
        custom: customHandler,
      };

      MessageHandler.setupMessageListener(mockWebview, customHandlers);

      // Simulate message received
      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      const message: WebviewMessage = {
        command: 'unknown',
        text: 'Unknown message',
      };

      messageHandler(message);

      expect(customHandler).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('Unknown message command:', 'unknown');
    });

    it('should handle multiple custom handlers', () => {
      const mockWebview = {
        onDidReceiveMessage: jest.fn(),
      } as any;

      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const customHandlers = {
        command1: handler1,
        command2: handler2,
      };

      MessageHandler.setupMessageListener(mockWebview, customHandlers);

      // Simulate messages received
      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      
      const message1: WebviewMessage = {
        command: 'command1',
        text: 'Message 1',
      };
      const message2: WebviewMessage = {
        command: 'command2',
        text: 'Message 2',
      };

      messageHandler(message1);
      messageHandler(message2);

      expect(handler1).toHaveBeenCalledWith(message1);
      expect(handler2).toHaveBeenCalledWith(message2);
    });

    it('should handle error messages with custom handlers', () => {
      const mockWebview = {
        onDidReceiveMessage: jest.fn(),
      } as any;

      const customHandler = jest.fn();
      const customHandlers = {
        error: customHandler,
      };

      MessageHandler.setupMessageListener(mockWebview, customHandlers);

      // Simulate message received
      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      const message: WebviewMessage = {
        command: 'error',
        text: 'Error message',
      };

      messageHandler(message);

      expect(customHandler).toHaveBeenCalledWith(message);
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('should return disposable object', () => {
      const mockWebview = {
        onDidReceiveMessage: jest.fn(() => ({
          dispose: jest.fn(),
        })),
      } as any;

      const disposable = MessageHandler.setupMessageListener(mockWebview);

      expect(disposable).toBeDefined();
      expect(typeof disposable.dispose).toBe('function');
    });
  });

  describe('WebviewMessage interface', () => {
    it('should accept valid message structure', () => {
      const message: WebviewMessage = {
        command: 'test',
        text: 'Test message',
        data: { key: 'value' },
      };

      expect(message.command).toBe('test');
      expect(message.text).toBe('Test message');
      expect(message.data).toEqual({ key: 'value' });
    });

    it('should accept message with only command', () => {
      const message: WebviewMessage = {
        command: 'test',
      };

      expect(message.command).toBe('test');
      expect(message.text).toBeUndefined();
      expect(message.data).toBeUndefined();
    });
  });
});
