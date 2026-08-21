/* global WebSocketPair, WebSocketRequestResponsePair */
import {DurableObject} from 'cloudflare:workers';

import {
    canAdminister,
    canCompleteFreshSnapshot,
    canManageEntry,
    canPromoteAdmin,
    consumeInviteRecord,
    requiresFreshSnapshot
} from './collaboration-auth.js';
import {findProjectResyncDonor, runSerializedRoomMutation} from './collaboration-protocol.js';
import {deriveTeamIdFromClaim} from './team-claim.js';

const ROOM_STATE_KEY = 'room-state';
const SNAPSHOT_CHUNK_SIZE = 1500000;
const MAX_SNAPSHOT_SIZE = 31 * 1024 * 1024;
const ALLOWED_ROLES = new Set(['admin', 'member', 'viewer']);
const EDITABLE_ROLES = new Set(['admin', 'member']);
// Op relay limit. The heavy per-op validation runs on the peers; the
// relay only enforces structural bounds so one peer cannot wedge the room.
const MAX_RELAY_OPS_PER_MESSAGE = 256;

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

const normalizeAssetName = value => {
    const name = String(value || '');
    return /^[a-zA-Z0-9_-]{1,160}\.[a-zA-Z0-9]{1,16}$/.test(name) ? name : null;
};

const normalizeAssetNames = value => {
    if (!Array.isArray(value) || value.length > 2000) return null;
    const names = [];
    const seen = new Set();
    for (const valueName of value) {
        const name = normalizeAssetName(valueName);
        if (!name || seen.has(name)) return null;
        seen.add(name);
        names.push(name);
    }
    return names.sort();
};

const normalizeProjectPayload = value => {
    if (!value || typeof value !== 'object' || typeof value.data !== 'string' || !value.data.length) return null;
    if (value.encoding !== 'plain' && value.encoding !== 'gzip-base64') return null;
    return {data: value.data, encoding: value.encoding};
};

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
    // still requires the room claim or a valid unexpired invite token.
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
        this.currentHostId = null;
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
                projectAssetChunks: {},
                projectAssetNames: [],
                projectChunkCount: 0,
                projectEncoding: 'plain',
                projectRevision: 0
            };
            await this.ctx.storage.put(ROOM_STATE_KEY, state);
        }
        if (!Number.isInteger(state.projectRevision)) state.projectRevision = 0;
        if (!Number.isInteger(state.projectChunkCount)) state.projectChunkCount = 0;
        if (!Number.isInteger(state.opEpoch)) state.opEpoch = 0;
        if (!Number.isInteger(state.opSeq)) state.opSeq = 0;
        if (state.projectEncoding !== 'plain' && state.projectEncoding !== 'gzip-base64') {
            state.projectEncoding = 'plain';
        }
        if (!Array.isArray(state.projectAssetNames)) state.projectAssetNames = [];
        if (!state.projectAssetChunks || typeof state.projectAssetChunks !== 'object') state.projectAssetChunks = {};
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

    broadcast (message, exceptSocket = null) {
        for (const socket of this.sessions.keys()) {
            if (socket !== exceptSocket) safeSend(socket, message);
        }
    }

    broadcastState (state) {
        this.broadcast({
            type: 'state',
            hostId: this.currentHostId || null,
            members: this.publicMembers(state),
            onlineUserIds: this.onlineUserIds()
        });
    }

    /**
     * The room host is the earliest-joined online member with edit rights
     * whose project snapshot is up to date. The host is the sequencing
     * authority for the op-based sync; when it changes, the epoch is
     * bumped so every peer invalidates its sequence state.
     * @param {object} state The persisted room state.
     */
    async updateHost (state) {
        let host = null;
        for (const session of this.sessions.values()) {
            if (!session.memberId) continue;
            const member = state.members[session.memberId];
            if (!member || !EDITABLE_ROLES.has(member.role) || member.pendingFreshSnapshot) continue;
            if (!host || member.joinedAt < host.joinedAt) host = member;
        }
        const hostId = host ? host.id : null;
        if (hostId === this.currentHostId) return;
        this.currentHostId = hostId;
        state.opEpoch = (Number.isInteger(state.opEpoch) ? state.opEpoch : 0) + 1;
        await this.putRoomState(state);
        this.broadcast({
            type: 'op_host_changed',
            epoch: state.opEpoch,
            hostId
        });
    }

    getHostSocket () {
        if (!this.currentHostId) return null;
        for (const [socket, session] of this.sessions.entries()) {
            if (session.memberId === this.currentHostId) return socket;
        }
        return null;
    }

    findSessionByMemberId (memberId) {
        for (const [socket, session] of this.sessions.entries()) {
            if (session.memberId === memberId) return socket;
        }
        return null;
    }

    normalizeRelayOps (value) {
        if (!Array.isArray(value) || value.length === 0 ||
            value.length > MAX_RELAY_OPS_PER_MESSAGE) return null;
        return value;
    }

    sendError (socket, message) {
        safeSend(socket, {type: 'error', message});
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
        if (!this.checkMessageSize(socket, rawMessage.length)) return;
        let message;
        try {
            message = JSON.parse(rawMessage);
        } catch (error) {
            this.sendError(socket, 'メッセージを読み取れませんでした。');
            return;
        }

        // Durable Object messages can overlap while storage I/O is pending. Run
        // every room mutation in one transaction so sequence numbers, roles,
        // project revisions, and invite validation cannot race each other.
        await runSerializedRoomMutation(this.ctx, async () => {
            const state = await this.getRoomState();
            if (message.type === 'hello') {
                await this.handleHello(socket, message, state);
                return;
            }
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
            case 'role_change':
                await this.handleRoleChange(socket, member, message, state);
                break;
            case 'admin_add':
            case 'transfer_admin':
                await this.handleAddAdmin(socket, member, message, state);
                break;
            case 'invite_create':
                await this.handleInviteCreate(socket, member, message, state);
                break;
            case 'project_update':
                await this.handleProjectUpdate(socket, member, message, state);
                break;
            case 'project_applied':
                await this.handleProjectApplied(socket, member, message, state);
                break;
            case 'project_resync_needed':
                await this.handleProjectResyncNeeded(socket, member, message, state);
                break;
            case 'op_propose':
            case 'op_broadcast':
            case 'op_reject':
            case 'op_request':
            case 'op_send':
                await this.handleOpRelay(socket, member, message, state);
                break;
            default:
                this.sendError(socket, '未対応の共同編集操作です。');
            }
        });
    }

    checkMessageSize (socket, messageLength) {
        if (messageLength > MAX_SNAPSHOT_SIZE + 100000) {
            this.sendError(socket, 'メッセージが大きすぎます。');
            socket.close(4008, 'Message too large');
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
        const hasProject = state.projectRevision > 0 && state.projectChunkCount > 0;
        await this.updateHost(state);
        safeSend(socket, {
            type: 'welcome',
            entries,
            hostId: this.currentHostId || null,
            me: publicMember(member),
            memberToken,
            members: this.publicMembers(state),
            onlineUserIds: this.onlineUserIds(),
            opEpoch: Number.isInteger(state.opEpoch) ? state.opEpoch : 0,
            projectRevision: state.projectRevision,
            sequence: state.sequence,
            synchronizing: requiresFreshSnapshot(member) || hasProject
        });
        this.broadcastState(state);

        if (hasProject) {
            await this.sendStoredProject(socket, state);
        } else if (member.pendingFreshSnapshot) {
            safeSend(socket, {
                type: 'project_waiting',
                message: '最初のプロジェクトが共有されるまでお待ちください。'
            });
        } else if (EDITABLE_ROLES.has(member.role)) {
            safeSend(socket, {
                type: 'project_update_needed',
                revision: state.projectRevision
            });
        }
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

    /**
     * Relay op-based sync traffic between peers. The relay never inspects
     * op payloads beyond structural bounds; the peers validate envelopes.
     *
     * - op_propose (member -> host): client edit proposals.
     * - op_broadcast (host -> everyone): sequenced ops.
     * - op_reject / op_send (host -> one member): targeted replies.
     * - op_request (member -> host): gap replay requests.
     * @param {object} socket The sending peer's socket.
     * @param {object} member The sending member record.
     * @param {object} message The relay message.
     * @param {object} state The persisted room state.
     */
    async handleOpRelay (socket, member, message, state) {
        if (!EDITABLE_ROLES.has(member.role)) return;
        // Recover host tracking after a Durable Object restart.
        if (!this.currentHostId || !this.getHostSocket()) {
            await this.updateHost(state);
        }
        const isHost = this.currentHostId === member.id;
        switch (message.type) {
        case 'op_propose': {
            if (isHost) return; // the host edits directly, never proposes
            const hostSocket = this.getHostSocket();
            if (!hostSocket) return;
            const ops = this.normalizeRelayOps(message.ops);
            if (!ops) return;
            safeSend(hostSocket, {
                type: 'op_propose',
                epoch: Number(message.epoch) || 0,
                from: member.id,
                ops
            });
            return;
        }
        case 'op_broadcast': {
            if (!isHost) return;
            const ops = this.normalizeRelayOps(message.ops);
            if (!ops) return;
            for (const [recipient, session] of this.sessions.entries()) {
                if (recipient === socket || !session.memberId) continue;
                safeSend(recipient, {
                    type: 'op_broadcast',
                    epoch: Number(message.epoch) || 0,
                    ops
                });
            }
            return;
        }
        case 'op_request': {
            if (isHost) return;
            const hostSocket = this.getHostSocket();
            if (!hostSocket) return;
            const fromSeq = Number(message.fromSeq);
            if (!Number.isInteger(fromSeq) || fromSeq < 0) return;
            safeSend(hostSocket, {
                type: 'op_request',
                epoch: Number(message.epoch) || 0,
                from: member.id,
                fromSeq
            });
            return;
        }
        case 'op_reject':
        case 'op_send': {
            if (!isHost) return;
            const targetSocket = this.findSessionByMemberId(String(message.to || ''));
            if (!targetSocket) return;
            const relay = {type: message.type, epoch: Number(message.epoch) || 0};
            if (message.type === 'op_send') {
                const ops = this.normalizeRelayOps(message.ops);
                if (!ops) return;
                relay.ops = ops;
            } else {
                relay.clientOpId = Number(message.clientOpId) || 0;
                relay.reason = String(message.reason || '').slice(0, 200);
            }
            safeSend(targetSocket, relay);
            return;
        }
        default:
            return;
        }
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

    async handleRoleChange (socket, member, message, state) {
        if (!canAdminister(member)) {
            this.sendError(socket, '権限を変更できるのは管理者だけです。');
            return;
        }
        const target = state.members[String(message.memberId || '')];
        const role = String(message.role || '');
        if (!target || target.id === member.id || target.role === 'admin' ||
            !ALLOWED_ROLES.has(role) || role === 'admin') return;
        target.role = role;
        await this.putRoomState(state);
        this.broadcastState(state);
    }

    async handleAddAdmin (socket, member, message, state) {
        const target = state.members[String(message.memberId || '')];
        if (!canPromoteAdmin(member, target)) {
            this.sendError(socket, '管理者に追加できるのは同期済みのメンバーだけです。');
            return;
        }
        target.role = 'admin';
        if (!state.adminId) state.adminId = member.id;
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

    async handleProjectApplied (socket, member, message, state) {
        const session = this.getSession(socket);
        const revision = Number(message.revision);
        if (!canCompleteFreshSnapshot(member, session, revision)) return;
        member.pendingFreshSnapshot = false;
        session.snapshotDelivered = false;
        session.snapshotDeliveredSequence = null;
        socket.serializeAttachment(session);
        this.sessions.set(socket, session);
        await this.putRoomState(state);
        this.broadcastState(state);
    }

    async handleProjectResyncNeeded (socket, member, message, state) {
        const revision = Number(message.revision);
        if (!Number.isInteger(revision) || revision !== state.projectRevision) return;
        const session = this.getSession(socket);
        if (session.projectResyncRevision === revision) return;
        const donorSocket = findProjectResyncDonor(this.sessions, state.members, socket, member.id);
        if (!donorSocket) {
            safeSend(socket, {
                type: 'project_waiting',
                message: '再同期には、プロジェクトを開いている別の編集者が必要です。'
            });
            return;
        }
        session.projectResyncRevision = revision;
        socket.serializeAttachment(session);
        this.sessions.set(socket, session);
        member.pendingFreshSnapshot = true;
        state.members[member.id] = member;
        await this.putRoomState(state);
        safeSend(socket, {
            type: 'project_waiting',
            message: '別の編集者からプロジェクトを再取得しています。'
        });
        safeSend(donorSocket, {type: 'project_update_needed', revision});
    }

    markProjectDelivered (socket, state) {
        const session = this.getSession(socket);
        const member = session.memberId && state.members[session.memberId];
        if (!member || !member.pendingFreshSnapshot) return;
        session.snapshotDelivered = true;
        session.snapshotDeliveredSequence = state.projectRevision;
        socket.serializeAttachment(session);
        this.sessions.set(socket, session);
    }

    sendProjectPayload (socket, state, project, assets) {
        const assetChunkCounts = {};
        const projectChunkCount = Math.ceil(project.data.length / SNAPSHOT_CHUNK_SIZE);
        for (const name of Object.keys(assets)) {
            const data = assets[name];
            const count = Math.ceil(data.length / SNAPSHOT_CHUNK_SIZE);
            assetChunkCounts[name] = count;
        }
        safeSend(socket, {
            type: 'project_manifest',
            assetChunkCounts,
            assetNames: state.projectAssetNames,
            opEpoch: Number.isInteger(state.opEpoch) ? state.opEpoch : 0,
            opSeq: Number.isInteger(state.opSeq) ? state.opSeq : 0,
            projectChunkCount,
            projectEncoding: project.encoding,
            revision: state.projectRevision
        });
        for (let index = 0; index < projectChunkCount; index++) {
            safeSend(socket, {
                type: 'project_json_chunk',
                data: project.data.slice(index * SNAPSHOT_CHUNK_SIZE, (index + 1) * SNAPSHOT_CHUNK_SIZE),
                index,
                revision: state.projectRevision
            });
        }
        for (const [name, data] of Object.entries(assets)) {
            const count = assetChunkCounts[name];
            for (let index = 0; index < count; index++) {
                safeSend(socket, {
                    type: 'project_asset_chunk',
                    data: data.slice(index * SNAPSHOT_CHUNK_SIZE, (index + 1) * SNAPSHOT_CHUNK_SIZE),
                    index,
                    name,
                    revision: state.projectRevision
                });
            }
        }
        this.markProjectDelivered(socket, state);
    }

    async sendStoredProject (socket, state) {
        const keys = [];
        for (let index = 0; index < state.projectChunkCount; index++) {
            keys.push(`project-json:${padSequence(state.projectRevision)}:${padSequence(index)}`);
        }
        for (const name of state.projectAssetNames) {
            const count = Number(state.projectAssetChunks[name]) || 0;
            for (let index = 0; index < count; index++) {
                keys.push(`project-asset:${name}:${padSequence(index)}`);
            }
        }
        const stored = await this.getValues(keys);
        safeSend(socket, {
            type: 'project_manifest',
            assetChunkCounts: state.projectAssetChunks,
            assetNames: state.projectAssetNames,
            opEpoch: Number.isInteger(state.opEpoch) ? state.opEpoch : 0,
            opSeq: Number.isInteger(state.opSeq) ? state.opSeq : 0,
            projectChunkCount: state.projectChunkCount,
            projectEncoding: state.projectEncoding,
            revision: state.projectRevision
        });
        for (let index = 0; index < state.projectChunkCount; index++) {
            const key = `project-json:${padSequence(state.projectRevision)}:${padSequence(index)}`;
            safeSend(socket, {
                type: 'project_json_chunk',
                data: stored.get(key),
                index,
                revision: state.projectRevision
            });
        }
        for (const name of state.projectAssetNames) {
            const count = Number(state.projectAssetChunks[name]) || 0;
            for (let index = 0; index < count; index++) {
                const key = `project-asset:${name}:${padSequence(index)}`;
                safeSend(socket, {
                    type: 'project_asset_chunk',
                    data: stored.get(key),
                    index,
                    name,
                    revision: state.projectRevision
                });
            }
        }
        this.markProjectDelivered(socket, state);
    }

    async putValues (values) {
        const entries = Object.entries(values);
        for (let offset = 0; offset < entries.length; offset += 100) {
            await this.ctx.storage.put(Object.fromEntries(entries.slice(offset, offset + 100)));
        }
    }

    async getValues (keys) {
        const values = new Map();
        for (let offset = 0; offset < keys.length; offset += 100) {
            const batch = await this.ctx.storage.get(keys.slice(offset, offset + 100));
            for (const [key, value] of batch) values.set(key, value);
        }
        return values;
    }

    async deleteKeys (keys) {
        for (let offset = 0; offset < keys.length; offset += 100) {
            await this.ctx.storage.delete(keys.slice(offset, offset + 100));
        }
    }

    async handleProjectUpdate (socket, member, message, state) {
        if (!EDITABLE_ROLES.has(member.role)) {
            this.sendError(socket, '閲覧者はプロジェクトを編集できません。');
            return;
        }
        if (member.pendingFreshSnapshot) {
            this.sendError(socket, '最新プロジェクトを同期してから編集してください。');
            return;
        }
        const requestId = String(message.requestId || '').slice(0, 100);
        const baseRevision = Number(message.baseRevision);
        if (!requestId || !Number.isInteger(baseRevision) || baseRevision !== state.projectRevision) {
            safeSend(socket, {
                type: 'project_update_rejected',
                message: '別の参加者が先に更新したため、最新プロジェクトを読み込みます。',
                requestId,
                revision: state.projectRevision
            });
            if (state.projectRevision > 0) await this.sendStoredProject(socket, state);
            return;
        }
        const project = normalizeProjectPayload(message.project);
        const assetNames = normalizeAssetNames(message.assetNames);
        const assetNameSet = new Set(assetNames || []);
        const assets = message.assets && typeof message.assets === 'object' ? message.assets : {};
        let totalSize = project ? project.data.length : 0;
        for (const [name, data] of Object.entries(assets)) {
            if (!normalizeAssetName(name) || typeof data !== 'string' || !data.length ||
                !assetNames || !assetNameSet.has(name)) {
                totalSize = MAX_SNAPSHOT_SIZE + 1;
                break;
            }
            totalSize += data.length;
        }
        const currentNames = new Set(state.projectAssetNames);
        const missingAssets = assetNames && assetNames.filter(name => !currentNames.has(name) && !assets[name]);
        if (!project || !assetNames || missingAssets.length || totalSize > MAX_SNAPSHOT_SIZE) {
            this.sendError(socket, 'プロジェクトの同期データが大きすぎるか、形式が正しくありません。');
            return;
        }

        const values = {};
        const projectChunkCount = Math.ceil(project.data.length / SNAPSHOT_CHUNK_SIZE);
        const nextRevision = state.projectRevision + 1;
        for (let index = 0; index < projectChunkCount; index++) {
            values[`project-json:${padSequence(nextRevision)}:${padSequence(index)}`] =
                project.data.slice(index * SNAPSHOT_CHUNK_SIZE, (index + 1) * SNAPSHOT_CHUNK_SIZE);
        }
        const nextChunkCounts = {};
        for (const name of assetNames) {
            if (!assets[name]) {
                nextChunkCounts[name] = state.projectAssetChunks[name];
                continue;
            }
            const data = assets[name];
            const count = Math.ceil(data.length / SNAPSHOT_CHUNK_SIZE);
            nextChunkCounts[name] = count;
            for (let index = 0; index < count; index++) {
                values[`project-asset:${name}:${padSequence(index)}`] =
                    data.slice(index * SNAPSHOT_CHUNK_SIZE, (index + 1) * SNAPSHOT_CHUNK_SIZE);
            }
        }
        const removedKeys = [];
        for (let index = 0; index < state.projectChunkCount; index++) {
            removedKeys.push(`project-json:${padSequence(state.projectRevision)}:${padSequence(index)}`);
        }
        for (const name of state.projectAssetNames) {
            if (assetNameSet.has(name)) continue;
            const count = Number(state.projectAssetChunks[name]) || 0;
            for (let index = 0; index < count; index++) {
                removedKeys.push(`project-asset:${name}:${padSequence(index)}`);
            }
        }
        await this.putValues(values);
        // Project updates are serialized by runSerializedRoomMutation.
        // eslint-disable-next-line require-atomic-updates
        state.projectAssetChunks = nextChunkCounts;
        // eslint-disable-next-line require-atomic-updates
        state.projectAssetNames = assetNames;
        // eslint-disable-next-line require-atomic-updates
        state.projectChunkCount = projectChunkCount;
        // eslint-disable-next-line require-atomic-updates
        state.projectEncoding = project.encoding;
        // eslint-disable-next-line require-atomic-updates
        state.projectRevision = nextRevision;
        // Snapshot metadata for the op-based sync: receivers re-anchor
        // their op stream to the sender's position.
        if (Number.isInteger(message.opEpoch)) {
            // eslint-disable-next-line require-atomic-updates
            state.opEpoch = message.opEpoch;
        }
        if (Number.isInteger(message.opSeq)) {
            // eslint-disable-next-line require-atomic-updates
            state.opSeq = message.opSeq;
        }
        state.sequence += 1;
        await this.ctx.storage.put(ROOM_STATE_KEY, state);
        if (removedKeys.length) await this.deleteKeys(removedKeys);

        safeSend(socket, {
            type: 'project_update_accepted',
            requestId,
            revision: state.projectRevision
        });

        for (const [recipient, session] of this.sessions.entries()) {
            if (recipient === socket || !session.memberId) continue;
            const recipientMember = state.members[session.memberId];
            if (!recipientMember) continue;
            if (recipientMember.pendingFreshSnapshot) await this.sendStoredProject(recipient, state);
            else this.sendProjectPayload(recipient, state, project, assets);
        }
    }

    async webSocketClose (socket, code, reason) {
        this.sessions.delete(socket);
        const state = await this.getRoomState();
        await this.updateHost(state);
        this.broadcastState(state);
        try {
            socket.close(code, reason);
        } catch (error) {
            // The socket can already be closed by the runtime.
        }
    }
}
