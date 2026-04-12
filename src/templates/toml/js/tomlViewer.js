class TomlWorkbench {
    constructor() {
        this.source = window.tomlSource || '';
        this.model = window.tomlModel || { root: { children: [] }, flattened: [], jsonValue: {}, warnings: [] };
        this.nodeById = new Map();
        this.selectedNode = this.model.root;
        this.activePanel = 'tree';
        this.lineOffsets = this.computeLineOffsets(this.source);
        this.elements = {
            sourceView: document.getElementById('sourceView'),
            sourceCaption: document.getElementById('sourceCaption'),
            treeView: document.getElementById('treeView'),
            flattenView: document.getElementById('flattenView'),
            jsonView: document.getElementById('jsonView'),
            panelTitle: document.getElementById('panelTitle'),
            panelCaption: document.getElementById('panelCaption'),
            statusBadge: document.getElementById('statusBadge'),
            currentPath: document.getElementById('currentPath'),
            copyPathBtn: document.getElementById('copyPathBtn'),
            copyFlattenBtn: document.getElementById('copyFlattenBtn'),
            copyJsonBtn: document.getElementById('copyJsonBtn'),
            searchInput: document.getElementById('searchInput'),
            searchMode: document.getElementById('searchMode'),
            expandAllBtn: document.getElementById('expandAllBtn'),
            collapseAllBtn: document.getElementById('collapseAllBtn'),
            warningPanel: document.getElementById('warningPanel')
        };
        this.init();
    }

    init() {
        this.elements.sourceView.value = this.source;
        this.indexNodes(this.model.root);
        this.renderTree();
        this.renderFlatten();
        this.renderJson();
        this.renderWarnings();
        this.bindEvents();
        this.selectNode(this.model.root, { revealSource: false });
        this.setStatus(this.model.warnings.length > 0 ? `${this.model.warnings.length} warning(s)` : 'TOML structure ready', this.model.warnings.length > 0);
    }

    bindEvents() {
        this.elements.sourceView.addEventListener('click', () => this.syncTreeFromCursor());
        this.elements.sourceView.addEventListener('keyup', () => this.syncTreeFromCursor());
        this.elements.searchInput.addEventListener('input', () => this.applySearch());
        this.elements.searchMode.addEventListener('change', () => {
            this.updateSearchPlaceholder();
            this.applySearch();
        });
        this.elements.expandAllBtn.addEventListener('click', () => this.setAllTreeNodesExpanded(true));
        this.elements.collapseAllBtn.addEventListener('click', () => this.setAllTreeNodesExpanded(false));

        this.elements.copyPathBtn.addEventListener('click', async () => {
            await this.copyText(this.selectedNode.path || 'root');
            this.setStatus('Path copied');
        });

        this.elements.copyFlattenBtn.addEventListener('click', async () => {
            await this.copyText(this.toFlattenKey(this.selectedNode.path || 'root'));
            this.setStatus('Flatten key copied');
        });

        this.elements.copyJsonBtn.addEventListener('click', async () => {
            await this.copyText(this.elements.jsonView.textContent || '');
            this.setStatus('Converted JSON copied');
        });

        document.querySelectorAll('[data-panel]').forEach((button) => {
            button.addEventListener('click', () => {
                this.setActivePanel(button.dataset.panel);
            });
        });
    }

    updateSearchPlaceholder() {
        const placeholders = {
            all: 'Search key, path, or value',
            key: 'Search keys only',
            path: 'Search full paths only',
            value: 'Search values only'
        };
        this.elements.searchInput.placeholder = placeholders[this.elements.searchMode.value] || placeholders.all;
    }

    renderTree() {
        this.elements.treeView.innerHTML = '';
        this.elements.treeView.appendChild(this.createTreeNode(this.model.root, true));
    }

    createTreeNode(node, expanded) {
        const wrapper = document.createElement('div');
        wrapper.className = `tree-node${node === this.model.root ? ' is-root' : ''}`;
        wrapper.dataset.nodeId = node.id;

        const row = document.createElement('div');
        row.className = 'tree-row';
        row.dataset.nodeId = node.id;

        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        if (hasChildren) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'tree-toggle';
            toggle.textContent = expanded ? '-' : '+';
            toggle.addEventListener('click', (event) => {
                event.stopPropagation();
                const children = wrapper.querySelector(':scope > .tree-children');
                const isOpen = children && !children.classList.contains('is-hidden');
                if (children) {
                    children.classList.toggle('is-hidden', isOpen);
                }
                toggle.textContent = isOpen ? '+' : '-';
            });
            row.appendChild(toggle);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'tree-spacer';
            row.appendChild(spacer);
        }

        row.appendChild(this.createNodeLabel(node));
        row.addEventListener('click', () => this.selectNode(node, { revealSource: true }));
        wrapper.appendChild(row);

        if (hasChildren) {
            const children = document.createElement('div');
            children.className = `tree-children${expanded ? '' : ' is-hidden'}`;
            node.children.forEach((child) => {
                children.appendChild(this.createTreeNode(child, node === this.model.root));
            });
            wrapper.appendChild(children);
        }

        return wrapper;
    }

    createNodeLabel(node) {
        const label = document.createElement('span');
        const key = node.key || 'root';
        const typeLabel = node.type === 'key-value' ? node.valueType : node.type;
        label.innerHTML = [
            `<span class="node-key">${this.escapeHtml(key)}</span>`,
            `<span class="type-badge type-${this.escapeHtml(typeLabel)}">${this.escapeHtml(typeLabel)}</span>`,
            node.valuePreview ? `<span class="node-preview">${this.escapeHtml(node.valuePreview)}</span>` : '',
            node.comment ? `<span class="node-comment"># ${this.escapeHtml(node.comment)}</span>` : ''
        ].filter(Boolean).join(' ');
        return label;
    }

    renderFlatten() {
        this.elements.flattenView.innerHTML = '';

        if (!this.model.flattened || this.model.flattened.length === 0) {
            this.elements.flattenView.textContent = 'No key/value entries.';
            return;
        }

        this.model.flattened.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'flat-row';
            row.dataset.path = entry.path;
            row.innerHTML = [
                `<span class="flat-path">${this.escapeHtml(entry.path)}</span>`,
                `<span class="type-badge type-${this.escapeHtml(entry.type)}">${this.escapeHtml(entry.type)}</span>`,
                `<span class="flat-value">${this.escapeHtml(entry.valuePreview)}</span>`
            ].join('');
            row.addEventListener('click', () => {
                const node = this.findNodeByPath(entry.path);
                if (node) {
                    this.selectNode(node, { revealSource: true });
                }
            });
            this.elements.flattenView.appendChild(row);
        });
    }

    renderJson() {
        this.elements.jsonView.textContent = JSON.stringify(this.model.jsonValue, null, 2);
    }

    renderWarnings() {
        if (!this.model.warnings || this.model.warnings.length === 0) {
            return;
        }

        this.elements.warningPanel.classList.remove('is-hidden');
        this.elements.warningPanel.innerHTML = this.model.warnings
            .map((warning) => `<div>Line ${warning.range.start.line + 1}: ${this.escapeHtml(warning.message)}</div>`)
            .join('');
    }

    setActivePanel(panel) {
        this.activePanel = panel;
        this.elements.treeView.classList.toggle('is-hidden', panel !== 'tree');
        this.elements.flattenView.classList.toggle('is-hidden', panel !== 'flatten');
        this.elements.jsonView.classList.toggle('is-hidden', panel !== 'json');
        this.elements.copyJsonBtn.classList.toggle('is-hidden', panel !== 'json');
        this.elements.panelTitle.textContent = panel === 'flatten' ? 'Flatten' : panel === 'json' ? 'JSON' : 'Tree';
        this.elements.panelCaption.textContent = panel === 'flatten'
            ? 'Path based key/value list'
            : panel === 'json'
                ? 'Converted TOML value'
                : 'Structured TOML nodes';

        document.querySelectorAll('[data-panel]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.panel === panel);
        });
    }

    selectNode(node, options = { revealSource: false }) {
        this.selectedNode = node;
        this.elements.currentPath.textContent = node.path || 'root';
        this.elements.sourceCaption.textContent = node.range
            ? `Line ${node.range.start.line + 1}, column ${node.range.start.character + 1}`
            : 'Cursor sync enabled';

        document.querySelectorAll('.tree-row.is-selected, .flat-row.is-selected').forEach((row) => {
            row.classList.remove('is-selected');
        });

        const treeRow = document.querySelector(`.tree-row[data-node-id="${node.id}"]`);
        if (treeRow) {
            this.revealTreeRow(treeRow);
            treeRow.classList.add('is-selected');
        }

        const flatRow = document.querySelector(`.flat-row[data-path="${CSS.escape(node.path || '')}"]`);
        if (flatRow) {
            flatRow.classList.add('is-selected');
        }

        if (options.revealSource && node.range) {
            this.revealSourceRange(node.range);
        }
    }

    revealTreeRow(row) {
        let current = row.parentElement;
        while (current && current !== this.elements.treeView) {
            if (current.classList.contains('tree-children')) {
                current.classList.remove('is-hidden');
                const toggle = current.parentElement && current.parentElement.querySelector(':scope > .tree-row > .tree-toggle');
                if (toggle) {
                    toggle.textContent = '-';
                }
            }
            current = current.parentElement;
        }
        row.scrollIntoView({ block: 'nearest' });
    }

    revealSourceRange(range) {
        const start = this.offsetAt(range.start.line, range.start.character);
        const end = this.offsetAt(range.end.line, Math.max(range.end.character, range.start.character + 1));
        this.elements.sourceView.focus();
        this.elements.sourceView.setSelectionRange(start, end);
        this.scrollSourceToLine(range.start.line);
    }

    scrollSourceToLine(line) {
        const lineHeight = Number.parseFloat(getComputedStyle(this.elements.sourceView).lineHeight) || 20;
        this.elements.sourceView.scrollTop = Math.max(0, line * lineHeight - this.elements.sourceView.clientHeight / 3);
    }

    syncTreeFromCursor() {
        const position = this.positionAt(this.elements.sourceView.selectionStart);
        const node = this.findDeepestNodeAt(position.line, position.character) || this.model.root;
        this.selectNode(node, { revealSource: false });
    }

    findDeepestNodeAt(line, character) {
        let match = null;
        const visit = (node) => {
            if (node.range && this.containsPosition(node.range, line, character)) {
                match = node;
                (node.children || []).forEach(visit);
            }
        };
        visit(this.model.root);
        return match;
    }

    containsPosition(range, line, character) {
        const startsBefore = line > range.start.line || line === range.start.line && character >= range.start.character;
        const endsAfter = line < range.end.line || line === range.end.line && character <= range.end.character;
        return startsBefore && endsAfter;
    }

    applySearch() {
        const query = this.elements.searchInput.value.trim().toLowerCase();
        const mode = this.elements.searchMode.value;
        let matches = 0;

        document.querySelectorAll('.tree-row').forEach((row) => {
            const node = this.nodeById.get(row.dataset.nodeId);
            const matched = !query || this.matchesNode(node, query, mode);
            row.style.display = matched ? '' : 'none';
            if (matched && query) {
                matches++;
                this.revealTreeRow(row);
            }
        });

        document.querySelectorAll('.flat-row').forEach((row) => {
            const node = this.findNodeByPath(row.dataset.path);
            const matched = !query || this.matchesNode(node, query, mode);
            row.style.display = matched ? '' : 'none';
        });

        this.setStatus(query ? `${matches} match(es)` : 'Search cleared');
    }

    matchesNode(node, query, mode) {
        if (!node) {
            return false;
        }
        const fields = {
            key: node.key || '',
            path: node.path || '',
            value: node.valuePreview || String(node.value ?? '')
        };
        if (mode === 'all') {
            return Object.values(fields).some((value) => value.toLowerCase().includes(query));
        }
        return fields[mode].toLowerCase().includes(query);
    }

    setAllTreeNodesExpanded(expanded) {
        document.querySelectorAll('.tree-children').forEach((children) => {
            children.classList.toggle('is-hidden', !expanded);
        });
        document.querySelectorAll('.tree-toggle').forEach((toggle) => {
            toggle.textContent = expanded ? '-' : '+';
        });
        this.setStatus(expanded ? 'Tree expanded' : 'Tree collapsed');
    }

    indexNodes(node) {
        this.nodeById.set(node.id, node);
        (node.children || []).forEach((child) => this.indexNodes(child));
    }

    findNodeByPath(path) {
        let found = null;
        this.nodeById.forEach((node) => {
            if (node.path === path) {
                found = node;
            }
        });
        return found;
    }

    async copyText(text) {
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }

    toFlattenKey(path) {
        return path || 'root';
    }

    computeLineOffsets(text) {
        const offsets = [0];
        for (let index = 0; index < text.length; index++) {
            if (text[index] === '\n') {
                offsets.push(index + 1);
            }
        }
        return offsets;
    }

    offsetAt(line, character) {
        const lineOffset = this.lineOffsets[Math.min(line, this.lineOffsets.length - 1)] || 0;
        return Math.min(this.source.length, lineOffset + character);
    }

    positionAt(offset) {
        let low = 0;
        let high = this.lineOffsets.length - 1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (this.lineOffsets[mid] <= offset) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        const line = Math.max(0, low - 1);
        return {
            line,
            character: offset - this.lineOffsets[line]
        };
    }

    setStatus(message, warning = false) {
        this.elements.statusBadge.textContent = message;
        this.elements.statusBadge.classList.toggle('is-warning', warning);
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new TomlWorkbench();
});
