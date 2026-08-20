const BASE64_CHUNK_SIZE = 0x8000;

const toUint8Array = value => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
};

const uint8ArrayToBase64 = value => {
    const bytes = toUint8Array(value);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
    }
    return btoa(binary);
};

const base64ToUint8Array = value => {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
};

const streamToUint8Array = async stream => {
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
};

const encodeProjectJSON = async projectJSON => {
    const text = String(projectJSON || '');
    if (typeof CompressionStream !== 'function') return {data: text, encoding: 'plain'};
    try {
        const stream = new Blob([text]).stream()
            .pipeThrough(new CompressionStream('gzip'));
        return {
            data: uint8ArrayToBase64(await streamToUint8Array(stream)),
            encoding: 'gzip-base64'
        };
    } catch (error) {
        return {data: text, encoding: 'plain'};
    }
};

const decodeProjectJSON = async payload => {
    if (!payload || payload.encoding === 'plain') return String((payload && payload.data) || '');
    if (payload.encoding !== 'gzip-base64' || typeof DecompressionStream !== 'function') {
        throw new Error('Unsupported project.json encoding');
    }
    const bytes = base64ToUint8Array(payload.data);
    const stream = new Blob([bytes]).stream()
        .pipeThrough(new DecompressionStream('gzip'));
    return new TextDecoder().decode(await streamToUint8Array(stream));
};

const createProjectBundle = async (files, knownAssetNames = []) => {
    const projectBytes = files && files['project.json'];
    if (!projectBytes) throw new Error('project.json is missing');
    const known = new Set(knownAssetNames);
    const assetNames = Object.keys(files)
        .filter(name => name !== 'project.json')
        .sort();
    const assets = {};
    for (const name of assetNames) {
        if (!known.has(name)) assets[name] = uint8ArrayToBase64(files[name]);
    }
    return {
        assetNames,
        assets,
        project: await encodeProjectJSON(new TextDecoder().decode(toUint8Array(projectBytes)))
    };
};

export {
    base64ToUint8Array,
    createProjectBundle,
    decodeProjectJSON,
    encodeProjectJSON,
    toUint8Array,
    uint8ArrayToBase64
};
