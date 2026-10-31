// Multi-country / multi-city trips: "Uzbekistan, Kyrgyzstan and Turkmenistan in 7 days".
// The free price data can't price a whole multi-city ticket, so Maya prices it the way
// a savvy backpacker would: one-way legs (home → A → B → C → home), cheapest near each date,
// with honest tips (tight schedules, short hops by road, hard visas).

import { searchFares, bookingUrl, liveSearchUrl } from './tp.js';
import { placeByCode, coordsFor } from './places.js';
import { countryName } from './countries.js';
import { visaFor, visaLine, countryVisaMap, yesCountries, needsEmbassy } from './visa.js';
import { send, btn, url, esc } from './tg.js';
import { addDays } from './parse.js';
import { PERSONAS } from './rank.js';
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

export function multiSummary(user, d, vmap, firstName) {
  const { legs, perStop, totalNights } = planLegs(d);
  const pax = (d.adults || 1) + (d.children || 0);
  const who = d.persona ? PERSONAS[d.persona].label : 'Travellers';
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

export function multiKeyboard(d) {
  const kb = [[btn('✅ Price this route', 'd:mgo')]];
  const nights = [d.multi.length * 2, d.multi.length * 3, d.multi.length * 4];
  kb.push(nights.map((n) => btn(`${(d.nights || d.multi.length * 3) === n ? '✅ ' : ''}${n} nights`, `d:mn:${n}`)));
  if (d.multi.length > 2) kb.push(d.multi.map((c) => btn(`✖ ${name(c)}`, `d:mrm:${c}`)));
  kb.push([btn('👥 Change group', 'd:grp'), btn('📅 Change month', 'd:dates')]);
  return kb;
}

// Cheapest one-way fare for a leg near its planned date (± 3 days, else any day that month).
async function priceLeg(env, leg, currency, window = 3, minDate = null) {
  const months = [...new Set([leg.date.slice(0, 7), addDays(leg.date, window).slice(0, 7)])];
  let items = [];
  let cur = currency;
  for (const m of months) {
    const r = await searchFares(env, { origin: leg.from, destination: leg.to, depart: m, oneWay: true, currency });
    if (r.items.length) { items = items.concat(r.items); cur = r.currency; }
  }
  // a later leg can never leave before the previous one (at least one night in each place)
  if (minDate) items = items.filter((i) => i.departure_at.slice(0, 10) >= minDate);
  if (!items.length) return { none: true };
  const lo = addDays(leg.date, -window);
  const hi = addDays(leg.date, window);
  const near = items.filter((i) => i.departure_at.slice(0, 10) >= lo && i.departure_at.slice(0, 10) <= hi);
  const pool = near.length ? near : items;
  const best = pool.reduce((a, b) => (b.price < a.price ? b : a));
  return { best, cur, offDate: !near.length };
}

export async function runMulti(env, user, chat, d, h) {
  const { legs } = planLegs(d);
  const pax = (d.adults || 1) + (d.children || 0);
  const results = [];
  let minDate = null;
  for (const leg of legs) {
    const r = { leg, dist: km(leg.from, leg.to), ...(await priceLeg(env, leg, user.currency || 'usd', d.flex === 'exact' ? 1 : 3, minDate)) };
    results.push(r);
    // next leg: at least one night after this one (or after the planned date if this leg had no price)
    minDate = addDays(r.best ? r.best.departure_at.slice(0, 10) : leg.date, 1);
  }
  const priced = results.filter((r) => r.best);
  const cur = priced[0]?.cur || user.currency || 'usd';
  const lines = [`Here's your route, ${h.firstName} 🗺️`, ''];
  const kb = [];
  let total = 0;
  let missing = 0;
  for (const [i, r] of results.entries()) {
    const title = `<b>${i + 1}) ${esc(name(r.leg.from))} → ${esc(name(r.leg.to))}</b>${r.dist ? ` · ${r.dist.toLocaleString('en-US')} km` : ''}`;
    if (r.best && r.cur === cur) {
      total += r.best.price;
      const stops = stopsText(r.leg.from, r.leg.to, r.best.duration_to || r.best.duration, r.best.transfers);
      lines.push(`${title}\n✈️ <b>${esc(h.airline(r.best.airline))}</b> · ${money(r.best.price, cur)} pp · ${stops} · ${day(r.best.departure_at)}${r.offDate ? ' <i>(nearest date with a price)</i>' : ''}`);
      const meta = { sid: null, origin: r.leg.from, destination: r.leg.to, depart: r.best.departure_at.slice(0, 10), ret: null, adults: d.adults, children: d.children || 0 };
      const href = await h.trackedLink(env, bookingUrl(env, r.best), user.id, 'flight', meta);
      if (href) kb.push([url(`${i + 1}) ${h.airline(r.best.airline)} · ${name(r.leg.from)} → ${name(r.leg.to)} · ${money(r.best.price, cur)} · Book`, href)]);
    } else {
      missing += 1;
      const road = r.dist && r.dist < 800;
      lines.push(`${title}\n${road ? '🚌 Short hop: buses or shared taxis are common and often cheaper than flying. ' : ''}No recent flight price; check live.`);
      const live = liveSearchUrl(env, { origin: r.leg.from, destination: r.leg.to, depart: r.leg.date, adults: d.adults });
      kb.push([url(`🔎 Live prices, leg ${i + 1}: ${name(r.leg.from)} → ${name(r.leg.to)}`, await h.trackedLink(env, live, user.id, 'live'))]);
    }
  }
  lines.push('');
  if (priced.length) {
    lines.push(`💰 Flights found: about <b>${money(total, cur)}</b> per person${pax > 1 ? `, ${money(total * pax, cur)} for ${pax}` : ''}${missing ? ` (plus ${missing} leg${missing > 1 ? 's' : ''} to check)` : ''}.`);
  } else {
    lines.push('I have no recent prices on these routes yet. The live-search buttons check every airline right now.');
  }
  const vmap = await countryVisaMap(env, user.id);
  const hard = [...new Set(d.multi.map((c) => placeByCode(c)?.cc))]
    .map((cc) => ({ cc, v: visaFor(list(user.passports), list(user.visas), cc, yesCountries(vmap)) }))
    .filter((x) => needsEmbassy(x.v));
  for (const x of hard) lines.push(visaLine(x.v, x.cc));
  lines.push('<i>Prices were seen by travellers in the last 48 h; each booking site shows the live price.</i>');
  const shareText = `🗺️ ${[d.origin, ...d.multi].map(name).join(' → ')}: flights from about ${money(total, cur)} per person. Planned with Maya on CityWide Trip Planner.`;
  kb.push([btn('✏️ Change', 'd:mchg'), url('📤 Share on WhatsApp', `https://wa.me/?text=${encodeURIComponent(shareText)}`)]);
  if (h.gearButton) {
    const g = await h.gearButton(env, user, d, results[0]?.best);
    if (g) kb.push([g]);
  }
  return send(env, chat.id, lines.join('\n'), kb);
}
