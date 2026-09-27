// Share links live at /p/<payload> (or /p/#<payload> for long ones). The app is built with relative
// asset URLs, so the page served there asks for /p/js/..., /p/static/... and so on; those map back to
// the root. Payloads are base64url and never contain "." or "/", unlike every asset path.
const SHARE_PAGE_PATTERN = /^\/p\/?(?:[A-Za-z0-9_-]+\/?)?$/;

const resolveSharePath = pathname => {
    const path = String(pathname || '');
    if (SHARE_PAGE_PATTERN.test(path)) return '/';
    if (path.startsWith('/p/')) return path.slice(2);
    return null;
};

export {
    resolveSharePath
};
