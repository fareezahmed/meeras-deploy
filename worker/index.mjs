/* Meeras Worker: serves the static site (dist/, via the ASSETS binding) and the
 * small member API under /api/. Everything else is the static site, unchanged.
 *
 * What the API stores (D1, see migrations/):
 *   - the member's email address, membership plan and status, Stripe ids;
 *   - one encrypted "vault" per member: ciphertext made in the browser with a
 *     key derived from the member's passphrase. The server cannot read it.
 *   - consultation requests (only when CONSULT_ENABLED is "1").
 *
 * Secrets (wrangler secret put ...): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 * RESEND_API_KEY. Vars (wrangler.toml): EMAIL_FROM, PRICE_YEARLY_CENTS,
 * PRICE_LIFETIME_CENTS, CONSULT_ENABLED, CONSULT_NOTIFY_TO, DEV_EXPOSE_LINKS.
 *
 * Sign-in is by emailed link: no passwords are stored. Sessions are random
 * tokens in an HttpOnly cookie; only their SHA-256 hash is kept.
 */

const SESSION_COOKIE = 'meeras_session';
const SESSION_DAYS = 30;
const LOGIN_TOKEN_MINUTES = 20;
const MAX_VAULT_BYTES = 2 * 1024 * 1024;
const GRACE_DAYS = 14;          // a yearly membership keeps saving rights this long past its end date

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('[api]', url.pathname, err && err.stack || err);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function route(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;

  // Stripe calls this one directly; it is verified by signature instead.
  if (p === '/api/stripe/webhook' && m === 'POST') return stripeWebhook(request, env);

  if (m !== 'GET' && m !== 'HEAD') checkSameOrigin(request, url);

  if (p === '/api/config' && m === 'GET') return json(publicConfig(env));
  if (p === '/api/auth/request' && m === 'POST') return authRequest(request, env, url);
  if (p === '/api/auth/verify' && m === 'POST') return authVerify(request, env);
  if (p === '/api/auth/logout' && m === 'POST') return authLogout(request, env);
  if (p === '/api/me' && m === 'GET') return me(request, env);
  if (p === '/api/vault' && m === 'GET') return vaultGet(request, env);
  if (p === '/api/vault' && m === 'PUT') return vaultPut(request, env);
  if (p === '/api/account' && m === 'DELETE') return accountDelete(request, env);
  if (p === '/api/billing/checkout' && m === 'POST') return billingCheckout(request, env, url);
  if (p === '/api/billing/portal' && m === 'POST') return billingPortal(request, env, url);
  if (p === '/api/billing/confirm' && m === 'POST') return billingConfirm(request, env);
  if (p === '/api/consult' && m === 'POST') return consultRequest(request, env);
  throw new HttpError(404, 'Not found');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

// State-changing calls must come from the site itself. SameSite=Lax already
// keeps the cookie off cross-site POSTs; this is a second, explicit check.
function checkSameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-site request refused');
  if (!origin) {
    const site = request.headers.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Cross-site request refused');
  }
}

async function readJson(request, limit = 16 * 1024) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > limit) throw new HttpError(413, 'Request too large');
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, 'Request too large');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

const enc = new TextEncoder();
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomToken(n = 32) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
async function sha256hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}
function newId(prefix) { return prefix + '_' + randomToken(12); }
function nowIso() { return new Date().toISOString(); }
function normEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return null;
  return s;
}
function cleanText(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max); }
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Fixed-window rate limit kept in D1. Returns false when the limit is hit.
async function rateLimit(env, key, limit, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || now - row.window_start > windowMs) {
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1').bind(key, now).run();
    return true;
  }
  if (row.count >= limit) return false;
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
  return true;
}

function clientIp(request) { return request.headers.get('CF-Connecting-IP') || 'local'; }

function publicConfig(env) {
  return {
    accounts: true,
    billing: !!env.STRIPE_SECRET_KEY,
    email: !!env.RESEND_API_KEY || env.DEV_EXPOSE_LINKS === '1',
    consult: env.CONSULT_ENABLED === '1',
    // The site only advertises membership once payments and sign-in email both work
    // (staging shows it anyway so the flow can be tested with on-screen links).
    ready: (!!env.STRIPE_SECRET_KEY && !!env.RESEND_API_KEY) || env.DEV_EXPOSE_LINKS === '1',
    prices: { yearly: Number(env.PRICE_YEARLY_CENTS || 1500), lifetime: Number(env.PRICE_LIFETIME_CENTS || 7900), currency: 'AUD' },
  };
}

// ─── Membership state ───────────────────────────────────────────────────────

function membership(acc) {
  if (!acc) return { plan: null, status: 'none', active: false, paidUntil: null };
  let active = false;
  if (acc.plan === 'lifetime' && acc.status === 'active') active = true;
  if (acc.plan === 'yearly' && (acc.status === 'active' || acc.status === 'past_due')) {
    const until = acc.paid_until ? Date.parse(acc.paid_until) : 0;
    active = !until || until + GRACE_DAYS * 864e5 > Date.now();
  }
  return { plan: acc.plan || null, status: acc.status, active, paidUntil: acc.paid_until || null };
}

async function currentAccount(request, env) {
  const raw = parseCookies(request)[SESSION_COOKIE];
  if (!raw) return null;
  const hash = await sha256hex(raw);
  const s = await env.DB.prepare('SELECT account_id, expires_at FROM sessions WHERE id_hash = ?').bind(hash).first();
  if (!s || s.expires_at < Date.now()) return null;
  return env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(s.account_id).first();
}
async function requireAccount(request, env) {
  const acc = await currentAccount(request, env);
  if (!acc) throw new HttpError(401, 'Please sign in again.');
  return acc;
}

// ─── Sign-in by emailed link ────────────────────────────────────────────────

async function authRequest(request, env, url) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  if (!email) throw new HttpError(400, 'Please enter a valid email address.');
  const okIp = await rateLimit(env, 'ip:' + clientIp(request), 20, 3600e3);
  const okEmail = await rateLimit(env, 'em:' + await sha256hex(email), 5, 3600e3);
  if (!okIp || !okEmail) throw new HttpError(429, 'Too many sign-in emails. Please wait an hour and try again.');

  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256hex(token), email, Date.now() + LOGIN_TOKEN_MINUTES * 60e3).run();
  const link = `${url.origin}/?signin=${encodeURIComponent(token)}#account`;

  if (env.RESEND_API_KEY) {
    await sendEmail(env, {
      to: email,
      subject: 'Your Meeras sign-in link',
      text: `Assalamu alaykum,\n\nUse this link to sign in to Meeras. It works once and expires in ${LOGIN_TOKEN_MINUTES} minutes:\n\n${link}\n\nIf you did not ask for this, you can ignore this email.\n\nMeeras, operated by WIZINSIGHTS PTY LTD (ABN 48 669 478 497)`,
      html: `<p>Assalamu alaykum,</p><p>Use this link to sign in to Meeras. It works once and expires in ${LOGIN_TOKEN_MINUTES} minutes.</p><p><a href="${escHtml(link)}" style="display:inline-block;background:#1B4D6B;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600;">Sign in to Meeras</a></p><p style="color:#666;font-size:13px;">If the button does not work, copy this address into your browser:<br>${escHtml(link)}</p><p style="color:#666;font-size:13px;">If you did not ask for this, you can ignore this email.</p><p style="color:#999;font-size:12px;">Meeras, operated by WIZINSIGHTS PTY LTD (ABN 48 669 478 497)</p>`,
    });
    return json({ sent: true });
  }
  if (env.DEV_EXPOSE_LINKS === '1') return json({ sent: true, devLink: link });
  throw new HttpError(503, 'Sign-in email is not set up yet.');
}

async function authVerify(request, env) {
  const body = await readJson(request);
  const token = String(body.token || '');
  if (!token || token.length > 100) throw new HttpError(400, 'This sign-in link is not valid.');
  const hash = await sha256hex(token);
  const row = await env.DB.prepare('SELECT email, expires_at, used FROM login_tokens WHERE token_hash = ?').bind(hash).first();
  if (!row || row.used || row.expires_at < Date.now()) throw new HttpError(400, 'This sign-in link has expired or was already used. Please ask for a new one.');
  await env.DB.prepare('UPDATE login_tokens SET used = 1 WHERE token_hash = ?').bind(hash).run();

  let acc = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(row.email).first();
  if (!acc) {
    const id = newId('acc');
    await env.DB.prepare("INSERT INTO accounts (id, email, created_at, status) VALUES (?, ?, ?, 'none')").bind(id, row.email, nowIso()).run();
    acc = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  }
  const sid = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (id_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256hex(sid), acc.id, Date.now(), Date.now() + SESSION_DAYS * 864e5).run();
  // Housekeeping: drop expired tokens and sessions now and then.
  await env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(Date.now() - 864e5).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
  return json(await meBody(env, acc), 200, { 'Set-Cookie': sessionCookie(sid, SESSION_DAYS * 86400, request) });
}

function sessionCookie(value, maxAge, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function authLogout(request, env) {
  const raw = parseCookies(request)[SESSION_COOKIE];
  if (raw) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256hex(raw)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0, request) });
}

async function meBody(env, acc) {
  const v = await env.DB.prepare('SELECT size, updated_at FROM vaults WHERE account_id = ?').bind(acc.id).first();
  return {
    email: acc.email,
    membership: membership(acc),
    vault: v ? { size: v.size, updatedAt: v.updated_at } : null,
    canManageBilling: !!(acc.stripe_customer && acc.plan === 'yearly'),
  };
}

async function me(request, env) {
  const acc = await currentAccount(request, env);
  if (!acc) return json({ signedIn: false });
  return json({ signedIn: true, ...(await meBody(env, acc)) });
}

// ─── Encrypted vault ────────────────────────────────────────────────────────

async function vaultGet(request, env) {
  const acc = await requireAccount(request, env);
  const v = await env.DB.prepare('SELECT blob, updated_at, version FROM vaults WHERE account_id = ?').bind(acc.id).first();
  if (!v) return json({ vault: null });
  return json({ vault: JSON.parse(v.blob), updatedAt: v.updated_at, version: v.version });
}

async function vaultPut(request, env) {
  const acc = await requireAccount(request, env);
  if (!membership(acc).active) throw new HttpError(402, 'Saving to your account needs an active membership.');
  const body = await readJson(request, MAX_VAULT_BYTES + 4096);
  const vault = body.vault;
  // The server checks shape only; the contents are ciphertext it cannot read.
  if (!vault || vault.format !== 'meeras-vault' || vault.v !== 1 || typeof vault.ct !== 'string' || typeof vault.iv !== 'string' || !vault.keys || !vault.keys.pass) {
    throw new HttpError(400, 'That does not look like an encrypted Meeras record.');
  }
  if (body.consent !== true && !acc.consent_at) throw new HttpError(400, 'Please confirm the storage consent first.');
  const blob = JSON.stringify(vault);
  if (blob.length > MAX_VAULT_BYTES) throw new HttpError(413, 'Your saved Wills are too large to store.');
  const existing = await env.DB.prepare('SELECT version FROM vaults WHERE account_id = ?').bind(acc.id).first();
  // Optimistic concurrency: refuse to overwrite a newer copy saved from another device.
  if (existing && Number.isInteger(body.baseVersion) && body.baseVersion !== existing.version) {
    throw new HttpError(409, 'Your account was updated from another device. Open it again, then save.');
  }
  const version = existing ? existing.version + 1 : 1;
  const ts = nowIso();
  await env.DB.prepare('INSERT INTO vaults (account_id, blob, size, version, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET blob = excluded.blob, size = excluded.size, version = excluded.version, updated_at = excluded.updated_at')
    .bind(acc.id, blob, blob.length, version, ts).run();
  if (!acc.consent_at) await env.DB.prepare('UPDATE accounts SET consent_at = ? WHERE id = ?').bind(ts, acc.id).run();
  return json({ ok: true, updatedAt: ts, version });
}

async function accountDelete(request, env) {
  const acc = await requireAccount(request, env);
  if (acc.stripe_subscription && env.STRIPE_SECRET_KEY) {
    try { await stripe(env, 'DELETE', `/v1/subscriptions/${encodeURIComponent(acc.stripe_subscription)}`); }
    catch (e) { console.warn('[api] subscription cancel failed', e && e.message); }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM vaults WHERE account_id = ?').bind(acc.id),
    env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(acc.id),
    env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(acc.id),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0, request) });
}

// ─── Stripe ─────────────────────────────────────────────────────────────────

function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}

async function stripe(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Payments are not set up yet.');
  const res = await fetch('https://api.stripe.com' + path, {
    method,
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? form(params) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[stripe]', path, res.status, data && data.error && data.error.message);
    throw new HttpError(502, 'The payment service returned an error. Please try again.');
  }
  return data;
}

async function billingCheckout(request, env, url) {
  const acc = await requireAccount(request, env);
  const body = await readJson(request);
  const plan = body.plan === 'lifetime' ? 'lifetime' : body.plan === 'yearly' ? 'yearly' : null;
  if (!plan) throw new HttpError(400, 'Choose yearly or lifetime.');
  const m = membership(acc);
  if (m.active && (m.plan === 'lifetime' || plan === m.plan)) throw new HttpError(409, 'You already have this membership.');
  const cents = plan === 'yearly' ? Number(env.PRICE_YEARLY_CENTS || 1500) : Number(env.PRICE_LIFETIME_CENTS || 7900);
  const price_data = {
    currency: 'aud',
    unit_amount: cents,
    product_data: { name: plan === 'yearly' ? 'Meeras membership (yearly)' : 'Meeras membership (lifetime)' },
  };
  if (plan === 'yearly') price_data.recurring = { interval: 'year' };
  const params = {
    mode: plan === 'yearly' ? 'subscription' : 'payment',
    'line_items': { 0: { price_data, quantity: 1 } },
    client_reference_id: acc.id,
    metadata: { account_id: acc.id, plan },
    success_url: `${url.origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#account`,
    cancel_url: `${url.origin}/?checkout=cancelled#account`,
    locale: 'en',
  };
  if (acc.stripe_customer) params.customer = acc.stripe_customer;
  else {
    params.customer_email = acc.email;
    if (plan === 'lifetime') params.customer_creation = 'always';
  }
  if (plan === 'yearly') params.subscription_data = { metadata: { account_id: acc.id, plan } };
  else params.payment_intent_data = { metadata: { account_id: acc.id, plan }, description: 'Meeras lifetime membership' };
  const session = await stripe(env, 'POST', '/v1/checkout/sessions', params);
  return json({ url: session.url });
}

async function billingPortal(request, env, url) {
  const acc = await requireAccount(request, env);
  if (!acc.stripe_customer) throw new HttpError(400, 'There is no billing account to manage yet.');
  const s = await stripe(env, 'POST', '/v1/billing_portal/sessions', { customer: acc.stripe_customer, return_url: `${url.origin}/#account` });
  return json({ url: s.url });
}

// After Checkout redirects back, confirm straight away so the member does not
// wait for the webhook. The webhook applies the same update (idempotently).
async function billingConfirm(request, env) {
  const acc = await requireAccount(request, env);
  const body = await readJson(request);
  const id = String(body.sessionId || '');
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw new HttpError(400, 'Invalid checkout reference.');
  const s = await stripe(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(id)}?expand[]=subscription`);
  if (s.client_reference_id !== acc.id) throw new HttpError(403, 'That payment belongs to a different account.');
  await applyCheckoutSession(env, s);
  const fresh = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(acc.id).first();
  return json(await meBody(env, fresh));
}

function periodEnd(sub) {
  const t = sub && (sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end));
  return t ? new Date(t * 1000).toISOString() : null;
}

async function applyCheckoutSession(env, s) {
  const accountId = s.client_reference_id || (s.metadata && s.metadata.account_id);
  if (!accountId) return;
  const plan = (s.metadata && s.metadata.plan) || (s.mode === 'subscription' ? 'yearly' : 'lifetime');
  const paid = s.payment_status === 'paid' || s.payment_status === 'no_payment_required' || s.status === 'complete';
  if (!paid) return;
  const customer = typeof s.customer === 'string' ? s.customer : s.customer && s.customer.id;
  if (plan === 'lifetime') {
    await env.DB.prepare("UPDATE accounts SET plan = 'lifetime', status = 'active', paid_until = NULL, stripe_customer = COALESCE(?, stripe_customer) WHERE id = ?")
      .bind(customer || null, accountId).run();
    // A member upgrading from yearly to lifetime should not keep paying yearly.
    const acc = await env.DB.prepare('SELECT stripe_subscription FROM accounts WHERE id = ?').bind(accountId).first();
    if (acc && acc.stripe_subscription) {
      try { await stripe(env, 'DELETE', `/v1/subscriptions/${encodeURIComponent(acc.stripe_subscription)}`); } catch (e) {}
      await env.DB.prepare('UPDATE accounts SET stripe_subscription = NULL WHERE id = ?').bind(accountId).run();
    }
  } else {
    let sub = s.subscription;
    if (typeof sub === 'string') sub = await stripe(env, 'GET', `/v1/subscriptions/${encodeURIComponent(sub)}`);
    await env.DB.prepare("UPDATE accounts SET plan = 'yearly', status = 'active', paid_until = ?, stripe_customer = COALESCE(?, stripe_customer), stripe_subscription = ? WHERE id = ? AND (plan IS NULL OR plan != 'lifetime')")
      .bind(periodEnd(sub), customer || null, sub && sub.id || null, accountId).run();
  }
}

async function applySubscription(env, sub) {
  const accountId = sub.metadata && sub.metadata.account_id;
  const where = accountId ? 'id = ?' : 'stripe_subscription = ?';
  const key = accountId || sub.id;
  const status = sub.status === 'active' || sub.status === 'trialing' ? 'active'
    : sub.status === 'past_due' || sub.status === 'unpaid' ? 'past_due' : 'canceled';
  await env.DB.prepare(`UPDATE accounts SET status = ?, paid_until = ?, stripe_subscription = ? WHERE ${where} AND plan = 'yearly'`)
    .bind(status, periodEnd(sub), sub.id, key).run();
}

async function verifyStripeSignature(secret, header, payload, toleranceSec = 300) {
  const parts = Object.fromEntries((header || '').split(',').map(kv => kv.split('=')).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = (header || '').split(',').filter(x => x.trim().startsWith('v1=')).map(x => x.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  const expected = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => timingSafeEqual(s, expected));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function stripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'not configured' }, 503);
  const payload = await request.text();
  const ok = await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, request.headers.get('Stripe-Signature'), payload);
  if (!ok) return json({ error: 'bad signature' }, 400);
  const event = JSON.parse(payload);
  const seen = await env.DB.prepare('SELECT id FROM stripe_events WHERE id = ?').bind(event.id).first();
  if (seen) return json({ received: true, duplicate: true });
  const obj = event.data && event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await applyCheckoutSession(env, obj);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applySubscription(env, obj);
      break;
    case 'invoice.paid':
      if (obj.subscription || (obj.parent && obj.parent.subscription_details)) {
        const subId = obj.subscription || obj.parent.subscription_details.subscription;
        await applySubscription(env, await stripe(env, 'GET', `/v1/subscriptions/${encodeURIComponent(subId)}`));
      }
      break;
    default:
      break;
  }
  await env.DB.prepare('INSERT INTO stripe_events (id, type, created_at) VALUES (?, ?, ?)').bind(event.id, event.type, Date.now()).run();
  return json({ received: true });
}

// ─── Email ──────────────────────────────────────────────────────────────────

async function sendEmail(env, { to, subject, text, html, replyTo }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Meeras <no-reply@meeras.com.au>', to: [to], subject, text, html, reply_to: replyTo || undefined }),
  });
  if (!res.ok) {
    console.error('[email]', res.status, await res.text().catch(() => ''));
    throw new HttpError(502, 'We could not send the email. Please try again shortly.');
  }
}

// ─── Consultation requests (hidden until CONSULT_ENABLED = "1") ─────────────

async function consultRequest(request, env) {
  if (env.CONSULT_ENABLED !== '1') throw new HttpError(404, 'Not found');
  const b = await readJson(request);
  const name = cleanText(b.name, 120), email = normEmail(b.email);
  const phone = cleanText(b.phone, 40), state = cleanText(b.state, 10), topic = cleanText(b.topic, 80), message = cleanText(b.message, 3000);
  if (!name || !email) throw new HttpError(400, 'Please give your name and a valid email address.');
  if (b.consent !== true) throw new HttpError(400, 'Please agree to share your details with the lawyer.');
  if (!(await rateLimit(env, 'consult:' + clientIp(request), 5, 3600e3))) throw new HttpError(429, 'Too many requests. Please try again later.');
  const id = newId('con');
  await env.DB.prepare('INSERT INTO consult_requests (id, created_at, name, email, phone, state, topic, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, nowIso(), name, email, phone, state, topic, message).run();
  if (env.RESEND_API_KEY && env.CONSULT_NOTIFY_TO) {
    const lines = [`Name: ${name}`, `Email: ${email}`, `Phone: ${phone || '-'}`, `State: ${state || '-'}`, `Topic: ${topic || '-'}`, '', message || '(no message)', '', `Reference: ${id}`];
    await sendEmail(env, { to: env.CONSULT_NOTIFY_TO, subject: `Meeras consultation request: ${name}`, text: lines.join('\n'), html: '<pre style="font-family:inherit;white-space:pre-wrap;">' + escHtml(lines.join('\n')) + '</pre>', replyTo: email });
    await sendEmail(env, {
      to: email,
      subject: 'We received your consultation request',
      text: `Assalamu alaykum ${name},\n\nThank you. Your request has been passed to our legal expert, who will contact you to arrange a time and confirm the fee before any work starts.\n\nReference: ${id}\n\nMeeras, operated by WIZINSIGHTS PTY LTD (ABN 48 669 478 497)`,
      html: `<p>Assalamu alaykum ${escHtml(name)},</p><p>Thank you. Your request has been passed to our legal expert, who will contact you to arrange a time and confirm the fee before any work starts.</p><p style="color:#666;font-size:13px;">Reference: ${id}</p><p style="color:#999;font-size:12px;">Meeras, operated by WIZINSIGHTS PTY LTD (ABN 48 669 478 497)</p>`,
    });
  }
  return json({ ok: true, reference: id });
}

// Exposed for the Node tests.
export const _test = { verifyStripeSignature, membership, form, normEmail, periodEnd };
