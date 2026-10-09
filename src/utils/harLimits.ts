/** How much of a HAR archive the extension host will hold in memory.
 *
 *  Unlike a model format, the parsed HAR document is about as large as the
 *  archive itself, and it reaches the webview embedded in the page HTML — so
 *  the host holds several copies of it (bytes, decoded text, JSON tree, model,
 *  the serialized and escaped page). This sits well below the core parser's
 *  256 MB input limit to keep those copies clear of V8's string length limit
 *  and the webview's memory. It is both the HAR viewer's read limit and the
 *  point past which file detection stops claiming a file for the HAR viewer.
 *  It lives apart from `harModel` so the detection path can check the budget
 *  without pulling the parser into the extension bundle. */
export const MAX_HAR_READ_BYTES = 100 * 1024 * 1024;
