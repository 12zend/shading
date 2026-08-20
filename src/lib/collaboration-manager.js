import EventEmitter from 'events';

import installMovieAssetManager from './movie-asset-manager';
import {
    describeBlocklyEvent,
    invertBlocklyEvent,
    isShareableBlocklyEvent,
    serializeBlocklyEvent
} from './collaboration-events';
import {
    describeCollaborationTarget,
    getOriginalTargets,
    resolveCollaborationTarget
} from './collaboration-targets';
import {ensureTeamId, getTeamPath, wasTeamCreatedInSession} from './team-route';

const IDENTITY_PREFIX = 'movie:collaboration:identity:';
const TOKEN_PREFIX = 'movie:collaboration:token:';
const ROLE_PREFIX = 'movie:collaboration:role:';
const CLAIM_PREFIX = 'movie:team-claim:';
const SESSION_IDENTITY_PREFIX = 'movie:collaboration:session-identity:';
const MAX_ENTRY_LENGTH = 4000;
const MEDIA_SYNC_DEBOUNCE_MS = 100;
const LOCK_REFRESH_MS = 2000;

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

const getAssetFingerprint = asset => ({
    assetId: String((asset && asset.assetId) || ''),
    dataFormat: String((asset && asset.dataFormat) || ''),
    name: String((asset && asset.name) || '')
});

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
        this.pendingOperationRollbacks = new Map();
        this.deferredOperations = new Map();
        this.lastSequence = 0;
        this.lockedBlockStates = new Map();
        this.snapshotChunks = null;
        this.applyingRemote = false;
        this.projectLoadInProgress = false;
        this.projectLoadOperations = [];
        this.mediaSyncPending = false;
        this.projectSyncRequestPending = false;
        this.reconnectAttempts = 0;
        this.movieAssetManager = installMovieAssetManager(this.vm);
        this.pendingTimelineSettings = new Map();
        this.timelineSettingsVersion = 0;
        this.sharedTimelineSettings = this.movieAssetManager.getTimelineSettings();
        this.hasSharedTimelineSettings = false;
        const initialRole = getInitialRole(this.teamId, this.sessionScopedIdentity);
        this.state = {
            awareness: {},
            entries: [],
            error: null,
            history: [],
            locks: [],
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
            teamId: this.teamId,
            timelineSettings: this.sharedTimelineSettings
        };

        this.handleWorkspaceEvent = this.handleWorkspaceEvent.bind(this);
        this.handleTargetsUpdate = this.handleTargetsUpdate.bind(this);
        this.handleProjectChanged = this.handleProjectChanged.bind(this);
        this.handleTimelineSettingsChanged = this.handleTimelineSettingsChanged.bind(this);
        this.mediaFingerprint = this.getMediaFingerprint();
        this.connect();
        this.vm.on('targetsUpdate', this.handleTargetsUpdate);
        this.vm.on('PROJECT_CHANGED', this.handleProjectChanged);
        this.movieAssetManager.on('timelineSettingsChanged', this.handleTimelineSettingsChanged);
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
                lastSequence: this.lastSequence,
                name: this.username
            });
        });
        socket.addEventListener('message', event => this.handleMessage(event.data));
        socket.addEventListener('close', event => {
            if (this.destroyed) return;
            this.rollbackPendingOperations();
            this.rollbackPendingTimelineSettings();
            this.clearLocalLock(false);
            this.applyRemoteLocks([]);
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
        this.rollbackPendingOperations();
        this.rollbackPendingTimelineSettings();
        this.clearLocalLock(false);
        this.applyRemoteLocks([]);
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
            if (Number.isInteger(message.sequence)) {
                this.lastSequence = Math.max(this.lastSequence, message.sequence);
            }
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
            this.timelineSettingsVersion = Number.isInteger(message.timelineSettingsVersion) ?
                message.timelineSettingsVersion : 0;
            if (message.timelineSettings) {
                this.sharedTimelineSettings = message.timelineSettings;
                this.hasSharedTimelineSettings = true;
            }
            this.updateState({
                entries: message.entries || [],
                error: null,
                history: message.history || [],
                locks: message.locks || [],
                me: message.me,
                members: message.members || [],
                onlineUserIds: message.onlineUserIds || [],
                status: 'connected',
                syncMessage: null,
                synchronizing: Boolean(message.synchronizing),
                timelineSettings: this.sharedTimelineSettings
            });
            if (!message.synchronizing && message.timelineSettings) this.applySharedTimelineSettings();
            this.applyRemoteLocks(message.locks || []);
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
        case 'operation_batch':
            (message.operations || []).sort((a, b) => a.sequence - b.sequence)
                .forEach(operation => this.receiveOperation(operation));
            break;
        case 'operation_rejected':
            this.rejectOperation(message);
            break;
        case 'timeline_settings':
            this.receiveTimelineSettings(message);
            break;
        case 'timeline_settings_rejected':
            this.rejectTimelineSettings(message);
            break;
        case 'awareness':
            this.receiveAwareness(message);
            break;
        case 'locks':
            this.updateState({locks: message.locks || []});
            this.applyRemoteLocks(message.locks || []);
            break;
        case 'lock_granted':
            if (this.localLock && this.localLock.id === message.requestId) {
                this.localLock.expiresAt = message.expiresAt;
            }
            break;
        case 'lock_denied':
            this.handleLockDenied(message);
            break;
        case 'snapshot_needed':
            if (this.state.me.role === 'admin' && !this.state.synchronizing) {
                this.sendSnapshot(message.baseSequence);
            }
            break;
        case 'snapshot_manifest':
            this.prepareSnapshot(message, false);
            break;
        case 'project_snapshot_manifest':
            this.prepareSnapshot(message, true);
            break;
        case 'snapshot_chunk':
            this.receiveSnapshotChunk(message);
            break;
        case 'project_sync_needed':
            this.sendProjectSnapshot(message.requestId, message.baseSequence);
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
        if (Number.isInteger(operation.sequence)) {
            this.lastSequence = Math.max(this.lastSequence, operation.sequence);
        }
        const history = this.state.history.filter(item => item.id !== operation.id);
        history.push(operation);
        history.sort((a, b) => b.sequence - a.sequence);
        this.updateState({history: history.slice(0, 250)});

        if (operation.revertedBy && !operation.revertsOperationId) return;
        if (this.pendingOperationIds.has(operation.clientOperationId)) {
            this.pendingOperationIds.delete(operation.clientOperationId);
            this.pendingOperationRollbacks.delete(operation.clientOperationId);
            return;
        }
        if (this.projectLoadInProgress || this.state.synchronizing) {
            if (!this.projectLoadOperations) this.projectLoadOperations = [];
            this.projectLoadOperations.push(operation);
            return;
        }
        if (this.snapshotInProgress && operation.sequence > this.snapshotBaseSequence) {
            this.snapshotCaptureOperations.push(operation);
            return;
        }
        if (!this.applyOperation(operation)) this.deferOperation(operation);
    }

    deferOperation (operation) {
        if (!operation) return;
        if (!this.deferredOperations) this.deferredOperations = new Map();
        this.deferredOperations.set(operation.id || operation.clientOperationId, operation);
    }

    flushDeferredOperations () {
        if (this.projectLoadInProgress || this.state.synchronizing) return;
        if (this.deferredOperations && this.deferredOperations.size) {
            const operations = Array.from(this.deferredOperations.values())
                .sort((a, b) => a.sequence - b.sequence);
            for (const operation of operations) {
                if (this.applyOperation(operation)) {
                    this.deferredOperations.delete(operation.id || operation.clientOperationId);
                }
            }
        }
        this.maybeAcknowledgeSnapshot();
    }

    maybeAcknowledgeSnapshot () {
        if (!Number.isInteger(this.snapshotAckPending) || this.projectLoadInProgress ||
            this.state.synchronizing || (this.deferredOperations && this.deferredOperations.size)) return;
        this.send({type: 'snapshot_applied', sequence: this.snapshotAckPending});
        this.snapshotAckPending = null;
    }

    receiveTimelineSettings (message) {
        const settings = message && message.settings;
        const version = Number(message && message.version);
        if (!settings || !Number.isInteger(version) || version < this.timelineSettingsVersion) return;
        if (Number.isInteger(message.sequence)) {
            this.lastSequence = Math.max(this.lastSequence, message.sequence);
        }
        this.timelineSettingsVersion = version;
        this.sharedTimelineSettings = settings;
        this.hasSharedTimelineSettings = true;
        if (message.clientOperationId) this.pendingTimelineSettings.delete(message.clientOperationId);
        this.updateState({timelineSettings: settings});
        if (!this.projectLoadInProgress && !this.state.synchronizing) this.applySharedTimelineSettings();
    }

    rejectTimelineSettings (message) {
        const clientOperationId = String(message.clientOperationId || '');
        const pending = this.pendingTimelineSettings.get(clientOperationId);
        this.pendingTimelineSettings.delete(clientOperationId);
        if (message.settings) {
            this.sharedTimelineSettings = message.settings;
            this.hasSharedTimelineSettings = true;
            this.timelineSettingsVersion = Number.isInteger(message.version) ?
                message.version : this.timelineSettingsVersion;
        } else if (pending) {
            this.sharedTimelineSettings = pending.previousSettings;
            this.hasSharedTimelineSettings = true;
        }
        this.updateState({
            error: message.message || 'レンダリング設定が同時に更新されたため、最新の設定を読み直しました。',
            timelineSettings: this.sharedTimelineSettings
        });
        this.applySharedTimelineSettings();
    }

    rollbackPendingTimelineSettings () {
        if (!this.pendingTimelineSettings || !this.pendingTimelineSettings.size) return;
        const pending = this.pendingTimelineSettings.values().next().value;
        this.pendingTimelineSettings.clear();
        if (pending) {
            this.sharedTimelineSettings = pending.previousSettings;
            this.hasSharedTimelineSettings = true;
        }
        this.applySharedTimelineSettings();
    }

    applySharedTimelineSettings () {
        if (!this.hasSharedTimelineSettings || !this.sharedTimelineSettings) return;
        const manager = this.movieAssetManager || installMovieAssetManager(this.vm);
        if (JSON.stringify(manager.getTimelineSettings()) === JSON.stringify(this.sharedTimelineSettings)) return;
        manager.updateTimelineSettings(this.sharedTimelineSettings, {remote: true});
    }

    handleTimelineSettingsChanged (settings, context = {}) {
        if (context.remote) return;
        const previousSettings = context.previousSettings || this.sharedTimelineSettings;
        if (this.state.status !== 'connected' || this.state.me.role === 'viewer' ||
            this.state.synchronizing || this.projectLoadInProgress || this.snapshotInProgress) {
            this.sharedTimelineSettings = previousSettings;
            this.hasSharedTimelineSettings = true;
            this.applySharedTimelineSettings();
            this.updateState({
                error: this.state.me.role === 'viewer' ? '閲覧者はレンダリング設定を変更できません。' :
                    'プロジェクトの同期が終わってからレンダリング設定を変更してください。',
                timelineSettings: previousSettings
            });
            return;
        }
        const clientOperationId = generateId();
        this.pendingTimelineSettings.set(clientOperationId, {previousSettings});
        if (!this.send({
            type: 'timeline_settings',
            baseVersion: this.timelineSettingsVersion,
            clientOperationId,
            settings
        })) {
            this.rejectTimelineSettings({
                clientOperationId,
                message: 'レンダリング設定を共有できなかったため、変更前の設定に戻しました。'
            });
        }
    }

    rejectOperation (message) {
        const clientOperationId = String(message.clientOperationId || '');
        const rollback = this.pendingOperationRollbacks.get(clientOperationId);
        this.pendingOperationIds.delete(clientOperationId);
        this.pendingOperationRollbacks.delete(clientOperationId);
        if (rollback) this.applyEventPayload(rollback.inverse, rollback.targetId, rollback.target);
        this.updateState({error: message.message || '競合した変更を取り消しました。'});
    }

    rollbackPendingOperations () {
        const rollbacks = Array.from(this.pendingOperationRollbacks.values()).reverse();
        this.pendingOperationIds.clear();
        this.pendingOperationRollbacks.clear();
        for (const rollback of rollbacks) {
            this.applyEventPayload(rollback.inverse, rollback.targetId, rollback.target);
        }
    }

    receiveAwareness (message) {
        if (!message.memberId || message.memberId === this.state.me.id) return;
        const awareness = Object.assign({}, this.state.awareness, {
            [message.memberId]: message.awareness
        });
        this.updateState({awareness});
    }

    restoreLockedBlocks () {
        if (!this.lockedBlockStates) this.lockedBlockStates = new Map();
        for (const state of this.lockedBlockStates.values()) {
            const block = state.block;
            if (!block || !block.workspace) continue;
            if (typeof block.setMovable === 'function') block.setMovable(state.movable);
            if (typeof block.setEditable === 'function') block.setEditable(state.editable);
            if (typeof block.setDeletable === 'function') block.setDeletable(state.deletable);
        }
        this.lockedBlockStates.clear();
    }

    applyRemoteLocks (locks) {
        const activeLocks = locks || (this.state && this.state.locks) || [];
        this.restoreLockedBlocks();
        clearTimeout(this.lockExpiryTimer);
        if (!this.workspace) return;
        const now = Date.now();
        let nearestExpiry = Infinity;
        for (const lock of activeLocks) {
            if (!lock || (this.state && this.state.me && lock.memberId === this.state.me.id) ||
                Number(lock.expiresAt) <= now) continue;
            nearestExpiry = Math.min(nearestExpiry, Number(lock.expiresAt));
            const target = resolveCollaborationTarget(this.vm.runtime, lock.target, lock.target && lock.target.id);
            if (!target || !this.vm.editingTarget || target.id !== this.vm.editingTarget.id) continue;
            for (const blockId of lock.blockIds || []) {
                const block = this.workspace.getBlockById(blockId);
                if (!block || this.lockedBlockStates.has(block.id)) continue;
                this.lockedBlockStates.set(block.id, {
                    block,
                    deletable: typeof block.isDeletable === 'function' ? block.isDeletable() : true,
                    editable: typeof block.isEditable === 'function' ? block.isEditable() : true,
                    movable: typeof block.isMovable === 'function' ? block.isMovable() : true
                });
                if (typeof block.setMovable === 'function') block.setMovable(false);
                if (typeof block.setEditable === 'function') block.setEditable(false);
                if (typeof block.setDeletable === 'function') block.setDeletable(false);
            }
        }
        if (Number.isFinite(nearestExpiry)) {
            this.lockExpiryTimer = setTimeout(() => this.applyRemoteLocks(), Math.max(0, nearestExpiry - now + 20));
        }
    }

    acquireLocalLock (block) {
        this.clearLocalLock();
        if (!block || this.state.status !== 'connected' || this.state.me.role === 'viewer' ||
            this.state.synchronizing) return;
        const root = typeof block.getRootBlock === 'function' ? block.getRootBlock() : block;
        const descendants = typeof root.getDescendants === 'function' ? root.getDescendants(false) : [root];
        const blockIds = descendants.map(descendant => descendant && descendant.id).filter(Boolean);
        const target = describeCollaborationTarget(this.vm.runtime, this.vm.editingTarget);
        if (!blockIds.length || !target) return;
        const id = generateId();
        this.localLock = {blockIds, id, target};
        this.send({type: 'lock_acquire', blockIds, requestId: id, target});
        this.lockRefreshTimer = setInterval(() => {
            if (!this.localLock || this.localLock.id !== id || !this.workspace || !this.workspace.isDragging ||
                !this.workspace.isDragging()) return;
            this.send({type: 'lock_acquire', blockIds, requestId: id, target});
        }, LOCK_REFRESH_MS);
    }

    clearLocalLock (notifyServer = true) {
        clearInterval(this.lockRefreshTimer);
        this.lockRefreshTimer = null;
        if (!this.localLock) return;
        const lockId = this.localLock.id;
        this.localLock = null;
        if (notifyServer) this.send({type: 'lock_release', lockId});
    }

    handleLockDenied (message) {
        if (!this.localLock || this.localLock.id !== message.requestId) return;
        this.clearLocalLock(false);
        if (this.workspace && typeof this.workspace.cancelCurrentGesture === 'function') {
            this.workspace.cancelCurrentGesture();
        }
        this.updateState({error: message.message || 'このブロックは他の参加者が操作中です。'});
    }

    prepareSnapshot (message, projectUpdate) {
        const chunkCount = Number(message.chunkCount);
        if (!Number.isInteger(chunkCount) || chunkCount < 1) return;
        this.snapshotChunks = new Array(chunkCount);
        this.snapshotSequence = message.sequence || 0;
        this.snapshotId = message.syncId || null;
        this.snapshotIsProjectUpdate = projectUpdate;
        this.bootstrapOperations = message.operations || [];
        this.projectLoadInProgress = true;
        this.projectLoadOperations = this.projectLoadOperations || [];
        this.updateState({synchronizing: true, syncMessage: null});
    }

    receiveSnapshotChunk (message) {
        if (!this.snapshotChunks || message.index >= this.snapshotChunks.length) return;
        if ((message.syncId || null) !== this.snapshotId) return;
        this.snapshotChunks[message.index] = message.data;
        if (this.snapshotChunks.some(chunk => typeof chunk !== 'string')) return;
        const snapshot = this.snapshotChunks.join('');
        const operations = this.bootstrapOperations || [];
        const projectUpdate = this.snapshotIsProjectUpdate;
        this.snapshotChunks = null;
        this.bootstrapOperations = [];
        this.applyingRemote = true;
        this.vm.loadProject(base64ToArrayBuffer(snapshot))
            .then(() => {
                const replayById = new Map();
                for (const operation of operations.concat(this.projectLoadOperations)) {
                    replayById.set(operation.id || operation.clientOperationId, operation);
                }
                const replayOperations = Array.from(replayById.values())
                    .sort((a, b) => a.sequence - b.sequence);
                for (const operation of replayOperations) {
                    if (!this.applyOperation(operation)) this.deferOperation(operation);
                }
                this.lastSequence = replayOperations.reduce(
                    (sequence, operation) => Math.max(sequence, Number(operation.sequence) || 0),
                    Math.max(this.lastSequence, Number(this.snapshotSequence) || 0)
                );
                if (!projectUpdate) this.snapshotAckPending = Number(this.snapshotSequence);
                this.mediaFingerprint = this.getMediaFingerprint();
                if (this.hasSharedTimelineSettings) {
                    this.applySharedTimelineSettings();
                } else {
                    const manager = this.movieAssetManager || installMovieAssetManager(this.vm);
                    this.sharedTimelineSettings = manager.getTimelineSettings();
                    this.updateState({timelineSettings: this.sharedTimelineSettings});
                }
                this.updateState({synchronizing: false, error: null, syncMessage: null});
                this.emit('snapshotApplied');
            })
            .catch(() => {
                this.updateState({error: 'チームのプロジェクトを読み込めませんでした。再接続してください。'});
            })
            .then(() => {
                this.projectLoadInProgress = false;
                this.projectLoadOperations = [];
                this.applyingRemote = false;
                this.flushDeferredOperations();
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
                    this.applyOperation(operation);
                }
                this.snapshotCaptureOperations = [];
                this.snapshotInProgress = false;
                this.snapshotBaseSequence = null;
                this.snapshotPromise = null;
                if (this.mediaSyncPending) this.scheduleMediaSync();
            });
    }

    sendProjectSnapshot (requestId, baseSequence) {
        if (this.snapshotInProgress) {
            this.projectSyncRequestPending = false;
            this.mediaSyncPending = true;
            return;
        }
        if (this.state.me.role === 'viewer') {
            this.projectSyncRequestPending = false;
            return;
        }
        const normalizedSequence = Number(baseSequence);
        if (!requestId || !Number.isInteger(normalizedSequence) || normalizedSequence < 0) return;
        this.snapshotInProgress = true;
        this.snapshotBaseSequence = normalizedSequence;
        this.snapshotCaptureOperations = [];
        this.snapshotPromise = this.vm.saveProjectSb3('base64')
            .then(snapshot => {
                this.send({
                    type: 'project_sync',
                    requestId,
                    baseSequence: normalizedSequence,
                    data: snapshot
                });
            })
            .catch(() => {
                this.updateState({error: 'メディアの同期用コピーを作成できませんでした。'});
            })
            .then(() => {
                const operations = this.snapshotCaptureOperations.sort((a, b) => a.sequence - b.sequence);
                for (const operation of operations) this.applyOperation(operation);
                this.snapshotCaptureOperations = [];
                this.snapshotInProgress = false;
                this.snapshotBaseSequence = null;
                this.snapshotPromise = null;
                this.mediaFingerprint = this.getMediaFingerprint();
                this.projectSyncRequestPending = false;
                if (this.mediaSyncPending) this.scheduleMediaSync();
            });
    }

    attachWorkspace (workspace, ScratchBlocks) {
        if (this.workspace === workspace) return;
        this.detachWorkspace();
        this.workspace = workspace;
        this.ScratchBlocks = ScratchBlocks;
        workspace.addChangeListener(this.handleWorkspaceEvent);
        this.applyRemoteLocks();
        this.flushDeferredOperations();
    }

    detachWorkspace () {
        this.restoreLockedBlocks();
        this.clearLocalLock();
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
        if (event.type === 'endDrag') {
            this.clearLocalLock();
            return;
        }
        if (!isShareableBlocklyEvent(event)) return;

        const forward = serializeBlocklyEvent(event, this.ScratchBlocks);
        const inverse = invertBlocklyEvent(forward);
        if (!forward || !inverse) return;
        const editingTarget = this.vm.editingTarget;
        const targetId = editingTarget && editingTarget.id;
        const target = describeCollaborationTarget(this.vm.runtime, editingTarget);

        if ((this.state.status && this.state.status !== 'connected') || this.state.me.role === 'viewer' ||
            this.state.synchronizing || this.snapshotInProgress) {
            this.applyEventPayload(inverse, targetId, target);
            this.updateState({
                error: this.snapshotInProgress ? '最新プロジェクトの共有中はブロックを編集できません。' :
                    (this.state.synchronizing ? 'プロジェクトの同期が終わるまで編集できません。' :
                        (this.state.me.role === 'viewer' ?
                            '閲覧者はブロックを編集できません。管理者に権限の変更を依頼してください。' :
                            '共同編集サービスへ接続されるまで編集できません。'))
            });
            return;
        }

        const clientOperationId = generateId();
        this.pendingOperationIds.add(clientOperationId);
        if (!this.pendingOperationRollbacks) this.pendingOperationRollbacks = new Map();
        this.pendingOperationRollbacks.set(clientOperationId, {inverse, target, targetId});
        const sent = this.send({
            type: 'operation',
            clientOperationId,
            targetId,
            target,
            forward,
            inverse,
            summary: describeBlocklyEvent(forward)
        });
        if (!sent) {
            this.rejectOperation({
                clientOperationId,
                message: '変更を共有できなかったため、操作を取り消しました。再接続してからやり直してください。'
            });
        }
    }

    applyOperation (operation) {
        if (!operation) return false;
        return this.applyEventPayload(operation.forward, operation.targetId, operation.target);
    }

    applyEventPayload (payload, targetId, targetDescriptor) {
        if (!payload || !this.ScratchBlocks || !this.workspace) return false;
        const target = resolveCollaborationTarget(this.vm.runtime, targetDescriptor, targetId);
        if (!target) return false;
        let restoredEvent;
        try {
            restoredEvent = this.ScratchBlocks.Events.fromJson(payload, this.workspace);
        } catch (error) {
            return false;
        }

        this.applyingRemote = true;
        try {
            if (this.vm.editingTarget && this.vm.editingTarget.id === target.id) {
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
        this.applyRemoteLocks();
        return true;
    }

    getMediaFingerprint () {
        const runtime = this.vm && this.vm.runtime;
        if (!runtime) return '';
        const manager = installMovieAssetManager(this.vm);
        const targets = getOriginalTargets(runtime);
        const media = targets.map(target => ({
            costumes: (typeof target.getCostumes === 'function' ? target.getCostumes() : [])
                .map(getAssetFingerprint),
            isStage: target.isStage === true,
            models: manager.getModels(target).map(getAssetFingerprint),
            name: typeof target.getName === 'function' ? target.getName() : '',
            sounds: (typeof target.getSounds === 'function' ? target.getSounds() : [])
                .map(getAssetFingerprint),
            videos: manager.getVideos(target).map(getAssetFingerprint)
        }));
        const fontManager = runtime.fontManager;
        const fonts = fontManager && typeof fontManager.getFonts === 'function' ?
            fontManager.getFonts().map(font => ({
                assetId: String((font.asset && font.asset.assetId) || ''),
                family: String(font.family || ''),
                name: String(font.name || '')
            })) : [];
        return JSON.stringify({fonts, media});
    }

    handleProjectChanged () {
        const fingerprint = this.getMediaFingerprint();
        if (fingerprint === this.mediaFingerprint) return;
        this.mediaFingerprint = fingerprint;
        if (this.applyingRemote || this.projectLoadInProgress || this.state.me.role === 'viewer') return;
        this.mediaSyncPending = true;
        this.scheduleMediaSync();
    }

    scheduleMediaSync () {
        clearTimeout(this.mediaSyncTimer);
        this.mediaSyncTimer = setTimeout(() => {
            if (this.destroyed || this.applyingRemote || this.projectLoadInProgress ||
                this.state.synchronizing || this.snapshotInProgress || this.projectSyncRequestPending ||
                !this.mediaSyncPending) return;
            const requestId = generateId();
            if (this.send({type: 'project_sync_request', requestId})) {
                this.mediaSyncPending = false;
                this.projectSyncRequestPending = true;
            } else {
                this.updateState({error: 'メディアの変更を共有できません。共同編集サービスへ再接続してください。'});
            }
        }, MEDIA_SYNC_DEBOUNCE_MS);
    }

    handleTargetsUpdate () {
        this.flushDeferredOperations();
        const target = this.vm.editingTarget;
        if (!target) return;
        const current = this.localAwareness || {};
        if (current.targetId === target.id) return;
        this.clearLocalLock();
        this.applyRemoteLocks();
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
        if (block) this.acquireLocalLock(block);
        else this.clearLocalLock();
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

    addAdmin (memberId) {
        this.send({type: 'admin_add', memberId});
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
        clearTimeout(this.mediaSyncTimer);
        clearTimeout(this.lockExpiryTimer);
        clearInterval(this.lockRefreshTimer);
        this.rollbackPendingOperations();
        this.rollbackPendingTimelineSettings();
        this.clearLocalLock();
        this.detachWorkspace();
        this.vm.removeListener('targetsUpdate', this.handleTargetsUpdate);
        this.vm.removeListener('PROJECT_CHANGED', this.handleProjectChanged);
        this.movieAssetManager.removeListener('timelineSettingsChanged', this.handleTimelineSettingsChanged);
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
