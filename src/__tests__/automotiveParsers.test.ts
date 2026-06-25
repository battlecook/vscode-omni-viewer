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
        const buffer = Buffer.alloc(512);
        buffer.write('SQLite format 3\0', 0, 'binary');
        buffer.writeUInt16BE(4096, 16);
        buffer.writeUInt32BE(4, 28);
        buffer.write('CREATE TABLE messages(id INTEGER PRIMARY KEY, topic TEXT)\0', 128, 'ascii');
        fs.writeFileSync(filePath, buffer);

        const model = await AutomotiveParsers.parseDb3(filePath, '512 bytes');

        expect(model.format).toBe('DB3');
        expect(model.summary.find(item => item.label === 'Signature')?.value).toBe('SQLite format 3');
        expect(model.summary.find(item => item.label === 'Page size')?.value).toBe(4096);
        expect(model.tables[0].rows[0][1]).toContain('CREATE TABLE messages');
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
