(function() {
    'use strict';

    const wordContent = document.getElementById('wordContent');
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const fileInfo = document.getElementById('fileInfo');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const zoomResetBtn = document.getElementById('zoomReset');
    const zoomLevelSpan = document.getElementById('zoomLevel');
    const printBtn = document.getElementById('printBtn');

    let currentZoom = 100;
    const MIN_ZOOM = 25;
    const MAX_ZOOM = 200;
    const ZOOM_STEP = 10;

    async function init() {
        setupEventListeners();
        await renderWordFile();
    }

    function setupEventListeners() {
        if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
        if (zoomResetBtn) zoomResetBtn.addEventListener('click', zoomReset);
        if (printBtn) printBtn.addEventListener('click', printDocument);
        document.addEventListener('keydown', handleKeyboard);
        document.addEventListener('wheel', handleWheel, { passive: false });
    }

    function zoomIn() {
        if (currentZoom < MAX_ZOOM) {
            currentZoom += ZOOM_STEP;
            applyZoom();
        }
    }

    function zoomOut() {
        if (currentZoom > MIN_ZOOM) {
            currentZoom -= ZOOM_STEP;
            applyZoom();
        }
    }

    function zoomReset() {
        currentZoom = 100;
        applyZoom();
    }

    function applyZoom() {
        if (wordContent) wordContent.style.transform = `scale(${currentZoom / 100})`;
        if (zoomLevelSpan) zoomLevelSpan.textContent = `${currentZoom}%`;
    }

    function handleKeyboard(e) {
        if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
            e.preventDefault();
            zoomIn();
        } else if (e.ctrlKey && e.key === '-') {
            e.preventDefault();
            zoomOut();
        } else if (e.ctrlKey && e.key === '0') {
            e.preventDefault();
            zoomReset();
        } else if (e.ctrlKey && e.key === 'p') {
            e.preventDefault();
            printDocument();
        }
    }

    function handleWheel(e) {
        if (e.ctrlKey) {
            e.preventDefault();
            if (e.deltaY < 0) zoomIn();
            else zoomOut();
        }
    }

    function printDocument() {
        window.print();
    }

    function parseWordConfig() {
        const configNode = document.getElementById('wordConfig');
        if (!configNode || !configNode.textContent) {
            return null;
        }

        try {
            return JSON.parse(configNode.textContent);
        } catch (parseError) {
            console.error('Failed to parse word config:', parseError);
            return null;
        }
    }

    function decodeXmlText(value) {
        return (value || '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
    }

    function escapeHtml(value) {
        return (value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function resolveZipPath(basePath, target) {
        const baseParts = basePath.split('/').slice(0, -1);
        const targetParts = target.split('/');
        const stack = [...baseParts];

        for (const part of targetParts) {
            if (!part || part === '.') continue;
            if (part === '..') {
                if (stack.length > 0) stack.pop();
                continue;
            }
            stack.push(part);
        }

        return stack.join('/');
    }

    function parseChartTitle(chartXml) {
        const titleBlock = chartXml.match(/<c:title[\s\S]*?<\/c:title>/);
        if (!titleBlock) return '';
        const textNodes = [...titleBlock[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];
        return decodeXmlText(textNodes.map((m) => m[1]).join(' ').trim());
    }

    function parseChartSeriesName(seriesXml, index) {
        const txBlock = seriesXml.match(/<c:tx[\s\S]*?<\/c:tx>/);
        if (!txBlock) return `Series ${index + 1}`;
        const nameMatch = txBlock[0].match(/<c:v>([\s\S]*?)<\/c:v>/);
        return decodeXmlText((nameMatch?.[1] || `Series ${index + 1}`).trim());
    }

    function parseChartColor(seriesXml, index) {
        const colorMatch = seriesXml.match(/<a:srgbClr[^>]*val="([0-9A-Fa-f]{6})"/);
        if (colorMatch) {
            return `#${colorMatch[1]}`;
        }
        const palette = ['#004586', '#ff420e', '#ffd320', '#579d1c', '#7e57c2'];
        return palette[index % palette.length];
    }

    function parseIndexedPoints(blockXml, numeric) {
        const points = [];
        const pointMatches = [...blockXml.matchAll(/<c:pt[^>]*idx="(\d+)"[^>]*>[\s\S]*?<c:v>([\s\S]*?)<\/c:v>[\s\S]*?<\/c:pt>/g)];
        for (const match of pointMatches) {
            const idx = Number(match[1]);
            const rawValue = decodeXmlText((match[2] || '').trim());
            points[idx] = numeric ? Number(rawValue) || 0 : rawValue;
        }
        return points.filter((v) => v !== undefined);
    }

    function parseChartData(chartXml) {
        const seriesMatches = [...chartXml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)];
        if (seriesMatches.length === 0) {
            return null;
        }

        const series = seriesMatches.map((match, index) => {
            const seriesXml = match[1];
            const catBlock = seriesXml.match(/<c:cat[\s\S]*?<\/c:cat>/)?.[0] || '';
            const valBlock = seriesXml.match(/<c:val[\s\S]*?<\/c:val>/)?.[0] || '';
            return {
                name: parseChartSeriesName(seriesXml, index),
                color: parseChartColor(seriesXml, index),
                categories: parseIndexedPoints(catBlock, false),
                values: parseIndexedPoints(valBlock, true)
            };
        });

        const categories = series[0].categories;
        const normalizedSeries = series.map((s) => ({
            name: s.name,
            color: s.color,
            values: categories.map((_, i) => Number(s.values[i] || 0))
        }));

        return {
            title: parseChartTitle(chartXml),
            categories,
            series: normalizedSeries
        };
    }

    async function preprocessDocx(arrayBuffer) {
        const result = {
            buffer: arrayBuffer,
            chartPlaceholders: []
        };

        if (!window.JSZip || typeof window.JSZip.loadAsync !== 'function') {
            return result;
        }

        const xmlTargetPattern = /^word\/.*\.xml$/i;
        const altContentPattern = /<mc:AlternateContent[\s\S]*?<mc:Fallback>([\s\S]*?)<\/mc:Fallback>[\s\S]*?<\/mc:AlternateContent>/g;

        try {
            const zip = await window.JSZip.loadAsync(arrayBuffer);
            let hasChanges = false;

            const xmlTargets = [];
            zip.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir && xmlTargetPattern.test(relativePath)) {
                    xmlTargets.push(relativePath);
                }
            });

            for (const targetPath of xmlTargets) {
                const originalXml = await zip.file(targetPath).async('string');
                const replacedXml = originalXml.replace(altContentPattern, '$1');
                if (replacedXml !== originalXml) {
                    hasChanges = true;
                    zip.file(targetPath, replacedXml);
                }
            }

            const relsFile = zip.file('word/_rels/document.xml.rels');
            const documentFile = zip.file('word/document.xml');
            if (relsFile && documentFile) {
                const relsXml = await relsFile.async('string');
                const chartTargetById = {};
                const relMatches = [...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Type="[^"]*\/chart"[^>]*Target="([^"]+)"[^>]*\/?>/g)];
                for (const rel of relMatches) {
                    chartTargetById[rel[1]] = resolveZipPath('word/document.xml', rel[2]);
                }

                if (Object.keys(chartTargetById).length > 0) {
                    const documentXml = await documentFile.async('string');
                    const drawingRegex = /<w:drawing[\s\S]*?<c:chart[^>]*r:id="([^"]+)"[\s\S]*?<\/w:drawing>/g;
                    let outputXml = '';
                    let cursor = 0;
                    let chartIndex = 0;
                    let match;

                    while ((match = drawingRegex.exec(documentXml)) !== null) {
                        outputXml += documentXml.slice(cursor, match.index);
                        cursor = drawingRegex.lastIndex;
                        const relId = match[1];
                        const chartPath = chartTargetById[relId];
                        const chartXml = chartPath ? await zip.file(chartPath)?.async('string') : null;
                        const chartData = chartXml ? parseChartData(chartXml) : null;

                        if (chartData && chartData.categories.length > 0 && chartData.series.length > 0) {
                            const token = `__OV_CHART_PLACEHOLDER_${chartIndex}__`;
                            chartIndex += 1;
                            result.chartPlaceholders.push({ token, chartData });
                            outputXml += `<w:t xml:space="preserve">${token}</w:t>`;
                            hasChanges = true;
                        } else {
                            outputXml += match[0];
                        }
                    }

                    outputXml += documentXml.slice(cursor);
                    if (outputXml !== documentXml) {
                        zip.file('word/document.xml', outputXml);
                    }
                }
            }

            if (hasChanges) {
                result.buffer = await zip.generateAsync({ type: 'arraybuffer' });
            }
            return result;
        } catch (preprocessError) {
            console.warn('DOCX preprocessing failed:', preprocessError);
            return result;
        }
    }

    function showError(message) {
        if (loading) loading.style.display = 'none';
        if (error) {
            error.textContent = message;
            error.style.display = 'block';
        }
    }

    function appendSourceInfo(config, hasCharts) {
        if (!fileInfo || !config) return;
        if (config.sourceFormat === 'doc' && config.wasConverted) {
            const sourceInfo = document.createElement('span');
            sourceInfo.textContent = ' • converted from .doc';
            fileInfo.appendChild(sourceInfo);
        }
        if (hasCharts) {
            const chartInfo = document.createElement('span');
            chartInfo.textContent = ' • charts: SVG';
            fileInfo.appendChild(chartInfo);
        }
    }

    function normalizeDocxPreviewDom() {
        if (!wordContent) return;

        const BROKEN_BULLET_PREFIX = /^[\u25A1\u25A0\u25FB\u25FC\uF0A7\uF0B7]\s*/;
        const BROKEN_BULLET_SINGLE = /[\u25A1\u25A0\u25FB\u25FC\uF0A7\uF0B7]/;

        const normalizeLeadingGlyph = (el) => {
            if (!el) return;
            for (const node of el.childNodes) {
                if (node.nodeType !== Node.TEXT_NODE) continue;
                const value = node.textContent || '';
                const trimmed = value.trimStart();
                if (!trimmed) continue;
                if (BROKEN_BULLET_PREFIX.test(trimmed)) {
                    const leadingSpaces = value.slice(0, value.length - trimmed.length);
                    node.textContent = `${leadingSpaces}${trimmed.replace(BROKEN_BULLET_PREFIX, '* ')}`;
                }
                break;
            }
        };

        wordContent.querySelectorAll('p, li').forEach((el) => {
            normalizeLeadingGlyph(el);
            const firstSpan = el.querySelector('span');
            if (firstSpan && BROKEN_BULLET_PREFIX.test(firstSpan.textContent || '')) {
                firstSpan.textContent = (firstSpan.textContent || '').replace(BROKEN_BULLET_PREFIX, '* ');
            }
        });

        wordContent.querySelectorAll('p[class*="docx-num-"], li[class*="docx-num-"]').forEach((el) => {
            const beforeContent = window.getComputedStyle(el, '::before').content || '';
            if (BROKEN_BULLET_SINGLE.test(beforeContent)) {
                el.setAttribute('data-ov-bullet-fix', '1');
            }
        });
    }

    function createChartElement(chartData) {
        const width = 760;
        const height = 340;
        const margin = { top: 30, right: 170, bottom: 50, left: 50 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;

        const maxValue = Math.max(1, ...chartData.series.flatMap((s) => s.values));
        const tickCount = 5;
        const groupCount = chartData.categories.length;
        const seriesCount = chartData.series.length;
        const groupWidth = plotWidth / Math.max(1, groupCount);
        const barWidth = Math.max(8, (groupWidth * 0.8) / Math.max(1, seriesCount));
        const groupOffset = (groupWidth - barWidth * seriesCount) / 2;

        const svgParts = [];
        for (let i = 0; i <= tickCount; i++) {
            const value = (maxValue / tickCount) * i;
            const y = margin.top + plotHeight - (value / maxValue) * plotHeight;
            svgParts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}" stroke="#e5e7eb" stroke-width="1" />`);
            svgParts.push(`<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="#6b7280">${value.toFixed(0)}</text>`);
        }

        chartData.categories.forEach((category, i) => {
            const x = margin.left + i * groupWidth + groupWidth / 2;
            svgParts.push(`<text x="${x}" y="${margin.top + plotHeight + 28}" text-anchor="middle" font-size="13" fill="#111827">${escapeHtml(category)}</text>`);
        });

        chartData.series.forEach((series, seriesIndex) => {
            series.values.forEach((value, valueIndex) => {
                const x = margin.left + valueIndex * groupWidth + groupOffset + seriesIndex * barWidth;
                const h = (Math.max(0, value) / maxValue) * plotHeight;
                const y = margin.top + plotHeight - h;
                svgParts.push(
                    `<rect x="${x}" y="${y}" width="${barWidth - 2}" height="${h}" fill="${series.color}" rx="1" />`
                );
            });
        });

        const legendItems = chartData.series
            .map(
                (series) =>
                    `<div class="ov-chart-legend-item"><span class="ov-chart-legend-color" style="background:${series.color}"></span><span>${escapeHtml(series.name)}</span></div>`
            )
            .join('');

        const block = document.createElement('div');
        block.className = 'ov-chart-card';
        block.innerHTML = `
            <div class="ov-chart-title">${escapeHtml(chartData.title || 'Chart')}</div>
            <div class="ov-chart-layout">
                <svg class="ov-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">
                    ${svgParts.join('')}
                </svg>
                <div class="ov-chart-legend">${legendItems}</div>
            </div>
        `;
        return block;
    }

    function replaceTextNodeWithNode(textNode, token, nodeToInsert) {
        const value = textNode.textContent || '';
        const index = value.indexOf(token);
        if (index < 0) return false;

        const before = value.slice(0, index);
        const after = value.slice(index + token.length);
        const frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        frag.appendChild(nodeToInsert);
        if (after) frag.appendChild(document.createTextNode(after));
        textNode.parentNode.replaceChild(frag, textNode);
        return true;
    }

    function injectChartPlaceholders(placeholders) {
        if (!wordContent || !Array.isArray(placeholders) || placeholders.length === 0) {
            return;
        }

        const allTextNodes = [];
        const walker = document.createTreeWalker(wordContent, NodeFilter.SHOW_TEXT);
        let current;
        while ((current = walker.nextNode())) {
            allTextNodes.push(current);
        }

        for (const placeholder of placeholders) {
            const targetNode = allTextNodes.find((n) => (n.textContent || '').includes(placeholder.token));
            if (!targetNode) continue;
            const chartNode = createChartElement(placeholder.chartData);
            replaceTextNodeWithNode(targetNode, placeholder.token, chartNode);
        }
    }

    async function renderWordFile() {
        const config = parseWordConfig();
        if (!config) {
            showError('Word configuration is missing or invalid.');
            return;
        }

        if (config.renderer === 'legacy-html') {
            try {
                if (wordContent) {
                    wordContent.classList.remove('docx-mode');
                    wordContent.classList.add('legacy-mode');
                    if (!wordContent.innerHTML || wordContent.innerHTML.trim() === '') {
                        wordContent.innerHTML = config.htmlContent || '';
                    }
                }
                appendSourceInfo(config, false);
                if (loading) loading.style.display = 'none';
                applyZoom();
                return;
            } catch (legacyErr) {
                showError(`Failed to render legacy Word document: ${legacyErr.message || legacyErr}`);
                return;
            }
        }

        if (!config.docxBase64) {
            showError('Word configuration is missing docx data.');
            return;
        }

        if (!window.docx || typeof window.docx.renderAsync !== 'function') {
            showError('docx-preview library is not available.');
            return;
        }

        try {
            if (wordContent) {
                wordContent.innerHTML = '';
                wordContent.classList.remove('pdf-mode');
                wordContent.classList.add('docx-mode');
            }

            const originalBuffer = base64ToArrayBuffer(config.docxBase64);
            const prepared = await preprocessDocx(originalBuffer);
            await window.docx.renderAsync(prepared.buffer, wordContent, undefined, {
                inWrapper: true,
                breakPages: true,
                ignoreWidth: false,
                ignoreHeight: false,
                ignoreFonts: false,
                renderHeaders: true,
                renderFooters: true
            });

            injectChartPlaceholders(prepared.chartPlaceholders);
            normalizeDocxPreviewDom();
            appendSourceInfo(config, prepared.chartPlaceholders.length > 0);

            if (loading) loading.style.display = 'none';
            applyZoom();
        } catch (renderError) {
            console.error('Failed to render Word document:', renderError);
            showError(`Failed to render Word document: ${renderError.message || renderError}`);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
