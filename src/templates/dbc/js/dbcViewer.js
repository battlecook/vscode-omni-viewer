class DbcWorkbench {
    constructor() {
        this.source = window.dbcSource || '';
        this.model = window.dbcModel || { nodes: [], messages: [], warnings: [], stats: {} };
        this.selectedMessage = this.model.messages[0] || null;
        this.selectedSignal = null;
        this.activeTab = 'signals';
        this.elements = {
            statusBadge: document.getElementById('statusBadge'),
            messageCount: document.getElementById('messageCount'),
            signalCount: document.getElementById('signalCount'),
            nodeCount: document.getElementById('nodeCount'),
            maxDlc: document.getElementById('maxDlc'),
            versionText: document.getElementById('versionText'),
            searchInput: document.getElementById('searchInput'),
            nodeFilter: document.getElementById('nodeFilter'),
            copyMessageBtn: document.getElementById('copyMessageBtn'),
            copySourceBtn: document.getElementById('copySourceBtn'),
            messageList: document.getElementById('messageList'),
            messageCaption: document.getElementById('messageCaption'),
            detailTitle: document.getElementById('detailTitle'),
            detailSubtitle: document.getElementById('detailSubtitle'),
            messageMeta: document.getElementById('messageMeta'),
            commentBox: document.getElementById('commentBox'),
            signalTableBody: document.getElementById('signalTableBody'),
            signalDetail: document.getElementById('signalDetail'),
            sourceView: document.getElementById('sourceView'),
            nodesView: document.getElementById('nodesView'),
            signalsTab: document.getElementById('signalsTab'),
            warningPanel: document.getElementById('warningPanel')
        };
        this.init();
    }

    init() {
        this.elements.sourceView.value = this.source;
        this.renderSummary();
        this.renderNodeFilter();
        this.renderNodes();
        this.renderWarnings();
        this.bindEvents();
        this.renderMessages();
        this.selectMessage(this.selectedMessage);
        this.setStatus(this.model.warnings.length > 0 ? `${this.model.warnings.length} warning(s)` : 'DBC ready', this.model.warnings.length > 0);
    }

    bindEvents() {
        this.elements.searchInput.addEventListener('input', () => this.renderMessages());
        this.elements.nodeFilter.addEventListener('change', () => this.renderMessages());
        this.elements.copyMessageBtn.addEventListener('click', async () => {
            if (!this.selectedMessage) {
                return;
            }
            await this.copyText(JSON.stringify(this.selectedMessage, null, 2));
            this.setStatus('Message JSON copied');
        });
        this.elements.copySourceBtn.addEventListener('click', async () => {
            await this.copyText(this.source);
            this.setStatus('Source copied');
        });

        document.querySelectorAll('[data-tab]').forEach((button) => {
            button.addEventListener('click', () => this.setActiveTab(button.dataset.tab));
        });
    }

    renderSummary() {
        const stats = this.model.stats || {};
        this.elements.messageCount.textContent = String(stats.messageCount || 0);
        this.elements.signalCount.textContent = String(stats.signalCount || 0);
        this.elements.nodeCount.textContent = String(stats.nodeCount || 0);
        this.elements.maxDlc.textContent = String(stats.maxDlc || 0);
        this.elements.versionText.textContent = this.model.version || '-';
    }

    renderNodeFilter() {
        (this.model.nodes || []).forEach((node) => {
            const option = document.createElement('option');
            option.value = node;
            option.textContent = node;
            this.elements.nodeFilter.appendChild(option);
        });
    }

    renderMessages() {
        const query = this.elements.searchInput.value.trim().toLowerCase();
        const node = this.elements.nodeFilter.value;
        const visibleMessages = (this.model.messages || []).filter((message) => this.matchesMessage(message, query, node));

        this.elements.messageList.innerHTML = '';
        this.elements.messageCaption.textContent = `${visibleMessages.length} visible`;

        if (visibleMessages.length === 0) {
            this.elements.messageList.innerHTML = '<div class="empty-state">No messages match the current filter.</div>';
            return;
        }

        visibleMessages.forEach((message) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `message-row${this.selectedMessage && this.selectedMessage.id === message.id ? ' is-selected' : ''}`;
            row.dataset.messageId = String(message.id);
            row.innerHTML = [
                `<span class="message-name">${this.escapeHtml(message.name)}</span>`,
                `<span class="message-id">${this.escapeHtml(message.idHex)}</span>`,
                `<span class="message-extra">DLC ${message.dlc} | ${message.signals.length} signal(s) | ${this.escapeHtml(message.transmitter)}</span>`
            ].join('');
            row.addEventListener('click', () => this.selectMessage(message));
            this.elements.messageList.appendChild(row);
        });
    }

    matchesMessage(message, query, node) {
        if (node) {
            const nodeMatches = message.transmitter === node || message.signals.some(signal => signal.receivers.includes(node));
            if (!nodeMatches) {
                return false;
            }
        }

        if (!query) {
            return true;
        }

        const haystack = [
            message.name,
            String(message.id),
            message.idHex,
            message.transmitter,
            message.comment || '',
            ...message.signals.flatMap(signal => [
                signal.name,
                signal.unit,
                signal.comment || '',
                ...signal.receivers
            ])
        ].join(' ').toLowerCase();
        return haystack.includes(query);
    }

    selectMessage(message) {
        this.selectedMessage = message;
        this.selectedSignal = message?.signals[0] || null;
        this.renderMessages();
        this.renderDetail();
    }

    renderDetail() {
        if (!this.selectedMessage) {
            this.elements.detailTitle.textContent = 'No message selected';
            this.elements.detailSubtitle.textContent = 'Select a message to inspect signals';
            this.elements.messageMeta.innerHTML = '';
            this.elements.signalTableBody.innerHTML = '';
            return;
        }

        const message = this.selectedMessage;
        this.elements.detailTitle.textContent = message.name;
        this.elements.detailSubtitle.textContent = `Frame ${message.id} (${message.idHex}) at line ${message.line}`;
        this.elements.messageMeta.innerHTML = [
            `<span class="meta-pill">DLC ${message.dlc}</span>`,
            `<span class="meta-pill">${this.escapeHtml(message.transmitter)}</span>`,
            `<span class="meta-pill">${message.signals.length} signal(s)</span>`
        ].join('');

        this.elements.commentBox.classList.toggle('is-hidden', !message.comment);
        this.elements.commentBox.textContent = message.comment || '';
        this.renderSignals();
        this.renderSignalDetail();
    }

    renderSignals() {
        const message = this.selectedMessage;
        this.elements.signalTableBody.innerHTML = '';

        if (!message || message.signals.length === 0) {
            this.elements.signalTableBody.innerHTML = '<tr><td colspan="10">No signals defined for this message.</td></tr>';
            return;
        }

        message.signals.forEach((signal) => {
            const row = document.createElement('tr');
            row.className = this.selectedSignal && this.selectedSignal.name === signal.name ? 'is-selected' : '';
            row.innerHTML = [
                `<td>${this.escapeHtml(signal.name)}${signal.multiplexer ? ` <span class="value-chip">${this.escapeHtml(signal.multiplexer)}</span>` : ''}</td>`,
                `<td>${signal.startBit}</td>`,
                `<td>${signal.length}</td>`,
                `<td>${signal.byteOrder === 'little_endian' ? 'Intel' : 'Motorola'}</td>`,
                `<td>${signal.valueType}</td>`,
                `<td>${signal.factor}</td>`,
                `<td>${signal.offset}</td>`,
                `<td>${signal.minimum}..${signal.maximum}</td>`,
                `<td>${this.escapeHtml(signal.unit || '-')}</td>`,
                `<td>${this.escapeHtml(signal.receivers.join(', ') || '-')}</td>`
            ].join('');
            row.addEventListener('click', () => {
                this.selectedSignal = signal;
                this.renderSignals();
                this.renderSignalDetail();
            });
            this.elements.signalTableBody.appendChild(row);
        });
    }

    renderSignalDetail() {
        const signal = this.selectedSignal;
        this.elements.signalDetail.classList.toggle('is-hidden', !signal);
        if (!signal) {
            return;
        }

        const values = signal.values.length > 0
            ? `<div><strong>Values</strong><div>${signal.values.map(value => `<span class="value-chip">${value.value}: ${this.escapeHtml(value.label)}</span>`).join('')}</div></div>`
            : '';
        const comment = signal.comment ? `<div><strong>Comment</strong><div>${this.escapeHtml(signal.comment)}</div></div>` : '';

        this.elements.signalDetail.innerHTML = [
            `<div><strong>${this.escapeHtml(signal.name)}</strong> | raw bits ${signal.startBit}-${signal.startBit + signal.length - 1} | physical = raw * ${signal.factor} + ${signal.offset}</div>`,
            values,
            comment
        ].filter(Boolean).join('');
    }

    renderNodes() {
        if (!this.model.nodes || this.model.nodes.length === 0) {
            this.elements.nodesView.innerHTML = '<div class="empty-state">No nodes declared.</div>';
            return;
        }

        this.elements.nodesView.innerHTML = this.model.nodes
            .map((node) => `<span class="node-chip">${this.escapeHtml(node)}</span>`)
            .join('');
    }

    renderWarnings() {
        const warnings = this.model.warnings || [];
        if (warnings.length === 0) {
            return;
        }

        this.elements.warningPanel.classList.remove('is-hidden');
        this.elements.warningPanel.innerHTML = warnings.map((warning) => `<div>${this.escapeHtml(warning)}</div>`).join('');
    }

    setActiveTab(tab) {
        this.activeTab = tab;
        document.querySelectorAll('[data-tab]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.tab === tab);
        });
        this.elements.signalsTab.classList.toggle('is-hidden', tab !== 'signals');
        this.elements.sourceView.classList.toggle('is-hidden', tab !== 'raw');
        this.elements.nodesView.classList.toggle('is-hidden', tab !== 'nodes');
    }

    async copyText(text) {
        if (navigator.clipboard?.writeText) {
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
            .replace(/'/g, '&#39;');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new DbcWorkbench();
});
