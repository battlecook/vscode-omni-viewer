jest.mock('vscode', () => ({
    window: {},
    workspace: {},
    Uri: {}
}), { virtual: true });
jest.mock('music-metadata', () => ({}), { virtual: true });
jest.mock('hyparquet', () => ({}), { virtual: true });
jest.mock('hwp.js', () => ({}), { virtual: true });
jest.mock('xlsx', () => ({}), { virtual: true });
jest.mock('jszip', () => ({}), { virtual: true });

import { MessageHandler } from '../utils/messageHandler';

describe('MessageHandler delimited save formatting', () => {
    it('serializes TSV data with tabs instead of commas', () => {
        const output = MessageHandler.convertToDelimitedString(
            ['name', 'note'],
            [['Alice', 'A\tB'], ['Bob', 'Hello, world']],
            '\t'
        );

        expect(output).toBe('name\tnote\nAlice\t"A\tB"\nBob\tHello, world');
    });
});
