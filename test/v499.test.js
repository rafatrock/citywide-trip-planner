// 4.9.9: replays the REAL Aviasales Data API answers for Dhaka ⇄ Istanbul, fetched 1 Nov 2026
// (market=ae and market=tr returned the same 9 fares as the default market; direct=true returned Turkish).
// Checks the picks follow the rule and that times are door to door, never "time in the air".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { realTimes } from '../src/tp.js';
import { makeEnv, installFetch, ctx, privateMsg, tap, lastSent } from './harness.js';

const BASE = 'https://citywide-trip-planner.example.workers.dev';
async function post(env, update) {
  const c = ctx();
  await worker.fetch(new Request(`${BASE}/tg`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET }, body: JSON.stringify(update) }), env, c);
  await c.done();
}
const row = (s) => {
  const [airline, flight_number, price, departure_at, return_at, transfers, return_transfers, duration, duration_to, duration_back, gate] = s.split(',');
  return { origin: 'DAC', destination: 'IST', airline, flight_number, price: +price, departure_at, return_at, transfers: +transfers, return_transfers: +return_transfers,
    duration: +duration, duration_to: +duration_to, duration_back: +duration_back, gate, link: `/search/DAC2111IST28111?t=${airline}${flight_number}` };
};
const NOV = `6E,1104,66298,2026-11-12T16:50:00+06:00,2026-11-23T21:50:00+03:00,2,1,4395,655,540,Kupi.com
6E,1104,73365,2026-11-13T16:50:00+06:00,2026-11-24T14:10:00+03:00,2,1,3415,655,570,Kupi.com
6E,1116,75732,2026-11-14T13:20:00+06:00,2026-11-25T15:00:00+03:00,1,1,3970,650,550,Kupi.com
G9,519,78540,2026-11-11T08:00:00+06:00,2026-11-22T14:05:00+03:00,1,1,1680,645,530,Kupi.com
6E,1116,80111,2026-11-21T15:20:00+06:00,2026-11-28T14:55:00+03:00,1,1,2915,650,600,Wingie
6E,1106,83488,2026-11-06T14:45:00+06:00,2026-11-16T21:50:00+03:00,3,1,3475,755,540,Kupi.com
WY,318,84038,2026-11-04T15:10:00+06:00,2026-11-14T21:50:00+03:00,1,1,3400,660,540,Kupi.com
6E,1116,86458,2026-11-05T13:20:00+06:00,2026-11-15T21:30:00+03:00,1,2,3770,650,605,Kupi.com
6E,1104,96854,2026-11-01T16:50:00+06:00,2026-11-06T21:10:00+03:00,1,1,3170,665,580,Kupi.com`.split('\n').map(row);
const DIRECT = `TK,743,208374,2026-11-11T08:15:00+06:00,2026-11-22T19:30:00+03:00,0,0,970,530,440,Aviakassa
TK,743,241615,2026-11-04T08:15:00+06:00,2026-11-14T19:30:00+03:00,0,0,970,530,440,City.Travel
TK,713,288956,2026-11-12T07:25:00+06:00,2026-11-23T19:30:00+03:00,0,0,970,530,440,Trip.com
TK,713,294611,2026-11-13T07:25:00+06:00,2026-11-24T19:30:00+03:00,0,0,970,530,440,Aviakassa
TK,713,311367,2026-11-21T07:30:00+06:00,2026-11-28T19:30:00+03:00,0,0,970,530,440,City.Travel
TK,713,316621,2026-11-14T07:25:00+06:00,2026-11-25T19:30:00+03:00,0,0,970,530,440,City.Travel
TK,713,324520,2026-11-05T07:25:00+06:00,2026-11-15T19:30:00+03:00,0,0,970,530,440,Trip.com
TK,743,429440,2026-11-06T08:10:00+06:00,2026-11-16T19:30:00+03:00,0,0,965,525,440,Trip.com`.split('\n').map(row);

function realApi() {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname !== 'api.travelpayouts.com' || u.pathname.includes('/links/')) return real(input, opts);
    const p = u.searchParams;
    let data = [];
    if (u.pathname.includes('prices_for_dates') && p.get('one_way') === 'false' && (p.get('departure_at') || '').startsWith('2026-11')) {
      data = p.get('direct') === 'true' ? DIRECT : NOV; // every market answered the same
    }
    return new Response(JSON.stringify({ success: true, currency: 'bdt', data: data.slice(0, Number(p.get('limit') || 30)) }));
  };
  return () => { globalThis.fetch = real; };
}

test('real API times: door to door, never flying time shown as travel time', () => {
  const oneWay = realTimes({ price: 42585, airline: '6E', departure_at: '2026-11-30T15:20:00+06:00', transfers: 1, duration: 1810, duration_to: 650 });
  assert.equal(oneWay.duration_to, 1810, 'one way: 30h 10m door to door, not 10h 50m in the air');
  assert.equal(oneWay.stopover_wait, 1160);
  const tk = realTimes(DIRECT[4]);
  assert.equal(tk.duration_to, 530);
  assert.equal(tk.duration_back, 440);
  const indigo = realTimes(NOV[4]);
  assert.equal(indigo.duration_to, undefined, 'stops both ways: the one-way time is not known, so not shown');
  assert.equal(indigo.stopover_wait, 2915 - 650 - 600);
});

test('real Dhaka ⇄ Istanbul data, 18–25 Nov flexible: the card follows the rule and tells the truth', async () => {
  const log = installFetch();
  const restore = realApi();
  const env = makeEnv({ ADMIN_IDS: '9900', BDT: '1' });
  const U = { id: 9900, first_name: 'Rafat' };
  const C = { id: 9900, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg('r@example.com', U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap('set:p:friends', U, C)]) await post(env, u);
  await post(env, privateMsg('me and 3 friends dhaka to istanbul 18 nov to 25 nov flexible', U));
  await post(env, tap('d:visa:no:TR', U, C));
  restore();
  const t = lastSent(log).body.text;
  console.log(`\n---- card from real data ----\n${t}\n-----------------------------`);
  // only two fares fit 15–21 Nov out / 22–28 Nov back: IndiGo ৳80,111 and Turkish ৳311,367
  assert.match(t, /Cheapest[^\n]*IndiGo/);
  assert.match(t, /Fastest[^\n]*Turkish/);
  assert.doesNotMatch(t, /Qatar|Emirates/, 'never show an airline that is not in the data');
  assert.doesNotMatch(t, /10h 50m|10h 50/, 'flying time is never shown as travel time');
  assert.match(t, /48h 35m travelling in total \(both ways\), incl\. about 27h 45m waiting at stopovers/);
  assert.match(t, /16h 10m travelling in total|8h 50m/, 'Turkish: real non-stop times');
  assert.match(t, /long waits at stopovers/);
  assert.match(t, /Only 2 fares seen/);
});
