// Version 4.7: live Google Flights prices (SerpApi) and never an empty card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, installFetch, ctx, privateMsg, tap, lastSent } from './harness.js';
import { toItems } from '../src/live.js';

const BASE = 'https://citywide-trip-planner.example.workers.dev';
async function post(env, update) {
  const c = ctx();
  await worker.fetch(new Request(`${BASE}/tg`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET }, body: JSON.stringify(update) }), env, c);
  await c.done();
}
const buttons = (m) => (m?.body?.reply_markup?.inline_keyboard || []).flat();

// a Google Flights answer as SerpApi returns it (shape from serpapi.com/google-flights-api)
const seg = (fn, al, from, to, dep, arr, dur) => ({ flight_number: fn, airline: al, departure_airport: { id: from, time: dep }, arrival_airport: { id: to, time: arr }, duration: dur });
const GOOGLE = {
  'DAC-KUL': { best_flights: [
    { price: 33187, total_duration: 240, flights: [seg('BS 316', 'US-Bangla Airlines', 'DAC', 'KUL', '2027-01-11 20:00', '2027-01-12 02:00', 240)], layovers: [] },
    { price: 34189, total_duration: 235, flights: [seg('AK 71', 'AirAsia', 'DAC', 'KUL', '2027-01-11 23:30', '2027-01-12 05:25', 235)], layovers: [] },
  ], other_flights: [
    { price: 35687, total_duration: 390, flights: [seg('TG 322', 'Thai', 'DAC', 'BKK', '2027-01-11 13:40', '2027-01-11 17:10', 150), seg('TG 417', 'Thai', 'BKK', 'KUL', '2027-01-11 19:00', '2027-01-11 22:10', 130)], layovers: [{ id: 'BKK', duration: 110 }] },
  ] },
  'KUL-DAC': { best_flights: [
    { price: 30120, total_duration: 225, flights: [seg('BS 317', 'US-Bangla Airlines', 'KUL', 'DAC', '2027-01-15 08:00', '2027-01-15 09:45', 225)], layovers: [] },
    { price: 28900, total_duration: 230, flights: [seg('AK 70', 'AirAsia', 'KUL', 'DAC', '2027-01-15 20:00', '2027-01-15 21:50', 230)], layovers: [] },
  ] },
};

function withGoogle(log) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === 'serpapi.com') {
      log.serp = (log.serp || 0) + 1;
      const k = `${u.searchParams.get('departure_id').split(',')[0]}-${u.searchParams.get('arrival_id').split(',')[0]}`;
      return new Response(JSON.stringify(GOOGLE[k] || { best_flights: [] }));
    }
    if (u.hostname === 'api.travelpayouts.com' && u.pathname.includes('prices_for_dates')) {
      return new Response(JSON.stringify({ success: true, data: [] })); // the free data has nothing (like the screenshot)
    }
    return real(input, opts);
  };
  return () => { globalThis.fetch = real; };
}

async function rafat(env) {
  const U = { id: 9001, first_name: 'Rafat' };
  const C = { id: 9001, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg('r@example.com', U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap('set:p:friends', U, C)]) await post(env, u);
  return { U, C };
}

test('Google Flights answer → fares with real flight numbers, times and layovers', () => {
  const items = toItems(GOOGLE['DAC-KUL'], 'DAC', 'KUL');
  assert.equal(items.length, 3);
  assert.equal(items[1].airline, 'AK');
  assert.equal(items[1].flight_number, '71');
  assert.equal(items[1].departure_at, '2027-01-11T23:30:00+06:00');
  assert.equal(items[1].arrival_local, '2027-01-12 05:25');
  assert.equal(items[2].transfers, 1);
  assert.deepEqual(items[2].layovers, [{ code: 'BKK', minutes: 110, overnight: false }]);
});

test('the screenshot: Dhaka ⇄ KL, no cached fares → live prices on the card, never "sorry"', async () => {
  const log = installFetch();
  const restore = withGoogle(log);
  const env = makeEnv({ SERPAPI_KEY: 'test-key' });
  const { U, C } = await rafat(env);
  await post(env, privateMsg('Planning for a dac malaysia for 1 adult only. 4 nights total. 2nd week of Jan any dates withing that week.', U));
  await post(env, tap('d:dest:KUL', U, C));
  await post(env, tap('d:visa:no:MY', U, C));
  await post(env, tap('d:go', U, C));
  restore();
  const m = lastSent(log);
  console.log(`\n---- live card ----\n${m.body.text}\n-------------------`);
  assert.doesNotMatch(m.body.text, /Sorry|don't have recent prices/);
  assert.match(m.body.text, /live from Google Flights/);
  assert.match(m.body.text, /CHEAPEST/);
  assert.match(m.body.text, /AirAsia/);
  assert.match(m.body.text, /DAC 23:30 → KUL 05:25 \(\+1\)/);
  assert.match(m.body.text, /🟢/);
  assert.equal(log.serp, 2, 'two live searches: out and back');
  const book = buttons(m).find((b) => /Book/.test(b.text));
  const target = env.DB.raw.prepare('SELECT url FROM links WHERE id = ?').get(book.url.split('/go/')[1]).url;
  assert.match(target, /\/search\/DAC\d{4}KUL\d{4}1\?marker=/, 'a normal return search link');
});

test('no live key: still a full card (estimates or "checked live"), with a booking link', async () => {
  const log = installFetch();
  const restore = withGoogle(log);
  const env = makeEnv();
  const { U, C } = await rafat(env);
  await post(env, privateMsg('Dhaka to Kuala Lumpur 11 jan to 15 jan', U));
  await post(env, tap('d:visa:no:MY', U, C));
  await post(env, tap('d:go', U, C));
  restore();
  const m = lastSent(log);
  assert.doesNotMatch(m.body.text, /Sorry/);
  assert.match(m.body.text, /Here's your trip/);
  assert.match(m.body.text, /YOUR TRIP|≈/);
  assert.doesNotMatch(m.body.text, /BDT 0\b/);
  assert.ok(buttons(m).some((b) => /book the whole trip|Book/i.test(b.text)));
  assert.equal(log.serp || 0, 0);
});

test('SearchApi (cheaper provider): same card, documented answer format, chosen by its key', async () => {
  const log = installFetch();
  const real = globalThis.fetch;
  const asked = [];
  const sa = (fn, al, from, to, d1, t1, d2, t2, dur) => ({ flight_number: fn, airline: al, duration: dur,
    departure_airport: { id: from, date: d1, time: t1 }, arrival_airport: { id: to, date: d2, time: t2 } });
  globalThis.fetch = async (input, opts) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === 'www.searchapi.io') {
      asked.push(Object.fromEntries(u.searchParams));
      const out = u.searchParams.get('departure_id').startsWith('DAC');
      return new Response(JSON.stringify({ best_flights: [out
        ? { price: 34189, total_duration: 235, type: 'One way', flights: [sa('AK 71', 'AirAsia', 'DAC', 'KUL', '2027-01-11', '23:30', '2027-01-12', '05:25', 235)], layovers: [] }
        : { price: 28900, total_duration: 230, type: 'One way', flights: [sa('AK 70', 'AirAsia', 'KUL', 'DAC', '2027-01-15', '20:00', '2027-01-15', '21:50', 230)], layovers: [] }] }));
    }
    if (u.hostname === 'serpapi.com') throw new Error('should use SearchApi');
    if (u.hostname === 'api.travelpayouts.com' && u.pathname.includes('prices_for_dates')) return new Response(JSON.stringify({ success: true, data: [] }));
    return real(input, opts);
  };
  const env = makeEnv({ SEARCHAPI_KEY: 'sa-key' });
  const { U, C } = await rafat(env);
  await post(env, privateMsg('Dhaka to Kuala Lumpur 11 jan to 15 jan', U));
  await post(env, tap('d:visa:no:MY', U, C));
  await post(env, tap('d:go', U, C));
  globalThis.fetch = real;
  const m = lastSent(log);
  assert.equal(asked.length, 2);
  assert.equal(asked[0].flight_type, 'one_way');
  assert.equal(asked[0].engine, 'google_flights');
  assert.match(m.body.text, /AirAsia<\/b> AK 71 · BDT.34,189 🟢/);
  assert.match(m.body.text, /DAC 23:30 → KUL 05:25 \(\+1\)/);
  assert.match(m.body.text, /BDT.63,089/);
});
