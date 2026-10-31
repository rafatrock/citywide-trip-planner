// Travelpayouts / Aviasales Data API client (free for partners).
// Prices are a cache of what real travellers searched in the last ~48 hours,
// so we label them "recently seen" and the booking site shows the live price.

import { bump, cacheGet, cacheSet, counter, canFetch } from './db.js';
import { placeByCode } from './places.js';

const API = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
const CACHE_TTL = 6 * 3600; // Travelpayouts recommends caching; 6 h keeps alerts fresh enough

// Edge cache (free, per data centre). Works when the Worker runs on your own
// domain; on workers.dev it simply finds nothing and we fall back to D1.
async function edgeGet(key) {
  try {
    const r = await caches.default.match(`https://cache.citywide.internal/${encodeURIComponent(key)}`);
    return r ? await r.json() : null;
  } catch { return null; }
}
async function edgePut(key, value, ttl) {
  try {
    await caches.default.put(`https://cache.citywide.internal/${encodeURIComponent(key)}`,
      new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` } }));
  } catch { /* not available */ }
}

async function callApi(env, params) {
  const key = `tp:${new URLSearchParams(params).toString()}`;
  const edge = await edgeGet(key);
  if (edge) {
    await bump(env, 'tp_cache_hits');
    return edge;
  }
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
      fetch(`${API}?${new URLSearchParams(params)}`, {
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
  const out = { success: !!body.success, currency: body.currency || params.currency, data: Array.isArray(body.data) ? body.data : [] };
  const ttl = out.data.length ? CACHE_TTL : 2 * 3600;
  await Promise.all([cacheSet(env, key, out, ttl), edgePut(key, out, ttl)]);
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
  // Price data is grouped by "market" (the country whose travellers searched). We ask the
  // likeliest markets at the same time, then the rest, and keep the first that has prices.
  const cur = (q.currency || 'usd').toLowerCase();
  const region = regionMarket(q.origin, q.destination);
  const fallbacks = String(env.TP_FALLBACK_MARKETS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const wave1 = [{ currency: cur, market: null }, { currency: 'usd', market: region || fallbacks[0] || 'us' }];
  const used = new Set(wave1.map((a) => a.market));
  const wave2 = [...new Set([...(region ? [fallbacks[0]] : []), ...fallbacks.slice(region ? 0 : 1), ...(region ? REGION_EXTRA[region] || [] : [])])]
    .filter((m) => m && !used.has(m)).slice(0, 2).map((m) => ({ currency: 'usd', market: m }));

  for (const wave of [wave1, wave2]) {
    if (!wave.length) continue;
    const results = await Promise.all(wave.map((a) => {
      const params = { ...base, currency: a.currency };
      if (a.market) params.market = a.market;
      return callApi(env, params);
    }));
    if (results.some((r) => r.capped)) return { capped: true, items: [] };
    for (const [i, r] of results.entries()) {
      if (r.data.length) return { items: r.data, currency: (r.currency || wave[i].currency).toLowerCase(), market: wave[i].market || 'default' };
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

// Pre-filled search link for when there is no cached fare (search runs live on Aviasales).
export function liveSearchUrl(env, { origin, destination, depart, ret, adults = 1 }) {
  const ddmm = (v) => {
    const d = v.length === 7 ? `${v}-15` : v; // month only: open the middle of the month
    return `${d.slice(8, 10)}${d.slice(5, 7)}`;
  };
  let p = `${origin}${ddmm(depart)}${destination}`;
  if (ret) p += ddmm(ret);
  p += String(Math.min(Math.max(adults, 1), 9));
  return `https://www.aviasales.com/search/${p}?marker=${encodeURIComponent(marker(env))}`;
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

// One search for the whole route as a multi-city ticket (official Aviasales link format).
// legs = [{ from, to, date: 'YYYY-MM-DD' }]
export function multiCityUrl(env, legs, { adults = 1, children = 0 } = {}) {
  const p = new URLSearchParams();
  legs.forEach((l, i) => {
    p.set(`segments[${i}][origin_iata]`, l.from);
    p.set(`segments[${i}][destination_iata]`, l.to);
    p.set(`segments[${i}][depart_date]`, l.date);
  });
  p.set('adults', String(Math.min(Math.max(adults, 1), 9)));
  p.set('children', String(Math.max(0, Math.min(children, 9 - adults))));
  p.set('infants', '0');
  p.set('trip_class', '0');
  p.set('marker', marker(env));
  return `https://search.aviasales.com/flights/?${p.toString()}`;
}
