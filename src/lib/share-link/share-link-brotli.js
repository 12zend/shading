import initBrotli, * as brotliModule from 'brotli-wasm/pkg.web/brotli_wasm.js';
import {createBrotliAdapter} from './share-link-brotli-adapter';

let loading = null;

/**
 * Loads the browser build of brotli-wasm once.
 * @param {string} wasmURL Absolute URL of brotli_wasm_bg.wasm.
 * @returns {Promise<{compress: Function, decompress: Function}>} Codec-compatible Brotli.
 */
const loadBrotli = wasmURL => {
    if (!loading) {
        loading = initBrotli(wasmURL)
            .then(() => createBrotliAdapter(brotliModule))
            .catch(error => {
                loading = null;
                throw error;
            });
    }
    return loading;
};

export default loadBrotli;
