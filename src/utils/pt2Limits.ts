/** How much of a PyTorch Export package the extension host will hold in memory.
 *
 *  The core parser takes the whole archive as bytes, so this is both the PT2
 *  viewer's read limit and the point past which file detection leaves a `.pt2`
 *  with the archive viewer instead of claiming it for PyTorch Export. It lives
 *  apart from `pt2Model` so the detection path can check the budget without
 *  pulling the parser into the extension bundle. */
export const MAX_PT2_READ_BYTES = 512 * 1024 * 1024;
