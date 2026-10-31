// Typical weather by month (30-year climate averages) from NASA POWER:
// free, public-domain data, no key needed. Each city is fetched once, then kept.
//
// v3 fix: NASA's monthly T2M_MAX / T2M_MIN are the month's EXTREMES (hottest
// and coldest moments), not normal day/night temperatures — that's why Bangkok
// showed 37°/10° in December. We now use T2M, the average temperature.

import { cacheGet, cacheSet, bump, canFetch } from './db.js';
import { coordsFor, placeByCode } from './places.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export async function climate(env, code) {
  const c = coordsFor(code);
  if (!c) return null;
  const key = `clim3:${code}`; // new key: ignore values cached by v2
  const cached = await cacheGet(env, key);
  if (cached) return cached.ok ? cached : null;
  let data = null;
  if (!canFetch(env)) return null;
  try {
    const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR&community=RE&longitude=${c[1]}&latitude=${c[0]}&format=JSON`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const j = await res.json();
    const p = j?.properties?.parameter;
    if (p?.T2M && p?.PRECTOTCORR) {
      data = { ok: true, avg: MONTHS.map((m) => p.T2M[m]), rain: MONTHS.map((m) => p.PRECTOTCORR[m]) };
      if (data.avg.some((x) => typeof x !== 'number' || x < -60 || x > 50)) data = null;
    }
  } catch { /* weather is a nice-to-have */ }
  await bump(env, 'weather_calls');
  await cacheSet(env, key, data || { ok: false }, data ? 365 * 86400 : 86400);
  return data;
}

// Pure helpers (tested): describe one month and score how pleasant it is.
export function describe(c, monthIndex) {
  if (!c) return null;
  const avg = Math.round(c.avg[monthIndex]);
  const rain = c.rain[monthIndex]; // average mm per day
  const temp = avg >= 30 ? 'hot' : avg >= 24 ? 'warm' : avg >= 16 ? 'mild' : avg >= 8 ? 'cool' : avg >= 0 ? 'cold' : 'freezing';
  const wet = rain >= 8 ? 'rainy season, expect heavy showers' : rain >= 4 ? 'some rainy days' : rain >= 1.5 ? 'mostly dry' : 'dry';
  const warn = [];
  if (avg >= 32) warn.push('very hot');
  if (avg <= 3) warn.push('pack warm layers');
  if (rain >= 8) warn.push('monsoon-level rain');
  return { avg, rain, temp, feel: `${temp}, ${wet}`, warn };
}

export function pleasantScore(d) {
  if (!d) return 0;
  let s = 0;
  if (d.avg >= 18 && d.avg <= 28) s += 2; else if (d.avg > 28 && d.avg < 31) s += 1;
  if (d.rain < 4) s += 1;
  if (d.rain >= 8) s -= 2;
  if (d.avg >= 32 || d.avg <= 3) s -= 1;
  return s;
}

export async function weatherLine(env, originCode, destCode, ym) {
  const m = Number(ym.slice(5, 7)) - 1;
  const [dc, oc] = await Promise.all([climate(env, destCode), climate(env, originCode)]);
  const d = describe(dc, m);
  if (!d) return null;
  const name = placeByCode(destCode)?.name || destCode;
  const monthName = new Date(Date.UTC(2026, m, 15)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  let line = `🌤 ${name} in ${monthName}: ${d.feel}, around ${d.avg}°C on average`;
  const o = describe(oc, m);
  if (o) {
    const diff = d.avg - o.avg;
    if (diff >= 5) line += `, about ${diff}° warmer than home`;
    else if (diff <= -5) line += `, about ${-diff}° colder than home${d.warn.includes('pack warm layers') ? '' : ', pack layers'}`;
    else line += ', similar to home';
  }
  if (d.warn.length) line += ` (${d.warn.join('; ')})`;
  return { line: `${line}.`, d };
}
