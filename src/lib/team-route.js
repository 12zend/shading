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

const startAfterTeamRouteReady = (callback, ready = window.ShadingTeamReady) => {
    if (ready && typeof ready.then === 'function') return ready.then(callback, callback);
    return callback();
};

export {
    RESERVED_PATHS,
    TEAM_ID_PATTERN,
    ensureTeamId,
    getTeamIdFromPath,
    getTeamPath,
    normalizeTeamId,
    randomTeamId,
    startAfterTeamRouteReady,
    wasTeamCreatedInSession
};
