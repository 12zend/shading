jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import VM from 'scratch-vm';

import {CollaborationManager} from '../../../src/lib/collaboration-manager';
import {activateTeamRoute, getTeamIdFromPath} from '../../../src/lib/team-route';

const projectJSON = () => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
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

const makeStorage = () => {
    const values = new Map();
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        removeItem: key => values.delete(key),
        setItem: (key, value) => values.set(key, String(value))
    };
};

const installBrowserMocks = () => {
    const sockets = [];
    class FakeWebSocket {
        constructor (url) {
            this.url = url;
            this.readyState = FakeWebSocket.CONNECTING;
            this.listeners = {};
            this.sent = [];
            sockets.push(this);
        }

        addEventListener (type, listener) {
            this.listeners[type] = listener;
        }

        send (data) {
            this.sent.push(JSON.parse(data));
        }

        close () {}
    }
    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    global.WebSocket = FakeWebSocket;
    global.history = {replaceState: jest.fn()};
    global.localStorage = makeStorage();
    global.sessionStorage = makeStorage();
    global.location = {
        hash: '',
        host: 'localhost:8602',
        hostname: 'localhost',
        origin: 'http://localhost:8602',
        pathname: '/',
        port: '8602',
        protocol: 'http:',
        search: ''
    };
    const digestBytes = new Uint8Array(32);
    for (let index = 0; index < digestBytes.length; index++) digestBytes[index] = (index * 7) % 256;
    global.crypto = {
        getRandomValues: array => {
            for (let index = 0; index < array.length; index++) array[index] = (index * 3) % 256;
            return array;
        },
        subtle: {
            digest: async () => digestBytes.slice().buffer
        }
    };
    return sockets;
};

const restoreBrowserMocks = snapshots => {
    /* eslint-disable require-atomic-updates */
    global.WebSocket = snapshots.WebSocket;
    global.history = snapshots.history;
    global.localStorage = snapshots.localStorage;
    global.sessionStorage = snapshots.sessionStorage;
    global.location = snapshots.location;
    global.crypto = snapshots.crypto;
    /* eslint-enable require-atomic-updates */
};

describe('collaboration standalone mode', () => {
    test('does not connect or rewrite the URL on a plain root link', async () => {
        const snapshots = {
            WebSocket: global.WebSocket,
            history: global.history,
            localStorage: global.localStorage,
            sessionStorage: global.sessionStorage,
            location: global.location,
            crypto: global.crypto
        };
        const sockets = installBrowserMocks();
        try {
            const vm = new VM();
            const manager = new CollaborationManager(vm, {});
            expect(manager.state.standalone).toBe(true);
            expect(manager.state.status).toBe('standalone');
            expect(manager.teamId).toBe(null);

            await vm.loadProject(JSON.stringify(projectJSON()));

            expect(sockets).toHaveLength(0);
            expect(manager.state.standalone).toBe(true);
            expect(global.history.replaceState).not.toHaveBeenCalled();
            manager.destroy();
        } finally {
            restoreBrowserMocks(snapshots);
        }
    });

    test('allows local editing while collaboration is disabled', () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.scheduleProjectSync = jest.fn();
        manager.updateState = jest.fn();
        manager.state = {me: {role: 'viewer'}, standalone: true, status: 'standalone'};
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
        manager.handleProjectChanged();
        manager.handleTimelineSettingsChanged({duration: 20, framerate: 30, height: 360, width: 480}, {});

        expect(manager.scheduleProjectSync).not.toHaveBeenCalled();
        expect(manager.updateState).not.toHaveBeenCalled();
    });

    test('activateTeamRoute creates a claim-backed team route and reuses it afterwards', async () => {
        const snapshots = {
            WebSocket: global.WebSocket,
            history: global.history,
            localStorage: global.localStorage,
            sessionStorage: global.sessionStorage,
            location: global.location,
            crypto: global.crypto
        };
        installBrowserMocks();
        try {
            expect(getTeamIdFromPath()).toBe(null);
            const teamId = await activateTeamRoute();
            expect(teamId).toMatch(/^[a-z0-9](?:[a-z0-9-]{4,46}[a-z0-9])$/);
            expect(global.history.replaceState).toHaveBeenCalledWith(null, '', `/${teamId}`);
            expect(global.sessionStorage.getItem(`movie:team-claim:${teamId}`)).toBeTruthy();

            global.location.pathname = `/${teamId}`;
            expect(await activateTeamRoute()).toBe(teamId);
            expect(global.history.replaceState).toHaveBeenCalledTimes(1);
        } finally {
            restoreBrowserMocks(snapshots);
        }
    });

    test('startCollaboration activates the team route, becomes admin and connects', async () => {
        const snapshots = {
            WebSocket: global.WebSocket,
            history: global.history,
            localStorage: global.localStorage,
            sessionStorage: global.sessionStorage,
            location: global.location,
            crypto: global.crypto
        };
        const sockets = installBrowserMocks();
        try {
            const vm = new VM();
            const manager = new CollaborationManager(vm, {});
            await vm.loadProject(JSON.stringify(projectJSON()));
            expect(sockets).toHaveLength(0);

            const teamId = await manager.startCollaboration();

            expect(manager.state.standalone).toBe(false);
            expect(manager.state.status).toBe('connecting');
            expect(manager.state.teamId).toBe(teamId);
            expect(manager.state.me.role).toBe('admin');
            expect(sockets).toHaveLength(1);
            expect(sockets[0].url).toContain(`/api/teams/${teamId}/websocket`);

            sockets[0].readyState = global.WebSocket.OPEN;
            sockets[0].listeners.open();
            const hello = sockets[0].sent.find(message => message.type === 'hello');
            expect(hello.claimToken).toBe(global.sessionStorage.getItem(`movie:team-claim:${teamId}`));

            expect(await manager.startCollaboration()).toBe(teamId);
            expect(sockets).toHaveLength(1);
            manager.destroy();
        } finally {
            restoreBrowserMocks(snapshots);
        }
    });
});
