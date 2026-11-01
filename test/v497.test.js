// 4.9.7: Dhaka ⇄ Istanbul screenshot. Fares from every market + direct flights asked separately,
// honest titles (one fare is never "best, cheapest, fastest and most comfortable"), no logo banner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, installFetch, ctx, privateMsg, tap, lastSent } from './harness.js';

const BASE = 'https://citywide-trip-planner.example.workers.dev';
async function post(env, update) {
  const c = ctx();
  await worker.fetch(new Request(`${BASE}/tg`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET }, body: JSON.stringify(update) }), env, c);
  await c.done();
}
const buttons = (m) => (m?.body?.reply_markup?.inline_keyboard || []).flat();
const f = (al, dep, ret, price, stops, dur) => ({ origin: 'DAC', destination: 'IST', airline: al, flight_number: '7', price, transfers: stops, return_transfers: stops,
  departure_at: `${dep}+06:00`, return_at: `${ret}+03:00`, duration_to: dur, duration: dur * 2, link: `/search/x?t=${al}` });

function api({ onlyOne = false } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname !== 'api.travelpayouts.com' || u.pathname.includes('/links/')) return real(input, opts);
    const p = u.searchParams;
    let data = [];
    if (u.pathname.includes('prices_for_dates') && p.get('one_way') === 'false' && p.get('departure_at')) {
      // as on Google Flights for 21-28 Nov (BDT per person), spread over different markets like the real cache
      if (p.get('direct') === 'true') data = onlyOne ? [] : [f('TK', '2026-11-21T07:25:00', '2026-11-28T19:30:00', 429026, 0, 530)];
      else if (!p.get('market')) data = [f('6E', '2026-11-21T15:20:00', '2026-11-28T14:55:00', 80111, 1, 650)];
      else if (p.get('market') === 'ae' && !onlyOne) data = [
        f('G9', '2026-11-21T22:50:00', '2026-11-28T14:05:00', 72216, 1, 1050),
        f('QR', '2026-11-21T03:25:00', '2026-11-28T20:10:00', 105591, 1, 715),
        f('EK', '2026-11-21T09:55:00', '2026-11-28T15:10:00', 114801, 1, 695)];
    }
    return new Response(JSON.stringify({ success: true, data }));
  };
  return () => { globalThis.fetch = real; };
}
async function rafat(env, id) {
  const U = { id, first_name: 'Rafat' };
  const C = { id, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg('r@example.com', U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap('set:p:friends', U, C)]) await post(env, u);
  return { U, C };
}

test('Istanbul like a seasoned traveller: Qatar best overall, Air Arabia cheapest, Turkish fastest', async () => {
  const log = installFetch();
  const restore = api();
  const env = makeEnv({ ADMIN_IDS: '9500' });
  const { U, C } = await rafat(env, 9500);
  await post(env, privateMsg('me and 3 friends dhaka to istanbul 18 nov to 25 nov flexible', U));
  await post(env, tap('d:visa:no:TR', U, C));
  restore();
  const m = lastSent(log);
  console.log(`\n---- card ----\n${m.body.text}\n--------------`);
  assert.match(m.body.text, /Best overall[^\n]*Qatar Airways/);
  assert.match(m.body.text, /Cheapest[^\n]*Air Arabia/);
  assert.match(m.body.text, /Fastest[^\n]*Turkish Airlines/);
  assert.match(m.body.text, /well rated by passengers/);
  assert.match(m.body.text, /budget airline: check what baggage/);
  assert.ok(env.DB && true);
  assert.equal(m.body.link_preview_options.is_disabled, true, 'no big logo banner');
  assert.ok(buttons(m).filter((b) => / · Book$/.test(b.text)).length >= 3, 'a Book button per option');
});

test('only one fare seen: called "Fare seen", with a note that the live search shows more', async () => {
  const log = installFetch();
  const restore = api({ onlyOne: true });
  const env = makeEnv({ ADMIN_IDS: '9501' });
  const { U, C } = await rafat(env, 9501);
  await post(env, privateMsg('me and 3 friends dhaka to istanbul 18 nov to 25 nov flexible', U));
  await post(env, tap('d:visa:no:TR', U, C));
  restore();
  const t = lastSent(log).body.text;
  assert.match(t, /Fare seen · IndiGo/);
  assert.doesNotMatch(t, /Best overall|Cheapest|Fastest|Most comfortable/);
  assert.match(t, /Only 1 fare seen by travellers recently/);
});
