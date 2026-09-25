import {readPluginArchive} from './archive';
import {scanPlugin} from './security-scan';

const prepareOfficialPlugins = async (fetcher, onProgress = () => {}) => {
    const response = await fetcher('/official-plugins/catalog.json', {cache: 'no-store'});
    if (!response.ok) throw new Error('プラグイン一覧を取得できませんでした。');
    const catalog = await response.json();
    if (!Array.isArray(catalog) || !catalog.length) throw new Error('プラグイン一覧が空です。');
    const reviews = [];
    const ids = new Set();
    for (const entry of catalog) {
        if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(entry.id) || ids.has(entry.id) ||
            entry.fileName !== `${entry.id}.zip`) throw new Error('プラグイン一覧が不正です。');
        ids.add(entry.id);
        onProgress(`${reviews.length + 1} / ${catalog.length}：${entry.name || entry.id} を検証中…`);
        const parts = entry.parts || [entry.fileName];
        if (!Array.isArray(parts) || !parts.length || parts.length > 13 || parts.some((part, index) =>
            part !== (entry.parts ? `${entry.fileName}.part${index}` : entry.fileName))) {
            throw new Error('プラグイン一覧が不正です。');
        }
        const buffers = [];
        let length = 0;
        for (const part of parts) {
            const download = await fetcher(`/official-plugins/${part}`, {cache: 'no-store'});
            if (!download.ok) throw new Error(`${entry.id} を取得できませんでした。`);
            const bytes = new Uint8Array(await download.arrayBuffer());
            length += bytes.length;
            if (length > 256 * 1024 * 1024) throw new Error('プラグインが大きすぎます。');
            buffers.push(bytes);
        }
        const combined = new Uint8Array(length);
        let offset = 0;
        for (const bytes of buffers) {
            combined.set(bytes, offset);
            offset += bytes.length;
        }
        const archive = await readPluginArchive(combined, entry.fileName);
        if (archive.manifest.id !== entry.id || archive.hash !== entry.hash) {
            throw new Error(`${entry.id} の検証に失敗しました。ページを再読み込みしてください。`);
        }
        reviews.push({archive, scan: scanPlugin(archive)});
    }
    return reviews;
};

const saveOfficialPlugins = async (storage, reviews) => {
    const previous = new Map((await storage.list()).map(record => [record.id, record]));
    await storage.putAll(reviews.map(({archive, scan}) => ({
        id: archive.manifest.id,
        data: archive.bytes.slice().buffer,
        hash: archive.hash,
        fileName: archive.fileName,
        enabled: true,
        installedAt: (previous.get(archive.manifest.id) || {}).installedAt || Date.now(),
        scan: {level: scan.level, summary: scan.summary, undeclaredPermissions: scan.undeclaredPermissions}
    })));
};

export {prepareOfficialPlugins, saveOfficialPlugins};
