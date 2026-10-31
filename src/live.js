// LIVE flight prices from Google Flights, through a search-API provider.
// The free Travelpayouts data only has prices travellers searched in the last ~48 hours, so quiet
// routes and dates often have nothing. This asks Google Flights right now: real airlines, flight
// numbers, departure and arrival times, layovers and prices.
//
// Providers (add ONE key as a Cloudflare secret; the bot picks it up by itself):
//   SEARCHAPI_KEY  searchapi.io  - recommended: about $4 per 1,000 searches ($40 = 10,000 a month), 100 free to try
//   SERPAPI_KEY    serpapi.com   - 250 free a month, then about $25 per 1,000
// Every answer is kept 6 hours, so the same flight search never costs twice.
//   LIVE_MODE = "fallback" (default): live only when the free data has no price near the dates
//   LIVE_MODE = "always": live prices for every flight, plus the free data for nearby dates
//   LIVE_MONTHLY_MAX (default 240) and LIVE_PER_USER_DAY (default 6) cap your spend.

import { bump, counter, cacheGet, cacheSet, canFetch } from './db.js';
import { placeByCode } from './places.js';
import { monthKey } from './email.js';
import { isAdmin } from './admin.js';

export function provider(env) {
  const want = String(env.LIVE_PROVIDER || '').toLowerCase();
  if (want === 'serpapi' && env.SERPAPI_KEY) return 'serpapi';
  if (want === 'searchapi' && env.SEARCHAPI_KEY) return 'searchapi';
  if (env.SEARCHAPI_KEY) return 'searchapi';
  if (env.SERPAPI_KEY) return 'serpapi';
  return null;
}
export const liveReady = (env) => !!provider(env);
export const liveAlways = (env) => liveReady(env) && String(env.LIVE_MODE || 'fallback').toLowerCase() === 'always';

// City codes → the airports Google Flights expects
const CITY_AIRPORTS = {
  LON: 'LHR,LGW,STN,LTN,LCY', NYC: 'JFK,EWR,LGA', TYO: 'HND,NRT', PAR: 'CDG,ORY', MIL: 'MXP,LIN,BGY', ROM: 'FCO,CIA',
  SEL: 'ICN,GMP', OSA: 'KIX,ITM', YTO: 'YYZ,YTZ', BJS: 'PEK,PKX', SHA: 'PVG,SHA', MOW: 'SVO,DME,VKO', IST: 'IST,SAW',
  BKK: 'BKK,DMK', WAS: 'IAD,DCA,BWI', CHI: 'ORD,MDW', STO: 'ARN,BMA', JKT: 'CGK,HLP', BUH: 'OTP', REK: 'KEF',
  SAO: 'GRU,CGH,VCP', RIO: 'GIG,SDU', BUE: 'EZE,AEP', MEL: 'MEL,AVV', DXB: 'DXB,DWC', KUL: 'KUL,SZB', TPE: 'TPE,TSA',
};
const ids = (code) => CITY_AIRPORTS[code] || code;

function offset(code) {
  const tz = placeByCode(code)?.tz;
  if (tz === undefined || tz === null) return 'Z';
  const sign = tz < 0 ? '-' : '+';
  const a = Math.abs(tz);
  return `${sign}${String(Math.floor(a)).padStart(2, '0')}:${String(Math.round((a % 1) * 60)).padStart(2, '0')}`;
}

// "2027-01-11 23:30" (SerpApi) or { date: "2027-01-11", time: "23:30" } (SearchApi)
const when = (a) => (a?.date && a?.time && !String(a.time).includes(' ') ? `${a.date} ${a.time}` : String(a?.time || ''));

// One Google Flights answer → the same shape as our other fares (plus real segments and layovers)
export function toItems(body, from, to) {
  const all = [...(body?.best_flights || []), ...(body?.other_flights || [])];
  return all.filter((r) => r && r.price && Array.isArray(r.flights) && r.flights.length && when(r.flights[0].departure_airport)).map((r) => {
    const segs = r.flights;
    const first = segs[0];
    const last = segs[segs.length - 1];
    const [code, ...num] = String(first.flight_number || '').split(' ');
    const carriers = [...new Set(segs.map((s) => s.airline).filter(Boolean))];
    return {
      price: r.price,
      airline: code || '',
      airline_name: carriers.join(' / '),
      flight_number: num.join('') || '',
      departure_at: `${when(first.departure_airport).replace(' ', 'T')}:00${offset(from)}`,
      arrival_local: when(last.arrival_airport),
      duration_to: r.total_duration || segs.reduce((s, x) => s + (x.duration || 0), 0),
      transfers: Math.max(0, segs.length - 1),
      layovers: (r.layovers || []).map((l) => ({ code: l.id, minutes: l.duration, overnight: !!l.overnight })),
      flights: segs.map((s) => `${s.flight_number || ''}`.trim()).filter(Boolean),
      origin: first.departure_airport?.id || from,
      destination: last.arrival_airport?.id || to,
      live: true,
    };
  });
}

// Live one-way fares for one flight on one day. Returns { items, cur } or null (not set up / no allowance).
export async function liveLeg(env, user, { from, to, date, adults = 1, children = 0, currency = 'usd' }) {
  if (!liveReady(env) || !date || date.length !== 10) return null;
  const cur = currency.toUpperCase();
  const key = `live:${from}:${to}:${date}:${adults}:${children}:${cur}`;
  const hit = await cacheGet(env, key);
  if (hit) { await bump(env, 'live_cache_hits'); return hit; }
  const owner = user && isAdmin(env, user.id);
  const [month, mine] = await Promise.all([counter(env, 'live_calls', monthKey()), user ? counter(env, `live_u${user.id}`) : 0]);
  if (month >= Number(env.LIVE_MONTHLY_MAX || 240)) { await bump(env, 'live_capped'); return null; }
  if (!owner && user && mine >= Number(env.LIVE_PER_USER_DAY || 6)) return null;
  if (!canFetch(env)) return null;
  const p = provider(env);
  const common = {
    engine: 'google_flights', departure_id: ids(from), arrival_id: ids(to), outbound_date: date, currency: cur, hl: 'en',
    adults: String(Math.min(Math.max(adults, 1), 9)), children: String(children || 0),
  };
  const q = p === 'searchapi'
    ? new URLSearchParams({ ...common, flight_type: 'one_way', api_key: env.SEARCHAPI_KEY })
    : new URLSearchParams({ ...common, type: '2', api_key: env.SERPAPI_KEY });
  const endpoint = p === 'searchapi' ? 'https://www.searchapi.io/api/v1/search' : 'https://serpapi.com/search.json';
  await Promise.all([bump(env, 'live_calls', 1, monthKey()), bump(env, 'live_calls'), user ? bump(env, `live_u${user.id}`) : null]);
  let body;
  try {
    const res = await fetch(`${endpoint}?${q}`, { signal: AbortSignal.timeout(20000) });
    body = await res.json();
    if (!res.ok || body?.error) throw new Error(body?.error || `${p} ${res.status}`);
  } catch (e) {
    console.log('live search failed', e && e.message);
    await bump(env, 'live_errors');
    return null;
  }
  const out = { items: toItems(body, from, to), cur: cur.toLowerCase(), live: true };
  await cacheSet(env, key, out, out.items.length ? 6 * 3600 : 2 * 3600);
  return out;
}

