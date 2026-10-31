// Built-in analytics for the owner: /analytics in Telegram (admins only).
// Everything comes from the bot's own database, so it is free, private and exact
// for what the bot can know. Telegram never shares a person's location, so "where"
// means the home city people chose during setup.

import { countersFor } from './db.js';
import { countryName, flag } from './countries.js';
import { placeByCode } from './places.js';
import { PERSONAS } from './rank.js';
import { emailCaps, monthKey } from './email.js';
import { counter } from './db.js';

const DAY = 86400;
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const LANG = new Intl.DisplayNames(['en'], { type: 'language' });
const langName = (c) => { try { return LANG.of(c) || c; } catch { return c; } };

export async function analytics(env, now = Math.floor(Date.now() / 1000)) {
  const one = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const many = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
  const today = new Date(now * 1000).toISOString().slice(0, 10);

  const u = await one(`SELECT
      COUNT(*) AS total,
      SUM(setup_step = 'done') AS onboarded,
      SUM(created_at >= ?) AS new7, SUM(created_at >= ?) AS new30,
      SUM(last_day = ?) AS dau, SUM(last_seen >= ?) AS wau, SUM(last_seen >= ?) AS mau,
      SUM(created_at <= ?) AS old7, SUM(created_at <= ? AND last_seen >= created_at + ?) AS back7,
      SUM(created_at <= ?) AS old30, SUM(created_at <= ? AND last_seen >= created_at + ?) AS back30,
      AVG(active_days) AS avgDays,
      AVG((last_seen - created_at) / 86400.0) AS avgSpan
    FROM users WHERE banned = 0`,
  now - 7 * DAY, now - 30 * DAY, today, now - 7 * DAY, now - 30 * DAY,
  now - 7 * DAY, now - 7 * DAY, 7 * DAY, now - 30 * DAY, now - 30 * DAY, 30 * DAY) || {};

  const countries = await many(`SELECT country AS k, COUNT(*) AS n, SUM(last_seen >= ?) AS active FROM users
    WHERE banned = 0 AND country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 10`, now - 30 * DAY);
  const langs = await many(`SELECT tg_lang AS k, COUNT(*) AS n FROM users WHERE banned = 0 AND tg_lang IS NOT NULL
    GROUP BY tg_lang ORDER BY n DESC LIMIT 6`);
  const personas = await many(`SELECT persona AS k, COUNT(*) AS n FROM users WHERE banned = 0 AND persona IS NOT NULL
    GROUP BY persona ORDER BY n DESC`);
  const dests = await many(`SELECT dest AS k, SUM(n) AS n FROM interests WHERE last_at >= ? GROUP BY dest ORDER BY n DESC LIMIT 8`, now - 30 * DAY);
  const loyal = await many(`SELECT active_days AS d, COUNT(*) AS n FROM users WHERE banned = 0 GROUP BY
    CASE WHEN active_days >= 10 THEN 10 WHEN active_days >= 4 THEN 4 WHEN active_days >= 2 THEN 2 ELSE 1 END`);

  // funnel over the last 30 days: joined → finished setup → searched → tapped a booking link → said they booked
  const f = await one(`SELECT
      (SELECT COUNT(*) FROM users WHERE created_at >= ?) AS joined,
      (SELECT COUNT(*) FROM users WHERE created_at >= ? AND setup_step = 'done') AS setup,
      (SELECT COUNT(DISTINCT user_id) FROM searches WHERE created_at >= ?) AS searched,
      (SELECT COUNT(DISTINCT user_id) FROM links WHERE first_click >= ?) AS clicked,
      (SELECT COUNT(DISTINCT user_id) FROM trips WHERE created_at >= ?) AS booked`,
  now - 30 * DAY, now - 30 * DAY, now - 30 * DAY, now - 30 * DAY, now - 30 * DAY) || {};

  // last 7 days, one line each
  const trend = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date((now - i * DAY) * 1000).toISOString().slice(0, 10);
    const c = await countersFor(env, day);
    trend.push(`${day.slice(5)}  new ${c.new_users || 0} · active ${c.active_users || 0} · searches ${c.searches || 0} · clicks ${c.clicks || 0}`);
  }

  const caps = emailCaps(env);
  const emMonth = await counter(env, 'emails_sent', monthKey(new Date(now * 1000)));
  const bucket = Object.fromEntries(loyal.map((r) => [r.d >= 10 ? 10 : r.d >= 4 ? 4 : r.d >= 2 ? 2 : 1, r.n]));
  const r = (x) => Math.round((x || 0) * 10) / 10;

  return [
    '<b>📈 Analytics</b>',
    '',
    '<b>People</b>',
    `Total ${u.total || 0} · finished setup ${u.onboarded || 0} (${pct(u.onboarded, u.total)})`,
    `New: ${u.new7 || 0} this week · ${u.new30 || 0} in 30 days`,
    `Active: ${u.dau || 0} today · ${u.wau || 0} this week · ${u.mau || 0} in 30 days`,
    `Stickiness (daily ÷ monthly active): ${pct(u.dau, u.mau)}`,
    '',
    '<b>Coming back</b>',
    `Still using after 1 week: ${u.back7 || 0} of ${u.old7 || 0} (${pct(u.back7, u.old7)})`,
    `Still using after 1 month: ${u.back30 || 0} of ${u.old30 || 0} (${pct(u.back30, u.old30)})`,
    `Average: ${r(u.avgDays)} day${r(u.avgDays) === 1 ? '' : 's'} of use, over ${r(u.avgSpan)} days from first to last visit`,
    `Days used: 1 day ${bucket[1] || 0} · 2–3 ${bucket[2] || 0} · 4–9 ${bucket[4] || 0} · 10+ ${bucket[10] || 0}`,
    '',
    '<b>Where they live</b> (home city chosen in setup; 30-day active in brackets)',
    ...(countries.length ? countries.map((c) => `${flag(c.k)} ${countryName(c.k)}: ${c.n} (${c.active || 0})`) : ['No data yet']),
    '',
    '<b>Telegram language</b>',
    langs.length ? langs.map((l) => `${langName(l.k)} ${l.n}`).join(' · ') : 'No data yet',
    '',
    '<b>Who travels</b>',
    personas.length ? personas.map((p) => `${(PERSONAS[p.k] || {}).label || p.k} ${p.n}`).join(' · ') : 'No data yet',
    '',
    '<b>Top destinations searched (30 days)</b>',
    dests.length ? dests.map((d) => `${placeByCode(d.k)?.name || d.k} ${d.n}`).join(' · ') : 'No data yet',
    '',
    '<b>Path to booking (last 30 days)</b>',
    `Joined ${f.joined || 0} → finished setup ${f.setup || 0} → searched ${f.searched || 0} → tapped Book ${f.clicked || 0} → said they booked ${f.booked || 0}`,
    `Search → Book tap: ${pct(f.clicked, f.searched)} · Book tap → booked: ${pct(f.booked, f.clicked)}`,
    '',
    '<b>Last 7 days</b>',
    `<code>${trend.join('\n')}</code>`,
    '',
    `<b>Email this month</b>: ${emMonth} of ${caps.month} (${pct(emMonth, caps.month)})`,
    '',
    '<i>Sales and commission: Travelpayouts dashboard → Statistics (sub ID "tg"). Requests and errors: Cloudflare → Workers → your Worker → Metrics.</i>',
  ].join('\n');
}
