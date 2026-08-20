/* global WebSocketPair, WebSocketRequestResponsePair */
import {DurableObject} from 'cloudflare:workers';

import {
    canAdminister,
    canManageEntry,
    canRevertOperation,
    canTransferAdmin,
    consumeInviteRecord,
    requiresFreshSnapshot
} from './collaboration-auth.js';
import {
    normalizeSnapshotBaseSequence,
    runSerializedRoomMutation,
    selectSnapshotReplayOperations
} from './collaboration-protocol.js';
import {deriveTeamIdFromClaim} from './team-claim.js';

const ROOM_STATE_KEY = 'room-state';
const SNAPSHOT_CHUNK_SIZE = 1500000;
const MAX_SNAPSHOT_SIZE = 31 * 1024 * 1024;
const MAX_OPERATION_SIZE = 1000000;
const ALLOWED_ROLES = new Set(['admin', 'member', 'viewer']);
const EDITABLE_ROLES = new Set(['admin', 'member']);
const OPERATION_TYPES = new Set(['create', 'delete', 'change', 'move']);
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MESSAGES = 240;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8'}
});

const safeSend = (socket, message) => {
    try {
        socket.send(JSON.stringify(message));
        return true;
    } catch (error) {
        return false;
    }
};

const padSequence = sequence => String(sequence).padStart(16, '0');
const publicMember = member => ({
    id: member.id,
    joinedAt: member.joinedAt,
    name: member.name,
    role: member.role
});

const normalizeName = value => String(value || '').trim()
    .slice(0, 60) || 'ゲスト';
const normalizeText = value => String(value || '').trim()
    .slice(0, 4000);

const normalizeSeconds = value => {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return null;
    return Math.max(0, Math.min(3600, seconds));
};

const normalizeAttachment = value => {
    if (!value || typeof value !== 'object') return null;
    const blockId = String(value.blockId || '').slice(0, 200);
    const targetId = String(value.targetId || '').slice(0, 200);
    if (!blockId || !targetId) return null;
    return {
        blockId,
        label: String(value.label || '').slice(0, 120),
        targetId,
        targetName: String(value.targetName || '').slice(0, 120),
        x: Number.isFinite(Number(value.x)) ? Number(value.x) : 0,
        y: Number.isFinite(Number(value.y)) ? Number(value.y) : 0
    };
};

const normalizeTarget = (value, legacyId) => {
    const target = value && typeof value === 'object' ? value : {};
    const index = Number(target.index);
    return {
        id: String(target.id || legacyId || '').slice(0, 200),
        index: Number.isInteger(index) && index >= 0 ? index : null,
        isStage: target.isStage === true,
        name: String(target.name || '').slice(0, 120)
    };
};

const createSecret = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        // This is a base64 padding regex, not a division expression.
        // eslint-disable-next-line no-div-regex
        .replace(/=+$/, '');
};

const hashSecret = async secret => {
    const encoded = new TextEncoder().encode(String(secret || ''));
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
};

const describeOperation = operation => {
    switch (operation.type) {
    case 'create': return 'ブロックを追加';
    case 'delete': return 'ブロックを削除';
    case 'change': return 'ブロックの値を変更';
    case 'move': return 'ブロックの接続を変更';
    default: return 'プロジェクトを変更';
    }
};

const isValidOperationPair = (forward, inverse) => {
    if (!forward || !inverse || !OPERATION_TYPES.has(forward.type) || !OPERATION_TYPES.has(inverse.type)) {
        return false;
    }
    if (forward.type === 'create' && inverse.type !== 'delete') return false;
    if (forward.type === 'delete' && inverse.type !== 'create') return false;
    if (forward.type === 'change' && inverse.type !== 'change') return false;
    if (forward.type === 'move') {
        if (inverse.type !== 'move') return false;
        const structural = forward.oldParentId || forward.newParentId ||
            inverse.oldParentId || inverse.newParentId;
        if (!structural) return false;
    }
    return true;
};

const allowedOrigin = (request, env) => {
    const origin = request.headers.get('origin');
    if (!origin) return false;
    let originURL;
    try {
        originURL = new URL(origin);
    } catch (error) {
        return false;
    }
    const localOrigin = originURL.protocol === 'http:' &&
        (originURL.hostname === 'localhost' || originURL.hostname === '127.0.0.1');
    // Browsers prevent remote sites from claiming a localhost Origin; authentication
    // still requires the room claim or a valid single-use invite token.
    if (localOrigin) return true;
    const configured = String(env.ALLOWED_ORIGINS || 'https://shading.app')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    return configured.indexOf(origin) !== -1;
};

export default {
    fetch (request, env) {
        const url = new URL(request.url);
        const match = url.pathname.match(/^\/api\/teams\/([a-z0-9][a-z0-9-]{4,46}[a-z0-9])\/websocket$/);
        if (!match) {
            if (env.ASSETS) return env.ASSETS.fetch(request);
            return jsonResponse({ok: true, service: 'shading-collaboration'});
        }
        if (request.method !== 'GET' || request.headers.get('upgrade') !== 'websocket') {
            return jsonResponse({error: 'WebSocket upgrade required'}, 426);
        }
        if (!allowedOrigin(request, env)) return jsonResponse({error: 'Origin not allowed'}, 403);
        const room = env.TEAM_ROOMS.getByName(match[1]);
        return room.fetch(request);
    }
};

export class TeamRoom extends DurableObject {
    constructor (ctx, env) {
        super(ctx, env);
        this.sessions = new Map();
        for (const socket of this.ctx.getWebSockets()) {
            const attachment = socket.deserializeAttachment();
            this.sessions.set(socket, attachment || {});
        }
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    fetch (request) {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        const teamMatch = new URL(request.url).pathname.match(/^\/api\/teams\/([^/]+)\/websocket$/);
        const session = {
            sessionId: crypto.randomUUID(),
            teamId: teamMatch ? teamMatch[1] : null
        };
        server.serializeAttachment(session);
        this.sessions.set(server, session);
        return new Response(null, {status: 101, webSocket: client});
    }

    async getRoomState () {
        let state = await this.ctx.storage.get(ROOM_STATE_KEY);
        if (!state) {
            state = {
                adminId: null,
                createdAt: new Date().toISOString(),
                members: {},
                invites: {},
                sequence: 0,
                snapshotChunkCount: 0,
                snapshotSequence: 0
            };
            await this.ctx.storage.put(ROOM_STATE_KEY, state);
        }
        return state;
    }

    async putRoomState (state) {
        await this.ctx.storage.put(ROOM_STATE_KEY, state);
    }

    getSession (socket) {
        return this.sessions.get(socket) || socket.deserializeAttachment() || {};
    }

    getMember (state, socket) {
        const session = this.getSession(socket);
        return session.memberId ? state.members[session.memberId] : null;
    }

    publicMembers (state) {
        return Object.values(state.members).map(publicMember);
    }

    onlineUserIds () {
        return Array.from(new Set(Array.from(this.sessions.values())
            .map(session => session.memberId)
            .filter(Boolean)));
    }

    hasPendingFreshSnapshot (state) {
        return Object.values(state.members).some(requiresFreshSnapshot);
    }

    broadcast (message, exceptSocket = null) {
        for (const socket of this.sessions.keys()) {
            if (socket !== exceptSocket) safeSend(socket, message);
        }
    }

    broadcastState (state) {
        this.broadcast({
            type: 'state',
            members: this.publicMembers(state),
            onlineUserIds: this.onlineUserIds()
        });
    }

    sendError (socket, message) {
        safeSend(socket, {type: 'error', message});
    }

    requestSnapshot (socket, state) {
        if (socket) {
            safeSend(socket, {
                type: 'snapshot_needed',
                baseSequence: state.sequence
            });
        }
    }

    async listValues (prefix, options = {}) {
        const values = await this.ctx.storage.list(Object.assign({prefix}, options));
        return Array.from(values.values());
    }

    async webSocketMessage (socket, rawMessage) {
        if (typeof rawMessage !== 'string') {
            this.sendError(socket, 'テキスト形式のメッセージだけを受け付けます。');
            return;
        }
        if (!this.checkRateLimit(socket, rawMessage.length)) return;
        let message;
        try {
            message = JSON.parse(rawMessage);
        } catch (error) {
            this.sendError(socket, 'メッセージを読み取れませんでした。');
            return;
        }

        if (message.type === 'hello' || message.type === 'snapshot' ||
            message.type === 'project_sync_request' || message.type === 'project_sync') {
            await runSerializedRoomMutation(this.ctx, async () => {
                const mutationState = await this.getRoomState();
                if (message.type === 'hello') {
                    await this.handleHello(socket, message, mutationState);
                    return;
                }
                const mutationMember = this.getMember(mutationState, socket);
                if (!mutationMember) {
                    this.sendError(socket, '先にチームへ参加してください。');
                    return;
                }
                if (message.type === 'snapshot') {
                    await this.handleSnapshot(socket, mutationMember, message, mutationState);
                } else if (message.type === 'project_sync_request') {
                    this.handleProjectSyncRequest(socket, mutationMember, message, mutationState);
                } else {
                    await this.handleProjectSync(socket, mutationMember, message, mutationState);
                }
            });
            return;
        }
        const state = await this.getRoomState();
        const member = this.getMember(state, socket);
        if (!member) {
            this.sendError(socket, '先にチームへ参加してください。');
            return;
        }

        switch (message.type) {
        case 'profile':
            member.name = normalizeName(message.name);
            state.members[member.id] = member;
            await this.putRoomState(state);
            this.broadcastState(state);
            break;
        case 'awareness':
            this.handleAwareness(socket, member, message);
            break;
        case 'entry_add':
            await this.handleEntryAdd(socket, member, message, state);
            break;
        case 'entry_edit':
            await this.handleEntryEdit(socket, member, message, state);
            break;
        case 'entry_delete':
            await this.handleEntryDelete(socket, member, message, state);
            break;
        case 'operation':
            await this.handleOperation(socket, member, message, state);
            break;
        case 'revert':
            await this.handleRevert(socket, member, message, state);
            break;
        case 'role_change':
            await this.handleRoleChange(socket, member, message, state);
            break;
        case 'transfer_admin':
            await this.handleTransferAdmin(socket, member, message, state);
            break;
        case 'invite_create':
            await this.handleInviteCreate(socket, member, message, state);
            break;
        case 'snapshot_applied':
            if (member.role === 'admin' && (this.hasPendingFreshSnapshot(state) ||
                state.sequence - state.snapshotSequence >= 100)) {
                this.requestSnapshot(socket, state);
            }
            break;
        default:
            this.sendError(socket, '未対応の共同編集操作です。');
        }
    }

    checkRateLimit (socket, messageLength) {
        if (messageLength > MAX_SNAPSHOT_SIZE + 100000) {
            this.sendError(socket, 'メッセージが大きすぎます。');
            socket.close(4008, 'Message too large');
            return false;
        }
        const session = this.getSession(socket);
        const now = Date.now();
        if (!session.rateWindowStarted || now - session.rateWindowStarted >= RATE_LIMIT_WINDOW_MS) {
            session.rateWindowStarted = now;
            session.rateCount = 0;
        }
        session.rateCount += 1;
        socket.serializeAttachment(session);
        this.sessions.set(socket, session);
        if (session.rateCount > RATE_LIMIT_MESSAGES) {
            this.sendError(socket, '操作回数が多すぎます。少し待ってから再接続してください。');
            socket.close(4008, 'Rate limit exceeded');
            return false;
        }
        return true;
    }

    async consumeInvite (state, token) {
        if (!token) return null;
        state.invites = state.invites || {};
        const tokenHash = await hashSecret(token);
        return consumeInviteRecord(state.invites, tokenHash);
    }

    async handleHello (socket, message, state) {
        const requestedId = String(message.memberId || '').slice(0, 100);
        let member = requestedId ? state.members[requestedId] : null;
        let memberToken = null;
        if (member) {
            const presentedHash = await hashSecret(message.memberToken);
            const validLegacyToken = member.token && message.memberToken === member.token;
            if (!message.memberToken || (!validLegacyToken && presentedHash !== member.tokenHash)) {
                member = null;
            } else if (validLegacyToken) {
                member.tokenHash = presentedHash;
                delete member.token;
            }
        }
        if (member) {
            member.name = normalizeName(message.name);
        } else {
            const firstMember = Object.keys(state.members).length === 0;
            const session = this.getSession(socket);
            const claimedTeamId = firstMember ? await deriveTeamIdFromClaim(message.claimToken) : null;
            if (firstMember && (!claimedTeamId || claimedTeamId !== session.teamId)) {
                this.sendError(socket, 'このチームを作成したブラウザーの認証情報が必要です。');
                socket.close(4003, 'Valid team claim required');
                return;
            }
            const invite = firstMember ? {role: 'admin'} : await this.consumeInvite(state, message.inviteToken);
            if (!invite) {
                this.sendError(socket, '有効な招待リンクが必要です。管理者から新しいリンクを受け取ってください。');
                socket.close(4003, 'Valid invite required');
                return;
            }
            const id = firstMember && requestedId ? requestedId : crypto.randomUUID();
            memberToken = createSecret();
            member = {
                id,
                joinedAt: new Date().toISOString(),
                name: normalizeName(message.name),
                pendingFreshSnapshot: !firstMember,
                role: firstMember ? 'admin' : invite.role,
                tokenHash: await hashSecret(memberToken)
            };
            // hello is serialized by blockConcurrencyWhile, so this state cannot become stale.
            // eslint-disable-next-line require-atomic-updates
            state.members[id] = member;
            if (firstMember) {
                // eslint-disable-next-line require-atomic-updates
                state.adminId = id;
            }
        }
        // eslint-disable-next-line require-atomic-updates
        state.members[member.id] = member;
        await this.putRoomState(state);

        const session = Object.assign({}, this.getSession(socket), {memberId: member.id});
        socket.serializeAttachment(session);
        this.sessions.set(socket, session);

        const entries = await this.listValues('entry:', {limit: 500, reverse: true});
        const history = await this.listValues('history:', {limit: 250, reverse: true});
        safeSend(socket, {
            type: 'welcome',
            entries,
            history,
            me: publicMember(member),
            memberToken,
            members: this.publicMembers(state),
            onlineUserIds: this.onlineUserIds(),
            synchronizing: requiresFreshSnapshot(member)
        });
        this.broadcastState(state);

        const adminSocket = Array.from(this.sessions.entries())
            .find(([, sessionValue]) => sessionValue.memberId === state.adminId);
        if (member.pendingFreshSnapshot) {
            const waitingSession = Object.assign({}, this.getSession(socket), {awaitingFreshSnapshot: true});
            socket.serializeAttachment(waitingSession);
            this.sessions.set(socket, waitingSession);
            safeSend(socket, {
                type: 'snapshot_waiting',
                message: adminSocket ? '管理者の最新プロジェクトを同期しています。' :
                    '最新プロジェクトの同期には管理者の再接続が必要です。'
            });
            if (adminSocket) this.requestSnapshot(adminSocket[0], state);
        } else if (state.snapshotChunkCount > 0) {
            const allHistory = await this.listValues('history:', {limit: 1000});
            const operations = allHistory.filter(operation => operation.sequence > state.snapshotSequence);
            safeSend(socket, {
                type: 'snapshot_manifest',
                chunkCount: state.snapshotChunkCount,
                operations,
                sequence: state.snapshotSequence
            });
            for (let index = 0; index < state.snapshotChunkCount; index++) {
                const data = await this.ctx.storage.get(`snapshot:${padSequence(index)}`);
                safeSend(socket, {type: 'snapshot_chunk', index, data});
            }
        } else if (member.role === 'admin') {
            this.requestSnapshot(socket, state);
        } else if (adminSocket) this.requestSnapshot(adminSocket[0], state);
    }

    handleAwareness (socket, member, message) {
        const awareness = message.awareness && typeof message.awareness === 'object' ? {
            blockId: String(message.awareness.blockId || '').slice(0, 200) || null,
            blockLabel: String(message.awareness.blockLabel || '').slice(0, 100) || null,
            targetId: String(message.awareness.targetId || '').slice(0, 200) || null,
            targetName: String(message.awareness.targetName || '').slice(0, 120) || null
        } : {};
        this.broadcast({type: 'awareness', memberId: member.id, awareness}, socket);
    }

    async handleEntryAdd (socket, member, message, state) {
        if (member.role === 'viewer') {
            this.sendError(socket, '閲覧者は投稿できません。');
            return;
        }
        const text = normalizeText(message.text);
        if (!text) return;
        state.sequence += 1;
        const entry = {
            attachment: normalizeAttachment(message.attachment),
            authorId: member.id,
            authorName: member.name,
            createdAt: new Date().toISOString(),
            deleted: false,
            id: crypto.randomUUID(),
            kind: message.kind === 'note' ? 'note' : 'chat',
            seconds: normalizeSeconds(message.seconds),
            sequence: state.sequence,
            text
        };
        const key = `entry:${padSequence(entry.sequence)}`;
        await this.ctx.storage.put({
            [key]: entry,
            [`entry-id:${entry.id}`]: key,
            [ROOM_STATE_KEY]: state
        });
        this.broadcast({type: 'entry', entry});
    }

    async getEntry (entryId) {
        const key = await this.ctx.storage.get(`entry-id:${entryId}`);
        if (!key) return null;
        const entry = await this.ctx.storage.get(key);
        return entry ? {entry, key} : null;
    }

    async handleEntryEdit (socket, member, message) {
        const result = await this.getEntry(String(message.entryId || ''));
        if (!result || !canManageEntry(member, result.entry)) {
            this.sendError(socket, 'この投稿は編集できません。');
            return;
        }
        const text = normalizeText(message.text);
        if (!text || result.entry.deleted) return;
        result.entry.text = text;
        result.entry.editedAt = new Date().toISOString();
        await this.ctx.storage.put(result.key, result.entry);
        this.broadcast({type: 'entry', entry: result.entry});
    }

    async handleEntryDelete (socket, member, message) {
        const result = await this.getEntry(String(message.entryId || ''));
        if (!result || !canManageEntry(member, result.entry)) {
            this.sendError(socket, 'この投稿は削除できません。');
            return;
        }
        result.entry.deleted = true;
        result.entry.deletedAt = new Date().toISOString();
        result.entry.deletedBy = member.id;
        await this.ctx.storage.put(result.key, result.entry);
        this.broadcast({type: 'entry', entry: result.entry});
    }

    async handleOperation (socket, member, message, state) {
        if (!EDITABLE_ROLES.has(member.role)) {
            this.sendError(socket, '閲覧者はブロックを編集できません。');
            return;
        }
        if (member.pendingFreshSnapshot) {
            this.sendError(socket, '管理者の最新プロジェクトを同期してから編集してください。');
            return;
        }
        const forward = message.forward;
        const inverse = message.inverse;
        const serializedSize = JSON.stringify({forward, inverse}).length;
        const target = normalizeTarget(message.target, message.targetId);
        if (!isValidOperationPair(forward, inverse) || serializedSize > MAX_OPERATION_SIZE || !target.id) {
            this.sendError(socket, '変更データが大きすぎるか、形式が正しくありません。');
            return;
        }
        state.sequence += 1;
        const operation = {
            authorId: member.id,
            authorName: member.name,
            clientOperationId: String(message.clientOperationId || '').slice(0, 100),
            createdAt: new Date().toISOString(),
            forward,
            id: crypto.randomUUID(),
            inverse,
            revertedBy: null,
            sequence: state.sequence,
            summary: describeOperation(forward),
            targetId: target.id,
            target
        };
        const key = `history:${padSequence(operation.sequence)}`;
        await this.ctx.storage.put({
            [key]: operation,
            [`history-id:${operation.id}`]: key,
            [ROOM_STATE_KEY]: state
        });
        this.broadcast({type: 'operation', operation});
        if (state.sequence - state.snapshotSequence >= 100) {
            const adminSocket = Array.from(this.sessions.entries())
                .find(([, session]) => session.memberId === state.adminId);
            if (adminSocket) this.requestSnapshot(adminSocket[0], state);
        }
    }

    async getOperation (operationId) {
        const key = await this.ctx.storage.get(`history-id:${operationId}`);
        if (!key) return null;
        const operation = await this.ctx.storage.get(key);
        return operation ? {key, operation} : null;
    }

    async handleRevert (socket, member, message, state) {
        const result = await this.getOperation(String(message.operationId || ''));
        if (!result || result.operation.revertedBy) {
            this.sendError(socket, 'この変更はすでに取り消されているか、見つかりません。');
            return;
        }
        if (!canRevertOperation(member, result.operation)) {
            this.sendError(socket, '他のユーザーの変更を戻せるのは管理者だけです。');
            return;
        }
        result.operation.revertedBy = member.id;
        result.operation.revertedAt = new Date().toISOString();
        state.sequence += 1;
        const revertOperation = {
            authorId: member.id,
            authorName: member.name,
            clientOperationId: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            forward: result.operation.inverse,
            id: crypto.randomUUID(),
            inverse: result.operation.forward,
            revertsOperationId: result.operation.id,
            revertedBy: null,
            sequence: state.sequence,
            summary: `${result.operation.summary}を元に戻す`,
            targetId: result.operation.targetId,
            target: result.operation.target
        };
        const revertKey = `history:${padSequence(revertOperation.sequence)}`;
        await this.ctx.storage.put({
            [result.key]: result.operation,
            [revertKey]: revertOperation,
            [`history-id:${revertOperation.id}`]: revertKey,
            [ROOM_STATE_KEY]: state
        });
        this.broadcast({type: 'operation', operation: result.operation});
        this.broadcast({type: 'operation', operation: revertOperation});
    }

    async handleRoleChange (socket, member, message, state) {
        if (!canAdminister(member)) {
            this.sendError(socket, '権限を変更できるのは管理者だけです。');
            return;
        }
        const target = state.members[String(message.memberId || '')];
        const role = String(message.role || '');
        if (!target || target.id === member.id || !ALLOWED_ROLES.has(role) || role === 'admin') return;
        target.role = role;
        await this.putRoomState(state);
        this.broadcastState(state);
    }

    async handleTransferAdmin (socket, member, message, state) {
        const target = state.members[String(message.memberId || '')];
        if (!canTransferAdmin(member, target)) {
            this.sendError(socket, '管理者はメンバーにだけ渡せます。');
            return;
        }
        member.role = 'member';
        target.role = 'admin';
        state.adminId = target.id;
        await this.putRoomState(state);
        this.broadcastState(state);
    }

    async handleInviteCreate (socket, member, message, state) {
        if (!canAdminister(member)) {
            this.sendError(socket, '招待リンクを作成できるのは管理者だけです。');
            return;
        }
        const role = message.role === 'member' ? 'member' : 'viewer';
        const token = createSecret();
        const tokenHash = await hashSecret(token);
        state.invites = state.invites || {};
        state.invites[tokenHash] = {
            createdAt: new Date().toISOString(),
            createdBy: member.id,
            expiresAt: new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)).toISOString(),
            role
        };
        await this.putRoomState(state);
        safeSend(socket, {
            type: 'invite',
            requestId: String(message.requestId || '').slice(0, 100),
            role,
            token
        });
    }

    async handleSnapshot (socket, member, message, state) {
        if (!canAdminister(member)) {
            this.sendError(socket, '同期用コピーを保存できるのは管理者だけです。');
            return;
        }
        const data = typeof message.data === 'string' ? message.data : '';
        if (!data || data.length > MAX_SNAPSHOT_SIZE) {
            this.sendError(socket, 'プロジェクトが共同編集の同期上限を超えています。');
            return;
        }
        const baseSequence = normalizeSnapshotBaseSequence(message.baseSequence, state.sequence);
        if (baseSequence === null) {
            this.sendError(socket, '同期用コピーの基準位置が正しくありません。');
            return;
        }
        const allHistory = await this.listValues('history:', {limit: 1000});
        const replayOperations = selectSnapshotReplayOperations(allHistory, baseSequence);
        const existing = await this.ctx.storage.list({prefix: 'snapshot:'});
        if (existing.size) await this.ctx.storage.delete(Array.from(existing.keys()));
        const chunks = [];
        for (let offset = 0; offset < data.length; offset += SNAPSHOT_CHUNK_SIZE) {
            chunks.push(data.slice(offset, offset + SNAPSHOT_CHUNK_SIZE));
        }
        const values = {};
        chunks.forEach((chunk, index) => {
            values[`snapshot:${padSequence(index)}`] = chunk;
        });
        // Snapshot messages are serialized by runSerializedRoomMutation.
        // eslint-disable-next-line require-atomic-updates
        state.snapshotChunkCount = chunks.length;
        // eslint-disable-next-line require-atomic-updates
        state.snapshotSequence = baseSequence;
        values[ROOM_STATE_KEY] = state;
        await this.ctx.storage.put(values);

        let deliveredFreshSnapshot = false;
        for (const [waitingSocket, session] of this.sessions.entries()) {
            const waitingMember = session.memberId && state.members[session.memberId];
            if (!session.awaitingFreshSnapshot || !waitingMember || !waitingMember.pendingFreshSnapshot) continue;
            waitingMember.pendingFreshSnapshot = false;
            session.awaitingFreshSnapshot = false;
            waitingSocket.serializeAttachment(session);
            this.sessions.set(waitingSocket, session);
            safeSend(waitingSocket, {
                type: 'snapshot_manifest',
                chunkCount: chunks.length,
                fresh: true,
                operations: replayOperations,
                sequence: state.snapshotSequence
            });
            chunks.forEach((chunk, index) => {
                safeSend(waitingSocket, {type: 'snapshot_chunk', index, data: chunk});
            });
            deliveredFreshSnapshot = true;
        }
        if (deliveredFreshSnapshot) await this.putRoomState(state);
    }

    handleProjectSyncRequest (socket, member, message, state) {
        if (!EDITABLE_ROLES.has(member.role)) {
            this.sendError(socket, '閲覧者はメディアを編集できません。');
            return;
        }
        if (member.pendingFreshSnapshot) {
            this.sendError(socket, '管理者の最新プロジェクトを同期してからメディアを編集してください。');
            return;
        }
        const requestId = String(message.requestId || '').slice(0, 100);
        if (!requestId) return;
        safeSend(socket, {
            type: 'project_sync_needed',
            requestId,
            baseSequence: state.sequence
        });
    }

    async handleProjectSync (socket, member, message, state) {
        if (!EDITABLE_ROLES.has(member.role)) {
            this.sendError(socket, '閲覧者はメディアを編集できません。');
            return;
        }
        if (member.pendingFreshSnapshot) {
            this.sendError(socket, '管理者の最新プロジェクトを同期してからメディアを編集してください。');
            return;
        }
        const requestId = String(message.requestId || '').slice(0, 100);
        const data = typeof message.data === 'string' ? message.data : '';
        const baseSequence = normalizeSnapshotBaseSequence(message.baseSequence, state.sequence);
        if (!requestId || !data || data.length > MAX_SNAPSHOT_SIZE || baseSequence === null) {
            this.sendError(socket, 'メディアの同期データが大きすぎるか、形式が正しくありません。');
            return;
        }

        const allHistory = await this.listValues('history:', {limit: 1000});
        const replayOperations = selectSnapshotReplayOperations(allHistory, baseSequence);
        const existing = await this.ctx.storage.list({prefix: 'snapshot:'});
        if (existing.size) await this.ctx.storage.delete(Array.from(existing.keys()));
        const chunks = [];
        for (let offset = 0; offset < data.length; offset += SNAPSHOT_CHUNK_SIZE) {
            chunks.push(data.slice(offset, offset + SNAPSHOT_CHUNK_SIZE));
        }
        const values = {};
        chunks.forEach((chunk, index) => {
            values[`snapshot:${padSequence(index)}`] = chunk;
        });
        // Project sync messages are serialized by runSerializedRoomMutation.
        // eslint-disable-next-line require-atomic-updates
        state.snapshotChunkCount = chunks.length;
        // eslint-disable-next-line require-atomic-updates
        state.snapshotSequence = baseSequence;
        values[ROOM_STATE_KEY] = state;
        await this.ctx.storage.put(values);

        let stateChanged = false;
        for (const [recipient, session] of this.sessions.entries()) {
            if (recipient === socket || !session.memberId) continue;
            const recipientMember = state.members[session.memberId];
            if (!recipientMember) continue;
            if (session.awaitingFreshSnapshot && recipientMember.pendingFreshSnapshot) {
                session.awaitingFreshSnapshot = false;
                recipientMember.pendingFreshSnapshot = false;
                recipient.serializeAttachment(session);
                this.sessions.set(recipient, session);
                stateChanged = true;
            }
            safeSend(recipient, {
                type: 'project_snapshot_manifest',
                syncId: requestId,
                chunkCount: chunks.length,
                operations: replayOperations,
                sequence: state.snapshotSequence
            });
            chunks.forEach((chunk, index) => {
                safeSend(recipient, {type: 'snapshot_chunk', syncId: requestId, index, data: chunk});
            });
        }
        if (stateChanged) await this.putRoomState(state);
    }

    async webSocketClose (socket, code, reason) {
        this.sessions.delete(socket);
        const state = await this.getRoomState();
        this.broadcastState(state);
        try {
            socket.close(code, reason);
        } catch (error) {
            // The socket can already be closed by the runtime.
        }
    }
}
