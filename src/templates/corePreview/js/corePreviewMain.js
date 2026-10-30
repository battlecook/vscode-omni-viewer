import { createCatalogI18n } from 'omni-viewer-core/i18n';

/** Shared VS Code bridge; each entry bundles only its own core viewer. */
export function startCorePreview(mount, arrow = false) {
    const parsed = JSON.parse(document.getElementById('preview-data').textContent);
    const container = document.getElementById('preview-root');
    const api = window.__omniVsCode__ || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);
    const controller = new AbortController();
    const pending = new Map();
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
        ...(arrow ? {
            clipboard: { writeText: text => request('corePreviewClipboard', { text }) },
            save: { saveFile: (_name, data) => request('corePreviewSave', { content: new TextDecoder().decode(data) }) }
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
        if (arrow) options.parse = { signal: controller.signal, limits: options.limits };
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
        pending.forEach(entry => entry.reject(new Error('Viewer closed')));
        pending.clear();
    }, { once: true });
    if (api) api.postMessage({ type: 'corePreviewReady' });
    else fail(new Error('VS Code API is unavailable'));
}
