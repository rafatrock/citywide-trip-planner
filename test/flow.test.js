// End-to-end tests of the Worker: webhook → bot → database → Telegram replies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, installFetch, ctx, privateMsg, groupMsg, contactMsg, tap, lastSent, sentSince, fares } from './harness.js';

const BASE = 'https://citywide-trip-planner.example.workers.dev';

async function post(env, update, secret = env.TG_WEBHOOK_SECRET) {
  const c = ctx();
  const res = await worker.fetch(new Request(`${BASE}/tg`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify(update),
  }), env, c);
  await c.done();
  return res;
}
const buttons = (msg) => (msg?.body?.reply_markup?.inline_keyboard || []).flat();
const lastText = (log) => lastSent(log).body.text;

async function setupPage(env) {
  const c = ctx();
  return worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c);
}

// Completes onboarding quickly for a user (email unverified when Resend is off).
async function onboard(env, id, { home = 'LON', persona = 'couple', email = `user${id}@example.com` } = {}) {
  const from = { id, first_name: `User${id}` };
  const chat = { id, type: 'private' };
  await post(env, privateMsg('/start', from));
  await post(env, tap('set:name:tg', from, chat));
  await post(env, tap(`set:home:${home}`, from, chat));
  await post(env, tap('set:pp:GB', from, chat));
  await post(env, tap('set:ppdone', from, chat));
  await post(env, tap('set:visadone', from, chat));
  await post(env, privateMsg(email, from));
  await post(env, privateMsg('Skip', from));
  await post(env, tap('set:mk:0', from, chat));
  await post(env, tap(`set:p:${persona}`, from, chat));
}

test('v2 journey: onboarding, uniqueness, search with three picks, weather, visa, email, country, flexible dates', async () => {
  const log = installFetch();
  const env = makeEnv({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'Maya at CityWide Trip <maya@citywidetrip.com>' });
  assert.equal((await post(env, privateMsg('/start'), 'wrong')).status, 403);
  assert.equal((await setupPage(env)).status, 200);

  // ---- one-time onboarding ----
  await post(env, privateMsg('/start'));
  assert.match(lastText(log), /I'm <b>Maya<\/b>/);
  assert.match(lastText(log), /I'm an AI/);
  assert.match(lastText(log), /What should I call you/);
  await post(env, privateMsg('Dhaka to Bangkok')); // a trip before setup: asked to finish setup, and it isn't a name
  assert.match(lastText(log), /First, what should I call you/);
  await post(env, privateMsg('Rahim'));
  assert.match(lastText(log), /Lovely to meet you, Rahim/);
  assert.match(lastText(log), /usually fly from/);
  await post(env, tap('set:home:DAC'));
  assert.match(lastText(log), /Which passport/);
  await post(env, tap('set:pp:BD'));
  const edited = [...log.telegram].reverse().find((m) => m.method === 'editMessageText');
  assert.match(edited.body.text, /Selected: .*Bangladesh/);
  await post(env, tap('set:ppdone'));
  assert.match(lastText(log), /valid visas or residence permits/);
  await post(env, tap('set:visadone'));
  assert.match(lastText(log), /email address/);
  await post(env, privateMsg('not-an-email'));
  assert.match(lastText(log), /doesn't look like an email/);
  await post(env, privateMsg('me@mailinator.com'));
  assert.match(lastText(log), /not a temporary one/);
  await post(env, privateMsg('rahim@nomail.example'));
  assert.match(lastText(log), /can't find a mail server/);
  await post(env, privateMsg('Rahim@Example.com'));
  assert.match(lastText(log), /Sent a code to <b>rahim@example.com/);
  const code = log.emails.at(-1).text.match(/\d{6}/)[0];
  assert.equal(log.emails.at(-1).to[0], 'rahim@example.com');
  await post(env, privateMsg('000000' === code ? '111111' : '000000'));
  assert.match(lastText(log), /doesn't match/);
  await post(env, privateMsg(code));
  assert.match(lastText(log), /Email confirmed/);
  assert.match(lastText(log), /WhatsApp/);
  const phoneAsk = lastSent(log);
  assert.ok(phoneAsk.body.reply_markup.keyboard[0][0].request_contact, 'one-tap share button');
  await post(env, contactMsg('8801712345678'));
  assert.match(lastText(log), /deals/);
  await post(env, tap('set:mk:1'));
  assert.match(lastText(log), /How do you usually pay/);
  await post(env, tap('set:pay:bkash'));
  await post(env, tap('set:p:friends'));
  assert.match(lastText(log), /All set, Rahim/);
  const row = env.DB.raw.prepare('SELECT name, email, email_verified, phone, passports, marketing, persona FROM users WHERE id = 42').get();
  assert.deepEqual({ ...row }, { name: 'Rahim', email: 'rahim@example.com', email_verified: 1, phone: '+8801712345678', passports: 'BD', marketing: 1, persona: 'friends' });

  // ---- the same email or phone can't be reused by another account ----
  const eve = { id: 50, first_name: 'Eve' };
  const eveChat = { id: 50, type: 'private' };
  await post(env, privateMsg('/start', eve));
  await post(env, tap('set:name:tg', eve, eveChat));
  await post(env, tap('set:home:LON', eve, eveChat));
  await post(env, tap('set:pp:GB', eve, eveChat));
  await post(env, tap('set:ppdone', eve, eveChat));
  await post(env, tap('set:visadone', eve, eveChat));
  await post(env, privateMsg('rahim@example.com', eve));
  assert.match(lastText(log), /already linked to another Telegram account/);

  // ---- small talk: honest about being an AI ----
  await post(env, privateMsg('are you a bot?'));
  assert.match(lastText(log), /I'm an AI, not a person/);

  // ---- a one-line trip → confirmation with visa heads-up → three picks ----
  await post(env, privateMsg('Me and 3 friends, Dhaka to Bangkok, December, max 25,000 BDT each'));
  let card = lastText(log);
  assert.match(card, /Got it, Rahim/);
  assert.match(card, /Dhaka \(DAC\) → Bangkok \(BKK\)/);
  assert.doesNotMatch(card, /embassy visa/); // Thai e-visa for Bangladeshis since Jan 2025 (override)
  await post(env, tap('d:go'));
  const res = lastSent(log);
  const t = res.body.text;
  console.log(`\n---- results ----\n${t}\n-----------------`);
  assert.match(t, /Here's what I found, Rahim/);
  assert.match(t, /⭐ <b>Best overall<\/b>/);
  assert.match(t, /💰 <b>Cheapest<\/b>/);
  assert.match(t, /🛋️ <b>Most comfortable<\/b>|Most comfortable/);
  assert.match(t, /Bangkok in December: usually \d+° \/ \d+°C/);
  assert.match(t, /Thailand with your Bangladesh passport: e-visa \(apply online before you fly\)/);
  assert.match(t, /Based on data from mid-2026/);
  assert.match(t, /GoZayaan/);
  const kb = buttons(res);
  assert.ok(kb.some((b) => b.text?.startsWith('⭐ Book best overall')));
  assert.ok(kb.some((b) => b.text === '🌏 Similar places'));
  const emailBtn = kb.find((b) => b.callback_data?.startsWith('r:em:'));
  assert.ok(emailBtn, 'email-me button for users with an email');

  // ---- email the plan ----
  await post(env, tap(emailBtn.callback_data));
  assert.match(lastText(log), /Sent to rahim@example.com/);
  const mail = log.emails.at(-1);
  assert.equal(mail.subject, 'Your trip: Dhaka → Bangkok');
  assert.match(mail.html, /See live price and book/);
  assert.match(mail.html, /Hi Rahim/);

  // ---- easier places: embassy-visa places are skipped for this passport ----
  const sid = emailBtn.callback_data.split(':')[2];
  await post(env, tap(`r:alt:${sid}`));
  const alt = lastText(log);
  assert.match(alt, /Ideas like Bangkok|could not find/);
  if (/Ideas like/.test(alt)) assert.doesNotMatch(alt, /embassy/);

  // ---- an embassy-visa destination gets an early heads-up (BD passport → Japan) ----
  await post(env, privateMsg('Dhaka to Tokyo in April'));
  assert.match(lastText(log), /needs an embassy visa/);

  // ---- a country instead of a city ----
  await post(env, privateMsg('family trip to Thailand in December'));
  assert.match(lastText(log), /Thailand, nice choice! Which part\?/);
  assert.ok(buttons(lastSent(log)).some((b) => b.callback_data === 'd:dest:HKT'));
  assert.ok(buttons(lastSent(log)).some((b) => b.callback_data === 'd:cmp:TH'));
  await post(env, tap('d:dest:BKK'));
  assert.match(lastText(log), /Dhaka \(DAC\) → Bangkok \(BKK\)/);

  // ---- flexible dates ----
  await post(env, privateMsg('Dhaka to Bangkok 10 dec, back 17 dec'));
  card = lastSent(log);
  assert.match(card.body.text, /\(exact\)/);
  assert.ok(buttons(card).some((b) => b.callback_data === 'd:flex:3d'));
  await post(env, tap('d:flex:3d'));
  assert.match(lastText(log), /± 3 days/);
  const before = log.tp.length;
  await post(env, tap('d:go'));
  assert.equal(log.tp.at(-1)?.departure_at ?? log.tp[before - 1].departure_at, '2026-12', 'flexible search asks for the whole month, then filters');
  assert.match(lastText(log), /Best overall/);

  // ---- daily quota (5): used search, easier places, flexible search = 3 ----
  await post(env, tap('d:go'));
  await post(env, tap('d:go'));
  await post(env, tap('d:go'));
  assert.match(lastText(log), /used today's 5 free searches, Rahim/);

  // ---- price watch and alert by name ----
  env.DB.raw.exec("DELETE FROM usage WHERE key = 'u42'");
  const trackId = buttons(res).find((b) => b.callback_data?.startsWith('r:w:')).callback_data;
  await post(env, tap(trackId));
  assert.match(lastText(log), /Watching/);
  env.DB.raw.exec('UPDATE watches SET last_checked = 0');
  env.DB.raw.exec("DELETE FROM cache WHERE key LIKE 'tp:%'");
  fares.scale = 0.8;
  const n0 = log.telegram.length;
  { const c = ctx(); await worker.scheduled({ cron: '*/30 * * * *' }, env, c); await c.done(); }
  const alertMsg = sentSince(log, n0).find((m) => /Price drop/.test(m.body.text));
  assert.ok(alertMsg);
  assert.match(alertMsg.body.text, /Good news, Rahim!/);
  fares.scale = 1;

  // ---- profile, settings, groups, admin ----
  await post(env, privateMsg('/profile'));
  assert.match(lastText(log), /Passports: .*Bangladesh/);
  assert.match(lastText(log), /rahim@example.com ✅/);
  await post(env, privateMsg('/settings'));
  await post(env, tap('set:edit:name'));
  assert.match(lastText(log), /What should I call you/);
  await post(env, privateMsg('Rahi'));
  assert.match(lastText(log), /All set, Rahi/);

  let n = log.telegram.length;
  await post(env, groupMsg('anyone hungry?'));
  assert.equal(log.telegram.length, n);
  await post(env, groupMsg('@CityWideTripPlannerBot from Dhaka to Kuala Lumpur in December, 3 people'));
  assert.match(lastText(log), /Dhaka → Kuala Lumpur/);

  await post(env, privateMsg('/stats', { id: 999, first_name: 'Admin' }));
  const rep = lastText(log);
  assert.match(rep, /Emails: 1 \(1 confirmed\)/);
  assert.match(rep, /Said yes to deals: 1/);
  assert.match(rep, /Reused email\/phone refused: 1/);
  console.log(`\n---- /stats ----\n${rep}\n----------------`);

  await post(env, privateMsg('/delete'));
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 42').get().n, 0);
});

test('works without Resend: email is checked and saved (unconfirmed)', async () => {
  const log = installFetch();
  const env = makeEnv();
  await onboard(env, 70, { home: 'DAC', persona: 'family' });
  await post(env, tap('set:pay:local', { id: 70 }, { id: 70, type: 'private' }));
  await post(env, tap('set:p:family', { id: 70 }, { id: 70, type: 'private' }));
  const u = env.DB.raw.prepare('SELECT email, email_verified FROM users WHERE id = 70').get();
  assert.equal(u.email, 'user70@example.com');
  assert.equal(u.email_verified, 0);
  assert.equal(log.emails.length, 0);
});

test('burst limit stops floods', async () => {
  const log = installFetch();
  let calls = 0;
  const env = makeEnv({ BURST: { limit: async () => ({ success: (calls += 1) <= 10 }) } });
  for (let i = 0; i < 14; i += 1) await post(env, privateMsg('/help', { id: 77, first_name: 'Bot' }));
  const replies = log.telegram.filter((m) => m.method === 'sendMessage');
  assert.equal(replies.filter((m) => /Slow down/.test(m.body.text)).length, 1);
  assert.equal(replies.length, 11);
});

test('AI budget switch: no AI calls once the daily cap is reached', async () => {
  installFetch();
  let aiCalls = 0;
  const env = makeEnv({ AI_DAILY_MAX: '1', AI: { run: async () => { aiCalls += 1; return { response: '{}' }; } } });
  await onboard(env, 60);
  await post(env, privateMsg('somewhere sunny please soon', { id: 60 }));
  await post(env, privateMsg('somewhere sunny please later', { id: 60 }));
  assert.equal(aiCalls, 1);
});
