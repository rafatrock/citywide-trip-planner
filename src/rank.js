// Ranks fares the way an experienced friend would for THIS group,
// and writes the short "why" for each pick. Pure functions (easy to test).

export const PERSONAS = {
  family: { label: 'Family with kids', price: 1.0, stops: 0.6, duration: 0.5, lateArrival: 0.9, earlyDeparture: 0.6, maxStops: 1 },
  friends: { label: 'Friends group', price: 2.0, stops: 0.3, duration: 0.3, lateArrival: 0.25, earlyDeparture: 0.2, maxStops: 2 },
  backpacker: { label: 'Solo / budget', price: 4.0, stops: 0.15, duration: 0.15, lateArrival: 0.1, earlyDeparture: 0.05, maxStops: 3 },
  women: { label: "Women's group", price: 1.0, stops: 0.4, duration: 0.3, lateArrival: 1.1, earlyDeparture: 0.3, maxStops: 2 },
  couple: { label: 'Couple', price: 1.0, stops: 0.4, duration: 0.4, lateArrival: 0.4, earlyDeparture: 0.3, maxStops: 2 },
  corporate: { label: 'Business trip', price: 0.5, stops: 0.9, duration: 0.8, lateArrival: 0.3, earlyDeparture: 0.4, maxStops: 1 },
};

const LATE_FROM = 23; // arrivals from 23:00 ...
const LATE_TO = 5; // ... to 04:59 count as late night
const EARLY_DEP = 6; // departures before 06:00 are very early

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

export function comfortScore(s, minPrice, minDur) {
  const dur = s.it.duration_to || s.it.duration || 0;
  return s.stops * 1.0
    + (dur && minDur ? (dur / minDur - 1) * 0.8 : 0)
    + (s.late ? 1.2 : 0)
    + (s.early ? 0.8 : 0)
    + (s.it.price / minPrice > 1.6 ? 1 : 0); // comfort, but not at any price
}

const inWindow = (iso, w) => !w || (iso && iso.slice(0, 10) >= w.from && iso.slice(0, 10) <= w.to);

export function rankFares(items, ctx) {
  const p = PERSONAS[ctx.persona] || PERSONAS.couple;
  const pax = Math.max(1, (ctx.adults || 1) + (ctx.children || 0));

  // de-duplicate the same flight sold by several sites: keep the cheapest
  const seen = new Map();
  for (const it of items) {
    if (!it || !it.price || !it.departure_at) continue;
    if (!inWindow(it.departure_at, ctx.departWindow)) continue;
    if (ctx.returnWindow && !ctx.oneWay && !inWindow(it.return_at, ctx.returnWindow)) continue;
    const k = `${it.airline}|${it.flight_number}|${it.departure_at}|${it.return_at || ''}`;
    if (!seen.has(k) || seen.get(k).price > it.price) seen.set(k, it);
  }
  let list = [...seen.values()];

  if (ctx.nights && !ctx.oneWay && !ctx.returnWindow) {
    const fit = list.filter((it) => it.return_at && Math.abs(nightsBetween(it.departure_at, it.return_at) - ctx.nights) <= 2);
    if (fit.length) list = fit;
  }
  if (!list.length) return [];

  const minPrice = Math.min(...list.map((i) => i.price));
  const durOf = (i) => i.duration_to || i.duration || 0;
  const minDur = Math.min(...list.map(durOf).filter(Boolean)) || 1;
  const perPersonBudget = ctx.budget && ctx.budget.currency === ctx.currency
    ? (ctx.budget.perPerson ? ctx.budget.amount : ctx.budget.amount / pax) : null;

  const scored = list.map((it) => {
    const stops = (it.transfers || 0) + (it.return_transfers || 0);
    const dep = localParts(it.departure_at);
    const arr = arrivalLocal(it.departure_at, it.duration_to, ctx.destTz);
    const late = arr ? (arr.hour >= LATE_FROM || arr.hour < LATE_TO) : false;
    const early = dep.hour < EARLY_DEP;
    const overBudget = perPersonBudget ? it.price > perPersonBudget : false;
    const score = (it.price / minPrice - 1) * p.price
      + stops * p.stops
      + (durOf(it) ? (durOf(it) / minDur - 1) * p.duration : 0)
      + (late ? p.lateArrival * (ctx.avoidNight ? 2 : 1) : 0)
      + (early ? p.earlyDeparture * (ctx.avoidNight ? 2 : 1) : 0)
      + ((it.transfers || 0) > p.maxStops ? 1.5 : 0)
      + (overBudget ? 0.5 : 0);
    return { it, score, stops, dep, arr, late, early, overBudget, pax, perPersonBudget };
  });
  for (const s of scored) s.comfort = comfortScore(s, minPrice, minDur);

  const byScore = [...scored].sort((a, b) => a.score - b.score);
  const best = byScore[0];
  const cheapest = scored.reduce((a, b) => (b.it.price < a.it.price || (b.it.price === a.it.price && b.score < a.score) ? b : a));
  const comfy = scored.reduce((a, b) => (b.comfort < a.comfort || (b.comfort === a.comfort && b.it.price < a.it.price) ? b : a));

  // One card per distinct flight; a flight can win more than one title.
  const picks = [];
  const add = (s, label) => {
    const existing = picks.find((x) => x.s === s);
    if (existing) existing.labels.push(label);
    else picks.push({ s, labels: [label] });
  };
  add(best, 'Best overall');
  add(cheapest, 'Cheapest');
  add(comfy, 'Most comfortable');
  for (const s of byScore) {
    if (picks.length >= 3) break;
    if (!picks.some((x) => x.s === s)) picks.push({ s, labels: ['Also good'] });
  }
  return picks.map(({ s, labels }, i) => ({
    ...s, rank: i + 1, labels, isCheapest: s === cheapest, reasons: reasonsFor(s, ctx, p, s === cheapest),
  }));
}

function reasonsFor(s, ctx, p, isCheapest) {
  const why = [];
  const warn = [];
  if (isCheapest) why.push('cheapest found');
  if (s.it.transfers === 0) why.push('direct');
  if (s.arr && !s.late && s.arr.hour >= 7 && s.arr.hour < 21) why.push('daytime arrival');
  if (s.perPersonBudget && !s.overBudget) why.push('within your budget');
  if (s.late) warn.push(ctx.persona === 'family' || ctx.persona === 'women'
    ? 'lands late at night; ranked lower for your group (consider a pre-booked transfer)'
    : 'lands late at night; check transport from the airport');
  if (s.early) warn.push('very early departure');
  if ((s.it.transfers || 0) > p.maxStops) warn.push(`${s.it.transfers} stops`);
  if (s.overBudget) warn.push('above your budget');
  return { why, warn };
}

// Cheapest few departure dates in a month (for "Cheaper dates").
export function cheapestDates(items, n = 5) {
  const byDate = new Map();
  for (const it of items) {
    const d = (it.departure_at || '').slice(0, 10);
    if (d && (!byDate.has(d) || byDate.get(d).price > it.price)) byDate.set(d, it);
  }
  return [...byDate.values()].sort((a, b) => a.price - b.price).slice(0, n);
}
