class YamlViewer {
    constructor(model) {
        this.vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
        this.model = model;
        this.currentDocumentIndex = 'all';
        this.currentViewMode = 'tree';
        this.selectedNode = null;
        this.nodeById = new Map();
        this.matchIds = new Set();
        this.allDocumentsRoot = this.createAllDocumentsRoot();
        this.elements = {
            summaryText: document.getElementById('summaryText'),
            statusBadge: document.getElementById('statusBadge'),
            documentSelect: document.getElementById('documentSelect'),
            searchInput: document.getElementById('searchInput'),
            searchMode: document.getElementById('searchMode'),
            currentPath: document.getElementById('currentPath'),
            copyPathBtn: document.getElementById('copyPathBtn'),
            copyJsonPathBtn: document.getElementById('copyJsonPathBtn'),
            copyJsonBtn: document.getElementById('copyJsonBtn'),
            sourceEditor: document.getElementById('sourceEditor'),
            sourceCursor: document.getElementById('sourceCursor'),
            viewTitle: document.getElementById('viewTitle'),
            matchCount: document.getElementById('matchCount'),
            treeView: document.getElementById('treeView'),
            flattenView: document.getElementById('flattenView'),
            jsonView: document.getElementById('jsonView'),
            diagnosticsPanel: document.getElementById('diagnosticsPanel'),
            diagnosticList: document.getElementById('diagnosticList'),
            diagnosticCount: document.getElementById('diagnosticCount')
        };
        this.init();
    }

    init() {
        this.elements.sourceEditor.value = this.model.source || '';
        this.populateDocuments();
        this.bindEvents();
        this.renderDiagnostics();
        this.renderCurrentDocument();
        this.selectNode(this.currentDocument.root, false);
        this.updateSummary();
    }

    bindEvents() {
        this.elements.documentSelect.addEventListener('change', () => {
            const selectedValue = this.elements.documentSelect.value;
            this.currentDocumentIndex = selectedValue === 'all' ? 'all' : Number(selectedValue);
            this.renderCurrentDocument();
            this.selectNode(this.currentDocument.root, false);
            this.runSearch();
        });

        document.querySelectorAll('[data-view-mode]').forEach((button) => {
            button.addEventListener('click', () => {
                this.currentViewMode = button.dataset.viewMode;
                document.querySelectorAll('[data-view-mode]').forEach((item) => {
                    item.classList.toggle('is-active', item === button);
                });
                this.renderViews();
            });
        });

        this.elements.searchInput.addEventListener('input', () => this.runSearch());
        this.elements.searchMode.addEventListener('change', () => this.runSearch());
        this.elements.copyPathBtn.addEventListener('click', () => this.copyCurrentPath(false));
        this.elements.copyJsonPathBtn.addEventListener('click', () => this.copyCurrentPath(true));
        this.elements.copyJsonBtn.addEventListener('click', () => this.copyCurrentJson());

        this.elements.sourceEditor.addEventListener('click', () => this.syncFromSourceCursor());
        this.elements.sourceEditor.addEventListener('keyup', () => this.syncFromSourceCursor());
        this.elements.sourceEditor.addEventListener('select', () => this.syncFromSourceCursor());

        window.addEventListener('message', (event) => {
            if (event.data?.type === 'editorSelectionChanged') {
                const offset = this.lineColumnToOffset(event.data.line, event.data.column);
                const node = this.findDeepestNodeAtOffset(this.currentDocument.root, offset);
                if (node) {
                    this.selectNode(node, false);
                }
            }
        });
    }

    get currentDocument() {
        if (this.currentDocumentIndex === 'all') {
            return {
                index: 'all',
                root: this.allDocumentsRoot,
                jsonValue: this.model.documents.map((doc) => doc.jsonValue),
                diagnostics: this.model.diagnostics,
                anchors: this.model.documents.flatMap((doc) => doc.anchors)
            };
        }
        return this.model.documents[this.currentDocumentIndex] || this.model.documents[0];
    }

    populateDocuments() {
        this.elements.documentSelect.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'ALL';
        this.elements.documentSelect.appendChild(allOption);

        this.model.documents.forEach((doc) => {
            const option = document.createElement('option');
            option.value = String(doc.index);
            option.textContent = this.model.documents.length > 1 ? `Document ${doc.index + 1}` : 'Document 1';
            this.elements.documentSelect.appendChild(option);
        });
        this.elements.documentSelect.value = 'all';
    }

    createAllDocumentsRoot() {
        const sourceLength = (this.model.source || '').length;
        return {
            id: 'yaml-all-documents',
            type: 'array',
            kind: 'sequence',
            key: 'ALL',
            children: this.model.documents.map((doc) => doc.root),
            range: {
                start: { line: 1, column: 1, offset: 0 },
                end: this.offsetToLineColumnRange(sourceLength)
            },
            path: 'documents',
            jsonPath: '$',
            depth: 0,
            aliases: [],
            domainTags: []
        };
    }

    renderCurrentDocument() {
        this.nodeById.clear();
        this.collectNodes(this.currentDocument.root);
        this.renderViews();
        this.renderJson();
    }

    renderViews() {
        this.elements.treeView.classList.toggle('is-hidden', this.currentViewMode !== 'tree');
        this.elements.flattenView.classList.toggle('is-hidden', this.currentViewMode !== 'flatten');
        this.elements.jsonView.classList.toggle('is-hidden', this.currentViewMode !== 'json');

        if (this.currentViewMode === 'tree') {
            this.elements.viewTitle.textContent = 'Structure tree';
            this.renderTree();
        } else if (this.currentViewMode === 'flatten') {
            this.elements.viewTitle.textContent = 'Flatten view';
            this.renderFlatten();
        } else {
            this.elements.viewTitle.textContent = 'JSON view';
            this.renderJson();
        }
    }

    renderTree() {
        this.elements.treeView.innerHTML = '';
        this.elements.treeView.appendChild(this.createTreeNode(this.currentDocument.root, true));
        this.paintSelection();
    }

    createTreeNode(node, expanded) {
        const wrapper = document.createElement('div');
        wrapper.className = `tree-node${node.depth === 0 ? ' root' : ''}`;
        wrapper.dataset.nodeId = node.id;

        const row = document.createElement('div');
        row.className = 'tree-row';
        row.dataset.nodeId = node.id;
        if (this.matchIds.has(node.id)) {
            row.classList.add('is-match');
        }

        if (node.children.length > 0) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'tree-toggle';
            toggle.textContent = expanded ? '▾' : '▸';
            toggle.addEventListener('click', (event) => {
                event.stopPropagation();
                const isOpen = children.style.display !== 'none';
                children.style.display = isOpen ? 'none' : 'block';
                toggle.textContent = isOpen ? '▸' : '▾';
            });
            row.appendChild(toggle);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'tree-spacer';
            row.appendChild(spacer);
        }

        row.appendChild(this.createNodeLabel(node));
        row.addEventListener('click', () => this.selectNode(node, true));
        wrapper.appendChild(row);

        if (node.children.length > 0) {
            var children = document.createElement('div');
            children.className = 'tree-children';
            children.style.display = expanded ? 'block' : 'none';
            node.children.forEach((child) => {
                children.appendChild(this.createTreeNode(child, false));
            });
            wrapper.appendChild(children);
        }

        return wrapper;
    }

    createNodeLabel(node) {
        const label = document.createElement('div');
        label.className = 'node-label';

        const name = document.createElement('span');
        if (node.index !== undefined) {
            name.className = 'node-index';
            name.textContent = `[${node.index}]`;
        } else {
            name.className = 'node-key';
            name.textContent = node.key || 'root';
        }
        label.appendChild(name);

        label.appendChild(this.text(' ', ''));
        label.appendChild(this.text(node.kind, 'node-type'));

        if (node.type !== 'value') {
            label.appendChild(this.text(` ${node.children.length} ${node.type === 'array' ? 'items' : 'keys'}`, 'node-meta'));
        } else {
            label.appendChild(this.text(': ', 'node-meta'));
            const value = this.text(this.formatValue(node), `node-value ${node.scalarType || 'unknown'}`);
            label.appendChild(value);
        }

        this.addBadges(label, node);
        return label;
    }

    addBadges(label, node) {
        if (node.anchor) {
            label.appendChild(this.badge(`&${node.anchor}`, 'anchor', `${node.aliases.length} alias usage${node.aliases.length === 1 ? '' : 's'}`));
        }
        if (node.alias) {
            label.appendChild(this.badge(`→ &${node.alias.name}`, 'alias', node.alias.path ? `Origin: ${node.alias.path || 'root'}` : 'Missing origin'));
        }
        if (node.merge) {
            label.appendChild(this.badge(`merge ${node.merge.mergedKeys.length}`, 'alias', `Merged from ${node.merge.sources.map((item) => `&${item.name}`).join(', ')}`));
        }
        if (node.overrideOf) {
            label.appendChild(this.badge('override', 'warning', `Overrides ${node.overrideOf.name}`));
        }
        if (node.ambiguous) {
            label.appendChild(this.badge('ambiguous', 'warning', 'YAML 1.1 may treat this as boolean'));
        }
        node.domainTags.forEach((tag) => {
            label.appendChild(this.badge(tag, 'alias', tag));
        });
    }

    renderFlatten() {
        const rows = [];
        this.collectNodes(this.currentDocument.root, (node) => rows.push(node));
        this.elements.flattenView.innerHTML = '';

        rows.forEach((node) => {
            const row = document.createElement('div');
            row.className = 'flatten-row';
            row.dataset.nodeId = node.id;
            if (this.matchIds.has(node.id)) {
                row.classList.add('is-match');
            }
            row.innerHTML = `
                <span class="flatten-path">${this.escapeHtml(node.path || 'root')}</span>
                <span class="node-type">${this.escapeHtml(node.kind)}</span>
                <span class="node-value ${this.escapeHtml(node.scalarType || '')}">${this.escapeHtml(this.formatValue(node))}</span>
            `;
            row.addEventListener('click', () => this.selectNode(node, true));
            this.elements.flattenView.appendChild(row);
        });
        this.paintSelection();
    }

    renderJson() {
        this.elements.jsonView.textContent = JSON.stringify(this.currentDocument.jsonValue, null, 2);
    }

    renderDiagnostics() {
        const diagnostics = this.model.diagnostics || [];
        this.elements.diagnosticsPanel.classList.toggle('is-hidden', diagnostics.length === 0);
        this.elements.diagnosticCount.textContent = `${diagnostics.length} item${diagnostics.length === 1 ? '' : 's'}`;
        this.elements.diagnosticList.innerHTML = '';

        diagnostics.forEach((diagnostic) => {
            const item = document.createElement('div');
            item.className = 'diagnostic-item';
            item.innerHTML = `
                <span class="diagnostic-severity ${this.escapeHtml(diagnostic.severity)}">${this.escapeHtml(diagnostic.severity)}</span>
                <span>${this.escapeHtml(diagnostic.message)}</span>
                <span class="panel-caption">${diagnostic.range ? ` line ${diagnostic.range.start.line}` : ''}</span>
            `;
            item.addEventListener('click', () => {
                if (diagnostic.range) {
                    this.selectSourceRange(diagnostic.range);
                    this.postReveal(diagnostic.range);
                }
            });
            this.elements.diagnosticList.appendChild(item);
        });
    }

    runSearch() {
        const query = this.elements.searchInput.value.trim().toLowerCase();
        const mode = this.elements.searchMode.value;
        this.matchIds.clear();

        if (query) {
            this.collectNodes(this.currentDocument.root, (node) => {
                const fields = {
                    key: node.key || (node.index !== undefined ? String(node.index) : ''),
                    path: `${node.path || 'root'} ${node.jsonPath}`,
                    value: `${node.displayValue ?? ''} ${node.raw ?? ''}`
                };
                const haystack = mode === 'all'
                    ? `${fields.key} ${fields.path} ${fields.value}`
                    : fields[mode];
                if (haystack.toLowerCase().includes(query)) {
                    this.matchIds.add(node.id);
                }
            });
        }

        this.elements.matchCount.textContent = query
            ? `${this.matchIds.size} match${this.matchIds.size === 1 ? '' : 'es'}`
            : '0 matches';
        this.renderViews();
    }

    selectNode(node, revealSource) {
        this.selectedNode = node;
        this.elements.currentPath.textContent = node.path || 'root';
        this.selectSourceRange(node.range);
        this.paintSelection();
        if (revealSource) {
            this.postReveal(node.range);
        }
    }

    selectSourceRange(range) {
        if (!range) {
            return;
        }
        this.elements.sourceEditor.focus();
        this.elements.sourceEditor.setSelectionRange(range.start.offset, range.end.offset);
        this.elements.sourceCursor.textContent = `Line ${range.start.line}, Column ${range.start.column}`;
    }

    paintSelection() {
        document.querySelectorAll('.tree-row.is-selected, .flatten-row.is-selected').forEach((element) => {
            element.classList.remove('is-selected');
        });
        if (!this.selectedNode) {
            return;
        }
        document.querySelectorAll(`[data-node-id="${CSS.escape(this.selectedNode.id)}"].tree-row, [data-node-id="${CSS.escape(this.selectedNode.id)}"].flatten-row`).forEach((element) => {
            element.classList.add('is-selected');
            element.scrollIntoView({ block: 'nearest' });
        });
    }

    syncFromSourceCursor() {
        const offset = this.elements.sourceEditor.selectionStart;
        const lineColumn = this.offsetToLineColumn(offset);
        this.elements.sourceCursor.textContent = `Line ${lineColumn.line}, Column ${lineColumn.column}`;
        const node = this.findDeepestNodeAtOffset(this.currentDocument.root, offset);
        if (node && node !== this.selectedNode) {
            this.selectedNode = node;
            this.elements.currentPath.textContent = node.path || 'root';
            this.paintSelection();
        }
    }

    findDeepestNodeAtOffset(node, offset) {
        if (!this.offsetInside(node.range, offset)) {
            return null;
        }
        for (const child of node.children) {
            const match = this.findDeepestNodeAtOffset(child, offset);
            if (match) {
                return match;
            }
        }
        return node;
    }

    offsetInside(range, offset) {
        return range && offset >= range.start.offset && offset <= range.end.offset;
    }

    copyCurrentPath(jsonPath) {
        if (!this.selectedNode) {
            return;
        }
        const value = jsonPath ? this.selectedNode.jsonPath : (this.selectedNode.path || 'root');
        navigator.clipboard.writeText(value).then(() => {
            this.elements.statusBadge.textContent = jsonPath ? 'JSONPath copied' : 'Path copied';
            window.setTimeout(() => this.updateSummary(), 1200);
        });
    }

    copyCurrentJson() {
        const json = JSON.stringify(this.currentDocument.jsonValue, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            this.elements.statusBadge.textContent = 'JSON copied';
            window.setTimeout(() => this.updateSummary(), 1200);
        });
    }

    postReveal(range) {
        if (this.vscode) {
            this.vscode.postMessage({ type: 'revealSource', range });
        }
    }

    updateSummary() {
        const docCount = this.model.documents.length;
        const diagnosticCount = (this.model.diagnostics || []).length;
        const anchors = this.model.documents.reduce((count, doc) => count + doc.anchors.length, 0);
        this.elements.summaryText.textContent = `${docCount} document${docCount === 1 ? '' : 's'} · ${this.model.fileSize} · ${anchors} anchor${anchors === 1 ? '' : 's'}`;
        this.elements.statusBadge.textContent = diagnosticCount > 0 ? `${diagnosticCount} validation item${diagnosticCount === 1 ? '' : 's'}` : 'Valid YAML';
        this.elements.statusBadge.classList.toggle('has-error', (this.model.diagnostics || []).some((item) => item.severity === 'error'));
        this.elements.statusBadge.classList.toggle('has-warning', diagnosticCount > 0 && !(this.model.diagnostics || []).some((item) => item.severity === 'error'));
    }

    collectNodes(node, visitor) {
        this.nodeById.set(node.id, node);
        if (visitor) {
            visitor(node);
        }
        node.children.forEach((child) => this.collectNodes(child, visitor));
    }

    formatValue(node) {
        if (node.type === 'object') {
            return `{ ${node.children.length} keys }`;
        }
        if (node.type === 'array') {
            return `[ ${node.children.length} items ]`;
        }
        const value = node.displayValue ?? '';
        if (node.scalarType === 'string') {
            return `"${value}"`;
        }
        return String(value);
    }

    offsetToLineColumn(offset) {
        const text = this.model.source.slice(0, offset).replace(/\r\n/g, '\n');
        const lines = text.split('\n');
        return {
            line: lines.length,
            column: lines[lines.length - 1].length + 1
        };
    }

    offsetToLineColumnRange(offset) {
        const position = this.offsetToLineColumn(offset);
        return {
            ...position,
            offset
        };
    }

    lineColumnToOffset(line, column) {
        let offset = 0;
        let currentLine = 1;
        while (offset < this.model.source.length && currentLine < line) {
            const char = this.model.source[offset];
            if (char === '\n') {
                currentLine += 1;
            }
            offset += 1;
        }
        return Math.min(offset + Math.max(column - 1, 0), this.model.source.length);
    }

    text(content, className) {
        const span = document.createElement('span');
        if (className) {
            span.className = className;
        }
        span.textContent = content;
        return span;
    }

    badge(content, className, title) {
        const span = document.createElement('span');
        span.className = `badge ${className}`;
        span.textContent = content;
        span.title = title || content;
        return span;
    }

    escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

new YamlViewer(window.yamlModel);
