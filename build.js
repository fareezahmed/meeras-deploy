#!/usr/bin/env node
/* Assemble the deployable site into dist/ for one environment.
 *
 *   node build.js                   production: meeras.com.au (Cloudflare Worker)
 *   node build.js --env staging     staging: meeras-staging.*.workers.dev (Stripe test mode, not indexed)
 *   node build.js --env dev         dev: fareez.dev/meeras (AWS, see deploy.sh)
 *
 * The site is the same single file in both environments. The build only
 * changes what must differ per host: the Umami analytics tag (which domains
 * it records, and which Umami website it reports to) and, for production,
 * a canonical link so search engines index meeras.com.au rather than the
 * dev copy. Production also gets Cloudflare's _headers file.
 * No Will clause text is touched.
 *
 * Environment variables (optional):
 *   UMAMI_WEBSITE_ID   overrides the production Umami website id (default: PROD_UMAMI_ID)
 */
const fs = require('fs');
const path = require('path');

const argEnv = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : null;
const env = argEnv || process.env.MEERAS_ENV || 'production';
const SHARED_UMAMI_ID = '95d7e13f-5749-4edc-a724-df39b41f5246';   // dev and staging
const PROD_UMAMI_ID = 'e52170c9-be50-41f7-85e8-70b8bfc36ad3';     // "Meeras (production)" in Umami
const ENVS = {
  production: {
    domains: 'meeras.com.au,www.meeras.com.au',
    canonical: 'https://meeras.com.au/',
    websiteId: process.env.UMAMI_WEBSITE_ID || PROD_UMAMI_ID,
    cloudflare: true,
  },
  staging: {
    // Umami only records the listed domains, so staging visits are not counted.
    domains: 'meeras.com.au',
    canonical: 'https://meeras.com.au/',
    websiteId: SHARED_UMAMI_ID,
    cloudflare: true,
    noindex: true,
  },
  dev: {
    domains: 'fareez.dev',
    canonical: null,
    websiteId: SHARED_UMAMI_ID,
    cloudflare: false,
  },
};
const cfg = ENVS[env];
if (!cfg) { console.error('Unknown environment: ' + env + ' (use production or dev)'); process.exit(1); }

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);

const UMAMI_TAG = /<script async src="https:\/\/analytics\.fareez\.dev\/script\.js"[^>]*><\/script>/;
const umamiTag = `<script async src="https://analytics.fareez.dev/script.js" data-website-id="${cfg.websiteId}" data-domains="${cfg.domains}"></script>`;

// index.html: analytics tag, and the canonical link for production.
let index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (!UMAMI_TAG.test(index)) throw new Error('Umami tag not found in index.html');
index = index.replace(UMAMI_TAG, umamiTag);
if (cfg.canonical) {
  const marker = '<meta name="description"';
  if (!index.includes(marker)) throw new Error('description meta not found in index.html');
  index = index.replace(marker, `<link rel="canonical" href="${cfg.canonical}">\n${marker}`);
}
fs.writeFileSync(path.join(DIST, 'index.html'), index);

// 404.html: same analytics tag.
let notFound = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
if (!UMAMI_TAG.test(notFound)) throw new Error('Umami tag not found in 404.html');
fs.writeFileSync(path.join(DIST, '404.html'), notFound.replace(UMAMI_TAG, umamiTag));

// Copied as they are.
// google663a0c67b107aea8.html is the Search Console ownership proof; keep it in place.
for (const f of ['donation-config.js', 'robots.txt', 'google663a0c67b107aea8.html']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}
// Web assets (logo, icons, social image). Sources in brand/ are not deployed.
fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });

if (cfg.cloudflare) {
  // Security and cache headers (Cloudflare's static-assets layer reads _headers from the output).
  // 'unsafe-inline' is needed: the app keeps its CSS and JS inline by design.
  fs.writeFileSync(path.join(DIST, '_headers'), [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: SAMEORIGIN',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
    ...(cfg.noindex ? ['  X-Robots-Tag: noindex, nofollow'] : []),
    "  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://analytics.fareez.dev https://tracker.metricool.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://tracker.metricool.com; connect-src 'self' https://analytics.fareez.dev; frame-ancestors 'self'; base-uri 'self'",
    // The page itself keeps Cloudflare's default (max-age=0, must-revalidate):
    // /index.html is normalised to / with a redirect, and revalidation means a
    // deploy is picked up on the next visit.
    '/donation-config.js',
    '  Cache-Control: max-age=300, public',
    '',
  ].join('\n'));
  // No _redirects: Workers static assets accept only relative source paths,
  // so a www -> apex hop cannot live here. Both hostnames serve the site and
  // the canonical link points at the apex; add a zone Redirect Rule in the
  // Cloudflare dashboard if the hop is wanted (see DEPLOYMENT.md Part 8).
}

const crypto = require('crypto');
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(path.join(DIST, f))).digest('hex');
console.log(`Built dist/ for ${env}${cfg.noindex ? ' (noindex)' : ''}`);
console.log(`  analytics domains : ${cfg.domains}`);
console.log(`  umami website id  : ${cfg.websiteId}`);
console.log(`  canonical         : ${cfg.canonical || '(none)'}`);
console.log(`  files             : ${fs.readdirSync(DIST).join(', ')} (+ ${fs.readdirSync(path.join(DIST, 'assets', 'logo')).length} logo assets)`);
console.log(`  dist/index.html   : ${md5('index.html')}`);
