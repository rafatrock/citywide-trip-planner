// Picks flights the way a seasoned traveller would, with one simple rule:
//
//   💰 Cheapest  = the lowest price.
//   ⚡ Fastest   = the least time travelling.
//   ⭐ Best overall = the best balance of price, time and airline quality:
//        score = price ÷ cheapest price  +  time ÷ fastest time  −  airline quality   (lowest wins)
//
// Airline quality comes from Skytrax passenger reviews (src/airline-ratings.js), compared with the
// average airline: well-rated airlines (Qatar, Singapore, ANA…) count in their favour; budget
// airlines with no reviews count a little against. The traveller type only changes how much each
// part counts (backpackers care most about price, families and business trips more about quality).
// Pure functions (easy to test).

import { RATINGS, RATINGS_AVG } from './airline-ratings.js';

// price, time, quality = how much each part counts; night = extra for landing between 23:00 and 05:00
export const PERSONAS = {
  family: { label: 'Family with kids', price: 1, time: 1.2, quality: 1.3, night: 0.3 },
  friends: { label: 'Friends group', price: 1.2, time: 1, quality: 1, night: 0 },
  backpacker: { label: 'Backpacker / budget', price: 3, time: 0.4, quality: 0.3, night: 0 },
  women: { label: "Women's group", price: 1, time: 1, quality: 1, night: 0.3 },
  couple: { label: 'Couple', price: 1, time: 1, quality: 1, night: 0.1 },
  corporate: { label: 'Business trip', price: 0.6, time: 1.5, quality: 1.2, night: 0.2 },
};

// Budget airlines (low fares; bags, meals and seats often extra). Used for the "check baggage" note,
// and as a small minus when there are no passenger reviews for them.
const BUDGET = new Set(['G9', '3L', 'AK', 'FD', 'QZ', 'Z2', 'D7', 'XJ', '6E', 'SG', 'IX', 'QP', 'FZ', 'J9', 'OV', 'XY', 'F3', 'VZ', 'VJ', 'TR',
  '3K', 'JQ', 'GK', 'MM', 'BC', '5J', 'DG', 'SL', 'DD', 'FR', 'U2', 'W6', 'VY', 'PC', 'XQ', 'HV', 'TO', 'NK', 'F9', 'WN', 'B6', 'G4', 'W4', '5W', 'OD', 'JT', 'ID', 'LJ', '7C', 'TW', 'BX']);
export const isBudget = (code) => BUDGET.has(code);

// Airline quality from -0.6 (much worse than average) to +1 (much better), 0 = average or unknown.
export function quality(code) {
  const r = RATINGS[code];
  if (!r) return BUDGET.has(code) ? -0.3 : 0;
  return Math.max(-0.6, Math.min(1, (r[0] - RATINGS_AVG) / 3));
}
export const tierOf = (code) => (quality(code) >= 0.4 ? 'top' : BUDGET.has(code) ? 'budget' : 'standard');

export function localParts(iso) {
  // "2026-12-12T09:15:00+06:00" -> local wall-clock parts as written
  return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)), minute: Number(iso.slice(14, 16)) };
}

export function arrivalLocal(departIso, minutes, destTz) {
  const t = Date.parse(departIso);
  if (!Number.isFinite(t) || !minutes || destTz === undefined || destTz === null) return null;
  const d = new Date(t + minutes * 60000 + destTz * 3600000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

const nightsBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);
const inWindow = (iso, w) => !w || (iso && iso.slice(0, 10) >= w.from && iso.slice(0, 10) <= w.to);
// total time travelling: both ways for a return trip
const travelTime = (it) => (it.return_at && it.duration ? it.duration : (it.duration_to || it.duration || 0));
const hm = (m) => `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}m` : ''}`;

export function rankFares(items, ctx) {
  const w = PERSONAS[ctx.persona] || PERSONAS.couple;
  const pax = Math.max(1, (ctx.adults || 1) + (ctx.children || 0));

  // the same flight sold by several sites: keep the cheapest
  const seen = new Map();
  for (const it of items) {
    if (!it || !it.price || !it.departure_at) continue;
    if (!inWindow(it.departure_at, ctx.departWindow)) continue;
    if (ctx.returnWindow && !ctx.oneWay && !inWindow(it.return_at, ctx.returnWindow)) continue;
    const k = `${it.airline}|${it.flight_number}|${it.departure_at}|${it.return_at || ''}`;
    if (!seen.has(k) || seen.get(k).price > it.price) seen.set(k, it);
  }
  let list = [...seen.values()];
  // trip length the traveller asked for (if any)
  if (!ctx.oneWay && !ctx.returnWindow && (ctx.nights || ctx.stayRange)) {
    const [lo, hi] = ctx.nights ? [ctx.nights - 2, ctx.nights + 2] : ctx.stayRange;
    const fit = list.filter((it) => it.return_at && nightsBetween(it.departure_at, it.return_at) >= lo && nightsBetween(it.departure_at, it.return_at) <= hi);
    if (fit.length) list = fit;
  }
  if (!list.length) return [];

  const perPersonBudget = ctx.budget && ctx.budget.currency === ctx.currency
    ? (ctx.budget.perPerson ? ctx.budget.amount : ctx.budget.amount / pax) : null;
  const minPrice = Math.min(...list.map((it) => it.price));
  const timed = list.filter((it) => travelTime(it) > 0);
  const minTime = timed.length ? Math.min(...timed.map(travelTime)) : 0;

  const scored = list.map((it) => {
    const dep = localParts(it.departure_at);
    const arr = it.timeless ? null : arrivalLocal(it.departure_at, it.duration_to, ctx.destTz);
    const late = !!arr && (arr.hour >= 23 || arr.hour < 5);
    const t = travelTime(it);
    const timePart = minTime && t ? t / minTime : 1.5; // unknown time: assume a bit slow
    const score = w.price * (it.price / minPrice) + w.time * timePart - w.quality * quality(it.airline) + (late ? w.night : 0);
    return { it, score, dep, arr, late, early: !it.timeless && dep.hour < 6, time: t, pax, perPersonBudget,
      overBudget: perPersonBudget ? it.price > perPersonBudget : false, stops: (it.transfers || 0) + (it.return_transfers || 0) };
  });

  const best = scored.reduce((a, b) => (b.score < a.score ? b : a));
  const cheapest = scored.reduce((a, b) => (b.it.price < a.it.price || (b.it.price === a.it.price && b.score < a.score) ? b : a));
  const withTime = scored.filter((s) => s.time > 0);
  const fastest = withTime.length ? withTime.reduce((a, b) => (b.time < a.time || (b.time === a.time && b.it.price < a.it.price) ? b : a)) : null;

  // one card per flight; a flight can earn more than one title
  const picks = [];
  const add = (s, label) => {
    const have = picks.find((x) => x.s === s);
    if (have) have.labels.push(label); else picks.push({ s, labels: [label] });
  };
  const n = scored.length;
  if (n === 1) add(best, 'Fare seen'); // one fare: no superlatives
  else {
    add(best, 'Best overall');
    add(cheapest, 'Cheapest');
    if (fastest && fastest.time < cheapest.time) add(fastest, 'Fastest');
  }
  // fill up to 3 with the next best-balanced flights on other airlines
  for (const s of [...scored].sort((a, b) => a.score - b.score)) {
    if (picks.length >= 3) break;
    if (!picks.some((x) => x.s === s || x.s.it.airline === s.it.airline)) picks.push({ s, labels: ['Also good'] });
  }
  return picks.map(({ s, labels }, i) => ({
    ...s, rank: i + 1, labels, poolSize: n, isCheapest: s === cheapest && n > 1,
    reasons: reasonsFor(s, { labels, cheapest, n }),
  }));
}

// Short, human reasons: why this one, and what to watch out for.
function reasonsFor(s, { labels, cheapest, n }) {
  const why = [];
  const warn = [];
  const q = quality(s.it.airline);
  const r = RATINGS[s.it.airline];
  if (labels.includes('Cheapest') && n > 1) why.push('lowest price');
  if (labels.includes('Fastest') && s.time) why.push(`least time travelling (${hm(s.time)}${s.it.return_at ? ' both ways' : ''})`);
  if (q >= 0.4 && r) why.push('well rated by passengers');
  if (!labels.includes('Cheapest') && cheapest && s !== cheapest) {
    const more = Math.round(((s.it.price - cheapest.it.price) / cheapest.it.price) * 100);
    const quicker = cheapest.time && s.time ? cheapest.time - s.time : 0;
    const gap = more >= 100 ? `${(s.it.price / cheapest.it.price).toFixed(1)}× the cheapest price` : `${more}% more than the cheapest`;
    why.push(`${gap}${quicker >= 60 ? `, ${hm(quicker)} less travelling` : ''}`);
  }
  if (s.it.transfers === 0 && (!s.it.return_at || !s.it.return_transfers)) why.push('non-stop');
  if (s.perPersonBudget && !s.overBudget) why.push('within your budget');
  why.splice(3); // keep it short: the three most useful reasons
  if (BUDGET.has(s.it.airline)) warn.push('budget airline: check what baggage and meals are included');
  if (s.it.stopover_wait >= 12 * 60) warn.push(`long waits at stopovers (about ${hm(s.it.stopover_wait)} in total)`);
  if (s.late) warn.push('lands late at night: plan your airport transfer');
  if (s.early) warn.push('very early departure');
  if (s.overBudget) warn.push('above your budget');
  return { why, warn };
}

export function cheapestDates(items, n = 5) {
  const byDate = new Map();
  for (const it of items) {
    const d = (it.departure_at || '').slice(0, 10);
    if (d && (!byDate.has(d) || byDate.get(d).price > it.price)) byDate.set(d, it);
  }
  return [...byDate.values()].sort((a, b) => a.price - b.price).slice(0, n);
}
