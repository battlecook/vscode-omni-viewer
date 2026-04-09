(function () {
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

    function renderRows(filteredEntries) {
        if (!filteredEntries.length) {
            entryTableBody.innerHTML = '';
            emptyState.hidden = false;
            return;
        }

        emptyState.hidden = true;
        entryTableBody.innerHTML = filteredEntries.map((entry) => `
            <tr>
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

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
    searchInput.addEventListener('input', applyFilter);
})();
