// Version 4.2: carrier first, connection times, plain-text email with fair-use limits,
// no payment-method question, built-in analytics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, installFetch, ctx, privateMsg, tap, lastSent } from './harness.js';
import { connectionMinutes } from '../src/multi.js';
import { bump } from '../src/db.js';
import { monthKey } from '../src/email.js';

const BASE = 'https://citywide-trip-planner.example.workers.dev';
async function post(env, update) {
  const c = ctx();
  await worker.fetch(new Request(`${BASE}/tg`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET }, body: JSON.stringify(update) }), env, c);
  await c.done();
}
const buttons = (m) => (m?.body?.reply_markup?.inline_keyboard || []).flat();
const lastText = (log) => lastSent(log).body.text;

async function person(env, log, id) {
  const U = { id, first_name: `P${id}`, language_code: 'bn' };
  const C = { id, type: 'private' };
  await post(env, privateMsg('/start', U));
  await post(env, tap('set:name:tg', U, C));
  await post(env, tap('set:home:DAC', U, C));
  await post(env, tap('set:pp:BD', U, C));
  await post(env, tap('set:ppdone', U, C));
  await post(env, tap('set:visadone', U, C));
  await post(env, privateMsg(`p${id}@example.com`, U));
  await post(env, privateMsg(log.emails.at(-1).text.match(/\d{6}/)[0], U));
  await post(env, privateMsg('Skip', U));
  await post(env, tap('set:mk:1', U, C));
  assert.doesNotMatch(lastText(log), /How do you usually pay/, 'no payment question any more');
  await post(env, tap('set:p:friends', U, C));
  assert.match(lastText(log), /All set/);
  return { U, C };
}

async function searchDacBkk(env, log, U, C, text = 'Me and 3 friends, Dhaka to Bangkok, December') {
  await post(env, privateMsg(text, U));
  await post(env, tap('d:visa:no:TH', U, C));
  await post(env, tap('d:stay:week', U, C));
  await post(env, tap('d:go', U, C));
  return buttons(lastSent(log)).find((b) => b.callback_data?.startsWith('r:em:'));
}

test('connection time estimate is sensible', () => {
  assert.equal(connectionMinutes('DAC', 'BKK', 150, 0), null, 'non-stop has none');
  assert.equal(connectionMinutes('DAC', 'BKK', 240, 1), 45);
  assert.ok(connectionMinutes('DAC', 'LON', 16 * 60, 1) >= 120, 'long one-stop to London has a real wait');
  assert.equal(connectionMinutes('DAC', 'BKK', 160, 1), null, 'too short to estimate');
});

test('email fair use: confirmed only, same plan once, pause, daily limit, codes before plans', async () => {
  const log = installFetch();
  const env = makeEnv({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'Maya <maya@citywidetrip.com>', EMAIL_COOLDOWN_SEC: '120' });
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }

  // unconfirmed address: no plan email
  const a = await person(env, log, 201);
  env.DB.raw.prepare('UPDATE users SET email_verified = 0 WHERE id = 201').run(); // e.g. joined before Resend was on
  const em0 = await searchDacBkk(env, log, a.U, a.C);
  const before = log.emails.length;
  await post(env, tap(em0.callback_data, a.U, a.C));
  assert.match(lastText(log), /confirm your email first/);
  assert.equal(log.emails.length, before);

  // confirmed: first send works, plain text only
  const b = await person(env, log, 202);
  const em = await searchDacBkk(env, log, b.U, b.C);
  await post(env, tap(em.callback_data, b.U, b.C));
  assert.match(lastText(log), /Sent to p202@example.com/);
  const mail = log.emails.at(-1);
  assert.equal(mail.html, undefined);
  assert.match(mail.text, /💰 OPTION 2 · CHEAPEST · Malaysia Airlines/);
  assert.match(mail.text, /1 stop \(about 45m to change planes, estimated\)/);
  assert.match(mail.text, /🛂 VISA\n   • /);
  assert.match(mail.text, /✅ WHAT'S NEXT\n   1️⃣ /);

  // same plan again (even from a new search): not re-sent
  const n = log.emails.length;
  const em2 = await searchDacBkk(env, log, b.U, b.C);
  await post(env, tap(em2.callback_data, b.U, b.C));
  assert.match(lastText(log), /already emailed you this exact plan/);
  assert.equal(log.emails.length, n);

  // a different plan straight away: short pause
  const em3 = await searchDacBkk(env, log, b.U, b.C, 'Me and 3 friends, Dhaka to Kuala Lumpur, December');
  if (em3) {
    await post(env, tap(em3.callback_data, b.U, b.C));
    assert.match(lastText(log), /Give it a couple of minutes|already emailed/);
  }

  // bot-wide: plan emails stop early so sign-up codes still go out
  const day = new Date().toISOString().slice(0, 10);
  env.DB.raw.prepare("INSERT INTO counters (day, name, value) VALUES (?, 'emails_sent', 76) ON CONFLICT (day, name) DO UPDATE SET value = 76").run(day);
  const c = await person(env, log, 203); // sign-up code still sent (76 < 90)
  const em4 = await searchDacBkk(env, log, c.U, c.C);
  const m = log.emails.length;
  await post(env, tap(em4.callback_data, c.U, c.C));
  assert.match(lastText(log), /Email is busy today/);
  assert.equal(log.emails.length, m);
});

test('per-person monthly limit and the admin analytics', async () => {
  const log = installFetch();
  const env = makeEnv({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'Maya <maya@citywidetrip.com>' });
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  const p = await person(env, log, 301);
  await bump(env, 'em_u301', 8, monthKey());
  const em = await searchDacBkk(env, log, p.U, p.C);
  await post(env, tap(em.callback_data, p.U, p.C));
  assert.match(lastText(log), /8 plan emails this month/);

  const admin = { id: 999, first_name: 'Owner' };
  await post(env, privateMsg('/analytics', admin));
  const a = lastText(log);
  console.log(`\n---- /analytics ----\n${a}\n--------------------`);
  assert.match(a, /📈 Analytics/);
  assert.match(a, /Bangladesh: 1/);
  assert.match(a, /Bangla 1|Bengali 1/);
  assert.match(a, /searched 1/);
  assert.match(a, /Email this month/);
  await post(env, privateMsg('/stats', admin));
  assert.match(lastText(log), /Emails sent: \d+ \/ 90 \(codes \d+, plans \d+\)/);
});
