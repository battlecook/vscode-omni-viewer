class AutomotiveViewer {
    constructor() {
        this.model = this.readModel();
        this.activeTab = 'table-0';
        this.query = '';
        this.elements = {
            formatLabel: document.getElementById('formatLabel'),
            subtitle: document.getElementById('subtitle'),
            summaryGrid: document.getElementById('summaryGrid'),
            tabs: document.getElementById('tabs'),
            searchInput: document.getElementById('searchInput'),
            copyBtn: document.getElementById('copyBtn'),
            warningPanel: document.getElementById('warningPanel'),
            tablePanel: document.getElementById('tablePanel'),
            rawPanel: document.getElementById('rawPanel'),
            rawPreview: document.getElementById('rawPreview')
        };
        this.init();
    }

    readModel() {
        const script = document.getElementById('viewer-data');
        return script ? JSON.parse(script.textContent || '{}') : {};
    }

    init() {
        this.elements.formatLabel.textContent = this.model.format || 'Automotive';
        this.elements.subtitle.textContent = `${this.model.title || ''} · ${this.model.fileSize || ''}`;
        this.renderSummary();
        this.renderWarnings();
        this.renderTabs();
        this.renderActiveView();
        this.bindEvents();
    }

    bindEvents() {
        this.elements.searchInput.addEventListener('input', () => {
            this.query = this.elements.searchInput.value.trim();
            this.renderActiveView();
        });
        this.elements.copyBtn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(JSON.stringify(this.model, null, 2));
            this.elements.copyBtn.textContent = 'Copied';
            window.setTimeout(() => {
                this.elements.copyBtn.textContent = 'Copy JSON';
            }, 1200);
        });
    }

    renderSummary() {
        this.elements.summaryGrid.innerHTML = '';
        (this.model.summary || []).forEach((item) => {
            const card = document.createElement('div');
            card.className = 'summary-item';
            card.innerHTML = `<div class="summary-value">${this.escapeHtml(String(item.value))}</div><div class="summary-label">${this.escapeHtml(item.label)}</div>`;
            this.elements.summaryGrid.appendChild(card);
        });
    }

    renderWarnings() {
        const warnings = this.model.warnings || [];
        if (warnings.length === 0) {
            this.elements.warningPanel.classList.add('is-hidden');
            return;
        }
        this.elements.warningPanel.classList.remove('is-hidden');
        this.elements.warningPanel.innerHTML = warnings.map(warning => `<div>${this.escapeHtml(warning)}</div>`).join('');
    }

    renderTabs() {
        this.elements.tabs.innerHTML = '';
        (this.model.tables || []).forEach((table, index) => {
            this.elements.tabs.appendChild(this.createTab(`table-${index}`, table.title));
        });
        if (this.model.rawPreview) {
            this.elements.tabs.appendChild(this.createTab('raw', 'Raw Preview'));
        }
    }

    createTab(id, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = id === this.activeTab ? 'is-active' : '';
        button.textContent = label;
        button.addEventListener('click', () => {
            this.activeTab = id;
            this.renderTabs();
            this.renderActiveView();
        });
        return button;
    }

    renderActiveView() {
        if (this.activeTab === 'raw') {
            this.elements.tablePanel.classList.add('is-hidden');
            this.elements.rawPanel.classList.remove('is-hidden');
            this.elements.rawPreview.textContent = this.model.rawPreview || '';
            return;
        }

        this.elements.rawPanel.classList.add('is-hidden');
        this.elements.tablePanel.classList.remove('is-hidden');

        const tableIndex = Number(this.activeTab.replace('table-', '')) || 0;
        const table = (this.model.tables || [])[tableIndex];
        if (!table) {
            this.elements.tablePanel.innerHTML = '<div class="empty-state">No data available.</div>';
            return;
        }

        const rows = this.filterRows(table.rows || [], table);
        const visibleRows = rows.slice(0, 1000);
        const caption = rows.length > visibleRows.length
            ? `${visibleRows.length} / ${rows.length} matching rows shown`
            : `${rows.length} matching rows`;

        this.elements.tablePanel.innerHTML = [
            `<div class="panel-header"><h2>${this.escapeHtml(table.title)}</h2><span>${caption}</span></div>`,
            '<div class="table-wrap">',
            '<table>',
            `<thead><tr>${(table.headers || []).map(header => `<th>${this.escapeHtml(header)}</th>`).join('')}</tr></thead>`,
            `<tbody>${visibleRows.map(row => this.renderRow(row)).join('')}</tbody>`,
            '</table>',
            '</div>'
        ].join('');
    }

    filterRows(rows, table) {
        if (!this.query) {
            return rows;
        }
        const packetFilter = this.parsePacketFilter(this.query, table);
        if (packetFilter) {
            return rows.filter(row => this.matchesPacketFilter(row, table, packetFilter));
        }

        const query = this.query.toLowerCase();
        return rows.filter(row => row.some(cell => String(cell ?? '').toLowerCase().includes(query)));
    }

    parsePacketFilter(query, table) {
        const headers = table.headers || [];
        const isPacketTable = headers.includes('Protocol') && headers.includes('Source') && headers.includes('Destination') && headers.includes('Info');
        if (!isPacketTable) {
            return null;
        }

        const match = /^([a-z0-9_.-]+)\s*(==|!=|~=|contains|=)\s*(.+)$/i.exec(query);
        if (!match) {
            return null;
        }

        return {
            field: match[1].toLowerCase(),
            operator: match[2] === '=' ? '==' : match[2].toLowerCase(),
            value: match[3].replace(/^["']|["']$/g, '').toLowerCase()
        };
    }

    matchesPacketFilter(row, table, filter) {
        const rowData = this.packetRowData(row, table);
        const values = this.packetFilterValues(rowData, filter.field);
        if (values.length === 0) {
            return false;
        }

        const matched = values.some(value => {
            const normalized = String(value ?? '').toLowerCase();
            if (filter.operator === 'contains' || filter.operator === '~=') {
                return normalized.includes(filter.value);
            }
            return normalized === filter.value || normalized.includes(filter.value);
        });

        return filter.operator === '!=' ? !matched : matched;
    }

    packetRowData(row, table) {
        const data = {};
        (table.headers || []).forEach((header, index) => {
            data[header.toLowerCase()] = String(row[index] ?? '');
        });

        const sourceParts = this.splitEndpoint(data.source || '');
        const destinationParts = this.splitEndpoint(data.destination || '');
        data.src_ip = sourceParts.host;
        data.src_port = sourceParts.port;
        data.dst_ip = destinationParts.host;
        data.dst_port = destinationParts.port;
        data.ip_values = [sourceParts.host, destinationParts.host].filter(Boolean);
        data.port_values = [sourceParts.port, destinationParts.port].filter(Boolean);
        return data;
    }

    splitEndpoint(value) {
        const match = /^(.+):(\d+)$/.exec(value);
        return match ? { host: match[1], port: match[2] } : { host: value, port: '' };
    }

    packetFilterValues(rowData, field) {
        switch (field) {
            case 'protocol':
            case 'proto':
                return [rowData.protocol];
            case 'ip':
            case 'ip.addr':
                return rowData.ip_values;
            case 'src':
            case 'src.ip':
            case 'ip.src':
                return [rowData.src_ip];
            case 'dst':
            case 'dst.ip':
            case 'ip.dst':
                return [rowData.dst_ip];
            case 'port':
            case 'tcp.port':
            case 'udp.port':
                return rowData.port_values;
            case 'src.port':
            case 'tcp.srcport':
            case 'udp.srcport':
                return [rowData.src_port];
            case 'dst.port':
            case 'tcp.dstport':
            case 'udp.dstport':
                return [rowData.dst_port];
            case 'dns.qry.name':
            case 'http.host':
            case 'info':
                return [rowData.info];
            default:
                return [rowData[field.replace('.', ' ')] || rowData[field] || ''];
        }
    }

    renderRow(row) {
        return `<tr>${row.map(cell => `<td>${this.escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`;
    }

    escapeHtml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

document.addEventListener('DOMContentLoaded', () => new AutomotiveViewer());
