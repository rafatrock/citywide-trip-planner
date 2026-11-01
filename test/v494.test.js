// 4.9.4: the free plan allows 50 outside calls per message. The worst case (a route with no prices
// anywhere, so every fallback runs) must stay under it and still answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, installFetch, ctx, privateMsg, tap, lastSent } from './harness.js';

const BASE = 'https://citywide-trip-planner.example.workers.dev';
let calls = 0;
async function post(env, update) {
  calls = 0;
  const c = ctx();
  await worker.fetch(new Request(`${BASE}/tg`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET }, body: JSON.stringify(update) }), env, c);
  await c.done();
  return calls;
}

test('Dhaka → Sydney with no prices anywhere: under 50 outside calls, and a reply arrives', async () => {
  const log = installFetch();
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    calls += 1;
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === 'api.travelpayouts.com' && !u.pathname.includes('/links/')) return new Response(JSON.stringify({ success: true, data: [] }));
    return real(input, opts);
  };
  // Cache API calls count against the limit too: make sure we don't use it
  globalThis.caches = { default: { match: async () => { calls += 1; return undefined; }, put: async () => { calls += 1; } } };
  const env = makeEnv({ ADMIN_IDS: '9400' });
  const U = { id: 9400, first_name: 'Rafat' };
  const C = { id: 9400, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg('r@example.com', U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap('set:p:couple', U, C)]) await post(env, u);
  await post(env, privateMsg('2 adults dhaka to sydney starts 25 jan return on 4 feb', U));
  const n = await post(env, tap('d:visa:no:AU', U, C));
  globalThis.fetch = real;
  delete globalThis.caches;
  console.log(`outside calls for the worst-case search: ${n}`);
  assert.ok(n <= 45, `${n} calls`);
  const m = lastSent(log).body.text;
  assert.match(m, /Here's your trip|Here's what travellers found recently/);
});

test('3-country trip with no prices anywhere: still under the limit, and a reply arrives', async () => {
  const log = installFetch();
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    calls += 1;
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === 'api.travelpayouts.com' && !u.pathname.includes('/links/')) return new Response(JSON.stringify({ success: true, data: [] }));
    return real(input, opts);
  };
  const env = makeEnv({ ADMIN_IDS: '9401' });
  const U = { id: 9401, first_name: 'Rafat' };
  const C = { id: 9401, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg('r@example.com', U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap('set:p:couple', U, C)]) await post(env, u);
  const n = await post(env, privateMsg('2 of us, 2nd week of january, 9 nights, Uzbekistan, Kyrgyzstan and Kazakhstan', U));
  globalThis.fetch = real;
  console.log(`outside calls for the worst-case 3-country trip: ${n}`);
  assert.ok(n <= 45, `${n} calls`);
  assert.match(lastSent(log).body.text, /Here's your trip/);
});

test('Dhaka ⇄ Sydney guide: a real return fare from other dates, never a one-way price posing as the trip', async () => {
  const log = installFetch();
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === 'api.travelpayouts.com' && !u.pathname.includes('/links/')) {
      const p = u.searchParams;
      let data = [];
      if (u.pathname.includes('prices_for_dates') && !p.get('departure_at') && p.get('origin') === 'DAC') {
        data = p.get('one_way') === 'false'
          ? [{ origin: 'DAC', destination: 'SYD', departure_at: '2026-11-26T15:45:00+06:00', return_at: '2026-12-06T22:30:00+11:00', price: 131500, airline: 'AI', transfers: 1 }]
          : [{ origin: 'DAC', destination: 'SYD', departure_at: '2026-11-26T15:45:00+06:00', price: 54008, airline: 'AI', transfers: 1 }];
      }
      return new Response(JSON.stringify({ success: true, data }));
    }
    return real(input, opts);
  };
  const env = makeEnv({ ADMIN_IDS: '9402' });
  const U = { id: 9402, first_name: 'Rafat' };
  const C = { id: 9402, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg('r@example.com', U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap('set:p:couple', U, C)]) await post(env, u);
  await post(env, privateMsg('2 adults dhaka to sydney starts 25 jan return on 4 feb', U));
  await post(env, tap('d:visa:no:AU', U, C));
  globalThis.fetch = real;
  const m = lastSent(log).body.text;
  console.log(`\n---- guide ----\n${m}\n---------------`);
  assert.match(m, /return tickets from ≈ BDT.131,500/);
  assert.doesNotMatch(m, /54,008/);
});
