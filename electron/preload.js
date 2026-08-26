const {contextBridge, ipcRenderer} = require('electron');

const createAbortError = () => {
    const error = new Error('The file dialog was canceled');
    error.name = 'AbortError';
    return error;
};

const toArrayBuffer = value => {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    throw new TypeError('Expected an ArrayBuffer or typed array');
};

const createFileHandle = record => {
    const handleId = record.handleId || record.id;
    if (!handleId) throw new Error('Missing file handle ID');
    const createFile = fileRecord => new File([
        fileRecord.data
    ], fileRecord.name, {
        type: 'application/octet-stream'
    });
    const getFile = async () => {
        if (Object.prototype.hasOwnProperty.call(record, 'data')) return createFile(record);
        const current = await ipcRenderer.invoke('desktop:file-read', handleId);
        return createFile(current);
    };
    return {
        kind: 'file',
        name: record.name,
        async createWritable () {
            await ipcRenderer.invoke('desktop:file-begin-write', handleId);
            let closed = false;
            return {
                async abort () {
                    if (closed) return;
                    closed = true;
                    await ipcRenderer.invoke('desktop:file-abort', handleId);
                },
                async close () {
                    if (closed) return;
                    closed = true;
                    await ipcRenderer.invoke('desktop:file-close', handleId);
                },
                async write (value) {
                    if (closed) throw new Error('The writable file has been closed');
                    let data = value;
                    if (value instanceof Blob) data = await value.arrayBuffer();
                    await ipcRenderer.invoke('desktop:file-write', handleId, toArrayBuffer(data));
                }
            };
        },
        getFile () {
            return getFile();
        }
    };
};

const openFileRecord = record => ({
    file: new File([record.data], record.name, {
        type: 'application/octet-stream'
    }),
    handle: createFileHandle(record)
});

const pendingOpenFiles = [];
let openFileListener = null;

const deliverOpenFile = record => {
    if (!openFileListener) {
        pendingOpenFiles.push(record);
        return;
    }
    try {
        openFileListener(openFileRecord(record));
    } catch (error) {
        // A renderer callback must not interrupt subsequent file-open events.
        console.error('Could not deliver an opened file:', error);
    }
};

ipcRenderer.on('desktop:open-file', (_event, record) => deliverOpenFile(record));

const onOpenFile = callback => {
    openFileListener = callback;
    const files = pendingOpenFiles.splice(0);
    files.forEach(record => deliverOpenFile(record));
    return () => {
        if (openFileListener === callback) openFileListener = null;
    };
};

const onSaveRequest = callback => {
    const listener = (_event, requestId) => {
        let result;
        try {
            result = callback();
        } catch (error) {
            ipcRenderer.send('desktop:save-result', requestId, false);
            return;
        }
        Promise.resolve(result)
            .then(() => ipcRenderer.send('desktop:save-result', requestId, true))
            .catch(() => ipcRenderer.send('desktop:save-result', requestId, false));
    };
    ipcRenderer.on('desktop:save-request', listener);
    return () => ipcRenderer.removeListener('desktop:save-request', listener);
};

const showOpenFilePicker = async () => {
    const record = await ipcRenderer.invoke('desktop:open-file');
    if (!record) throw createAbortError();
    return [createFileHandle(record)];
};

const showSaveFilePicker = async options => {
    const record = await ipcRenderer.invoke('desktop:save-file', options || {});
    if (!record) throw createAbortError();
    return createFileHandle(record);
};

const saveBlob = async (filename, blob) => {
    const data = blob instanceof Blob ? await blob.arrayBuffer() : toArrayBuffer(blob);
    return ipcRenderer.invoke('desktop:save-blob', {
        data,
        filename: String(filename || 'download')
    });
};

contextBridge.exposeInMainWorld('shadingDesktop', {
    isDesktop: true,
    newWindow: () => ipcRenderer.invoke('desktop:new-window'),
    onOpenFile,
    onSaveRequest,
    saveBlob,
    setDirty: dirty => ipcRenderer.send('desktop:set-dirty', Boolean(dirty)),
    showAbout: () => ipcRenderer.invoke('desktop:about'),
    showOpenFilePicker,
    showSaveFilePicker
});
