import { webcrypto } from 'crypto';
import {
    ShareDecryptError,
    decodeShareKey,
    decryptShareFile,
    encodeShareKey,
    encryptShareFile,
    readShareLinkKey
} from '../utils/shareCrypto';

const MAGIC = new TextEncoder().encode('OVS2');
const META = { filename: 'data.csv', content_type: 'text/csv', file_type: '', file_meta: {} };

describe('shareCrypto', () => {
    it('round-trips the file bytes and sealed metadata', () => {
        const file = Buffer.from('a,b\n1,2\n', 'utf8');
        const { envelope, key } = encryptShareFile(file, META);

        expect(envelope.subarray(0, 4).toString('ascii')).toBe('OVS2');
        // OVS2 + nonce + length prefix + JSON + file + tag.
        expect(envelope.length).toBe(16 + 4 + Buffer.byteLength(JSON.stringify(META)) + file.length + 16);
        expect(envelope.includes(Buffer.from('data.csv'))).toBe(false);
        expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);

        const opened = decryptShareFile(envelope, decodeShareKey(key)!);
        expect(opened.bytes.equals(file)).toBe(true);
        expect(opened.meta).toEqual(META);
    });

    it('uses a fresh key and nonce for every share', () => {
        const a = encryptShareFile(Buffer.from('x'), META);
        const b = encryptShareFile(Buffer.from('x'), META);
        expect(a.key).not.toBe(b.key);
        expect(a.envelope.subarray(4, 16).equals(b.envelope.subarray(4, 16))).toBe(false);
    });

    it('rejects a wrong key, a tampered envelope, and a missing header', () => {
        const { envelope, key } = encryptShareFile(Buffer.from('secret'), META);
        const otherKey = decodeShareKey(encryptShareFile(Buffer.from('x'), META).key)!;
        expect(() => decryptShareFile(envelope, otherKey)).toThrow(ShareDecryptError);

        const tampered = Buffer.from(envelope);
        tampered[tampered.length - 20] ^= 1;
        expect(() => decryptShareFile(tampered, decodeShareKey(key)!)).toThrow('authentication failed');

        const noHeader = Buffer.from(envelope);
        noHeader.write('OVS1', 0, 'ascii');
        expect(() => decryptShareFile(noHeader, decodeShareKey(key)!)).toThrow('missing OVS2 header');
        expect(() => decryptShareFile(envelope.subarray(0, 30), decodeShareKey(key)!)).toThrow('envelope too short');
    });

    it('opens an envelope sealed with WebCrypto, as the web and other clients do', async () => {
        const rawKey = webcrypto.getRandomValues(new Uint8Array(32));
        const nonce = webcrypto.getRandomValues(new Uint8Array(12));
        const metaBytes = new TextEncoder().encode(JSON.stringify({
            filename: 'clip.wav', content_type: 'audio/wav', file_type: 'audio', file_meta: { region_start_sec: 1 }
        }));
        const plaintext = new Uint8Array(4 + metaBytes.length + 3);
        new DataView(plaintext.buffer).setUint32(0, metaBytes.length, false);
        plaintext.set(metaBytes, 4);
        plaintext.set([1, 2, 3], 4 + metaBytes.length);
        const cryptoKey = await webcrypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
        const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt(
            { name: 'AES-GCM', iv: nonce, additionalData: MAGIC, tagLength: 128 }, cryptoKey, plaintext
        ));
        const envelope = Buffer.concat([MAGIC, nonce, ciphertext]);

        const opened = decryptShareFile(envelope, decodeShareKey(encodeShareKey(rawKey))!);
        expect([...opened.bytes]).toEqual([1, 2, 3]);
        expect(opened.meta).toEqual({
            filename: 'clip.wav', content_type: 'audio/wav', file_type: 'audio', file_meta: { region_start_sec: 1 }
        });
    });

    it('produces envelopes WebCrypto can open', async () => {
        const { envelope, key } = encryptShareFile(Buffer.from('hello'), META);
        const cryptoKey = await webcrypto.subtle.importKey('raw', decodeShareKey(key)!, 'AES-GCM', false, ['decrypt']);
        const plaintext = Buffer.from(await webcrypto.subtle.decrypt(
            { name: 'AES-GCM', iv: envelope.subarray(4, 16), additionalData: MAGIC, tagLength: 128 },
            cryptoKey,
            envelope.subarray(16)
        ));
        const metaLength = plaintext.readUInt32BE(0);
        expect(JSON.parse(plaintext.subarray(4, 4 + metaLength).toString('utf8'))).toEqual(META);
        expect(plaintext.subarray(4 + metaLength).toString('utf8')).toBe('hello');
    });

    it('accepts only a canonical 43-character key in exactly `#k=<key>`', () => {
        const key = encodeShareKey(Buffer.alloc(32, 0xab));
        expect(key).toHaveLength(43);
        expect(readShareLinkKey('')).toEqual({ status: 'absent' });
        expect(readShareLinkKey('#other')).toEqual({ status: 'absent' });
        expect(readShareLinkKey(`#k=${key}`).status).toBe('valid');
        expect(readShareLinkKey(`#k=${key}&x=1`).status).toBe('invalid');
        expect(readShareLinkKey(`#k=${key.slice(1)}`).status).toBe('invalid');
        expect(readShareLinkKey(`#k=${key}=`).status).toBe('invalid');
        expect(readShareLinkKey(`#k=${key.slice(0, 42)}+`).status).toBe('invalid');

        // The last character holds 2 unused bits; only the spelling with them zero is accepted.
        const last = key[42];
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        const nonCanonical = key.slice(0, 42) + alphabet[alphabet.indexOf(last) + 1];
        expect(decodeShareKey(nonCanonical)).toBeNull();
    });
});
