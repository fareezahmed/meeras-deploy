/* Meeras Worker (production, main branch). The site is static assets; this
 * script runs first on every request (run_worker_first) and does three
 * small things before handing over to the assets:
 *   1. redirects www.meeras.com.au to meeras.com.au (one canonical host);
 *   2. redirects plain http to https on the production hostnames;
 *   3. answers the Google Search Console ownership file at its exact URL
 *      (the assets layer would 307-redirect "/name.html" to "/name").
 * Staging (*.workers.dev) is left alone by 1 and 2.
 */
const APEX = 'meeras.com.au';
const GOOGLE_VERIFICATION = {
  '/google663a0c67b107aea8.html': 'google-site-verification: google663a0c67b107aea8.html',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    // The scheme the visitor used: Cloudflare puts it in cf-visitor on proxied requests.
    let scheme = url.protocol.replace(':', '');
    try { const v = JSON.parse(request.headers.get('cf-visitor') || '{}'); if (v.scheme) scheme = v.scheme; } catch (e) {}
    if (host === 'www.' + APEX || (host === APEX && scheme !== 'https')) {
      const target = 'https://' + APEX + url.pathname + url.search;
      if (target !== request.url) return Response.redirect(target, 301);
    }
    const body = GOOGLE_VERIFICATION[url.pathname];
    if (body !== undefined) {
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex' } });
    }
    return env.ASSETS.fetch(request);
  },
};
