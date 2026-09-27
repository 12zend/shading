// URLs of share links: <origin>/p/<payload>.
//
// Servers and CDNs reject request lines longer than a few KB, so longer payloads are placed after
// "#" (<origin>/p/#<payload>): the fragment never leaves the browser, so its length is bounded only
// by the browser itself.

const SHARE_PATH_SEGMENT = 'p';
// Well below the 16 KB request line limit of Cloudflare and Node.
const MAX_PATH_PAYLOAD_LENGTH = 8000;
// Longest URL Chromium-based browsers navigate to (and Firefox's default network.standard-url.max-length).
const CHROMIUM_URL_LIMIT = 2 * 1024 * 1024;
const FIREFOX_URL_LIMIT = 1024 * 1024;
const PUBLIC_ORIGIN = 'https://shading.app';
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/;

const getRootPath = (root = process.env.ROOT || '') => {
    const trimmed = String(root || '').replace(/^\/+|\/+$/g, '');
    return trimmed ? `/${trimmed}/` : '/';
};

const getSharePathSegments = (pathname, root) => {
    const rootPath = getRootPath(root);
    const path = String(pathname || '');
    if (!path.startsWith(rootPath)) return null;
    const parts = path.slice(rootPath.length).split('/');
    return parts[0] === SHARE_PATH_SEGMENT ? parts.slice(1) : null;
};

const isSharePath = (pathname = location.pathname, root) => getSharePathSegments(pathname, root) !== null;

const cleanPayload = value => {
    let payload = String(value || '');
    try {
        payload = decodeURIComponent(payload);
    } catch (error) {
        // Keep the raw text; validation below rejects it if it is not a payload.
    }
    payload = payload.replace(/\s+/g, '');
    return PAYLOAD_PATTERN.test(payload) ? payload : null;
};

/**
 * @param {string} pathname location.pathname
 * @param {string} hash location.hash
 * @param {string} [root] Deployment root (process.env.ROOT).
 * @returns {?string} The share payload, or null when this is not a share link.
 */
const parseSharePayload = (pathname, hash, root) => {
    const segments = getSharePathSegments(pathname, root);
    if (!segments) return null;
    if (segments[0]) return cleanPayload(segments[0]);
    return cleanPayload(String(hash || '').replace(/^#/, ''));
};

/**
 * Accepts a pasted share link (either URL form) or a bare payload.
 * @param {string} text Pasted text.
 * @returns {?string} The payload, or null when the text contains none.
 */
const extractSharePayload = text => {
    const value = String(text || '').replace(/\s+/g, '');
    const marker = `/${SHARE_PATH_SEGMENT}/`;
    const index = value.indexOf(marker);
    if (index === -1) return cleanPayload(value.replace(/^#/, ''));
    const rest = value.slice(index + marker.length).replace(/^#/, '');
    const match = /^[A-Za-z0-9_%-]+/.exec(rest);
    return match ? cleanPayload(match[0]) : null;
};

const buildSharePath = (payload, root) => {
    const separator = payload.length <= MAX_PATH_PAYLOAD_LENGTH ? '' : '#';
    return `${getRootPath(root)}${SHARE_PATH_SEGMENT}/${separator}${payload}`;
};

const getShareOrigin = () => {
    // The desktop app serves the editor from a private local origin; its links point at the public site.
    const isDesktop = typeof window !== 'undefined' && Boolean(window.shadingDesktop);
    if (!isDesktop && typeof location !== 'undefined' &&
        (location.protocol === 'http:' || location.protocol === 'https:')) {
        return location.origin;
    }
    return PUBLIC_ORIGIN;
};

const buildShareURL = (payload, root) => `${getShareOrigin()}${buildSharePath(payload, root)}`;

let pendingPayload = typeof location === 'undefined' ? null : parseSharePayload(location.pathname, location.hash);

/**
 * Returns the share payload that the next project load should open, at most once.
 * @returns {?string} Payload or null.
 */
const takePendingSharePayload = () => {
    const payload = pendingPayload;
    pendingPayload = null;
    return payload;
};

const setPendingSharePayload = payload => {
    pendingPayload = payload;
};

export {
    CHROMIUM_URL_LIMIT,
    FIREFOX_URL_LIMIT,
    MAX_PATH_PAYLOAD_LENGTH,
    buildSharePath,
    buildShareURL,
    extractSharePayload,
    getRootPath,
    isSharePath,
    parseSharePayload,
    setPendingSharePayload,
    takePendingSharePayload
};
