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

import { HAR_SHARE_CONFIRM_ACTION, shareFileCommand } from '../shareCommand';

function fileUri(fsPath: string) {
    return { fsPath, toString: () => `file://${fsPath}` } as unknown as import('vscode').Uri;
}

describe('shareFileCommand HAR confirmation', () => {
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
            expect.stringContaining('cookies, authorization headers'),
            { modal: true },
            HAR_SHARE_CONFIRM_ACTION
        );
        expect(mockWithProgress).not.toHaveBeenCalled();
    });

    it('uploads a .har once the user confirms', async () => {
        mockShowWarningMessage.mockResolvedValue(HAR_SHARE_CONFIRM_ACTION);

        await shareFileCommand(fileUri('/tmp/session.HAR'));

        expect(mockWithProgress).toHaveBeenCalledTimes(1);
    });

    it('warns for a HAR saved as .json while the HAR viewer shows it', async () => {
        const target = fileUri('/tmp/network.json');
        mockActiveTab.input = { uri: target, viewType: 'omni-viewer.harViewer' };
        mockShowWarningMessage.mockResolvedValue(undefined);

        await shareFileCommand(target);

        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockWithProgress).not.toHaveBeenCalled();
    });

    it('shares other files without the HAR warning', async () => {
        await shareFileCommand(fileUri('/tmp/data.json'));

        expect(mockShowWarningMessage).not.toHaveBeenCalled();
        expect(mockWithProgress).toHaveBeenCalledTimes(1);
    });
});
