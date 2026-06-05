export interface DbcRange {
    line: number;
    column: number;
}

export interface DbcSignalValue {
    value: number;
    label: string;
}

export interface DbcSignal {
    name: string;
    multiplexer: string | null;
    startBit: number;
    length: number;
    byteOrder: 'little_endian' | 'big_endian';
    valueType: 'unsigned' | 'signed';
    factor: number;
    offset: number;
    minimum: number;
    maximum: number;
    unit: string;
    receivers: string[];
    comment: string | null;
    values: DbcSignalValue[];
    line: number;
}

export interface DbcMessage {
    id: number;
    idHex: string;
    name: string;
    dlc: number;
    transmitter: string;
    comment: string | null;
    signals: DbcSignal[];
    line: number;
}

export interface DbcComment {
    target: 'network' | 'node' | 'message' | 'signal' | 'unknown';
    messageId?: number;
    signalName?: string;
    nodeName?: string;
    text: string;
    line: number;
}

export interface DbcViewerModel {
    version: string;
    busConfiguration: string | null;
    nodes: string[];
    messages: DbcMessage[];
    comments: DbcComment[];
    warnings: string[];
    stats: {
        messageCount: number;
        signalCount: number;
        nodeCount: number;
        extendedMessageCount: number;
        maxDlc: number;
    };
}

export class DbcParser {
    public static parse(source: string): DbcViewerModel {
        const model: DbcViewerModel = {
            version: '',
            busConfiguration: null,
            nodes: [],
            messages: [],
            comments: [],
            warnings: [],
            stats: {
                messageCount: 0,
                signalCount: 0,
                nodeCount: 0,
                extendedMessageCount: 0,
                maxDlc: 0
            }
        };

        const messagesById = new Map<number, DbcMessage>();
        const lines = source.split(/\r?\n/);
        let currentMessage: DbcMessage | null = null;

        lines.forEach((line, index) => {
            const lineNumber = index + 1;
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }

            if (trimmed.startsWith('VERSION')) {
                model.version = this.unquote(trimmed.replace(/^VERSION\s*/, '').trim());
                return;
            }

            if (trimmed.startsWith('BS_:')) {
                model.busConfiguration = trimmed.slice(4).trim() || null;
                return;
            }

            if (trimmed.startsWith('BU_:')) {
                model.nodes = trimmed.slice(4).trim().split(/\s+/).filter(Boolean);
                return;
            }

            const message = this.parseMessage(trimmed, lineNumber);
            if (message) {
                currentMessage = message;
                model.messages.push(message);
                messagesById.set(message.id, message);
                return;
            }

            const signal = this.parseSignal(trimmed, lineNumber);
            if (signal) {
                if (!currentMessage) {
                    model.warnings.push(`Line ${lineNumber}: signal "${signal.name}" appears before any message.`);
                    return;
                }
                currentMessage.signals.push(signal);
                return;
            }

            const comment = this.parseComment(trimmed, lineNumber);
            if (comment) {
                model.comments.push(comment);
                this.attachComment(comment, messagesById);
                return;
            }

            const valueTable = this.parseValueTable(trimmed);
            if (valueTable) {
                const targetMessage = messagesById.get(valueTable.messageId);
                const targetSignal = targetMessage?.signals.find(signalItem => signalItem.name === valueTable.signalName);
                if (targetSignal) {
                    targetSignal.values = valueTable.values;
                } else {
                    model.warnings.push(`Line ${lineNumber}: value table target ${valueTable.messageId}.${valueTable.signalName} was not found.`);
                }
            }
        });

        model.stats.messageCount = model.messages.length;
        model.stats.signalCount = model.messages.reduce((sum, message) => sum + message.signals.length, 0);
        model.stats.nodeCount = model.nodes.length;
        model.stats.extendedMessageCount = model.messages.filter(message => message.id > 0x7FF).length;
        model.stats.maxDlc = model.messages.reduce((max, message) => Math.max(max, message.dlc), 0);

        return model;
    }

    private static parseMessage(line: string, lineNumber: number): DbcMessage | null {
        const match = /^BO_\s+(\d+)\s+([A-Za-z_][\w.]*)\s*:\s*(\d+)\s+(\S+)/.exec(line);
        if (!match) {
            return null;
        }

        const id = Number(match[1]);
        return {
            id,
            idHex: `0x${id.toString(16).toUpperCase()}`,
            name: match[2],
            dlc: Number(match[3]),
            transmitter: match[4],
            comment: null,
            signals: [],
            line: lineNumber
        };
    }

    private static parseSignal(line: string, lineNumber: number): DbcSignal | null {
        const match = /^SG_\s+([A-Za-z_][\w.]*)\s*(M|m\d+)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s+\(([-+.\deE]+),([-+.\deE]+)\)\s+\[([-+.\deE]+)\|([-+.\deE]+)\]\s+"([^"]*)"\s*(.*)$/.exec(line);
        if (!match) {
            return null;
        }

        return {
            name: match[1],
            multiplexer: match[2] || null,
            startBit: Number(match[3]),
            length: Number(match[4]),
            byteOrder: match[5] === '1' ? 'little_endian' : 'big_endian',
            valueType: match[6] === '+' ? 'unsigned' : 'signed',
            factor: Number(match[7]),
            offset: Number(match[8]),
            minimum: Number(match[9]),
            maximum: Number(match[10]),
            unit: match[11],
            receivers: match[12].trim().split(',').map(receiver => receiver.trim()).filter(Boolean),
            comment: null,
            values: [],
            line: lineNumber
        };
    }

    private static parseComment(line: string, lineNumber: number): DbcComment | null {
        let match = /^CM_\s+BO_\s+(\d+)\s+"((?:[^"\\]|\\.)*)"\s*;/.exec(line);
        if (match) {
            return { target: 'message', messageId: Number(match[1]), text: this.unescape(match[2]), line: lineNumber };
        }

        match = /^CM_\s+SG_\s+(\d+)\s+([A-Za-z_][\w.]*)\s+"((?:[^"\\]|\\.)*)"\s*;/.exec(line);
        if (match) {
            return { target: 'signal', messageId: Number(match[1]), signalName: match[2], text: this.unescape(match[3]), line: lineNumber };
        }

        match = /^CM_\s+BU_\s+(\S+)\s+"((?:[^"\\]|\\.)*)"\s*;/.exec(line);
        if (match) {
            return { target: 'node', nodeName: match[1], text: this.unescape(match[2]), line: lineNumber };
        }

        match = /^CM_\s+"((?:[^"\\]|\\.)*)"\s*;/.exec(line);
        if (match) {
            return { target: 'network', text: this.unescape(match[1]), line: lineNumber };
        }

        return null;
    }

    private static parseValueTable(line: string): { messageId: number; signalName: string; values: DbcSignalValue[] } | null {
        const match = /^VAL_\s+(\d+)\s+([A-Za-z_][\w.]*)\s+(.+);$/.exec(line);
        if (!match) {
            return null;
        }

        const values: DbcSignalValue[] = [];
        const valueSource = match[3];
        const valuePattern = /(-?\d+)\s+"((?:[^"\\]|\\.)*)"/g;
        let valueMatch: RegExpExecArray | null;
        while ((valueMatch = valuePattern.exec(valueSource)) !== null) {
            values.push({
                value: Number(valueMatch[1]),
                label: this.unescape(valueMatch[2])
            });
        }

        return {
            messageId: Number(match[1]),
            signalName: match[2],
            values
        };
    }

    private static attachComment(comment: DbcComment, messagesById: Map<number, DbcMessage>): void {
        if (comment.target === 'message' && comment.messageId !== undefined) {
            const message = messagesById.get(comment.messageId);
            if (message) {
                message.comment = comment.text;
            }
        }

        if (comment.target === 'signal' && comment.messageId !== undefined && comment.signalName) {
            const message = messagesById.get(comment.messageId);
            const signal = message?.signals.find(signalItem => signalItem.name === comment.signalName);
            if (signal) {
                signal.comment = comment.text;
            }
        }
    }

    private static unquote(value: string): string {
        if (value.startsWith('"') && value.endsWith('"')) {
            return this.unescape(value.slice(1, -1));
        }
        return value;
    }

    private static unescape(value: string): string {
        return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
}
