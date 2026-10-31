// Version 4.3: replays the 31 Oct screenshots. Editing the open trip card by chat,
// "go" runs it, the owner has no limits, multi-city as one ticket, more price markets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, installFetch, ctx, privateMsg, tap, lastSent } from './harness.js';
import { editDraft, groupLabel } from '../src/bot.js';
import { chooseLegs } from '../src/multi.js';

const BASE = 'https://citywide-trip-planner.example.workers.dev';
async function post(env, update) {
  const c = ctx();
  await worker.fetch(new Request(`${BASE}/tg`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET }, body: JSON.stringify(update) }), env, c);
  await c.done();
}
const buttons = (m) => (m?.body?.reply_markup?.inline_keyboard || []).flat();
const lastText = (log) => lastSent(log).body.text;

async function rafat(env, { id = 999, persona = 'family' } = {}) {
  const U = { id, first_name: 'Rafat' };
  const C = { id, type: 'private' };
  { const c = ctx(); await worker.fetch(new Request(`${BASE}/setup?key=${env.SETUP_KEY}`), env, c); }
  for (const u of [privateMsg('/start', U), tap('set:name:tg', U, C), tap('set:home:DAC', U, C), tap('set:pp:BD', U, C), tap('set:ppdone', U, C),
    tap('set:visadone', U, C), privateMsg(`r${id}@example.com`, U), privateMsg('Skip', U), tap('set:mk:1', U, C), tap(`set:p:${persona}`, U, C)]) await post(env, u);
  return { U, C };
}

test('parser and edits: "1 adult only no children" is one adult, not a family', () => {
  const now = new Date('2026-10-31T10:00:00Z');
  const prev = { origin: 'DAC', destination: 'TAS', depart: { type: 'date', value: '2027-01-11' }, ret: { type: 'date', value: '2027-01-13' }, flex: '3d', adults: 1, children: 1, persona: 'family', paxGuess: true };
  const d = editDraft(prev, '1 adult only no children.', { now, home: 'DAC', currency: 'bdt' });
  assert.equal(d.adults, 1);
  assert.equal(d.children, 0);
  assert.equal(d.paxGuess, undefined);
  assert.equal(groupLabel(d), 'Solo');
  assert.equal(groupLabel({ adults: 1, children: 0, persona: 'family' }), 'Solo', 'never "Family with kids · 1 person"');
  assert.equal(editDraft(prev, 'one way', { now, home: 'DAC' }).oneWay, true);
  const dates = editDraft(prev, '15 to 20 january', { now, home: 'DAC' });
  assert.equal(dates.depart.value, '2027-01-15');
  assert.equal(dates.ret.value, '2027-01-20');
  assert.equal(dates.flex, 'exact');
  assert.equal(editDraft({ ...prev, flex: 'exact' }, 'flexible dates', { now, home: 'DAC' }).flex, '3d');
  assert.equal(editDraft(prev, 'Dhaka to Bangkok in March', { now, home: 'DAC' }), null, 'a new place = a new trip');
});

test('the screenshots: edit by chat, "go" searches, the owner is never limited', async () => {
  const log = installFetch();
  const env = makeEnv({ ADMIN_IDS: '999', NEW_SEARCHES_PER_DAY: '1' });
  const { U, C } = await rafat(env);

  await post(env, privateMsg('Dhaka to Tashkent 2nd week of january', U));
  let card = lastText(log);
  assert.match(card, /Dhaka \(DAC\) ⇄ Tashkent \(TAS\)/);
  assert.match(card, /± 3 days/, 'a week, not a day: flexible');

  await post(env, privateMsg('1 adult only no children.', U));
  card = lastText(log);
  assert.match(card, /^Updated ✅/);
  assert.match(card, /Tashkent \(TAS\)/, 'kept the trip');
  assert.match(card, /Solo · 1 person/);
  assert.doesNotMatch(card, /Where would you like to go/);

  await post(env, privateMsg('one way', U));
  assert.match(lastText(log), /one way/);

  for (let i = 0; i < 4; i += 1) {
    await post(env, privateMsg('go', U));
    assert.doesNotMatch(lastText(log), /Where would you like to go|You've used today/, `owner search ${i + 1} ran`);
  }
  assert.match(lastText(log), /Dhaka → Tashkent|don't have recent prices/);
  // Central Asia routes: the regional market is asked straight away, alongside the default
  assert.ok(log.tp.some((q) => q.destination === 'TAS' && q.market === 'ru'), 'asked the ru market');
});

test('multi-city: Uzbekistan and Turkey, one-ticket search, stays keep their nights, airline names', async () => {
  const log = installFetch();
  const env = makeEnv({ ADMIN_IDS: '1' });
  const { U, C } = await rafat(env, { id: 77, persona: 'friends' });
  await post(env, privateMsg('how about me with 2 friends on 2nd week of january any dates. 7 days total trip to Uzbekistan and Turkey. Backpackers.', U));
  const card = lastText(log);
  assert.match(card, /Dhaka → Tashkent → Istanbul → Dhaka/);
  assert.match(card, /Backpacker \/ budget · 3 people/);
  await post(env, tap('d:mgo', U, C));
  const res = lastSent(log);
  console.log(`\n---- multi result ----\n${res.body.text}\n----------------------`);
  assert.match(res.body.text, /Best way to book/);
  const whole = buttons(res).find((b) => b.text.startsWith('🔎 Whole route as one ticket'));
  const target = env.DB.raw.prepare('SELECT url FROM links WHERE id = ?').get(whole.url.split('/go/')[1]).url;
  const m = target.match(/\/search\/DAC(\d{4})TAS(\d{4})IST(\d{4})DAC3\?marker=/);
  assert.ok(m, target);
  const dates = [m[1], m[2], m[3]].map((dm) => `2027-${dm.slice(2)}-${dm.slice(0, 2)}`);
  const gap = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  assert.ok(gap(dates[0], dates[1]) >= 2 && gap(dates[1], dates[2]) >= 2, `each stop keeps at least 2 of its 3 nights: ${dates}`);
});

test('leg chooser: cheapest day near the plan, never squeezing a stay', () => {
  const legs = [{ from: 'DAC', to: 'TAS', date: '2027-01-11' }, { from: 'TAS', to: 'IST', date: '2027-01-14' }, { from: 'IST', to: 'DAC', date: '2027-01-17' }];
  const f = (d, p) => ({ departure_at: `${d}T10:00:00+05:00`, price: p });
  const cands = [
    { items: [f('2027-01-09', 300), f('2027-01-11', 250)], cur: 'usd' },
    { items: [f('2027-01-12', 90), f('2027-01-15', 120)], cur: 'usd' }, // the 12th would leave 1 night in Tashkent
    { items: [], cur: 'usd' },
  ];
  const out = chooseLegs(legs, cands, { window: 3, nightsPer: [3, 3], minNights: 2 });
  assert.equal(out[0].leg.date, '2027-01-11');
  assert.equal(out[1].leg.date, '2027-01-15', 'skipped the too-early cheap day');
  assert.equal(out[2].leg.date, '2027-01-18', 'no price: planned nights after the last leg');
});

test('AI understands replies to the open card (free model), and can use Claude when a key is set', async () => {
  const log = installFetch();
  const seen = [];
  const AI = { run: async (model, { messages }) => {
    seen.push({ model, user: messages[1].content });
    const msg = messages[1].content;
    if (/one more person/.test(msg)) return { response: '{"intent":"edit","adults":5}', usage: { prompt_tokens: 900, completion_tokens: 10, total_tokens: 910 } };
    if (/show me prices/.test(msg)) return { response: '{"intent":"go"}', usage: { prompt_tokens: 900, completion_tokens: 6, total_tokens: 906 } };
    return { response: '{"intent":"other"}' };
  } };
  const env = makeEnv({ AI, AI_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' }); // old setting: upgraded automatically
  const { U } = await rafat(env, { id: 55, persona: 'friends' });
  await post(env, privateMsg('Me and 3 friends, Dhaka to Bangkok, December', U));
  await post(env, privateMsg('can we squeeze one more person in', U));
  assert.match(lastText(log), /^Updated ✅/);
  assert.match(lastText(log), /5 people/);
  assert.match(seen.at(-1).user, /^Current trip: DAC → BKK, 2026-12/, 'the AI sees the open trip');
  assert.equal(seen.at(-1).model, '@cf/meta/llama-4-scout-17b-16e-instruct');
  await post(env, privateMsg('sounds good, show me prices', U));
  assert.match(lastText(log), /Here's what I found|don't have recent prices/);
  const n = env.DB.raw.prepare("SELECT SUM(value) AS v FROM counters WHERE name = 'ai_neurons'").get().v;
  assert.ok(n > 0 && n < 100, `Neurons counted: ${n}`);

  // Claude (paid, optional): same job through the Anthropic API
  const log2 = installFetch();
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    const u = String(typeof input === 'string' ? input : input.url);
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(opts.body);
      log2.claude = body;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"intent":"edit","adults":2,"children":0}' }], usage: { input_tokens: 800, output_tokens: 12 } }));
    }
    return real(input, opts);
  };
  const env2 = makeEnv({ AI_MODEL: 'claude-haiku-5-5', ANTHROPIC_API_KEY: 'sk-test' });
  const r = await rafat(env2, { id: 56, persona: 'friends' });
  await post(env2, privateMsg('Me and 3 friends, Dhaka to Bangkok, December', r.U));
  await post(env2, privateMsg('two of the guys dropped out sadly', r.U));
  globalThis.fetch = real;
  assert.equal(log2.claude.model, 'claude-haiku-5-5');
  assert.match(lastSent(log2).body.text, /2 people/);
});
