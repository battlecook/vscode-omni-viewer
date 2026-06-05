import { DbcParser } from '../utils/dbcParser';

describe('DbcParser', () => {
    it('parses messages, signals, comments, and value tables', () => {
        const source = [
            'VERSION "Demo DBC"',
            'NS_ :',
            'BS_:',
            'BU_: ECM BCM Tester',
            'BO_ 256 EngineData: 8 ECM',
            ' SG_ EngineSpeed : 24|16@1+ (0.125,0) [0|8031.875] "rpm" BCM,Tester',
            ' SG_ EngineState : 8|8@1+ (1,0) [0|3] "" Tester',
            'CM_ BO_ 256 "Engine telemetry frame";',
            'CM_ SG_ 256 EngineSpeed "Current crankshaft speed";',
            'VAL_ 256 EngineState 0 "Off" 1 "Idle" 2 "Run";'
        ].join('\n');

        const model = DbcParser.parse(source);

        expect(model.version).toBe('Demo DBC');
        expect(model.nodes).toEqual(['ECM', 'BCM', 'Tester']);
        expect(model.stats).toEqual({
            messageCount: 1,
            signalCount: 2,
            nodeCount: 3,
            extendedMessageCount: 0,
            maxDlc: 8
        });

        const message = model.messages[0];
        expect(message).toMatchObject({
            id: 256,
            idHex: '0x100',
            name: 'EngineData',
            dlc: 8,
            transmitter: 'ECM',
            comment: 'Engine telemetry frame'
        });
        expect(message.signals[0]).toMatchObject({
            name: 'EngineSpeed',
            startBit: 24,
            length: 16,
            byteOrder: 'little_endian',
            valueType: 'unsigned',
            factor: 0.125,
            offset: 0,
            minimum: 0,
            maximum: 8031.875,
            unit: 'rpm',
            receivers: ['BCM', 'Tester'],
            comment: 'Current crankshaft speed'
        });
        expect(message.signals[1].values).toEqual([
            { value: 0, label: 'Off' },
            { value: 1, label: 'Idle' },
            { value: 2, label: 'Run' }
        ]);
    });

    it('supports signed Motorola signals and extended frame ids', () => {
        const model = DbcParser.parse([
            'BU_: Vector__XXX',
            'BO_ 2147483904 ExtendedFrame: 8 Vector__XXX',
            ' SG_ Temperature : 7|12@0- (0.1,-40) [-40|210] "degC" Vector__XXX'
        ].join('\n'));

        expect(model.stats.extendedMessageCount).toBe(1);
        expect(model.messages[0].signals[0]).toMatchObject({
            byteOrder: 'big_endian',
            valueType: 'signed',
            factor: 0.1,
            offset: -40
        });
    });
});
