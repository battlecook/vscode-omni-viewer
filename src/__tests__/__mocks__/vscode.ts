// VSCode 모듈 모킹
export const Uri = {
  file: jest.fn((path: string) => ({ fsPath: path })),
};

export const window = {
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
};

export const ExtensionContext = jest.fn();

export const CustomDocument = jest.fn();

export const WebviewPanel = jest.fn();

export const CancellationToken = jest.fn();

export const CustomDocumentOpenContext = jest.fn();

export default {
  Uri,
  window,
  ExtensionContext,
  CustomDocument,
  WebviewPanel,
  CancellationToken,
  CustomDocumentOpenContext,
};
