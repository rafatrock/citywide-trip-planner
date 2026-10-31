// 4.9.2: Dhaka ⇄ London screenshot. Real return fares on the nearest dates (not two unrelated one-ways),
// honest price guides, and the airline logo above the card.
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
const rt = (dep, ret, price, al, stops, retStops, dur) => ({ origin: 'DAC', destination: 'LON', departure_at: `${dep}T22:50:00+06:00`, return_at: `${ret}T10:35:00+00:00`,
  price, airline: al, flight_number: '1', transfers: stops, return_transfers: retStops, duration_to: dur, duration: dur * 2, link: `/search/DAC${dep.slice(8)}01LON${ret.slice(8)}012?t=${al}${price}` });

function api(withMonth) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname !== 'api.travelpayouts.com' || u.pathname.includes('/links/')) return real(input, opts);
    const p = u.searchParams;
    let data = [];
    // exact dates (2027-01-22 / 2027-01-29): nothing. Whole month round trips: a few, a day or two off.
    if (withMonth && u.pathname.includes('prices_for_dates') && p.get('one_way') === 'false' && p.get('departure_at') === '2027-01') {
      data = [rt('2027-01-21', '2027-01-29', 78000, 'G9', 1, 1, 870), rt('2027-01-22', '2027-01-30', 96000, 'EK', 1, 1, 900), rt('2027-01-23', '2027-01-29', 165000, 'BG', 0, 0, 815)];
    }
    if (u.pathname.includes('prices_for_dates') && p.get('one_way') === 'true' && !p.get('departure_at')) {
      data = [{ origin: p.get('origin'), destination: p.get('destination'), departure_at: '2026-11-05T10:00:00+06:00', price: 41790, airline: 'FR', transfers: 2 }];
    }
    return new Response(JSON.stringify({ success: true, data }));
  };
  return () => { globalThis.fetch = real; };
}
async function rafat(env) {
  const U = { id: 9200, first_name: 'Rafat' };
  const C = { id: 9200, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg('r@example.com', U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap('set:p:couple', U, C)]) await post(env, u);
  return { U, C };
}

test('Dhaka ⇄ London: real return fares on the nearest dates, each with its own ticket link and the airline logo', async () => {
  const log = installFetch();
  const restore = api(true);
  const env = makeEnv({ ADMIN_IDS: '9200' });
  const { U, C } = await rafat(env);
  await post(env, privateMsg('Dhaka to London 22 jan to 29 jan, 2 of us', U));
  await post(env, tap('d:visa:no:GB', U, C));
  await post(env, tap('d:go', U, C));
  restore();
  const m = lastSent(log);
  console.log(`\n---- card ----\n${m.body.text}\n--------------`);
  assert.match(m.body.text, /real return fares on the nearest dates/);
  assert.match(m.body.text, /Cheapest/);
  assert.match(m.body.text, /Fastest/);
  assert.doesNotMatch(m.body.text, /Ryanair|guide only|PRICE GUIDE/);
  assert.equal(m.body.link_preview_options.url, 'https://pics.avs.io/120/120/G9.png', 'logo of the top pick');
  assert.equal(m.body.link_preview_options.show_above_text, true);
  const book = buttons(m).find((b) => /Book/.test(b.text));
  const target = env.DB.raw.prepare('SELECT url FROM links WHERE id = ?').get(book.url.split('/go/')[1]).url;
  assert.match(target, /\?t=/, 'opens that exact ticket on Aviasales, so the card matches what they see');
});

test('nothing real at all: an honest price guide (no airline names, no "non-stop", no best/cheapest/fastest)', async () => {
  const log = installFetch();
  const restore = api(false);
  const env = makeEnv({ ADMIN_IDS: '9200' });
  const { U, C } = await rafat(env);
  await post(env, privateMsg('Dhaka to London 22 jan to 29 jan, 2 of us', U));
  await post(env, tap('d:visa:no:GB', U, C));
  await post(env, tap('d:go', U, C));
  restore();
  const m = lastSent(log).body.text;
  console.log(`\n---- guide ----\n${m}\n---------------`);
  assert.match(m, /PRICE GUIDE/);
  assert.doesNotMatch(m, /Ryanair|non-stop|BEST OVERALL|CHEAPEST|FASTEST/);
  assert.ok(buttons(lastSent(log)).some((b) => /live prices/i.test(b.text)));
});
