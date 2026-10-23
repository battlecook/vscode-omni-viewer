import { EventEmitter } from 'events';

interface Call { method: string; url: string; headers: Record<string, unknown>; body: Buffer }
type Route = (call: Call) => { status: number; body: Buffer | string };

const calls: Call[] = [];
let route: Route = () => ({ status: 500, body: '' });

jest.mock('https', () => ({
    request: (options: { hostname: string; path: string; method: string; headers: Record<string, unknown> },
        onResponse: (res: EventEmitter & { statusCode: number }) => void) => {
        const chunks: Buffer[] = [];
        const req = new EventEmitter() as EventEmitter & { write: (b: Buffer) => void; end: () => void };
        req.write = (b: Buffer) => { chunks.push(Buffer.from(b)); };
        req.end = () => {
            const call = {
                method: options.method,
                url: `https://${options.hostname}${options.path}`,
                headers: options.headers,
                body: Buffer.concat(chunks)
            };
            calls.push(call);
            const { status, body } = route(call);
            const res = Object.assign(new EventEmitter(), { statusCode: status });
            onResponse(res);
            res.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(body));
            res.emit('end');
        };
        return req;
    }
}));

const mockWriteFile = jest.fn();
jest.mock('fs/promises', () => ({
    mkdtemp: jest.fn(async (prefix: string) => `${prefix}XYZ`),
    writeFile: (...args: unknown[]) => mockWriteFile(...args)
}));

const mockShowInputBox = jest.fn();
const mockShowErrorMessage = jest.fn();
const mockExecuteCommand = jest.fn();
const mockClipboardWrite = jest.fn();
const mockReadFile = jest.fn();

jest.mock('vscode', () => ({
    FileType: { File: 1, Directory: 2 },
    ProgressLocation: { Notification: 15 },
    window: {
        showInputBox: (...args: unknown[]) => mockShowInputBox(...args),
        showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(async () => undefined),
        withProgress: async (_opts: unknown, task: () => Promise<void>) => task(),
        tabGroups: { activeTabGroup: { activeTab: undefined } }
    },
    workspace: {
        fs: {
            stat: jest.fn(async () => ({ type: 1, size: 9 })),
            readFile: (...args: unknown[]) => mockReadFile(...args)
        }
    },
    commands: { executeCommand: (...args: unknown[]) => mockExecuteCommand(...args) },
    env: { clipboard: { writeText: (...args: unknown[]) => mockClipboardWrite(...args) }, openExternal: jest.fn() },
    Uri: { parse: jest.fn(), file: (fsPath: string) => ({ fsPath }) }
}), { virtual: true });

import { openSharedLinkCommand, shareFileCommand } from '../shareCommand';
import { decodeShareKey, decryptShareFile, encryptShareFile } from '../utils/shareCrypto';

const API = 'https://omni-viewer-share-624036133562.us-west1.run.app';
const SIGNED = 'https://storage.example.com/object';

function serveTicket(version: 'v1' | 'v2', shareId: string, object: Buffer, ticket: object = {}): Route {
    return ({ url }) => {
        if (url === `${API}/${version}/shares/${shareId}/download`) {
            return { status: 200, body: JSON.stringify({ download_url: SIGNED, content_type: 'application/octet-stream', ...ticket }) };
        }
        if (url === SIGNED) return { status: 200, body: object };
        return { status: 404, body: '{}' };
    };
}

beforeEach(() => {
    calls.length = 0;
    mockWriteFile.mockReset();
    mockShowInputBox.mockReset();
    mockShowErrorMessage.mockReset();
    mockExecuteCommand.mockReset();
    mockClipboardWrite.mockReset();
    mockReadFile.mockReset();
});

describe('shareFileCommand v2 upload', () => {
    it('uploads only an encrypted.bin envelope and copies a #k= link that opens it', async () => {
        const original = Buffer.from('a,b\n1,2\n');
        mockReadFile.mockResolvedValue(new Uint8Array(original));
        route = ({ url }) => {
            if (url === `${API}/v2/share-upload-tokens`) return { status: 201, body: JSON.stringify({ upload_token: 'tok' }) };
            if (url.startsWith(`${API}/v2/shares?`)) {
                return { status: 201, body: JSON.stringify({ share_id: 'abc123', encryption_version: 2 }) };
            }
            return { status: 404, body: '{}' };
        };

        await shareFileCommand({ fsPath: '/work/secret-name.csv', toString: () => 'file:///work/secret-name.csv' } as never);

        expect(mockShowErrorMessage).not.toHaveBeenCalled();
        const upload = calls.find((c) => c.url.startsWith(`${API}/v2/shares?`))!;
        expect(upload.headers['X-Upload-Token']).toBe('tok');
        const body = upload.body.toString('latin1');
        const fields = [...body.matchAll(/; name="([^"]+)"/g)].map((m) => m[1]);
        expect(fields.sort()).toEqual(['file', 'is_paid_user', 'platform']);
        expect(body).toContain('filename="encrypted.bin"');
        expect(body).not.toContain('secret-name');
        expect(calls.some((c) => c.url.includes('/v1/'))).toBe(false);

        const link = mockClipboardWrite.mock.calls[0][0] as string;
        const match = link.match(/^https:\/\/omni-viewer-web\.web\.app\/share\/abc123#k=([A-Za-z0-9_-]{43})$/);
        expect(match).not.toBeNull();
        const start = upload.body.indexOf('OVS2');
        const end = upload.body.lastIndexOf('\r\n--');
        const opened = decryptShareFile(upload.body.subarray(start, end), decodeShareKey(match![1])!);
        expect(opened.bytes.equals(original)).toBe(true);
        expect(opened.meta.filename).toBe('secret-name.csv');
    });

    it('refuses a file whose envelope would exceed the server limit', async () => {
        mockReadFile.mockResolvedValue(new Uint8Array(1024 * 1024 - 40));
        route = () => ({ status: 500, body: '' });

        await shareFileCommand({ fsPath: '/work/big.bin', toString: () => 'file:///work/big.bin' } as never);

        expect(calls).toHaveLength(0);
        expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('max 1 MB'));
    });
});

describe('openSharedLinkCommand', () => {
    it('opens a #k= link through v2 only, saving the sealed filename', async () => {
        const { envelope, key } = encryptShareFile(Buffer.from('hello'), {
            filename: '../../evil/notes.txt', content_type: 'text/plain', file_type: '', file_meta: {}
        });
        route = serveTicket('v2', 'abc', envelope);
        mockShowInputBox.mockResolvedValue(`https://omni-viewer-web.web.app/share/abc#k=${key}`);

        await openSharedLinkCommand();

        expect(mockShowErrorMessage).not.toHaveBeenCalled();
        expect(calls.map((c) => c.url)).toEqual([`${API}/v2/shares/abc/download`, SIGNED]);
        const [savedPath, savedBytes] = mockWriteFile.mock.calls[0];
        expect(savedPath).toMatch(/omni-viewer-share-XYZ[\\/]\.\._\.\._evil_notes\.txt$/);
        expect(Buffer.from(savedBytes).toString()).toBe('hello');
        expect(mockExecuteCommand).toHaveBeenCalledWith('vscode.open', { fsPath: savedPath });
    });

    it('opens a keyless link through v1 only', async () => {
        route = serveTicket('v1', 'abc', Buffer.from('plain'), { filename: 'plain.txt' });
        mockShowInputBox.mockResolvedValue('https://omni-viewer-web.web.app/share/abc');

        await openSharedLinkCommand();

        expect(calls.map((c) => c.url)).toEqual([`${API}/v1/shares/abc/download`, SIGNED]);
        expect(mockWriteFile.mock.calls[0][0]).toMatch(/plain\.txt$/);
    });

    it('never saves or opens a file that fails decryption', async () => {
        const { envelope } = encryptShareFile(Buffer.from('hello'), {
            filename: 'a.txt', content_type: '', file_type: '', file_meta: {}
        });
        const wrongKey = encryptShareFile(Buffer.from('x'), { filename: 'b', content_type: '', file_type: '' }).key;
        route = serveTicket('v2', 'abc', envelope);
        mockShowInputBox.mockResolvedValue(`https://omni-viewer-web.web.app/share/abc#k=${wrongKey}`);

        await openSharedLinkCommand();

        expect(mockWriteFile).not.toHaveBeenCalled();
        expect(mockExecuteCommand).not.toHaveBeenCalled();
        expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('could not decrypt'));
    });

    it('rejects a malformed key before any request', async () => {
        mockShowInputBox.mockImplementation(async (opts: { validateInput: (v: string) => string | null }) => {
            expect(opts.validateInput('https://omni-viewer-web.web.app/share/abc#k=short')).toContain('malformed');
            return 'https://omni-viewer-web.web.app/share/abc#k=short';
        });

        await openSharedLinkCommand();

        expect(calls).toHaveLength(0);
        expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('malformed'));
    });
});
