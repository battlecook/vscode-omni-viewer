/**
 * Client-side encryption for v2 shares (omni-viewer-server docs/API.md §3.6).
 *
 * Envelope: `OVS2` | 12-byte nonce | AES-256-GCM ciphertext + 16-byte tag,
 * with `OVS2` as the additional data. The plaintext is a 4-byte big-endian
 * metadata JSON length, the UTF-8 metadata JSON, then the original file
 * bytes. The key never reaches the server: it travels in the link fragment
 * as `#k=<key>`, the 32 raw bytes in unpadded base64url (exactly 43 chars).
 *
 * Mirrors `app/utils/shareCrypto.ts` in omni-viewer-web and
 * `src/utils/shareCrypto.ts` in omni-viewer-obsidian / omni-viewer-chrome so
 * links round-trip between clients.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// ASCII `OVS2`.
const MAGIC = Buffer.from('OVS2', 'ascii');
const NONCE_LENGTH = 12;
const HEADER_LENGTH = MAGIC.length + NONCE_LENGTH;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const META_LENGTH_PREFIX = 4;
const KEY_FRAGMENT_PREFIX = '#k=';
const ENCODED_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Original file details sealed inside the envelope. */
export interface SharedFileMeta {
    filename: string;
    content_type: string;
    file_type: string;
    file_meta?: Record<string, unknown>;
}

export type ShareLinkKey =
    | { status: 'absent' }
    | { status: 'invalid' }
    | { status: 'valid'; key: Buffer };

/**
 * Raised for anything wrong with the envelope or what it decrypts to. The
 * server cannot check the GCM tag, so a forged or truncated file and a wrong
 * key all land here, and the file must not be shown.
 */
export class ShareDecryptError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ShareDecryptError';
    }
}

export function encodeShareKey(key: Uint8Array): string {
    return Buffer.from(key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Strict: 43 base64url characters that re-encode to themselves, so the
 * unused trailing bits are zero and every platform agrees on one spelling.
 */
export function decodeShareKey(encoded: string): Buffer | null {
    if (!ENCODED_KEY_PATTERN.test(encoded)) return null;
    const key = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/') + '=', 'base64');
    if (key.length !== KEY_LENGTH) return null;
    return encodeShareKey(key) === encoded ? key : null;
}

/**
 * v1 links carry no key. Only a `#k=` fragment marks a v2 link, and it must
 * be exactly `#k=<key>` with nothing else alongside it.
 */
export function readShareLinkKey(hash: string): ShareLinkKey {
    if (!hash.startsWith(KEY_FRAGMENT_PREFIX)) return { status: 'absent' };
    const key = decodeShareKey(hash.slice(KEY_FRAGMENT_PREFIX.length));
    return key ? { status: 'valid', key } : { status: 'invalid' };
}

export function encryptShareFile(fileBytes: Uint8Array, meta: SharedFileMeta): { envelope: Buffer; key: string } {
    // A fresh key per share, so a fresh random nonce never repeats under it.
    const rawKey = randomBytes(KEY_LENGTH);
    const nonce = randomBytes(NONCE_LENGTH);
    const metaBytes = Buffer.from(JSON.stringify(meta), 'utf8');
    const metaLength = Buffer.alloc(META_LENGTH_PREFIX);
    metaLength.writeUInt32BE(metaBytes.length, 0);

    const cipher = createCipheriv('aes-256-gcm', rawKey, nonce, { authTagLength: TAG_LENGTH });
    cipher.setAAD(MAGIC);
    const envelope = Buffer.concat([
        MAGIC,
        nonce,
        cipher.update(metaLength),
        cipher.update(metaBytes),
        cipher.update(fileBytes),
        cipher.final(),
        cipher.getAuthTag()
    ]);
    return { envelope, key: encodeShareKey(rawKey) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The metadata is authenticated, but it was still written by whoever made
 * the link, so its shape is checked rather than cast.
 */
function parseMeta(bytes: Uint8Array): SharedFileMeta {
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new ShareDecryptError('invalid metadata JSON');
    }
    if (!isPlainObject(value)) throw new ShareDecryptError('invalid metadata');
    const { filename, content_type: contentType, file_type: fileType, file_meta: fileMeta } = value;
    if (typeof filename !== 'string' || !filename.trim()) throw new ShareDecryptError('invalid filename');
    if (typeof contentType !== 'string') throw new ShareDecryptError('invalid content_type');
    if (typeof fileType !== 'string') throw new ShareDecryptError('invalid file_type');
    if (fileMeta != null && !isPlainObject(fileMeta)) throw new ShareDecryptError('invalid file_meta');
    return {
        filename,
        content_type: contentType,
        file_type: fileType,
        file_meta: isPlainObject(fileMeta) ? fileMeta : undefined
    };
}

export function decryptShareFile(envelope: Uint8Array, key: Uint8Array): { bytes: Buffer; meta: SharedFileMeta } {
    const bytes = Buffer.from(envelope.buffer, envelope.byteOffset, envelope.byteLength);
    if (bytes.length < HEADER_LENGTH + TAG_LENGTH + META_LENGTH_PREFIX) {
        throw new ShareDecryptError('envelope too short');
    }
    if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new ShareDecryptError('missing OVS2 header');

    let plaintext: Buffer;
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(MAGIC.length, HEADER_LENGTH), {
            authTagLength: TAG_LENGTH
        });
        decipher.setAAD(MAGIC);
        decipher.setAuthTag(bytes.subarray(bytes.length - TAG_LENGTH));
        plaintext = Buffer.concat([decipher.update(bytes.subarray(HEADER_LENGTH, bytes.length - TAG_LENGTH)), decipher.final()]);
    } catch {
        throw new ShareDecryptError('authentication failed');
    }

    if (plaintext.length < META_LENGTH_PREFIX) throw new ShareDecryptError('plaintext too short');
    const metaLength = plaintext.readUInt32BE(0);
    if (metaLength > plaintext.length - META_LENGTH_PREFIX) {
        throw new ShareDecryptError('metadata length out of range');
    }
    const metaEnd = META_LENGTH_PREFIX + metaLength;
    const meta = parseMeta(plaintext.subarray(META_LENGTH_PREFIX, metaEnd));
    return { bytes: plaintext.subarray(metaEnd), meta };
}
