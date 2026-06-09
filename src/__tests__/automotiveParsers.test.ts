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
});
