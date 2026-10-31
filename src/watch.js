// Trip watches: track a whole trip (route + month/dates + group) and alert
// only when the price drops meaningfully or falls under the user's budget.

import { getUsage, addUsage, bump, nowSec, recordPrice, getUser } from './db.js';
import { send, btn, url, esc } from './tg.js';
import { placeByCode } from './places.js';
import { PERSONAS } from './rank.js';
import { bookingUrl } from './tp.js';
import { fetchRanked, money, trackedLink } from './bot.js';

const DROP = 0.05; // alert when at least 5% cheaper than the last alert
const RECHECK_SEC = 6 * 3600; // each watch is checked about every 6 hours

function expiryFor(draft) {
  const v = (draft.ret || draft.depart).value;
  const end = v.length === 7
    ? Date.UTC(+v.slice(0, 4), +v.slice(5, 7), 1) // first day of the following month
    : Date.parse(`${v}T00:00:00Z`) + 86400000;
  return Math.floor(end / 1000);
}

function label(draft) {
  const when = draft.depart.value.length === 7
    ? new Date(`${draft.depart.value}-15T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : draft.depart.value;
  const pax = (draft.adults || 1) + (draft.children || 0);
  const who = draft.persona ? PERSONAS[draft.persona].label : `${pax} pax`;
  return `${placeByCode(draft.origin)?.name || draft.origin} → ${placeByCode(draft.destination)?.name || draft.destination} · ${when} · ${who}`;
}

export async function createWatch(env, user, chat, search, limits, isGroup) {
  const key = isGroup ? `g${chat.id}` : `u${user.id}`;
  const usage = await getUsage(env, key);
  if (usage.watches >= limits.watches) {
    return send(env, chat.id, `You can add ${limits.watches} new price watch${limits.watches > 1 ? 'es' : ''} per day. Try again tomorrow, or remove one in /watches.`);
  }
  const owner = isGroup ? -chat.id : user.id; // group watches belong to the group
  const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM watches WHERE user_id = ? AND active = 1').bind(owner).first();
  const maxActive = Number(env.MAX_ACTIVE_WATCHES || 3);
  if ((active?.n || 0) >= maxActive) {
    return send(env, chat.id, `You already have ${maxActive} active price watches. Remove one in /watches first.`);
  }
  const draft = search.params.draft;
  const exp = expiryFor(draft);
  if (exp <= nowSec()) return send(env, chat.id, 'Those dates have already passed.');
  const best = search.params.best || null;
  await env.DB.prepare(`INSERT INTO watches (user_id, chat_id, params, label, best_price, last_alert_price, currency, active, created_at, last_checked, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .bind(owner, chat.id, JSON.stringify(draft), label(draft), best, best, search.params.currency || null, nowSec(), nowSec(), exp).run();
  await addUsage(env, key, 'watches');
  await bump(env, 'watches_created');
  const target = draft.budget ? ` or it goes under your budget of ${money(draft.budget.amount, draft.budget.currency)}${draft.budget.perPerson ? ' per person' : ''}` : '';
  return send(env, chat.id, `🔔 Watching <b>${esc(label(draft))}</b>.\nI'll message ${isGroup ? 'this group' : 'you'} when the price drops at least 5%${target}. See all with /watches.`);
}

export async function listWatches(env, user, chatId) {
  const { results } = await env.DB.prepare('SELECT * FROM watches WHERE user_id IN (?, ?) AND active = 1 ORDER BY created_at DESC')
    .bind(user.id, -chatId).all();
  if (!results?.length) return send(env, chatId, 'No active price watches. Search a trip and tap 🔔 <b>Track this trip</b>.');
  const lines = ['<b>Your price watches</b>'];
  const kb = [];
  for (const w of results) {
    lines.push(`• ${esc(w.label)}${w.best_price ? ` · last ${money(w.best_price, w.currency || 'usd')}` : ''}`);
    kb.push([btn(`Stop: ${w.label.slice(0, 40)}`, `w:off:${w.id}`)]);
  }
  return send(env, chatId, lines.join('\n'), kb);
}

export async function stopWatch(env, user, chatId, id) {
  await env.DB.prepare('UPDATE watches SET active = 0 WHERE id = ? AND (user_id = ? OR user_id = ?)').bind(id, user.id, -chatId).run();
  return send(env, chatId, 'Stopped that price watch.');
}

// Called by the 30-minute cron. Checks a small batch so each run stays light.
export async function checkWatches(env) {
  const batch = Number(env.WATCH_BATCH || 12);
  const { results } = await env.DB.prepare(`SELECT * FROM watches WHERE active = 1 AND last_checked < ? AND expires_at > ?
    ORDER BY last_checked ASC LIMIT ?`).bind(nowSec() - RECHECK_SEC, nowSec(), batch).all();
  let alerts = 0;
  for (const w of results || []) {
    const draft = JSON.parse(w.params);
    const owner = w.user_id > 0 ? await getUser(env, w.user_id) : null;
    if (owner?.banned) { await env.DB.prepare('UPDATE watches SET active = 0 WHERE id = ?').bind(w.id).run(); continue; }
    const userLike = owner || { currency: w.currency || 'usd', id: 0 };
    const { res, ranked } = await fetchRanked(env, draft, userLike);
    await env.DB.prepare('UPDATE watches SET last_checked = ? WHERE id = ?').bind(nowSec(), w.id).run();
    if (res.capped || !ranked.length) continue;
    const top = ranked.reduce((a, b) => (b.it.price < a.it.price ? b : a));
    const price = top.it.price;
    const cur = res.currency;
    await recordPrice(env, `${draft.origin}-${draft.destination}`, draft.depart.value.slice(0, 7), price, cur);
    const sameCur = !w.currency || w.currency === cur;
    if (!sameCur) {
      // traveller switched currency (/currency): restart the comparison in the new currency, no alert
      await env.DB.prepare('UPDATE watches SET best_price = ?, last_alert_price = ?, currency = ? WHERE id = ?').bind(price, price, cur, w.id).run();
      continue;
    }
    const dropped = sameCur && w.last_alert_price && price <= w.last_alert_price * (1 - DROP);
    const pax = (draft.adults || 1) + (draft.children || 0);
    const perPersonBudget = draft.budget && draft.budget.currency === cur ? (draft.budget.perPerson ? draft.budget.amount : draft.budget.amount / pax) : null;
    const underBudget = perPersonBudget && price <= perPersonBudget && (!w.last_alert_price || w.last_alert_price > perPersonBudget);
    await env.DB.prepare('UPDATE watches SET best_price = ?, currency = ? WHERE id = ?').bind(price, cur, w.id).run();
    if (!dropped && !underBudget) continue;

    const link = await trackedLink(env, bookingUrl(env, top.it), w.user_id, 'alert');
    const was = w.last_alert_price ? ` (was ${money(w.last_alert_price, cur)})` : '';
    const text = [
      `📉 Good news${owner?.name ? `, ${esc(owner.name)}` : ''}! <b>Price drop: ${esc(w.label)}</b>`,
      `Now <b>${money(price, cur)}</b> per person${was}${pax > 1 ? ` · about ${money(price * pax, cur)} for ${pax}` : ''}.`,
      `${top.it.transfers === 0 ? 'Direct' : `${top.it.transfers} stop(s)`} · out ${top.it.departure_at.slice(0, 10)}${top.it.return_at ? `, back ${top.it.return_at.slice(0, 10)}` : ''}`,
      underBudget ? '✅ This is within your budget.' : '',
      '<i>Prices change fast; the booking site shows the live price.</i>',
    ].filter(Boolean).join('\n');
    const kb = [];
    if (link) kb.push([url('Book now', link)]);
    kb.push([btn('Stop watching', `w:off:${w.id}`)]);
    const sent = await send(env, w.chat_id, text, kb);
    if (sent.ok) {
      alerts += 1;
      await env.DB.prepare('UPDATE watches SET last_alert_price = ? WHERE id = ?').bind(price, w.id).run();
    } else if (sent.error_code === 403) {
      // user blocked the bot or left the group: stop the watch
      await env.DB.prepare('UPDATE watches SET active = 0 WHERE id = ?').bind(w.id).run();
    }
  }
  if (alerts) await bump(env, 'alerts_sent', alerts);
  await bump(env, 'watch_checks', (results || []).length);
}
