import * as fs from 'fs';
import type { AutomotiveViewerModel } from './automotiveParsers';

/**
 * Minimal HDF5 (.h5/.hdf5) structure reader.
 *
 * It validates the file signature, decodes the superblock and walks the object
 * header hierarchy to enumerate the groups and datasets stored in the file.
 *
 * Only metadata (superblock, B-trees, local heaps, object headers) is read, and
 * it is read on demand through an {@link Hdf5Reader} rather than by loading the
 * whole file. This keeps inspection of multi-gigabyte/terabyte HDF5 files cheap
 * because the large dataset payloads are never touched.
 *
 * Superblock versions 0 and 1 use the classic B-tree + local heap + symbol
 * table layout and are traversed fully. Superblock versions 2 and 3 use version
 * 2 object headers ("OHDR"); compact link messages are decoded, while groups
 * that keep their links in a fractal heap (dense storage) are reported with a
 * warning because that index is not walked here.
 */

const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const UNDEFINED_ADDRESS = -1;
const EMPTY = Buffer.alloc(0);

const MAX_ENTRIES = 5000;
const MAX_DEPTH = 64;
const MAX_NODES = 20000;
// Object header message blocks are tiny; cap reads to guard against corrupt sizes.
const MAX_BLOCK_BYTES = 32 * 1024 * 1024;

type EntryKind = 'Group' | 'Dataset' | 'Unknown';

/** Random-access view over the bytes of an HDF5 file. */
export interface Hdf5Reader {
    readonly size: number;
    /** Reads up to `length` bytes at absolute `offset`. May return fewer bytes near EOF. */
    read(offset: number, length: number): Buffer;
    close(): void;
}

/** Reader backed by a file descriptor with a small page cache (for huge files). */
export class Hdf5FileReader implements Hdf5Reader {
    private static readonly PAGE = 64 * 1024;
    private static readonly MAX_PAGES = 64;

    private readonly cache = new Map<number, Buffer>();

    private constructor(private readonly fd: number, public readonly size: number) {}

    public static open(filePath: string): Hdf5FileReader {
        const fd = fs.openSync(filePath, 'r');
        const { size } = fs.fstatSync(fd);
        return new Hdf5FileReader(fd, size);
    }

    public read(offset: number, length: number): Buffer {
        const start = Math.max(0, offset);
        const end = Math.min(offset + length, this.size);
        if (end <= start) {
            return EMPTY;
        }
        const out = Buffer.alloc(end - start);
        let pos = start;
        while (pos < end) {
            const pageIndex = Math.floor(pos / Hdf5FileReader.PAGE);
            const page = this.getPage(pageIndex);
            const inPage = pos - pageIndex * Hdf5FileReader.PAGE;
            const copyLength = Math.min(page.length - inPage, end - pos);
            if (copyLength <= 0) {
                break;
            }
            page.copy(out, pos - start, inPage, inPage + copyLength);
            pos += copyLength;
        }
        return out;
    }

    public close(): void {
        this.cache.clear();
        try {
            fs.closeSync(this.fd);
        } catch {
            // Ignore close failures; the descriptor is being discarded anyway.
        }
    }

    private getPage(pageIndex: number): Buffer {
        const cached = this.cache.get(pageIndex);
        if (cached) {
            return cached;
        }
        const start = pageIndex * Hdf5FileReader.PAGE;
        const length = Math.min(Hdf5FileReader.PAGE, this.size - start);
        if (length <= 0) {
            return EMPTY;
        }
        const page = Buffer.alloc(length);
        fs.readSync(this.fd, page, 0, length, start);
        if (this.cache.size >= Hdf5FileReader.MAX_PAGES) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                this.cache.delete(oldest);
            }
        }
        this.cache.set(pageIndex, page);
        return page;
    }
}

/** Reader backed by an in-memory buffer (used for tests and small inputs). */
export class Hdf5BufferReader implements Hdf5Reader {
    public readonly size: number;

    constructor(private readonly buffer: Buffer) {
        this.size = buffer.length;
    }

    public read(offset: number, length: number): Buffer {
        const start = Math.max(0, offset);
        const end = Math.min(offset + length, this.size);
        return end <= start ? EMPTY : this.buffer.subarray(start, end);
    }

    public close(): void {
        // Nothing to release for an in-memory buffer.
    }
}

interface Hdf5Entry {
    path: string;
    kind: EntryKind;
    shape: string;
    type: string;
    elementSize: number;
}

interface Hdf5Message {
    type: number;
    data: Buffer;
}

interface Superblock {
    version: number;
    sizeOfOffsets: number;
    sizeOfLengths: number;
    baseAddress: number;
    endOfFile: number;
    rootHeaderAddress: number;
}

const DATATYPE_CLASS_NAMES: Record<number, string> = {
    0: 'Integer',
    1: 'Float',
    2: 'Time',
    3: 'String',
    4: 'Bitfield',
    5: 'Opaque',
    6: 'Compound',
    7: 'Reference',
    8: 'Enum',
    9: 'Variable-length',
    10: 'Array'
};

// HDF5 object header message type identifiers.
const MSG_DATASPACE = 0x0001;
const MSG_DATATYPE = 0x0003;
const MSG_LINK = 0x0006;
const MSG_DATA_LAYOUT = 0x0008;
const MSG_CONTINUATION = 0x0010;
const MSG_SYMBOL_TABLE = 0x0011;

export class Hdf5Parser {
    private readonly reader: Hdf5Reader;
    private readonly entries: Hdf5Entry[] = [];
    private readonly warnings: string[] = [];
    private superblock: Superblock | null = null;
    private nodeBudget = MAX_NODES;
    private truncated = false;

    private constructor(reader: Hdf5Reader) {
        this.reader = reader;
    }

    /** Parses an HDF5 file by streaming only the metadata it needs. */
    public static parseFile(filePath: string, fileSize: string): AutomotiveViewerModel {
        const reader = Hdf5FileReader.open(filePath);
        try {
            return new Hdf5Parser(reader).build(fileSize);
        } finally {
            reader.close();
        }
    }

    /** Parses an in-memory HDF5 buffer (used by tests and small inputs). */
    public static parse(buffer: Buffer, fileSize: string): AutomotiveViewerModel {
        return new Hdf5Parser(new Hdf5BufferReader(buffer)).build(fileSize);
    }

    private build(fileSize: string): AutomotiveViewerModel {
        const signatureOffset = this.findSignature();
        if (signatureOffset < 0) {
            return {
                format: 'HDF5',
                title: 'Hierarchical Data Format 5',
                fileSize,
                summary: [{ label: 'Signature', value: 'not found' }],
                tables: [this.headerPreviewTable()],
                warnings: ['The file does not start with the expected HDF5 signature (\\x89HDF\\r\\n\\x1a\\n).']
            };
        }

        try {
            this.superblock = this.parseSuperblock(signatureOffset);
            if (this.superblock.rootHeaderAddress !== UNDEFINED_ADDRESS) {
                this.visitObject(this.superblock.rootHeaderAddress, '/', 0, new Set<number>());
            }
        } catch (error) {
            this.warnings.push(`Structure parsing stopped: ${error instanceof Error ? error.message : 'unknown error'}.`);
        }

        return this.toModel(fileSize);
    }

    private toModel(fileSize: string): AutomotiveViewerModel {
        const sb = this.superblock;
        const datasets = this.entries.filter(entry => entry.kind === 'Dataset');
        const groups = this.entries.filter(entry => entry.kind === 'Group');

        const summary: AutomotiveViewerModel['summary'] = [
            { label: 'Superblock version', value: sb ? sb.version : '-' },
            { label: 'Groups', value: groups.length },
            { label: 'Datasets', value: datasets.length },
            { label: 'Size of offsets', value: sb ? sb.sizeOfOffsets : '-' }
        ];

        const tables: AutomotiveViewerModel['tables'] = [];

        if (sb) {
            tables.push({
                title: 'Superblock',
                headers: ['Field', 'Value'],
                rows: [
                    ['Version', sb.version],
                    ['Size of offsets', sb.sizeOfOffsets],
                    ['Size of lengths', sb.sizeOfLengths],
                    ['Base address', formatAddress(sb.baseAddress)],
                    ['End of file address', formatAddress(sb.endOfFile)],
                    ['Root group header', formatAddress(sb.rootHeaderAddress)]
                ]
            });
        }

        tables.push({
            title: `Datasets (${datasets.length})`,
            headers: ['Path', 'Shape', 'Type', 'Element bytes'],
            rows: datasets.length > 0
                ? datasets.map(entry => [entry.path, entry.shape, entry.type, entry.elementSize])
                : [['-', '-', 'No datasets were decoded from the file structure.', '-']]
        });

        tables.push({
            title: `Groups (${groups.length})`,
            headers: ['Path', 'Kind'],
            rows: groups.length > 0
                ? groups.map(entry => [entry.path, entry.kind])
                : [['/', 'Group']]
        });

        tables.push(this.headerPreviewTable());

        const warnings = [...this.warnings];
        if (this.truncated || this.nodeBudget <= 0) {
            warnings.push('Traversal stopped early because the file structure exceeded the inspection limits.');
        }
        if (sb && (sb.version === 2 || sb.version === 3)) {
            warnings.push('Superblock version 2/3 detected: links stored in dense (fractal heap) indexes are not enumerated.');
        }

        return {
            format: 'HDF5',
            title: 'Hierarchical Data Format 5',
            fileSize,
            summary,
            tables,
            rawPreview: this.buildTreePreview(),
            warnings
        };
    }

    private headerPreviewTable(): AutomotiveViewerModel['tables'][number] {
        const preview = this.reader.read(0, 256);
        return {
            title: 'Header preview',
            headers: ['Offset', 'Hex', 'ASCII'],
            rows: hexRows(preview, 0, preview.length)
        };
    }

    private buildTreePreview(): string | undefined {
        if (this.entries.length === 0) {
            return undefined;
        }
        const lines = this.entries
            .slice()
            .sort((a, b) => a.path.localeCompare(b.path))
            .map(entry => {
                const depth = entry.path === '/' ? 0 : entry.path.split('/').filter(Boolean).length;
                const indent = '  '.repeat(Math.max(0, depth));
                const name = entry.path === '/' ? '/' : entry.path.split('/').filter(Boolean).pop() ?? entry.path;
                if (entry.kind === 'Dataset') {
                    return `${indent}${name}  [${entry.shape}] ${entry.type}`;
                }
                return `${indent}${name}/`;
            });
        const text = lines.join('\n');
        return text.length > 20000 ? `${text.slice(0, 20000)}\n\n... preview truncated ...` : text;
    }

    private findSignature(): number {
        let offset = 0;
        while (offset + HDF5_SIGNATURE.length <= this.reader.size) {
            const buf = this.reader.read(offset, HDF5_SIGNATURE.length);
            if (buf.length === HDF5_SIGNATURE.length && HDF5_SIGNATURE.every((byte, index) => buf[index] === byte)) {
                return offset;
            }
            // The signature may follow a user block placed at 0, 512, 1024, 2048, ...
            offset = offset === 0 ? 512 : offset * 2;
        }
        return -1;
    }

    private parseSuperblock(offset: number): Superblock {
        const sb = this.reader.read(offset, 256);
        const version = sb[8];

        if (version === 0 || version === 1) {
            const sizeOfOffsets = sb[13];
            const sizeOfLengths = sb[14];
            let p = 24;
            if (version === 1) {
                p += 4; // Indexed storage internal node K (2 bytes) + reserved (2 bytes)
            }
            const baseAddress = readOffsetBuf(sb, p, sizeOfOffsets); p += sizeOfOffsets;
            p += sizeOfOffsets; // Free-space info address
            const endOfFile = readOffsetBuf(sb, p, sizeOfOffsets); p += sizeOfOffsets;
            p += sizeOfOffsets; // Driver information block address
            p += sizeOfOffsets; // Root symbol table entry: link name offset
            const rootHeaderAddress = readOffsetBuf(sb, p, sizeOfOffsets);
            return { version, sizeOfOffsets, sizeOfLengths, baseAddress, endOfFile, rootHeaderAddress };
        }

        if (version === 2 || version === 3) {
            const sizeOfOffsets = sb[9];
            const sizeOfLengths = sb[10];
            let p = 12;
            const baseAddress = readOffsetBuf(sb, p, sizeOfOffsets); p += sizeOfOffsets;
            p += sizeOfOffsets; // Superblock extension address
            const endOfFile = readOffsetBuf(sb, p, sizeOfOffsets); p += sizeOfOffsets;
            const rootHeaderAddress = readOffsetBuf(sb, p, sizeOfOffsets);
            return { version, sizeOfOffsets, sizeOfLengths, baseAddress, endOfFile, rootHeaderAddress };
        }

        throw new Error(`unsupported superblock version ${version}`);
    }

    private visitObject(headerAddress: number, path: string, depth: number, ancestors: Set<number>): void {
        if (headerAddress === UNDEFINED_ADDRESS || depth > MAX_DEPTH || this.entries.length >= MAX_ENTRIES) {
            if (this.entries.length >= MAX_ENTRIES) {
                this.truncated = true;
            }
            return;
        }
        if (ancestors.has(headerAddress)) {
            return; // Guard against cyclic links.
        }
        if (--this.nodeBudget <= 0) {
            this.truncated = true;
            return;
        }

        const messages = this.readObjectHeader(headerAddress);
        const dataspace = messages.find(message => message.type === MSG_DATASPACE);
        const datatype = messages.find(message => message.type === MSG_DATATYPE);
        const hasLayout = messages.some(message => message.type === MSG_DATA_LAYOUT);
        const symbolTable = messages.find(message => message.type === MSG_SYMBOL_TABLE);
        const linkMessages = messages.filter(message => message.type === MSG_LINK);

        const isDataset = Boolean(datatype && (dataspace || hasLayout));

        if (isDataset) {
            this.entries.push({
                path,
                kind: 'Dataset',
                shape: dataspace ? this.describeDataspace(dataspace.data) : 'scalar',
                type: datatype ? this.describeDatatype(datatype.data) : 'unknown',
                elementSize: datatype ? this.datatypeSize(datatype.data) : 0
            });
            return;
        }

        // Anything that is not a dataset is treated as a group node.
        this.entries.push({ path, kind: 'Group', shape: '-', type: '-', elementSize: 0 });

        const nextAncestors = new Set(ancestors).add(headerAddress);
        const children: Array<{ name: string; address: number }> = [];

        if (symbolTable) {
            children.push(...this.readSymbolTable(symbolTable.data));
        }
        for (const link of linkMessages) {
            const decoded = this.decodeLinkMessage(link.data);
            if (decoded) {
                children.push(decoded);
            }
        }

        for (const child of children) {
            const childPath = path === '/' ? `/${child.name}` : `${path}/${child.name}`;
            this.visitObject(child.address, childPath, depth + 1, nextAncestors);
        }
    }

    private readObjectHeader(address: number): Hdf5Message[] {
        const start = this.resolve(address);
        if (start < 0 || start >= this.reader.size) {
            return [];
        }
        if (this.matchesAscii(start, 'OHDR')) {
            return this.readObjectHeaderV2(start);
        }
        return this.readObjectHeaderV1(start);
    }

    private readObjectHeaderV1(start: number): Hdf5Message[] {
        const prefix = this.reader.read(start, 16);
        if (prefix.length < 16) {
            return [];
        }
        const totalMessages = prefix.readUInt16LE(2);
        // 16-byte prefix: version, reserved, message count, ref count, header size, padding.
        const blocks: Array<{ offset: number; length: number }> = [{ offset: start + 16, length: prefix.readUInt32LE(8) }];
        return this.collectMessages(blocks, totalMessages + 256, { version2: false, creationOrderBytes: 0 });
    }

    private readObjectHeaderV2(start: number): Hdf5Message[] {
        const head = this.reader.read(start, 64);
        if (head.length < 6) {
            return [];
        }
        const flags = head[5];
        let p = 6;
        if (flags & 0x20) {
            p += 16; // Access, modification, change, and birth times.
        }
        if (flags & 0x10) {
            p += 4; // Max compact / min dense attribute counts.
        }
        const chunkSizeBytes = 1 << (flags & 0x03);
        const chunkSize = readLittleBuf(head, p, chunkSizeBytes);
        p += chunkSizeBytes;
        const trackOrder = (flags & 0x04) !== 0;
        const blocks: Array<{ offset: number; length: number }> = [{ offset: start + p, length: chunkSize }];
        return this.collectMessages(blocks, MAX_ENTRIES, { version2: true, creationOrderBytes: trackOrder ? 2 : 0 });
    }

    private collectMessages(
        blocks: Array<{ offset: number; length: number }>,
        maxMessages: number,
        options: { version2: boolean; creationOrderBytes: number }
    ): Hdf5Message[] {
        const messages: Hdf5Message[] = [];
        const visited = new Set<number>();
        const headerSize = options.version2 ? 4 : 8;
        let guard = 0;

        while (blocks.length > 0 && messages.length < maxMessages && guard++ < 4096) {
            const block = blocks.shift()!;
            const region = this.reader.read(block.offset, Math.min(block.length, MAX_BLOCK_BYTES));
            let p = 0;
            while (p + headerSize <= region.length) {
                const type = options.version2 ? region[p] : region.readUInt16LE(p);
                const size = options.version2 ? region.readUInt16LE(p + 1) : region.readUInt16LE(p + 2);
                // Version 2 message headers add a creation-order field when the header tracks order.
                const dataStart = p + headerSize + options.creationOrderBytes;
                if (dataStart + size > region.length) {
                    break;
                }
                const data = region.subarray(dataStart, dataStart + size);
                if (type === MSG_CONTINUATION) {
                    this.queueContinuation(blocks, visited, data, options.version2);
                } else {
                    messages.push({ type, data });
                }
                p = dataStart + size;
            }
        }
        return messages;
    }

    private queueContinuation(blocks: Array<{ offset: number; length: number }>, visited: Set<number>, data: Buffer, version2: boolean): void {
        const contAddress = readOffsetBuf(data, 0, this.sizeOfOffsets());
        const contLength = readLittleBuf(data, this.sizeOfOffsets(), this.sizeOfLengths());
        const contStart = this.resolve(contAddress);
        if (contAddress === UNDEFINED_ADDRESS || contStart < 0 || visited.has(contStart)) {
            return;
        }
        visited.add(contStart);
        if (version2) {
            // Version 2 continuation blocks carry an "OCHK" signature (4 bytes) + trailing checksum (4 bytes).
            if (!this.matchesAscii(contStart, 'OCHK')) {
                return;
            }
            blocks.push({ offset: contStart + 4, length: Math.max(0, contLength - 8) });
        } else {
            blocks.push({ offset: contStart, length: contLength });
        }
    }

    private readSymbolTable(data: Buffer): Array<{ name: string; address: number }> {
        const sizeOfOffsets = this.sizeOfOffsets();
        const btreeAddress = readOffsetBuf(data, 0, sizeOfOffsets);
        const heapAddress = readOffsetBuf(data, sizeOfOffsets, sizeOfOffsets);
        const heapDataStart = this.readLocalHeapDataStart(heapAddress);
        if (heapDataStart < 0) {
            return [];
        }
        const snodAddresses: number[] = [];
        this.collectSymbolTableNodes(btreeAddress, snodAddresses, new Set<number>());

        const children: Array<{ name: string; address: number }> = [];
        for (const snodAddress of snodAddresses) {
            children.push(...this.readSymbolTableNode(snodAddress, heapDataStart));
        }
        return children;
    }

    private collectSymbolTableNodes(address: number, output: number[], visited: Set<number>): void {
        const start = this.resolve(address);
        if (address === UNDEFINED_ADDRESS || start < 0 || visited.has(start) || output.length > MAX_ENTRIES) {
            return;
        }
        visited.add(start);
        if (!this.matchesAscii(start, 'TREE')) {
            return;
        }
        const sizeOfOffsets = this.sizeOfOffsets();
        const sizeOfLengths = this.sizeOfLengths();
        // Header: signature(4) + node type(1) + level(1) + entries used(2) + left(off) + right(off).
        const headerSize = 8 + sizeOfOffsets * 2;
        const header = this.reader.read(start, headerSize);
        if (header.length < 8) {
            return;
        }
        const nodeLevel = header[5];
        const entriesUsed = header.readUInt16LE(6);
        // Keys and children: key0, [child, key] * entriesUsed. Group-node keys are heap offsets.
        const regionLength = sizeOfLengths + entriesUsed * (sizeOfOffsets + sizeOfLengths);
        const region = this.reader.read(start + headerSize, regionLength);
        let p = sizeOfLengths; // The first key precedes the first child pointer.
        for (let i = 0; i < entriesUsed; i++) {
            const childAddress = readOffsetBuf(region, p, sizeOfOffsets);
            p += sizeOfOffsets + sizeOfLengths; // Child pointer + following key.
            if (nodeLevel > 0) {
                this.collectSymbolTableNodes(childAddress, output, visited);
            } else if (childAddress !== UNDEFINED_ADDRESS) {
                output.push(childAddress);
            }
        }
    }

    private readSymbolTableNode(address: number, heapDataStart: number): Array<{ name: string; address: number }> {
        const start = this.resolve(address);
        if (start < 0 || !this.matchesAscii(start, 'SNOD')) {
            return [];
        }
        const header = this.reader.read(start, 8);
        if (header.length < 8) {
            return [];
        }
        const count = header.readUInt16LE(6);
        const sizeOfOffsets = this.sizeOfOffsets();
        const entrySize = sizeOfOffsets * 2 + 8 + 16; // Name offset + header address + cache type + reserved + scratch pad.
        const region = this.reader.read(start + 8, count * entrySize);
        const children: Array<{ name: string; address: number }> = [];
        for (let i = 0; i < count; i++) {
            const base = i * entrySize;
            const nameOffset = readOffsetBuf(region, base, sizeOfOffsets);
            const headerAddress = readOffsetBuf(region, base + sizeOfOffsets, sizeOfOffsets);
            const name = this.readHeapString(heapDataStart + nameOffset);
            if (name && headerAddress !== UNDEFINED_ADDRESS) {
                children.push({ name, address: headerAddress });
            }
        }
        return children;
    }

    private readLocalHeapDataStart(address: number): number {
        const start = this.resolve(address);
        if (start < 0 || !this.matchesAscii(start, 'HEAP')) {
            return -1;
        }
        const sizeOfOffsets = this.sizeOfOffsets();
        const sizeOfLengths = this.sizeOfLengths();
        // signature(4) + version(1) + reserved(3) + data segment size + free-list head + data segment address.
        const buf = this.reader.read(start + 8 + sizeOfLengths * 2, sizeOfOffsets);
        const dataSegmentAddress = readOffsetBuf(buf, 0, sizeOfOffsets);
        return this.resolve(dataSegmentAddress);
    }

    private decodeLinkMessage(data: Buffer): { name: string; address: number } | null {
        if (data.length < 2 || data[0] !== 1) {
            return null;
        }
        const flags = data[1];
        let p = 2;
        let linkType = 0;
        if (flags & 0x08) {
            linkType = data[p];
            p += 1;
        }
        if (flags & 0x04) {
            p += 8; // Creation order.
        }
        if (flags & 0x10) {
            p += 1; // Link name character set.
        }
        const lengthFieldSize = 1 << (flags & 0x03);
        if (p + lengthFieldSize > data.length) {
            return null;
        }
        const nameLength = readLittleBuf(data, p, lengthFieldSize);
        p += lengthFieldSize;
        if (p + nameLength > data.length) {
            return null;
        }
        const name = data.subarray(p, p + nameLength).toString('utf8');
        p += nameLength;
        if (linkType !== 0) {
            return null; // Only hard links point straight at an object header.
        }
        const address = readOffsetBuf(data, p, this.sizeOfOffsets());
        if (address === UNDEFINED_ADDRESS) {
            return null;
        }
        return { name, address };
    }

    private describeDataspace(data: Buffer): string {
        if (data.length < 2) {
            return 'scalar';
        }
        const version = data[0];
        const rank = data[1];
        if (rank === 0) {
            return 'scalar';
        }
        const sizeOfLengths = this.sizeOfLengths();
        // v1: version, rank, flags, reserved, reserved(4). v2: version, rank, flags, type.
        let p = version >= 2 ? 4 : 8;
        const dims: number[] = [];
        for (let i = 0; i < rank && p + sizeOfLengths <= data.length; i++) {
            dims.push(readLittleBuf(data, p, sizeOfLengths));
            p += sizeOfLengths;
        }
        return dims.length > 0 ? dims.join(' × ') : `rank ${rank}`;
    }

    private describeDatatype(data: Buffer): string {
        if (data.length < 1) {
            return 'unknown';
        }
        const classId = data[0] & 0x0f;
        const name = DATATYPE_CLASS_NAMES[classId] ?? `class ${classId}`;
        const size = this.datatypeSize(data);
        if (classId === 0 || classId === 1) {
            return `${name}${size * 8}`;
        }
        return name;
    }

    private datatypeSize(data: Buffer): number {
        return data.length >= 8 ? data.readUInt32LE(4) : 0;
    }

    private readHeapString(offset: number): string {
        if (offset < 0 || offset >= this.reader.size) {
            return '';
        }
        const buf = this.reader.read(offset, 1024);
        let end = 0;
        while (end < buf.length && buf[end] !== 0) {
            end++;
        }
        return buf.subarray(0, end).toString('utf8');
    }

    private matchesAscii(offset: number, signature: string): boolean {
        if (offset < 0) {
            return false;
        }
        const buf = this.reader.read(offset, signature.length);
        if (buf.length < signature.length) {
            return false;
        }
        for (let i = 0; i < signature.length; i++) {
            if (buf[i] !== signature.charCodeAt(i)) {
                return false;
            }
        }
        return true;
    }

    private resolve(address: number): number {
        if (address === UNDEFINED_ADDRESS) {
            return -1;
        }
        const base = this.superblock ? this.superblock.baseAddress : 0;
        return address + (base > 0 ? base : 0);
    }

    private sizeOfOffsets(): number {
        return this.superblock ? this.superblock.sizeOfOffsets : 8;
    }

    private sizeOfLengths(): number {
        return this.superblock ? this.superblock.sizeOfLengths : 8;
    }
}

function readOffsetBuf(buffer: Buffer, offset: number, size: number): number {
    if (offset < 0 || offset + size > buffer.length) {
        return UNDEFINED_ADDRESS;
    }
    let allOnes = true;
    for (let i = 0; i < size; i++) {
        if (buffer[offset + i] !== 0xff) {
            allOnes = false;
            break;
        }
    }
    if (allOnes) {
        return UNDEFINED_ADDRESS;
    }
    return readLittleBuf(buffer, offset, size);
}

function readLittleBuf(buffer: Buffer, offset: number, size: number): number {
    if (offset < 0 || offset + size > buffer.length) {
        return 0;
    }
    if (size <= 6) {
        return buffer.readUIntLE(offset, size);
    }
    let value = 0n;
    for (let i = size - 1; i >= 0; i--) {
        value = (value << 8n) | BigInt(buffer[offset + i]);
    }
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

function formatAddress(address: number): string {
    if (address === UNDEFINED_ADDRESS) {
        return 'undefined';
    }
    return `0x${address.toString(16)}`;
}

function hexRows(buffer: Buffer, start: number, end: number): Array<Array<string>> {
    const rows: Array<Array<string>> = [];
    for (let offset = start; offset < end; offset += 16) {
        const slice = buffer.subarray(offset, Math.min(offset + 16, end));
        const hex = Array.from(slice).map(byte => byte.toString(16).padStart(2, '0')).join(' ');
        const ascii = Array.from(slice).map(byte => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join('');
        rows.push([`0x${offset.toString(16).padStart(4, '0')}`, hex, ascii]);
    }
    return rows;
}
