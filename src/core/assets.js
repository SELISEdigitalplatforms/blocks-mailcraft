/**
 * Asset-size formatting.
 *
 * No file list lives here. The library is the host's: with a `storageProvider`
 * wired the files come from the backend, and without one it starts empty and
 * holds only what the user drops in this session. Shipping a fabricated
 * catalogue of "brand" and "product" files meant every integrator's first run
 * showed six files nobody in their organisation had ever uploaded.
 */
export const KB = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
