export type TomlNodeKind = 'table' | 'inline-table' | 'array' | 'array-of-tables' | 'key-value';
export type TomlValueType = 'string' | 'integer' | 'float' | 'boolean' | 'datetime' | 'array' | 'table';

export interface TomlPosition {
    line: number;
    character: number;
}

export interface TomlRange {
    start: TomlPosition;
    end: TomlPosition;
}

export interface TomlNode {
    id: string;
    type: TomlNodeKind;
    valueType: TomlValueType;
    key?: string;
    value?: unknown;
    valuePreview?: string;
    children: TomlNode[];
    range: TomlRange;
    path: string;
    comment?: string;
}

export interface TomlWarning {
    message: string;
    range: TomlRange;
}

export interface TomlParseResult {
    root: TomlNode;
    flattened: Array<{
        path: string;
        value: unknown;
        valuePreview: string;
        type: TomlValueType;
        range: TomlRange;
    }>;
    jsonValue: unknown;
    warnings: TomlWarning[];
}

interface MutableTomlNode extends TomlNode {
    children: MutableTomlNode[];
}

interface ParsedValue {
    value: unknown;
    valueType: TomlValueType;
    nodeType: TomlNodeKind;
    valuePreview: string;
    children: MutableTomlNode[];
}

export class TomlParser {
    private idSequence = 0;
    private readonly warnings: TomlWarning[] = [];
    private readonly pathMap = new Map<string, MutableTomlNode>();
    private readonly seenAssignments = new Map<string, TomlRange>();
    private readonly root: MutableTomlNode;
    private currentTable: MutableTomlNode;

    private constructor(private readonly source: string) {
        const lineCount = Math.max(1, source.split(/\r?\n/).length);
        this.root = this.createNode({
            type: 'table',
            valueType: 'table',
            key: 'root',
            path: '',
            range: this.createRange(0, 0, lineCount - 1, 0)
        });
        this.currentTable = this.root;
        this.pathMap.set('', this.root);
    }

    public static parse(source: string): TomlParseResult {
        const parser = new TomlParser(source);
        return parser.parseDocument();
    }

    private parseDocument(): TomlParseResult {
        const lines = this.source.split(/\r?\n/);
        let pendingComments: string[] = [];

        lines.forEach((line, lineIndex) => {
            const trimmed = line.trim();

            if (!trimmed) {
                pendingComments = [];
                return;
            }

            if (trimmed.startsWith('#')) {
                pendingComments.push(trimmed.replace(/^#+\s?/, ''));
                return;
            }

            const comment = pendingComments.join('\n') || undefined;
            pendingComments = [];

            const content = this.stripComment(line).trim();
            if (!content) {
                return;
            }

            const tableMatch = content.match(/^\[\s*([^\][]+?)\s*]$/);
            const arrayTableMatch = content.match(/^\[\[\s*([^\][]+?)\s*]]$/);

            if (arrayTableMatch) {
                this.currentTable = this.addArrayOfTables(arrayTableMatch[1], lineIndex, line, comment);
                return;
            }

            if (tableMatch) {
                this.currentTable = this.ensureTable(tableMatch[1], lineIndex, line, comment);
                return;
            }

            this.parseKeyValueLine(content, lineIndex, line, comment);
        });

        return {
            root: this.root,
            flattened: this.flattenValues(this.root),
            jsonValue: this.toJsonValue(this.root),
            warnings: this.warnings
        };
    }

    private parseKeyValueLine(content: string, lineIndex: number, originalLine: string, comment?: string): void {
        const equalsIndex = this.findTopLevelChar(content, '=');
        if (equalsIndex < 0) {
            this.warnings.push({
                message: 'Expected key/value assignment.',
                range: this.createRange(lineIndex, 0, lineIndex, originalLine.length)
            });
            return;
        }

        const rawKey = content.slice(0, equalsIndex).trim();
        const rawValue = content.slice(equalsIndex + 1).trim();
        const keyParts = this.parsePath(rawKey);

        if (keyParts.length === 0) {
            this.warnings.push({
                message: 'Missing key before assignment.',
                range: this.createRange(lineIndex, 0, lineIndex, originalLine.length)
            });
            return;
        }

        const parent = keyParts.length === 1
            ? this.currentTable
            : this.ensureNestedTables(this.currentTable, keyParts.slice(0, -1), lineIndex, originalLine);
        const key = keyParts[keyParts.length - 1];
        const path = this.joinPath(parent.path, key);
        const range = this.createRange(lineIndex, originalLine.indexOf(rawKey), lineIndex, originalLine.length);
        const parsedValue = this.parseValue(rawValue, path, range);

        if (this.seenAssignments.has(path)) {
            this.warnings.push({
                message: `Duplicate key: ${path}`,
                range
            });
        }
        this.seenAssignments.set(path, range);

        const existing = parent.children.find((child) => child.key === key);
        if (existing) {
            parent.children = parent.children.filter((child) => child !== existing);
            this.pathMap.delete(existing.path);
        }

        const node = this.createNode({
            type: parsedValue.nodeType,
            valueType: parsedValue.valueType,
            key,
            value: parsedValue.value,
            valuePreview: parsedValue.valuePreview,
            children: parsedValue.children,
            range,
            path,
            comment
        });

        this.repathChildren(node);
        parent.children.push(node);
        this.pathMap.set(path, node);
    }

    private ensureNestedTables(parent: MutableTomlNode, parts: string[], lineIndex: number, originalLine: string): MutableTomlNode {
        let cursor = parent;
        for (const part of parts) {
            const path = this.joinPath(cursor.path, part);
            let child = cursor.children.find((node) => node.key === part && this.isContainer(node));
            if (!child) {
                child = this.createNode({
                    type: 'table',
                    valueType: 'table',
                    key: part,
                    path,
                    range: this.createRange(lineIndex, originalLine.indexOf(part), lineIndex, originalLine.length)
                });
                cursor.children.push(child);
                this.pathMap.set(path, child);
            }
            cursor = child;
        }
        return cursor;
    }

    private ensureTable(rawPath: string, lineIndex: number, originalLine: string, comment?: string): MutableTomlNode {
        let cursor = this.root;
        const parts = this.parsePath(rawPath);
        parts.forEach((part, index) => {
            const path = this.joinPath(cursor.path, part);
            let child = cursor.children.find((node) => node.key === part && node.type === 'table');
            if (!child) {
                child = this.createNode({
                    type: 'table',
                    valueType: 'table',
                    key: part,
                    path,
                    range: this.createRange(lineIndex, originalLine.indexOf(part), lineIndex, originalLine.length),
                    comment: index === parts.length - 1 ? comment : undefined
                });
                cursor.children.push(child);
                this.pathMap.set(path, child);
            } else if (index === parts.length - 1 && comment) {
                child.comment = comment;
                child.range = this.createRange(lineIndex, originalLine.indexOf(part), lineIndex, originalLine.length);
            }
            cursor = child;
        });
        return cursor;
    }

    private addArrayOfTables(rawPath: string, lineIndex: number, originalLine: string, comment?: string): MutableTomlNode {
        const parts = this.parsePath(rawPath);
        const tableKey = parts[parts.length - 1];
        const parent = this.ensureNestedTables(this.root, parts.slice(0, -1), lineIndex, originalLine);
        const arrayPath = this.joinPath(parent.path, tableKey);
        let arrayNode = parent.children.find((node) => node.key === tableKey && node.type === 'array-of-tables');

        if (!arrayNode) {
            arrayNode = this.createNode({
                type: 'array-of-tables',
                valueType: 'array',
                key: tableKey,
                path: arrayPath,
                range: this.createRange(lineIndex, originalLine.indexOf(tableKey), lineIndex, originalLine.length),
                comment
            });
            parent.children.push(arrayNode);
            this.pathMap.set(arrayPath, arrayNode);
        }

        const index = arrayNode.children.length;
        const entryPath = `${arrayPath}[${index}]`;
        const entry = this.createNode({
            type: 'table',
            valueType: 'table',
            key: `[${index}]`,
            path: entryPath,
            range: this.createRange(lineIndex, originalLine.indexOf(tableKey), lineIndex, originalLine.length),
            comment: index === 0 ? comment : undefined
        });
        arrayNode.children.push(entry);
        this.pathMap.set(entryPath, entry);
        return entry;
    }

    private parseValue(rawValue: string, path: string, range: TomlRange): ParsedValue {
        const trimmed = rawValue.trim();

        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const children = this.parseInlineTable(trimmed.slice(1, -1), path, range);
            return {
                value: this.childrenToObject(children),
                valueType: 'table',
                nodeType: 'inline-table',
                valuePreview: `{ ${children.length} keys }`,
                children
            };
        }

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            const items = this.splitTopLevel(trimmed.slice(1, -1), ',')
                .filter((item) => item.trim().length > 0)
                .map((item) => this.parseValue(item, path, range));
            return {
                value: items.map((item) => item.value),
                valueType: 'array',
                nodeType: 'array',
                valuePreview: `[ ${items.length} items ]`,
                children: items.map((item, index) => {
                    const node = this.createNode({
                        type: item.nodeType,
                        valueType: item.valueType,
                        key: `[${index}]`,
                        value: item.value,
                        valuePreview: item.valuePreview,
                        children: item.children,
                        path: `${path}[${index}]`,
                        range
                    });
                    this.repathChildren(node);
                    return node;
                })
            };
        }

        if (trimmed === 'true' || trimmed === 'false') {
            const value = trimmed === 'true';
            return this.primitive(value, 'boolean', String(value));
        }

        if (/^[+-]?\d+$/.test(trimmed.replace(/_/g, ''))) {
            const value = Number.parseInt(trimmed.replace(/_/g, ''), 10);
            return this.primitive(value, 'integer', String(value));
        }

        if (/^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+e[+-]?\d+|\d+\.\d*e[+-]?\d+)$/i.test(trimmed.replace(/_/g, ''))) {
            const value = Number.parseFloat(trimmed.replace(/_/g, ''));
            return this.primitive(value, 'float', String(value));
        }

        if (/^\d{4}-\d{2}-\d{2}(?:[Tt ][0-9:.+-Zz]+)?$/.test(trimmed)) {
            return this.primitive(trimmed, 'datetime', trimmed);
        }

        const value = this.unquote(trimmed);
        return this.primitive(value, 'string', JSON.stringify(value));
    }

    private parseInlineTable(content: string, parentPath: string, range: TomlRange): MutableTomlNode[] {
        return this.splitTopLevel(content, ',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
                const equalsIndex = this.findTopLevelChar(entry, '=');
                const rawKey = equalsIndex >= 0 ? entry.slice(0, equalsIndex).trim() : entry;
                const key = this.parsePath(rawKey).join('.');
                const childPath = this.joinPath(parentPath, key);
                const parsedValue = this.parseValue(equalsIndex >= 0 ? entry.slice(equalsIndex + 1).trim() : '', childPath, range);
                const node = this.createNode({
                    type: parsedValue.nodeType,
                    valueType: parsedValue.valueType,
                    key,
                    value: parsedValue.value,
                    valuePreview: parsedValue.valuePreview,
                    children: parsedValue.children,
                    path: childPath,
                    range
                });
                this.repathChildren(node);
                return node;
            });
    }

    private primitive(value: unknown, valueType: TomlValueType, valuePreview: string): ParsedValue {
        return {
            value,
            valueType,
            nodeType: 'key-value',
            valuePreview,
            children: []
        };
    }

    private stripComment(line: string): string {
        let quote: string | null = null;

        for (let index = 0; index < line.length; index++) {
            const char = line[index];
            const previous = line[index - 1];

            if ((char === '"' || char === "'") && previous !== '\\') {
                quote = quote === char ? null : quote ?? char;
            }

            if (char === '#' && !quote) {
                return line.slice(0, index);
            }
        }

        return line;
    }

    private parsePath(rawPath: string): string[] {
        return this.splitTopLevel(rawPath, '.')
            .map((part) => this.unquote(part.trim()))
            .filter(Boolean);
    }

    private splitTopLevel(input: string, delimiter: string): string[] {
        const parts: string[] = [];
        let current = '';
        let quote: string | null = null;
        let bracketDepth = 0;
        let braceDepth = 0;

        for (let index = 0; index < input.length; index++) {
            const char = input[index];
            const previous = input[index - 1];

            if ((char === '"' || char === "'") && previous !== '\\') {
                quote = quote === char ? null : quote ?? char;
            }

            if (!quote) {
                if (char === '[') {
                    bracketDepth++;
                } else if (char === ']') {
                    bracketDepth--;
                } else if (char === '{') {
                    braceDepth++;
                } else if (char === '}') {
                    braceDepth--;
                } else if (char === delimiter && bracketDepth === 0 && braceDepth === 0) {
                    parts.push(current);
                    current = '';
                    continue;
                }
            }

            current += char;
        }

        parts.push(current);
        return parts;
    }

    private findTopLevelChar(input: string, target: string): number {
        let quote: string | null = null;
        let bracketDepth = 0;
        let braceDepth = 0;

        for (let index = 0; index < input.length; index++) {
            const char = input[index];
            const previous = input[index - 1];

            if ((char === '"' || char === "'") && previous !== '\\') {
                quote = quote === char ? null : quote ?? char;
            }

            if (!quote) {
                if (char === '[') {
                    bracketDepth++;
                } else if (char === ']') {
                    bracketDepth--;
                } else if (char === '{') {
                    braceDepth++;
                } else if (char === '}') {
                    braceDepth--;
                } else if (char === target && bracketDepth === 0 && braceDepth === 0) {
                    return index;
                }
            }
        }

        return -1;
    }

    private unquote(value: string): string {
        const trimmed = value.trim();
        if (
            (trimmed.startsWith('"') && trimmed.endsWith('"'))
            || (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
    }

    private createNode(input: Partial<MutableTomlNode> & {
        type: TomlNodeKind;
        valueType: TomlValueType;
        range: TomlRange;
        path: string;
    }): MutableTomlNode {
        return {
            id: `toml-node-${this.idSequence++}`,
            key: input.key,
            type: input.type,
            valueType: input.valueType,
            value: input.value,
            valuePreview: input.valuePreview,
            children: input.children ?? [],
            range: input.range,
            path: input.path,
            comment: input.comment
        };
    }

    private createRange(startLine: number, startCharacter: number, endLine: number, endCharacter: number): TomlRange {
        return {
            start: { line: Math.max(0, startLine), character: Math.max(0, startCharacter) },
            end: { line: Math.max(0, endLine), character: Math.max(0, endCharacter) }
        };
    }

    private joinPath(parentPath: string, key: string): string {
        if (!parentPath) {
            return key;
        }
        if (key.startsWith('[')) {
            return `${parentPath}${key}`;
        }
        return `${parentPath}.${key}`;
    }

    private isContainer(node: MutableTomlNode): boolean {
        return node.type === 'table' || node.type === 'inline-table' || node.type === 'array' || node.type === 'array-of-tables';
    }

    private repathChildren(node: MutableTomlNode): void {
        node.children.forEach((child) => {
            child.path = this.joinPath(node.path, child.key ?? '');
            this.repathChildren(child);
        });
    }

    private flattenValues(node: MutableTomlNode): TomlParseResult['flattened'] {
        const rows: TomlParseResult['flattened'] = [];
        const visit = (current: MutableTomlNode) => {
            if (current.type === 'key-value' || current.valueType !== 'table' && current.valueType !== 'array') {
                rows.push({
                    path: current.path,
                    value: current.value,
                    valuePreview: current.valuePreview ?? '',
                    type: current.valueType,
                    range: current.range
                });
            }
            current.children.forEach(visit);
        };
        node.children.forEach(visit);
        return rows;
    }

    private childrenToObject(children: MutableTomlNode[]): Record<string, unknown> {
        return children.reduce<Record<string, unknown>>((result, child) => {
            result[child.key ?? child.path] = child.children.length > 0 ? this.toJsonValue(child) : child.value;
            return result;
        }, {});
    }

    private toJsonValue(node: MutableTomlNode): unknown {
        if (node.type === 'array' || node.type === 'array-of-tables') {
            return node.children.map((child) => this.toJsonValue(child));
        }

        if (node.children.length > 0 || node.valueType === 'table') {
            return this.childrenToObject(node.children);
        }

        return node.value;
    }
}
