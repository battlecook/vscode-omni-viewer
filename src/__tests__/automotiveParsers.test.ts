import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AutomotiveParsers } from '../utils/automotiveParsers';

describe('AutomotiveParsers', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-automotive-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('summarizes ARXML packages, named elements, and references', () => {
        const model = AutomotiveParsers.parseArxml([
            '<?xml version="1.0"?>',
            '<AUTOSAR xmlns="http://autosar.org/3.2.3">',
            '<AR-PACKAGE><SHORT-NAME>Cluster</SHORT-NAME><ELEMENTS>',
            '<CAN-CLUSTER><SHORT-NAME>CAN</SHORT-NAME></CAN-CLUSTER>',
            '<FRAME><SHORT-NAME>FrameA</SHORT-NAME></FRAME>',
            '<FRAME-REF DEST="FRAME">/Frame/FrameA</FRAME-REF>',
            '</ELEMENTS></AR-PACKAGE>',
            '</AUTOSAR>'
        ].join('\n'), '1 KB');

        expect(model.format).toBe('ARXML');
        expect(model.summary.find(item => item.label === 'Packages')?.value).toBe(1);
        expect(model.tables[1].rows).toEqual(expect.arrayContaining([
            ['CAN-CLUSTER', 'CAN'],
            ['FRAME', 'FrameA']
        ]));
        expect(model.tables[2].rows[0]).toEqual(['FRAME-REF', 'FRAME', '/Frame/FrameA']);
    });

    it('summarizes A2L blocks and counts important sections', () => {
        const model = AutomotiveParsers.parseA2l([
            '/begin PROJECT Demo ""',
            '/begin MODULE ECU ""',
            '/begin MEASUREMENT Speed "" UWORD NO_COMPU_METHOD 0 0 0 255',
            '/end MEASUREMENT',
            '/begin IF_DATA XCP',
            '/end IF_DATA',
            '/end MODULE',
            '/end PROJECT'
        ].join('\n'), '1 KB');

        expect(model.format).toBe('A2L');
        expect(model.summary.find(item => item.label === 'Measurements')?.value).toBe(1);
        expect(model.summary.find(item => item.label === 'IF_DATA')?.value).toBe(1);
    });

    it('parses ASC CAN FD events', () => {
        const model = AutomotiveParsers.parseAsc([
            'date Sam Sep 30 15:06:13.191 2017',
            'base hex  timestamps absolute',
            'Begin Triggerblock Sam Sep 30 15:06:13.191 2017',
            '  30.300981 CANFD   3 Tx     50005x 0 1 5 0 140000 73 200050',
            'End TriggerBlock'
        ].join('\n'), '1 KB');

        expect(model.format).toBe('ASC');
        expect(model.summary.find(item => item.label === 'CAN FD events')?.value).toBe(1);
        expect(model.tables[1].rows[0]).toEqual([
            '30.300981',
            'CANFD',
            '3',
            'Tx',
            '50005x',
            '0',
            '140000 73 200050',
            4
        ]);
    });

    it('inspects BLF binary headers', async () => {
        const filePath = path.join(tempDir, 'sample.blf');
        const buffer = Buffer.alloc(160);
        buffer.write('LOGG', 0, 'ascii');
        buffer.writeUInt32LE(144, 4);
        buffer.writeUInt32LE(2, 32);
        buffer.writeBigUInt64LE(BigInt(3), 128);
        fs.writeFileSync(filePath, buffer);

        const model = await AutomotiveParsers.parseBlf(filePath, '160 bytes');

        expect(model.format).toBe('BLF');
        expect(model.summary.find(item => item.label === 'Signature')?.value).toBe('LOGG');
        expect(model.summary.find(item => item.label === 'Object count hint')?.value).toBe(3);
    });

    it('inspects MF4 binary headers and MDF block markers', async () => {
        const filePath = path.join(tempDir, 'sample.mf4');
        const buffer = Buffer.concat([
            Buffer.from('MDF     4.10    TEST    ', 'ascii'),
            Buffer.from('##HD##DG##CG##CN', 'ascii')
        ]);
        fs.writeFileSync(filePath, buffer);

        const model = await AutomotiveParsers.parseMf4(filePath, '40 bytes');

        expect(model.format).toBe('MF4');
        expect(model.summary.find(item => item.label === 'Magic')?.value).toBe('MDF');
        expect(model.tables[0].rows).toEqual(expect.arrayContaining([
            ['##HD', 1],
            ['##CN', 1]
        ]));
    });

    it('inspects Avro object container metadata', async () => {
        const filePath = path.join(tempDir, 'sample.avro');
        const schema = JSON.stringify({ type: 'record', name: 'Point', fields: [{ name: 'x', type: 'int' }] });
        const metadata = Buffer.concat([
            encodeAvroLong(2),
            encodeAvroBytes('avro.schema'),
            encodeAvroBytes(schema),
            encodeAvroBytes('avro.codec'),
            encodeAvroBytes('null'),
            encodeAvroLong(0),
            Buffer.alloc(16, 1)
        ]);
        fs.writeFileSync(filePath, Buffer.concat([Buffer.from([0x4F, 0x62, 0x6A, 0x01]), metadata]));

        const model = await AutomotiveParsers.parseAvro(filePath, '128 bytes');

        expect(model.format).toBe('AVRO');
        expect(model.summary.find(item => item.label === 'Metadata entries')?.value).toBe(2);
        expect(model.summary.find(item => item.label === 'Codec')?.value).toBe('null');
        expect(model.rawPreview).toContain('"name": "Point"');
    });

    it('inspects ROS bag headers and op hints', async () => {
        const filePath = path.join(tempDir, 'sample.bag');
        const buffer = Buffer.concat([
            Buffer.from('#ROSBAG V2.0\n', 'ascii'),
            Buffer.from('op=\x03op=\x07op=\x05op=\x02', 'binary')
        ]);
        fs.writeFileSync(filePath, buffer);

        const model = await AutomotiveParsers.parseBag(filePath, '32 bytes');

        expect(model.format).toBe('BAG');
        expect(model.summary.find(item => item.label === 'Header')?.value).toBe('#ROSBAG V2.0');
        expect(model.summary.find(item => item.label === 'Connection records')?.value).toBe(1);
        expect(model.summary.find(item => item.label === 'Chunk records')?.value).toBe(1);
    });

    it('summarizes STEP headers and entity types', async () => {
        const filePath = path.join(tempDir, 'sample.stp');
        fs.writeFileSync(filePath, [
            'ISO-10303-21;',
            'HEADER;',
            "FILE_DESCRIPTION(('Demo'),'2;1');",
            "FILE_NAME('part','2026-06-24T00:00:00',('me'),('org'),'pre','cad','');",
            "FILE_SCHEMA(('AP214'));",
            'ENDSEC;',
            'DATA;',
            '#1=CARTESIAN_POINT(\'\',(0.,0.,0.));',
            '#2=VERTEX_POINT(\'\',#1);',
            '#3=VERTEX_POINT(\'\',#1);',
            'ENDSEC;',
            'END-ISO-10303-21;'
        ].join('\n'), 'utf8');

        const model = await AutomotiveParsers.parseStp(filePath, '512 bytes');

        expect(model.format).toBe('STP');
        expect(model.summary.find(item => item.label === 'Schema')?.value).toBe('AP214');
        expect(model.summary.find(item => item.label === 'Entity lines')?.value).toBe(3);
        expect(model.tables[1].rows).toEqual(expect.arrayContaining([
            ['VERTEX_POINT', 2]
        ]));
    });

    it('inspects DB3 SQLite headers and schema hints', async () => {
        const filePath = path.join(tempDir, 'sample.db3');
        fs.writeFileSync(filePath, createSqlitePreviewDatabase());

        const model = await AutomotiveParsers.parseDb3(filePath, '1024 bytes');

        expect(model.format).toBe('DB3');
        expect(model.summary.find(item => item.label === 'Signature')?.value).toBe('SQLite format 3');
        expect(model.summary.find(item => item.label === 'Page size')?.value).toBe(512);
        expect(model.summary.find(item => item.label === 'Tables')?.value).toBe(1);
        expect(model.tables[1].rows[0]).toEqual([
            'table',
            'messages',
            'messages',
            2,
            'CREATE TABLE messages(topic TEXT, value INTEGER, payload BLOB)'
        ]);
        expect(model.tables[2].title).toBe('Rows: messages');
        expect(model.tables[2].headers).toEqual(['rowid', 'topic', 'value', 'payload']);
        expect(model.tables[2].rows[0]).toEqual([
            1,
            'gps',
            42,
            'BLOB(3 bytes) 010203'
        ]);
    });

    it('summarizes ReqIF headers, specifications, objects, and relations', () => {
        const model = AutomotiveParsers.parseReqif([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<REQ-IF>',
            '<THE-HEADER><REQ-IF-HEADER IDENTIFIER="hdr-1">',
            '<TITLE>Demo requirements</TITLE>',
            '<SOURCE-TOOL-ID>Tool A</SOURCE-TOOL-ID>',
            '<REQ-IF-TOOL-ID>ReqIF Tool</REQ-IF-TOOL-ID>',
            '<CREATION-TIME>2026-06-24T00:00:00Z</CREATION-TIME>',
            '</REQ-IF-HEADER></THE-HEADER>',
            '<CORE-CONTENT><REQ-IF-CONTENT>',
            '<DATATYPES><DATATYPE-DEFINITION-STRING IDENTIFIER="dt-1" LONG-NAME="String"/></DATATYPES>',
            '<SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="type-1" LONG-NAME="Requirement"/></SPEC-TYPES>',
            '<SPEC-OBJECTS><SPEC-OBJECT IDENTIFIER="obj-1" LONG-NAME="Requirement 1"/></SPEC-OBJECTS>',
            '<SPECIFICATIONS><SPECIFICATION IDENTIFIER="spec-1" LONG-NAME="System Spec"/></SPECIFICATIONS>',
            '<SPEC-RELATIONS><SPEC-RELATION IDENTIFIER="rel-1" LONG-NAME="Trace"/></SPEC-RELATIONS>',
            '</REQ-IF-CONTENT></CORE-CONTENT>',
            '</REQ-IF>'
        ].join('\n'), '2 KB');

        expect(model.format).toBe('REQIF');
        expect(model.summary.find(item => item.label === 'Title')?.value).toBe('Demo requirements');
        expect(model.summary.find(item => item.label === 'Spec objects')?.value).toBe(1);
        expect(model.summary.find(item => item.label === 'Specifications')?.value).toBe(1);
        expect(model.summary.find(item => item.label === 'Spec relations')?.value).toBe(1);
        expect(model.tables[1].rows[0]).toEqual(['spec-1', 'System Spec', 'SPECIFICATION']);
        expect(model.tables[2].rows[0]).toEqual(['obj-1', 'Requirement 1', 'SPEC-OBJECT']);
    });

    it('inspects classic PCAP global headers and packet records', async () => {
        const filePath = path.join(tempDir, 'sample.pcap');
        const packet = createEthernetIpv4UdpDnsPacket();
        const header = Buffer.alloc(24);
        header.writeUInt32LE(0xA1B2C3D4, 0);
        header.writeUInt16LE(2, 4);
        header.writeUInt16LE(4, 6);
        header.writeInt32LE(0, 8);
        header.writeUInt32LE(0, 12);
        header.writeUInt32LE(65535, 16);
        header.writeUInt32LE(1, 20);
        const packetHeader = Buffer.alloc(16);
        packetHeader.writeUInt32LE(10, 0);
        packetHeader.writeUInt32LE(123, 4);
        packetHeader.writeUInt32LE(packet.length, 8);
        packetHeader.writeUInt32LE(packet.length, 12);
        fs.writeFileSync(filePath, Buffer.concat([header, packetHeader, packet]));

        const model = await AutomotiveParsers.parsePcap(filePath, `${24 + 16 + packet.length} bytes`);

        expect(model.format).toBe('PCAP');
        expect(model.summary.find(item => item.label === 'Version')?.value).toBe('2.4');
        expect(model.summary.find(item => item.label === 'Packets parsed')?.value).toBe(1);
        expect(model.tables[0].rows).toEqual(expect.arrayContaining([
            ['Link type', '1 (Ethernet)']
        ]));
        expect(model.tables[1].rows[0]).toEqual([
            1,
            '10.000123',
            'DNS',
            '192.168.0.2:53000',
            '8.8.8.8:53',
            packet.length,
            packet.length,
            '0x18',
            'Query id=0x1234, rcode=NOERROR, questions=1, answers=0, example.com A'
        ]);
    });

    it('inspects PCAPNG sections and packet blocks', async () => {
        const filePath = path.join(tempDir, 'sample.pcapng');
        const section = Buffer.alloc(28);
        section.writeUInt32LE(0x0A0D0D0A, 0);
        section.writeUInt32LE(28, 4);
        section.writeUInt32LE(0x1A2B3C4D, 8);
        section.writeUInt16LE(1, 12);
        section.writeUInt16LE(0, 14);
        section.writeBigInt64LE(BigInt(-1), 16);
        section.writeUInt32LE(28, 24);
        const idb = Buffer.alloc(20);
        idb.writeUInt32LE(1, 0);
        idb.writeUInt32LE(20, 4);
        idb.writeUInt16LE(1, 8);
        idb.writeUInt16LE(0, 10);
        idb.writeUInt32LE(65535, 12);
        idb.writeUInt32LE(20, 16);
        const epb = Buffer.alloc(32);
        epb.writeUInt32LE(6, 0);
        epb.writeUInt32LE(32, 4);
        epb.writeUInt32LE(0, 8);
        epb.writeUInt32LE(1, 12);
        epb.writeUInt32LE(2, 16);
        epb.writeUInt32LE(4, 20);
        epb.writeUInt32LE(4, 24);
        epb.writeUInt32LE(32, 28);
        fs.writeFileSync(filePath, Buffer.concat([section, idb, epb]));

        const model = await AutomotiveParsers.parsePcapng(filePath, '80 bytes');

        expect(model.format).toBe('PCAPNG');
        expect(model.summary.find(item => item.label === 'Sections')?.value).toBe(1);
        expect(model.summary.find(item => item.label === 'Interfaces')?.value).toBe(1);
        expect(model.summary.find(item => item.label === 'Enhanced packets')?.value).toBe(1);
        expect(model.tables[1].rows).toEqual(expect.arrayContaining([
            [3, 'Enhanced Packet', 32, 4, 4, '0x30']
        ]));
    });
});

function encodeAvroLong(value: number): Buffer {
    let unsigned = (value << 1) ^ (value >> 31);
    const bytes: number[] = [];
    while ((unsigned & ~0x7F) !== 0) {
        bytes.push((unsigned & 0x7F) | 0x80);
        unsigned >>>= 7;
    }
    bytes.push(unsigned);
    return Buffer.from(bytes);
}

function encodeAvroBytes(value: string): Buffer {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([encodeAvroLong(bytes.length), bytes]);
}

function createSqlitePreviewDatabase(): Buffer {
    const pageSize = 512;
    const database = Buffer.alloc(pageSize * 2);
    database.write('SQLite format 3\0', 0, 'binary');
    database.writeUInt16BE(pageSize, 16);
    database[18] = 1;
    database[19] = 1;
    database[20] = 0;
    database.writeUInt32BE(2, 28);
    database.writeUInt32BE(1, 44);

    const createSql = 'CREATE TABLE messages(topic TEXT, value INTEGER, payload BLOB)';
    writeSqliteLeafTablePage(database, pageSize, 1, [
        {
            rowid: 1,
            values: ['table', 'messages', 'messages', 2, createSql]
        }
    ]);
    writeSqliteLeafTablePage(database, pageSize, 2, [
        {
            rowid: 1,
            values: ['gps', 42, Buffer.from([1, 2, 3])]
        }
    ]);

    return database;
}

function writeSqliteLeafTablePage(
    database: Buffer,
    pageSize: number,
    pageNumber: number,
    rows: Array<{ rowid: number; values: Array<string | number | Buffer> }>
): void {
    const pageOffset = (pageNumber - 1) * pageSize;
    const headerOffset = pageNumber === 1 ? 100 : 0;
    const page = database.subarray(pageOffset, pageOffset + pageSize);
    page[headerOffset] = 0x0D;
    page.writeUInt16BE(rows.length, headerOffset + 3);

    let cellStart = pageSize;
    rows.forEach((row, index) => {
        const payload = encodeSqliteRecord(row.values);
        const cell = Buffer.concat([
            encodeSqliteVarint(payload.length),
            encodeSqliteVarint(row.rowid),
            payload
        ]);
        cellStart -= cell.length;
        cell.copy(page, cellStart);
        page.writeUInt16BE(cellStart, headerOffset + 8 + index * 2);
    });

    page.writeUInt16BE(cellStart, headerOffset + 5);
}

function encodeSqliteRecord(values: Array<string | number | Buffer>): Buffer {
    const serialTypes: number[] = [];
    const bodyParts: Buffer[] = [];

    values.forEach(value => {
        if (Buffer.isBuffer(value)) {
            serialTypes.push(12 + value.length * 2);
            bodyParts.push(value);
        } else if (typeof value === 'number') {
            serialTypes.push(4);
            const bytes = Buffer.alloc(4);
            bytes.writeInt32BE(value);
            bodyParts.push(bytes);
        } else {
            const bytes = Buffer.from(value, 'utf8');
            serialTypes.push(13 + bytes.length * 2);
            bodyParts.push(bytes);
        }
    });

    let headerSize = 1 + serialTypes.reduce((sum, type) => sum + encodeSqliteVarint(type).length, 0);
    let headerSizeBytes = encodeSqliteVarint(headerSize);
    headerSize = headerSizeBytes.length + serialTypes.reduce((sum, type) => sum + encodeSqliteVarint(type).length, 0);
    headerSizeBytes = encodeSqliteVarint(headerSize);

    return Buffer.concat([
        headerSizeBytes,
        ...serialTypes.map(encodeSqliteVarint),
        ...bodyParts
    ]);
}

function encodeSqliteVarint(value: number): Buffer {
    if (value <= 0x7F) {
        return Buffer.from([value]);
    }

    const groups: number[] = [];
    let remaining = value;
    groups.unshift(remaining & 0x7F);
    remaining >>>= 7;
    while (remaining > 0) {
        groups.unshift((remaining & 0x7F) | 0x80);
        remaining >>>= 7;
    }
    return Buffer.from(groups);
}

function createEthernetIpv4UdpDnsPacket(): Buffer {
    const dnsQuestion = Buffer.from([
        0x12, 0x34, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x07, 0x65, 0x78, 0x61,
        0x6d, 0x70, 0x6c, 0x65, 0x03, 0x63, 0x6f, 0x6d,
        0x00, 0x00, 0x01, 0x00, 0x01
    ]);
    const udp = Buffer.alloc(8);
    udp.writeUInt16BE(53000, 0);
    udp.writeUInt16BE(53, 2);
    udp.writeUInt16BE(8 + dnsQuestion.length, 4);

    const ipv4 = Buffer.alloc(20);
    ipv4[0] = 0x45;
    ipv4.writeUInt16BE(20 + udp.length + dnsQuestion.length, 2);
    ipv4[8] = 64;
    ipv4[9] = 17;
    ipv4.set([192, 168, 0, 2], 12);
    ipv4.set([8, 8, 8, 8], 16);

    return Buffer.concat([
        Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x08, 0x00]),
        ipv4,
        udp,
        dnsQuestion
    ]);
}
