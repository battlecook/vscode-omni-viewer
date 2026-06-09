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
            this.query = this.elements.searchInput.value.trim().toLowerCase();
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

        const rows = this.filterRows(table.rows || []);
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

    filterRows(rows) {
        if (!this.query) {
            return rows;
        }
        return rows.filter(row => row.some(cell => String(cell ?? '').toLowerCase().includes(this.query)));
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
