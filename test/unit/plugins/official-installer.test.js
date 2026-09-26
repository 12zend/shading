import JSZip from '@turbowarp/jszip';
import {verifyPluginSignature} from '../../../src/lib/plugins/signature';
import {hashArchive} from '../../../src/lib/plugins/archive';
import {prepareOfficialPlugins, saveOfficialPlugins} from '../../../src/lib/plugins/official-installer';

// Real signatures are covered by plugin-signature.test.js; here only the installer's decision matters.
jest.mock('../../../src/lib/plugins/signature', () => ({
    verifyPluginSignature: jest.fn(async () => ({status: 'official', keyId: 'test', reason: ''}))
}));

const fixture = async () => {
    const zip = new JSZip();
    zip.file('shading-plugin.json', JSON.stringify({format: 'shading.app/plugin', id: 'example'}));
    zip.file('main.js', 'exports.activate = () => {};');
    const bytes = await zip.generateAsync({type: 'uint8array'});
    const entry = {id: 'example', fileName: 'example.zip', hash: await hashArchive(bytes)};
    const fetcher = jest.fn(url => Promise.resolve(url.endsWith('.json') ?
        {ok: true, json: async () => [entry]} : {ok: true, arrayBuffer: async () => bytes.buffer}));
    return {entry, fetcher};
};

test('validates every archive and stores compatible records in one batch', async () => {
    const {fetcher} = await fixture();
    const reviews = await prepareOfficialPlugins(fetcher);
    const storage = {list: async () => [{id: 'example', installedAt: 123}], putAll: jest.fn()};
    await saveOfficialPlugins(storage, reviews);
    expect(storage.putAll).toHaveBeenCalledTimes(1);
    expect(storage.putAll.mock.calls[0][0][0]).toMatchObject({
        id: 'example', enabled: true, installedAt: 123, data: expect.any(ArrayBuffer)
    });
});

test('rejects changed archives before storage', async () => {
    const {entry, fetcher} = await fixture();
    entry.hash = 'wrong';
    await expect(prepareOfficialPlugins(fetcher)).rejects.toThrow('検証に失敗');
});

test('rejects archives without a valid official signature', async () => {
    const {fetcher} = await fixture();
    for (const status of ['unsigned', 'invalid']) {
        verifyPluginSignature.mockResolvedValueOnce({status, keyId: null, reason: ''});
        await expect(prepareOfficialPlugins(fetcher)).rejects.toThrow('署名');
    }
});

test('rejects duplicate ids and invalid paths', async () => {
    const fetcher = async () => ({ok: true, json: async () => [{id: '../outside', fileName: '../outside.zip'}]});
    await expect(prepareOfficialPlugins(fetcher)).rejects.toThrow('不正');
});

test('reports download and persistence failures', async () => {
    await expect(prepareOfficialPlugins(async () => ({ok: false}))).rejects.toThrow('取得');
    const {fetcher} = await fixture();
    const reviews = await prepareOfficialPlugins(fetcher);
    await expect(saveOfficialPlugins({list: async () => [], putAll: async () => {
        throw new Error('quota');
    }}, reviews)).rejects.toThrow('quota');
});

test('reassembles multipart archives before hash verification', async () => {
    const {entry, fetcher} = await fixture();
    const data = new Uint8Array(await (await fetcher('example.zip')).arrayBuffer());
    entry.parts = ['example.zip.part0', 'example.zip.part1'];
    const split = Math.floor(data.length / 2);
    const multipartFetch = async url => {
        if (url.endsWith('.json')) return {ok: true, json: async () => [entry]};
        const bytes = url.endsWith('part0') ? data.slice(0, split) : data.slice(split);
        return {ok: true, arrayBuffer: async () => bytes.buffer};
    };
    const reviews = await prepareOfficialPlugins(multipartFetch);
    expect(reviews[0].archive.hash).toBe(entry.hash);
});
