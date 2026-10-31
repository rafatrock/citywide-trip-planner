// Multi-country / multi-city trips: "Uzbekistan, Kyrgyzstan and Turkmenistan in 7 days".
// The free price data can't price a whole multi-city ticket, so Maya prices it the way
// a savvy backpacker would: one-way legs (home → A → B → C → home), cheapest near each date,
// with honest tips (tight schedules, short hops by road, hard visas).

import { searchFares, bookingUrl } from './tp.js';
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

export function multiKeyboard(d) {
  const kb = [[btn('✅ Price this route', 'd:mgo')]];
  const nights = [d.multi.length * 2, d.multi.length * 3, d.multi.length * 4];
  kb.push(nights.map((n) => btn(`${(d.nights || d.multi.length * 3) === n ? '✅ ' : ''}${n} nights`, `d:mn:${n}`)));
  if (d.multi.length > 2) kb.push(d.multi.map((c) => btn(`✖ ${name(c)}`, `d:mrm:${c}`)));
  kb.push([btn('👥 Change group', 'd:grp'), btn('📅 Change month', 'd:dates')]);
  return kb;
}

// All fares for one leg around its planned date (all months it could fall in), fetched once.
async function legCandidates(env, leg, currency, spread) {
  const months = [...new Set([addDays(leg.date, -spread).slice(0, 7), leg.date.slice(0, 7), addDays(leg.date, spread).slice(0, 7)])];
  const res = await Promise.all(months.map((m) => searchFares(env, { origin: leg.from, destination: leg.to, depart: m, oneWay: true, currency })));
  const first = res.find((r) => r.items.length);
  const cur = first?.currency || currency;
  return { items: res.filter((r) => r.items.length && r.currency === cur).flatMap((r) => r.items), cur, capped: res.some((r) => r.capped) };
}

// Picks a date and fare for every leg in order: cheapest within ± window of the target day,
// never cutting a stay below minNights (flexible) and never going backwards in time.
export function chooseLegs(legs, cands, { window, nightsPer, minNights }) {
  const out = [];
  let prev = null;
  legs.forEach((leg, i) => {
    const target = i === 0 ? leg.date : addDays(prev, nightsPer[i - 1]);
    const earliest = i === 0 ? addDays(target, -window) : addDays(prev, minNights);
    const lo = earliest > addDays(target, -window) ? earliest : addDays(target, -window);
    const hi = addDays(target, window) < lo ? lo : addDays(target, window);
    const pool = (cands[i]?.items || []).filter((it) => {
      const d = it.departure_at.slice(0, 10);
      return d >= lo && d <= hi;
    });
    const best = pool.length ? pool.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    // a second option to compare: fewer stops first, else another airline
    let alt = null;
    if (best) {
      const others = pool.filter((it) => it !== best && it.price < best.price * 1.8);
      const fewer = others.filter((it) => (it.transfers || 0) < (best.transfers || 0)).sort((a, b) => a.price - b.price)[0];
      alt = fewer || others.filter((it) => it.airline !== best.airline).sort((a, b) => a.price - b.price)[0] || null;
    }
    // nothing near the plan: the cheapest seen on any day, as a price reference only
    const all = cands[i]?.items || [];
    const ref = !best && all.length ? all.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    const date = best ? best.departure_at.slice(0, 10) : (target < lo ? lo : target);
    out.push({ leg: { ...leg, date }, best, alt, ref, cur: cands[i]?.cur, target });
    prev = date;
  });
  return out;
}

export async function runMulti(env, user, chat, d, h) {
  const { legs, totalNights } = planLegs(d);
  const pax = (d.adults || 1) + (d.children || 0);
  const flexible = d.flex !== 'exact';
  const window = d.flex === 'month' ? 6 : flexible ? 3 : 1;
  const per = Math.max(1, Math.floor(totalNights / d.multi.length));
  const extra = totalNights - per * d.multi.length;
  const nightsPer = d.multi.map((_, i) => per + (i < extra ? 1 : 0));
  const minNights = flexible ? Math.max(1, per - 1) : per;
  // every leg's prices at the same time (much faster than one after another)
  const cands = await Promise.all(legs.map((leg) => legCandidates(env, leg, user.currency || 'usd', window + 3)));
  // legs with no prices at all in those months: ask once for any date, as a price reference
  await Promise.all(cands.map(async (c, i) => {
    if (c.items.length) return;
    const r = await searchFares(env, { origin: legs[i].from, destination: legs[i].to, depart: null, oneWay: true, currency: user.currency || 'usd' });
    if (r.items.length) cands[i] = { items: r.items, cur: r.currency, capped: false };
  }));
  const results = chooseLegs(legs, cands, { window, nightsPer, minNights }).map((r) => ({ ...r, dist: km(r.leg.from, r.leg.to) }));
  const cur = results.find((r) => r.best)?.cur || user.currency || 'usd';
  const first = results[0].leg.date;
  const last = results[results.length - 1].leg.date;
  const routeNames = [d.origin, ...d.multi, ...(d.oneWay ? [] : [d.origin])].map(name);

  const whole = h.multiCityUrl(env, results.map((r) => r.leg), { adults: d.adults || 1, children: d.children || 0 });
  const [wholeHref, legHrefs] = await Promise.all([
    h.trackedLink(env, whole, user.id, 'live', { origin: d.origin, destination: d.multi[0], depart: first, multi: true }),
    Promise.all(results.map((r) => (r.best && r.cur === cur
      ? h.trackedLink(env, bookingUrl(env, r.best), user.id, 'flight', { sid: null, origin: r.leg.from, destination: r.leg.to, depart: r.leg.date, ret: null, adults: d.adults, children: d.children || 0 })
      : null))),
  ]);

  const lines = [
    `Here's your route, ${h.firstName} 🗺️`,
    `<b>${routeNames.map(esc).join(' → ')}</b>`,
    `📅 ${day(first)} – ${day(last)} · 👥 ${pax} ${pax === 1 ? 'person' : 'people'}`,
    '',
    '✈️ <b>Best way to book:</b> search the whole route as one multi-city trip. It compares every airline and connection for all flights together, and a single booking usually costs less and protects your connections. Tap the first button.',
    '',
    `<b>Price guide per flight</b> (seen recently, per person${flexible ? ', cheapest day near your plan' : ''}):`,
  ];
  let total = 0;
  let missing = 0;
  results.forEach((r, i) => {
    const head = `${i + 1}) ${esc(name(r.leg.from))} → ${esc(name(r.leg.to))} · ${day(r.leg.date)}`;
    const opt = (icon, it) => `     ${icon} <b>${esc(h.airline(it.airline))}</b> · ${money(it.price, cur)} · ${stopsText(r.leg.from, r.leg.to, it.duration_to || it.duration, it.transfers)}${it.departure_at.slice(0, 10) !== r.leg.date ? ` · ${day(it.departure_at)}` : ''}`;
    const road = r.dist && r.dist < 800 ? '\n     🚌 Short hop: buses or shared taxis are common and often cheaper.' : '';
    if (r.best && r.cur === cur) {
      total += r.best.price;
      lines.push(`${head}\n${opt('💰', r.best)}${r.alt ? `\n${opt(r.alt.transfers < r.best.transfers ? '🛋️' : '✈️', r.alt)}` : ''}${road}`);
    } else if (r.ref && r.cur === cur) {
      missing += 1;
      lines.push(`${head}\n     No price for these days yet. Usually from <b>${money(r.ref.price, cur)}</b> (${esc(h.airline(r.ref.airline))}, seen for ${day(r.ref.departure_at)}); the one-ticket search checks your dates live.${road}`);
    } else {
      missing += 1;
      lines.push(`${head}\n     No recent price; the one-ticket search checks it live.${road}`);
    }
  });
  lines.push('');
  if (total) lines.push(`💰 Priced flights: about <b>${money(total, cur)}</b> per person${pax > 1 ? `, ${money(total * pax, cur)} for ${pax}` : ''}${missing ? ` (+ ${missing} flight${missing > 1 ? 's' : ''} to check live)` : ''}.`);
  const vmap = await countryVisaMap(env, user.id);
  const hard = [...new Set(d.multi.map((c) => placeByCode(c)?.cc))]
    .map((cc) => ({ cc, v: visaFor(list(user.passports), list(user.visas), cc, yesCountries(vmap)) }))
    .filter((x) => needsEmbassy(x.v));
  for (const x of hard) lines.push(visaLine(x.v, x.cc));
  lines.push('<i>Prices were seen by travellers in the last 48 h; the booking site shows the live price.</i>');

  const kb = [[url(`🔎 Whole route as one ticket · live prices`, wholeHref)]];
  results.forEach((r, i) => {
    if (legHrefs[i]) kb.push([url(`${i + 1}) ${h.airline(r.best.airline)} · ${name(r.leg.from)} → ${name(r.leg.to)} · ${money(r.best.price, cur)} · Book`, legHrefs[i])]);
  });
  const shareText = `🗺️ ${routeNames.join(' → ')}, ${day(first)} – ${day(last)}${total ? `: flights from about ${money(total, cur)} per person` : ''}. Planned with Maya on CityWide Trip Planner.`;
  kb.push([btn('✏️ Change', 'd:mchg'), url('📤 Share on WhatsApp', `https://wa.me/?text=${encodeURIComponent(shareText)}`)]);
  if (h.gearButton) {
    const g = await h.gearButton(env, user, d, results[0]?.best);
    if (g) kb.push([g]);
  }
  return send(env, chat.id, lines.join('\n'), kb);
}
