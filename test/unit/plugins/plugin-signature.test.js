/* global Buffer */
import {createPrivateKey, generateKeyPairSync, sign} from 'crypto';
import JSZip from '@turbowarp/jszip';
import {readPluginArchive} from '../../../src/lib/plugins/archive';
import {SIGNATURE_NAME, signaturePayload, verifyPluginSignature} from '../../../src/lib/plugins/signature';

// Signatures are made in Node by shading-plugins/scripts/sign.mjs and checked in the browser with WebCrypto;
// these tests sign the same way (P1363 ECDSA over the payload) and verify through a real zip.

const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve: 'P-256'});
const {kty, crv, x, y} = publicKey.export({format: 'jwk'});
const KEYS = {'test-key': {kty, crv, x, y}};

const baseFiles = () => new Map([
    ['shading-plugin.json', JSON.stringify({format: 'shading.app/plugin', id: 'example'})],
    ['main.js', 'exports.activate = () => {};'],
    ['lib/util.js', 'module.exports = 1;']
].map(([path, text]) => [path, new Uint8Array(Buffer.from(text))]));

const signFiles = async (files, key = privateKey, keyId = 'test-key') => {
    const payload = await signaturePayload(files, crypto.subtle);
    const signature = sign('sha256', payload, {key, dsaEncoding: 'ieee-p1363'}).toString('base64');
    return new Uint8Array(Buffer.from(JSON.stringify({
        format: 'shading.app/plugin-signature', version: 1, keyId, algorithm: 'ECDSA-P256-SHA256', signature
    })));
};

const zipArchive = async (files, folder = '') => {
    const zip = new JSZip();
    for (const [path, bytes] of files) zip.file(`${folder}${path}`, bytes);
    return readPluginArchive(await zip.generateAsync({type: 'uint8array'}), 'example.zip');
};

test('a signed plugin verifies whether it is zipped with or without its folder', async () => {
    const files = baseFiles();
    files.set(SIGNATURE_NAME, await signFiles(files));
    for (const folder of ['', 'example/']) {
        const result = await verifyPluginSignature(await zipArchive(files, folder), KEYS);
        expect(result).toEqual({status: 'official', keyId: 'test-key', reason: ''});
    }
});

test('a plugin without a signature is unsigned', async () => {
    expect((await verifyPluginSignature(await zipArchive(baseFiles()), KEYS)).status).toBe('unsigned');
});

test('changed, added and removed files break the signature', async () => {
    const signed = baseFiles();
    signed.set(SIGNATURE_NAME, await signFiles(signed));
    const changes = [
        files => files.set('main.js', new Uint8Array(Buffer.from('exports.activate = () => { steal(); };'))),
        files => files.set('lib/extra.js', new Uint8Array(Buffer.from('steal();'))),
        files => files.delete('lib/util.js')
    ];
    for (const change of changes) {
        const files = new Map(signed);
        change(files);
        expect(await verifyPluginSignature(await zipArchive(files), KEYS)).toMatchObject({status: 'invalid'});
    }
});

test('signatures from unknown or untrusted keys are invalid', async () => {
    const files = baseFiles();
    files.set(SIGNATURE_NAME, await signFiles(files, privateKey, 'someone-else'));
    expect(await verifyPluginSignature(await zipArchive(files), KEYS))
        .toMatchObject({status: 'invalid', reason: expect.stringContaining('unknown key')});

    // A different key claiming a trusted key id.
    const other = createPrivateKey(generateKeyPairSync('ec', {namedCurve: 'P-256'}).privateKey
        .export({type: 'pkcs8', format: 'pem'}));
    files.set(SIGNATURE_NAME, await signFiles(baseFiles(), other));
    expect((await verifyPluginSignature(await zipArchive(files), KEYS)).status).toBe('invalid');

    // Only built-in keys are trusted by default.
    files.set(SIGNATURE_NAME, await signFiles(baseFiles()));
    expect((await verifyPluginSignature(await zipArchive(files))).status).toBe('invalid');
});

test('a malformed signature file is invalid', async () => {
    const files = baseFiles();
    files.set(SIGNATURE_NAME, new Uint8Array(Buffer.from('not json')));
    expect((await verifyPluginSignature(await zipArchive(files), KEYS)).status).toBe('invalid');
    files.set(SIGNATURE_NAME, new Uint8Array(Buffer.from(JSON.stringify({format: 'other'}))));
    expect((await verifyPluginSignature(await zipArchive(files), KEYS)).status).toBe('invalid');
});

test('the payload lists every file except the signature, sorted by path', async () => {
    const files = baseFiles();
    files.set(SIGNATURE_NAME, new Uint8Array(1));
    const text = Buffer.from(await signaturePayload(files, crypto.subtle)).toString('utf8');
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('shading.app/plugin-signature/1');
    expect(lines.slice(1).map(line => line.split(' ')[1])).toEqual(['lib/util.js', 'main.js', 'shading-plugin.json']);
    files.set('evil\nname.js', new Uint8Array(1));
    await expect(signaturePayload(files, crypto.subtle)).rejects.toThrow('control characters');
});
