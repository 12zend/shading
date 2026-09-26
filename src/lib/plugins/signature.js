/* global Buffer */
import {decodeText} from './archive';

// Official plugins carry shading-plugin.sig, an ECDSA P-256 signature made by `scripts/sign.mjs` in shading-plugins.
// It covers the SHA-256 of every other file in the plugin, so a signed folder verifies however it was zipped, and
// any changed, added or removed file breaks it. A valid signature only says who published the files; it does not
// sandbox them.

const SIGNATURE_NAME = 'shading-plugin.sig';
const SIGNATURE_FORMAT = 'shading.app/plugin-signature';
const PAYLOAD_HEADER = `${SIGNATURE_FORMAT}/1\n`;

// Must match signing-keys.json in shading-plugins. Add a key here before signing with it; remove one to revoke it.
const OFFICIAL_KEYS = {
    'official-2026': {
        kty: 'EC',
        crv: 'P-256',
        x: '9epiCdiGTgjCRJG2FPyt18883OTXxExI28b6TkpKvZM',
        y: '-d61jO8dR1yhrtI1zJVOjQWVWrmMlnbZMv_y6Tl_Eeg'
    }
};

const getSubtle = () => (typeof crypto !== 'undefined' && crypto.subtle) || null;

const toHex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');

const decodeBase64 = text => {
    if (typeof atob === 'function') return Uint8Array.from(atob(text), char => char.charCodeAt(0));
    return new Uint8Array(Buffer.from(text, 'base64'));
};

const encodeText = text => {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    return new Uint8Array(Buffer.from(text, 'utf8'));
};

/**
 * The signed text: one "<sha256 hex> <path>" line per file, sorted by path.
 * @param {Map<string, Uint8Array>} files Plugin files (without the signature).
 * @param {SubtleCrypto} subtle WebCrypto.
 * @returns {Promise<Uint8Array>} Payload bytes.
 */
const signaturePayload = async (files, subtle) => {
    const paths = Array.from(files.keys()).filter(path => path !== SIGNATURE_NAME)
        .sort((a, b) => {
            if (a < b) return -1;
            return a > b ? 1 : 0;
        });
    // A newline in a name could forge extra lines, so such names are never signed.
    // eslint-disable-next-line no-control-regex
    if (paths.some(path => /[\0-\x1f]/.test(path))) throw new Error('A file name contains control characters.');
    const lines = [];
    for (const path of paths) lines.push(`${toHex(await subtle.digest('SHA-256', files.get(path)))} ${path}\n`);
    return encodeText(PAYLOAD_HEADER + lines.join(''));
};

const result = (status, extra = {}) => Object.assign({status, keyId: null, reason: ''}, extra);

/**
 * Check whether a plugin was signed by shading.app.
 * @param {{files: Map<string, Uint8Array>}} archive Result of readPluginArchive.
 * @param {object} [keys] Trusted public keys (JWK) by key id. Defaults to the official keys.
 * @returns {Promise<{status: string, keyId: ?string, reason: string}>} status is 'official' (valid signature),
 *     'unsigned' (no signature, or it cannot be checked here) or 'invalid' (signature present but not valid).
 */
const verifyPluginSignature = async (archive, keys = OFFICIAL_KEYS) => {
    const bytes = archive.files.get(SIGNATURE_NAME);
    if (!bytes) return result('unsigned');
    const subtle = getSubtle();
    if (!subtle) return result('unsigned', {reason: 'WebCrypto is not available on this page.'});
    let content;
    try {
        content = JSON.parse(decodeText(bytes));
    } catch (error) {
        return result('invalid', {reason: `${SIGNATURE_NAME} is not valid JSON.`});
    }
    if (!content || content.format !== SIGNATURE_FORMAT || content.version !== 1 ||
        content.algorithm !== 'ECDSA-P256-SHA256' || typeof content.signature !== 'string') {
        return result('invalid', {reason: `${SIGNATURE_NAME} has an unknown format.`});
    }
    const keyId = typeof content.keyId === 'string' ? content.keyId : '';
    if (!Object.prototype.hasOwnProperty.call(keys, keyId)) {
        return result('invalid', {reason: `Signed with an unknown key (${keyId || 'none'}).`});
    }
    try {
        const key = await subtle.importKey('jwk', keys[keyId], {name: 'ECDSA', namedCurve: 'P-256'}, false,
            ['verify']);
        const valid = await subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, decodeBase64(content.signature),
            await signaturePayload(archive.files, subtle));
        return valid ? result('official', {keyId}) :
            result('invalid', {keyId, reason: 'The files were changed after signing.'});
    } catch (error) {
        return result('invalid', {keyId, reason: error.message});
    }
};

export {OFFICIAL_KEYS, SIGNATURE_NAME, signaturePayload, verifyPluginSignature};
