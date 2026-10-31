// Multi-country / multi-city trips: "Uzbekistan, Kyrgyzstan and Turkmenistan in 7 days".
// The free price data can't price a whole multi-city ticket, so Maya prices it the way
// a savvy backpacker would: one-way legs (home → A → B → C → home), cheapest near each date,
// with honest tips (tight schedules, short hops by road, hard visas).

import { searchFares, liveSearchUrl, moreFares, nearbyAirports } from './tp.js';
import { liveLeg, liveReady, liveAlways } from './live.js';
import { placeByCode, coordsFor } from './places.js';
import { countryName } from './countries.js';
import { visaFor, countryVisaMap, yesCountries, needsEmbassy, VISA_TIPS } from './visa.js';
import { send, btn, url, esc, logoLink, logoPreview } from './tg.js';
import { addDays } from './parse.js';
import { PERSONAS, localParts, arrivalLocal } from './rank.js';
import { money } from './format.js';

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const name = (c) => placeByCode(c)?.name || c;
const day = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function km(a, b) {
  const p = coordsFor(a);
  const q = coordsFor(b);
  if (!p || !q) return null;
  const r = Math.PI / 180;
  const h = Math.sin(((q[0] - p[0]) * r) / 2) ** 2 + Math.cos(p[0] * r) * Math.cos(q[0] * r) * Math.sin(((q[1] - p[1]) * r) / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(h)));
}

// Cached fares give total journey time and number of stops, not each flight's times.
// So the time to change planes is an estimate: total time minus typical flying time
// (route distance + 15% detour via the hub, ~780 km/h, ~30 min per take-off and landing).
// Returns minutes rounded to 15, or null when it can't be estimated sensibly.
export function connectionMinutes(from, to, totalMin, transfers) {
  if (!transfers || !totalMin) return null;
  const d = km(from, to);
  if (!d) return null;
  const fly = ((d * 1.15) / 780) * 60 + 30 * (transfers + 1);
  const wait = totalMin - fly;
  if (wait < 30) return null;
  return Math.round(wait / transfers / 15) * 15;
}
export const fmtWait = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
export function stopsText(from, to, totalMin, transfers, long = false) {
  if (!transfers) return 'Non-stop';
  const base = `${transfers} stop${transfers > 1 ? 's' : ''}`;
  const w = connectionMinutes(from, to, totalMin, transfers);
  if (!w) return base;
  return `${base} (about ${fmtWait(w)} ${long ? 'to change planes' : 'connection'}${transfers > 1 ? ' each' : ''}, estimated)`;
}

// Order stops to avoid backtracking (nearest next stop), if that's clearly shorter.
export function orderStops(origin, stops) {
  const total = (seq) => seq.reduce((s, c, i) => s + (km(i ? seq[i - 1] : origin, c) || 0), 0) + (km(seq[seq.length - 1], origin) || 0);
  const left = [...stops];
  const nn = [];
  let at = origin;
  while (left.length) {
    left.sort((a, b) => (km(at, a) ?? 1e9) - (km(at, b) ?? 1e9));
    at = left.shift();
    nn.push(at);
  }
  // also try the reverse direction of the nearest-neighbour loop
  const rev = [...nn].reverse();
  const best = total(rev) < total(nn) ? rev : nn;
  return total(best) < total(stops) * 0.9 ? { stops: best, reordered: true } : { stops, reordered: false };
}

export function planLegs(draft) {
  const stops = draft.multi;
  const totalNights = draft.nights || stops.length * 3;
  const per = Math.max(1, Math.floor(totalNights / stops.length));
  const extra = totalNights - per * stops.length;
  const start = draft.depart.type === 'date' ? draft.depart.value : `${draft.depart.value.slice(0, 7)}-10`;
  const legs = [];
  let date = start;
  let from = draft.origin;
  stops.forEach((s, i) => {
    legs.push({ from, to: s, date });
    const nights = per + (i < extra ? 1 : 0);
    date = addDays(date, nights);
    from = s;
  });
  if (!draft.oneWay) legs.push({ from, to: draft.origin, date });
  return { legs, perStop: totalNights / stops.length, totalNights };
}

export function multiSummary(user, d, vmap, firstName, h_groupLabel = (x) => (x.persona ? PERSONAS[x.persona].label : 'Travellers')) {
  const { legs, perStop, totalNights } = planLegs(d);
  const pax = (d.adults || 1) + (d.children || 0);
  const who = h_groupLabel(d);
  const route = [d.origin, ...d.multi, ...(d.oneWay ? [] : [d.origin])].map((c) => `${esc(name(c))}`).join(' → ');
  const lines = [
    `Got it, ${firstName}! A multi-country trip 🗺️`,
    `✈️ ${route}`,
    `📅 From ${day(legs[0].date)}${d.flex === '3d' ? ' (± 3 days)' : ''}, ${totalNights} nights in total: about ${Math.round(perStop * 10) / 10} nights in each place`,
    `👥 ${who} · ${pax} ${pax === 1 ? 'person' : 'people'}`,
  ];
  if (d.reordered) lines.push('<i>I put the stops in the order that avoids backtracking.</i>');
  if (perStop <= 2) lines.push(`\n⚠️ Honest tip: ${d.multi.length} stops in ${totalNights} nights is tight (about 2 nights or less each, and travel days eat into that). Most travellers do 2 countries in a week, or add a few days.`);
  const passports = list(user.passports);
  if (passports.length) {
    const visas = [];
    for (const cc of [...new Set(d.multi.map((c) => placeByCode(c)?.cc))]) {
      const v = visaFor(passports, list(user.visas), cc, yesCountries(vmap));
      if (v && v.code !== 'H') visas.push(`• ${esc(countryName(cc))}: ${esc(v.text)}`);
    }
    if (visas.length) lines.push(`\n🛂 Visas for your passport:\n${visas.join('\n')}`);
  }
  lines.push('\nI\'ll price each flight leg separately, which is usually cheapest for trips like this.');
  return lines.join('\n');
}

// Buttons under a priced route: change the length, drop a stop, change the group or month.
export function multiKeyboard(d) {
  const kb = [];
  const cur = d.nights || d.multi.length * 3;
  const nights = [...new Set([d.multi.length * 2, d.multi.length * 3, d.multi.length * 4, cur])].sort((a, b) => a - b);
  kb.push(nights.map((n) => btn(`${cur === n ? '✅ ' : ''}${n} nights`, `d:mn:${n}`)));
  if (d.multi.length > 2) kb.push(d.multi.map((c) => btn(`✖ ${name(c)}`, `d:mrm:${c}`)));
  kb.push([btn('👥 Change group', 'd:grp'), btn('📅 Change month', 'd:dates')]);
  return kb;
}

// ---------- prices for every leg ----------
// All fares for one leg around its planned date (all months it could fall in), fetched once.
async function legCandidates(env, leg, currency, spread) {
  const months = [...new Set([addDays(leg.date, -spread).slice(0, 7), leg.date.slice(0, 7), addDays(leg.date, spread).slice(0, 7)])];
  let res = await Promise.all(months.map((m) => searchFares(env, { origin: leg.from, destination: leg.to, depart: m, oneWay: true, currency })));
  // nothing in the main price index: ask the Data API's other indexes (cheap, direct, latest prices)
  if (!res.some((r) => r.items.length)) res = await Promise.all(months.map((m) => moreFares(env, { origin: leg.from, destination: leg.to, month: m, oneWay: true, currency })));
  const first = res.find((r) => r.items.length);
  const cur = first?.currency || currency;
  const seen = new Set();
  const items = res.filter((r) => r.items.length && r.currency === cur).flatMap((r) => r.items).filter((it) => {
    const k = `${it.airline}|${it.flight_number}|${it.departure_at}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return it.price > 0 && it.departure_at;
  });
  return { items, cur };
}

// A leg with no prices near the dates: a fair estimate, clearly labelled.
// 1) the cheapest seen on any day for this leg; 2) the same route in the other direction.
async function legEstimate(env, leg, currency) {
  // same month first (closest to the real price), then any day
  const [month, any] = await Promise.all([
    moreFares(env, { origin: leg.from, destination: leg.to, month: leg.date.slice(0, 7), oneWay: true, currency }),
    searchFares(env, { origin: leg.from, destination: leg.to, depart: null, oneWay: true, currency }),
  ]);
  for (const r of [month, any]) {
    if (!r.items.length) continue;
    const it = r.items.reduce((a, b) => (b.price < a.price ? b : a));
    return { price: it.price, cur: r.currency, how: `lowest seen for ${day(it.departure_at)}` };
  }
  const back = await searchFares(env, { origin: leg.to, destination: leg.from, depart: leg.date.slice(0, 7), oneWay: true, currency });
  if (back.items.length) {
    const it = back.items.reduce((a, b) => (b.price < a.price ? b : a));
    return { price: it.price, cur: back.currency, how: 'based on the same route the other way' };
  }
  return null;
}

// ---------- whole itineraries ----------
const LATE = (p) => p && (p.hour >= 23 || p.hour < 5);
function legView(it, leg, tz = placeByCode(leg.to)?.tz) {
  if (it.timeless) { // a price for a day, without flight times (shown on the booking page)
    const date = it.departure_at.slice(0, 10);
    return { it, dep: { date, hour: 12, minute: 0 }, arr: null, date, late: false, early: false, dur: it.duration_to || 0, stops: it.transfers || 0, timeless: true };
  }
  const dep = localParts(it.departure_at);
  const arr = it.arrival_local && /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(it.arrival_local)
    ? { date: it.arrival_local.slice(0, 10), hour: +it.arrival_local.slice(11, 13), minute: +it.arrival_local.slice(14, 16) }
    : (it.duration_to ? arrivalLocal(it.departure_at, it.duration_to, tz) : null);
  return { it, dep, arr, date: dep.date, late: LATE(arr), early: dep.hour < 6, dur: it.duration_to || it.duration || 0, stops: it.transfers || 0 };
}

// Beam search over the legs: keeps the best partial trips by `cost`, respecting the dates:
// first flight within ± window of the start; each next flight after at least minNights,
// and no later than the planned stay + window. Legs without prices keep their planned day.
const DAYS = new Map();
const plus = (iso, n) => { const k = `${iso}|${n}`; let v = DAYS.get(k); if (!v) { v = addDays(iso, n); DAYS.set(k, v); } return v; };
export function bestItinerary(legs, cands, { window, nightsPer, minNights, start, fixed = false }, cost, width = 20) {
  let beam = [{ picks: [], score: 0, last: null }];
  legs.forEach((leg, i) => {
    // score every fare of this leg once, best first (cheap on CPU: the free plan allows 10 ms)
    const views = cands[i]?.views || (cands[i]?.items || []).map((it) => legView(it, leg));
    const ranked = views.map((v) => ({ v, c: cost(v, i) })).sort((a, b) => a.c - b.c);
    const next = [];
    for (const st of beam) {
      // exact dates: every flight stays near its own planned day; flexible: the stay length is kept
      const t = i === 0 ? start : fixed ? leg.date : plus(st.last, nightsPer[i - 1]);
      const lo = i === 0 ? plus(t, -window) : plus(st.last, minNights);
      const hi = plus(t, window);
      let n = 0;
      for (const r of ranked) {
        if (r.v.date < lo || r.v.date > hi) continue;
        next.push({ picks: [...st.picks, { leg: { ...leg, date: r.v.date }, view: r.v }], score: st.score + r.c, last: r.v.date });
        if (++n >= 8) break; // the 8 best fares that fit this partial trip
      }
      if (!n) {
        const date = t < lo ? lo : t;
        next.push({ picks: [...st.picks, { leg: { ...leg, date }, view: null }], score: st.score + cost(null, i), last: date });
      }
    }
    next.sort((a, b) => a.score - b.score);
    // keep variety: at most 4 partial trips ending on the same day
    const perDay = {};
    beam = next.filter((x) => (perDay[x.last] = (perDay[x.last] || 0) + 1) <= 4).slice(0, width);
  });
  return beam[0] || null;
}

export function threeItineraries(legs, cands0, opts, persona) {
  const w = PERSONAS[persona] || PERSONAS.friends;
  // work out each fare's times once, shared by the three searches
  // and keep at most 40 per leg: the 25 cheapest and the 15 quickest of the rest
  const cands = cands0.map((c, i) => {
    const tz = placeByCode(legs[i].to)?.tz;
    const items = [...(c.items || [])].sort((a, b) => a.price - b.price);
    const keep = items.slice(0, 25).concat(items.slice(25).sort((a, b) => (a.duration_to || 1e4) - (b.duration_to || 1e4)).slice(0, 15));
    return { ...c, items: keep, views: keep.map((it) => legView(it, legs[i], tz)) };
  });
  const minP = cands.map((c) => (c.items.length ? Math.min(...c.items.map((x) => x.price)) : 1));
  const minD = cands.map((c) => (c.items.length ? Math.min(...c.items.map((x) => x.duration_to || x.duration || 1e4)) : 1));
  const cheap = bestItinerary(legs, cands, opts, (v, i) => (v ? v.it.price : 0));
  const fast = bestItinerary(legs, cands, opts, (v, i) => (v ? v.dur * 1000 + v.it.price / 1e6 : 0));
  const best = bestItinerary(legs, cands, opts, (v, i) => (v ? (v.it.price / minP[i]) * w.price + (v.dur / minD[i]) * w.duration
    + v.stops * w.stops + (v.late ? w.lateArrival : 0) + (v.early ? w.earlyDeparture : 0) : 0));
  return { best, cheap, fast };
}

const sig = (t) => t.picks.map((p) => (p.view ? `${p.view.it.airline}${p.view.it.flight_number}${p.view.it.departure_at}` : p.leg.date)).join('|');
const totalOf = (t) => t.picks.reduce((s, p) => s + (p.view ? p.view.it.price : 0), 0);
const timeOf = (t) => t.picks.reduce((s, p) => s + (p.view ? p.view.dur : 0), 0);
const hm = (p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
const dur = (m) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '');
// Real layovers from live data: "1 stop: KUL 1h 50m"
function layoverText(it) {
  if (!it.live) return '';
  if (!it.layovers?.length) return 'Non-stop';
  return `${it.layovers.length} stop${it.layovers.length > 1 ? 's' : ''}: ${it.layovers.map((l) => `${l.code} ${dur(l.minutes).replace(/ 00m$/, 'h').replace('h 0', 'h ')}${l.overnight ? ' overnight' : ''}`).join(', ')}`;
}
const NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];

export async function runMulti(env, user, chat, d, h) {
  const { legs, totalNights } = planLegs(d);
  const pax = (d.adults || 1) + (d.children || 0);
  const flexible = d.flex !== 'exact';
  const window = d.flex === 'month' ? 6 : flexible ? 3 : 1;
  const per = Math.max(1, Math.floor(totalNights / d.multi.length));
  const extra = totalNights - per * d.multi.length;
  const nightsPer = d.multi.map((_, i) => per + (i < extra ? 1 : 0));
  const minNights = Math.max(1, per - 1);
  const currency = user.currency || 'usd';
  // every leg's prices at the same time (much faster than one after another)
  const cands = await Promise.all(legs.map((leg) => legCandidates(env, leg, currency, window + 3)));
  // LIVE prices (Google Flights) for flights the free data can't price near the planned day,
  // or for every flight when LIVE_MODE = "always". All legs are asked at the same time.
  let anyLive = false;
  if (liveReady(env)) {
    await Promise.all(legs.map(async (leg, i) => {
      const near = cands[i].items.some((it) => Math.abs(Date.parse(it.departure_at.slice(0, 10)) - Date.parse(leg.date)) <= window * 86400000);
      if (near && !liveAlways(env)) return;
      const live = await liveLeg(env, user, { from: leg.from, to: leg.to, date: leg.date, adults: d.adults || 1, children: d.children || 0, currency });
      if (live && live.items.length) {
        anyLive = true;
        const same = cands[i].cur === live.cur || !cands[i].items.length;
        cands[i] = { cur: live.cur, items: same ? [...live.items, ...cands[i].items] : live.items };
      }
    }));
  }
  const cur = cands.find((c) => c.items.length)?.cur || currency;
  cands.forEach((c, i) => { if (c.cur !== cur) cands[i] = { items: [], cur }; }); // one currency per answer
  const opts = { window, nightsPer, minNights, start: legs[0].date, fixed: !flexible };
  const { best, cheap, fast } = threeItineraries(legs, cands, opts, d.persona);
  // legs that still have no price: an estimate, clearly labelled
  const missing = best.picks.map((p, i) => (p.view ? null : i)).filter((i) => i !== null);
  const est = {};
  await Promise.all(missing.map(async (i) => {
    const e = await legEstimate(env, legs[i], currency);
    if (e && e.cur === cur) est[i] = e;
  }));
  const estTotal = Object.values(est).reduce((s, e) => s + e.price, 0);
  let nearbyTip = '';
  const firstMissing = missing.find((i) => !est[i]) ?? missing[0];
  if (firstMissing !== undefined) {
    const leg = legs[firstMissing];
    const near = await nearbyAirports(env, { origin: leg.from, destination: leg.to, month: leg.date.slice(0, 7), currency });
    if (near.length) {
      const n = near[0];
      nearbyTip = `💡 Nearby airports: ${esc(name(n.origin))} (${n.origin}) → ${esc(name(n.destination))} (${n.destination}) seen from <b>${money(n.value, cur)}</b>${n.depart_date ? ` on ${day(n.depart_date)}` : ''}.`;
    }
  }
  const unknown = missing.filter((i) => !est[i]).length;

  // the three options, merged when they are the same trip
  const options = [];
  for (const [key, t, icon, label] of [['best', best, '⭐', 'Best overall'], ['cheap', cheap, '💰', 'Cheapest'], ['fast', fast, '⚡', 'Fastest']]) {
    if (!t) continue;
    const same = options.find((o) => sig(o.t) === sig(t));
    if (same) { same.labels.push(label); continue; }
    options.push({ key, t, icon, labels: [label] });
  }
  const cheapTotal = totalOf(cheap);
  const fastTime = timeOf(fast);
  const lines = [
    `Here's your trip, ${h.firstName} 🗺️`,
    `<b>${[d.origin, ...d.multi, ...(d.oneWay ? [] : [d.origin])].map((c) => esc(name(c))).join(' → ')}</b>`,
    `👥 ${esc(h.groupLabel ? h.groupLabel(d) : 'Travellers')} · ${pax} ${pax === 1 ? 'person' : 'people'} · ${totalNights} nights · from ${day(legs[0].date)}${flexible ? ` (± ${window} days)` : ''}`,
  ];
  if (d.reordered) lines.push('<i>I put the stops in the order that avoids backtracking.</i>');
  lines.push(anyLive
    ? '<i>Prices per person for the whole trip. 🟢 = live from Google Flights just now; others seen by travellers in the last 48 h.</i>'
    : '<i>Prices per person for the whole trip, as seen by travellers in the last 48 h.</i>');

  for (const o of options) {
    const total = totalOf(o.t) + estTotal;
    if (!total) {
      lines.push('', `🗓️ <b>YOUR TRIP</b> <i>(no recent prices for these flights: the booking button checks every airline live)</i>`);
      o.t.picks.forEach((p, i) => lines.push(`${NUM[i] || `${i + 1})`} ${day(p.leg.date)} · ${p.leg.from} → ${p.leg.to}`));
      continue;
    }
    const real = o.t.picks.some((p) => p.view);
    if (!real) {
      lines.push('', `🧭 <b>PRICE GUIDE · ≈ ${money(total, cur)}</b>${pax > 1 ? ` <i>(≈ ${money(total * pax, cur)} for ${pax})</i>` : ''}`,
        '<i>No fares seen yet for these dates. This guide comes from other days; the button below searches every airline live.</i>');
      o.t.picks.forEach((p, i) => {
        const n = NUM[i] || `${i + 1})`;
        lines.push(est[i] ? `${n} ${day(p.leg.date)} · ${p.leg.from} → ${p.leg.to} · ≈ ${money(est[i].price, cur)} <i>(${esc(est[i].how)})</i>`
          : `${n} ${day(p.leg.date)} · ${p.leg.from} → ${p.leg.to} · checked live when you open the trip`);
      });
      continue;
    }
    lines.push('', `${o.icon} <b>${o.labels.join(' · ').toUpperCase()} · ${est && Object.keys(est).length ? '≈ ' : ''}${money(total, cur)}</b>${pax > 1 ? ` <i>(${money(total * pax, cur)} for ${pax})</i>` : ''}${unknown ? ` <i>+ ${unknown} flight${unknown > 1 ? 's' : ''} to check</i>` : ''}`);
    o.t.picks.forEach((p, i) => {
      const n = NUM[i] || `${i + 1})`;
      if (p.view) {
        const v = p.view;
        const fno = /^\d{1,4}$/.test(String(v.it.flight_number || '')) ? ` ${v.it.airline} ${v.it.flight_number}` : '';
        const plus = v.arr && v.arr.date > v.date ? ' (+1)' : '';
        const carrier = v.it.airline_name || h.airline(v.it.airline);
        const flights = v.it.flights?.length ? ` ${v.it.flights.join(' + ')}` : fno;
        if (v.timeless) {
          lines.push(`${n} <b>${esc(v.it.airline ? carrier : 'Fare seen')}</b>${esc(flights)} · ${money(v.it.price, cur)}`);
          lines.push(`     ${day(v.date)} · ${p.leg.from} → ${p.leg.to} · ${v.stops ? `${v.stops} stop${v.stops > 1 ? 's' : ''}` : 'Non-stop'} · times on the booking page`);
          return;
        }
        lines.push(`${n} <b>${esc(carrier)}</b>${esc(flights)} · ${money(v.it.price, cur)}${v.it.live ? ' 🟢' : ''}`);
        lines.push(`     ${day(v.date)} · ${p.leg.from} ${hm(v.dep)} → ${p.leg.to}${v.arr ? ` ${hm(v.arr)}${plus}` : ''} · ${dur(v.dur)} · ${layoverText(v.it) || stopsText(p.leg.from, p.leg.to, v.dur, v.stops)}`);
      } else if (est[i]) {
        lines.push(`${n} ${day(p.leg.date)} · ${p.leg.from} → ${p.leg.to} · ≈ ${money(est[i].price, cur)}`);
        lines.push(`     <i>guide only (${esc(est[i].how)}); airlines and live price when you open the trip</i>`);
      } else {
        lines.push(`${n} ${day(p.leg.date)} · ${p.leg.from} → ${p.leg.to} · no price seen yet, checked live when you open the trip`);
      }
      const k = km(p.leg.from, p.leg.to);
      if (!p.view && k && k < 800) lines.push('     🚌 Short hop: buses or shared taxis are common and often cheaper than flying.');
    });
    // why this one
    const why = [];
    const late = o.t.picks.filter((p) => p.view?.late).length;
    const early = o.t.picks.filter((p) => p.view?.early).length;
    const stops = o.t.picks.reduce((s, p) => s + (p.view?.stops || 0), 0);
    const diff = totalOf(o.t) - cheapTotal;
    if (o.labels.includes('Cheapest')) why.push('lowest total price');
    if (o.labels.includes('Fastest') && timeOf(o.t)) why.push(`least time flying (${dur(timeOf(o.t))} in all)`);
    const saves = timeOf(cheap) - timeOf(o.t);
    if (o.labels.includes('Best overall') && !o.labels.includes('Cheapest')) why.push(`only ${money(diff, cur)} more than the cheapest${saves >= 30 ? `, ${dur(saves)} less flying` : ''}, better times`);
    if (!o.labels.includes('Cheapest') && !o.labels.includes('Best overall') && diff > 0) why.push(`costs ${money(diff, cur)} more than the cheapest`);
    if (!stops && o.t.picks.every((p) => p.view)) why.push('all non-stop');
    const warn = [];
    if (late) warn.push(`${late} late-night arrival${late > 1 ? 's' : ''}`);
    if (early) warn.push(`${early} very early departure${early > 1 ? 's' : ''}`);
    if (stops) warn.push(`${stops} stop${stops > 1 ? 's' : ''} in total`);
    lines.push(`✅ ${why.join('; ')}${warn.length ? `\n⚠️ ${warn.join('; ')}` : ''}`);
  }

  if (nearbyTip) lines.push('', nearbyTip);
  const vmap = await countryVisaMap(env, user.id);
  const visas = [...new Set(d.multi.map((c) => placeByCode(c)?.cc))]
    .map((cc) => ({ cc, v: visaFor(list(user.passports), list(user.visas), cc, yesCountries(vmap)) }))
    .filter((x) => x.v && x.v.code !== 'H');
  if (visas.length) {
    lines.push('', `🛂 ${visas.map((x) => `${esc(countryName(x.cc))}: ${esc(x.v.text)}`).join(' · ')}`);
    for (const x of visas.filter((y) => needsEmbassy(y.v) && VISA_TIPS[y.cc])) lines.push(`<i>${esc(VISA_TIPS[x.cc])}</i>`);
  }
  if (d.multi.length > 1 && totalNights / d.multi.length <= 2) lines.push(`⚠️ Honest tip: ${d.multi.length} stops in ${totalNights} nights is tight; travel days eat into it. Most travellers do 2 countries in a week.`);
  lines.push('', '🎫 Tap an option to see live prices and book the <b>whole trip in one go</b>.');

  // one whole-trip link per different set of dates
  const kb = [];
  const links = [];
  for (const o of options) {
    const ls = o.t.picks.map((p) => p.leg);
    const pax = { adults: d.adults || 1, children: d.children || 0 };
    const href = ls.length === 1 ? liveSearchUrl(env, { origin: ls[0].from, destination: ls[0].to, depart: ls[0].date, ...pax })
      : ls.length === 2 && ls[1].to === ls[0].from ? liveSearchUrl(env, { origin: ls[0].from, destination: ls[0].to, depart: ls[0].date, ret: ls[1].date, ...pax })
        : h.multiCityUrl(env, ls, pax);
    const have = links.find((l) => l.href === href);
    if (have) { have.labels.push(...o.labels); continue; }
    links.push({ href, labels: [...o.labels], icon: o.icon, total: o.t.picks.some((p) => p.view) ? totalOf(o.t) + estTotal : 0 });
  }
  const tracked = await Promise.all(links.map((l) => h.trackedLink(env, l.href, user.id, 'live', { origin: d.origin, destination: d.multi[0], depart: legs[0].date, multi: true, label: l.labels[0] })));
  links.forEach((l, i) => {
    const text = !l.total ? '🔎 See live prices & book the whole trip'
      : links.length === 1 ? `🎫 Book the whole trip · from ${money(l.total, cur)}` : `${l.icon} ${l.labels.join(' · ')} · ${money(l.total, cur)} · Book trip`;
    kb.push([url(text, tracked[i])]);
  });
  if (d.paxGuess && h.paxRows) kb.push(...h.paxRows(d));
  kb.push(...(h.single ? [[btn('👥 Change group', 'd:grp'), btn('📅 Change dates', 'd:dates')]] : multiKeyboard(d)));
  const shareText = `🗺️ ${[d.origin, ...d.multi, d.origin].map(name).join(' → ')}, from ${day(legs[0].date)}: about ${money(totalOf(best) + estTotal, cur)} per person for all flights. Planned with Maya on CityWide Trip Planner.`;
  kb.push([url('📤 Share on WhatsApp', `https://wa.me/?text=${encodeURIComponent(shareText)}`)]);
  if (h.gearButton) {
    const g = await h.gearButton(env, user, d, best.picks[0]?.view?.it);
    if (g) kb.push([g]);
  }
  // the top option's airline logo above the card (Aviasales logo service)
  const lead = best.picks.find((p) => p.view && /^[A-Z0-9]{2}$/.test(p.view.it.airline || ''))?.view.it.airline;
  return send(env, chat.id, logoLink(lead) + lines.join('\n'), kb, logoPreview(lead));
}
