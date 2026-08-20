import EventEmitter from 'events';

import installMovieAssetManager from './movie-asset-manager';
import {
    describeBlocklyEvent,
    invertBlocklyEvent,
    isShareableBlocklyEvent,
    serializeBlocklyEvent
} from './collaboration-events';
import {ensureTeamId, getTeamPath, wasTeamCreatedInSession} from './team-route';

const IDENTITY_PREFIX = 'movie:collaboration:identity:';
const TOKEN_PREFIX = 'movie:collaboration:token:';
const ROLE_PREFIX = 'movie:collaboration:role:';
const CLAIM_PREFIX = 'movie:team-claim:';
const SESSION_IDENTITY_PREFIX = 'movie:collaboration:session-identity:';
const MAX_ENTRY_LENGTH = 4000;

const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `local-${Date.now().toString(36)}-${Math.random().toString(36)
        .slice(2)}`;
};

const getStoredValue = (key, sessionScoped = false) => {
    try {
        return (sessionScoped ? sessionStorage : localStorage).getItem(key);
    } catch (error) {
        return null;
    }
};

const setStoredValue = (key, value, sessionScoped = false) => {
    try {
        (sessionScoped ? sessionStorage : localStorage).setItem(key, value);
    } catch (error) {
        // Collaboration still works for the current tab when storage is unavailable.
    }
};

const useSessionIdentity = (teamId, inviteToken = null) => {
    const key = `${SESSION_IDENTITY_PREFIX}${teamId}`;
    try {
        if (inviteToken) sessionStorage.setItem(key, '1');
        return sessionStorage.getItem(key) === '1';
    } catch (error) {
        return Boolean(inviteToken);
    }
};

const getInitialRole = (teamId, sessionScoped = false) => {
    const storedRole = getStoredValue(`${ROLE_PREFIX}${teamId}`, sessionScoped);
    if (!sessionScoped && wasTeamCreatedInSession(teamId)) return 'admin';
    return storedRole === 'admin' || storedRole === 'member' ? storedRole : 'viewer';
};

const getIdentityId = (teamId, sessionScoped = false) => {
    const key = `${IDENTITY_PREFIX}${teamId}`;
    const stored = getStoredValue(key, sessionScoped);
    if (stored) return stored;
    const id = generateId();
    setStoredValue(key, id, sessionScoped);
    return id;
};

const getClaimToken = teamId => {
    try {
        const stored = sessionStorage.getItem(`${CLAIM_PREFIX}${teamId}`);
        if (stored) return stored;
    } catch (error) {
        // Use the in-memory bootstrap value when session storage is unavailable.
    }
    const bootstrapClaim = window.ShadingTeamClaim;
    return bootstrapClaim && bootstrapClaim.teamId === teamId ? bootstrapClaim.token : null;
};

const removeClaimToken = teamId => {
    try {
        sessionStorage.removeItem(`${CLAIM_PREFIX}${teamId}`);
    } catch (error) {
        // The claim is also discarded from memory below.
    }
    if (window.ShadingTeamClaim && window.ShadingTeamClaim.teamId === teamId) {
        window.ShadingTeamClaim = null;
    }
};

const getInviteToken = () => {
    const hash = String(location.hash || '').replace(/^#/, '');
    return new URLSearchParams(hash).get('invite');
};

const clampTimelineSeconds = (seconds, duration = Infinity) => {
    const parsed = Number(seconds);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(Number.isFinite(duration) ? duration : Infinity, parsed));
};

const base64ToArrayBuffer = base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
};

const getWebSocketURL = teamId => {
    const configured = process.env.COLLABORATION_WS_URL || '';
    if (configured) {
        return `${configured.replace(/\/$/, '')}/api/teams/${encodeURIComponent(teamId)}/websocket`;
    }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/api/teams/${encodeURIComponent(teamId)}/websocket`;
};

class CollaborationManager extends EventEmitter {
    constructor (vm, options = {}) {
        super();
        this.vm = vm;
        this.teamId = options.teamId || ensureTeamId();
        this.inviteToken = getInviteToken();
        this.sessionScopedIdentity = useSessionIdentity(this.teamId, this.inviteToken);
        this.identityId = getIdentityId(this.teamId, this.sessionScopedIdentity);
        this.inviteRequests = new Map();
        this.username = options.username || 'ゲスト';
        this.pendingOperationIds = new Set();
        this.snapshotChunks = null;
        this.applyingRemote = false;
        this.reconnectAttempts = 0;
        const initialRole = getInitialRole(this.teamId, this.sessionScopedIdentity);
        this.state = {
            awareness: {},
            entries: [],
            error: null,
            history: [],
            me: {
                id: this.identityId,
                name: this.username,
                role: initialRole
            },
            members: [],
            onlineUserIds: [],
            status: 'connecting',
            syncMessage: null,
            synchronizing: false,
            teamId: this.teamId
        };

        this.handleWorkspaceEvent = this.handleWorkspaceEvent.bind(this);
        this.handleTargetsUpdate = this.handleTargetsUpdate.bind(this);
        this.connect();
        this.vm.on('targetsUpdate', this.handleTargetsUpdate);
    }

    getState () {
        return this.state;
    }

    updateState (changes) {
        this.state = Object.assign({}, this.state, changes);
        this.emit('stateChanged', this.state);
    }

    setUsername (username) {
        const normalized = String(username || '').trim()
            .slice(0, 60) || 'ゲスト';
        if (normalized === this.username) return;
        this.username = normalized;
        this.updateState({
            me: Object.assign({}, this.state.me, {name: normalized})
        });
        this.send({type: 'profile', name: normalized});
    }

    connect () {
        if (typeof WebSocket === 'undefined') {
            this.enterOfflineMode('このブラウザーではリアルタイム接続を利用できません。');
            return;
        }
        this.updateState({status: 'connecting', error: null});
        let socket;
        try {
            socket = new WebSocket(getWebSocketURL(this.teamId));
        } catch (error) {
            this.enterOfflineMode('共同編集サービスへ接続できませんでした。');
            return;
        }
        this.socket = socket;
        socket.addEventListener('open', () => {
            this.reconnectAttempts = 0;
            this.send({
                type: 'hello',
                claimToken: getClaimToken(this.teamId),
                memberId: this.identityId,
                memberToken: getStoredValue(`${TOKEN_PREFIX}${this.teamId}`, this.sessionScopedIdentity),
                inviteToken: this.inviteToken,
                name: this.username
            });
        });
        socket.addEventListener('message', event => this.handleMessage(event.data));
        socket.addEventListener('close', event => {
            if (this.destroyed) return;
            if (event.code === 4003 || event.code === 4008) {
                this.updateState({status: 'denied', error: event.reason || 'チームへの参加が拒否されました。'});
                return;
            }
            this.updateState({status: 'offline', error: '接続が切れました。再接続しています。'});
            this.scheduleReconnect();
        });
        socket.addEventListener('error', () => {
            if (socket.readyState !== WebSocket.OPEN) {
                this.updateState({status: 'offline', error: '共同編集サービスへ接続できません。'});
            }
        });
    }

    scheduleReconnect () {
        clearTimeout(this.reconnectTimer);
        const delay = Math.min(30000, 1000 * (2 ** this.reconnectAttempts));
        this.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }

    enterOfflineMode (message) {
        const me = this.state.me;
        this.updateState({
            error: message,
            me,
            members: [me],
            onlineUserIds: [me.id],
            status: 'offline'
        });
    }

    send (message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
        this.socket.send(JSON.stringify(message));
        return true;
    }

    handleMessage (rawMessage) {
        let message;
        try {
            message = JSON.parse(rawMessage);
        } catch (error) {
            return;
        }

        switch (message.type) {
        case 'welcome':
            this.identityId = message.me.id;
            setStoredValue(`${IDENTITY_PREFIX}${this.teamId}`, message.me.id, this.sessionScopedIdentity);
            setStoredValue(`${ROLE_PREFIX}${this.teamId}`, message.me.role, this.sessionScopedIdentity);
            if (message.memberToken) {
                setStoredValue(`${TOKEN_PREFIX}${this.teamId}`, message.memberToken, this.sessionScopedIdentity);
            }
            removeClaimToken(this.teamId);
            if (this.inviteToken) {
                history.replaceState(null, '', `${getTeamPath(this.teamId)}${location.search}`);
                this.inviteToken = null;
            }
            this.updateState({
                entries: message.entries || [],
                error: null,
                history: message.history || [],
                me: message.me,
                members: message.members || [],
                onlineUserIds: message.onlineUserIds || [],
                status: 'connected',
                syncMessage: null,
                synchronizing: Boolean(message.synchronizing)
            });
            break;
        case 'state': {
            const members = message.members || this.state.members;
            const me = members.find(member => member.id === this.state.me.id) || this.state.me;
            setStoredValue(`${ROLE_PREFIX}${this.teamId}`, me.role, this.sessionScopedIdentity);
            this.updateState({
                me,
                members,
                onlineUserIds: message.onlineUserIds || this.state.onlineUserIds
            });
            break;
        }
        case 'entry':
            this.receiveEntry(message.entry);
            break;
        case 'operation':
            this.receiveOperation(message.operation);
            break;
        case 'awareness':
            this.receiveAwareness(message);
            break;
        case 'snapshot_needed':
            if (this.state.me.role === 'admin') this.sendSnapshot(message.baseSequence);
            break;
        case 'snapshot_manifest':
            this.snapshotChunks = new Array(message.chunkCount);
            this.snapshotSequence = message.sequence || 0;
            this.bootstrapOperations = message.operations || [];
            this.updateState({synchronizing: true, syncMessage: null});
            break;
        case 'snapshot_chunk':
            this.receiveSnapshotChunk(message);
            break;
        case 'snapshot_waiting':
            this.updateState({synchronizing: true, syncMessage: message.message || null});
            break;
        case 'invite':
            this.receiveInvite(message);
            break;
        case 'error':
            this.updateState({error: message.message || '共同編集の操作に失敗しました。'});
            break;
        default:
            break;
        }
    }

    receiveInvite (message) {
        const request = this.inviteRequests.get(message.requestId);
        if (!request) return;
        this.inviteRequests.delete(message.requestId);
        const url = `${location.origin}${getTeamPath(this.teamId)}#invite=${encodeURIComponent(message.token)}`;
        request.resolve({role: message.role, url});
    }

    receiveEntry (entry) {
        const entries = this.state.entries.filter(item => item.id !== entry.id);
        entries.push(entry);
        entries.sort((a, b) => a.sequence - b.sequence);
        this.updateState({entries});
    }

    receiveOperation (operation) {
        if (!operation) return;
        const history = this.state.history.filter(item => item.id !== operation.id);
        history.push(operation);
        history.sort((a, b) => b.sequence - a.sequence);
        this.updateState({history: history.slice(0, 250)});

        if (operation.revertedBy && !operation.revertsOperationId) return;
        if (this.pendingOperationIds.has(operation.clientOperationId)) {
            this.pendingOperationIds.delete(operation.clientOperationId);
            return;
        }
        if (this.snapshotInProgress && operation.sequence > this.snapshotBaseSequence) {
            this.snapshotCaptureOperations.push(operation);
            return;
        }
        this.applyEventPayload(operation.forward, operation.targetId);
    }

    receiveAwareness (message) {
        if (!message.memberId || message.memberId === this.state.me.id) return;
        const awareness = Object.assign({}, this.state.awareness, {
            [message.memberId]: message.awareness
        });
        this.updateState({awareness});
    }

    receiveSnapshotChunk (message) {
        if (!this.snapshotChunks || message.index >= this.snapshotChunks.length) return;
        this.snapshotChunks[message.index] = message.data;
        if (this.snapshotChunks.some(chunk => typeof chunk !== 'string')) return;
        const snapshot = this.snapshotChunks.join('');
        const operations = this.bootstrapOperations || [];
        this.snapshotChunks = null;
        this.bootstrapOperations = [];
        this.applyingRemote = true;
        this.vm.loadProject(base64ToArrayBuffer(snapshot))
            .then(() => {
                for (const operation of operations) {
                    this.applyEventPayload(operation.forward, operation.targetId);
                }
                this.send({type: 'snapshot_applied', sequence: this.snapshotSequence});
                this.updateState({synchronizing: false, error: null, syncMessage: null});
                this.emit('snapshotApplied');
            })
            .catch(() => {
                this.updateState({error: 'チームのプロジェクトを読み込めませんでした。再接続してください。'});
            })
            .then(() => {
                this.applyingRemote = false;
            });
    }

    sendSnapshot (baseSequence) {
        if (this.snapshotInProgress || this.state.me.role !== 'admin') return;
        const normalizedSequence = Number(baseSequence);
        if (!Number.isInteger(normalizedSequence) || normalizedSequence < 0) return;
        this.snapshotInProgress = true;
        this.snapshotBaseSequence = normalizedSequence;
        this.snapshotCaptureOperations = [];
        this.snapshotPromise = this.vm.saveProjectSb3('base64')
            .then(snapshot => {
                this.send({type: 'snapshot', baseSequence: normalizedSequence, data: snapshot});
            })
            .catch(() => {
                this.updateState({error: 'プロジェクトの同期用コピーを作成できませんでした。'});
            })
            .then(() => {
                const operations = this.snapshotCaptureOperations.sort((a, b) => a.sequence - b.sequence);
                for (const operation of operations) {
                    this.applyEventPayload(operation.forward, operation.targetId);
                }
                this.snapshotCaptureOperations = [];
                this.snapshotInProgress = false;
                this.snapshotBaseSequence = null;
                this.snapshotPromise = null;
            });
    }

    attachWorkspace (workspace, ScratchBlocks) {
        if (this.workspace === workspace) return;
        this.detachWorkspace();
        this.workspace = workspace;
        this.ScratchBlocks = ScratchBlocks;
        workspace.addChangeListener(this.handleWorkspaceEvent);
    }

    detachWorkspace () {
        if (this.workspace) this.workspace.removeChangeListener(this.handleWorkspaceEvent);
        this.workspace = null;
        this.ScratchBlocks = null;
    }

    handleWorkspaceEvent (event) {
        if (this.applyingRemote) return;
        if (event.type === 'ui') {
            if (event.element === 'selected') this.updateSelection(event.newValue || event.blockId);
            return;
        }
        if (!isShareableBlocklyEvent(event)) return;

        const forward = serializeBlocklyEvent(event, this.ScratchBlocks);
        const inverse = invertBlocklyEvent(forward);
        if (!forward || !inverse) return;
        const targetId = this.vm.editingTarget && this.vm.editingTarget.id;

        if (this.state.me.role === 'viewer' || this.state.synchronizing || this.snapshotInProgress) {
            this.applyEventPayload(inverse, targetId);
            this.updateState({
                error: this.snapshotInProgress ? '最新プロジェクトの共有中はブロックを編集できません。' :
                    (this.state.synchronizing ? 'プロジェクトの同期が終わるまで編集できません。' :
                        '閲覧者はブロックを編集できません。管理者に権限の変更を依頼してください。')
            });
            return;
        }

        const clientOperationId = generateId();
        this.pendingOperationIds.add(clientOperationId);
        const sent = this.send({
            type: 'operation',
            clientOperationId,
            targetId,
            forward,
            inverse,
            summary: describeBlocklyEvent(forward)
        });
        if (!sent) {
            const localOperation = {
                authorId: this.state.me.id,
                authorName: this.state.me.name,
                clientOperationId,
                createdAt: new Date().toISOString(),
                forward,
                id: clientOperationId,
                inverse,
                sequence: Date.now(),
                summary: describeBlocklyEvent(forward),
                targetId
            };
            this.receiveOperation(localOperation);
        }
    }

    applyEventPayload (payload, targetId) {
        if (!payload || !this.ScratchBlocks || !this.workspace) return false;
        const target = this.vm.runtime.getTargetById(targetId);
        if (!target) return false;
        let restoredEvent;
        try {
            restoredEvent = this.ScratchBlocks.Events.fromJson(payload, this.workspace);
        } catch (error) {
            return false;
        }

        this.applyingRemote = true;
        try {
            if (this.vm.editingTarget && this.vm.editingTarget.id === targetId) {
                this.ScratchBlocks.Events.disable();
                try {
                    restoredEvent.run(true);
                } finally {
                    this.ScratchBlocks.Events.enable();
                }
            }
            target.blocks.blocklyListen(restoredEvent);
        } finally {
            this.applyingRemote = false;
        }
        return true;
    }

    handleTargetsUpdate () {
        const target = this.vm.editingTarget;
        if (!target) return;
        const current = this.localAwareness || {};
        if (current.targetId === target.id) return;
        this.sendAwareness(Object.assign({}, current, {
            targetId: target.id,
            targetName: target.getName(),
            blockId: null,
            blockLabel: null
        }));
    }

    updateSelection (blockId) {
        const target = this.vm.editingTarget;
        if (!target) return;
        const block = blockId && this.workspace ? this.workspace.getBlockById(blockId) : null;
        this.lastSelectedBlockId = block ? block.id : null;
        this.sendAwareness({
            blockId: block ? block.id : null,
            blockLabel: block ? String(block.toString()).slice(0, 80) : null,
            targetId: target.id,
            targetName: target.getName()
        });
    }

    sendAwareness (awareness) {
        this.localAwareness = awareness;
        this.send({type: 'awareness', awareness});
    }

    captureHatAttachment () {
        if (!this.workspace || !this.ScratchBlocks) return null;
        let block = this.lastSelectedBlockId && this.workspace.getBlockById(this.lastSelectedBlockId);
        if (!block && this.ScratchBlocks.selected && this.ScratchBlocks.selected.workspace === this.workspace) {
            block = this.ScratchBlocks.selected;
        }
        if (!block) return null;
        const topBlock = block.getRootBlock ? block.getRootBlock() : block;
        const isHat = !topBlock.outputConnection && !topBlock.previousConnection;
        if (!isHat) return null;
        const position = topBlock.getRelativeToSurfaceXY();
        const target = this.vm.editingTarget;
        return {
            blockId: topBlock.id,
            label: String(topBlock.toString()).slice(0, 100),
            targetId: target && target.id,
            targetName: target ? target.getName() : '',
            x: Math.round(position.x),
            y: Math.round(position.y)
        };
    }

    jumpToAttachment (attachment) {
        if (!attachment || !attachment.targetId) return;
        if (!this.vm.editingTarget || this.vm.editingTarget.id !== attachment.targetId) {
            this.vm.setEditingTarget(attachment.targetId);
        }
        requestAnimationFrame(() => {
            if (!this.workspace) return;
            const block = this.workspace.getBlockById(attachment.blockId);
            if (block) {
                this.workspace.centerOnBlock(block.id);
                if (typeof block.select === 'function') block.select();
            } else if (this.workspace.scrollbar && Number.isFinite(Number(attachment.x)) &&
                Number.isFinite(Number(attachment.y))) {
                const metrics = this.workspace.getMetrics();
                const scale = this.workspace.scale || 1;
                const scrollX = (Number(attachment.x) * scale) - metrics.contentLeft - (metrics.viewWidth / 2);
                const scrollY = (Number(attachment.y) * scale) - metrics.contentTop - (metrics.viewHeight / 2);
                this.workspace.scrollbar.set(scrollX, scrollY);
            }
        });
    }

    seekTimeline (seconds) {
        const manager = installMovieAssetManager(this.vm);
        const timeline = manager.getTimelineState();
        const normalized = clampTimelineSeconds(seconds, timeline.duration);
        if (normalized === null) return;
        manager.seekTimeline(normalized);
    }

    getCurrentTimelineSeconds () {
        return installMovieAssetManager(this.vm).getTimelineState().currentTime;
    }

    addEntry (kind, text, options = {}) {
        const normalizedText = String(text || '').trim()
            .slice(0, MAX_ENTRY_LENGTH);
        if (!normalizedText || this.state.me.role === 'viewer') return false;
        const seconds = options.seconds === '' || options.seconds === null ||
            typeof options.seconds === 'undefined' ? null : clampTimelineSeconds(options.seconds);
        const draft = {
            attachment: options.attachment || null,
            kind: kind === 'note' ? 'note' : 'chat',
            seconds,
            text: normalizedText
        };
        if (!this.send(Object.assign({type: 'entry_add'}, draft))) {
            this.receiveEntry(Object.assign({}, draft, {
                authorId: this.state.me.id,
                authorName: this.state.me.name,
                createdAt: new Date().toISOString(),
                id: generateId(),
                sequence: Date.now()
            }));
        }
        return true;
    }

    editEntry (entryId, text) {
        const normalizedText = String(text || '').trim()
            .slice(0, MAX_ENTRY_LENGTH);
        if (!normalizedText) return;
        this.send({type: 'entry_edit', entryId, text: normalizedText});
    }

    deleteEntry (entryId) {
        this.send({type: 'entry_delete', entryId});
    }

    revertOperation (operationId) {
        this.send({type: 'revert', operationId});
    }

    changeRole (memberId, role) {
        this.send({type: 'role_change', memberId, role});
    }

    transferAdmin (memberId) {
        this.send({type: 'transfer_admin', memberId});
    }

    createInvite (role) {
        if (this.state.me.role !== 'admin') return Promise.reject(new Error('管理者だけが招待できます。'));
        const requestId = generateId();
        return new Promise((resolve, reject) => {
            this.inviteRequests.set(requestId, {resolve, reject});
            if (!this.send({type: 'invite_create', requestId, role})) {
                this.inviteRequests.delete(requestId);
                reject(new Error('共同編集サービスへ接続されていません。'));
            }
        });
    }

    destroy () {
        this.destroyed = true;
        clearTimeout(this.reconnectTimer);
        this.detachWorkspace();
        this.vm.removeListener('targetsUpdate', this.handleTargetsUpdate);
        if (this.socket) this.socket.close(1000, 'Editor closed');
        for (const request of this.inviteRequests.values()) {
            request.reject(new Error('共同編集を終了しました。'));
        }
        this.inviteRequests.clear();
        this.removeAllListeners();
    }
}

const installCollaborationManager = (vm, options) => {
    if (!vm.__movieCollaborationManager) {
        vm.__movieCollaborationManager = new CollaborationManager(vm, options);
    } else if (options && options.username) {
        vm.__movieCollaborationManager.setUsername(options.username);
    }
    return vm.__movieCollaborationManager;
};

export {
    CollaborationManager,
    clampTimelineSeconds,
    getInitialRole,
    getWebSocketURL,
    installCollaborationManager,
    useSessionIdentity
};

export default installCollaborationManager;
