/** How much of a Core ML model the extension host will hold in memory.
 *
 *  The core parser takes the whole file as bytes, so this is both the Core ML
 *  viewer's read limit and the point past which file detection leaves an
 *  `.mlpackage` with the archive viewer instead of claiming it for Core ML.
 *  It lives apart from `coremlModel` so the detection path can check the budget
 *  without pulling the parser into the extension bundle. */
export const MAX_COREML_READ_BYTES = 512 * 1024 * 1024;
