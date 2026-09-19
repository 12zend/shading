import {canvasToBlob} from './movie-asset-manager-utils';

const releaseCanvas = canvas => {
    canvas.width = 0;
    canvas.height = 0;
};

// Keep full-resolution frames on disk, not in thousands of canvas backing stores.
// Each offline step waits for its write before capturing another frame.
class MovieRenderingFrameStore {
    constructor () {
        this.name = `shading-render-${Date.now()}-${Math.random().toString(36)
            .slice(2)}`;
        this.nextId = 0;
        this.references = 1;
        this.pendingBytes = 0;
        this.database = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('Temporary frame storage is unavailable in this browser.'));
                return;
            }
            const request = indexedDB.open(this.name, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('frames');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        // A failed open is reported by the first frame write.
        this.database.catch(() => {});
        this.onPageHide = () => this.destroy();
        if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
    }

    retain () {
        this.references++;
    }

    release () {
        if (--this.references === 0) this.destroy();
    }

    destroy () {
        if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
        this.database.then(database => {
            database.close();
            indexedDB.deleteDatabase(this.name);
        }, () => {});
    }

    async transaction (mode, operation) {
        const database = await this.database;
        return new Promise((resolve, reject) => {
            const transaction = database.transaction('frames', mode);
            const request = operation(transaction.objectStore('frames'));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error ||
                new Error('Temporary frame storage failed. Check available disk space.'));
            transaction.onerror = () => {}; // onabort reports the failure after rollback.
        });
    }

    capture (canvas) {
        const bytes = canvas.width * canvas.height * 4;
        // Legacy capture commands remain synchronous. Refuse an unbounded queue
        // instead of making a command yield or exhausting the browser's memory.
        if (this.pendingBytes + bytes > 128 * 1024 * 1024) {
            canvas.width = 0;
            canvas.height = 0;
            throw new Error('Too many pending frames. Use timeline rendering to capture this sequence.');
        }
        this.pendingBytes += bytes;
        this.retain();
        const frame = {width: canvas.width, height: canvas.height, id: this.nextId++, store: this};
        frame.ready = (async () => {
            try {
                const blob = await canvasToBlob(canvas);
                // Release the GPU/CPU backing surface before the disk write.
                releaseCanvas(canvas);
                await this.transaction('readwrite', store => store.put(blob, frame.id));
            } finally {
                releaseCanvas(canvas);
                this.pendingBytes -= bytes;
                this.release();
            }
        })();
        // Consumers await ready; don't report unhandled rejections between VM ticks.
        frame.ready.catch(() => {});
        return frame;
    }

    async read (frame) {
        await frame.ready;
        const blob = await this.transaction('readonly', store => store.get(frame.id));
        if (!blob) throw new Error('The temporary rendering frame is no longer available.');
        return blob;
    }
}

const getRenderingFrameBlob = frame => (frame.store ? frame.store.read(frame) : canvasToBlob(frame));

const drawRenderingFrame = async (context, frame, width, height) => {
    if (!frame.store) {
        context.drawImage(frame, 0, 0, width, height);
        return;
    }
    const blob = await getRenderingFrameBlob(frame);
    const bitmap = await createImageBitmap(blob);
    try {
        context.drawImage(bitmap, 0, 0, width, height);
    } finally {
        bitmap.close();
    }
};

// An export may outlive a clear/re-render operation in the editor.
const withRenderingFrames = async (frames, callback) => {
    const stores = new Set(frames.map(frame => frame.store).filter(Boolean));
    stores.forEach(store => store.retain());
    try {
        return await callback();
    } finally {
        stores.forEach(store => store.release());
    }
};

export {MovieRenderingFrameStore, getRenderingFrameBlob, drawRenderingFrame, withRenderingFrames};
