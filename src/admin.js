// Admin commands (only for Telegram user IDs listed in the ADMIN_IDS secret)
// and the daily usage report sent to ADMIN_CHAT_ID.

import { countersFor, today, updateUser, addUsage } from './db.js';
import { send, esc } from './tg.js';
import { searchFares } from './tp.js';

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
    '',
    '<b>Profiles (all time)</b>',
    `Emails: ${totals?.emails ?? 0} (${totals?.verified ?? 0} confirmed) · WhatsApp numbers: ${totals?.phones ?? 0} · Said yes to deals: ${totals?.optins ?? 0}`,
    `Today: ${g('emails_verified')} emails confirmed · ${g('marketing_optins')} new opt-ins · ${g('emails_sent')} emails sent${g('email_errors') ? ` (${g('email_errors')} failed)` : ''}`,
    '',
    '<b>Free-tier budget</b>',
    `AI calls: ${g('ai_calls')} / ${aiMax} (${pct(g('ai_calls'), aiMax)})${g('ai_tokens') ? ` · ${g('ai_tokens')} tokens` : ''}${g('ai_errors') ? ` · ${g('ai_errors')} errors` : ''}`,
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
    case '/whoami':
      await send(env, chat.id, `Your Telegram user ID: <code>${esc(user.id)}</code>\nThis chat ID: <code>${esc(chat.id)}</code>`);
      return true;
    default:
      return false;
  }
}
