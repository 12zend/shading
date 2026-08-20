jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import VM from 'scratch-vm';

import {CollaborationManager} from '../../../src/lib/collaboration-manager';

const textBytes = value => new TextEncoder().encode(value);

const projectJSON = blockValue => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: blockValue ? {
            block: {
                opcode: 'looks_say',
                next: null,
                parent: null,
                inputs: {MESSAGE: [1, [10, blockValue]]},
                fields: {},
                shadow: false,
                topLevel: true,
                x: 10,
                y: 20
            }
        } : {},
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

describe('collaboration manager project flow', () => {
    test('shares a whole project update instead of a Blockly operation', () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.projectLoadInProgress = false;
        manager.scheduleProjectSync = jest.fn();
        manager.send = jest.fn();
        manager.ScratchBlocks = {Xml: {domToText: jest.fn(() => '<block />')}};
        manager.state = {me: {role: 'member'}, status: 'connected', synchronizing: false};
        manager.vm = {
            editingTarget: {id: 'sprite', isOriginal: true, isStage: false},
            runtime: {targets: []}
        };

        manager.handleWorkspaceEvent({
            blockId: 'block',
            recordUndo: true,
            toJson: () => ({blockId: 'block', ids: ['block'], type: 'create', xml: '<block />'}),
            type: 'create'
        });

        expect(manager.scheduleProjectSync).toHaveBeenCalledTimes(1);
        expect(manager.send).not.toHaveBeenCalled();
    });

    test('sends project.json and only assets absent from the accepted revision', async () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.destroyed = false;
        manager.pendingProjectUpdate = null;
        manager.projectAssetNames = new Set(['old.png']);
        manager.projectLoadInProgress = false;
        manager.projectRevision = 4;
        manager.projectSyncRequestPending = false;
        manager.projectUpdateQueued = true;
        manager.send = jest.fn(() => true);
        manager.state = {me: {role: 'member'}, status: 'connected', synchronizing: false};
        manager.vm = {saveProjectSb3DontZip: () => ({
            'new.wav': new Uint8Array([4, 5, 6]),
            'old.png': new Uint8Array([1, 2, 3]),
            'project.json': textBytes('{"projectVersion":3,"targets":[]}')
        })};

        manager.sendProjectUpdate();
        await manager.snapshotPromise;

        expect(manager.send).toHaveBeenCalledWith(expect.objectContaining({
            assets: {'new.wav': 'BAUG'},
            assetNames: ['new.wav', 'old.png'],
            baseRevision: 4,
            project: expect.objectContaining({data: expect.any(String)}),
            type: 'project_update'
        }));
    });

    test('accepts a revision and retains its asset manifest for the next delta', () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.pendingProjectUpdate = {assetNames: ['a.svg', 'b.wav'], requestId: 'request'};
        manager.projectSyncRequestPending = true;
        manager.projectUpdateQueued = false;

        manager.acceptProjectUpdate({requestId: 'request', revision: 9});

        expect(manager.projectRevision).toBe(9);
        expect(Array.from(manager.projectAssetNames)).toEqual(['a.svg', 'b.wav']);
        expect(manager.projectSyncRequestPending).toBe(false);
    });

    test('coalesces project changes before capturing files', () => {
        jest.useFakeTimers();
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.destroyed = false;
        manager.projectLoadInProgress = false;
        manager.projectSyncRequestPending = false;
        manager.projectUpdateQueued = false;
        manager.sendProjectUpdate = jest.fn();
        manager.state = {me: {role: 'member'}, synchronizing: false};

        manager.handleProjectChanged();
        manager.handleProjectChanged();
        jest.runAllTimers();

        expect(manager.sendProjectUpdate).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    test('waits for the initial VM project before connecting to a room', async () => {
        const OriginalWebSocket = global.WebSocket;
        const originalHistory = global.history;
        const originalLocalStorage = global.localStorage;
        const originalLocation = global.location;
        const originalSessionStorage = global.sessionStorage;
        const sockets = [];
        const makeStorage = () => {
            const values = new Map();
            return {
                getItem: key => (values.has(key) ? values.get(key) : null),
                removeItem: key => values.delete(key),
                setItem: (key, value) => values.set(key, String(value))
            };
        };
        class FakeWebSocket {
            constructor (url) {
                this.url = url;
                this.readyState = FakeWebSocket.CONNECTING;
                this.listeners = {};
                sockets.push(this);
            }

            addEventListener (type, listener) {
                this.listeners[type] = listener;
            }

            close () {}
        }
        FakeWebSocket.CONNECTING = 0;
        FakeWebSocket.OPEN = 1;
        global.WebSocket = FakeWebSocket;
        global.history = {replaceState: jest.fn()};
        global.localStorage = makeStorage();
        global.location = {
            hash: '',
            host: 'localhost:8601',
            origin: 'http://localhost:8601',
            pathname: '/initial-project-team',
            protocol: 'http:',
            search: ''
        };
        global.sessionStorage = makeStorage();

        try {
            const vm = new VM();
            const manager = new CollaborationManager(vm, {teamId: 'initial-project-team'});
            expect(sockets).toHaveLength(0);

            await vm.loadProject(JSON.stringify(projectJSON('initial')));

            expect(sockets).toHaveLength(1);
            expect(sockets[0].url).toContain('/api/teams/initial-project-team/websocket');
            manager.destroy();
        } finally {
            /* eslint-disable require-atomic-updates */
            global.WebSocket = OriginalWebSocket;
            global.history = originalHistory;
            global.localStorage = originalLocalStorage;
            global.location = originalLocation;
            global.sessionStorage = originalSessionStorage;
            /* eslint-enable require-atomic-updates */
        }
    });

    test('loads an invited project bundle into the receiving VM', async () => {
        const vm = new VM();
        await vm.loadProject(JSON.stringify(projectJSON(null)));
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.emit = jest.fn();
        manager.incomingProjects = new Map();
        manager.movieAssetManager = {
            getTimelineSettings: jest.fn(() => ({duration: 10, framerate: 30, height: 360, width: 480}))
        };
        manager.projectAssetNames = new Set();
        manager.projectLoadInProgress = false;
        manager.projectUpdateQueued = false;
        manager.send = jest.fn(() => true);
        manager.state = {synchronizing: true};
        manager.updateState = jest.fn(changes => {
            manager.state = Object.assign({}, manager.state, changes);
        });
        manager.vm = vm;
        const incoming = {
            assetNames: [],
            chunks: new Map(),
            projectChunks: [JSON.stringify(projectJSON('invited project'))],
            projectEncoding: 'plain',
            revision: 3
        };

        await manager.applyIncomingProject(incoming);

        const loadedJSON = JSON.parse(vm.toJSON());
        expect(JSON.stringify(loadedJSON.targets[0].blocks)).toContain('invited project');
        expect(manager.send).toHaveBeenCalledWith({type: 'project_applied', revision: 3});
        expect(manager.state.synchronizing).toBe(false);
    });

    test('waits for every project and asset chunk before loading a snapshot', () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyIncomingProject = jest.fn();
        manager.incomingProjects = new Map();
        manager.projectLoadInProgress = false;
        manager.projectRevision = 0;
        manager.state = {synchronizing: false};
        manager.updateState = jest.fn(changes => {
            manager.state = Object.assign({}, manager.state, changes);
        });

        manager.prepareProject({
            assetChunkCounts: {'costume.svg': 2},
            assetNames: ['costume.svg'],
            projectChunkCount: 2,
            projectEncoding: 'plain',
            revision: 1
        });
        expect(manager.applyIncomingProject).not.toHaveBeenCalled();

        manager.receiveProjectJSONChunk({data: 'first', index: 0, revision: 1});
        manager.receiveProjectAssetChunk({data: 'asset-first', index: 0, name: 'costume.svg', revision: 1});
        manager.receiveProjectJSONChunk({data: 'second', index: 1, revision: 1});
        expect(manager.applyIncomingProject).not.toHaveBeenCalled();

        manager.receiveProjectAssetChunk({data: 'asset-second', index: 1, name: 'costume.svg', revision: 1});
        expect(manager.applyIncomingProject).toHaveBeenCalledTimes(1);
    });

    test('queues another project snapshot when a block changes during an in-flight update', () => {
        jest.useFakeTimers();
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.destroyed = false;
        manager.projectLoadInProgress = false;
        manager.projectSyncRequestPending = true;
        manager.projectUpdateQueued = false;
        manager.sendProjectUpdate = jest.fn();
        manager.state = {me: {role: 'member'}, synchronizing: false};

        manager.handleProjectChanged();
        jest.runOnlyPendingTimers();

        expect(manager.projectUpdateQueued).toBe(true);
        expect(manager.sendProjectUpdate).not.toHaveBeenCalled();

        manager.pendingProjectUpdate = {assetNames: [], requestId: 'first'};
        manager.acceptProjectUpdate({requestId: 'first', revision: 1});
        jest.runOnlyPendingTimers();

        expect(manager.sendProjectUpdate).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });
});
