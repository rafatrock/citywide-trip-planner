// Typical weather by month (30-year climate averages) from NASA POWER:
// free, public-domain data, no key needed. Each city is fetched once, then kept.

import { cacheGet, cacheSet, bump } from './db.js';
import { COORDS, placeByCode } from './places.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export async function climate(env, code) {
  const c = COORDS[code];
  if (!c) return null;
  const key = `clim:${code}`;
  const cached = await cacheGet(env, key);
  if (cached) return cached.ok ? cached : null;
  let data = null;
  try {
    const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR&community=RE&longitude=${c[1]}&latitude=${c[0]}&format=JSON`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const j = await res.json();
    const p = j?.properties?.parameter;
    if (p?.T2M_MAX && p?.T2M_MIN && p?.PRECTOTCORR) {
      data = { ok: true, hi: MONTHS.map((m) => p.T2M_MAX[m]), lo: MONTHS.map((m) => p.T2M_MIN[m]), rain: MONTHS.map((m) => p.PRECTOTCORR[m]) };
      if (data.hi.some((x) => typeof x !== 'number')) data = null;
    }
  } catch { /* weather is a nice-to-have */ }
  await bump(env, 'weather_calls');
  await cacheSet(env, key, data || { ok: false }, data ? 365 * 86400 : 86400);
  return data;
}

// Pure helpers (tested): describe one month and score how pleasant it is.
export function describe(c, monthIndex) {
  if (!c) return null;
  const hi = Math.round(c.hi[monthIndex]);
  const lo = Math.round(c.lo[monthIndex]);
  const rain = c.rain[monthIndex]; // mm per day
  const feel = rain >= 8 ? 'rainy season, expect heavy showers' : rain >= 4 ? 'some rainy days' : rain >= 1.5 ? 'mostly dry' : 'dry';
  const warn = [];
  if (hi >= 36) warn.push('very hot');
  if (hi <= 5) warn.push('cold, pack warm layers');
  if (rain >= 8) warn.push('monsoon-level rain');
  return { hi, lo, rain, feel, warn };
}

export function pleasantScore(d) {
  if (!d) return 0;
  let s = 0;
  if (d.hi >= 20 && d.hi <= 32) s += 2; else if (d.hi > 32 && d.hi < 36) s += 1;
  if (d.rain < 4) s += 1;
  if (d.rain >= 8) s -= 2;
  if (d.hi >= 36 || d.hi <= 5) s -= 1;
  return s;
}

export async function weatherLine(env, originCode, destCode, ym) {
  const m = Number(ym.slice(5, 7)) - 1;
  const [dc, oc] = await Promise.all([climate(env, destCode), climate(env, originCode)]);
  const d = describe(dc, m);
  if (!d) return null;
  const name = placeByCode(destCode)?.name || destCode;
  const monthName = new Date(Date.UTC(2026, m, 15)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  let line = `🌤 ${name} in ${monthName}: usually ${d.hi}° / ${d.lo}°C, ${d.feel}`;
  const o = describe(oc, m);
  if (o) {
    const diff = d.hi - o.hi;
    if (diff >= 6) line += `, about ${diff}° warmer than home`;
    else if (diff <= -6) line += `, about ${-diff}° colder than home, pack layers`;
  }
  if (d.warn.length) line += ` (${d.warn.join('; ')})`;
  return { line: `${line}.`, d };
}
