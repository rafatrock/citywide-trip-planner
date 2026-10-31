// Version 4: whole-world places, multi-country trips, no question loops,
// group-size guess, official travel-advice news, trip-tailored packing picks.
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
const lastText = (log) => lastSent(log).body.text;
const U = { id: 88, first_name: 'Rafat' };
const C = { id: 88, type: 'private' };

async function onboard(env) {
  await post(env, privateMsg('/start', U));
  await post(env, tap('set:name:tg', U, C));
  await post(env, tap('set:home:DAC', U, C));
  await post(env, tap('set:pp:BD', U, C));
  await post(env, tap('set:ppdone', U, C));
  await post(env, tap('set:visadone', U, C));
  await post(env, privateMsg('rafat@example.com', U));
  await post(env, privateMsg('Skip', U));
  await post(env, tap('set:mk:1', U, C));
  await post(env, tap('set:p:friends', U, C));
}

test('the screenshot: a 3-country backpacker trip works, no loop', async () => {
  const log = installFetch();
  const env = makeEnv({ AMAZON_TAG_COM: 'citywide-20' });
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  await onboard(env);

  await post(env, privateMsg('how about me with 2 friends on 2nd week of january any dates. 7 days total trip to Uzbekistan and Kyrgyzstan and Turkmenistan. Backpackers.', U));
  // priced straight away: every leg, three whole-trip options, totals
  const res = lastSent(log);
  console.log(`\n---- multi result ----\n${res.body.text}\n----------------------`);
  assert.match(res.body.text, /Here's your trip, Rafat/);
  assert.match(res.body.text, /Dhaka → Tashkent → (Bishkek → Ashgabat|Ashgabat → Bishkek) → Dhaka/);
  assert.match(res.body.text, /Backpacker \/ budget · 3 people · 6 nights/);
  assert.match(res.body.text, /CHEAPEST/);
  assert.match(res.body.text, /① <b>Uzbekistan Airways<\/b>/);
  assert.match(res.body.text, /is tight/);
  assert.match(res.body.text, /Turkmenistan: visa needed from the embassy/);
  assert.ok(buttons(res).some((b) => b.callback_data === 'd:mrm:ASB'), 'can drop a country');
  assert.ok(!buttons(res).some((b) => /Book leg|^\d\) /.test(b.text)), 'no single-flight links, whole trips only');
  const whole = buttons(res).find((b) => / Book( the whole)? trip/.test(b.text));
  assert.ok(whole, 'a whole-trip booking link');
  const go = whole.url.split('/go/')[1];
  const target = env.DB.raw.prepare('SELECT url FROM links WHERE id = ?').get(go).url;
  const m = target.match(/^https:\/\/www\.aviasales\.com\/search\/DAC(\d{4})TAS(\d{4})[A-Z]{3}(\d{4})[A-Z]{3}(\d{4})DAC3\?marker=/);
  assert.ok(m, `one multi-city path like DAC1101TAS1401IST1801DAC3: ${target}`);
  const iso = (dm) => `2027-${dm.slice(2)}-${dm.slice(0, 2)}`;
  const dates = [m[1], m[2], m[3], m[4]].map(iso);
  for (let i = 1; i < dates.length; i += 1) assert.ok(dates[i] > dates[i - 1], `leg ${i + 1} after leg ${i}: ${dates}`);
  // changing the length re-prices without using another search
  const used = env.DB.raw.prepare("SELECT searches FROM usage WHERE key = 'u88'").get().searches;
  await post(env, tap('d:mn:9', U, C));
  assert.match(lastText(log), /9 nights/);
  assert.equal(env.DB.raw.prepare("SELECT searches FROM usage WHERE key = 'u88'").get().searches, used);
  assert.ok(buttons(res).some((b) => b.text?.startsWith('🎒 Pack:')), 'packing picks for a cold trip');
  assert.ok(log.tp.some((q) => q.origin === 'FRU' || q.destination === 'FRU'), 'Bishkek retried with its old code FRU');
});

test('answering "Where to?" with countries or unknown places never loops', async () => {
  const log = installFetch();
  const env = makeEnv({ AI: { run: async () => ({ response: '{}' }) } }); // the AI finds no place either
  await onboard(env);
  await post(env, privateMsg('Me and 2 friends, 2nd week of January, 7 days, backpackers', U));
  assert.match(lastText(log), /Where would you like to go/);
  await post(env, privateMsg('Uzbekistan, Kyrgyzstan and Turkmenistan', U));
  assert.match(lastText(log), /Here's your trip/);
  assert.match(lastText(log), /3 people/, 'kept the group from the first message');
  await post(env, privateMsg('/plan', U)); // a fresh trip (with a card open, this message would edit it)
  await post(env, privateMsg('Me and 2 friends in January', U));
  await post(env, privateMsg('Xqzzyland', U));
  assert.match(lastText(log), /couldn't find "Xqzzyland"/);
  await post(env, privateMsg('Uzbekistan', U));
  assert.match(lastText(log), /Uzbekistan, nice choice! Which part\?/);
  assert.ok(buttons(lastSent(log)).some((b) => b.callback_data === 'd:dest:TAS'));
  await post(env, privateMsg('tbilisi in may', U));
  assert.match(lastText(log), /Tbilisi \(TBS\)/);
});

test('family with no head count: Maya guesses 2 adults + 1 child and asks', async () => {
  const log = installFetch();
  const env = makeEnv();
  await onboard(env);
  await post(env, privateMsg('family trip to Bangkok in December', U));
  let t = lastText(log);
  assert.match(t, /Family with kids · 2 adults, 1 child <i>\(my guess/);
  assert.ok(buttons(lastSent(log)).some((b) => b.callback_data === 'd:ad:3'));
  await post(env, tap('d:ch:2', U, C));
  t = lastText(log);
  assert.match(t, /2 adults, 2 children/);
  assert.doesNotMatch(t, /my guess/);
});

test('official travel advice is pulled automatically and shown with a link', async () => {
  const log = installFetch();
  const env = makeEnv({ AMAZON_TAG_COM: 'citywide-20' });
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  await onboard(env);
  await post(env, privateMsg('Dhaka to Bangkok in December', U));
  await post(env, tap('d:go', U, C));
  { const c = ctx(); await worker.scheduled({ cron: '*/30 * * * *' }, env, c); await c.done(); }
  assert.ok(log.news.includes('/foreign-travel-advice/thailand.atom'));
  await post(env, privateMsg('/latest', U));
  const t = lastText(log);
  assert.match(t, /📰 <b>Thailand<\/b> \(UK FCDO travel advice, \d+ \w+\): Information on Severe Flooding/);
  assert.match(t, /<a href="https:\/\/www\.gov\.uk\/foreign-travel-advice\/thailand">Read more<\/a>/);
  assert.match(t, /Open Government Licence/);
  // a second search shows the update under results
  await post(env, tap('d:go', U, C));
  const res = lastSent(log);
  assert.match(res.body.text, /📰 <b>Thailand<\/b>/);
  // trip-tailored packing picks → your own page, Amazon links only there
  const gear = buttons(res).find((b) => b.text?.startsWith('🎒 Pack:'));
  assert.ok(gear);
  assert.match(gear.text, /Universal travel adapter/);
  assert.match(gear.url, /\/gear\?c=BD&dc=TH&d=Bangkok&i=/);
  const c = ctx();
  const page = await (await worker.fetch(new Request(gear.url), env, c)).text();
  assert.match(page, /For your trip to Bangkok/);
  assert.match(page, /Thailand|type A, B, C, O/);
  assert.match(page, /tag=citywide-20/);
  assert.match(page, /As an Amazon Associate/);
  // emails never carry Amazon links
  assert.ok(!log.emails.some((e) => /amazon\./.test(e.html)));
});
