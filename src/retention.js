// Keeping travellers coming back (all free on Telegram):
// 1) Interests: every search teaches us where each person wants to go.
// 2) "Did you book?" a day after someone taps Book → a saved trip.
// 3) Pre-trip reminders 14, 3 and 1 day before departure, each with useful next steps.
// 4) /latest: up to 5 updates that matter to this person (prices, visas, weather, news, ideas).
// 5) Weekly digest for people who said yes to deals.

import { nowSec, bump, getUsage, addUsage, canFetch } from './db.js';
import { send, btn, url, esc } from './tg.js';
import { placeByCode } from './places.js';
import { countryName } from './countries.js';
import { visaFor, visaLine, countryVisaMap, yesCountries } from './visa.js';
import { climate, describe, weatherLine } from './weather.js';
import { toolkit, storeFor, gearPicks, gearUrl } from './toolkit.js';
import { money } from './format.js';
import { newsLine } from './news.js';

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const name = (code) => placeByCode(code)?.name || code;
const day = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const daysUntil = (iso) => Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86400000);

// ---------- 1) interests ----------
export async function noteInterest(env, userId, draft) {
  if (!userId || !draft?.destination) return;
  await env.DB.prepare(`INSERT INTO interests (user_id, dest, origin, month, n, last_at) VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT (user_id, dest) DO UPDATE SET origin = excluded.origin, month = excluded.month, n = n + 1, last_at = excluded.last_at`)
    .bind(userId, draft.destination, draft.origin, draft.depart?.value?.slice(0, 7) || null, nowSec()).run();
}

async function topInterests(env, userId, n = 3) {
  const { results } = await env.DB.prepare(`SELECT * FROM interests WHERE user_id = ? AND last_at > ?
    ORDER BY (n * 1.0 / (1 + (? - last_at) / 604800.0)) DESC LIMIT ?`).bind(userId, nowSec() - 120 * 86400, nowSec(), n).all();
  return results || [];
}

// ---------- 2) "Did you book?" ----------
// Called by the daily cron. Asks once per search, 1–4 days after the first Book tap.
export async function askBooked(env) {
  const t = nowSec();
  const { results } = await env.DB.prepare(`SELECT l.id, l.user_id, l.meta, u.chat_id, u.name FROM links l JOIN users u ON u.id = l.user_id
    WHERE l.kind IN ('flight', 'alert', 'email') AND l.first_click IS NOT NULL AND l.asked = 0
      AND l.first_click < ? AND l.first_click > ? AND u.banned = 0 AND u.chat_id IS NOT NULL
    ORDER BY l.first_click DESC LIMIT 40`).bind(t - 86400, t - 4 * 86400).all();
  const done = new Set();
  let sent = 0;
  for (const r of results || []) {
    const meta = r.meta ? JSON.parse(r.meta) : null;
    const k = `${r.user_id}|${meta?.sid || r.id}`;
    await env.DB.prepare('UPDATE links SET asked = 1 WHERE id = ?').bind(r.id).run();
    if (!meta?.destination || !meta?.depart || done.has(k) || daysUntil(meta.depart) < 0) continue;
    if (!canFetch(env, 1, 2)) break;
    done.add(k);
    // mark every link from the same search as asked
    if (meta.sid) await env.DB.prepare("UPDATE links SET asked = 1 WHERE user_id = ? AND meta LIKE ?").bind(r.user_id, `%"sid":"${meta.sid}"%`).run();
    await send(env, r.chat_id, `Hi ${esc(r.name || 'there')}! 👋 Did you book your ${esc(name(meta.origin))} → ${esc(name(meta.destination))} trip (${day(meta.depart)})?`, [
      [btn('✅ Yes, booked!', `bk:y:${r.id}`)],
      [btn('Not yet', `bk:n:${r.id}`), btn('Plans changed', `bk:x:${r.id}`)],
    ]);
    sent += 1;
  }
  if (sent) await bump(env, 'booked_asked', sent);
}

export async function onBookedAnswer(env, user, chat, answer, linkId) {
  const row = await env.DB.prepare('SELECT meta FROM links WHERE id = ? AND user_id = ?').bind(linkId, user.id).first();
  const meta = row?.meta ? JSON.parse(row.meta) : null;
  if (!meta) return send(env, chat.id, 'Thanks!');
  if (answer === 'y') {
    const exists = await env.DB.prepare('SELECT id FROM trips WHERE user_id = ? AND destination = ? AND depart = ? AND active = 1')
      .bind(user.id, meta.destination, meta.depart).first();
    if (!exists) {
      await env.DB.prepare(`INSERT INTO trips (user_id, chat_id, origin, destination, depart, ret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(user.id, chat.id, meta.origin, meta.destination, meta.depart, meta.ret || null, nowSec()).run();
      await bump(env, 'trips_booked');
    }
    const kb = (await toolkit(env, { dest: placeByCode(meta.destination), checkin: meta.depart, checkout: meta.ret, adults: meta.adults || 1, children: meta.children || 0, international: placeByCode(meta.destination)?.cc !== placeByCode(meta.origin)?.cc }, 3))
      .map((x) => [url(x.text, x.href)]);
    return send(env, chat.id, `Wonderful, ${esc(user.name || 'there')}! 🎉 I've saved your trip to ${esc(name(meta.destination))} on ${day(meta.depart)}.\nI'll check in 2 weeks, 3 days and 1 day before with what to sort out. See it anytime with /trips.${kb.length ? '\n\nTo get ready:' : ''}`, kb.length ? kb : null);
  }
  if (answer === 'n') {
    return send(env, chat.id, 'No problem! Want me to watch the price and tell you if it drops? Search the trip again and tap 🔔 Track this trip.');
  }
  return send(env, chat.id, 'Got it. Whenever you’re ready for the next one, just tell me where. ✈️');
}

export async function listTrips(env, user, chatId) {
  const { results } = await env.DB.prepare('SELECT * FROM trips WHERE user_id = ? AND active = 1 ORDER BY depart').bind(user.id).all();
  if (!results?.length) return send(env, chatId, 'No upcoming trips saved yet. When you book through me, I’ll ask and help you get ready.');
  const lines = ['<b>Your upcoming trips</b>'];
  const kb = [];
  for (const t of results) {
    const d = daysUntil(t.depart);
    lines.push(`• ${esc(name(t.origin))} → ${esc(name(t.destination))}, ${day(t.depart)}${t.ret ? ` – ${day(t.ret)}` : ''} (${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`})`);
    kb.push([btn(`Remove ${name(t.destination)} ${t.depart.slice(5)}`, `trip:del:${t.id}`)]);
  }
  return send(env, chatId, lines.join('\n'), kb);
}

export async function removeTrip(env, user, chatId, id) {
  await env.DB.prepare('UPDATE trips SET active = 0 WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return send(env, chatId, 'Removed that trip.');
}

// ---------- 3) pre-trip reminders (daily cron) ----------
export async function tripReminders(env) {
  const today = new Date().toISOString().slice(0, 10);
  const in15 = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(`SELECT t.*, u.name, u.passports, u.visas, u.country, u.banned FROM trips t JOIN users u ON u.id = t.user_id
    WHERE t.active = 1 AND t.depart >= ? AND t.depart <= ? LIMIT 30`).bind(today, in15).all();
  for (const t of results || []) {
    if (t.banned) continue;
    if (!canFetch(env, 3, 2)) break;
    const d = daysUntil(t.depart);
    const dest = placeByCode(t.destination);
    const hi = `${esc(t.name || 'there')}`;
    if (d <= 1 && !t.r1) {
      await env.DB.prepare('UPDATE trips SET r1 = 1, r3 = 1, r14 = 1 WHERE id = ?').bind(t.id).run();
      await send(env, t.chat_id, `✈️ ${d === 0 ? 'Today' : 'Tomorrow'}'s the day, ${hi}! ${esc(name(t.origin))} → ${esc(dest?.name || t.destination)}.\n\n✅ Online check-in (usually opens 24–48 h before)\n✅ Passport valid 6+ months, visa printed if needed\n✅ Power bank in your cabin bag, not checked in\n✅ Leave early for the airport\n\nHave a wonderful trip! 🌍`);
      continue;
    }
    if (d <= 3 && !t.r3) {
      await env.DB.prepare('UPDATE trips SET r3 = 1, r14 = 1 WHERE id = ?').bind(t.id).run();
      const w = await weatherLine(env, t.origin, t.destination, t.depart.slice(0, 7));
      const kb = (await toolkit(env, { dest, checkin: t.depart, checkout: t.ret, international: dest?.cc !== t.country, lateArrival: true }, 2)).map((x) => [url(x.text, x.href)]);
      const base = env.PUBLIC_URL || '';
      if (storeFor(env, t.country) && base) {
        const picks = gearPicks({ homeCc: t.country, destCc: dest?.cc, weather: w?.d, tags: dest?.tags || [] });
        kb.push([url(`🎒 Packing check: ${picks.map((p) => p.name).join(' · ') || 'travel essentials'}`.slice(0, 120), gearUrl(base.replace(/\/$/, ''), { homeCc: t.country, destCc: dest?.cc, destName: dest?.name, keys: picks.map((p) => p.key) }))]);
      }
      await send(env, t.chat_id, `3 days to ${esc(dest?.name || t.destination)}, ${hi}! 🧳${w ? `\n${esc(w.line)}` : ''}\n\nWorth sorting now: how you'll get from the airport, mobile data on arrival, and a quick packing check.`, kb.length ? kb : null);
      continue;
    }
    if (d <= 14 && !t.r14) {
      await env.DB.prepare('UPDATE trips SET r14 = 1 WHERE id = ?').bind(t.id).run();
      const v = visaFor(list(t.passports), list(t.visas), dest?.cc, yesCountries(await countryVisaMap(env, t.user_id)));
      const visaNote = v && v.code !== 'H' && v.code !== 'F' ? `\n${visaLine(v, dest.cc)}` : '';
      const kb = (await toolkit(env, { dest, checkin: t.depart, checkout: t.ret, international: dest?.cc !== t.country }, 3)).map((x) => [url(x.text, x.href)]);
      await send(env, t.chat_id, `2 weeks to go until ${esc(dest?.name || t.destination)}, ${hi}! 🎉 Here's what to sort out:\n• Where you'll stay\n• Travel insurance and mobile data${visaNote}`, kb.length ? kb : null);
    }
  }
}

// ---------- 4) /latest ----------
export async function latest(env, user, chatId, { digest = false } = {}) {
  if (!digest) {
    const u = await getUsage(env, `u${user.id}`);
    if ((u.latest || 0) >= 3) return send(env, chatId, 'That’s today’s updates. Check back tomorrow! ✈️');
    await addUsage(env, `u${user.id}`, 'latest');
  }
  const items = [];
  const kb = [];
  const interests = await topInterests(env, user.id, 3);
  const passports = list(user.passports);
  const cvisas = yesCountries(await countryVisaMap(env, user.id));

  // a) price check on routes you searched (from prices we've already seen; no extra API cost)
  for (const it of interests.slice(0, 2)) {
    if (!it.month) continue;
    const row = await env.DB.prepare(`SELECT
        (SELECT price FROM prices WHERE route = ? AND month = ? ORDER BY seen_at DESC LIMIT 1) AS last,
        (SELECT currency FROM prices WHERE route = ? AND month = ? ORDER BY seen_at DESC LIMIT 1) AS cur,
        (SELECT MIN(price) FROM prices WHERE route = ? AND month = ? AND seen_at > ?) AS low`)
      .bind(`${it.origin}-${it.dest}`, it.month, `${it.origin}-${it.dest}`, it.month, `${it.origin}-${it.dest}`, it.month, nowSec() - 30 * 86400).first();
    if (row?.last) {
      const trend = row.low && row.last <= row.low ? ' 📉 the lowest I’ve seen' : row.low ? ` (lowest seen: ${money(row.low, row.cur)})` : '';
      items.push(`💸 <b>${esc(name(it.origin))} → ${esc(name(it.dest))}</b> in ${monthName(it.month)}: from ${money(row.last, row.cur)} per person${trend}.`);
    }
  }
  // b) news you posted (/post) that matches this traveller
  const tags = new Set(['ALL', user.country, ...passports, ...interests.map((i) => placeByCode(i.dest)?.cc), ...interests.map((i) => i.dest)].filter(Boolean));
  let usedFcdo = false;
  const { results: news } = await env.DB.prepare('SELECT * FROM news WHERE expires_at > ? ORDER BY created_at DESC LIMIT 30').bind(nowSec()).all();
  for (const n of news || []) {
    if (items.length >= 4) break;
    if (!list(n.tags).some((t) => tags.has(t.toUpperCase()))) continue;
    const cc = list(n.tags).find((t) => /^[A-Z]{2}$/.test(t) && t !== 'ALL');
    items.push(newsLine(n, n.source && cc ? countryName(cc) : null, esc));
    if (n.source?.includes('FCDO')) usedFcdo = true;
  }
  // c) visa note for your top destination
  const top = interests[0];
  if (top && items.length < 5) {
    const cc = placeByCode(top.dest)?.cc;
    const v = visaFor(passports, list(user.visas), cc, cvisas);
    if (v && v.code !== 'H') items.push(visaLine(v, cc));
  }
  // d) weather for your top destination in your travel month
  if (top?.month && items.length < 5) {
    const w = describe(await climate(env, top.dest), Number(top.month.slice(5, 7)) - 1);
    if (w) items.push(`🌤 ${esc(name(top.dest))} in ${monthName(top.month)}: ${esc(w.feel)}, around ${w.avg}°C.`);
  }
  // e) where people from your city are looking this week
  if (items.length < 5 && user.home) {
    const { results: pop } = await env.DB.prepare(`SELECT dest, COUNT(*) AS c FROM interests WHERE origin = ? AND last_at > ? AND user_id != ?
      GROUP BY dest ORDER BY c DESC LIMIT 3`).bind(user.home, nowSec() - 7 * 86400, user.id).all();
    if (pop?.length) items.push(`🔥 Popular from ${esc(name(user.home))} this week: ${pop.map((p) => esc(name(p.dest))).join(', ')}.`);
  }
  if (top) {
    const tk = await toolkit(env, { dest: placeByCode(top.dest), international: placeByCode(top.dest)?.cc !== user.country }, 1);
    for (const x of tk) kb.push([url(x.text, x.href)]);
  }
  if (!items.length) {
    if (digest) return null;
    return send(env, chatId, `Nothing new yet, ${esc(user.name || 'there')}. Search a trip or two and I'll keep an eye on what matters to you. ✈️`);
  }
  const head = digest ? `☀️ Your weekly travel update, ${esc(user.name || 'there')}` : `<b>Latest for you, ${esc(user.name || 'there')}</b>`;
  await bump(env, digest ? 'digests_sent' : 'latest_views');
  const credit = usedFcdo ? '\n\n<i>Travel advice: UK FCDO, Open Government Licence v3.0.</i>' : '';
  return send(env, chatId, `${head}\n\n${items.slice(0, 5).join('\n\n')}${credit}`, kb.length ? kb : null);
}

const monthName = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

// ---------- 5) weekly digest (Mondays, opted-in, active in the last 60 days) ----------
export async function weeklyDigest(env) {
  if (String(env.WEEKLY_DIGEST ?? 'true') === 'false') return;
  if (new Date().getUTCDay() !== 1) return;
  const { results } = await env.DB.prepare(`SELECT * FROM users WHERE marketing = 1 AND banned = 0 AND chat_id IS NOT NULL
    AND last_seen > ? AND COALESCE(digest_at, 0) < ? LIMIT 25`).bind(nowSec() - 60 * 86400, nowSec() - 6 * 86400).all();
  for (const u of results || []) {
    if (!canFetch(env, 2, 2)) break;
    await env.DB.prepare('UPDATE users SET digest_at = ? WHERE id = ?').bind(nowSec(), u.id).run();
    await latest(env, u, u.chat_id, { digest: true });
  }
}

export { countryName };
