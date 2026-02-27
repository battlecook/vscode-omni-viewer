(function () {
    'use strict';

    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const slidesContainer = document.getElementById('slidesContainer');
    const slideSelect = document.getElementById('slideSelect');
    const slideCount = document.getElementById('slideCount');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const zoomResetBtn = document.getElementById('zoomReset');
    const zoomLevel = document.getElementById('zoomLevel');

    const dataTag = document.getElementById('presentation-data');
    let presentation = {};
    let parseError = null;
    try {
        const raw = (dataTag && dataTag.textContent) ? dataTag.textContent : '{}';
        if (raw.length > 60 * 1024 * 1024) {
            throw new Error('Presentation payload is too large to render safely.');
        }
        const parsed = JSON.parse(raw);
        presentation = normalizePresentation(parsed);
    } catch (err) {
        parseError = err instanceof Error ? err : new Error(String(err));
    }

    let currentScale = 1;
    const MIN_SCALE = 0.5;
    const MAX_SCALE = 2.5;
    const SCALE_STEP = 0.1;

    let pdfDoc = null;
    let pdfJsReady = false;
    let renderToken = 0;

    const RENDER_TIMEOUT_MS = 30000;
    const PDFJS_LOAD_TIMEOUT_MS = 12000;

    function normalizePresentation(parsed) {
        if (!parsed || typeof parsed !== 'object') {
            return { mode: 'xml', slides: [], totalSlides: 0 };
        }
        const normalized = { ...parsed };
        if (normalized.mode !== 'pdf' && normalized.mode !== 'xml') {
            normalized.mode = 'xml';
        }
        if (!Array.isArray(normalized.slides)) {
            normalized.slides = [];
        }
        if (!Number.isFinite(normalized.totalSlides)) {
            normalized.totalSlides = normalized.mode === 'pdf'
                ? Number(normalized.totalSlides || 0)
                : normalized.slides.length;
        }
        return normalized;
    }

    function nextFrame() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    }

    async function withTimeout(promise, timeoutMs, message) {
        let timer = null;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function setError(message) {
        if (loading) loading.style.display = 'none';
        if (error) {
            error.textContent = message;
            error.style.display = 'block';
        }
    }

    function updateZoomText() {
        if (zoomLevel) {
            zoomLevel.textContent = `${Math.round(currentScale * 100)}%`;
        }
    }

    function base64ToUint8Array(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function mapAlign(align) {
        if (align === 'ctr') return 'center';
        if (align === 'r') return 'right';
        if (align === 'just') return 'justify';
        return 'left';
    }

    function safeDimension(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }

    function hexToRgb(hex) {
        const raw = (hex || '').replace('#', '').trim();
        if (raw.length === 3) {
            const r = parseInt(raw[0] + raw[0], 16);
            const g = parseInt(raw[1] + raw[1], 16);
            const b = parseInt(raw[2] + raw[2], 16);
            return Number.isNaN(r) ? null : { r, g, b };
        }
        if (raw.length === 6) {
            const r = parseInt(raw.slice(0, 2), 16);
            const g = parseInt(raw.slice(2, 4), 16);
            const b = parseInt(raw.slice(4, 6), 16);
            return Number.isNaN(r) ? null : { r, g, b };
        }
        return null;
    }

    function getReadableTextColor(bgColor) {
        const rgb = hexToRgb(bgColor);
        if (!rgb) return '#111111';
        const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
        return luminance < 0.58 ? '#ffffff' : '#111111';
    }

    function createTextShape(element, fallbackColor) {
        const box = document.createElement('div');
        box.className = `shape-box text-shape ${element.isTitle ? 'title-shape' : ''}`.trim();
        box.style.left = `${element.x}px`;
        box.style.top = `${element.y}px`;
        box.style.width = `${element.width}px`;
        box.style.height = `${element.height}px`;
        box.style.zIndex = String(element.zIndex || 0);
        if (element.rotateDeg) {
            box.style.transform = `rotate(${element.rotateDeg}deg)`;
            box.style.transformOrigin = 'top left';
        }
        if (element.fillColor) box.style.backgroundColor = element.fillColor;
        if (element.borderColor) box.style.border = `1px solid ${element.borderColor}`;

        const paragraphs = Array.isArray(element.paragraphs) ? element.paragraphs : [];
        const isLikelyList = !element.isTitle && paragraphs.length >= 3;
        paragraphs.forEach((paragraph) => {
            const p = document.createElement('p');
            p.className = 'text-line';
            p.style.marginLeft = `${Math.max(0, Number(paragraph.level || 0)) * 16}px`;
            p.style.textAlign = mapAlign(paragraph.align);
            const level = Math.max(0, Number(paragraph.level || 0));
            const inferredSize = element.isTitle ? 52 : Math.max(16, 24 - level * 2);
            const fontSize = paragraph.fontSizePx || inferredSize;
            p.style.fontSize = `${fontSize}px`;
            p.style.lineHeight = `${Math.max(18, Math.round(fontSize * 1.18))}px`;

            if (paragraph.bold) p.style.fontWeight = '700';
            else p.style.fontWeight = '400';
            if (paragraph.italic) p.style.fontStyle = 'italic';
            const inferredTitleColor = (element.isTitle && !paragraph.color) ? '#8e8f92' : undefined;
            const paragraphColor = paragraph.color || inferredTitleColor || fallbackColor || '#111111';
            p.style.color = paragraphColor;

            const showBullet = !!paragraph.bullet || (isLikelyList && !!(paragraph.text || '').trim());
            if (showBullet) {
                const bullet = document.createElement('span');
                bullet.textContent = '•';
                bullet.style.display = 'inline-block';
                bullet.style.width = '26px';
                bullet.style.marginRight = '6px';
                bullet.style.textAlign = 'center';
                bullet.style.color = paragraphColor;
                p.appendChild(bullet);
            }

            const runs = Array.isArray(paragraph.runs) ? paragraph.runs : [];
            if (runs.length > 0) {
                runs.forEach((run) => {
                    const span = document.createElement('span');
                    span.textContent = run.text || '';
                    if (run.fontSizePx) span.style.fontSize = `${run.fontSizePx}px`;
                    if (run.bold) span.style.fontWeight = '700';
                    if (run.italic) span.style.fontStyle = 'italic';
                    span.style.color = run.color || paragraphColor;
                    p.appendChild(span);
                });
            } else {
                p.appendChild(document.createTextNode(paragraph.text || ''));
            }
            box.appendChild(p);
        });

        return box;
    }

    function createImageShape(element) {
        const box = document.createElement('div');
        box.className = 'shape-box image-shape';
        box.style.left = `${element.x}px`;
        box.style.top = `${element.y}px`;
        box.style.width = `${element.width}px`;
        box.style.height = `${element.height}px`;
        box.style.zIndex = String(element.zIndex || 0);
        if (element.rotateDeg) {
            box.style.transform = `rotate(${element.rotateDeg}deg)`;
            box.style.transformOrigin = 'top left';
        }

        const img = document.createElement('img');
        img.className = 'slide-image';
        img.src = element.src || '';
        img.alt = 'slide-image';
        if (element.vectorFallback) {
            img.addEventListener('load', () => {
                try {
                    const normalized = normalizeVectorFallbackLogo(img);
                    if (normalized) {
                        img.src = normalized;
                    }
                } catch {
                    // Keep original image when post-processing fails.
                }
            }, { once: true });
        }
        box.appendChild(img);
        return box;
    }

    function normalizeVectorFallbackLogo(img) {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) return null;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const target = { r: 237, g: 30, b: 68 };

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a === 0) continue;

            const redDominant = r > 130 && r > g * 1.25 && r > b * 1.25;
            if (redDominant) {
                data[i + 3] = 0;
                continue;
            }

            const brightness = (r + g + b) / 3;
            const alphaRatio = Math.max(0, Math.min(1, brightness / 255));
            data[i] = target.r;
            data[i + 1] = target.g;
            data[i + 2] = target.b;
            data[i + 3] = Math.round(a * alphaRatio);
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    function createTableShape(element) {
        const box = document.createElement('div');
        box.className = 'shape-box table-shape';
        box.style.left = `${element.x}px`;
        box.style.top = `${element.y}px`;
        box.style.width = `${element.width}px`;
        box.style.height = `${element.height}px`;
        box.style.zIndex = String(element.zIndex || 0);
        if (element.rotateDeg) {
            box.style.transform = `rotate(${element.rotateDeg}deg)`;
            box.style.transformOrigin = 'top left';
        }

        const table = document.createElement('table');
        const rows = Array.isArray(element.tableRows) ? element.tableRows : [];
        rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            row.forEach((cell) => {
                const td = document.createElement(rowIndex === 0 ? 'th' : 'td');
                td.textContent = cell || '';
                tr.appendChild(td);
            });
            table.appendChild(tr);
        });
        box.appendChild(table);
        return box;
    }

    function createChartShape(element) {
        const box = document.createElement('div');
        box.className = `shape-box chart-shape ${element.chartData ? 'chart-shape-rendered' : ''}`.trim();
        box.style.left = `${element.x}px`;
        box.style.top = `${element.y}px`;
        box.style.width = `${element.width}px`;
        box.style.height = `${element.height}px`;
        box.style.zIndex = String(element.zIndex || 0);
        if (element.rotateDeg) {
            box.style.transform = `rotate(${element.rotateDeg}deg)`;
            box.style.transformOrigin = 'top left';
        }

        if (element.chartData && element.chartData.kind === 'stackedColumn') {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(300, Math.floor(element.width));
            canvas.height = Math.max(180, Math.floor(element.height));
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            drawStackedColumnChart(canvas, element.chartData);
            box.appendChild(canvas);
        } else {
            const title = document.createElement('div');
            title.className = 'chart-title';
            title.textContent = element.chartTitle || (element.chartKind === 'smartart' ? 'SmartArt' : 'Chart');
            const subtitle = document.createElement('div');
            subtitle.className = 'chart-subtitle';
            subtitle.textContent = element.chartKind === 'smartart' ? 'SmartArt placeholder' : 'Chart placeholder';
            box.appendChild(title);
            box.appendChild(subtitle);
        }
        return box;
    }

    function getDecimalPlaces(formatCode) {
        if (!formatCode) return 0;
        const match = formatCode.match(/0\.([0#]+)/);
        return match ? match[1].length : 0;
    }

    function formatChartValue(value, formatCode) {
        const decimals = getDecimalPlaces(formatCode);
        const isCurrency = typeof formatCode === 'string' && formatCode.includes('$');
        const useParensForNegative = typeof formatCode === 'string' && /;\s*\\?\(.*0/.test(formatCode);
        const abs = Math.abs(value);
        const numeric = abs.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
        const prefixed = isCurrency ? `$${numeric}` : numeric;
        if (value < 0) {
            return useParensForNegative ? `(${prefixed})` : `-${prefixed}`;
        }
        return prefixed;
    }

    function getNiceStep(span, targetTicks) {
        const safeSpan = Math.max(0.000001, span);
        const rough = safeSpan / Math.max(1, targetTicks);
        const power = Math.pow(10, Math.floor(Math.log10(rough)));
        const normalized = rough / power;
        let unit = 1;
        if (normalized > 5) unit = 10;
        else if (normalized > 2) unit = 5;
        else if (normalized > 1) unit = 2;
        return unit * power;
    }

    function drawStackedColumnChart(canvas, chartData) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        const margin = { left: 74, right: 20, top: 20, bottom: 88 };
        const plotW = w - margin.left - margin.right;
        const plotH = h - margin.top - margin.bottom;
        if (plotW <= 20 || plotH <= 20) return;

        const categories = Array.isArray(chartData.categories) ? chartData.categories : [];
        const series = Array.isArray(chartData.series) ? chartData.series : [];
        if (categories.length === 0 || series.length === 0) return;

        const valueAxis = chartData.valueAxis || {};
        const categoryAxis = chartData.categoryAxis || {};
        const legend = chartData.legend || {};
        const axisFormat = valueAxis.numFmt || '$#,##0.0';
        const axisTextColor = valueAxis.color || '#222222';
        const axisFontSize = Math.max(10, Number(valueAxis.fontSizePx || 11));
        const categoryTextColor = categoryAxis.color || '#222222';
        const categoryFontSize = Math.max(10, Number(categoryAxis.fontSizePx || 11));

        const sums = categories.map((_, idx) =>
            series.reduce((acc, s) => acc + Math.max(0, Number((s.values || [])[idx] || 0)), 0)
        );
        const mins = categories.map((_, idx) =>
            series.reduce((acc, s) => acc + Math.min(0, Number((s.values || [])[idx] || 0)), 0)
        );

        const axisMin = Number(valueAxis.min);
        const axisMax = Number(valueAxis.max);
        let minValue = Number.isFinite(axisMin) ? axisMin : Math.min(0, ...mins);
        let maxValue = Number.isFinite(axisMax) ? axisMax : Math.max(1, ...sums);
        if (minValue >= maxValue) {
            maxValue = minValue + 1;
        }
        const span = maxValue - minValue;
        const yFor = (v) => margin.top + ((maxValue - v) / span) * plotH;
        const zeroY = yFor(Number.isFinite(valueAxis.crossesAt) ? valueAxis.crossesAt : 0);
        const yStep = Number.isFinite(valueAxis.majorUnit) && valueAxis.majorUnit > 0
            ? valueAxis.majorUnit
            : getNiceStep(span, 8);

        ctx.clearRect(0, 0, w, h);

        ctx.strokeStyle = valueAxis.lineColor || '#4f81bd';
        ctx.lineWidth = 1;
        ctx.strokeRect(margin.left, margin.top, plotW, plotH);

        ctx.strokeStyle = valueAxis.gridColor || 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 1;
        let tick = Math.floor(minValue / yStep) * yStep;
        let safeTickCount = 0;
        while (tick <= maxValue + yStep * 0.5 && safeTickCount < 250) {
            const y = yFor(tick);
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + plotW, y);
            ctx.stroke();

            ctx.fillStyle = axisTextColor;
            ctx.font = `400 ${axisFontSize}px Arial, sans-serif`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(formatChartValue(tick, axisFormat), margin.left - 12, y);

            tick += yStep;
            safeTickCount += 1;
        }

        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(margin.left, zeroY);
        ctx.lineTo(margin.left + plotW, zeroY);
        ctx.stroke();

        const groupW = plotW / categories.length;
        const gapWidth = Number(chartData.gapWidth);
        const gapScale = Number.isFinite(gapWidth) ? Math.max(0.2, Math.min(0.9, 1 - gapWidth / 300)) : 0.58;
        const barW = Math.max(8, groupW * gapScale);

        categories.forEach((cat, idx) => {
            const cx = margin.left + groupW * idx + groupW / 2;
            let posBase = 0;
            let negBase = 0;

            series.forEach((s) => {
                const raw = Number((s.values || [])[idx] || 0);
                if (!Number.isFinite(raw) || raw === 0) return;

                let from;
                let to;
                if (raw >= 0) {
                    from = yFor(posBase);
                    posBase += raw;
                    to = yFor(posBase);
                } else {
                    from = yFor(negBase);
                    negBase += raw;
                    to = yFor(negBase);
                }
                const top = Math.min(from, to);
                const height = Math.max(1, Math.abs(from - to));

                ctx.fillStyle = s.color || '#d10000';
                ctx.fillRect(cx - barW / 2, top, barW, height);

                const dataLabel = s.dataLabel || {};
                const showValue = dataLabel.showValue !== false;
                if (showValue && Math.abs(raw) >= 0.1 && height > 12) {
                    const labelFmt = dataLabel.numFmt || axisFormat;
                    const labelColor = dataLabel.color || '#ffffff';
                    const labelSize = Math.max(9, Number(dataLabel.fontSizePx || 11));
                    ctx.fillStyle = labelColor;
                    ctx.font = `400 ${labelSize}px Arial, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(formatChartValue(raw, labelFmt), cx, top + height / 2);
                }
            });

            ctx.fillStyle = categoryTextColor;
            ctx.font = `400 ${categoryFontSize}px Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            const parts = String(cat).split(' ');
            if (parts.length > 1) {
                ctx.fillText(parts[0], cx, h - 30);
                ctx.fillText(parts.slice(1).join(' '), cx, h - 14);
            } else {
                ctx.fillText(cat, cx, h - 16);
            }
        });

        const legendFontSize = Math.max(10, Number(legend.fontSizePx || 12));
        const legendTextColor = legend.color || '#222222';
        const legendItems = series.map((s, i) => ({
            color: s.color || '#999999',
            label: s.name || `Series ${i + 1}`
        }));
        const legendY = h - 6;
        const itemGap = 22;
        const swatchW = 10;
        const contentWidth = legendItems.reduce((acc, item) => acc + swatchW + 6 + item.label.length * (legendFontSize * 0.55) + itemGap, 0);
        let cursorX = Math.max(8, (w - contentWidth) / 2);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `400 ${legendFontSize}px Arial, sans-serif`;
        legendItems.forEach((item) => {
            ctx.fillStyle = item.color;
            ctx.fillRect(cursorX, legendY - 10, swatchW, swatchW);
            cursorX += swatchW + 6;
            ctx.fillStyle = legendTextColor;
            ctx.fillText(item.label, cursorX, legendY - 1);
            cursorX += item.label.length * (legendFontSize * 0.55) + itemGap;
        });
    }

    function createGenericShape(element) {
        const box = document.createElement('div');
        box.className = 'shape-box generic-shape';
        box.style.left = `${element.x}px`;
        box.style.top = `${element.y}px`;
        box.style.width = `${element.width}px`;
        box.style.height = `${element.height}px`;
        box.style.zIndex = String(element.zIndex || 0);
        if (element.rotateDeg) {
            box.style.transform = `rotate(${element.rotateDeg}deg)`;
            box.style.transformOrigin = 'top left';
        }
        if (element.fillColor) box.style.backgroundColor = element.fillColor;
        if (element.borderColor) box.style.border = `1px solid ${element.borderColor}`;
        return box;
    }

    function createXmlSlideElement(slide, index) {
        const slideEl = document.createElement('article');
        slideEl.className = 'slide';
        slideEl.dataset.page = String(index + 1);

        const header = document.createElement('div');
        header.className = 'slide-header';
        const stageWidth = Math.max(320, safeDimension(slide.widthPx, 1280));
        const stageHeight = Math.max(240, safeDimension(slide.heightPx, 720));
        header.textContent = `Slide ${slide.slideNumber || index + 1}`;

        const stage = document.createElement('div');
        stage.className = 'slide-stage';
        stage.style.width = `${stageWidth}px`;
        stage.style.setProperty('height', `${stageHeight}px`, 'important');
        stage.style.setProperty('min-height', `${stageHeight}px`, 'important');
        stage.style.setProperty('display', 'block', 'important');
        stage.style.setProperty('position', 'relative', 'important');
        slideEl.style.setProperty('min-height', `${stageHeight + 56}px`, 'important');
        stage.style.background = slide.backgroundColor || '#ffffff';
        stage.style.border = '1px solid rgba(255,255,255,0.15)';
        const fallbackTextColor = getReadableTextColor(slide.backgroundColor || '#ffffff');

        const elements = Array.isArray(slide.elements) ? [...slide.elements] : [];
        elements.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

        elements.forEach((element) => {
            if (element.type === 'image') stage.appendChild(createImageShape(element));
            else if (element.type === 'text') stage.appendChild(createTextShape(element, fallbackTextColor));
            else if (element.type === 'table') stage.appendChild(createTableShape(element));
            else if (element.type === 'chart') stage.appendChild(createChartShape(element));
            else stage.appendChild(createGenericShape(element));
        });

        if (elements.length === 0) {
            const fallback = document.createElement('div');
            fallback.className = 'no-content';
            fallback.textContent = '(No visible slide elements)';
            stage.appendChild(fallback);
        }

        stage.style.transform = `scale(${currentScale})`;
        stage.style.transformOrigin = 'top left';

        slideEl.appendChild(header);
        slideEl.appendChild(stage);
        return slideEl;
    }

    async function renderXmlSlides(token) {
        const slides = Array.isArray(presentation.slides) ? presentation.slides : [];
        slidesContainer.querySelectorAll('.slide').forEach((el) => el.remove());
        for (let index = 0; index < slides.length; index++) {
            if (token !== renderToken) {
                return false;
            }
            const slide = slides[index];
            slidesContainer.appendChild(createXmlSlideElement(slide, index));
            if (loading && slides.length > 0) {
                loading.textContent = `Rendering slides... (${index + 1}/${slides.length})`;
            }
            if ((index + 1) % 2 === 0) {
                await nextFrame();
            }
        }
        return true;
    }

    async function renderPdfSlides(token) {
        if (!pdfDoc) return false;
        slidesContainer.querySelectorAll('.slide').forEach((el) => el.remove());

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            if (token !== renderToken) {
                return false;
            }
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: currentScale });

            const slide = document.createElement('article');
            slide.className = 'slide';
            slide.dataset.page = String(pageNum);

            const header = document.createElement('div');
            header.className = 'slide-header';
            header.textContent = `Slide ${pageNum}`;

            const canvas = document.createElement('canvas');
            canvas.className = 'slide-canvas';
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);

            const context = canvas.getContext('2d');
            if (!context) continue;
            await page.render({ canvasContext: context, viewport }).promise;

            slide.appendChild(header);
            slide.appendChild(canvas);
            slidesContainer.appendChild(slide);
            if (loading && pdfDoc.numPages > 0) {
                loading.textContent = `Rendering slides... (${pageNum}/${pdfDoc.numPages})`;
            }
            if (pageNum % 2 === 0) {
                await nextFrame();
            }
        }
        return true;
    }

    async function renderSlides() {
        const token = ++renderToken;
        const renderStartedAt = performance.now();
        if (loading) {
            loading.style.display = 'block';
            loading.textContent = 'Rendering slides...';
        }
        console.log(`[PPT] render start token=${token} mode=${presentation.mode} scale=${currentScale.toFixed(2)}`);
        const finished = await withTimeout(
            presentation.mode === 'pdf' ? renderPdfSlides(token) : renderXmlSlides(token),
            RENDER_TIMEOUT_MS,
            'Slide rendering timed out. Please reopen the file.'
        );
        const elapsed = Math.round(performance.now() - renderStartedAt);
        console.log(`[PPT] render end token=${token} finished=${Boolean(finished)} elapsed=${elapsed}ms`);
        if (token === renderToken && finished && loading) {
            loading.style.display = 'none';
        }
    }

    function populateSlideSelect(totalPages) {
        if (!slideSelect) return;
        slideSelect.innerHTML = '';

        for (let i = 1; i <= totalPages; i++) {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = `Slide ${i}`;
            slideSelect.appendChild(option);
        }

        if (slideCount) slideCount.textContent = `${totalPages} slides`;
    }

    function jumpToSlide(pageNum) {
        const target = document.querySelector(`.slide[data-page="${pageNum}"]`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    async function changeZoom(nextScale) {
        currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
        updateZoomText();
        await renderSlides();
    }

    function bindEvents() {
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => void changeZoom(currentScale + SCALE_STEP));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => void changeZoom(currentScale - SCALE_STEP));
        if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => void changeZoom(1));

        if (slideSelect) {
            slideSelect.addEventListener('change', (event) => {
                const target = event.target;
                if (target && target.value) jumpToSlide(Number(target.value));
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && (event.key === '+' || event.key === '=')) {
                event.preventDefault();
                void changeZoom(currentScale + SCALE_STEP);
            } else if (event.ctrlKey && event.key === '-') {
                event.preventDefault();
                void changeZoom(currentScale - SCALE_STEP);
            } else if (event.ctrlKey && event.key === '0') {
                event.preventDefault();
                void changeZoom(1);
            }
        });
    }

    async function initPdfMode() {
        if (!presentation.pdfBase64) {
            throw new Error('No converted PDF data found for this .ppt file.');
        }
        await ensurePdfJsLoaded();

        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const bytes = base64ToUint8Array(presentation.pdfBase64);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        pdfDoc = await loadingTask.promise;
        populateSlideSelect(pdfDoc.numPages);
    }

    async function ensurePdfJsLoaded() {
        if (pdfJsReady && typeof pdfjsLib !== 'undefined') return;
        if (typeof pdfjsLib !== 'undefined') {
            pdfJsReady = true;
            return;
        }

        await new Promise((resolve, reject) => {
            let timeoutId = null;
            const clear = () => {
                if (timeoutId) clearTimeout(timeoutId);
            };
            timeoutId = setTimeout(() => {
                reject(new Error('Timed out while loading pdf.js. Network access may be blocked.'));
            }, PDFJS_LOAD_TIMEOUT_MS);

            const existing = document.querySelector('script[data-pdfjs="true"]');
            if (existing) {
                existing.addEventListener('load', () => {
                    clear();
                    resolve();
                }, { once: true });
                existing.addEventListener('error', () => {
                    clear();
                    reject(new Error('Failed to load pdf.js'));
                }, { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.async = true;
            script.dataset.pdfjs = 'true';
            script.onload = () => {
                clear();
                resolve();
            };
            script.onerror = () => {
                clear();
                reject(new Error('pdf.js failed to load. Check your network connection.'));
            };
            document.head.appendChild(script);
        });

        if (typeof pdfjsLib === 'undefined') {
            throw new Error('pdf.js failed to initialize.');
        }
        pdfJsReady = true;
    }

    function initXmlMode() {
        const slides = Array.isArray(presentation.slides) ? presentation.slides : [];
        populateSlideSelect(slides.length);
    }

    async function init() {
        try {
            if (parseError) {
                throw parseError;
            }
            if (presentation.mode === 'pdf') {
                await initPdfMode();
            } else {
                initXmlMode();
            }

            bindEvents();
            await renderSlides();
            updateZoomText();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => void init());
    } else {
        void init();
    }
})();
