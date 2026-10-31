// Admin commands (only for Telegram user IDs listed in the ADMIN_IDS secret)
// and the daily usage report sent to ADMIN_CHAT_ID.

import { countersFor, today, updateUser, addUsage } from './db.js';
import { send, esc } from './tg.js';
import { searchFares } from './tp.js';
import { analytics } from './analytics.js';
import { emailCaps, monthKey } from './email.js';
import { counter } from './db.js';

export function isAdmin(env, userId) {
  return String(env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean).includes(String(userId));
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '0%');

export async function buildReport(env, day) {
  const c = await countersFor(env, day);
  const g = (k) => c[k] || 0;
  const totals = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE banned = 1) AS banned,
      (SELECT COUNT(*) FROM watches WHERE active = 1) AS watches,
      (SELECT COUNT(*) FROM users WHERE email IS NOT NULL) AS emails,
      (SELECT COUNT(*) FROM users WHERE email_verified = 1) AS verified,
      (SELECT COUNT(*) FROM users WHERE phone IS NOT NULL) AS phones,
      (SELECT COUNT(*) FROM users WHERE marketing = 1) AS optins`).first();
  const aiMax = Number(env.AI_DAILY_MAX || 800);
  const tpMax = Number(env.TP_DAILY_MAX || 3000);
  const tpTotal = g('tp_calls') + g('tp_cache_hits');
  const caps = emailCaps(env);
  const emMonth = await counter(env, 'emails_sent', monthKey(new Date(`${day}T12:00:00Z`)));
  return [
    `<b>📊 CityWide Trip Planner · ${day} (UTC)</b>`,
    '',
    '<b>People</b>',
    `New users: ${g('new_users')} · Active: ${g('active_users')} · Total: ${totals?.users ?? 0} · Banned: ${totals?.banned ?? 0}`,
    '',
    '<b>Use</b>',
    `Searches: ${g('searches')} (no data: ${g('searches_empty')})`,
    `Book-link clicks: ${g('clicks')}`,
    `Trip watches: ${g('watches_created')} new · ${totals?.watches ?? 0} active · ${g('watch_checks')} checks · ${g('alerts_sent')} alerts sent`,
    `Booked trips: ${g('trips_booked')} new (asked ${g('booked_asked')}) · /latest views: ${g('latest_views')} · digests: ${g('digests_sent')}`,
    `Not understood: ${g('parse_misses')} (see /misses) · Visa answers: ${g('visa_answer_yes')} yes, ${g('visa_answer_no')} no`,
    '',
    '<b>Profiles (all time)</b>',
    `Emails: ${totals?.emails ?? 0} (${totals?.verified ?? 0} confirmed) · WhatsApp numbers: ${totals?.phones ?? 0} · Said yes to deals: ${totals?.optins ?? 0}`,
    `Today: ${g('emails_verified')} emails confirmed · ${g('marketing_optins')} new opt-ins`,
    `Emails sent: ${g('emails_sent')} / ${caps.day} (codes ${g('emails_code')}, plans ${g('emails_plan')})${g('email_capped') ? ` · ${g('email_capped')} held back by limits` : ''}${g('email_errors') ? ` · ${g('email_errors')} failed` : ''} · this month ${emMonth} / ${caps.month}${emMonth >= caps.month * 0.8 ? ' ⚠️ over 80%' : ''}`,
    '',
    '<b>Free-tier budget</b>',
    `AI calls: ${g('ai_calls')} / ${aiMax} (${pct(g('ai_calls'), aiMax)})${g('ai_tokens') ? ` · ${g('ai_tokens')} tokens` : ''} · reused from cache: ${g('ai_cache_hits')}${g('ai_errors') ? ` · ${g('ai_errors')} errors` : ''}`,
    `Price API calls: ${g('tp_calls')} / ${tpMax} · cache hits ${pct(g('tp_cache_hits'), tpTotal)}${g('tp_errors') ? ` · ${g('tp_errors')} errors` : ''}${g('tp_rate_limited') ? ` · ${g('tp_rate_limited')} rate-limited` : ''}`,
    '',
    '<b>Abuse control</b>',
    `Daily-quota blocks: ${g('quota_blocked')} · Burst blocks: ${g('burst_blocked')} · Reused email/phone refused: ${g('dup_email') + g('dup_phone')}`,
    '',
    '<i>Exact AI units (Neurons) and Worker requests: Cloudflare dashboard → Workers AI / Workers. Earnings: Travelpayouts dashboard.</i>',
  ].join('\n');
}

export async function dailyReport(env) {
  if (!env.ADMIN_CHAT_ID) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await send(env, env.ADMIN_CHAT_ID, await buildReport(env, yesterday));
}

// 20 real routes across your launch regions: shows where cached prices exist.
const CHECK_ROUTES = [
  ['DAC', 'BKK'], ['DAC', 'KUL'], ['DAC', 'DXB'], ['DAC', 'CCU'], ['DAC', 'SIN'], ['DAC', 'KTM'], ['CGP', 'DXB'],
  ['DEL', 'DXB'], ['BOM', 'BKK'], ['LON', 'NYC'], ['LON', 'BCN'], ['LON', 'DAC'], ['NYC', 'LON'], ['NYC', 'CUN'],
  ['LAX', 'TYO'], ['YTO', 'LON'], ['SYD', 'DPS'], ['AKL', 'SYD'], ['SIN', 'TYO'], ['HKG', 'SEL'],
];

async function routeCheck(env, chatId) {
  const d = new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const month = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  await send(env, chatId, `Checking ${CHECK_ROUTES.length} routes for ${month}…`);
  const lines = [`<b>Route check · ${month}</b> (round trips, USD)`];
  let ok = 0;
  for (const [o, de] of CHECK_ROUTES) {
    const r = await searchFares(env, { origin: o, destination: de, depart: month, ret: month, currency: 'usd' });
    if (r.capped) { lines.push('Stopped: daily API cap reached.'); break; }
    if (r.items.length) ok += 1;
    const low = r.items.length ? Math.min(...r.items.map((i) => i.price)) : null;
    lines.push(`${r.items.length ? '✅' : '❌'} ${o}-${de}: ${r.items.length} fares${low ? ` · from $${Math.round(low)}` : ''}${r.market && r.market !== 'default' ? ` · market ${r.market}` : ''}`);
  }
  lines.push('', `${ok} of ${CHECK_ROUTES.length} routes have recent prices.`);
  return send(env, chatId, lines.join('\n'));
}

// Returns true if the command was an admin command.
export async function handleAdmin(env, user, chat, cmd, args) {
  const id = Number(args[0]);
  switch (cmd) {
    case '/stats':
      await send(env, chat.id, await buildReport(env, today()));
      return true;
    case '/analytics':
      await send(env, chat.id, await analytics(env));
      return true;
    case '/report':
      await dailyReport(env);
      return true;
    case '/ban':
      if (!id) { await send(env, chat.id, 'Usage: /ban <telegram user id>'); return true; }
      await updateUser(env, id, { banned: 1 });
      await env.DB.prepare('UPDATE watches SET active = 0 WHERE user_id = ?').bind(id).run();
      await send(env, chat.id, `Banned ${id} and stopped their watches.`);
      return true;
    case '/unban':
      if (!id) { await send(env, chat.id, 'Usage: /unban <telegram user id>'); return true; }
      await updateUser(env, id, { banned: 0 });
      await send(env, chat.id, `Unbanned ${id}.`);
      return true;
    case '/grant': {
      const n = Number(args[1] || 5);
      if (!id) { await send(env, chat.id, 'Usage: /grant <telegram user id> <extra searches today>'); return true; }
      await addUsage(env, `u${id}`, 'bonus', n);
      await send(env, chat.id, `Gave ${id} ${n} extra searches for today.`);
      return true;
    }
    case '/routecheck':
      await routeCheck(env, chat.id);
      return true;
    case '/misses': {
      const { results } = await env.DB.prepare('SELECT text, COUNT(*) AS c, MAX(at) AS last FROM misses GROUP BY text ORDER BY last DESC LIMIT 15').all();
      if (!results?.length) await send(env, chat.id, 'Nothing misunderstood recently. 🎉');
      else await send(env, chat.id, `<b>Messages Maya didn't understand</b> (last 30 days)\n${results.map((r) => `• ${esc(r.text)}${r.c > 1 ? ` (×${r.c})` : ''}`).join('\n')}\n\nSend me (Claude) these and I'll teach Maya.`);
      return true;
    }
    case '/post': {
      // /post TAGS | text   e.g.  /post TH,BD | Thailand e-visa now takes 3 working days.
      const raw = args.join(' ');
      const [tagPart, ...rest] = raw.split('|');
      const text = rest.join('|').trim();
      const tags = tagPart.split(',').map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z]{2,3}$/.test(t));
      if (!text || !tags.length) {
        await send(env, chat.id, 'Usage: <code>/post TAGS | text</code>\nTAGS = country codes (TH, BD), city codes (BKK) or ALL. Shows in /latest for 30 days.\nExample: <code>/post TH,BD | Thailand e-visa now takes about 3 working days.</code>');
        return true;
      }
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare('INSERT INTO news (tags, text, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(tags.join(','), text.slice(0, 400), now, now + 30 * 86400).run();
      await send(env, chat.id, `Posted for ${tags.join(', ')}. Travellers will see it in /latest. (/news to list, /unpost &lt;id&gt; to remove)`);
      return true;
    }
    case '/news': {
      const { results } = await env.DB.prepare('SELECT * FROM news WHERE expires_at > ? ORDER BY created_at DESC LIMIT 15').bind(Math.floor(Date.now() / 1000)).all();
      await send(env, chat.id, results?.length ? results.map((n) => `#${n.id} [${esc(n.tags)}] ${esc(n.text)}`).join('\n') : 'No news posted.');
      return true;
    }
    case '/unpost':
      if (!id) { await send(env, chat.id, 'Usage: /unpost <id>'); return true; }
      await env.DB.prepare('DELETE FROM news WHERE id = ?').bind(id).run();
      await send(env, chat.id, `Removed news #${id}.`);
      return true;
    case '/whoami':
      await send(env, chat.id, `Your Telegram user ID: <code>${esc(user.id)}</code>\nThis chat ID: <code>${esc(chat.id)}</code>`);
      return true;
    default:
      return false;
  }
}
