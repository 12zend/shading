// Cloudflare Pages: runs only for /js/*.
// Script paths are content-hashed and cached as immutable, so the single-page-application
// fallback (index.html) must never be served for them: a cache would keep that HTML for a year
// and the chunk (e.g. addons) would never load again.
export const onRequest = async context => {
    const response = await context.next();
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('text/html')) {
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
