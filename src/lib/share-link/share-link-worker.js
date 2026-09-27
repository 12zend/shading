/* eslint-env worker */
import runShareTask from './share-link-tasks';

const PROGRESS_INTERVAL = 100;

self.onmessage = event => {
    const {id, type, data} = event.data;
    let lastProgress = 0;
    const onProgress = progress => {
        const now = Date.now();
        if (progress.done < progress.total && now - lastProgress < PROGRESS_INTERVAL) return;
        lastProgress = now;
        self.postMessage({id, kind: 'progress', progress});
    };
    runShareTask(type, data, onProgress)
        .then(result => {
            // Decoded files are views into a few large buffers; transfer each buffer once.
            const transfer = type === 'decode' ?
                Array.from(new Set(result.files.map(file => file.data.buffer))) :
                [];
            self.postMessage({id, kind: 'result', result}, transfer);
        })
        .catch(error => {
            self.postMessage({id, kind: 'error', message: (error && error.message) || String(error)});
        });
};
