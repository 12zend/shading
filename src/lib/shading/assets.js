const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
});

const waitForMedia = (element, event, action) => new Promise((resolve, reject) => {
    // Event callbacks and cleanup reference each other.
    /* eslint-disable prefer-const */
    let timeout;
    let ready;
    let failed;
    /* eslint-enable prefer-const */
    const finish = error => {
        clearTimeout(timeout);
        element.removeEventListener(event, ready);
        element.removeEventListener('error', failed);
        if (error) reject(error);
        else resolve();
    };
    timeout = setTimeout(() => finish(new Error('Video loading timed out')), 30000);
    ready = () => finish();
    failed = () => finish(new Error('This video format could not be decoded by the browser'));
    element.addEventListener(event, ready);
    element.addEventListener('error', failed);
    action();
});

class ShadingAssets {
    constructor (runtime) {
        this.runtime = runtime;
        this.items = new Map();
        this.serial = 0;
    }
    list (kind) {
        return Array.from(this.items.values()).filter(item => !kind || item.kind === kind);
    }
    changed () {
        this.runtime.emit('SHADING_ASSETS_CHANGED');
        this.runtime.emitProjectChanged();
        this.runtime.requestRedraw();
    }
    async importFile (file, kind) {
        const extension = file.name.split('.').pop()
            .toLowerCase();
        const allowed = kind === 'font' ? ['ttf', 'otf', 'woff', 'woff2'] : ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
        if (!allowed.includes(extension)) throw new Error(`Unsupported ${kind} file: ${file.name}`);
        const data = await readFile(file);
        let name = file.name.replace(/\.[^.]+$/, '');
        const base = name;
        let suffix = 2;
        const names = new Set(this.list(kind).map(item => item.name));
        while (names.has(name)) name = `${base} ${suffix++}`;
        let id;
        do {
            id = `${kind}:${++this.serial}`;
        } while (this.items.has(id));
        const item = await this.load({id, kind, name, data, format: extension, bytes: file.size});
        this.items.set(id, item);
        this.changed();
        return item;
    }
    async load (record) {
        const item = {...record};
        if (item.kind === 'font') {
            item.family = `ShadingFont_${item.id.replace(/[^a-z0-9]/gi, '_')}`;
            item.face = new FontFace(item.family, `url("${item.data}")`);
            await item.face.load();
            document.fonts.add(item.face);
        } else {
            item.element = document.createElement('video');
            item.element.muted = true;
            item.element.playsInline = true;
            item.element.preload = 'auto';
            await waitForMedia(item.element, 'loadeddata', () => {
                item.element.src = item.data;
            });
            item.width = item.element.videoWidth;
            item.height = item.element.videoHeight;
            item.duration = item.element.duration;
        }
        return item;
    }
    rename (id, value) {
        const item = this.items.get(id);
        if (!item) return '';
        const base = String(value).trim() || item.name;
        const names = new Set(this.list(item.kind).filter(asset => asset.id !== id)
            .map(asset => asset.name));
        let name = base;
        let suffix = 2;
        while (names.has(name)) name = `${base} ${suffix++}`;
        item.name = name;
        this.changed();
        return name;
    }
    trim (id, start, end) {
        const item = this.items.get(id);
        if (!item || item.kind !== 'video') return;
        item.trimStart = Math.min(Math.max(0, Number(start) || 0), Math.max(0, item.duration - (1 / 120)));
        item.trimEnd = Math.max(item.trimStart + (1 / 120), Math.min(Number(end) || item.duration, item.duration));
        this.changed();
    }
    reorder (kind, from, to) {
        const items = this.list(kind);
        if (from < 0 || from >= items.length || to < 0 || to >= items.length) return;
        items.splice(to, 0, items.splice(from, 1)[0]);
        const ordered = this.list().map(item => (item.kind === kind ? items.shift() : item));
        this.items = new Map(ordered.map(item => [item.id, item]));
        this.changed();
    }
    remove (id, notify = true) {
        const item = this.items.get(id);
        if (!item) return;
        if (item.face) document.fonts.delete(item.face);
        if (item.element) {
            item.element.pause();
            item.element.removeAttribute('src');
            item.element.load();
        }
        this.items.delete(id);
        if (notify) this.changed();
    }
    clear () {
        for (const id of this.items.keys()) this.remove(id, false);
    }
    async restore (records = []) {
        // Prepare first so an invalid asset cannot partially replace the current library.
        const loaded = [];
        try {
            for (const record of records) {
                if (!record || !['video', 'font'].includes(record.kind) ||
                    typeof record.id !== 'string' || typeof record.data !== 'string' ||
                    !record.data.startsWith('data:')) throw new Error('Invalid Shading media asset');
                // eslint-disable-next-line no-await-in-loop
                loaded.push(await this.load(record));
            }
        } catch (error) {
            for (const item of loaded) {
                if (item.face) document.fonts.delete(item.face);
                if (item.element) {
                    item.element.removeAttribute('src'); item.element.load();
                }
            }
            throw error;
        }
        this.clear();
        loaded.forEach(item => this.items.set(item.id, item));
        this.runtime.emit('SHADING_ASSETS_CHANGED');
    }
    toJSON () {
        return this.list().map(({id, kind, name, data, format, bytes, trimStart, trimEnd}) =>
            ({id, kind, name, data, format, bytes, trimStart, trimEnd}));
    }
    async prepareFrame (time, ids) {
        await Promise.all(this.list('video').filter(item => ids.has(item.id))
            .map(async item => {
                const video = item.element;
                const start = Math.max(0, Number(item.trimStart) || 0);
                const end = Math.min(video.duration, Number(item.trimEnd) || video.duration);
                const timestamp = Math.max(start, Math.min(start + time, Math.max(start, end - 0.001)));
                if (Math.abs(video.currentTime - timestamp) < 0.00001 && !video.seeking) return;
                await waitForMedia(video, 'seeked', () => {
                    video.currentTime = timestamp;
                });
            }));
    }
}
export default ShadingAssets;
