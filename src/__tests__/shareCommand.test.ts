const mockShowWarningMessage = jest.fn();
const mockWithProgress = jest.fn();
const mockStat = jest.fn();
const mockActiveTab: { input?: unknown } = {};

jest.mock('vscode', () => ({
    FileType: { File: 1, Directory: 2 },
    ProgressLocation: { Notification: 15 },
    window: {
        showWarningMessage: mockShowWarningMessage,
        showErrorMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        withProgress: mockWithProgress,
        tabGroups: { activeTabGroup: { get activeTab() { return mockActiveTab; } } }
    },
    workspace: { fs: { stat: mockStat } },
    env: { clipboard: { writeText: jest.fn() }, openExternal: jest.fn() },
    Uri: { parse: jest.fn() }
}), { virtual: true });

import { SHARE_CONFIRM_ACTION, parseShareInput, shareFileCommand } from '../shareCommand';

function fileUri(fsPath: string) {
    return { fsPath, toString: () => `file://${fsPath}` } as unknown as import('vscode').Uri;
}

describe('shareFileCommand upload confirmation', () => {
    beforeEach(() => {
        mockShowWarningMessage.mockReset();
        mockWithProgress.mockReset();
        mockStat.mockReset().mockResolvedValue({ type: 1, size: 1024 });
        mockActiveTab.input = undefined;
    });

    it('does not upload a .har when the credential warning is dismissed', async () => {
        mockShowWarningMessage.mockResolvedValue(undefined);

        await shareFileCommand(fileUri('/tmp/session.har'));

        expect(mockShowWarningMessage).toHaveBeenCalledWith(
            'Upload session.har and create a share link?',
            expect.objectContaining({ modal: true, detail: expect.stringContaining('cookies, authorization headers') }),
            SHARE_CONFIRM_ACTION
        );
        expect(mockWithProgress).not.toHaveBeenCalled();
    });

    it('uploads a .har once the user confirms', async () => {
        mockShowWarningMessage.mockResolvedValue(SHARE_CONFIRM_ACTION);

        await shareFileCommand(fileUri('/tmp/session.HAR'));

        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockShowWarningMessage.mock.calls[0][1].detail).toContain('uploaded to the Omni Viewer server');
        expect(mockWithProgress).toHaveBeenCalledTimes(1);
    });

    it('warns for a HAR saved as .json while the HAR viewer shows it', async () => {
        const target = fileUri('/tmp/network.json');
        mockActiveTab.input = { uri: target, viewType: 'omni-viewer.harViewer' };
        mockShowWarningMessage.mockResolvedValue(undefined);

        await shareFileCommand(target);

        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockShowWarningMessage.mock.calls[0][1].detail).toContain('cookies, authorization headers');
        expect(mockWithProgress).not.toHaveBeenCalled();
    });

    it('explains server upload and link access before sharing other files', async () => {
        mockShowWarningMessage.mockResolvedValue(SHARE_CONFIRM_ACTION);

        await shareFileCommand(fileUri('/tmp/data.json'));

        expect(mockShowWarningMessage).toHaveBeenCalledWith(
            'Upload data.json and create a share link?',
            { modal: true, detail: expect.any(String) },
            SHARE_CONFIRM_ACTION
        );
        const detail = mockShowWarningMessage.mock.calls[0][1].detail;
        expect(detail).toContain('encrypted on your device');
        expect(detail).toContain('uploaded to the Omni Viewer server');
        expect(detail).toContain('valid for 5 minutes');
        expect(detail).toContain('Anyone with the link can open the file');
        expect(detail).not.toContain('HAR');
        expect(mockWithProgress).toHaveBeenCalledTimes(1);
    });

    it('does not upload a regular file when confirmation is dismissed', async () => {
        await shareFileCommand(fileUri('/tmp/data.json'));

        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockWithProgress).not.toHaveBeenCalled();
    });
});

describe('parseShareInput', () => {
    it('keeps the #k= fragment of a share URL and none for a bare ID', () => {
        expect(parseShareInput('https://omni-viewer-web.web.app/share/abc123#k=KEY')).toEqual({ shareId: 'abc123', fragment: '#k=KEY' });
        expect(parseShareInput(' https://omni-viewer-web.web.app/share/abc123 ')).toEqual({ shareId: 'abc123', fragment: '' });
        expect(parseShareInput('abc123')).toEqual({ shareId: 'abc123', fragment: '' });
        expect(parseShareInput('not a link')).toBeNull();
    });
});
