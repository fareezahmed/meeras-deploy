/* Meeras Worker (production, main branch). The site is static assets; this
 * script runs only for the paths listed in wrangler.toml's run_worker_first.
 *
 * The Google Search Console ownership file must answer at its exact URL with
 * status 200. The assets layer would 307-redirect "/name.html" to "/name",
 * so that one path is answered here instead.
 */
const GOOGLE_VERIFICATION = {
  '/google663a0c67b107aea8.html': 'google-site-verification: google663a0c67b107aea8.html',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const body = GOOGLE_VERIFICATION[url.pathname];
    if (body !== undefined) {
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex' } });
    }
    return env.ASSETS.fetch(request);
  },
};
