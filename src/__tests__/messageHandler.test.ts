const showSaveDialog = jest.fn();
const writeFile = jest.fn();
const showInformationMessage = jest.fn(() => Promise.resolve(undefined));
const showErrorMessage = jest.fn();

jest.mock('vscode', () => ({
    window: {
        showSaveDialog,
        showInformationMessage,
        showErrorMessage
    },
    workspace: {
        fs: {
            writeFile
        }
    },
    Uri: {
        file: (fsPath: string) => ({ fsPath, scheme: 'file' })
    },
    commands: {
        executeCommand: jest.fn()
    }
}), { virtual: true });
jest.mock('music-metadata', () => ({}), { virtual: true });
jest.mock('hyparquet', () => ({}), { virtual: true });
jest.mock('hwp.js', () => ({}), { virtual: true });
jest.mock('xlsx', () => ({}), { virtual: true });
jest.mock('jszip', () => ({}), { virtual: true });

import { MessageHandler } from '../utils/messageHandler';

describe('MessageHandler delimited save formatting', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('serializes TSV data with tabs instead of commas', () => {
        const output = MessageHandler.convertToDelimitedString(
            ['name', 'note'],
            [['Alice', 'A\tB'], ['Bob', 'Hello, world']],
            '\t'
        );

        expect(output).toBe('name\tnote\nAlice\t"A\tB"\nBob\tHello, world');
    });

    it('uses the current audio file directory as the default save path for region export', async () => {
        const sourceUri = {
            scheme: 'file',
            fsPath: '/Users/a14688/audio/guide1.wav'
        };
        const targetUri = {
            scheme: 'file',
            fsPath: '/Users/a14688/audio/guide1_1.04s-1.89s.wav'
        };

        showSaveDialog.mockResolvedValue(targetUri);
        writeFile.mockResolvedValue(undefined);

        await MessageHandler.handleWebviewMessage(
            {
                command: 'saveRegionFile',
                fileName: 'guide1_1.04s-1.89s.wav',
                blob: Buffer.from('test').toString('base64')
            },
            sourceUri as any
        );

        expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
            defaultUri: expect.objectContaining({
                fsPath: '/Users/a14688/audio/guide1_1.04s-1.89s.wav'
            })
        }));
        expect(writeFile).toHaveBeenCalledWith(
            targetUri,
            expect.any(Buffer)
        );
    });
});
