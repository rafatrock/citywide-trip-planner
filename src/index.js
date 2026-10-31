// CityWide Trip Planner — Cloudflare Worker entry point.
//   POST /tg            Telegram webhook (checked with a secret header)
//   GET  /go/<id>       tracked booking link → redirects to the booking site
//   GET  /setup?key=…   one-time setup in the browser: connects the bot to Telegram
//   GET  /              health page
// Cron: every 30 min checks trip watches; 03:00 UTC sends the daily report.

import { ensureSchema, useLink, bump, setConfig, getConfig, cleanup } from './db.js';
import { handleUpdate } from './bot.js';
import { checkWatches } from './watch.js';
import { dailyReport } from './admin.js';
import { askBooked, tripReminders, weeklyDigest } from './retention.js';
import { refreshNews } from './news.js';
import { recordClick } from './profile.js';
import { gearPage, storeFor } from './toolkit.js';
import { unsubSig } from './email.js';
import { tg } from './tg.js';

const REQUIRED = ['TELEGRAM_BOT_TOKEN', 'TG_WEBHOOK_SECRET', 'SETUP_KEY', 'TP_TOKEN', 'TP_MARKER'];

const html = (body, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CityWide Trip Planner</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px">${body}</body>`,
{ status, headers: { 'content-type': 'text/html; charset=utf-8' } });

// Constant-time-ish comparison for secrets
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function setup(env, request) {
  const u = new URL(request.url);
  if (!env.SETUP_KEY || !same(u.searchParams.get('key') || '', env.SETUP_KEY)) return html('<h2>Not allowed</h2>', 403);
  const missing = REQUIRED.filter((k) => !env[k]);
  if (!env.DB) missing.push('DB (D1 database binding: check database_id in wrangler.toml)');
  if (missing.length) return html(`<h2>Almost there</h2><p>These settings are missing in Cloudflare → your Worker → Settings → Variables and Secrets:</p><ul>${missing.map((m) => `<li><b>${m}</b></li>`).join('')}</ul>`, 400);
  await ensureSchema(env);
  const origin = `${u.protocol}//${u.host}`;
  await setConfig(env, 'public_url', origin);
  const me = await tg(env, 'getMe', {});
  if (!me.ok) return html('<h2>Telegram token not accepted</h2><p>Check TELEGRAM_BOT_TOKEN (copy it again from @BotFather).</p>', 400);
  await setConfig(env, 'bot_username', me.result.username);
  await refreshAirlines(env);
  // Telegram sometimes can't look up a workers.dev address for a few minutes: try 3 times.
  let hook;
  for (let i = 0; i < 3; i += 1) {
    hook = await tg(env, 'setWebhook', {
      url: `${origin}/tg`,
      secret_token: env.TG_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false, // keep messages people sent while the bot was being updated
      max_connections: 20,
    });
    if (hook.ok) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  await tg(env, 'setMyCommands', { commands: COMMANDS });
  await tg(env, 'setMyDescription', { description: 'Tell me who is travelling and where. I find the best flights for your group, explain why, and watch prices for you.' });
  await tg(env, 'setMyShortDescription', { short_description: 'Flights picked for your group: family, friends, solo, business. Free price alerts.' });
  const info = await tg(env, 'getWebhookInfo', {});
  const w = info.ok ? info.result : {};
  const dns = /resolve host|name resolution/i.test(hook.description || '');
  const help = hook.ok ? '' : dns
    ? `<p><b>What this means:</b> Telegram's servers couldn't look up your bot's address just now. Your code and settings are fine. Wait 10–15 minutes and open this page again. If it keeps happening for more than an hour, give the bot your own address (Setup Guide, Part F5); that is the lasting fix.</p>`
    : '<p>Check <b>TG_WEBHOOK_SECRET</b> (letters, numbers, _ and - only) and try again.</p>';
  const lastErr = w.last_error_date ? `<p>Telegram's last delivery problem: ${new Date(w.last_error_date * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC — ${String(w.last_error_message || '').replace(/[<>&]/g, '')}</p>` : '';
  return html(`<h2>${hook.ok ? '✅ Connected' : '❌ Could not connect'}</h2>
<p>Bot: <a href="https://t.me/${me.result.username}">@${me.result.username}</a></p>
<p>Webhook: <code>${origin}/tg</code>${hook.ok ? '' : ` — ${String(hook.description || 'error').replace(/[<>&]/g, '')}`}</p>
${help}
<p>Telegram's saved address: <code>${String(w.url || '(none)').replace(/[<>&]/g, '')}</code> · messages waiting: ${w.pending_update_count ?? '?'}</p>
${lastErr}
<p>Database: ready.${hook.ok ? ' Open the bot in Telegram and send <b>/start</b>.' : ''}</p>`);
}

// Airline names for every code (free Travelpayouts data file), saved once a week.
async function refreshAirlines(env) {
  const at = Number(await getConfig(env, 'airlines_at')) || 0;
  if (Date.now() - at < 7 * 86400000 && await getConfig(env, 'airlines')) return;
  try {
    const res = await fetch('https://api.travelpayouts.com/data/en/airlines.json', { signal: AbortSignal.timeout(10000) });
    const list = await res.json();
    const map = {};
    for (const a of Array.isArray(list) ? list : []) {
      const name = a?.name_translations?.en || a?.name;
      if (a?.code && /^[A-Z0-9]{2}$/.test(a.code) && name && !map[a.code]) map[a.code] = String(name).slice(0, 40);
    }
    if (Object.keys(map).length > 100) {
      await setConfig(env, 'airlines', JSON.stringify(map));
      await setConfig(env, 'airlines_at', Date.now());
    }
  } catch (e) { console.log('airline list failed', e && e.message); }
}

// The bot's command menu in Telegram. Sent at setup and refreshed by the daily job,
// so new commands (like /deals) appear without opening the setup link again.
const COMMANDS = [
      { command: 'plan', description: 'Plan a new trip' },
      { command: 'deals', description: 'Cheap fares from your city' },
      { command: 'latest', description: 'Updates picked for you' },
      { command: 'watches', description: 'Your price watches' },
      { command: 'trips', description: 'Your booked trips' },
      { command: 'currency', description: 'Change currency' },
      { command: 'visas', description: 'Visas you told me about' },
      { command: 'profile', description: 'What I remember about you' },
      { command: 'settings', description: 'Home city and preferences' },
      { command: 'help', description: 'How to use the bot' },
      { command: 'privacy', description: 'What I store' },
      { command: 'delete', description: 'Delete my data' },
    ];

// Each message or cron run gets its own copy of env with a call budget (free plan: 50; we keep 5 spare).
const withBudget = (env, max = 45) => Object.assign(Object.create(env), { __sub: { used: 0, max } });

export default {
  async fetch(request, rawEnv, ctx) {
    const env = withBudget(rawEnv);
    const u = new URL(request.url);
    try {
      if (u.pathname === '/tg' && request.method === 'POST') {
        if (!same(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', env.TG_WEBHOOK_SECRET || '\u0000')) {
          return new Response('forbidden', { status: 403 });
        }
        const update = await request.json().catch(() => null);
        if (update) {
          ctx.waitUntil((async () => {
            try {
              await ensureSchema(env);
              await handleUpdate(env, update);
            } catch (e) {
              console.log('update failed', e && e.stack ? e.stack : e);
              // never go silent: tell the person (a fresh call budget, one message)
              const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
              if (chatId) {
                try {
                  await tg(withBudget(rawEnv), 'sendMessage', { chat_id: chatId, text: 'Sorry, I hit a snag with that one 🙈 Please try again in a minute, or change the dates a little.' });
                } catch { /* nothing more we can do */ }
              }
            }
          })());
        }
        return new Response('ok'); // answer Telegram fast; the work continues in the background
      }

      // Public pages (booking links, gear page, unsubscribe, setup): max 10 a minute per visitor,
      // so nobody can hammer them to burn the free daily requests and database reads.
      if (u.pathname !== '/tg' && env.BURST) {
        try {
          const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
          const { success } = await env.BURST.limit({ key: `ip:${ip}` });
          if (!success) return new Response('Too many requests, please wait a minute.', { status: 429 });
        } catch { /* binding missing: carry on */ }
      }

      if (u.pathname.startsWith('/go/')) {
        await ensureSchema(env);
        const id = u.pathname.slice(4).replace(/[^a-z0-9]/g, '').slice(0, 16);
        const row = id ? await useLink(env, id) : null;
        if (!row || !/^https:\/\//.test(row.url)) return html('<h2>This link has expired</h2><p>Search again in the bot.</p>', 404);
        let label = null;
        try { label = row.meta ? JSON.parse(row.meta).label : null; } catch { /* old link */ }
        ctx.waitUntil(Promise.all([bump(env, 'clicks'), recordClick(env, row.user_id, label)]));
        return Response.redirect(row.url, 302);
      }

      if (u.pathname === '/setup') return setup(env, request);

      if (u.pathname === '/gear') {
        const cc = (u.searchParams.get('c') || 'US').toUpperCase().slice(0, 2);
        const store = storeFor(env, cc);
        if (!store) return html('<h2>Coming soon</h2>', 404);
        ctx.waitUntil(ensureSchema(env).then(() => bump(env, 'gear_views')));
        const keys = (u.searchParams.get('i') || '').split(',').filter((k) => /^[a-z]{2,12}$/.test(k)).slice(0, 3);
        const page = gearPage(env, store, (u.searchParams.get('d') || '').slice(0, 40), {
          keys, homeCc: cc, destCc: (u.searchParams.get('dc') || '').toUpperCase().slice(0, 2),
        });
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }

      if (u.pathname === '/unsub') {
        const id = Number(u.searchParams.get('u'));
        const ok = id && same(u.searchParams.get('s') || '', await unsubSig(env, id));
        if (!ok) return html('<h2>This link is not valid</h2>', 400);
        if (request.method === 'POST') {
          await ensureSchema(env);
          await env.DB.prepare('UPDATE users SET marketing = 0 WHERE id = ?').bind(id).run();
          await bump(env, 'unsubscribes');
          return html('<h2>Done</h2><p>You won\'t get deal emails any more. Trip plans you ask for will still arrive.</p>');
        }
        return html(`<h2>Stop deal emails?</h2><form method="post"><button style="font-size:16px;padding:10px 16px">Yes, stop deal emails</button></form>`);
      }

      if (u.pathname === '/' || u.pathname === '') {
        return html('<h2>CityWide Trip Planner</h2><p>The bot is running. Find it on Telegram.</p>');
      }
      return new Response('not found', { status: 404 });
    } catch (e) {
      console.log('request failed', e && e.stack ? e.stack : e);
      return new Response('error', { status: 500 });
    }
  },

  async scheduled(event, rawEnv, ctx) {
    const env = withBudget(rawEnv);
    ctx.waitUntil((async () => {
      try {
        await ensureSchema(env);
        if (event.cron === '0 3 * * *') {
          await dailyReport(env);
          await tripReminders(env);
          await askBooked(env);
          await cleanup(env);
          await refreshAirlines(env);
          await tg(env, 'setMyCommands', { commands: COMMANDS });
        } else {
          await checkWatches(env);
          await weeklyDigest(env);
          await refreshNews(env);
          await refreshAirlines(env); // only fetches if the list is missing or a week old
        }
      } catch (e) {
        console.log('cron failed', e && e.stack ? e.stack : e);
      }
    })());
  },
};
