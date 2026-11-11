/* Meeras Worker (production, main branch). The site is static assets; this
 * script runs first on every request (run_worker_first) and does a few
 * small things before handing over to the assets, all so Google sees one
 * canonical page, https://meeras.com.au/:
 *   1. redirects www.meeras.com.au to meeras.com.au (one canonical host);
 *   2. redirects plain http to https on the production hostnames;
 *   3. answers the Google Search Console ownership file at its exact URL
 *      (the assets layer would 307-redirect "/name.html" to "/name");
 *   4. makes the assets layer's .html redirects permanent (301, not 307),
 *      so /index.html consolidates into / instead of being a separate URL;
 *   5. serves the not-found page with a real 404 status even when it is
 *      requested by name (/404, /404.html), so it is never a soft 404.
 * Staging (*.workers.dev) is left alone by 1 and 2.
 */
const APEX = 'meeras.com.au';
const GOOGLE_VERIFICATION = {
  '/google663a0c67b107aea8.html': 'google-site-verification: google663a0c67b107aea8.html',
};
const NOT_FOUND_PATHS = new Set(['/404', '/404.html']);

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
    if (NOT_FOUND_PATHS.has(url.pathname)) {
      const page = await env.ASSETS.fetch(new Request(new URL('/404', url), request));
      const headers = new Headers(page.headers);
      headers.set('X-Robots-Tag', 'noindex');
      return new Response(page.body, { status: 404, headers });
    }
    const res = await env.ASSETS.fetch(request);
    // The assets layer normalises "/index.html" to "/" (and "/x.html" to "/x")
    // with a 307. Make it a 301 so search engines merge the two URLs.
    if (res.status === 307 || res.status === 308) {
      const location = res.headers.get('Location');
      if (location) return Response.redirect(new URL(location, url).toString(), 301);
    }
    return res;
  },
};
