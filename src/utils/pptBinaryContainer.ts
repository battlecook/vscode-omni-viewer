import type { CfbEntry, CfbParseResult, PptRecord } from './pptBinaryTypes';

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

export function parseCfb(file: Buffer): CfbParseResult {
    if (file.length < 512) {
        throw new Error('Invalid CFB file: too small.');
    }
    const signature = file.slice(0, 8).toString('hex');
    if (signature !== 'd0cf11e0a1b11ae1') {
        throw new Error('Invalid CFB signature.');
    }

    const sectorShift = file.readUInt16LE(30);
    const miniSectorShift = file.readUInt16LE(32);
    const sectorSize = 1 << sectorShift;
    const miniSectorSize = 1 << miniSectorShift;

    const numFatSectors = file.readUInt32LE(44);
    const firstDirSector = file.readInt32LE(48);
    const miniCutoff = file.readUInt32LE(56);
    const firstMiniFatSector = file.readInt32LE(60);
    const numMiniFatSectors = file.readUInt32LE(64);
    const firstDifatSector = file.readInt32LE(68);
    const numDifatSectors = file.readUInt32LE(72);

    const readSector = (sid: number): Buffer => {
        const offset = (sid + 1) * sectorSize;
        if (offset < 0 || offset + sectorSize > file.length) {
            return Buffer.alloc(0);
        }
        return file.slice(offset, offset + sectorSize);
    };

    const difat: number[] = [];
    for (let i = 0; i < 109; i++) {
        const sid = file.readInt32LE(76 + i * 4);
        if (sid !== -1) difat.push(sid);
    }

    let nextDifat = firstDifatSector;
    for (let i = 0; i < numDifatSectors && nextDifat !== ENDOFCHAIN && nextDifat !== -1; i++) {
        const sec = readSector(nextDifat);
        if (sec.length === 0) break;
        const entriesPerSector = sectorSize / 4 - 1;
        for (let j = 0; j < entriesPerSector; j++) {
            const sid = sec.readInt32LE(j * 4);
            if (sid !== -1) difat.push(sid);
        }
        nextDifat = sec.readInt32LE(sectorSize - 4);
    }

    const fatSectors = difat.slice(0, numFatSectors);
    const fat: number[] = [];
    fatSectors.forEach((sid) => {
        const sec = readSector(sid);
        if (sec.length === 0) {
            return;
        }
        for (let i = 0; i < sectorSize; i += 4) {
            fat.push(sec.readInt32LE(i));
        }
    });

    const readChain = (startSid: number): Buffer => {
        if (startSid < 0 || startSid === ENDOFCHAIN) {
            return Buffer.alloc(0);
        }

        const chunks: Buffer[] = [];
        const seen = new Set<number>();
        let sid = startSid;
        while (sid >= 0 && sid !== ENDOFCHAIN && sid !== FREESECT) {
            if (seen.has(sid) || sid >= fat.length) {
                break;
            }
            seen.add(sid);
            const sec = readSector(sid);
            if (sec.length === 0) {
                break;
            }
            chunks.push(sec);
            sid = fat[sid];
        }
        return Buffer.concat(chunks);
    };

    const dirStream = readChain(firstDirSector);
    const entries: CfbEntry[] = [];
    for (let off = 0; off + 128 <= dirStream.length; off += 128) {
        const nameLength = dirStream.readUInt16LE(off + 64);
        const rawName = dirStream.slice(off, off + Math.max(0, nameLength - 2));
        entries.push({
            name: rawName.toString('utf16le').split('\u0000').join(''),
            type: dirStream.readUInt8(off + 66),
            leftId: dirStream.readInt32LE(off + 68),
            rightId: dirStream.readInt32LE(off + 72),
            childId: dirStream.readInt32LE(off + 76),
            startSector: dirStream.readInt32LE(off + 116),
            size: dirStream.readUInt32LE(off + 124) > 0 ? Number(dirStream.readUInt32LE(off + 120)) : dirStream.readUInt32LE(off + 120)
        });
    }

    const root = entries.find((entry) => entry.type === 5);
    const miniStream = root ? readChain(root.startSector).slice(0, root.size) : Buffer.alloc(0);
    const miniFatStream = readChain(firstMiniFatSector);
    const miniFat: number[] = [];
    for (let off = 0; off + 4 <= numMiniFatSectors * sectorSize && off + 4 <= miniFatStream.length; off += 4) {
        miniFat.push(miniFatStream.readInt32LE(off));
    }

    const readMiniChain = (startMiniSid: number, size: number): Buffer => {
        if (startMiniSid < 0) {
            return Buffer.alloc(0);
        }
        const chunks: Buffer[] = [];
        const seen = new Set<number>();
        let sid = startMiniSid;
        while (sid >= 0 && sid !== ENDOFCHAIN && sid !== FREESECT) {
            if (seen.has(sid) || sid >= miniFat.length) {
                break;
            }
            seen.add(sid);
            const start = sid * miniSectorSize;
            const end = start + miniSectorSize;
            if (start < 0 || end > miniStream.length) {
                break;
            }
            chunks.push(miniStream.slice(start, end));
            sid = miniFat[sid];
        }
        return Buffer.concat(chunks).slice(0, size);
    };

    const byName = new Map<string, CfbEntry>();
    entries.forEach((entry) => {
        if (entry.name) {
            byName.set(entry.name, entry);
        }
    });

    return {
        getStream: (name: string): Buffer | null => {
            const entry = byName.get(name);
            if (!entry || entry.type !== 2) {
                return null;
            }
            if (entry.size < miniCutoff && root) {
                return readMiniChain(entry.startSector, entry.size);
            }
            return readChain(entry.startSector).slice(0, entry.size);
        }
    };
}

export function parseRecords(buffer: Buffer, start: number, end: number): PptRecord[] {
    const records: PptRecord[] = [];
    let offset = start;

    while (offset + 8 <= end && offset + 8 <= buffer.length) {
        const verInst = buffer.readUInt16LE(offset);
        const recVer = verInst & 0x000f;
        const recInstance = (verInst >> 4) & 0x0fff;
        const recType = buffer.readUInt16LE(offset + 2);
        const length = buffer.readUInt32LE(offset + 4);
        const payloadOffset = offset + 8;
        const payloadEnd = payloadOffset + length;
        if (payloadEnd > end || payloadEnd > buffer.length) {
            break;
        }

        const record: PptRecord = {
            recType,
            recInstance,
            recVer,
            length,
            payloadOffset,
            payload: buffer.slice(payloadOffset, payloadEnd)
        };

        if (recVer === 0x0f) {
            record.children = parseRecords(buffer, payloadOffset, payloadEnd);
        }

        records.push(record);
        offset = payloadEnd;
    }

    return records;
}
