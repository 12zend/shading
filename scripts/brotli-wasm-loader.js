// brotli-wasm's browser glue only reads import.meta.url to find its .wasm file when init() gets no
// URL. The share link code always passes the URL, and webpack 4 cannot parse import.meta at all.
module.exports = function brotliWasmLoader (source) {
    return source.replace(/import\.meta\.url/g, 'undefined');
};
