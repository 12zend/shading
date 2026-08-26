const fs = require('fs');
const os = require('os');
const path = require('path');

const {FileStore, isProjectFile} = require('../../../electron/file-store');

describe('Electron file store', () => {
    let directory;
    let store;

    beforeEach(async () => {
        directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shading-file-store-test-'));
        store = new FileStore(directory);
    });

    afterEach(async () => {
        await store.dispose();
        await fs.promises.rm(directory, {force: true, recursive: true});
    });

    test('recognizes project extensions case-insensitively', () => {
        expect(isProjectFile('example.SHADE')).toBe(true);
        expect(isProjectFile('example.sb3')).toBe(true);
        expect(isProjectFile('example.txt')).toBe(false);
    });

    test('writes through a temporary file and reuses a handle', async () => {
        const projectPath = path.join(directory, 'example.shade');
        await fs.promises.writeFile(projectPath, 'before');
        const id = store.register(projectPath);

        await store.beginWrite(id);
        await store.write(id, new Uint8Array([97, 102, 116, 101, 114]));
        await store.close(id);
        expect(await fs.promises.readFile(projectPath, 'utf8')).toBe('after');

        await store.beginWrite(id);
        await store.write(id, Buffer.from('again'));
        await store.close(id);
        expect(await fs.promises.readFile(projectPath, 'utf8')).toBe('again');
    });

    test('reads the current contents through a registered handle', async () => {
        const projectPath = path.join(directory, 'example.shade');
        await fs.promises.writeFile(projectPath, 'current');
        const id = store.register(projectPath);

        const record = await store.readHandle(id);

        expect(record.name).toBe('example.shade');
        expect(record.data.toString()).toBe('current');
    });

    test('cleans up one-shot write sessions', async () => {
        const projectPath = path.join(directory, 'download.bin');

        const id = await store.writeFile(projectPath, new Uint8Array([1, 2, 3]));

        expect(await fs.promises.readFile(projectPath)).toEqual(Buffer.from([1, 2, 3]));
        expect(() => store.get(id)).toThrow('Unknown file handle');
    });
});
