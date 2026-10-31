// Traveller profiles: how each person uses Maya, for insights, offers and better picks later.
// One small row per person (owners/admins are never recorded). Updated with one read and one
// write per search, so it costs almost nothing on the free plan. Deleted by /delete.

import { nowSec } from './db.js';
import { isAdmin } from './admin.js';
import { placeByCode } from './places.js';
import { countryName } from './countries.js';
import { PERSONAS } from './rank.js';

// Table: profiles (created in db.js).

const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const inc = (obj, k, n = 1) => { if (k) obj[k] = (obj[k] || 0) + n; return obj; };
const top = (obj, n = 3) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n);

// After every search (single or multi-country).
export async function recordSearch(env, user, d) {
  if (!user || isAdmin(env, user.id)) return;
  const t = nowSec();
  const row = await env.DB.prepare('SELECT months, places, hours FROM profiles WHERE user_id = ?').bind(user.id).first();
  const months = parse(row?.months, {});
  const places = parse(row?.places, {});
  const hours = parse(row?.hours, Array(24).fill(0));
  const dep = d.depart?.value || '';
  inc(months, dep.slice(5, 7));
  for (const c of d.multi || [d.destination]) inc(places, placeByCode(c)?.cc || c);
  hours[new Date(t * 1000).getUTCHours()] += 1;
  const nights = d.nights || (d.ret && d.depart?.type === 'date' ? Math.round((Date.parse(d.ret.value) - Date.parse(dep)) / 86400000) : null)
    || ({ short: 3, week: 6, long: 11 }[d.stay] ?? null);
  const lead = dep ? Math.max(0, Math.round((Date.parse(dep.length === 7 ? `${dep}-15` : dep) - t * 1000) / 86400000)) : null;
  await env.DB.prepare(`INSERT INTO profiles (user_id, searches, multi, one_way, flexible, direct, pax_sum, kids, budget,
      nights_sum, nights_n, lead_sum, lead_n, months, places, hours, first_at, last_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET searches = searches + 1, multi = multi + excluded.multi, one_way = one_way + excluded.one_way,
      flexible = flexible + excluded.flexible, direct = direct + excluded.direct, pax_sum = pax_sum + excluded.pax_sum, kids = kids + excluded.kids,
      budget = budget + excluded.budget, nights_sum = nights_sum + excluded.nights_sum, nights_n = nights_n + excluded.nights_n,
      lead_sum = lead_sum + excluded.lead_sum, lead_n = lead_n + excluded.lead_n,
      months = excluded.months, places = excluded.places, hours = excluded.hours, last_at = excluded.last_at`)
    .bind(user.id, d.multi ? 1 : 0, d.oneWay ? 1 : 0, d.flex && d.flex !== 'exact' ? 1 : 0, d.direct ? 1 : 0,
      (d.adults || 1) + (d.children || 0), d.children ? 1 : 0, d.budget ? 1 : 0,
      nights || 0, nights ? 1 : 0, lead ?? 0, lead === null ? 0 : 1,
      JSON.stringify(months), JSON.stringify(places), JSON.stringify(hours), t, t).run();
}

const PICK_COL = { 'Best overall': 'pick_best', Cheapest: 'pick_cheap', Fastest: 'pick_fast', 'Most comfortable': 'pick_comfy' };
// A tap on a booking link (which option they chose tells us what they value).
export async function recordClick(env, userId, label) {
  if (!userId || isAdmin(env, userId)) return;
  const col = PICK_COL[label];
  await env.DB.prepare(`INSERT INTO profiles (user_id, clicks${col ? `, ${col}` : ''}, first_at, last_at) VALUES (?, 1${col ? ', 1' : ''}, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET clicks = clicks + 1${col ? `, ${col} = ${col} + 1` : ''}, last_at = excluded.last_at`)
    .bind(userId, nowSec(), nowSec()).run();
}

// watches / emails / booked
export async function recordEvent(env, userId, what) {
  if (!userId || isAdmin(env, userId) || !['watches', 'emails', 'booked'].includes(what)) return;
  await env.DB.prepare(`INSERT INTO profiles (user_id, ${what}, first_at, last_at) VALUES (?, 1, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET ${what} = ${what} + 1, last_at = excluded.last_at`).bind(userId, nowSec(), nowSec()).run();
}

// A one-line description of what this traveller values (for offers and marketing).
export function segment(p) {
  if (!p || !p.searches) return 'new, no searches yet';
  const tags = [];
  const picks = p.pick_best + p.pick_cheap + p.pick_fast + p.pick_comfy;
  if (picks >= 2) {
    const fav = [['price-focused', p.pick_cheap], ['time-focused', p.pick_fast], ['comfort-focused', p.pick_comfy], ['balanced', p.pick_best]].sort((a, b) => b[1] - a[1])[0];
    if (fav[1] / picks >= 0.5) tags.push(fav[0]);
  }
  if (p.kids / p.searches >= 0.5) tags.push('travels with kids');
  else if (p.pax_sum / p.searches >= 3) tags.push('group traveller');
  else if (p.pax_sum / p.searches <= 1.2) tags.push('solo traveller');
  if (p.multi / p.searches >= 0.4) tags.push('multi-country explorer');
  if (p.flexible / p.searches >= 0.6) tags.push('flexible dates');
  if (p.lead_n && p.lead_sum / p.lead_n <= 21) tags.push('books last-minute');
  else if (p.lead_n && p.lead_sum / p.lead_n >= 90) tags.push('plans far ahead');
  if (p.booked) tags.push('has booked');
  else if (p.clicks >= 3) tags.push('ready to buy (many Book taps)');
  return tags.join(', ') || 'still exploring';
}

// /user <id> for the owner
export async function userReport(env, id) {
  const [u, p] = await Promise.all([
    env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first(),
    env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(id).first(),
  ]);
  if (!u) return 'No such user.';
  const esc = (s) => String(s ?? '').replace(/[<>&]/g, '');
  const day = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : '–');
  const lines = [
    `<b>👤 ${esc(u.name || u.first_name)}</b> (id ${u.id}${u.username ? `, @${esc(u.username)}` : ''})`,
    `Home ${esc(placeByCode(u.home)?.name || u.home || '–')} · passports ${esc(u.passports || '–')} · ${esc(PERSONAS[u.persona]?.label || u.persona || '–')} · ${esc(u.tg_lang || '')}`,
    `Joined ${day(u.created_at)} · last seen ${day(u.last_seen)} · ${u.active_days || 0} active day${u.active_days === 1 ? '' : 's'} · deals by email: ${u.marketing ? 'yes' : 'no'}`,
  ];
  if (!p) return [...lines, 'No searches yet.'].join('\n');
  const avg = (s, n) => (n ? Math.round((s / n) * 10) / 10 : '–');
  const months = top(parse(p.months, {}), 3).map(([m, n]) => `${new Date(`2026-${m}-15`).toLocaleString('en-GB', { month: 'short' })} ${n}`).join(', ');
  const places = top(parse(p.places, {}), 5).map(([c, n]) => `${countryName(c) || c} ${n}`).join(', ');
  const hours = parse(p.hours, []);
  const peak = hours.length ? hours.indexOf(Math.max(...hours)) : null;
  lines.push(
    '',
    `<b>Segment:</b> ${segment(p)}`,
    `Searches ${p.searches} (multi-country ${p.multi}, one-way ${p.one_way}, flexible ${p.flexible}, direct-only ${p.direct}, with budget ${p.budget})`,
    `Avg group ${avg(p.pax_sum, p.searches)} · avg trip ${avg(p.nights_sum, p.nights_n)} nights · books ${avg(p.lead_sum, p.lead_n)} days ahead`,
    `Book taps ${p.clicks}: best ${p.pick_best}, cheapest ${p.pick_cheap}, fastest ${p.pick_fast}, comfort ${p.pick_comfy}`,
    `Watches ${p.watches} · emails ${p.emails} · said they booked ${p.booked}`,
    `Wants to go: ${places || '–'} · travel months: ${months || '–'}${peak !== null ? ` · most active ~${String(peak).padStart(2, '0')}:00 UTC` : ''}`,
  );
  return lines.join('\n');
}

// Whole-audience insights for /analytics
export async function audienceInsights(env) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS people, SUM(searches) AS s, SUM(multi) AS multi, SUM(one_way) AS ow, SUM(flexible) AS flex,
      SUM(kids) AS kids, SUM(pax_sum) AS pax, SUM(nights_sum) AS ns, SUM(nights_n) AS nn, SUM(lead_sum) AS ls, SUM(lead_n) AS ln,
      SUM(pick_best) AS pb, SUM(pick_cheap) AS pc, SUM(pick_fast) AS pf, SUM(pick_comfy) AS pm, SUM(clicks) AS clicks, SUM(booked) AS booked
    FROM profiles`).first();
  if (!r || !r.s) return ['No traveller profiles yet.'];
  const pct = (a) => `${Math.round(((a || 0) / r.s) * 100)}%`;
  const picks = (r.pb || 0) + (r.pc || 0) + (r.pf || 0) + (r.pm || 0);
  const share = (a) => (picks ? `${Math.round(((a || 0) / picks) * 100)}%` : '–');
  const { results } = await env.DB.prepare('SELECT months FROM profiles WHERE months IS NOT NULL ORDER BY last_at DESC LIMIT 500').all();
  const months = {};
  for (const row of results || []) for (const [m, n] of Object.entries(parse(row.months, {}))) inc(months, m, n);
  const topMonths = top(months, 3).map(([m]) => new Date(`2026-${m}-15`).toLocaleString('en-GB', { month: 'short' })).join(', ');
  return [
    `${r.people} travellers · ${r.s} searches · avg group ${Math.round((r.pax / r.s) * 10) / 10} · with kids ${pct(r.kids)} · multi-country ${pct(r.multi)} · one-way ${pct(r.ow)} · flexible dates ${pct(r.flex)}`,
    `Avg trip ${r.nn ? Math.round((r.ns / r.nn) * 10) / 10 : '–'} nights · searching ${r.ln ? Math.round(r.ls / r.ln) : '–'} days before travel · popular travel months: ${topMonths || '–'}`,
    `Which option they book: best ${share(r.pb)} · cheapest ${share(r.pc)} · fastest ${share(r.pf)} · comfort ${share(r.pm)} (${picks} taps)`,
  ];
}
