/** How much of a Keras model the extension host will hold in memory.
 *
 *  The core parser takes the whole file as bytes, so this is both the Keras
 *  viewer's read limit and the point past which file detection leaves an HDF5
 *  model with the paged HDF5 tree viewer instead of claiming it for Keras.
 *  It lives apart from `kerasModel` so the detection path can check the budget
 *  without pulling the parser into the extension bundle. */
export const MAX_KERAS_READ_BYTES = 512 * 1024 * 1024;
