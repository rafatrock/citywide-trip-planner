// 4.9.3: a visa answer never blocks flights, and can always be changed from the card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, installFetch, ctx, privateMsg, tap, lastSent } from './harness.js';

const BASE = 'https://citywide-trip-planner.example.workers.dev';
async function post(env, update) {
  const c = ctx();
  await worker.fetch(new Request(`${BASE}/tg`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET }, body: JSON.stringify(update) }), env, c);
  await c.done();
}
const buttons = (m) => (m?.body?.reply_markup?.inline_keyboard || []).flat();

test('"No visa yet" shows the flights straight away, and the answer can be changed later', async () => {
  const log = installFetch();
  const env = makeEnv();
  const U = { id: 9300, first_name: 'Rafat' };
  const C = { id: 9300, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg('r@example.com', U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap('set:p:friends', U, C)]) await post(env, u);

  await post(env, privateMsg('Me and 3 friends, Dhaka to Bangkok, 10 dec to 17 dec', U));
  let card = lastSent(log);
  const yes = buttons(card).find((b) => b.callback_data === 'd:visa:yes:TH');
  assert.ok(!yes.text.startsWith('✅'), 'nothing pre-ticked before answering');
  assert.match(card.body.text, /Either way I'll show you flights/);

  await post(env, tap('d:visa:no:TH', U, C));
  const res = lastSent(log);
  assert.match(res.body.text, /Here's what travellers found recently/, 'flights shown right after answering');
  assert.match(res.body.text, /Thailand with your Bangladesh passport: e-visa/, 'visa info, not a block');

  // the next card for Thailand still has the visa row, with the answer ticked, and it can be changed
  await post(env, privateMsg('Dhaka to Bangkok 5 jan to 12 jan', U));
  card = lastSent(log);
  assert.match(card.body.text, /you don't have a visa yet/);
  assert.ok(buttons(card).some((b) => b.callback_data === 'd:visa:no:TH' && b.text.startsWith('✅')));
  await post(env, tap('d:visa:yes:TH', U, C));
  card = lastSent(log);
  assert.ok(buttons(card).some((b) => b.callback_data === 'd:visa:yes:TH' && b.text.startsWith('✅')), 'changed to "have a visa"');
  assert.equal(env.DB.raw.prepare("SELECT status FROM user_visas WHERE user_id = 9300 AND cc = 'TH'").get().status, 'yes');
});
