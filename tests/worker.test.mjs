// Unit tests for the member API helpers in worker/index.mjs (no network, no D1).
// Run: node tests/worker.test.mjs   (also part of `npm test`)
import { _test } from '../worker/index.mjs';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { verifyStripeSignature, membership, form, normEmail, periodEnd } = _test;

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('  FAIL', name); } };

async function sign(secret, t, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  return [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
}

console.log('Stripe webhook signature');
{
  const secret = 'whsec_test_123', payload = '{"id":"evt_1","type":"checkout.session.completed"}';
  const t = Math.floor(Date.now() / 1000);
  const v1 = await sign(secret, t, payload);
  ok(await verifyStripeSignature(secret, `t=${t},v1=${v1}`, payload), 'valid signature accepted');
  ok(await verifyStripeSignature(secret, `t=${t},v1=deadbeef,v1=${v1}`, payload), 'any matching v1 accepted');
  ok(!(await verifyStripeSignature(secret, `t=${t},v1=${v1}`, payload + ' ')), 'tampered payload refused');
  ok(!(await verifyStripeSignature('whsec_other', `t=${t},v1=${v1}`, payload)), 'wrong secret refused');
  const old = t - 3600;
  ok(!(await verifyStripeSignature(secret, `t=${old},v1=${await sign(secret, old, payload)}`, payload)), 'stale timestamp refused');
  ok(!(await verifyStripeSignature(secret, '', payload)), 'missing header refused');
}

console.log('Membership state');
{
  const day = 864e5, iso = ms => new Date(ms).toISOString();
  ok(!membership(null).active, 'no account: inactive');
  ok(!membership({ plan: null, status: 'none' }).active, 'never paid: inactive');
  ok(membership({ plan: 'lifetime', status: 'active' }).active, 'lifetime active');
  ok(!membership({ plan: 'lifetime', status: 'canceled' }).active, 'lifetime refunded: inactive');
  ok(membership({ plan: 'yearly', status: 'active', paid_until: iso(Date.now() + 100 * day) }).active, 'yearly in period');
  ok(membership({ plan: 'yearly', status: 'past_due', paid_until: iso(Date.now() - 3 * day) }).active, 'yearly within grace');
  ok(!membership({ plan: 'yearly', status: 'active', paid_until: iso(Date.now() - 30 * day) }).active, 'yearly past grace');
  ok(!membership({ plan: 'yearly', status: 'canceled', paid_until: iso(Date.now() + 100 * day) }).active, 'yearly cancelled');
}

console.log('Stripe form encoding');
{
  const s = form({ mode: 'payment', line_items: { 0: { price_data: { currency: 'aud', unit_amount: 7900, product_data: { name: 'A & B' } }, quantity: 1 } }, skip: undefined });
  ok(s.includes('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=7900'), 'nested keys bracketed');
  ok(s.includes('A%20%26%20B'), 'values encoded');
  ok(!s.includes('skip'), 'undefined dropped');
  ok(periodEnd({ items: { data: [{ current_period_end: 1893456000 }] } }) === '2030-01-01T00:00:00.000Z', 'period end from subscription item');
  ok(periodEnd({ current_period_end: 1893456000 }) === '2030-01-01T00:00:00.000Z', 'period end from subscription');
}

console.log('Email normalisation');
{
  ok(normEmail('  Fatima@Example.COM ') === 'fatima@example.com', 'trimmed and lower-cased');
  ok(normEmail('not an email') === null, 'invalid refused');
  ok(normEmail('a@b') === null, 'no TLD refused');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
