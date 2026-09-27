// Share link work that runs inside the share worker (or on the main thread when workers are unavailable).
import loadBrotli from './share-link-brotli';
import {base64UrlToBytes, bytesToBase64Url, decodeShareData, encodeShareData} from './share-link-codec';

const runShareTask = async (type, data, onProgress) => {
    const brotli = await loadBrotli(data.wasmURL);
    if (type === 'encode') {
        const encoded = encodeShareData({files: data.files, title: data.title}, brotli, onProgress);
        return {payload: bytesToBase64Url(encoded), encodedBytes: encoded.length};
    }
    if (type === 'decode') {
        return decodeShareData(base64UrlToBytes(data.payload), brotli);
    }
    throw new Error(`Unknown share task: ${type}`);
};

export default runShareTask;
