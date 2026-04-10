class JsonWorkbench {
    constructor() {
        this.currentViewMode = 'text';
        this.elements = {
            editor: document.getElementById('jsonEditor'),
            highlightedView: document.getElementById('highlightedView'),
            treeView: document.getElementById('treeView'),
            statusBadge: document.getElementById('statusBadge'),
            previewCaption: document.getElementById('previewCaption'),
            resultPanel: document.getElementById('resultPanel'),
            resultTitle: document.getElementById('resultTitle'),
            resultOutput: document.getElementById('resultOutput'),
            copyResultBtn: document.getElementById('copyResultBtn'),
            replaceEditorBtn: document.getElementById('replaceEditorBtn'),
            closeResultBtn: document.getElementById('closeResultBtn')
        };
        this.init();
    }

    init() {
        this.elements.editor.value = window.formattedJson || '';
        this.bindEvents();
        this.renderPreview();
    }

    bindEvents() {
        this.elements.editor.addEventListener('input', () => {
            this.renderPreview();
        });

        document.querySelectorAll('[data-view-mode]').forEach((button) => {
            button.addEventListener('click', () => {
                this.currentViewMode = button.dataset.viewMode;
                document.querySelectorAll('[data-view-mode]').forEach((item) => {
                    item.classList.toggle('is-active', item === button);
                });
                this.renderPreview();
            });
        });

        document.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => {
                this.handleAction(button.dataset.action);
            });
        });

        this.elements.copyResultBtn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(this.elements.resultOutput.value);
            this.setStatus('Result copied to clipboard', 'valid');
        });

        this.elements.replaceEditorBtn.addEventListener('click', () => {
            this.elements.editor.value = this.elements.resultOutput.value;
            this.hideResult();
            this.renderPreview();
            this.setStatus('Editor replaced with result', 'valid');
        });

        this.elements.closeResultBtn.addEventListener('click', () => {
            this.hideResult();
        });
    }

    handleAction(action) {
        let resultMessage = null;
        const actionHandlers = {
            'pretty': () => this.replaceEditorText(JSON.stringify(this.parseCurrentJson(), null, 2), 'Pretty formatting applied'),
            'minify': () => this.replaceEditorText(JSON.stringify(this.parseCurrentJson()), 'Minified JSON applied'),
            'sort-keys': () => this.replaceEditorText(JSON.stringify(this.sortKeysDeep(this.parseCurrentJson()), null, 2), 'Sorted keys applied'),
            'validate': () => {
                const parsed = this.parseCurrentJson();
                const summary = Array.isArray(parsed) ? `Array(${parsed.length})` : typeof parsed;
                resultMessage = `Valid JSON: ${summary}`;
            },
            'json-to-csv': () => this.showResult('CSV Output', this.convertJsonToCsv(this.parseCurrentJson())),
            'json-to-xml': () => this.showResult('XML Output', this.convertJsonToXml(this.parseCurrentJson())),
            'json-to-yaml': () => this.showResult('YAML Output', this.convertJsonToYaml(this.parseCurrentJson())),
            'escape': () => this.replaceEditorText(this.escapeText(this.elements.editor.value), 'Escaped text applied'),
            'unescape': () => this.replaceEditorText(this.unescapeText(this.elements.editor.value), 'Unescaped text applied'),
            'base64-encode': () => this.replaceEditorText(this.base64Encode(this.elements.editor.value), 'Base64 encoded text applied'),
            'base64-decode': () => this.replaceEditorText(this.base64Decode(this.elements.editor.value), 'Base64 decoded text applied')
        };

        const handler = actionHandlers[action];
        if (!handler) {
            return;
        }

        try {
            handler();
            this.renderPreview(action === 'validate');
            if (resultMessage) {
                this.setStatus(resultMessage, 'valid');
            }
        } catch (error) {
            this.setStatus(error instanceof Error ? error.message : 'Action failed', 'invalid');
        }
    }

    replaceEditorText(nextText, successMessage) {
        this.elements.editor.value = nextText;
        this.setStatus(successMessage, 'valid');
    }

    parseCurrentJson() {
        try {
            return JSON.parse(this.elements.editor.value);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid JSON';
            throw new Error(`Invalid JSON: ${message}`);
        }
    }

    renderPreview(forceStatusUpdate = true) {
        const text = this.elements.editor.value;

        if (this.currentViewMode === 'tree') {
            this.elements.highlightedView.classList.add('is-hidden');
            this.elements.treeView.classList.remove('is-hidden');
            this.elements.previewCaption.textContent = 'Tree view';

            try {
                const parsed = JSON.parse(text);
                this.renderTree(parsed);
                if (forceStatusUpdate) {
                    this.setStatus('Tree rendered from valid JSON', 'valid');
                }
            } catch (error) {
                this.elements.treeView.innerHTML = `<div class="json-error">${this.escapeHtml(text)}</div>`;
                if (forceStatusUpdate) {
                    this.setStatus(error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON', 'invalid');
                }
            }
            return;
        }

        this.elements.highlightedView.classList.remove('is-hidden');
        this.elements.treeView.classList.add('is-hidden');
        this.elements.previewCaption.textContent = 'Syntax highlighted JSON';
        this.renderHighlightedText(text);

        try {
            JSON.parse(text);
            if (forceStatusUpdate) {
                this.setStatus('Valid JSON', 'valid');
            }
        } catch (error) {
            if (forceStatusUpdate) {
                this.setStatus(error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON', 'invalid');
            }
        }
    }

    renderHighlightedText(text) {
        try {
            const parsed = JSON.parse(text);
            const formatted = JSON.stringify(parsed, null, 2);
            this.elements.highlightedView.innerHTML = this.syntaxHighlight(formatted);
        } catch (error) {
            this.elements.highlightedView.innerHTML = `<span class="json-error">${this.escapeHtml(text)}</span>`;
        }
    }

    renderTree(value) {
        this.elements.treeView.innerHTML = '';
        this.elements.treeView.appendChild(this.createTreeNode('root', value, true));
    }

    createTreeNode(key, value, expanded) {
        const wrapper = document.createElement('div');
        wrapper.className = `tree-node${key === 'root' ? ' root' : ''}`;

        const row = document.createElement('div');
        row.className = 'tree-row';

        const type = this.getValueType(value);
        const hasChildren = type === 'object' || type === 'array';

        if (hasChildren) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'tree-toggle';
            toggle.textContent = expanded ? '▾' : '▸';
            row.appendChild(toggle);

            const children = document.createElement('div');
            children.className = 'tree-children';
            children.style.display = expanded ? 'block' : 'none';

            toggle.addEventListener('click', () => {
                const isOpen = children.style.display !== 'none';
                children.style.display = isOpen ? 'none' : 'block';
                toggle.textContent = isOpen ? '▸' : '▾';
            });

            row.appendChild(this.createTreeLabel(key, value, type));
            wrapper.appendChild(row);

            const entries = type === 'array'
                ? value.map((item, index) => [String(index), item])
                : Object.entries(value);

            entries.forEach(([childKey, childValue]) => {
                children.appendChild(this.createTreeNode(childKey, childValue, false));
            });

            wrapper.appendChild(children);
            return wrapper;
        }

        const spacer = document.createElement('span');
        spacer.className = 'tree-spacer';
        row.appendChild(spacer);
        row.appendChild(this.createTreeLabel(key, value, type));
        wrapper.appendChild(row);
        return wrapper;
    }

    createTreeLabel(key, value, type) {
        const label = document.createElement('div');
        const keyMarkup = key === 'root' ? '<span class="tree-key">root</span>' : `<span class="tree-key">"${this.escapeHtml(key)}"</span>: `;

        if (type === 'object') {
            label.innerHTML = `${keyMarkup}<span class="tree-value object">{</span> <span class="tree-meta">${Object.keys(value).length} keys</span> <span class="tree-value object">}</span>`;
            return label;
        }

        if (type === 'array') {
            label.innerHTML = `${keyMarkup}<span class="tree-value array">[</span> <span class="tree-meta">${value.length} items</span> <span class="tree-value array">]</span>`;
            return label;
        }

        label.innerHTML = `${keyMarkup}<span class="tree-value ${type}">${this.formatPrimitive(value, type)}</span>`;
        return label;
    }

    formatPrimitive(value, type) {
        if (type === 'string') {
            return `"${this.escapeHtml(value)}"`;
        }
        if (type === 'null') {
            return 'null';
        }
        return this.escapeHtml(String(value));
    }

    getValueType(value) {
        if (value === null) {
            return 'null';
        }
        if (Array.isArray(value)) {
            return 'array';
        }
        return typeof value;
    }

    showResult(title, output) {
        this.elements.resultTitle.textContent = title;
        this.elements.resultOutput.value = output;
        this.elements.resultPanel.classList.remove('is-hidden');
        this.setStatus(`${title} generated`, 'valid');
    }

    hideResult() {
        this.elements.resultPanel.classList.add('is-hidden');
    }

    setStatus(message, state) {
        this.elements.statusBadge.textContent = message;
        this.elements.statusBadge.classList.toggle('is-valid', state === 'valid');
        this.elements.statusBadge.classList.toggle('is-invalid', state === 'invalid');
    }

    syntaxHighlight(jsonText) {
        const tokenRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?|[{}[\],:])/g;
        let lastIndex = 0;
        let html = '';

        jsonText.replace(tokenRegex, (match, _group, _escaped, _suffix, offset) => {
            html += this.escapeHtml(jsonText.slice(lastIndex, offset));

            let className = 'json-number';
            if (match.startsWith('"')) {
                className = match.endsWith(':') ? 'json-key' : 'json-string';
            } else if (match === 'true' || match === 'false') {
                className = 'json-boolean';
            } else if (match === 'null') {
                className = 'json-null';
            } else if (/^[{}[\],:]$/.test(match)) {
                className = 'json-punctuation';
            }

            html += `<span class="${className}">${this.escapeHtml(match)}</span>`;
            lastIndex = offset + match.length;
            return match;
        });

        html += this.escapeHtml(jsonText.slice(lastIndex));
        return html;
    }

    sortKeysDeep(value) {
        if (Array.isArray(value)) {
            return value.map((item) => this.sortKeysDeep(item));
        }

        if (value && typeof value === 'object') {
            return Object.keys(value)
                .sort((a, b) => a.localeCompare(b))
                .reduce((acc, key) => {
                    acc[key] = this.sortKeysDeep(value[key]);
                    return acc;
                }, {});
        }

        return value;
    }

    convertJsonToCsv(value) {
        const rows = Array.isArray(value) ? value : [value];
        if (!rows.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
            throw new Error('CSV conversion requires a JSON object or an array of objects');
        }

        const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
        const lines = [
            headers.join(','),
            ...rows.map((row) => headers.map((header) => this.escapeCsvValue(row[header])).join(','))
        ];
        return lines.join('\n');
    }

    escapeCsvValue(value) {
        if (value === null || value === undefined) {
            return '';
        }

        const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (/[",\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }

    convertJsonToXml(value) {
        const xmlBody = this.toXmlNode('root', value, 0);
        return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBody}`;
    }

    toXmlNode(key, value, depth) {
        const indent = '  '.repeat(depth);
        const safeKey = this.sanitizeXmlTag(key);

        if (Array.isArray(value)) {
            return `${indent}<${safeKey}>\n${value.map((item) => this.toXmlNode('item', item, depth + 1)).join('\n')}\n${indent}</${safeKey}>`;
        }

        if (value && typeof value === 'object') {
            const children = Object.entries(value).map(([childKey, childValue]) => this.toXmlNode(childKey, childValue, depth + 1)).join('\n');
            return `${indent}<${safeKey}>\n${children}\n${indent}</${safeKey}>`;
        }

        return `${indent}<${safeKey}>${this.escapeXml(String(value ?? ''))}</${safeKey}>`;
    }

    sanitizeXmlTag(tag) {
        const normalized = String(tag).replace(/[^a-zA-Z0-9_.-]/g, '_');
        return /^[A-Za-z_]/.test(normalized) ? normalized : `node_${normalized}`;
    }

    escapeXml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    convertJsonToYaml(value, depth = 0) {
        const indent = '  '.repeat(depth);

        if (Array.isArray(value)) {
            if (value.length === 0) {
                return `${indent}[]`;
            }

            return value.map((item) => {
                if (item && typeof item === 'object') {
                    return `${indent}- ${this.convertJsonToYaml(item, depth + 1).trimStart()}`;
                }
                return `${indent}- ${this.yamlScalar(item)}`;
            }).join('\n');
        }

        if (value && typeof value === 'object') {
            const entries = Object.entries(value);
            if (entries.length === 0) {
                return `${indent}{}`;
            }

            return entries.map(([key, item]) => {
                if (item && typeof item === 'object') {
                    return `${indent}${key}:\n${this.convertJsonToYaml(item, depth + 1)}`;
                }
                return `${indent}${key}: ${this.yamlScalar(item)}`;
            }).join('\n');
        }

        return `${indent}${this.yamlScalar(value)}`;
    }

    yamlScalar(value) {
        if (value === null) {
            return 'null';
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        const text = String(value);
        if (text === '' || /[:{}\[\],&*#?|\-<>=!%@`]/.test(text) || /^\s|\s$/.test(text) || text.includes('\n')) {
            return JSON.stringify(text);
        }
        return text;
    }

    escapeText(text) {
        return JSON.stringify(text).slice(1, -1);
    }

    unescapeText(text) {
        const trimmed = text.trim();
        try {
            if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
                return JSON.parse(trimmed.replace(/^'/, '"').replace(/'$/, '"'));
            }
            let result = '';
            for (let index = 0; index < text.length; index += 1) {
                const char = text[index];

                if (char !== '\\') {
                    result += char;
                    continue;
                }

                const nextChar = text[index + 1];
                if (!nextChar) {
                    throw new Error('Trailing escape character');
                }

                if (nextChar === 'n') {
                    result += '\n';
                } else if (nextChar === 'r') {
                    result += '\r';
                } else if (nextChar === 't') {
                    result += '\t';
                } else if (nextChar === 'b') {
                    result += '\b';
                } else if (nextChar === 'f') {
                    result += '\f';
                } else if (nextChar === '\\') {
                    result += '\\';
                } else if (nextChar === '"') {
                    result += '"';
                } else if (nextChar === '\'') {
                    result += '\'';
                } else if (nextChar === 'u') {
                    const unicodeHex = text.slice(index + 2, index + 6);
                    if (!/^[0-9a-fA-F]{4}$/.test(unicodeHex)) {
                        throw new Error('Invalid unicode escape');
                    }
                    result += String.fromCharCode(parseInt(unicodeHex, 16));
                    index += 4;
                } else if (nextChar === 'x') {
                    const hex = text.slice(index + 2, index + 4);
                    if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
                        throw new Error('Invalid hex escape');
                    }
                    result += String.fromCharCode(parseInt(hex, 16));
                    index += 2;
                } else {
                    result += nextChar;
                }

                index += 1;
            }

            return result;
        } catch (error) {
            throw new Error('Text could not be unescaped');
        }
    }

    base64Encode(text) {
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    }

    base64Decode(text) {
        try {
            const binary = atob(text.trim());
            const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
            return new TextDecoder().decode(bytes);
        } catch (error) {
            throw new Error('Text is not valid Base64');
        }
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

new JsonWorkbench();
