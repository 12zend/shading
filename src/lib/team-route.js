const RESERVED_PATHS = new Set([
    'addons',
    'credits',
    'editor',
    'embed',
    'fullscreen',
    'player',
    'privacy',
    'static'
]);

const TEAM_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{4,46}[a-z0-9])$/;
const CREATED_TEAM_PREFIX = 'movie:team-created:';
const TEAM_CLAIM_PREFIX = 'movie:team-claim:';
const TEAM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const createdTeamIds = new Set();

const rememberCreatedTeam = teamId => {
    createdTeamIds.add(teamId);
    try {
        sessionStorage.setItem(`${CREATED_TEAM_PREFIX}${teamId}`, '1');
    } catch (error) {
        // The in-memory marker still covers browsers with session storage disabled.
    }
};

const wasTeamCreatedInSession = teamId => {
    if (createdTeamIds.has(teamId)) return true;
    try {
        return sessionStorage.getItem(`${CREATED_TEAM_PREFIX}${teamId}`) === '1';
    } catch (error) {
        return false;
    }
};

const randomTeamId = () => {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(20);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index++) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }
    let id = '';
    for (const byte of bytes) id += alphabet[byte % alphabet.length];
    return id;
};

const normalizeTeamId = value => {
    const normalized = String(value || '').trim()
        .toLowerCase();
    if (!TEAM_ID_PATTERN.test(normalized) || RESERVED_PATHS.has(normalized)) return null;
    return normalized;
};

const getTeamIdFromPath = (pathname = location.pathname, root = process.env.ROOT || '/') => {
    const normalizedRoot = root && root !== '/' ? root.replace(/^\/+|\/+$/g, '') : '';
    const parts = String(pathname || '').split('/')
        .filter(Boolean);
    if (normalizedRoot && parts[0] === normalizedRoot) parts.shift();
    return normalizeTeamId(parts[0]);
};

const getTeamPath = (teamId, root = process.env.ROOT || '/') => {
    const normalizedRoot = root === '/' ? '' : String(root || '').replace(/^\/+|\/+$/g, '');
    const prefix = normalizedRoot ? `/${normalizedRoot}` : '';
    return `${prefix}/${normalizeTeamId(teamId) || randomTeamId()}`;
};

const ensureTeamId = () => {
    const existing = getTeamIdFromPath();
    if (existing) return existing;
    const teamId = randomTeamId();
    rememberCreatedTeam(teamId);
    const nextPath = `${getTeamPath(teamId)}${location.search}${location.hash}`;
    history.replaceState(null, '', nextPath);
    return teamId;
};

const deriveTeamIdFromClaimToken = async claimToken => {
    const encoded = new TextEncoder().encode(claimToken);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
    let teamId = '';
    for (let index = 0; index < 20; index++) {
        teamId += TEAM_ALPHABET[digest[index] % TEAM_ALPHABET.length];
    }
    return teamId;
};

// Creates a collaboration link on demand. Mirrors the claim derivation in cloudflare/team-claim.js
// so the room accepts this browser as the founding administrator.
const activateTeamRoute = async () => {
    const existing = getTeamIdFromPath();
    if (existing) return existing;
    if (typeof crypto === 'undefined' || !crypto.getRandomValues || !crypto.subtle) {
        throw new Error('このブラウザーでは共同編集リンクを生成できません。');
    }
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const claimToken = Array.from(secretBytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    const teamId = await deriveTeamIdFromClaimToken(claimToken);
    rememberCreatedTeam(teamId);
    try {
        sessionStorage.setItem(`${TEAM_CLAIM_PREFIX}${teamId}`, claimToken);
    } catch (error) {
        window.ShadingTeamClaim = {teamId, token: claimToken};
    }
    const nextPath = `${getTeamPath(teamId)}${location.search}${location.hash}`;
    history.replaceState(null, '', nextPath);
    if (typeof PopStateEvent === 'function') {
        window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return teamId;
};

const startAfterTeamRouteReady = (callback, ready = window.ShadingTeamReady) => {
    if (ready && typeof ready.then === 'function') return ready.then(callback, callback);
    return callback();
};

export {
    RESERVED_PATHS,
    TEAM_ID_PATTERN,
    activateTeamRoute,
    ensureTeamId,
    getTeamIdFromPath,
    getTeamPath,
    normalizeTeamId,
    randomTeamId,
    startAfterTeamRouteReady,
    wasTeamCreatedInSession
};
