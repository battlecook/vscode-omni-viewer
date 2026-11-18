import { createCatalogI18n } from 'omni-viewer-core/i18n';

/** Shared VS Code bridge; each entry bundles only its own core viewer. */
export function startCorePreview(mount, arrow = false) {
    const parsed = JSON.parse(document.getElementById('preview-data').textContent);
    const container = document.getElementById('preview-root');
    const api = window.__omniVsCode__ || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);
    const controller = new AbortController();
    const pending = new Map();
    const assetUrls = new Set();
    let sequence = 0;
    let handle;
    let mounting = false;
    let disposed = false;

    function fail(error) {
        if (disposed) return;
        const notice = document.createElement('p');
        notice.setAttribute('role', 'alert');
        notice.textContent = error instanceof Error ? error.message : String(error);
        (container.shadowRoot || container).append(notice);
    }
    function request(type, payload) {
        if (!api || disposed) return Promise.reject(new Error('VS Code API is unavailable'));
        return new Promise((resolve, reject) => {
            const requestId = 'preview:' + (++sequence);
            pending.set(requestId, { resolve, reject });
            api.postMessage({ type, requestId, ...payload });
        });
    }
    const ctx = {
        assets: { resolveAssetUrl: assetPath => Promise.resolve(assetPath) },
        i18n: createCatalogI18n(parsed.locale || 'en'),
        logger: { log: (level, message) => {
            const log = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
            log('[core-preview]', message);
        } },
        ...(arrow || parsed.clipboard ? {
            clipboard: { writeText: text => request('corePreviewClipboard', { text }) },
        } : {}),
        ...(arrow || parsed.save === 'json' ? {
            save: { saveFile: (_name, data) => request('corePreviewSave', { content: new TextDecoder().decode(data) }) }
        } : {}),
        ...(parsed.save === 'attachment' ? {
            save: { saveFile: (name, data, mimeType) => request('corePreviewAttachmentSave', { name, data, mimeType }) }
        } : {}),
        ...(parsed.documentAssets ? {
            documentAssets: { resolve: async path => {
                const result = await request('corePreviewAsset', { url: path });
                if (!result || disposed) return null;
                const bytes = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data || []);
                const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'application/octet-stream' }));
                assetUrls.add(url);
                return { url, dispose: () => { if (assetUrls.delete(url)) URL.revokeObjectURL(url); } };
            } }
        } : {})
    };
    function onMessage(event) {
        const message = event.data || {};
        if (disposed) return;
        if (message.type === 'corePreviewResponse') {
            const entry = pending.get(message.requestId);
            if (!entry) return;
            pending.delete(message.requestId);
            if (message.ok) entry.resolve(message.result);
            else entry.reject(new Error(message.error || 'Host request failed'));
            return;
        }
        if (mounting) return;
        if (message.type === 'corePreviewError') {
            fail(new Error(message.message || 'Unable to read the file'));
            return;
        }
        if (message.type !== 'corePreviewSource') return;
        mounting = true;
        const data = message.data instanceof Uint8Array ? message.data : new Uint8Array(message.data || []);
        const options = { styleIsolation: 'shadow', signal: controller.signal, limits: { maxInputBytes: parsed.maxBytes } };
        if (arrow || parsed.nestedParse) options.parse = { signal: controller.signal, limits: options.limits };
        if (parsed.kind === 'dicom') options.maxBytes = parsed.maxBytes;
        Promise.resolve().then(() => mount({ fileName: parsed.fileName, data }, container, ctx, options))
            .then(mounted => { if (disposed) mounted.dispose(); else handle = mounted; })
            .catch(fail);
    }
    window.addEventListener('message', onMessage);
    window.addEventListener('unload', () => {
        disposed = true;
        controller.abort();
        window.removeEventListener('message', onMessage);
        if (handle) handle.dispose();
        assetUrls.forEach(url => URL.revokeObjectURL(url));
        assetUrls.clear();
        pending.forEach(entry => entry.reject(new Error('Viewer closed')));
        pending.clear();
    }, { once: true });
    if (api) api.postMessage({ type: 'corePreviewReady' });
    else fail(new Error('VS Code API is unavailable'));
}
