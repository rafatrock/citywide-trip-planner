// Version 4.6: fastest picks, 7/10 a day + 150 a month, traveller profiles, abuse guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, installFetch, ctx, privateMsg, groupMsg, tap, lastSent } from './harness.js';
import { bump } from '../src/db.js';
import { monthKey } from '../src/email.js';

const BASE = 'https://citywide-trip-planner.example.workers.dev';
async function post(env, update) {
  const c = ctx();
  const res = await worker.fetch(new Request(`${BASE}/tg`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET }, body: JSON.stringify(update) }), env, c);
  await c.done();
  return res;
}
const buttons = (m) => (m?.body?.reply_markup?.inline_keyboard || []).flat();
const lastText = (log) => lastSent(log).body.text;

async function person(env, id, persona = 'friends') {
  const U = { id, first_name: `P${id}` };
  const C = { id, type: 'private' };
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg(`p${id}@example.com`, U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap(`set:p:${persona}`, U, C)]) await post(env, u);
  return { U, C };
}
async function setup(env) { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }

test('single trips show ⚡ Fastest', async () => {
  const log = installFetch();
  const env = makeEnv();
  await setup(env);
  const { U, C } = await person(env, 401);
  await post(env, privateMsg('Me and 3 friends, Dhaka to Bangkok, December', U));
  await post(env, tap('d:stay:week', U, C));
  await post(env, tap('d:go', U, C));
  assert.match(lastText(log), /Fastest/);
  assert.match(lastText(log), /least time travelling/);
});

test('limits: 150 a month; the owner is never limited or profiled', async () => {
  const log = installFetch();
  const env = makeEnv({ ADMIN_IDS: '999' });
  await setup(env);
  const { U, C } = await person(env, 402);
  await bump(env, 'srch_u402', 150, monthKey());
  await post(env, privateMsg('Me and 3 friends, Dhaka to Bangkok, December', U));
  await post(env, tap('d:stay:week', U, C));
  await post(env, tap('d:go', U, C));
  assert.match(lastText(log), /this month's 150 free searches/);

  const owner = await person(env, 999);
  await bump(env, 'srch_u999', 500, monthKey());
  await post(env, privateMsg('Me and 3 friends, Dhaka to Bangkok, December', owner.U));
  await post(env, tap('d:stay:week', owner.U, owner.C));
  await post(env, tap('d:go', owner.U, owner.C));
  assert.doesNotMatch(lastText(log), /free searches/);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = 999').get().n, 0, 'owner not profiled');
});

test('group searches also use the asker\'s own allowance (many groups can\'t multiply it)', async () => {
  const log = installFetch();
  const env = makeEnv({ SEARCHES_PER_DAY_FIRST_WEEK: '2' });
  await setup(env);
  const { U } = await person(env, 403);
  for (const g of [-1001, -1002, -1003]) {
    await post(env, groupMsg('/plan Dhaka to Bangkok 10 December', U, g));
  }
  assert.match(lastText(log), /today's 2 free searches/);
});

test('profiles: searches, picks and taps build a picture; /user shows it; /delete erases it', async () => {
  const log = installFetch();
  const env = makeEnv({ ADMIN_IDS: '999' });
  await setup(env);
  const { U, C } = await person(env, 404, 'family');
  await post(env, privateMsg('Family of 4, 2 kids, Dhaka to Bangkok, December', U));
  await post(env, tap('d:stay:week', U, C));
  await post(env, tap('d:go', U, C));
  const cheap = buttons(lastSent(log)).find((b) => b.text.startsWith('💰'));
  const res = await worker.fetch(new Request(cheap.url, { redirect: 'manual' }), env, ctx());
  assert.equal(res.status, 302);
  await new Promise((r) => setTimeout(r, 10));
  const p = env.DB.raw.prepare('SELECT * FROM profiles WHERE user_id = 404').get();
  assert.equal(p.searches, 1);
  assert.equal(p.kids, 1);
  assert.equal(p.pax_sum, 4);
  assert.equal(p.clicks, 1);
  assert.equal(p.pick_cheap, 1);
  assert.ok(p.lead_n === 1 && p.lead_sum > 0);

  await post(env, privateMsg('/user 404', { id: 999, first_name: 'Owner' }));
  const rep = lastText(log);
  console.log(`\n---- /user ----\n${rep}\n--------------`);
  assert.match(rep, /Segment:/);
  assert.match(rep, /travels with kids/);
  assert.match(rep, /cheapest 1/);
  await post(env, privateMsg('/analytics', { id: 999, first_name: 'Owner' }));
  assert.match(lastText(log), /How people search and choose/);
  assert.match(lastText(log), /cheapest 100%/);

  await post(env, privateMsg('/delete', U));
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = 404').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM interests WHERE user_id = 404').get().n, 0);
});

test('abuse guards: public pages rate-limited, bogus buttons ignored, new-account flood paused, re-pricing capped', async () => {
  const log = installFetch();
  let hits = 0;
  const env = makeEnv({ ADMIN_IDS: '999', NEW_USERS_PER_DAY: '3', BURST: { limit: async ({ key }) => ({ success: !key.startsWith('ip:') || (hits += 1) <= 10 }) } });
  await setup(env);
  for (let i = 0; i < 12; i += 1) await worker.fetch(new Request(`${BASE}/go/abc`, { headers: { 'CF-Connecting-IP': '1.2.3.4' } }), env, ctx());
  const r = await worker.fetch(new Request(`${BASE}/gear`, { headers: { 'CF-Connecting-IP': '1.2.3.4' } }), env, ctx());
  assert.equal(r.status, 429);

  const { U, C } = await person(env, 405);
  await post(env, privateMsg('Me and 3 friends, Dhaka to Bangkok, December', U));
  await post(env, tap('d:m:../../etc', U, C)); // a forged button
  assert.doesNotMatch(lastText(log), /undefined|NaN|Invalid/);

  // multi-country: free re-pricing up to 6 times, then each re-price counts
  await post(env, privateMsg('me with 2 friends 2nd week of january 7 days Uzbekistan and Turkey backpackers', U));
  const used = () => env.DB.raw.prepare("SELECT searches FROM usage WHERE key = 'u405'").get().searches;
  const start = used();
  for (let i = 0; i < 6; i += 1) await post(env, tap(`d:mn:${i % 2 ? 6 : 8}`, U, C));
  assert.equal(used(), start, 'first 6 re-pricings are free');
  await post(env, tap('d:mn:6', U, C));
  assert.equal(used(), start + 1, 'the 7th counts');

  // new-account flood (cap 3): the 4th brand-new person today is asked to come back tomorrow
  await post(env, privateMsg('/start', { id: 406, first_name: 'B1' }));
  await post(env, privateMsg('/start', { id: 407, first_name: 'B2' }));
  assert.match(lastText(log), /What should I call you/, 'the 3rd is welcome');
  await post(env, privateMsg('/start', { id: 408, first_name: 'B3' }));
  assert.match(lastText(log), /can't take new travellers right now/);
});
