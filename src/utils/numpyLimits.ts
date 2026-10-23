/** How much of a NumPy file the extension host will hold in memory.
 *
 *  The core parser takes the whole file as bytes, so this is both the NumPy
 *  viewer's read limit and the point past which file detection leaves an
 *  `.npz` with the archive viewer instead of claiming it for NumPy. It lives
 *  apart from `numpyModel` so the detection path can check the budget without
 *  pulling the parser into the extension bundle. */
export const MAX_NUMPY_READ_BYTES = 512 * 1024 * 1024;
