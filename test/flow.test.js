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

test('journey: onboarding, uniqueness, search with three picks, weather, visa, email, country, flexible dates', async () => {
  const log = installFetch();
  const env = makeEnv({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'Maya at CityWide Trip <maya@citywidetrip.com>', TP_TRS: '999', AMAZON_TAG_COM: 'citywide-20' });
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
  assert.match(lastText(log), /who usually travels with you/);
  assert.doesNotMatch(lastText(log), /How do you usually pay/);
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
  let cardMsg = lastSent(log);
  let card = cardMsg.body.text;
  assert.match(card, /Got it, Rahim/);
  assert.match(card, /Dhaka \(DAC\) ⇄ Bangkok \(BKK\) · <b>return trip<\/b>/);
  assert.match(card, /any trip length/);
  // Thailand needs an e-visa for Bangladeshis → Maya asks once, only because it matters
  assert.match(card, /Thailand needs an e-visa for your passport\. Do you already have a valid one\?/);
  assert.ok(buttons(cardMsg).some((b) => b.callback_data === 'd:visa:yes:TH'));
  assert.ok(buttons(cardMsg).some((b) => b.callback_data === 'd:stay:week'));
  await post(env, tap('d:visa:no:TH'));
  assert.doesNotMatch(lastText(log), /Do you already have/, 'not asked again');
  await post(env, tap('d:stay:week'));
  assert.match(lastText(log), /staying 5–7 nights/);
  await post(env, tap('d:go'));
  const res = lastSent(log);
  const t = res.body.text;
  console.log(`\n---- results ----\n${t}\n-----------------`);
  assert.match(t, /Here's what travellers found recently, Rahim/);
  assert.match(t, /⭐ <b>Option 1 · Best overall · Fastest · Thai Airways<\/b>/);
  assert.match(t, /Dhaka ⇄ Bangkok<\/b> · return/);
  assert.match(t, /\d+ nights/);
  assert.match(t, /💰 <b>Option 2 · Cheapest · Malaysia Airlines<\/b>/);
  assert.match(t, /🛫 Thu, 10 Dec · 21:00 Dhaka → 02:00 \(\+1\) Bangkok/);
  assert.match(t, /1 stop \(about 45m connection, estimated\)/);
  assert.match(t, /Bangkok in December: warm, dry, around 27°C on average/);
  assert.match(t, /thaievisa\.go\.th/);
  assert.match(t, /Thailand with your Bangladesh passport: e-visa \(apply online before you fly\)/);
  assert.match(t, /Based on data from mid-2026/);
  assert.match(t, /GoZayaan/);
  const kb = buttons(res);
  assert.ok(kb.some((b) => /^⭐ Thai Airways · BDT.21,000 · Book$/.test(b.text)));
  assert.ok(kb.some((b) => b.text === '🌏 Similar places'));
  assert.ok(kb.some((b) => b.text?.startsWith('🔎 All live prices') && b.url.includes('/go/')));
  const wa = kb.find((b) => b.text === '📤 Share on WhatsApp');
  assert.match(decodeURIComponent(wa.url), /^https:\/\/wa\.me\/\?text=✈️ Dhaka → Bangkok/);
  assert.ok(kb.some((b) => b.callback_data?.startsWith('r:tk:')), 'toolkit button');
  assert.ok(kb.some((b) => b.url === 'https://tp.st/hotel'), 'one joined-program extra inline');
  const emailBtn = kb.find((b) => b.callback_data?.startsWith('r:em:'));
  assert.ok(emailBtn, 'email-me button for users with an email');

  // ---- email the plan ----
  await post(env, tap(emailBtn.callback_data));
  assert.match(lastText(log), /Sent to rahim@example.com/);
  const mail = log.emails.at(-1);
  assert.match(mail.subject, /^Rahim, your Dhaka ⇄ Bangkok flight plan \(\d+–\d+ \w+\)$/);
  assert.equal(mail.html, undefined, 'plain-text email only');
  assert.match(mail.text, /^Hi Rahim,/);
  assert.match(mail.text, /🛫 DEPART   \w+, \d+ \w+ 2026\n   \d\d:\d\d  Dhaka \(DAC\)\n   \d\d:\d\d  Bangkok \(BKK\)/);
  assert.match(mail.text, /🛬 RETURN/);
  assert.match(mail.text, /Non-stop/);
  assert.match(mail.text, /💰 YOUR SAVING/);
  assert.match(mail.text, /I compared \d+ fares/);
  assert.match(mail.text, /🛂 VISA\n   • Thailand with your Bangladesh passport: e-visa needed\.\n   • Apply online a few weeks/);
  assert.match(mail.text, /thaievisa\.go\.th/);
  assert.match(mail.text, /🌤 WEATHER/);
  assert.match(mail.text, /💳 PAYING FROM BANGLADESH/);
  assert.match(mail.text, /👉 Book this: https:\/\/.+\/go\//);
  assert.match(mail.text, /🎒 ALSO HANDY/);
  assert.match(mail.text, /Don't want deal emails\?/);
  assert.match(mail.headers['List-Unsubscribe'], /\/unsub\?u=42&s=/);
  const tkBtn = kb.find((b) => b.callback_data?.startsWith('r:tk:'));
  await post(env, tap(tkBtn.callback_data));
  const tk = buttons(lastSent(log)).map((b) => b.url);
  assert.deepEqual(tk.sort(), ['https://tp.st/esim', 'https://tp.st/hotel'], 'only programs you joined appear');

  // ---- easier places: embassy-visa places are skipped for this passport ----
  const sid = emailBtn.callback_data.split(':')[2];
  await post(env, tap(`r:alt:${sid}`));
  const alt = lastText(log);
  assert.match(alt, /Ideas like Bangkok|could not find/);
  if (/Ideas like/.test(alt)) assert.doesNotMatch(alt, /embassy/);

  // ---- an embassy-visa destination: asked about a visa; "yes" is remembered ----
  await post(env, privateMsg('Dhaka to Tokyo in April'));
  assert.match(lastText(log), /Japan needs a visa for your passport/);
  await post(env, tap('d:visa:yes:JP'));
  assert.doesNotMatch(lastText(log), /needs a visa|embassy/);
  await post(env, privateMsg('/visas'));
  assert.match(lastText(log), /Japan: have a valid visa/);
  assert.match(lastText(log), /Thailand: no visa yet/);

  // ---- spelling mistakes are forgiven, and Maya says what she guessed ----
  await post(env, privateMsg('trip to bangkock in december'));
  assert.match(lastText(log), /I read "bangkock" as Bangkok/);

  // ---- one way ----
  await post(env, tap('d:way:ow'));
  assert.match(lastText(log), /→ Bangkok \(BKK\) · <b>one way<\/b>/);

  // ---- a country instead of a city ----
  await post(env, privateMsg('family trip to Thailand in December'));
  assert.match(lastText(log), /Thailand, nice choice! Which part\?/);
  assert.ok(buttons(lastSent(log)).some((b) => b.callback_data === 'd:dest:HKT'));
  assert.ok(buttons(lastSent(log)).some((b) => b.callback_data === 'd:cmp:TH'));
  await post(env, tap('d:dest:BKK'));
  assert.match(lastText(log), /Dhaka \(DAC\) ⇄ Bangkok \(BKK\)/);

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

  // ---- daily quota (7 in the first week; an old "5" left in wrangler.toml is ignored) ----
  for (let i = 0; i < 5; i += 1) await post(env, tap('d:go'));
  assert.match(lastText(log), /used today's 7 free searches, Rahim/);
  assert.match(lastText(log), /After your first week you get 10 a day/);

  // ---- "Did you book?" a day after tapping Book, then pre-trip reminders ----
  const bookUrl = kb.find((b) => b.text?.startsWith('⭐ ') && b.text.endsWith('· Book')).url;
  { const c = ctx(); await worker.fetch(new Request(bookUrl), env, c); await c.done(); }
  env.DB.raw.exec('UPDATE links SET first_click = first_click - 90000');
  let n1 = log.telegram.length;
  { const c = ctx(); await worker.scheduled({ cron: '0 3 * * *' }, env, c); await c.done(); }
  const ask = sentSince(log, n1).find((m) => /Did you book your Dhaka → Bangkok trip/.test(m.body.text));
  assert.ok(ask, 'asked once whether they booked');
  await post(env, tap(buttons(ask).find((b) => b.text === '✅ Yes, booked!').callback_data));
  assert.match(lastText(log), /I've saved your trip to Bangkok/);
  await post(env, privateMsg('/trips'));
  assert.match(lastText(log), /Dhaka → Bangkok/);
  // pretend the trip is in 10 days → the 2-week reminder goes out
  env.DB.raw.exec(`UPDATE trips SET depart = '${new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)}'`);
  n1 = log.telegram.length;
  { const c = ctx(); await worker.scheduled({ cron: '0 3 * * *' }, env, c); await c.done(); }
  assert.ok(sentSince(log, n1).some((m) => /2 weeks to go until Bangkok, Rahim/.test(m.body.text)));
  assert.ok(!sentSince(log, n1).some((m) => /Did you book/.test(m.body.text)), 'never asked twice');

  // ---- /latest: personal updates (searched routes, your news posts, visa, weather) ----
  await post(env, privateMsg('/post TH,BD | Thailand e-visa now takes about 3 working days.', { id: 999, first_name: 'Admin' }));
  await post(env, privateMsg('/latest'));
  const lt = lastText(log);
  assert.match(lt, /Latest for you, Rahim/);
  assert.match(lt, /Dhaka → Bangkok<\/b> in December: from BDT/);
  assert.match(lt, /📰 Thailand e-visa now takes about 3 working days/);

  // ---- misunderstood messages are logged for you ----
  const realAI = env.AI;
  env.AI = { run: async () => ({ response: '{}' }) }; // the AI can't work it out either
  await post(env, privateMsg('wanna go somewhere fun with the lads'));
  env.AI = realAI;
  await post(env, privateMsg('/misses', { id: 999, first_name: 'Admin' }));
  assert.match(lastText(log), /wanna go somewhere fun with the lads/);

  // ---- /currency ----
  await post(env, privateMsg('/currency'));
  await post(env, tap('cur:usd'));
  assert.match(lastText(log), /prices in USD/);
  await post(env, tap('cur:bdt'));

  // ---- travel gear page (Amazon) ----
  { const c = ctx(); const r = await worker.fetch(new Request(`${BASE}/gear?c=BD&d=Bangkok`), env, c); const h = await r.text();
    assert.match(h, /tag=citywide-20/); assert.match(h, /As an Amazon Associate/); }

  // ---- one-click unsubscribe from deal emails ----
  { const c = ctx(); const r = await worker.fetch(new Request(mail.headers['List-Unsubscribe'].slice(1, -1), { method: 'POST', body: 'List-Unsubscribe=One-Click' }), env, c);
    assert.equal(r.status, 200);
    assert.equal(env.DB.raw.prepare('SELECT marketing FROM users WHERE id = 42').get().marketing, 0); }

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
  assert.match(lastText(log), /Here's what travellers found recently, Karim/);
  assert.match(lastText(log), /Dhaka ⇄ Kuala Lumpur/);

  await post(env, privateMsg('/stats', { id: 999, first_name: 'Admin' }));
  const rep = lastText(log);
  assert.match(rep, /Emails: 1 \(1 confirmed\)/);
  assert.match(rep, /Said yes to deals: 0/); // unsubscribed above
  assert.match(rep, /Reused email\/phone refused: 1/);
  console.log(`\n---- /stats ----\n${rep}\n----------------`);

  await post(env, privateMsg('/delete'));
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 42').get().n, 0);
});

test('works without Resend: email is checked and saved (unconfirmed)', async () => {
  const log = installFetch();
  const env = makeEnv();
  await onboard(env, 70, { home: 'DAC', persona: 'family' });
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
