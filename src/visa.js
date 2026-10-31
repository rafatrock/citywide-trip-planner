// Visa ease for the traveller's passport(s), including visas they already hold.
// Base data is from Jan 2025 (see visa-data.js); newer checked facts override it.
// Every answer reminds people to confirm on the official government site.

import { VISA_DEST, VISA_TABLE, VISA_AS_OF } from './visa-data.js';
import { SCHENGEN, countryName } from './countries.js';

// Newer, checked facts that override the Jan 2025 dataset. ADD CORRECTIONS HERE.
// Format: passport: { destination: letter }  (letters are listed in visa-data.js)
// BD: Henley Passport Index summaries, July 2026 (Wego, Gulf News);
//     Thailand e-visa for Bangladeshis since 2 Jan 2025 (UNB, thaievisa.go.th).
const OVERRIDES = {
  BD: { MV: 'A', NP: 'A', KH: 'A', BT: 'A', LK: 'T', TH: 'E' },
};

const LEVEL = { H: 0, F: 1, A: 2, T: 3, E: 4, V: 5, N: 6, '?': 7 };
export const TEXT = {
  H: 'your own country',
  F: 'no visa needed',
  A: 'visa on arrival',
  T: 'online travel authorisation before you fly',
  E: 'e-visa (apply online before you fly)',
  V: 'visa needed from the embassy (apply weeks ahead)',
  N: 'entry currently not allowed for this passport',
  '?': 'unknown, please check',
};

export const KNOWN_PASSPORTS = Object.keys(VISA_TABLE);

function code(passport, destCc) {
  if (passport === destCc) return 'H';
  const o = OVERRIDES[passport]?.[destCc];
  if (o) return o;
  const i = VISA_DEST.indexOf(destCc);
  const row = VISA_TABLE[passport];
  return i >= 0 && row ? row[i] : '?';
}

// Visas/residence permits people commonly hold, and which destinations they cover.
export const HELD_VISAS = {
  US: { label: 'US visa', covers: ['US'] },
  GB: { label: 'UK visa', covers: ['GB'] },
  SCH: { label: 'Schengen visa', covers: SCHENGEN },
  CA: { label: 'Canada visa', covers: ['CA'] },
  AU: { label: 'Australia visa', covers: ['AU'] },
  JP: { label: 'Japan visa', covers: ['JP'] },
  AE: { label: 'UAE residence', covers: ['AE'] },
};

// Best (easiest) entry across all the traveller's passports and held visas.
export function visaFor(passports = [], heldVisas = [], destCc) {
  if (!destCc || !passports.length) return null;
  for (const v of heldVisas) {
    if (HELD_VISAS[v]?.covers.includes(destCc)) {
      return { code: 'F', text: `covered by your ${HELD_VISAS[v].label} (check it is still valid for your dates)`, passport: null, held: v };
    }
  }
  let best = null;
  for (const p of passports) {
    const c = code(p, destCc);
    if (!best || LEVEL[c] < LEVEL[best.code]) best = { code: c, text: TEXT[c], passport: p };
  }
  return best;
}

export const isEasy = (v) => v && ['H', 'F', 'A', 'T'].includes(v.code);
export const needsEmbassy = (v) => v && (v.code === 'V' || v.code === 'N');

export function visaLine(v, destCc) {
  if (!v) return `🛂 Check the visa rules for ${countryName(destCc)} before you book.`;
  if (v.code === 'H') return '';
  const who = v.passport ? ` with your ${countryName(v.passport)} passport` : '';
  return `🛂 ${countryName(destCc)}${who}: ${v.text}. <i>(Based on data from ${v.passport && OVERRIDES[v.passport]?.[destCc] ? 'mid-2026' : VISA_AS_OF}; always confirm on the official government site.)</i>`;
}
