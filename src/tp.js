// Travelpayouts / Aviasales Data API client (free for partners).
// Prices are a cache of what real travellers searched in the last ~48 hours,
// so we label them "recently seen" and the booking site shows the live price.

import { bump, cacheGet, cacheSet, counter, canFetch } from './db.js';
import { placeByCode } from './places.js';

const API = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
const CACHE_TTL = 6 * 3600; // Travelpayouts recommends caching; 6 h keeps alerts fresh enough

// (An edge cache used to sit here. Each of its reads and writes counted as an outside call against
// the free plan's 50 per message, so it was removed; the database cache below does the job.)

async function callApi(env, params, url = API) {
  const key = `tp:${url === API ? '' : `${url.split('/').slice(-2).join('/')}:`}${new URLSearchParams(params).toString()}`;
  // cache and today's call count in one go (each database trip costs time)
  const [cached, used] = await Promise.all([cacheGet(env, key), counter(env, 'tp_calls')]);
  if (cached) {
    await bump(env, 'tp_cache_hits');
    return cached;
  }
  if (!canFetch(env)) return { budget: true, data: [] };
  if (used >= Number(env.TP_DAILY_MAX || 3000)) return { capped: true, data: [] };
  let body;
  try {
    const [res] = await Promise.all([
      fetch(`${url}?${new URLSearchParams(params)}`, {
        headers: { 'X-Access-Token': env.TP_TOKEN, 'Accept-Encoding': 'gzip' },
        signal: AbortSignal.timeout(8000),
      }),
      bump(env, 'tp_calls'),
    ]);
    if (res.status === 429) {
      await bump(env, 'tp_rate_limited');
      return { error: 'busy', data: [] };
    }
    body = await res.json();
  } catch (e) {
    await bump(env, 'tp_errors');
    return { error: 'network', data: [] };
  }
  // prices_for_dates answers with a list; the older endpoints answer with an object (kept as is)
  const data = Array.isArray(body.data) ? body.data : (body.data && typeof body.data === 'object' ? body.data : []);
  const prices = Array.isArray(body.prices) ? body.prices : (Array.isArray(body.data?.prices) ? body.data.prices : undefined);
  const out = { success: !!body.success, currency: body.currency || params.currency, data, ...(prices ? { prices } : {}) };
  const has = Array.isArray(data) ? data.length : Object.keys(data).length || (prices && prices.length);
  const ttl = has ? CACHE_TTL : 2 * 3600;
  await cacheSet(env, key, out, ttl);
  return out;
}

// Markets where travellers search a region's routes most (Central Asia and the Caucasus: Russian-speaking markets).
const CIS = new Set(['UZ', 'KZ', 'KG', 'TJ', 'TM', 'AZ', 'GE', 'AM', 'RU', 'BY', 'MD', 'UA']);
const REGION_EXTRA = { ru: ['kz', 'uz'], tr: ['ru'], ae: ['in'] };
function regionMarket(o, d) {
  const cc = [placeByCode(o)?.cc, placeByCode(d)?.cc];
  if (cc.some((c) => CIS.has(c))) return 'ru';
  if (cc.includes('TR')) return 'tr';
  if (cc.some((c) => ['AE', 'SA', 'QA', 'OM', 'KW', 'BH'].includes(c))) return 'ae';
  const sea = cc.find((c) => ['TH', 'MY', 'SG', 'ID', 'VN', 'PH'].includes(c));
  if (sea) return sea.toLowerCase(); // South-East Asia: that country's travellers search it most
  if (cc.includes('IN')) return 'in';
  return null;
}

export async function searchFares(env, q) {
  const base = {
    origin: q.origin,
    destination: q.destination,
    departure_at: q.depart,
    one_way: q.oneWay ? 'true' : 'false', // false = round trips, several per date
    direct: q.direct ? 'true' : 'false',
    sorting: 'price',
    unique: 'false',
    limit: '30',
    page: '1',
  };
  if (!q.oneWay && q.ret) base.return_at = q.ret;
  if (!q.depart) delete base.departure_at; // any date: the cheapest seen recently
  // Price data is grouped by "market" (the country whose travellers searched). We ask the
  // likeliest markets at the same time, then the rest, and keep the first that has prices.
  const cur = (q.currency || 'usd').toLowerCase();
  const region = regionMarket(q.origin, q.destination);
  const fallbacks = String(env.TP_FALLBACK_MARKETS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const wave1 = [{ currency: cur, market: null }, { currency: cur, market: region || fallbacks[0] || 'us' }];
  const used = new Set(wave1.map((a) => a.market));
  const wave2 = [...new Set([...(region ? [fallbacks[0]] : []), ...fallbacks.slice(region ? 0 : 1), ...(region ? REGION_EXTRA[region] || [] : [])])]
    .filter((m) => m && !used.has(m)).slice(0, 1).map((m) => ({ currency: cur, market: m }));

  // quick = one call only (side checks like "any direct flights?" or a price guide)
  const waves = q.quick ? [wave1.slice(0, 1)] : [wave1, wave2];
  for (const wave of waves) {
    if (!wave.length) continue;
    const results = await Promise.all(wave.map((a) => {
      const params = { ...base, currency: a.currency };
      if (a.market) params.market = a.market;
      return callApi(env, params);
    }));
    if (results.some((r) => r.capped)) return { capped: true, items: [] };
    // keep the fares from every market that answered (each market's travellers find different flights)
    const hit = results.map((r, i) => ({ r, i })).filter(({ r }) => Array.isArray(r.data) && r.data.length);
    if (hit.length) {
      const cur0 = (hit[0].r.currency || wave[hit[0].i].currency).toLowerCase();
      const items = hit.filter(({ r, i }) => (r.currency || wave[i].currency).toLowerCase() === cur0).flatMap(({ r }) => r.data);
      return { items, currency: cur0, market: hit.map(({ i }) => wave[i].market || 'default').join('+') };
    }
    if (results.every((r) => r.budget)) return { items: [], currency: cur, budget: true };
  }
  // Airports that changed code (Bishkek: BSZ now, FRU on most flight sites): try the old code once.
  if (!q.altTried) {
    const oa = placeByCode(q.origin)?.alts?.[0];
    const da = placeByCode(q.destination)?.alts?.[0];
    if (oa || da) return searchFares(env, { ...q, origin: oa || q.origin, destination: da || q.destination, altTried: true });
  }
  return { items: [], currency: cur };
}

// ---------- more of the Aviasales Data API (used when prices_for_dates has nothing) ----------
// Each endpoint is a separate index of recent traveller searches, so together they find a price
// far more often. Docs: support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API
const V1_CHEAP = 'https://api.travelpayouts.com/v1/prices/cheap';
const V1_DIRECT = 'https://api.travelpayouts.com/v1/prices/direct';
const LATEST = 'https://api.travelpayouts.com/aviasales/v3/get_latest_prices';
const OFFERS = 'https://api.travelpayouts.com/aviasales/v3/get_special_offers';
const NEAREST = 'https://api.travelpayouts.com/v2/prices/nearest-places-matrix';

// v1 answers look like { KUL: { "0": {fare}, "1": {fare} } } where the key is the number of stops
function fromV1(data, now = Date.now()) {
  const out = [];
  for (const byStops of Object.values(data || {})) {
    for (const [stops, f] of Object.entries(byStops || {})) {
      if (!f || !f.price || !f.departure_at) continue;
      if (f.expires_at && Date.parse(f.expires_at) < now) continue; // an old price: skip it
      out.push({ price: f.price, airline: f.airline || '', flight_number: f.flight_number ? String(f.flight_number) : '', departure_at: f.departure_at,
        return_at: f.return_at || undefined, transfers: Number(stops) || 0, timeless: true, source: 'v1' });
    }
  }
  return out;
}

// get_latest_prices answers with dates and prices but no airline or times
function fromLatest(list) {
  return (Array.isArray(list) ? list : []).filter((f) => f && f.value && f.depart_date).map((f) => ({
    price: f.value, airline: '', flight_number: '', departure_at: `${f.depart_date}T12:00:00Z`,
    return_at: f.return_date ? `${f.return_date}T12:00:00Z` : undefined, transfers: f.number_of_changes || 0,
    duration_to: f.duration || undefined, timeless: true, partial: true, source: 'latest',
  }));
}

// Three more price indexes for one route and month, asked side by side.
export async function moreFares(env, { origin, destination, month, oneWay = true, currency = 'usd' }) {
  const cur = currency.toLowerCase();
  const rt = oneWay ? {} : { return_date: month };
  const [cheap, direct, latest] = await Promise.all([
    callApi(env, { origin, destination, depart_date: month, currency: cur, ...rt }, V1_CHEAP),
    callApi(env, { origin, destination, depart_date: month, currency: cur, ...rt }, V1_DIRECT),
    callApi(env, { origin, destination, period_type: 'month', beginning_of_period: `${month}-01`, one_way: String(!!oneWay), group_by: 'dates', sorting: 'price', limit: '60', currency: cur }, LATEST),
  ]);
  const items = [...fromV1(cheap.data), ...fromV1(direct.data), ...fromLatest(latest.data)]
    .filter((f) => (oneWay ? !f.return_at : !!f.return_at));
  return { items, currency: cur };
}

// Unusually low fares from a city (Aviasales "special offers"): for /deals and /latest.
export async function specialOffers(env, origin, currency = 'usd') {
  if (!origin) return [];
  const r = await callApi(env, { origin, currency: currency.toLowerCase(), locale: 'en' }, OFFERS);
  const list = Array.isArray(r.data) ? r.data : [];
  return list.filter((o) => o && o.price && o.destination && (!o.departure_at || Date.parse(o.departure_at) > Date.now()))
    .sort((a, b) => a.price - b.price).slice(0, 8);
}

// Cheaper nearby airports or cities for a route (e.g. Chattogram instead of Dhaka).
export async function nearbyAirports(env, { origin, destination, month, currency = 'usd' }) {
  const r = await callApi(env, { origin, destination, depart_date: month, limit: '5', distance: '5', flexibility: '3', currency: currency.toLowerCase(), show_to_affiliates: 'true' }, NEAREST);
  const prices = r.prices || [];
  return prices.filter((p) => p && p.value && (p.origin !== origin || p.destination !== destination)).sort((a, b) => a.value - b.value).slice(0, 2);
}

// ---------- booking links ----------
const marker = (env) => {
  const m = String(env.TP_MARKER || '').trim();
  const sub = env.TP_SUBID === undefined ? 'tg' : String(env.TP_SUBID).trim();
  return sub ? `${m}.${sub}` : m;
};

export function bookingUrl(env, item) {
  const path = item.link || '';
  if (!path) return null;
  const join = path.includes('?') ? '&' : '?';
  return `https://www.aviasales.com${path}${join}marker=${encodeURIComponent(marker(env))}`;
}

// Aviasales search links: /search/DAC1101TAS1401IST1801DAC3
// = DAC on 11 Jan → TAS, 14 Jan → IST, 18 Jan → DAC, 3 passengers (checked on aviasales.com).
// Passengers: adults digit, then children digit when there are children.
const ddmm = (v) => {
  const d = v.length === 7 ? `${v}-15` : v; // month only: open the middle of the month
  return `${d.slice(8, 10)}${d.slice(5, 7)}`;
};
const paxCode = (adults = 1, children = 0) => {
  const a = Math.min(Math.max(adults || 1, 1), 9);
  const c = Math.min(Math.max(children || 0, 0), 9 - a);
  return c ? `${a}${c}` : `${a}`;
};

// Pre-filled search link for when there is no cached fare (search runs live on Aviasales).
export function liveSearchUrl(env, { origin, destination, depart, ret, adults = 1, children = 0 }) {
  let p = `${origin}${ddmm(depart)}${destination}`;
  if (ret) p += ddmm(ret);
  return `https://www.aviasales.com/search/${p}${paxCode(adults, children)}?marker=${encodeURIComponent(marker(env))}`;
}

// The whole route as one multi-city search. legs = [{ from, to, date: 'YYYY-MM-DD' }] in order.
export function multiCityUrl(env, legs, { adults = 1, children = 0 } = {}) {
  let p = legs[0].from;
  for (const l of legs) p += `${ddmm(l.date)}${l.to}`;
  return `https://www.aviasales.com/search/${p}${paxCode(adults, children)}?marker=${encodeURIComponent(marker(env))}`;
}

// ---------- partner links for extras (hotels, eSIM, transfers, lounges) ----------
// Needs TP_TRS (your Travelpayouts project ID) and joining each brand's program first.
export async function partnerLink(env, targetUrl) {
  if (!env.TP_TRS || !env.TP_MARKER) return null;
  const key = `pl:${targetUrl}`;
  const cached = await cacheGet(env, key);
  if (cached) return cached.url || null;
  let link = null;
  if (!canFetch(env)) return null;
  try {
    const res = await fetch('https://api.travelpayouts.com/links/v1/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Access-Token': env.TP_TOKEN },
      body: JSON.stringify({ trs: Number(env.TP_TRS), marker: Number(env.TP_MARKER), shorten: true, links: [{ url: targetUrl }] }),
      signal: AbortSignal.timeout(6000),
    });
    const body = await res.json();
    const first = body?.result?.links?.[0];
    if (first && first.code === 'success') link = first.partner_url || first.short_url || null;
  } catch { /* extras are optional */ }
  await cacheSet(env, key, { url: link }, link ? 7 * 86400 : 86400);
  return link;
}

