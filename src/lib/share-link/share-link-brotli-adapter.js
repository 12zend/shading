// Adapts a brotli-wasm module to the {compress, decompress} interface of the share link codec.
// Compression streams its input so long runs can report progress; the output is identical to
// one-shot compression.

const RESULT_SUCCESS = 1;
const NEEDS_MORE_INPUT = 2;
const NEEDS_MORE_OUTPUT = 3;
const INPUT_CHUNK = 512 * 1024;
const OUTPUT_CHUNK = 1024 * 1024;

const concat = (chunks, total) => {
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
};

const streamCompress = (brotliModule, bytes, quality, onProgress) => {
    const stream = new brotliModule.CompressStream(quality);
    const chunks = [];
    let total = 0;
    const collect = result => {
        if (result.buf.length) {
            chunks.push(result.buf);
            total += result.buf.length;
        }
    };
    try {
        for (let offset = 0; offset < bytes.length; offset += INPUT_CHUNK) {
            const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + INPUT_CHUNK));
            let consumed = 0;
            for (;;) {
                const result = stream.compress(chunk.subarray(consumed), OUTPUT_CHUNK);
                consumed += result.input_offset;
                collect(result);
                if (result.code === NEEDS_MORE_INPUT && consumed >= chunk.length) break;
                if (result.code !== NEEDS_MORE_INPUT && result.code !== NEEDS_MORE_OUTPUT) {
                    throw new Error(`Brotli compression failed (${result.code}).`);
                }
            }
            if (onProgress) onProgress(offset + chunk.length);
        }
        for (;;) {
            // No more input: flush and finish the stream.
            const result = stream.compress(null, OUTPUT_CHUNK);
            collect(result);
            if (result.code === RESULT_SUCCESS) break;
            if (result.code !== NEEDS_MORE_OUTPUT) throw new Error(`Brotli compression failed (${result.code}).`);
        }
    } finally {
        stream.free();
    }
    return concat(chunks, total);
};

const createBrotliAdapter = brotliModule => ({
    compress: (bytes, quality, onProgress) => (
        typeof brotliModule.CompressStream === 'function' ?
            streamCompress(brotliModule, bytes, quality, onProgress) :
            brotliModule.compress(bytes, {quality})
    ),
    decompress: bytes => brotliModule.decompress(bytes)
});

export {
    createBrotliAdapter
};
