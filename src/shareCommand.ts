import * as vscode from 'vscode';
import * as https from 'https';
import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';
import { URL } from 'url';

const SHARE_API_BASE = 'https://omni-viewer-share-624036133562.us-west1.run.app';
const WEB_BASE = 'https://omni-viewer-web.web.app';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_EXPIRES_IN_MINUTES = 60;
const SHARE_PATH_PATTERN = /\/share\/([^/?#]+)/;
const BARE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

interface HttpResponse {
    status: number;
    body: Buffer;
}

interface UploadTokenResponse {
    upload_token: string;
    token_type?: string;
    expires_in?: number;
    platform?: string;
}

interface CreateShareResponse {
    share_id: string;
    download_url: string;
    expires_at: string;
    filename: string;
    file_size: number;
    content_type: string;
}

interface DownloadTicket {
    download_url: string;
    filename: string;
    content_type: string;
    file_type?: string;
    file_meta?: Record<string, unknown>;
}

function send(method: string, url: string, headers: Record<string, string | number>, body?: Buffer): Promise<HttpResponse> {
    const u = new URL(url);
    const port = u.port ? Number(u.port) : 443;
    const finalHeaders: Record<string, string | number> = { ...headers };
    if (body !== undefined) {
        finalHeaders['Content-Length'] = body.length;
    }
    const options: https.RequestOptions = {
        hostname: u.hostname,
        port,
        path: u.pathname + u.search,
        method,
        headers: finalHeaders
    };
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) });
            });
        });
        req.on('error', reject);
        if (body !== undefined) {
            req.write(body);
        }
        req.end();
    });
}

function postJson(url: string, payload: object, extraHeaders: Record<string, string> = {}): Promise<HttpResponse> {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    return send('POST', url, { 'Content-Type': 'application/json', ...extraHeaders }, body);
}

interface MultipartPart {
    name: string;
    value: string | Buffer;
    filename?: string;
    contentType?: string;
}

function buildMultipartBody(parts: MultipartPart[]): { body: Buffer; contentType: string } {
    const boundary = `----OmniViewerBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const segments: Buffer[] = [];
    for (const part of parts) {
        const escapedName = part.name.replace(/"/g, '\\"');
        let header = `--${boundary}\r\nContent-Disposition: form-data; name="${escapedName}"`;
        if (part.filename !== undefined) {
            const escapedFilename = part.filename.replace(/"/g, '\\"');
            header += `; filename="${escapedFilename}"`;
        }
        header += '\r\n';
        if (part.contentType) {
            header += `Content-Type: ${part.contentType}\r\n`;
        }
        header += '\r\n';
        segments.push(Buffer.from(header, 'utf8'));
        segments.push(typeof part.value === 'string' ? Buffer.from(part.value, 'utf8') : part.value);
        segments.push(Buffer.from('\r\n', 'utf8'));
    }
    segments.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return {
        body: Buffer.concat(segments),
        contentType: `multipart/form-data; boundary=${boundary}`
    };
}

function postMultipart(url: string, parts: MultipartPart[], extraHeaders: Record<string, string> = {}): Promise<HttpResponse> {
    const { body, contentType } = buildMultipartBody(parts);
    return send('POST', url, { 'Content-Type': contentType, ...extraHeaders }, body);
}

function extractErrorMessage(res: HttpResponse): string {
    const trimmed = res.body.toString('utf8').trim();
    if (trimmed) {
        try {
            const parsed = JSON.parse(trimmed) as { error?: { message?: string; code?: string }; message?: string };
            const fromError = parsed?.error?.message;
            if (typeof fromError === 'string' && fromError.trim()) return fromError.trim();
            const fromTop = parsed?.message;
            if (typeof fromTop === 'string' && fromTop.trim()) return fromTop.trim();
        } catch {
            return trimmed;
        }
    }
    return `Request failed with status ${res.status}`;
}

async function fetchUploadToken(): Promise<string> {
    const res = await postJson(`${SHARE_API_BASE}/v1/share-upload-tokens`, { platform: 'vscode' });
    if (res.status < 200 || res.status >= 300) {
        throw new Error(extractErrorMessage(res));
    }
    let parsed: UploadTokenResponse;
    try {
        parsed = JSON.parse(res.body.toString('utf8')) as UploadTokenResponse;
    } catch {
        throw new Error('Invalid response from upload token endpoint.');
    }
    if (!parsed?.upload_token) {
        throw new Error('Upload token missing in response.');
    }
    return parsed.upload_token;
}

async function uploadShare(uri: vscode.Uri, token: string): Promise<CreateShareResponse> {
    const filePath = uri.fsPath;
    const fileBytes = await vscode.workspace.fs.readFile(uri);
    const filename = path.basename(filePath);

    const url = `${SHARE_API_BASE}/v1/shares?expires_in_minutes=${DEFAULT_EXPIRES_IN_MINUTES}`;
    const res = await postMultipart(
        url,
        [
            { name: 'platform', value: 'vscode' },
            { name: 'is_paid_user', value: 'false' },
            { name: 'file', value: Buffer.from(fileBytes), filename, contentType: 'application/octet-stream' }
        ],
        { 'X-Upload-Token': token }
    );
    if (res.status < 200 || res.status >= 300) {
        throw new Error(extractErrorMessage(res));
    }
    try {
        return JSON.parse(res.body.toString('utf8')) as CreateShareResponse;
    } catch {
        throw new Error('Invalid response from share upload endpoint.');
    }
}

function getActiveCustomEditorUri(): vscode.Uri | undefined {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = activeTab?.input as { uri?: vscode.Uri } | undefined;
    return input?.uri;
}

export async function shareFileCommand(uri?: vscode.Uri): Promise<void> {
    const target = uri ?? getActiveCustomEditorUri();
    if (!target) {
        vscode.window.showErrorMessage('Omni Viewer: no file selected to share.');
        return;
    }

    let stat: vscode.FileStat;
    try {
        stat = await vscode.workspace.fs.stat(target);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Omni Viewer: cannot read file (${message}).`);
        return;
    }

    if (stat.type === vscode.FileType.Directory) {
        vscode.window.showErrorMessage('Omni Viewer: directories cannot be shared.');
        return;
    }
    if (stat.size > MAX_FILE_SIZE_BYTES) {
        vscode.window.showErrorMessage('Omni Viewer: file is too large to share (max 10 MB).');
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Omni Viewer: uploading ${path.basename(target.fsPath)}…`,
            cancellable: false
        },
        async () => {
            try {
                const token = await fetchUploadToken();
                const share = await uploadShare(target, token);
                const shareUrl = `${WEB_BASE}/share/${encodeURIComponent(share.share_id)}`;
                await vscode.env.clipboard.writeText(shareUrl);

                const action = await vscode.window.showInformationMessage(
                    `Share link copied to clipboard: ${shareUrl}`,
                    'Open in Browser'
                );
                if (action === 'Open in Browser') {
                    await vscode.env.openExternal(vscode.Uri.parse(shareUrl));
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Omni Viewer: share failed — ${message}`);
            }
        }
    );
}

function parseShareId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const match = trimmed.match(SHARE_PATH_PATTERN);
    if (match && match[1]) {
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return match[1];
        }
    }
    if (BARE_ID_PATTERN.test(trimmed)) {
        return trimmed;
    }
    return null;
}

async function fetchTicket(shareId: string): Promise<DownloadTicket> {
    const url = `${SHARE_API_BASE}/v1/shares/${encodeURIComponent(shareId)}/download`;
    const res = await send('GET', url, {});
    if (res.status === 404) {
        throw new Error('Shared file not found.');
    }
    if (res.status === 410) {
        throw new Error('Shared file has expired or reached its access limit.');
    }
    if (res.status < 200 || res.status >= 300) {
        throw new Error(extractErrorMessage(res));
    }
    try {
        return JSON.parse(res.body.toString('utf8')) as DownloadTicket;
    } catch {
        throw new Error('Invalid response from download endpoint.');
    }
}

async function downloadBytes(url: string): Promise<Buffer> {
    const res = await send('GET', url, {});
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`Download failed with status ${res.status}`);
    }
    return res.body;
}

function sanitizeFilename(name: string): string {
    let cleaned = '';
    for (const ch of name) {
        const code = ch.charCodeAt(0);
        if (ch === '/' || ch === '\\' || code < 0x20) {
            cleaned += '_';
        } else {
            cleaned += ch;
        }
    }
    cleaned = cleaned.trim().slice(0, 200);
    return cleaned || 'shared-file';
}

export async function openSharedLinkCommand(): Promise<void> {
    const input = await vscode.window.showInputBox({
        prompt: 'Enter Omni Viewer share URL or share ID',
        placeHolder: `${WEB_BASE}/share/<id> or <id>`,
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value.trim()) return 'Please enter a share URL or ID.';
            if (!parseShareId(value)) return 'Invalid share URL or ID.';
            return null;
        }
    });
    if (!input) return;

    const shareId = parseShareId(input);
    if (!shareId) {
        vscode.window.showErrorMessage('Omni Viewer: invalid share URL or ID.');
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Omni Viewer: downloading shared file…',
            cancellable: false
        },
        async () => {
            try {
                const ticket = await fetchTicket(shareId);
                const bytes = await downloadBytes(ticket.download_url);
                const safeName = sanitizeFilename(ticket.filename || `share-${shareId}`);
                const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omni-viewer-share-'));
                const filePath = path.join(dir, safeName);
                await fsp.writeFile(filePath, bytes);
                const fileUri = vscode.Uri.file(filePath);
                await vscode.commands.executeCommand('vscode.open', fileUri);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Omni Viewer: download failed — ${message}`);
            }
        }
    );
}
