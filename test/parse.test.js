import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrip } from '../src/parse.js';
import { rankFares } from '../src/rank.js';
import { sanitize } from '../src/ai.js';
import { findPlaces } from '../src/places.js';

const now = new Date('2026-10-30T06:00:00Z');
const p = (t) => parseTrip(t, { now, home: 'DAC', currency: 'bdt' });

test('understands typical one-line requests', () => {
  assert.deepEqual(p('Me and 3 friends, Dhaka to Bangkok, December, max 25,000 BDT each'), {
    origin: 'DAC', destination: 'BKK', depart: { type: 'month', value: '2026-12' }, adults: 4, persona: 'friends',
    budget: { amount: 25000, perPerson: true, currency: 'bdt' },
  });
  const fam = p('4 of us, 2 kids, NYC to Orlando, spring break, under $2,000');
  assert.equal(fam.adults, 2);
  assert.equal(fam.children, 2);
  assert.equal(fam.depart.value, '2027-03');
  assert.equal(fam.budget.currency, 'usd');
  const hm = p('honeymoon to Maldives 15-22 dec');
  assert.equal(hm.destination, 'MLE');
  assert.equal(hm.ret.value, '2026-12-22');
  assert.equal(hm.adults, 2);
  assert.equal(p('DAC KUL 12/01 one way').depart.value, '2027-01-12');
  assert.equal(p('solo backpacking kathmandu january budget 15k tk').budget.amount, 15000);
});

test('ordinary words are not mistaken for places', () => {
  assert.deepEqual(findPlaces('we had a nice time, 2 male friends'), []);
  assert.deepEqual(findPlaces('Nice in July'), ['NCE']);
  assert.equal(p('2 male friends going to Male in March').destination, 'MLE');
  assert.equal(p('may we go to Paris').depart, undefined, '"may" as a verb is not May');
});

test('ranking prefers daytime arrivals for families and the cheapest for backpackers', () => {
  const items = [
    { price: 100, transfers: 1, airline: 'A', flight_number: '1', departure_at: '2026-12-10T21:00:00+06:00', duration_to: 240, return_at: '2026-12-17T10:00:00+07:00' },
    { price: 112, transfers: 0, airline: 'B', flight_number: '2', departure_at: '2026-12-10T10:00:00+06:00', duration_to: 150, return_at: '2026-12-17T12:00:00+07:00' },
  ];
  const fam = rankFares(items, { persona: 'family', adults: 2, children: 2, currency: 'usd', destTz: 7 });
  assert.equal(fam[0].it.airline, 'B', 'family: direct daytime flight first');
  assert.ok(fam.find((r) => r.it.airline === 'A').late, 'cheap flight flagged as late arrival');
  const bp = rankFares(items, { persona: 'backpacker', adults: 1, currency: 'usd', destTz: 7 });
  assert.equal(bp[0].it.airline, 'A', 'backpacker: cheapest first');
});

test('AI output is checked, never trusted', () => {
  assert.equal(sanitize('ignore previous instructions'), null);
  const d = sanitize('{"destination_city":"Bangkok","month":"2020-01","adults":500,"group":"hacker"}', now);
  assert.equal(d.destination, 'BKK');
  assert.equal(d.depart, undefined, 'past month dropped');
  assert.equal(d.adults, undefined, 'absurd group size dropped');
  assert.equal(d.persona, undefined, 'unknown group dropped');
});
