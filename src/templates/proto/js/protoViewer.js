class ProtoWorkbench {
    constructor() {
        this.source = window.protoSource || '';
        this.model = window.protoModel || {};
        this.activePanel = 'tree';
        this.selectedType = '';
        this.lineOffsets = this.computeLineOffsets(this.source);
        this.elements = {
            sourceView: document.getElementById('sourceView'),
            sourceCaption: document.getElementById('sourceCaption'),
            summaryText: document.getElementById('summaryText'),
            statusBadge: document.getElementById('statusBadge'),
            searchInput: document.getElementById('searchInput'),
            panelTitle: document.getElementById('panelTitle'),
            panelCaption: document.getElementById('panelCaption'),
            copyPanelBtn: document.getElementById('copyPanelBtn'),
            warningPanel: document.getElementById('warningPanel'),
            panels: {
                tree: document.getElementById('treePanel'),
                types: document.getElementById('typesPanel'),
                relationships: document.getElementById('relationshipsPanel'),
                reverse: document.getElementById('reversePanel'),
                json: document.getElementById('jsonPanel'),
                breaking: document.getElementById('breakingPanel'),
                imports: document.getElementById('importsPanel'),
                grpc: document.getElementById('grpcPanel'),
                docs: document.getElementById('docsPanel')
            }
        };
        this.init();
    }

    init() {
        this.renderSource();
        this.elements.summaryText.textContent = this.summary();
        this.renderAll();
        this.bindEvents();
        this.setActivePanel('tree');
        this.renderWarnings();
        this.setStatus(this.model.warnings && this.model.warnings.length ? `${this.model.warnings.length} warning(s)` : 'Proto schema ready', Boolean(this.model.warnings && this.model.warnings.length));
    }

    bindEvents() {
        document.querySelectorAll('[data-panel]').forEach((button) => {
            button.addEventListener('click', () => this.setActivePanel(button.dataset.panel));
        });
        this.elements.searchInput.addEventListener('input', () => this.applySearch());
        this.elements.copyPanelBtn.addEventListener('click', async () => {
            const text = this.elements.panels[this.activePanel].innerText || '';
            await this.copyText(text);
            this.setStatus('Panel copied');
        });
    }

    renderSource() {
        const fragment = document.createDocumentFragment();
        this.source.replace(/\r\n/g, '\n').split('\n').forEach((line, index) => {
            const row = document.createElement('span');
            row.className = 'source-line';
            row.dataset.line = String(index + 1);
            row.innerHTML = this.highlightProtoLine(line) || ' ';
            row.addEventListener('click', () => this.revealLine(index + 1));
            fragment.appendChild(row);
        });
        this.elements.sourceView.replaceChildren(fragment);
    }

    renderAll() {
        this.renderTree();
        this.renderTypes();
        this.renderRelationships();
        this.renderReverseReferences();
        this.renderJsonExamples();
        this.renderBreakingChanges();
        this.renderImports();
        this.renderGrpc();
        this.renderDocs();
    }

    setActivePanel(panel) {
        this.activePanel = panel;
        Object.entries(this.elements.panels).forEach(([key, element]) => {
            element.classList.toggle('is-hidden', key !== panel);
        });
        document.querySelectorAll('[data-panel]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.panel === panel);
        });
        const titles = {
            tree: ['Message Tree', 'Messages, fields, enums, and services'],
            types: ['Type Navigation', 'Jump between declared types'],
            relationships: ['Relationship Graph', 'Field, RPC, and import edges'],
            reverse: ['Reverse Reference', 'Who uses the selected type'],
            json: ['JSON Example Generator', 'Example payloads from message fields'],
            breaking: ['Breaking Change Detection', 'Compare a previous proto with the current schema'],
            imports: ['Import Dependency Graph', 'Imported proto files'],
            grpc: ['gRPC Service Explorer', 'Services, RPCs, streams, and message pairs'],
            docs: ['Documentation Renderer', 'Comments rendered as API documentation']
        };
        this.elements.panelTitle.textContent = titles[panel][0];
        this.elements.panelCaption.textContent = titles[panel][1];
        this.applySearch();
    }

    renderTree() {
        const root = document.createElement('div');
        root.className = 'tree-node is-root';
        this.flattenTopLevel().forEach((item) => root.appendChild(this.createTreeNode(item)));
        if (!root.children.length) {
            root.textContent = 'No messages, enums, or services found.';
        }
        this.elements.panels.tree.replaceChildren(root);
    }

    createTreeNode(item) {
        const wrapper = document.createElement('div');
        wrapper.className = 'tree-node';
        const row = this.row(`${item.name}`, item.kind, item.fullName, item.range && item.range.startLine);
        wrapper.appendChild(row);

        if (item.kind === 'message') {
            item.fields.forEach((field) => {
                wrapper.appendChild(this.row(`${field.name}: ${field.type} = ${field.number}`, field.repeated ? 'repeated' : field.oneof ? `oneof ${field.oneof}` : 'field', item.fullName, field.line));
            });
            item.enums.forEach((nestedEnum) => wrapper.appendChild(this.createTreeNode(nestedEnum)));
            item.messages.forEach((nestedMessage) => wrapper.appendChild(this.createTreeNode(nestedMessage)));
        } else if (item.kind === 'enum') {
            item.values.forEach((value) => wrapper.appendChild(this.row(`${value.name} = ${value.number}`, 'value', item.fullName, value.line)));
        } else if (item.kind === 'service') {
            item.rpcs.forEach((rpc) => wrapper.appendChild(this.row(`${rpc.name}(${rpc.requestType}) returns (${rpc.responseType})`, 'rpc', item.fullName, rpc.line)));
        }

        return wrapper;
    }

    renderTypes() {
        const panel = this.elements.panels.types;
        const select = document.createElement('select');
        select.className = 'select-input';
        this.allTypes().forEach((type) => {
            const option = document.createElement('option');
            option.value = type.fullName;
            option.textContent = `${type.kind} ${type.fullName}`;
            select.appendChild(option);
        });
        select.addEventListener('change', () => {
            this.selectedType = select.value;
            this.revealType(select.value);
            this.renderReverseReferences();
            this.renderJsonExamples();
        });

        const grid = document.createElement('div');
        grid.className = 'type-grid';
        this.allTypes().forEach((type) => {
            const card = document.createElement('div');
            card.className = 'type-card';
            card.dataset.search = `${type.kind} ${type.name} ${type.fullName}`.toLowerCase();
            card.innerHTML = `<div class="type-card-header"><span class="name">${this.escapeHtml(type.fullName)}</span><span class="badge ${type.kind}">${this.escapeHtml(type.kind)}</span></div>${this.escapeHtml(type.documentation || '')}`;
            card.addEventListener('click', () => {
                select.value = type.fullName;
                this.selectedType = type.fullName;
                this.revealType(type.fullName);
                this.renderReverseReferences();
                this.renderJsonExamples();
            });
            grid.appendChild(card);
        });
        panel.replaceChildren(select, grid);
    }

    renderRelationships() {
        const graph = document.createElement('div');
        graph.className = 'graph';
        const edges = this.relationshipEdges();
        edges.forEach((edge) => {
            const row = document.createElement('div');
            row.className = 'graph-row';
            row.dataset.search = `${edge.from} ${edge.name} ${edge.to} ${edge.kind}`.toLowerCase();
            row.innerHTML = `<span class="badge">${this.escapeHtml(edge.kind)}</span><span class="code">${this.escapeHtml(edge.from)}</span><span class="arrow">-></span><span class="name">${this.escapeHtml(edge.to)}</span><span class="muted">${this.escapeHtml(edge.name)}</span>`;
            row.addEventListener('click', () => this.revealLine(edge.line));
            graph.appendChild(row);
        });
        if (!edges.length) {
            graph.textContent = 'No relationship edges found.';
        }
        this.elements.panels.relationships.replaceChildren(graph);
    }

    renderReverseReferences() {
        const panel = this.elements.panels.reverse;
        const selected = this.selectedType || (this.allTypes()[0] && this.allTypes()[0].fullName) || '';
        this.selectedType = selected;
        const select = document.createElement('select');
        select.className = 'select-input';
        this.allTypes().forEach((type) => {
            const option = document.createElement('option');
            option.value = type.fullName;
            option.textContent = type.fullName;
            select.appendChild(option);
        });
        select.value = selected;
        select.addEventListener('change', () => {
            this.selectedType = select.value;
            this.renderReverseReferences();
            this.renderJsonExamples();
        });
        const list = document.createElement('div');
        list.className = 'graph';
        const refs = this.referencesFor(selected);
        refs.forEach((ref) => {
            const row = this.row(`${ref.from} uses ${ref.to} via ${ref.name}`, ref.fromKind, ref.from, ref.line);
            list.appendChild(row);
        });
        if (!refs.length) {
            list.innerHTML = `<div class="muted">No references found for ${this.escapeHtml(selected || 'selected type')}.</div>`;
        }
        panel.replaceChildren(select, list);
    }

    renderJsonExamples() {
        const panel = this.elements.panels.json;
        const messages = this.allMessages();
        const selected = this.selectedType && messages.find((message) => message.fullName === this.selectedType)
            ? this.selectedType
            : messages[0] && messages[0].fullName;
        const select = document.createElement('select');
        select.className = 'select-input';
        messages.forEach((message) => {
            const option = document.createElement('option');
            option.value = message.fullName;
            option.textContent = message.fullName;
            select.appendChild(option);
        });
        select.value = selected || '';
        select.addEventListener('change', () => {
            this.selectedType = select.value;
            this.renderJsonExamples();
        });
        const pre = document.createElement('pre');
        pre.className = 'pre';
        pre.textContent = selected ? JSON.stringify(this.exampleForMessage(this.findMessage(selected), new Set()), null, 2) : 'No messages found.';
        panel.replaceChildren(select, pre);
    }

    renderBreakingChanges() {
        const panel = this.elements.panels.breaking;
        const textarea = document.createElement('textarea');
        textarea.className = 'baseline-input';
        textarea.placeholder = 'Paste previous .proto content here';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toolbar-btn';
        button.textContent = 'Compare';
        const result = document.createElement('div');
        result.className = 'graph';
        button.addEventListener('click', () => {
            const previous = this.parseProtoLite(textarea.value);
            const findings = this.compareModels(previous, this.model);
            result.replaceChildren();
            if (!findings.length) {
                result.textContent = 'No breaking changes detected by structural comparison.';
                return;
            }
            findings.forEach((finding) => {
                const row = document.createElement('div');
                row.className = 'graph-row';
                row.innerHTML = `<span class="badge">${this.escapeHtml(finding.level)}</span><span>${this.escapeHtml(finding.message)}</span>`;
                result.appendChild(row);
            });
        });
        panel.replaceChildren(textarea, button, result);
    }

    renderImports() {
        const graph = document.createElement('div');
        graph.className = 'graph';
        (this.model.imports || []).forEach((item) => {
            const row = document.createElement('div');
            row.className = 'graph-row';
            row.dataset.search = item.toLowerCase();
            row.innerHTML = `<span class="code">${this.escapeHtml(this.model.fileName || 'current file')}</span><span class="arrow">-></span><span class="name">${this.escapeHtml(item)}</span>`;
            graph.appendChild(row);
        });
        if (!(this.model.imports || []).length) {
            graph.textContent = 'No imports found.';
        }
        this.elements.panels.imports.replaceChildren(graph);
    }

    renderGrpc() {
        const grid = document.createElement('div');
        grid.className = 'rpc-grid';
        (this.model.services || []).forEach((service) => {
            const card = document.createElement('div');
            card.className = 'type-card';
            card.dataset.search = `${service.name} ${service.fullName}`.toLowerCase();
            card.innerHTML = `<div class="type-card-header"><span class="name">${this.escapeHtml(service.fullName)}</span><span class="badge service">service</span></div>`;
            service.rpcs.forEach((rpc) => {
                const row = this.row(`${rpc.name}: ${rpc.requestStream ? 'stream ' : ''}${rpc.requestType} -> ${rpc.responseStream ? 'stream ' : ''}${rpc.responseType}`, 'rpc', service.fullName, rpc.line);
                card.appendChild(row);
            });
            grid.appendChild(card);
        });
        if (!grid.children.length) {
            grid.textContent = 'No gRPC services found.';
        }
        this.elements.panels.grpc.replaceChildren(grid);
    }

    renderDocs() {
        const panel = this.elements.panels.docs;
        const doc = document.createElement('div');
        doc.className = 'type-grid';
        this.allTypes().forEach((type) => {
            const card = document.createElement('div');
            card.className = 'type-card';
            const body = [type.documentation || 'No documentation comment.'];
            if (type.kind === 'message') {
                type.fields.forEach((field) => body.push(`${field.name}: ${field.documentation || field.type}`));
            } else if (type.kind === 'service') {
                type.rpcs.forEach((rpc) => body.push(`${rpc.name}: ${rpc.documentation || `${rpc.requestType} -> ${rpc.responseType}`}`));
            }
            card.dataset.search = `${type.fullName} ${body.join(' ')}`.toLowerCase();
            card.innerHTML = `<div class="type-card-header"><span class="name">${this.escapeHtml(type.fullName)}</span><span class="badge ${type.kind}">${this.escapeHtml(type.kind)}</span></div><pre class="pre">${this.escapeHtml(body.join('\n'))}</pre>`;
            doc.appendChild(card);
        });
        if (!doc.children.length) {
            doc.textContent = 'No documentable declarations found.';
        }
        panel.replaceChildren(doc);
    }

    row(text, badge, target, line) {
        const row = document.createElement('div');
        row.className = `row${line ? ' is-clickable' : ''}`;
        row.dataset.search = `${text} ${badge} ${target || ''}`.toLowerCase();
        row.innerHTML = `<span class="badge ${this.escapeHtml(String(badge).split(' ')[0])}">${this.escapeHtml(badge)}</span><span class="code">${this.escapeHtml(text)}</span>`;
        if (line) {
            row.addEventListener('click', () => this.revealLine(line));
        }
        return row;
    }

    applySearch() {
        const query = this.elements.searchInput.value.trim().toLowerCase();
        const panel = this.elements.panels[this.activePanel];
        panel.querySelectorAll('[data-search]').forEach((item) => {
            item.classList.toggle('is-hidden', query.length > 0 && !item.dataset.search.includes(query));
        });
    }

    revealType(fullName) {
        const type = this.allTypes().find((candidate) => candidate.fullName === fullName);
        if (type && type.range) {
            this.revealLine(type.range.startLine);
        }
    }

    revealLine(line) {
        this.elements.sourceView.focus();
        const lineHeight = parseFloat(getComputedStyle(this.elements.sourceView).lineHeight) || 20;
        this.elements.sourceView.scrollTop = Math.max(0, (line - 4) * lineHeight);
        this.elements.sourceView.querySelectorAll('.source-line.is-active').forEach((row) => row.classList.remove('is-active'));
        const activeLine = this.elements.sourceView.querySelector(`[data-line="${line}"]`);
        if (activeLine) {
            activeLine.classList.add('is-active');
        }
        this.elements.sourceCaption.textContent = `Line ${line}`;
    }

    renderWarnings() {
        const warnings = this.model.warnings || [];
        if (!warnings.length) {
            return;
        }
        this.elements.warningPanel.classList.remove('is-hidden');
        this.elements.warningPanel.innerHTML = warnings.map((warning) => `<div>${this.escapeHtml(warning)}</div>`).join('');
    }

    setStatus(text, warning = false) {
        this.elements.statusBadge.textContent = text;
        this.elements.statusBadge.classList.toggle('is-warning', warning);
    }

    summary() {
        const stats = this.model.stats || {};
        const parts = [
            this.model.syntax || 'proto',
            this.model.packageName || 'no package',
            `${stats.messages || 0} messages`,
            `${stats.fields || 0} fields`,
            `${stats.enums || 0} enums`,
            `${stats.rpcs || 0} RPCs`
        ];
        return parts.join(' · ');
    }

    flattenTopLevel() {
        return [...(this.model.messages || []), ...(this.model.enums || []), ...(this.model.services || [])];
    }

    allMessages(messages = this.model.messages || []) {
        return messages.flatMap((message) => [message, ...this.allMessages(message.messages || [])]);
    }

    allTypes() {
        const messages = this.allMessages();
        const nestedEnums = messages.flatMap((message) => message.enums || []);
        return [...messages, ...nestedEnums, ...(this.model.enums || []), ...(this.model.services || [])];
    }

    relationshipEdges() {
        return (this.model.references || []).map((reference) => ({
            kind: reference.fromKind,
            from: reference.from,
            to: reference.to,
            name: reference.name,
            line: reference.line
        }));
    }

    referencesFor(fullName) {
        const shortName = (fullName || '').split('.').pop();
        return (this.model.references || []).filter((reference) => {
            const target = String(reference.to || '').replace(/^\./, '');
            return target === fullName || target === shortName || target.endsWith(`.${shortName}`);
        });
    }

    findMessage(fullName) {
        return this.allMessages().find((message) => message.fullName === fullName);
    }

    exampleForMessage(message, seen) {
        if (!message || seen.has(message.fullName)) {
            return {};
        }
        seen.add(message.fullName);
        const value = {};
        message.fields.forEach((field) => {
            const sample = this.sampleForField(field, seen);
            value[field.name] = field.repeated ? [sample] : sample;
        });
        seen.delete(message.fullName);
        return value;
    }

    sampleForField(field, seen) {
        const type = String(field.type || '').replace(/^\./, '');
        if (field.map) {
            return { key: 'value' };
        }
        const scalars = {
            double: 0,
            float: 0,
            int32: 0,
            int64: '0',
            uint32: 0,
            uint64: '0',
            sint32: 0,
            sint64: '0',
            fixed32: 0,
            fixed64: '0',
            sfixed32: 0,
            sfixed64: '0',
            bool: false,
            string: 'string',
            bytes: 'base64'
        };
        if (Object.prototype.hasOwnProperty.call(scalars, type)) {
            return scalars[type];
        }
        const enumType = this.allTypes().find((item) => item.kind === 'enum' && (item.fullName === type || item.name === type || item.fullName.endsWith(`.${type}`)));
        if (enumType) {
            return enumType.values && enumType.values[0] ? enumType.values[0].name : 'ENUM_VALUE';
        }
        const nested = this.allMessages().find((item) => item.fullName === type || item.name === type || item.fullName.endsWith(`.${type}`));
        return nested ? this.exampleForMessage(nested, seen) : null;
    }

    parseProtoLite(source) {
        const messages = [];
        const stack = [];
        source.replace(/\r\n/g, '\n').split('\n').forEach((rawLine) => {
            const line = rawLine.replace(/\/\/.*$/, '').trim();
            const messageMatch = line.match(/^message\s+([A-Za-z_]\w*)\s*\{/);
            if (messageMatch) {
                const parent = stack[stack.length - 1];
                const fullName = parent ? `${parent.fullName}.${messageMatch[1]}` : messageMatch[1];
                const message = { name: messageMatch[1], fullName, fields: [], messages: [] };
                if (parent) {
                    parent.messages.push(message);
                } else {
                    messages.push(message);
                }
                stack.push(message);
                return;
            }
            if (line.includes('}')) {
                stack.pop();
                return;
            }
            const current = stack[stack.length - 1];
            if (!current) {
                return;
            }
            let candidate = line.replace(/^(optional|required|repeated)\s+/, '');
            const fieldMatch = candidate.match(/^(.+?)\s+([A-Za-z_]\w*)\s*=\s*(\d+)/);
            if (fieldMatch) {
                current.fields.push({ type: fieldMatch[1].trim(), name: fieldMatch[2], number: Number(fieldMatch[3]) });
            }
        });
        return { messages };
    }

    compareModels(previous, current) {
        const findings = [];
        const previousMessages = this.flattenLiteMessages(previous.messages || []);
        const currentMessages = new Map(this.allMessages().map((message) => [message.fullName.split('.').slice(-previousMessages[0]?.fullName.split('.').length || 1).join('.'), message]));
        previousMessages.forEach((oldMessage) => {
            const currentMessage = this.allMessages().find((message) => message.name === oldMessage.name || message.fullName.endsWith(oldMessage.fullName));
            if (!currentMessage) {
                findings.push({ level: 'breaking', message: `Message removed: ${oldMessage.fullName}` });
                return;
            }
            oldMessage.fields.forEach((oldField) => {
                const sameNumber = currentMessage.fields.find((field) => field.number === oldField.number);
                const sameName = currentMessage.fields.find((field) => field.name === oldField.name);
                if (!sameNumber) {
                    findings.push({ level: 'breaking', message: `${currentMessage.fullName}.${oldField.name} field number ${oldField.number} was removed.` });
                } else if (sameNumber.name !== oldField.name) {
                    findings.push({ level: 'breaking', message: `${currentMessage.fullName} field number ${oldField.number} changed from ${oldField.name} to ${sameNumber.name}.` });
                }
                if (sameName && sameName.number !== oldField.number) {
                    findings.push({ level: 'breaking', message: `${currentMessage.fullName}.${oldField.name} changed number ${oldField.number} -> ${sameName.number}.` });
                }
                if (sameName && sameName.type !== oldField.type) {
                    findings.push({ level: 'risk', message: `${currentMessage.fullName}.${oldField.name} changed type ${oldField.type} -> ${sameName.type}.` });
                }
            });
        });
        void currentMessages;
        return findings;
    }

    flattenLiteMessages(messages) {
        return messages.flatMap((message) => [message, ...this.flattenLiteMessages(message.messages || [])]);
    }

    computeLineOffsets(source) {
        const offsets = [0];
        for (let index = 0; index < source.length; index++) {
            if (source[index] === '\n') {
                offsets.push(index + 1);
            }
        }
        return offsets;
    }

    highlightProtoLine(line) {
        const commentIndex = this.findCommentIndex(line);
        const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
        const comment = commentIndex >= 0 ? line.slice(commentIndex) : '';
        const strings = [];
        const codeWithoutStrings = code.replace(/"(?:\\.|[^"\\])*"/g, (value) => {
            const token = `__protostring${'a'.repeat(strings.length + 1)}__`;
            strings.push(`<span class="tok-string">${this.escapeHtml(value)}</span>`);
            return token;
        });
        let highlighted = this.escapeHtml(codeWithoutStrings)
            .replace(/\b(syntax|package|import|option|message|enum|service|rpc|returns|oneof|reserved|extensions|repeated|optional|required|stream|map|public|weak|to|max|true|false)\b/g, '<span class="tok-keyword">$1</span>')
            .replace(/\b(double|float|int32|int64|uint32|uint64|sint32|sint64|fixed32|fixed64|sfixed32|sfixed64|bool|string|bytes)\b/g, '<span class="tok-scalar">$1</span>')
            .replace(/\b([A-Z][A-Za-z0-9_]*)\b/g, '<span class="tok-type">$1</span>')
            .replace(/\b(\d+)\b/g, '<span class="tok-number">$1</span>')
            .replace(/(\[[^\]]+\])/g, '<span class="tok-option">$1</span>');
        strings.forEach((value, index) => {
            highlighted = highlighted.replace(`__protostring${'a'.repeat(index + 1)}__`, value);
        });
        return highlighted + (comment ? `<span class="tok-comment">${this.escapeHtml(comment)}</span>` : '');
    }

    findCommentIndex(line) {
        let inQuote = false;
        for (let index = 0; index < line.length - 1; index++) {
            if (line[index] === '"' && line[index - 1] !== '\\') {
                inQuote = !inQuote;
            }
            if (!inQuote && line[index] === '/' && line[index + 1] === '/') {
                return index;
            }
        }
        return -1;
    }

    async copyText(text) {
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
        }
    }

    escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

new ProtoWorkbench();
