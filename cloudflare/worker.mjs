// Script paths are content-hashed and cached as immutable, so the single-page-application
// fallback (index.html) must never be served for them: a cache would keep that HTML for a year
// and the chunk (e.g. addons) would never load again.
const fetchAsset = async (request, env, url) => {
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (url.pathname.startsWith('/js/') && contentType.startsWith('text/html')) {
        return new Response('Not found', {
            status: 404,
            headers: {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/plain; charset=utf-8'
            }
        });
    }
    return response;
};

export default {
    fetch (request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/p' || url.pathname.startsWith('/p/')) {
            // Share links (/p/<payload>) were removed. Send old links to the editor instead of a broken page;
            // the empty fragment drops a payload after "#" so it is not read as a project id.
            return Response.redirect(new URL('/#', url).href, 302);
        }
        return fetchAsset(request, env, url);
    }
};
