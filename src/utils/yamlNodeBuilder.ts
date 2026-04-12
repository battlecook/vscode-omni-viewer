import {
    Alias,
    Document,
    isAlias,
    isMap,
    isPair,
    isScalar,
    isSeq,
    LineCounter,
    Pair,
    parseAllDocuments,
    Scalar,
    YAMLMap,
    YAMLSeq
} from 'yaml';

export type YamlNodeType = 'object' | 'array' | 'value';
export type YamlKind = 'mapping' | 'sequence' | 'scalar';
export type YamlScalarType = 'string' | 'number' | 'boolean' | 'null' | 'date' | 'alias' | 'unknown';

export interface YamlPosition {
    line: number;
    column: number;
    offset: number;
}

export interface YamlRange {
    start: YamlPosition;
    end: YamlPosition;
}

export interface YamlAnchorReference {
    name: string;
    path?: string;
    range?: YamlRange;
}

export interface YamlMergeInfo {
    sources: YamlAnchorReference[];
    mergedKeys: string[];
    overriddenKeys: string[];
}

export interface YamlViewerNode {
    id: string;
    type: YamlNodeType;
    kind: YamlKind;
    key?: string;
    index?: number;
    value?: unknown;
    displayValue?: string;
    scalarType?: YamlScalarType;
    raw?: string;
    ambiguous?: boolean;
    children: YamlViewerNode[];
    range: YamlRange;
    keyRange?: YamlRange;
    path: string;
    jsonPath: string;
    depth: number;
    anchor?: string;
    alias?: YamlAnchorReference;
    aliases: YamlAnchorReference[];
    merge?: YamlMergeInfo;
    overrideOf?: YamlAnchorReference;
    domainTags: string[];
}

export interface YamlDiagnostic {
    severity: 'error' | 'warning' | 'info';
    message: string;
    range?: YamlRange;
}

export interface YamlDocumentModel {
    index: number;
    root: YamlViewerNode;
    jsonValue: unknown;
    diagnostics: YamlDiagnostic[];
    anchors: YamlAnchorReference[];
}

export interface YamlViewerModel {
    source: string;
    documents: YamlDocumentModel[];
    diagnostics: YamlDiagnostic[];
    fileSize: string;
}

interface BuildContext {
    source: string;
    lineCounter: LineCounter;
    anchors: Map<string, YamlViewerNode>;
    aliases: Array<{ node: YamlViewerNode; alias: Alias }>;
    diagnostics: YamlDiagnostic[];
    idPrefix: string;
    nextId: number;
}

const AMBIGUOUS_YAML_11_VALUES = new Set(['yes', 'no', 'on', 'off']);

export function buildYamlViewerModel(source: string, fileSize: string): YamlViewerModel {
    const lineCounter = new LineCounter();
    const documents = parseAllDocuments(source, {
        lineCounter,
        keepSourceTokens: true,
        merge: false,
        prettyErrors: false,
        strict: false,
        uniqueKeys: false
    });
    const diagnostics: YamlDiagnostic[] = [];

    const models = documents.map((document, index) => {
        const context: BuildContext = {
            source,
            lineCounter,
            anchors: new Map(),
            aliases: [],
            diagnostics: [],
            idPrefix: `yaml-doc-${index}`,
            nextId: 1
        };

        document.errors.forEach((error) => {
            context.diagnostics.push({
                severity: 'error',
                message: error.message,
                range: rangeFromSourceRange(error.pos, source, lineCounter)
            });
        });

        document.warnings.forEach((warning) => {
            context.diagnostics.push({
                severity: 'warning',
                message: warning.message,
                range: rangeFromSourceRange(warning.pos, source, lineCounter)
            });
        });

        const rootPath = documents.length > 1 ? `documents[${index}]` : '';
        const rootJsonPath = documents.length > 1 ? `$[${index}]` : '$';
        const root = buildNode(document.contents, {
            key: documents.length > 1 ? `Document ${index + 1}` : 'root',
            path: rootPath,
            jsonPath: rootJsonPath,
            depth: 0
        }, context);

        applyAliasOrigins(context);
        applyDomainTags(root);

        const documentDiagnostics = context.diagnostics;
        diagnostics.push(...documentDiagnostics.map((diagnostic) => ({
            ...diagnostic,
            message: documents.length > 1 ? `Document ${index + 1}: ${diagnostic.message}` : diagnostic.message
        })));

        return {
            index,
            root,
            jsonValue: toJsonValue(document),
            diagnostics: documentDiagnostics,
            anchors: Array.from(context.anchors.values()).map((node) => ({
                name: node.anchor || '',
                path: node.path,
                range: node.range
            }))
        };
    });

    if (models.length === 0) {
        const context: BuildContext = {
            source,
            lineCounter,
            anchors: new Map(),
            aliases: [],
            diagnostics: [],
            idPrefix: 'yaml-doc-0',
            nextId: 1
        };
        models.push({
            index: 0,
            root: createEmptyRoot(context),
            jsonValue: null,
            diagnostics: [],
            anchors: []
        });
    }

    return {
        source,
        documents: models,
        diagnostics,
        fileSize
    };
}

function buildNode(
    yamlNode: unknown,
    info: { key?: string; index?: number; path: string; jsonPath: string; depth: number },
    context: BuildContext
): YamlViewerNode {
    if (isAlias(yamlNode)) {
        return buildAliasNode(yamlNode, info, context);
    }

    if (isMap(yamlNode)) {
        return buildMapNode(yamlNode, info, context);
    }

    if (isSeq(yamlNode)) {
        return buildSeqNode(yamlNode, info, context);
    }

    if (isScalar(yamlNode)) {
        return buildScalarNode(yamlNode, info, context);
    }

    return {
        id: createId(context),
        type: 'value',
        kind: 'scalar',
        key: info.key,
        index: info.index,
        value: null,
        displayValue: 'null',
        scalarType: 'null',
        children: [],
        range: fullSourceRange(context.source, context.lineCounter),
        path: info.path,
        jsonPath: info.jsonPath,
        depth: info.depth,
        aliases: [],
        domainTags: []
    };
}

function buildMapNode(
    yamlMap: YAMLMap,
    info: { key?: string; index?: number; path: string; jsonPath: string; depth: number },
    context: BuildContext
): YamlViewerNode {
    const node = baseNode(yamlMap, info, context, 'object', 'mapping');
    const explicitKeys = new Map<string, YamlViewerNode>();
    const duplicateKeys = new Set<string>();
    const mergedKeys = new Map<string, YamlAnchorReference>();
    const mergeSources: YamlAnchorReference[] = [];

    yamlMap.items.forEach((item) => {
        if (!isPair(item)) {
            return;
        }

        const keyText = stringifyKey(item.key);
        if (keyText === '<<') {
            collectMergeInfo(item, context, mergedKeys, mergeSources);
            return;
        }

        if (explicitKeys.has(keyText)) {
            duplicateKeys.add(keyText);
            context.diagnostics.push({
                severity: 'warning',
                message: `Duplicate key "${keyText}"`,
                range: nodeRange(item.key, context)
            });
        }

        const childPath = appendPath(info.path, keyText);
        const childJsonPath = appendJsonPath(info.jsonPath, keyText);
        const child = buildNode(item.value, {
            key: keyText,
            path: childPath,
            jsonPath: childJsonPath,
            depth: info.depth + 1
        }, context);
        child.keyRange = nodeRange(item.key, context);

        const mergedSource = mergedKeys.get(keyText);
        if (mergedSource) {
            child.overrideOf = mergedSource;
        }

        explicitKeys.set(keyText, child);
        node.children.push(child);
    });

    if (mergeSources.length > 0) {
        node.merge = {
            sources: mergeSources,
            mergedKeys: Array.from(mergedKeys.keys()),
            overriddenKeys: node.children.filter((child) => !!child.overrideOf).map((child) => child.key || '')
        };
    }

    if (duplicateKeys.size > 0) {
        node.domainTags.push(`${duplicateKeys.size} duplicate key${duplicateKeys.size === 1 ? '' : 's'}`);
    }

    registerAnchor(yamlMap, node, context);
    return node;
}

function buildSeqNode(
    yamlSeq: YAMLSeq,
    info: { key?: string; index?: number; path: string; jsonPath: string; depth: number },
    context: BuildContext
): YamlViewerNode {
    const node = baseNode(yamlSeq, info, context, 'array', 'sequence');
    yamlSeq.items.forEach((item, index) => {
        node.children.push(buildNode(item, {
            index,
            path: `${info.path}[${index}]`,
            jsonPath: `${info.jsonPath}[${index}]`,
            depth: info.depth + 1
        }, context));
    });
    registerAnchor(yamlSeq, node, context);
    return node;
}

function buildScalarNode(
    scalar: Scalar,
    info: { key?: string; index?: number; path: string; jsonPath: string; depth: number },
    context: BuildContext
): YamlViewerNode {
    const inferredType = inferScalarType(scalar);
    const raw = getRawSource(scalar, context.source);
    const node = {
        ...baseNode(scalar, info, context, 'value' as const, 'scalar' as const),
        value: normalizeScalarValue(scalar.value),
        displayValue: formatScalarDisplay(scalar.value, inferredType),
        scalarType: inferredType,
        raw,
        ambiguous: AMBIGUOUS_YAML_11_VALUES.has(raw.trim().toLowerCase())
    };
    registerAnchor(scalar, node, context);
    return node;
}

function buildAliasNode(
    alias: Alias,
    info: { key?: string; index?: number; path: string; jsonPath: string; depth: number },
    context: BuildContext
): YamlViewerNode {
    const node = {
        ...baseNode(alias, info, context, 'value' as const, 'scalar' as const),
        value: `*${alias.source}`,
        displayValue: `*${alias.source}`,
        scalarType: 'alias' as const,
        raw: getRawSource(alias, context.source),
        alias: {
            name: String(alias.source)
        }
    };
    context.aliases.push({ node, alias });
    return node;
}

function baseNode(
    yamlNode: YAMLMap | YAMLSeq | Scalar | Alias,
    info: { key?: string; index?: number; path: string; jsonPath: string; depth: number },
    context: BuildContext,
    type: YamlNodeType,
    kind: YamlKind
): YamlViewerNode {
    return {
        id: createId(context),
        type,
        kind,
        key: info.key,
        index: info.index,
        children: [],
        range: nodeRange(yamlNode, context),
        path: info.path,
        jsonPath: info.jsonPath,
        depth: info.depth,
        aliases: [],
        domainTags: []
    };
}

function collectMergeInfo(
    pair: Pair,
    context: BuildContext,
    mergedKeys: Map<string, YamlAnchorReference>,
    mergeSources: YamlAnchorReference[]
): void {
    const aliases = collectMergeAliases(pair.value);
    aliases.forEach((alias) => {
        const sourceName = String(alias.source);
        const sourceNode = context.anchors.get(sourceName);
        const reference = {
            name: sourceName,
            path: sourceNode?.path,
            range: sourceNode?.range
        };
        mergeSources.push(reference);

        if (!sourceNode) {
            context.diagnostics.push({
                severity: 'error',
                message: `Invalid merge alias "*${sourceName}"`,
                range: nodeRange(alias, context)
            });
            return;
        }

        sourceNode.children.forEach((child) => {
            const key = child.key;
            if (key && !mergedKeys.has(key)) {
                mergedKeys.set(key, reference);
            }
        });
    });
}

function collectMergeAliases(value: unknown): Alias[] {
    if (isAlias(value)) {
        return [value];
    }
    if (isSeq(value)) {
        return value.items.filter(isAlias);
    }
    return [];
}

function registerAnchor(yamlNode: YAMLMap | YAMLSeq | Scalar, node: YamlViewerNode, context: BuildContext): void {
    if (!yamlNode.anchor) {
        return;
    }

    node.anchor = yamlNode.anchor;
    context.anchors.set(yamlNode.anchor, node);
}

function applyAliasOrigins(context: BuildContext): void {
    context.aliases.forEach(({ node, alias }) => {
        const origin = context.anchors.get(String(alias.source));
        if (!origin) {
            context.diagnostics.push({
                severity: 'error',
                message: `Invalid anchor reference "*${alias.source}"`,
                range: node.range
            });
            return;
        }

        const reference = {
            name: String(alias.source),
            path: node.path,
            range: node.range
        };
        origin.aliases.push(reference);
        node.alias = {
            name: String(alias.source),
            path: origin.path,
            range: origin.range
        };
    });
}

function applyDomainTags(root: YamlViewerNode): void {
    const topLevelKeys = new Set(root.children.map((child) => child.key));
    if (topLevelKeys.has('apiVersion') && topLevelKeys.has('kind')) {
        markKubernetes(root);
    } else if (topLevelKeys.has('jobs')) {
        markGitHubActions(root);
    } else if (topLevelKeys.has('services')) {
        markDockerCompose(root);
    }
}

function markKubernetes(root: YamlViewerNode): void {
    visitNodes(root, (node) => {
        if (node.key === 'containers') {
            node.domainTags.push('Kubernetes containers');
        }
        if (node.key === 'image' || node.key === 'env' || node.key === 'ports') {
            node.domainTags.push('Kubernetes');
        }
    });
}

function markGitHubActions(root: YamlViewerNode): void {
    visitNodes(root, (node) => {
        if (node.key === 'jobs') {
            node.domainTags.push('GitHub Actions jobs');
        }
        if (node.key === 'steps') {
            node.domainTags.push('step flow');
        }
    });
}

function markDockerCompose(root: YamlViewerNode): void {
    visitNodes(root, (node) => {
        if (node.key === 'services') {
            node.domainTags.push('docker-compose services');
        }
        if (node.key === 'ports' || node.key === 'volumes' || node.key === 'environment') {
            node.domainTags.push('compose');
        }
    });
}

function visitNodes(node: YamlViewerNode, visitor: (node: YamlViewerNode) => void): void {
    visitor(node);
    node.children.forEach((child) => visitNodes(child, visitor));
}

function inferScalarType(scalar: Scalar): YamlScalarType {
    const value = scalar.value;
    const raw = sourceFromNode(scalar).trim();

    if (value === null) {
        return 'null';
    }
    if (typeof value === 'boolean') {
        return 'boolean';
    }
    if (typeof value === 'number') {
        return 'number';
    }
    if (value instanceof Date || /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]*)?$/.test(raw)) {
        return 'date';
    }
    if (typeof value === 'string') {
        return 'string';
    }
    return 'unknown';
}

function normalizeScalarValue(value: unknown): unknown {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return value;
}

function formatScalarDisplay(value: unknown, scalarType: YamlScalarType): string {
    if (value === null) {
        return 'null';
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (scalarType === 'string') {
        return String(value);
    }
    return String(value);
}

function stringifyKey(key: unknown): string {
    if (isScalar(key)) {
        if (typeof key.value === 'symbol') {
            return key.value.description || String(key.value);
        }
        return String(key.value);
    }
    if (isAlias(key)) {
        return `*${key.source}`;
    }
    return String(key ?? '');
}

function appendPath(parentPath: string, key: string): string {
    const segment = /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key) ? key : `[${JSON.stringify(key)}]`;
    if (!parentPath) {
        return segment;
    }
    return segment.startsWith('[') ? `${parentPath}${segment}` : `${parentPath}.${segment}`;
}

function appendJsonPath(parentPath: string, key: string): string {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
        return `${parentPath}.${key}`;
    }
    return `${parentPath}[${JSON.stringify(key)}]`;
}

function nodeRange(node: unknown, context: BuildContext): YamlRange {
    const range = node && typeof node === 'object' && 'range' in node ? (node as { range?: [number, number, number] }).range : undefined;
    return rangeFromSourceRange(range, context.source, context.lineCounter);
}

function rangeFromSourceRange(range: readonly number[] | undefined, source: string, lineCounter: LineCounter): YamlRange {
    const startOffset = Math.max(0, range?.[0] ?? 0);
    const endOffset = Math.max(startOffset, range?.[1] ?? startOffset);
    return {
        start: positionFromOffset(startOffset, lineCounter),
        end: positionFromOffset(Math.min(endOffset, source.length), lineCounter)
    };
}

function fullSourceRange(source: string, lineCounter: LineCounter): YamlRange {
    return {
        start: positionFromOffset(0, lineCounter),
        end: positionFromOffset(source.length, lineCounter)
    };
}

function positionFromOffset(offset: number, lineCounter: LineCounter): YamlPosition {
    const linePosition = lineCounter.linePos(offset);
    return {
        line: linePosition?.line ?? 1,
        column: linePosition?.col ?? 1,
        offset
    };
}

function getRawSource(node: Scalar | Alias, source: string): string {
    const range = node.range;
    if (range) {
        return source.slice(range[0], range[1]);
    }
    return sourceFromNode(node);
}

function sourceFromNode(node: Scalar | Alias): string {
    const sourceNode = node as { source?: unknown; srcToken?: { source?: unknown } };
    return String(sourceNode.source ?? sourceNode.srcToken?.source ?? '');
}

function toJsonValue(document: Document): unknown {
    try {
        return document.toJS({ mapAsMap: false });
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : 'Unable to convert YAML document to JSON'
        };
    }
}

function createEmptyRoot(context: BuildContext): YamlViewerNode {
    return {
        id: createId(context),
        type: 'value',
        kind: 'scalar',
        key: 'root',
        value: null,
        displayValue: 'null',
        scalarType: 'null',
        children: [],
        range: fullSourceRange(context.source, context.lineCounter),
        path: '',
        jsonPath: '$',
        depth: 0,
        aliases: [],
        domainTags: []
    };
}

function createId(context: BuildContext): string {
    const id = `${context.idPrefix}-node-${context.nextId}`;
    context.nextId += 1;
    return id;
}
