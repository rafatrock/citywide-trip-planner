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
  const cached = await cacheGet(env, key);
  if (cached) {
    await bump(env, 'tp_cache_hits');
    return cached;
  }
  if (!canFetch(env)) return { budget: true, data: [] };
  const max = Number(env.TP_DAILY_MAX || 3000);
  if ((await counter(env, 'tp_calls')) >= max) return { capped: true, data: [] };
  await bump(env, 'tp_calls');
  let body;
  try {
    const res = await fetch(`${API}?${new URLSearchParams(params)}`, {
      headers: { 'X-Access-Token': env.TP_TOKEN, 'Accept-Encoding': 'gzip' },
      signal: AbortSignal.timeout(8000),
    });
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
  await cacheSet(env, key, out, ttl);
  await edgePut(key, out, ttl);
  return out;
}

// q = { origin, destination, depart: 'YYYY-MM' | 'YYYY-MM-DD', ret?: same, oneWay, direct, currency }
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
  const markets = [null, ...String(env.TP_FALLBACK_MARKETS || '').split(',').map((s) => s.trim()).filter(Boolean)];
  const attempts = [];
  const cur = (q.currency || 'usd').toLowerCase();
  attempts.push({ currency: cur, market: null });
  if (cur !== 'usd') attempts.push({ currency: 'usd', market: null });
  for (const m of markets.slice(1)) attempts.push({ currency: 'usd', market: m });

  for (const a of attempts) {
    const params = { ...base, currency: a.currency };
    if (a.market) params.market = a.market;
    const r = await callApi(env, params);
    if (r.capped) return { capped: true, items: [] };
    if (r.budget) return { items: [], currency: cur, budget: true };
    if (r.data.length) return { items: r.data, currency: (r.currency || a.currency).toLowerCase(), market: a.market || 'default' };
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
