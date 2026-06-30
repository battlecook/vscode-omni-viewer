export interface ProtoRange {
    startLine: number;
    endLine: number;
}

export interface ProtoField {
    name: string;
    type: string;
    label: string;
    number: number;
    repeated: boolean;
    optional: boolean;
    map: boolean;
    oneof?: string;
    options: string[];
    documentation: string;
    line: number;
}

export interface ProtoMessage {
    kind: 'message';
    name: string;
    fullName: string;
    documentation: string;
    fields: ProtoField[];
    messages: ProtoMessage[];
    enums: ProtoEnum[];
    oneofs: string[];
    reserved: string[];
    range: ProtoRange;
}

export interface ProtoEnumValue {
    name: string;
    number: number;
    documentation: string;
    line: number;
}

export interface ProtoEnum {
    kind: 'enum';
    name: string;
    fullName: string;
    documentation: string;
    values: ProtoEnumValue[];
    range: ProtoRange;
}

export interface ProtoRpc {
    name: string;
    requestType: string;
    responseType: string;
    requestStream: boolean;
    responseStream: boolean;
    documentation: string;
    line: number;
}

export interface ProtoService {
    kind: 'service';
    name: string;
    fullName: string;
    documentation: string;
    rpcs: ProtoRpc[];
    range: ProtoRange;
}

export interface ProtoReference {
    from: string;
    fromKind: 'field' | 'rpc' | 'import';
    name: string;
    to: string;
    line: number;
}

export interface ProtoModel {
    fileName: string;
    syntax: string;
    packageName: string;
    imports: string[];
    messages: ProtoMessage[];
    enums: ProtoEnum[];
    services: ProtoService[];
    references: ProtoReference[];
    warnings: string[];
    stats: {
        messages: number;
        enums: number;
        services: number;
        rpcs: number;
        fields: number;
        imports: number;
    };
}

type ProtoContainer = ProtoMessage | ProtoEnum | ProtoService;

interface StackFrame {
    kind: 'message' | 'enum' | 'service' | 'oneof' | 'block';
    name: string;
    fullName: string;
    node?: ProtoContainer;
}

const scalarTypes = new Set([
    'double', 'float', 'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64',
    'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'bool', 'string', 'bytes'
]);

const declarationPattern = /^(.+?)\s+([A-Za-z_][\w]*)\s*=\s*([0-9]+)\s*(?:\[([^\]]*)\])?\s*;/;
const labeledFieldPattern = /^(optional|required|repeated)\s+(.+?)$/;

export function parseProto(source: string, fileName = ''): ProtoModel {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const model: ProtoModel = {
        fileName,
        syntax: '',
        packageName: '',
        imports: [],
        messages: [],
        enums: [],
        services: [],
        references: [],
        warnings: [],
        stats: { messages: 0, enums: 0, services: 0, rpcs: 0, fields: 0, imports: 0 }
    };
    const stack: StackFrame[] = [];
    const docs: string[] = [];
    let inBlockComment = false;
    let blockComment: string[] = [];

    const consumeDocs = () => {
        const value = docs.join('\n').trim();
        docs.length = 0;
        return value;
    };

    const currentMessage = () => {
        for (let index = stack.length - 1; index >= 0; index--) {
            if (stack[index].kind === 'message') {
                return stack[index].node as ProtoMessage;
            }
        }
        return undefined;
    };

    const currentEnum = () => stack[stack.length - 1]?.kind === 'enum' ? stack[stack.length - 1].node as ProtoEnum : undefined;
    const currentService = () => stack[stack.length - 1]?.kind === 'service' ? stack[stack.length - 1].node as ProtoService : undefined;
    const currentOneof = () => stack[stack.length - 1]?.kind === 'oneof' ? stack[stack.length - 1].name : undefined;

    lines.forEach((rawLine, index) => {
        const lineNumber = index + 1;
        let line = rawLine.trim();

        if (inBlockComment) {
            const end = line.indexOf('*/');
            if (end >= 0) {
                blockComment.push(cleanDocLine(line.slice(0, end)));
                docs.push(blockComment.join('\n').trim());
                blockComment = [];
                inBlockComment = false;
                line = line.slice(end + 2).trim();
            } else {
                blockComment.push(cleanDocLine(line));
                return;
            }
        }

        if (!line) {
            return;
        }

        if (line.startsWith('//')) {
            docs.push(line.replace(/^\/\/\s?/, ''));
            return;
        }

        if (line.startsWith('/*')) {
            const end = line.indexOf('*/', 2);
            if (end >= 0) {
                docs.push(cleanDocLine(line.slice(2, end)));
                line = line.slice(end + 2).trim();
            } else {
                inBlockComment = true;
                blockComment = [cleanDocLine(line.slice(2))];
                return;
            }
        }

        line = stripInlineComment(line).trim();
        if (!line) {
            return;
        }

        const syntaxMatch = line.match(/^syntax\s*=\s*"([^"]+)"\s*;/);
        if (syntaxMatch) {
            model.syntax = syntaxMatch[1];
            consumeDocs();
            return;
        }

        const packageMatch = line.match(/^package\s+([\w.]+)\s*;/);
        if (packageMatch) {
            model.packageName = packageMatch[1];
            consumeDocs();
            return;
        }

        const importMatch = line.match(/^import\s+(?:public\s+|weak\s+)?["']([^"']+)["']\s*;/);
        if (importMatch) {
            model.imports.push(importMatch[1]);
            model.references.push({
                from: fileName || 'current file',
                fromKind: 'import',
                name: importMatch[1],
                to: importMatch[1],
                line: lineNumber
            });
            consumeDocs();
            return;
        }

        const messageMatch = line.match(/^message\s+([A-Za-z_]\w*)\s*\{/);
        if (messageMatch) {
            const parent = currentMessage();
            const fullName = qualifyName(messageMatch[1], parent?.fullName || model.packageName);
            const message: ProtoMessage = {
                kind: 'message',
                name: messageMatch[1],
                fullName,
                documentation: consumeDocs(),
                fields: [],
                messages: [],
                enums: [],
                oneofs: [],
                reserved: [],
                range: { startLine: lineNumber, endLine: lineNumber }
            };
            if (parent) {
                parent.messages.push(message);
            } else {
                model.messages.push(message);
            }
            stack.push({ kind: 'message', name: message.name, fullName, node: message });
            return;
        }

        const enumMatch = line.match(/^enum\s+([A-Za-z_]\w*)\s*\{/);
        if (enumMatch) {
            const parent = currentMessage();
            const fullName = qualifyName(enumMatch[1], parent?.fullName || model.packageName);
            const protoEnum: ProtoEnum = {
                kind: 'enum',
                name: enumMatch[1],
                fullName,
                documentation: consumeDocs(),
                values: [],
                range: { startLine: lineNumber, endLine: lineNumber }
            };
            if (parent) {
                parent.enums.push(protoEnum);
            } else {
                model.enums.push(protoEnum);
            }
            stack.push({ kind: 'enum', name: protoEnum.name, fullName, node: protoEnum });
            return;
        }

        const serviceMatch = line.match(/^service\s+([A-Za-z_]\w*)\s*\{/);
        if (serviceMatch) {
            const fullName = qualifyName(serviceMatch[1], model.packageName);
            const service: ProtoService = {
                kind: 'service',
                name: serviceMatch[1],
                fullName,
                documentation: consumeDocs(),
                rpcs: [],
                range: { startLine: lineNumber, endLine: lineNumber }
            };
            model.services.push(service);
            stack.push({ kind: 'service', name: service.name, fullName, node: service });
            return;
        }

        const oneofMatch = line.match(/^oneof\s+([A-Za-z_]\w*)\s*\{/);
        if (oneofMatch) {
            currentMessage()?.oneofs.push(oneofMatch[1]);
            stack.push({ kind: 'oneof', name: oneofMatch[1], fullName: oneofMatch[1] });
            consumeDocs();
            return;
        }

        if (line.endsWith('{') && !/^rpc\b/.test(line)) {
            stack.push({ kind: 'block', name: '', fullName: '' });
            consumeDocs();
            return;
        }

        const enumNode = currentEnum();
        const enumValueMatch = line.match(/^([A-Za-z_]\w*)\s*=\s*(-?\d+)\s*(?:\[[^\]]*\])?\s*;/);
        if (enumNode && enumValueMatch) {
            enumNode.values.push({
                name: enumValueMatch[1],
                number: Number(enumValueMatch[2]),
                documentation: consumeDocs(),
                line: lineNumber
            });
            return;
        }

        const service = currentService();
        const rpcMatch = line.match(/^rpc\s+([A-Za-z_]\w*)\s*\(\s*(stream\s+)?([.\w]+)\s*\)\s+returns\s*\(\s*(stream\s+)?([.\w]+)\s*\)/);
        if (service && rpcMatch) {
            const rpc: ProtoRpc = {
                name: rpcMatch[1],
                requestType: cleanTypeName(rpcMatch[3]),
                responseType: cleanTypeName(rpcMatch[5]),
                requestStream: Boolean(rpcMatch[2]),
                responseStream: Boolean(rpcMatch[4]),
                documentation: consumeDocs(),
                line: lineNumber
            };
            service.rpcs.push(rpc);
            model.references.push({ from: `${service.fullName}.${rpc.name}`, fromKind: 'rpc', name: 'request', to: rpc.requestType, line: lineNumber });
            model.references.push({ from: `${service.fullName}.${rpc.name}`, fromKind: 'rpc', name: 'response', to: rpc.responseType, line: lineNumber });
            if (line.includes('{')) {
                stack.push({ kind: 'block', name: '', fullName: '' });
            }
            return;
        }

        const message = currentMessage();
        if (message) {
            const reservedMatch = line.match(/^reserved\s+(.+);/);
            if (reservedMatch) {
                message.reserved.push(reservedMatch[1]);
                consumeDocs();
                return;
            }

            const field = parseField(line, lineNumber, consumeDocs(), currentOneof());
            if (field) {
                message.fields.push(field);
                if (!scalarTypes.has(cleanTypeName(field.type)) && !field.map) {
                    model.references.push({
                        from: message.fullName,
                        fromKind: 'field',
                        name: field.name,
                        to: cleanTypeName(field.type),
                        line: lineNumber
                    });
                }
                return;
            }
        }

        if (line.includes('}')) {
            for (let closeCount = countChars(line, '}'); closeCount > 0; closeCount--) {
                const frame = stack.pop();
                if (frame?.node) {
                    frame.node.range.endLine = lineNumber;
                }
            }
            consumeDocs();
            return;
        }

        consumeDocs();
    });

    model.stats = buildStats(model);
    model.warnings = buildWarnings(model);
    return model;
}

function parseField(line: string, lineNumber: number, documentation: string, oneof?: string): ProtoField | null {
    if (line.startsWith('option ') || line.startsWith('extensions ')) {
        return null;
    }

    let candidate = line;
    let label = '';
    const labelMatch = candidate.match(labeledFieldPattern);
    if (labelMatch) {
        label = labelMatch[1];
        candidate = labelMatch[2];
    }

    const match = candidate.match(declarationPattern);
    if (!match) {
        return null;
    }

    const rawType = match[1];
    const name = match[2];
    const options = match[4] ? match[4].split(',').map(option => option.trim()).filter(Boolean) : [];
    return {
        name,
        type: rawType,
        label,
        number: Number(match[3]),
        repeated: label === 'repeated',
        optional: label === 'optional',
        map: rawType.startsWith('map<'),
        oneof,
        options,
        documentation,
        line: lineNumber
    };
}

function buildStats(model: ProtoModel): ProtoModel['stats'] {
    const messages = flattenMessages(model.messages);
    const enums = [...model.enums, ...messages.flatMap(message => flattenEnums(message.enums))];
    const rpcs = model.services.reduce((sum, service) => sum + service.rpcs.length, 0);
    const fields = messages.reduce((sum, message) => sum + message.fields.length, 0);
    return {
        messages: messages.length,
        enums: enums.length,
        services: model.services.length,
        rpcs,
        fields,
        imports: model.imports.length
    };
}

function buildWarnings(model: ProtoModel): string[] {
    const warnings: string[] = [];
    const messages = flattenMessages(model.messages);
    const fullNames = new Set<string>([
        ...messages.map(message => message.fullName),
        ...messages.flatMap(message => flattenEnums(message.enums).map(protoEnum => protoEnum.fullName)),
        ...model.enums.map(protoEnum => protoEnum.fullName)
    ]);
    const shortNames = new Set([...fullNames].map(name => name.split('.').pop() || name));

    for (const message of messages) {
        const numbers = new Map<number, string>();
        for (const field of message.fields) {
            const existing = numbers.get(field.number);
            if (existing) {
                warnings.push(`${message.fullName} reuses field number ${field.number} for ${existing} and ${field.name}.`);
            }
            numbers.set(field.number, field.name);
        }
    }

    for (const reference of model.references.filter(reference => reference.fromKind !== 'import')) {
        const target = reference.to.replace(/^\./, '');
        if (!scalarTypes.has(target) && !fullNames.has(target) && !shortNames.has(target.split('.').pop() || target)) {
            warnings.push(`${reference.from} references ${reference.to} on line ${reference.line}, but it is not declared in this file.`);
        }
    }

    if (!model.syntax) {
        warnings.push('No syntax declaration found.');
    }

    return warnings;
}

function flattenMessages(messages: ProtoMessage[]): ProtoMessage[] {
    return messages.flatMap(message => [message, ...flattenMessages(message.messages)]);
}

function flattenEnums(enums: ProtoEnum[]): ProtoEnum[] {
    return enums;
}

function qualifyName(name: string, prefix: string): string {
    return prefix ? `${prefix}.${name}` : name;
}

function stripInlineComment(line: string): string {
    let inQuote = false;
    for (let index = 0; index < line.length - 1; index++) {
        const char = line[index];
        if (char === '"' && line[index - 1] !== '\\') {
            inQuote = !inQuote;
        }
        if (!inQuote && char === '/' && line[index + 1] === '/') {
            return line.slice(0, index);
        }
    }
    return line;
}

function cleanDocLine(value: string): string {
    return value.replace(/^\s*\*\s?/, '').trim();
}

function cleanTypeName(type: string): string {
    return type.replace(/^\./, '').trim();
}

function countChars(value: string, char: string): number {
    return [...value].filter(candidate => candidate === char).length;
}
