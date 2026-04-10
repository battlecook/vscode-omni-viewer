(function () {
    const vscode = acquireVsCodeApi();
    const archiveData = window.archiveData || {};
    const entries = Array.isArray(archiveData.entries) ? archiveData.entries : [];

    const formatPill = document.getElementById('formatPill');
    const entryPill = document.getElementById('entryPill');
    const sizePill = document.getElementById('sizePill');
    const archiveSummary = document.getElementById('archiveSummary');
    const statsGrid = document.getElementById('statsGrid');
    const searchInput = document.getElementById('searchInput');
    const entryTableBody = document.getElementById('entryTableBody');
    const emptyState = document.getElementById('emptyState');
    const noteBox = document.getElementById('noteBox');
    const previewTitle = document.getElementById('previewTitle');
    const previewStatus = document.getElementById('previewStatus');
    const previewMeta = document.getElementById('previewMeta');
    const previewContent = document.getElementById('previewContent');
    let filteredEntries = entries.slice();
    let selectedPath = null;

    function formatNumber(value) {
        return new Intl.NumberFormat('en-US').format(value || 0);
    }

    function formatSize(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
            return '-';
        }

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = Number(value);
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }

        const precision = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
        return `${size.toFixed(precision)} ${units[unitIndex]}`;
    }

    function formatDate(value) {
        if (!value) {
            return '-';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '-';
        }

        return new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    function renderStats() {
        const items = [
            { label: 'Entries', value: formatNumber(archiveData.entryCount) },
            { label: 'Files', value: formatNumber(archiveData.fileCount) },
            { label: 'Directories', value: formatNumber(archiveData.directoryCount) },
            { label: 'Visible', value: archiveData.truncated ? `${formatNumber(entries.length)} / ${formatNumber(archiveData.entryCount)}` : formatNumber(entries.length) }
        ];

        statsGrid.innerHTML = items.map((item) => `
            <article class="stat-card">
                <div class="stat-label">${item.label}</div>
                <div class="stat-value">${item.value}</div>
            </article>
        `).join('');
    }

    function setPreviewState(title, status, meta, content) {
        previewTitle.textContent = title;
        previewStatus.textContent = status;
        previewMeta.textContent = meta;
        previewContent.textContent = content;
    }

    function getEntryByPath(entryPath) {
        return entries.find((entry) => entry.path === entryPath) || null;
    }

    function renderRows(nextFilteredEntries) {
        filteredEntries = nextFilteredEntries;

        if (!filteredEntries.length) {
            entryTableBody.innerHTML = '';
            emptyState.hidden = false;
            if (selectedPath && !getEntryByPath(selectedPath)) {
                selectedPath = null;
            }
            return;
        }

        emptyState.hidden = true;
        entryTableBody.innerHTML = filteredEntries.map((entry) => `
            <tr class="entry-row${selectedPath === entry.path ? ' is-selected' : ''}" data-entry-path="${escapeHtml(entry.path)}" tabindex="0">
                <td class="entry-path">${escapeHtml(entry.path)}</td>
                <td><span class="kind-badge">${entry.kind === 'directory' ? 'DIR' : 'FILE'}</span></td>
                <td>${formatSize(entry.compressedSize)}</td>
                <td>${formatSize(entry.uncompressedSize)}</td>
                <td>${escapeHtml(formatDate(entry.modifiedAt))}</td>
            </tr>
        `).join('');
    }

    function applyFilter() {
        const query = (searchInput.value || '').trim().toLowerCase();
        if (!query) {
            renderRows(entries);
            return;
        }

        renderRows(entries.filter((entry) => entry.path.toLowerCase().includes(query)));
    }

    function requestPreview(entryPath) {
        const entry = getEntryByPath(entryPath);
        if (!entry) {
            return;
        }

        selectedPath = entry.path;
        renderRows(filteredEntries);
        previewTitle.textContent = entry.path;

        if (entry.kind === 'directory') {
            setPreviewState(entry.path, 'Directory', 'Directory entries do not have inline file content.', 'This entry contains child items rather than file text.');
            return;
        }

        setPreviewState(entry.path, 'Loading', 'Fetching file content from the archive for a quick preview.', 'Loading preview...');
        vscode.postMessage({
            type: 'requestEntryPreview',
            path: entry.path
        });
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function bindEvents() {
        searchInput.addEventListener('input', applyFilter);
        entryTableBody.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const row = target ? target.closest('.entry-row') : null;
            if (!row) {
                return;
            }

            requestPreview(row.dataset.entryPath);
        });

        entryTableBody.addEventListener('keydown', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const row = target ? target.closest('.entry-row') : null;
            if (!row || (event.key !== 'Enter' && event.key !== ' ')) {
                return;
            }

            event.preventDefault();
            requestPreview(row.dataset.entryPath);
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (!message || message.type !== 'entryPreview' || message.path !== selectedPath) {
                return;
            }

            if (message.status === 'success') {
                const meta = message.truncated
                    ? 'Showing the beginning of the file because preview length is capped.'
                    : 'Rendered as plain text from the selected archive entry.';
                setPreviewState(message.path, 'Ready', meta, message.content || '');
                return;
            }

            if (message.status === 'unsupported') {
                setPreviewState(message.path, 'Unsupported', message.message || 'Preview is not available for this file.', 'Inline preview is currently limited to text-like entries.');
                return;
            }

            setPreviewState(message.path, 'Error', message.message || 'Preview could not be loaded.', 'The selected entry could not be rendered.');
        });
    }

    formatPill.textContent = archiveData.format || 'Archive';
    entryPill.textContent = `${formatNumber(archiveData.entryCount)} entries`;
    sizePill.textContent = archiveData.fileSize || '-';
    archiveSummary.textContent = archiveData.truncated
        ? `Showing the first ${formatNumber(entries.length)} entries because this archive contains a large number of items.`
        : 'Browsing the archive structure in read-only preview mode.';

    if (archiveData.note) {
        noteBox.hidden = false;
        noteBox.textContent = archiveData.note;
    }

    renderStats();
    renderRows(entries);
    bindEvents();
})();
