const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_EXTENSIONS = new Set(['shade', 'mb3', 'sb3', 'sb2', 'sb']);

const createToken = () => crypto.randomBytes(24).toString('hex');

const toBuffer = value => {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError('Expected an ArrayBuffer or typed array');
};

const isProjectFile = filePath => PROJECT_EXTENSIONS.has(
    path.extname(String(filePath || '')).slice(1)
        .toLowerCase()
);

class FileStore {
    constructor (temporaryDirectory = os.tmpdir()) {
        this.temporaryDirectory = temporaryDirectory;
        this.sessions = new Map();
    }

    register (filePath) {
        const targetPath = path.resolve(filePath);
        const id = createToken();
        this.sessions.set(id, {
            id,
            name: path.basename(targetPath),
            stream: null,
            targetPath,
            temporaryDirectory: null,
            temporaryPath: null
        });
        return id;
    }

    get (id) {
        const session = this.sessions.get(id);
        if (!session) throw new Error('Unknown file handle');
        return session;
    }

    async read (filePath) {
        const id = this.register(filePath);
        try {
            const data = await fs.promises.readFile(this.get(id).targetPath);
            return {
                data,
                id,
                name: this.get(id).name
            };
        } catch (error) {
            this.sessions.delete(id);
            throw error;
        }
    }

    async readHandle (id) {
        const session = this.get(id);
        const data = await fs.promises.readFile(session.targetPath);
        return {
            data,
            name: session.name
        };
    }

    async beginWrite (id) {
        const session = this.get(id);
        if (session.stream) throw new Error('A write is already in progress');
        session.temporaryDirectory = await fs.promises.mkdtemp(
            path.join(this.temporaryDirectory, 'shading-save-')
        );
        session.temporaryPath = path.join(session.temporaryDirectory, 'project');
        session.stream = fs.createWriteStream(session.temporaryPath, {flags: 'wx'});
    }

    write (id, value) {
        const session = this.get(id);
        if (!session.stream) throw new Error('The file is not open for writing');
        const data = toBuffer(value);
        return new Promise((resolve, reject) => {
            let settled = false;
            let cleanup = () => {};
            const settle = error => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            };
            const onError = error => settle(error);
            cleanup = () => session.stream.removeListener('error', onError);
            session.stream.once('error', onError);
            try {
                session.stream.write(data, error => settle(error));
            } catch (error) {
                settle(error);
            }
        });
    }

    async close (id) {
        const session = this.get(id);
        if (!session.stream) return;
        const stream = session.stream;
        await new Promise((resolve, reject) => {
            let settled = false;
            let cleanup = () => {};
            const settle = error => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error);
                else resolve();
            };
            const onError = error => settle(error);
            const onFinish = () => settle();
            cleanup = () => {
                stream.removeListener('error', onError);
                stream.removeListener('finish', onFinish);
            };
            stream.once('error', onError);
            stream.once('finish', onFinish);
            stream.end();
        });

        const temporaryPath = session.temporaryPath;
        session.stream = null;
        session.temporaryPath = null;
        session.temporaryDirectory = null;
        try {
            const temporaryFile = await fs.promises.open(temporaryPath, 'r');
            try {
                await temporaryFile.sync();
            } finally {
                await temporaryFile.close();
            }
            await this.replace(temporaryPath, session.targetPath);
        } finally {
            await this.removeTemporaryPath(temporaryPath);
        }
    }

    async abort (id) {
        const session = this.get(id);
        if (session.stream) {
            session.stream.destroy();
            session.stream = null;
        }
        const temporaryDirectory = session.temporaryDirectory;
        session.temporaryPath = null;
        session.temporaryDirectory = null;
        if (temporaryDirectory) {
            await fs.promises.rm(temporaryDirectory, {force: true, recursive: true});
        }
    }

    async replace (source, destination) {
        try {
            await fs.promises.rename(source, destination);
        } catch (error) {
            // Windows cannot rename over an existing file. Keep the temporary file until the
            // replacement succeeds so a failed save never truncates the original project.
            if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'ENOTEMPTY') {
                throw error;
            }
            const backup = `${destination}.${createToken()}.bak`;
            await fs.promises.rename(destination, backup);
            try {
                await fs.promises.rename(source, destination);
            } catch (replacementError) {
                await fs.promises.rename(backup, destination);
                throw replacementError;
            }
            await fs.promises.rm(backup, {force: true});
        }
    }

    async removeTemporaryPath (temporaryPath) {
        if (!temporaryPath) return;
        await fs.promises.rm(temporaryPath, {force: true});
        await fs.promises.rm(path.dirname(temporaryPath), {force: true, recursive: true});
    }

    async writeFile (filePath, value) {
        const id = this.register(filePath);
        try {
            await this.beginWrite(id);
            await this.write(id, value);
            await this.close(id);
        } catch (error) {
            await this.abort(id);
            throw error;
        } finally {
            this.sessions.delete(id);
        }
        return id;
    }

    async dispose () {
        await Promise.all(Array.from(this.sessions.keys()).map(async id => {
            try {
                await this.abort(id);
            } catch (error) {
                // Best effort cleanup during application shutdown.
            }
        }));
        this.sessions.clear();
    }
}

module.exports = {
    FileStore,
    PROJECT_EXTENSIONS,
    isProjectFile,
    toBuffer
};
