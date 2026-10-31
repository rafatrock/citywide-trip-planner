// Version 4.9: more of the Aviasales Data API: extra price indexes, special offers (/deals), nearby airports.
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
const future = new Date(Date.now() + 5 * 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

function dataApi(log) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname !== 'api.travelpayouts.com' || u.pathname.includes('/links/')) return real(input, opts);
    log.paths = [...(log.paths || []), u.pathname];
    const p = u.searchParams;
    const route = `${p.get('origin')}-${p.get('destination')}`;
    let body = { success: true, data: [] };
    if (u.pathname.endsWith('/v1/prices/cheap') && route === 'DAC-KUL') {
      body = { success: true, data: { KUL: {
        0: { price: 31304, airline: 'AK', flight_number: 71, departure_at: '2027-01-12T17:30:00Z', expires_at: future },
        1: { price: 25000, airline: 'XX', flight_number: 1, departure_at: '2027-01-12T03:00:00Z', expires_at: past }, // expired: ignored
      } } };
    }
    if (u.pathname.endsWith('/get_latest_prices') && route === 'KUL-DAC') {
      body = { success: true, data: [{ depart_date: '2027-01-15', value: 28900, number_of_changes: 0, duration: 230 }] };
    }
    if (u.pathname.endsWith('/get_special_offers')) {
      body = { success: true, data: [
        { destination: 'KUL', destination_name: 'Kuala Lumpur', airline: 'AK', airline_title: 'AirAsia', price: 18500, departure_at: future, link: '/search/DAC2001KUL1' },
        { destination: 'BKK', destination_name: 'Bangkok', airline: 'FD', airline_title: 'Thai AirAsia', price: 16900, departure_at: future, link: '/search/DAC2201BKK1' },
      ] };
    }
    return new Response(JSON.stringify(body));
  };
  return () => { globalThis.fetch = real; };
}

async function rafat(env) {
  const U = { id: 9100, first_name: 'Rafat' };
  const C = { id: 9100, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg('r@example.com', U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap('set:p:friends', U, C)]) await post(env, u);
  return { U, C };
}

test('no price in the main index: the other Data API indexes fill the card (expired prices skipped)', async () => {
  const log = installFetch();
  const restore = dataApi(log);
  const env = makeEnv();
  const { U, C } = await rafat(env);
  await post(env, privateMsg('Dhaka to Kuala Lumpur 11 jan to 15 jan, just me', U));
  await post(env, tap('d:visa:no:MY', U, C));
  await post(env, tap('d:go', U, C));
  restore();
  const m = lastSent(log).body.text;
  console.log(`\n---- card ----\n${m}\n--------------`);
  assert.ok(log.paths.some((p) => p.endsWith('/v1/prices/cheap')) && log.paths.some((p) => p.endsWith('/get_latest_prices')));
  assert.match(m, /AirAsia<\/b> AK 71 · BDT.31,304/);
  assert.match(m, /Fare seen<\/b> · BDT.28,900/);
  assert.match(m, /times on the booking page/);
  assert.match(m, /BDT.60,204/, 'both flights priced: a real total');
  assert.doesNotMatch(m, /25,000/, 'expired price not shown');
});

test('/deals: special offers from your home city, with booking buttons', async () => {
  const log = installFetch();
  const restore = dataApi(log);
  const env = makeEnv();
  const { U } = await rafat(env);
  await post(env, privateMsg('/deals', U));
  restore();
  const m = lastSent(log);
  assert.match(m.body.text, /Cheap fares from Dhaka/);
  assert.match(m.body.text, /1\) <b>Bangkok<\/b> · BDT.16,900 · Thai AirAsia/);
  assert.ok(buttons(m).some((b) => /Kuala Lumpur/.test(b.text) && b.url.includes('/go/')));
});
