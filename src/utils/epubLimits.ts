/** How much of an EPUB the viewer will hold in memory.
 *
 *  Matches `DEFAULT_LIMITS.maxInputBytes` in `omni-viewer-core/parsers`: the
 *  core viewer reads chapters and images out of the whole archive on demand,
 *  so the entire `.epub` is posted to the webview, and `parseEpub` refuses
 *  anything larger. This is both the EPUB viewer's read limit and the point
 *  past which file detection leaves an `.epub` with the archive viewer, which
 *  can still list what is inside it. */
export const MAX_EPUB_READ_BYTES = 256 * 1024 * 1024;
