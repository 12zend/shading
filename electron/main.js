const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    shell
} = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {fileURLToPath} = require('url');
const {spawn} = require('child_process');

const {FileStore, isProjectFile} = require('./file-store');
const {configureGraphicsBackend} = require('./graphics');

const ROOT_DIRECTORY = path.resolve(__dirname, '..');
const BUILD_DIRECTORY = path.join(ROOT_DIRECTORY, 'build');
const DESKTOP_PORT = Number(process.env.SHADING_DESKTOP_PORT) || 8602;
const DEV_MODE = process.argv.includes('--dev');
const PROJECT_EXTENSIONS = ['shade', 'mb3', 'sb3', 'sb2', 'sb'];
const fileStore = new FileStore();
const windows = new Set();
const windowStates = new Map();
const pendingFiles = new WeakMap();
const pendingSaveRequests = new Map();

let appOrigin = null;
let localServer = null;
let devServerProcess = null;
let nextSaveRequestId = 1;
let mainWindow = null;
const filesOpenedBeforeReady = [];

const MIME_TYPES = {
    '.css': 'text/css; charset=UTF-8',
    '.eot': 'application/vnd.ms-fontobject',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=UTF-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

const getExtension = filename => path.extname(String(filename || ''))
    .slice(1)
    .toLowerCase();

const arrayBufferFromBuffer = buffer => buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
);

const getNpmCommand = () => {
    if (process.env.npm_execpath) {
        return {
            args: [process.env.npm_execpath, 'run', 'start'],
            // process.execPath points to Electron in the main process. npm
            // provides the actual Node executable separately when this app
            // was launched through an npm script.
            command: process.env.npm_node_execpath || process.env.NODE || 'node'
        };
    }
    return {
        args: ['run', 'start'],
        command: process.platform === 'win32' ? 'npm.cmd' : 'npm'
    };
};

const waitForDevServer = origin => new Promise((resolve, reject) => {
    const deadline = Date.now() + 120000;
    const attempt = () => {
        const retry = () => {
            if (Date.now() >= deadline) {
                reject(new Error('webpack-dev-server did not start within 120 seconds'));
                return;
            }
            setTimeout(attempt, 250);
        };
        const request = http.get(`${origin}/`, response => {
            response.resume();
            if (response.statusCode && response.statusCode < 500) {
                resolve();
                return;
            }
            retry();
        });
        request.on('error', retry);
    };
    attempt();
});

const startDevServer = async () => {
    const origin = `http://127.0.0.1:${DESKTOP_PORT}`;
    const npm = getNpmCommand();
    devServerProcess = spawn(npm.command, npm.args, {
        cwd: ROOT_DIRECTORY,
        env: Object.assign({}, process.env, {
            HOST: '127.0.0.1',
            PORT: String(DESKTOP_PORT)
        }),
        stdio: 'inherit'
    });
    devServerProcess.on('error', error => {
        // Keep the original error visible in the terminal. The wait below also
        // gives the user a useful startup failure instead of a blank window.
        console.error('Could not start webpack-dev-server:', error);
    });
    await waitForDevServer(origin);
    return origin;
};

const serveBuild = () => http.createServer((request, response) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch (error) {
        response.writeHead(400);
        response.end('Bad request');
        return;
    }

    const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const resolvedPath = path.resolve(BUILD_DIRECTORY, requestedPath);
    const isInsideBuild = resolvedPath === BUILD_DIRECTORY ||
        resolvedPath.startsWith(`${BUILD_DIRECTORY}${path.sep}`);
    if (!isInsideBuild) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    const sendFile = filePath => {
        fs.stat(filePath, (statError, stats) => {
            if (statError || !stats.isFile()) {
                response.writeHead(404);
                response.end('Not found');
                return;
            }
            response.writeHead(200, {
                'Cache-Control': 'no-cache',
                'Content-Length': stats.size,
                'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ||
                    'application/octet-stream'
            });
            fs.createReadStream(filePath)
                .on('error', () => response.destroy())
                .pipe(response);
        });
    };

    fs.stat(resolvedPath, (error, stats) => {
        if (!error && stats.isFile()) {
            sendFile(resolvedPath);
            return;
        }
        // Team routes and the other client-side routes do not have a physical
        // file. They all use the editor entry point.
        if (!path.extname(requestedPath)) {
            sendFile(path.join(BUILD_DIRECTORY, 'index.html'));
            return;
        }
        response.writeHead(404);
        response.end('Not found');
    });
});

const startStaticServer = () => new Promise((resolve, reject) => {
    if (!fs.existsSync(BUILD_DIRECTORY)) {
        reject(new Error('The build directory is missing. Run npm run build:desktop first.'));
        return;
    }
    const server = serveBuild();
    server.once('error', reject);
    server.once('listening', () => resolve(server));
    server.listen(DESKTOP_PORT, '127.0.0.1');
});

const startLocalOrigin = async () => {
    if (DEV_MODE) return startDevServer();
    localServer = await startStaticServer();
    return `http://127.0.0.1:${DESKTOP_PORT}`;
};

const isKnownWindow = window => window && windows.has(window);

const getWindowForEvent = event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!isKnownWindow(window)) throw new Error('Unknown renderer');
    return window;
};

const projectFilters = [
    {
        extensions: PROJECT_EXTENSIONS,
        name: 'Shading and Scratch projects'
    }
];

const getSaveFilters = options => {
    const suggestedName = options && typeof options.suggestedName === 'string' ? options.suggestedName : '';
    const extension = getExtension(suggestedName);
    if (extension) {
        return [{extensions: [extension], name: 'Project'}];
    }
    return projectFilters;
};

const addSuggestedExtension = (filePath, options) => {
    if (path.extname(filePath)) return filePath;
    const suggestedName = options && options.suggestedName;
    const extension = getExtension(suggestedName);
    return extension ? `${filePath}.${extension}` : filePath;
};

const readProjectRecord = async filePath => {
    if (!isProjectFile(filePath)) throw new Error('Unsupported project file');
    const record = await fileStore.read(filePath);
    return {
        data: arrayBufferFromBuffer(record.data),
        handleId: record.id,
        name: record.name
    };
};

const sendProjectFile = async (window, filePath) => {
    try {
        const record = await readProjectRecord(filePath);
        window.webContents.send('desktop:open-file', record);
    } catch (error) {
        await dialog.showMessageBox(window, {
            buttons: ['OK'],
            message: `Could not open ${path.basename(filePath)}.`,
            detail: error.message,
            title: 'Shading',
            type: 'error'
        });
    }
};

const flushPendingFiles = window => {
    const files = pendingFiles.get(window) || [];
    pendingFiles.delete(window);
    files.forEach(filePath => sendProjectFile(window, filePath));
};

const queueProjectFile = (window, filePath) => {
    if (!isProjectFile(filePath)) return;
    if (window.webContents.isLoading() || !window.webContents.getURL()) {
        const files = pendingFiles.get(window) || [];
        files.push(filePath);
        pendingFiles.set(window, files);
        return;
    }
    sendProjectFile(window, filePath);
};

const focusWindow = window => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
};

const openProjectPath = filePath => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const window = isKnownWindow(focusedWindow) ? focusedWindow : mainWindow;
    if (window && !window.isDestroyed()) {
        focusWindow(window);
        queueProjectFile(window, filePath);
    } else {
        filesOpenedBeforeReady.push(filePath);
    }
};

const externalURL = url => {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
    } catch (error) {
        return false;
    }
};

const isAppURL = url => {
    try {
        return new URL(url).origin === appOrigin;
    } catch (error) {
        return false;
    }
};

const getWebPreferences = () => ({
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(__dirname, 'preload.js'),
    sandbox: true
});

const setUpWindowContents = window => {
    window.webContents.setWindowOpenHandler(({url}) => {
        if (isAppURL(url)) return {action: 'allow'};
        if (externalURL(url)) shell.openExternal(url);
        return {action: 'deny'};
    });
    window.webContents.on('will-navigate', (event, url) => {
        if (!isAppURL(url)) {
            event.preventDefault();
            if (externalURL(url)) shell.openExternal(url);
        }
    });
    window.webContents.on('did-create-window', childWindow => {
        setUpWindowContents(childWindow);
    });
};

const requestRendererSave = window => new Promise(resolve => {
    const requestId = String(nextSaveRequestId++);
    const timeout = setTimeout(() => {
        pendingSaveRequests.delete(requestId);
        resolve(false);
    }, 15000);
    pendingSaveRequests.set(requestId, {
        resolve: success => {
            clearTimeout(timeout);
            pendingSaveRequests.delete(requestId);
            resolve(success);
        },
        window
    });
    window.webContents.send('desktop:save-request', requestId);
});

const waitForCleanProject = window => new Promise(resolve => {
    const deadline = Date.now() + 15000;
    const check = () => {
        const state = windowStates.get(window);
        if (!state || !state.dirty) {
            resolve(true);
            return;
        }
        if (Date.now() >= deadline) {
            resolve(false);
            return;
        }
        setTimeout(check, 100);
    };
    check();
});

const closeWindowAfterSave = window => {
    const state = windowStates.get(window);
    if (!state) return;
    state.allowClose = true;
    state.dirty = false;
    window.destroy();
};

const requestWindowClose = async window => {
    const state = windowStates.get(window);
    if (!state || state.closePromptOpen) return;
    state.closePromptOpen = true;
    const japanese = app.getLocale().toLowerCase()
        .startsWith('ja');
    const result = await dialog.showMessageBox(window, japanese ? {
        buttons: ['保存', '保存せずに閉じる', 'キャンセル'],
        cancelId: 2,
        defaultId: 0,
        message: '変更を保存しますか？',
        title: 'Shading',
        type: 'question'
    } : {
        buttons: ['Save', "Don't Save", 'Cancel'],
        cancelId: 2,
        defaultId: 0,
        message: 'Save changes to this project before closing?',
        title: 'Shading',
        type: 'question'
    });

    if (result.response === 0) {
        const requested = await requestRendererSave(window);
        if (requested && await waitForCleanProject(window)) {
            closeWindowAfterSave(window);
            return;
        }
    } else if (result.response === 1) {
        closeWindowAfterSave(window);
        return;
    }
    state.closePromptOpen = false;
};

const createWindow = async initialFilePath => {
    const window = new BrowserWindow({
        backgroundColor: '#2f2f2f',
        height: 900,
        minHeight: 640,
        minWidth: 1024,
        show: false,
        title: 'Shading',
        webPreferences: getWebPreferences(),
        width: 1440
    });
    windows.add(window);
    windowStates.set(window, {
        allowClose: false,
        closePromptOpen: false,
        dirty: false
    });
    if (!mainWindow) mainWindow = window;
    setUpWindowContents(window);
    window.once('ready-to-show', () => window.show());
    window.webContents.on('did-finish-load', () => flushPendingFiles(window));
    window.on('close', event => {
        const state = windowStates.get(window);
        if (!state || state.allowClose || !state.dirty) return;
        event.preventDefault();
        requestWindowClose(window);
    });
    window.on('closed', () => {
        windows.delete(window);
        windowStates.delete(window);
        pendingFiles.delete(window);
        if (mainWindow === window) mainWindow = Array.from(windows)[0] || null;
    });

    if (initialFilePath) {
        const files = pendingFiles.get(window) || [];
        files.push(initialFilePath);
        pendingFiles.set(window, files);
    }
    await window.loadURL(`${appOrigin}/`);
    return window;
};

const handleOpenFileDialog = async event => {
    const window = getWindowForEvent(event);
    const result = await dialog.showOpenDialog(window, {
        filters: projectFilters,
        properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return readProjectRecord(result.filePaths[0]);
};

const handleSaveFileDialog = async (event, options = {}) => {
    const window = getWindowForEvent(event);
    const result = await dialog.showSaveDialog(window, {
        defaultPath: typeof options.suggestedName === 'string' ? options.suggestedName : 'Project.shade',
        filters: getSaveFilters(options),
        properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (result.canceled || !result.filePath) return null;
    const filePath = addSuggestedExtension(result.filePath, options);
    const id = fileStore.register(filePath);
    return {handleId: id, name: path.basename(filePath)};
};

const assertRecord = (event, id) => {
    getWindowForEvent(event);
    return fileStore.get(id);
};

const registerIpcHandlers = () => {
    ipcMain.handle('desktop:open-file', handleOpenFileDialog);
    ipcMain.handle('desktop:save-file', handleSaveFileDialog);
    ipcMain.handle('desktop:file-begin-write', (event, id) => {
        assertRecord(event, id);
        return fileStore.beginWrite(id);
    });
    ipcMain.handle('desktop:file-read', async (event, id) => {
        const record = assertRecord(event, id);
        const file = await fileStore.readHandle(record.id);
        return {
            data: arrayBufferFromBuffer(file.data),
            name: file.name
        };
    });
    ipcMain.handle('desktop:file-write', (event, id, data) => {
        assertRecord(event, id);
        return fileStore.write(id, data);
    });
    ipcMain.handle('desktop:file-close', (event, id) => {
        assertRecord(event, id);
        return fileStore.close(id);
    });
    ipcMain.handle('desktop:file-abort', (event, id) => {
        assertRecord(event, id);
        return fileStore.abort(id);
    });
    ipcMain.handle('desktop:save-blob', async (event, payload = {}) => {
        const window = getWindowForEvent(event);
        const filename = typeof payload.filename === 'string' && payload.filename ? payload.filename : 'download';
        const result = await dialog.showSaveDialog(window, {
            defaultPath: filename,
            filters: [{
                extensions: [getExtension(filename) || '*'],
                name: 'File'
            }],
            properties: ['createDirectory', 'showOverwriteConfirmation']
        });
        if (result.canceled || !result.filePath) return false;
        await fileStore.writeFile(result.filePath, payload.data);
        return true;
    });
    ipcMain.handle('desktop:new-window', async event => {
        getWindowForEvent(event);
        await createWindow();
    });
    ipcMain.handle('desktop:about', async event => {
        const window = getWindowForEvent(event);
        await dialog.showMessageBox(window, {
            buttons: ['OK'],
            detail: 'A collaborative block-based editor for animation and video.',
            message: 'Shading',
            title: 'About Shading',
            type: 'info'
        });
    });
    ipcMain.on('desktop:set-dirty', (event, dirty) => {
        const window = getWindowForEvent(event);
        const state = windowStates.get(window);
        if (state) state.dirty = Boolean(dirty);
    });
    ipcMain.on('desktop:save-result', (event, requestId, success) => {
        const request = pendingSaveRequests.get(String(requestId));
        if (!request || BrowserWindow.fromWebContents(event.sender) !== request.window) return;
        request.resolve(Boolean(success));
    });
};

const convertCommandLinePath = value => {
    if (typeof value !== 'string' || value.startsWith('-')) return null;
    let filePath = value;
    if (filePath.startsWith('file://')) {
        try {
            filePath = fileURLToPath(filePath);
        } catch (error) {
            return null;
        }
    }
    return isProjectFile(filePath) ? path.resolve(filePath) : null;
};

const registerApplicationEvents = () => {
    app.on('open-file', (event, filePath) => {
        event.preventDefault();
        const projectPath = convertCommandLinePath(filePath);
        if (projectPath) openProjectPath(projectPath);
    });
    app.on('second-instance', (event, commandLine) => {
        focusWindow(mainWindow);
        commandLine.map(convertCommandLinePath)
            .filter(Boolean)
            .forEach(openProjectPath);
    });
    app.on('activate', () => {
        if (windows.size) {
            focusWindow(mainWindow);
        } else {
            createWindow().catch(error => console.error(error));
        }
    });
    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
    app.on('will-quit', () => {
        fileStore.dispose();
        if (devServerProcess && !devServerProcess.killed) devServerProcess.kill();
        if (localServer) localServer.close();
    });
};

const start = async () => {
    appOrigin = await startLocalOrigin();
    const initialFilePath = filesOpenedBeforeReady.shift();
    await createWindow(initialFilePath);
    filesOpenedBeforeReady.forEach(openProjectPath);
    filesOpenedBeforeReady.length = 0;
};

const startApplication = () => {
    // This must run before app.ready so Chromium can select ANGLE's Metal
    // backend for every WebGL consumer in the renderer process.
    configureGraphicsBackend(app.commandLine);
    const hasSingleInstance = app.requestSingleInstanceLock();
    if (hasSingleInstance) {
        registerIpcHandlers();
        registerApplicationEvents();
        process.argv.slice(1)
            .map(convertCommandLinePath)
            .filter(Boolean)
            .forEach(filePath => filesOpenedBeforeReady.push(filePath));
        app.whenReady()
            .then(start)
            .catch(error => {
                console.error(error);
                dialog.showErrorBox('Shading could not start', error.message);
                app.quit();
            });
    } else {
        app.quit();
    }
};

if (require.main === module) startApplication();

module.exports = {
    addSuggestedExtension,
    convertCommandLinePath,
    getExtension,
    isProjectFile,
    startApplication
};
