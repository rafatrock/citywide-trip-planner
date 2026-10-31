// CityWide Trip Planner — Cloudflare Worker entry point.
//   POST /tg            Telegram webhook (checked with a secret header)
//   GET  /go/<id>       tracked booking link → redirects to the booking site
//   GET  /setup?key=…   one-time setup in the browser: connects the bot to Telegram
//   GET  /              health page
// Cron: every 30 min checks trip watches; 03:00 UTC sends the daily report.

import { ensureSchema, useLink, bump, setConfig, cleanup } from './db.js';
import { handleUpdate } from './bot.js';
import { checkWatches } from './watch.js';
import { dailyReport } from './admin.js';
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
  const hook = await tg(env, 'setWebhook', {
    url: `${origin}/tg`,
    secret_token: env.TG_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
    max_connections: 20,
  });
  await tg(env, 'setMyCommands', {
    commands: [
      { command: 'plan', description: 'Plan a new trip' },
      { command: 'watches', description: 'Your price watches' },
      { command: 'settings', description: 'Home city and preferences' },
      { command: 'help', description: 'How to use the bot' },
      { command: 'privacy', description: 'What I store' },
      { command: 'delete', description: 'Delete my data' },
    ],
  });
  await tg(env, 'setMyDescription', { description: 'Tell me who is travelling and where. I find the best flights for your group, explain why, and watch prices for you.' });
  await tg(env, 'setMyShortDescription', { short_description: 'Flights picked for your group: family, friends, solo, business. Free price alerts.' });
  return html(`<h2>${hook.ok ? '✅ Connected' : '❌ Could not connect'}</h2>
<p>Bot: <a href="https://t.me/${me.result.username}">@${me.result.username}</a></p>
<p>Webhook: <code>${origin}/tg</code>${hook.ok ? '' : ` — ${hook.description || 'error'}`}</p>
<p>Database: ready. Open the bot in Telegram and send <b>/start</b>.</p>`);
}

export default {
  async fetch(request, env, ctx) {
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
            }
          })());
        }
        return new Response('ok'); // answer Telegram fast; the work continues in the background
      }

      if (u.pathname.startsWith('/go/')) {
        await ensureSchema(env);
        const id = u.pathname.slice(4).replace(/[^a-z0-9]/g, '').slice(0, 16);
        const row = id ? await useLink(env, id) : null;
        if (!row || !/^https:\/\//.test(row.url)) return html('<h2>This link has expired</h2><p>Search again in the bot.</p>', 404);
        ctx.waitUntil(bump(env, 'clicks'));
        return Response.redirect(row.url, 302);
      }

      if (u.pathname === '/setup') return setup(env, request);

      if (u.pathname === '/' || u.pathname === '') {
        return html('<h2>CityWide Trip Planner</h2><p>The bot is running. Find it on Telegram.</p>');
      }
      return new Response('not found', { status: 404 });
    } catch (e) {
      console.log('request failed', e && e.stack ? e.stack : e);
      return new Response('error', { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        await ensureSchema(env);
        if (event.cron === '0 3 * * *') {
          await dailyReport(env);
          await cleanup(env);
        } else {
          await checkWatches(env);
        }
      } catch (e) {
        console.log('cron failed', e && e.stack ? e.stack : e);
      }
    })());
  },
};
