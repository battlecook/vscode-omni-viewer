/** Bound host-side reads and webview messages; the core switches to a bounded
 *  source preview above its own 8 MiB rendering limit. */
export const MAX_HTML_READ_BYTES = 64 * 1024 * 1024;

/** Matches HTML_VIEWER_META.extensions in omni-viewer-core/viewers/html. */
export const HTML_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm']);
