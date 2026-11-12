// Applies the current language to the shared data tables and the static page.
// The tables keep their English text on the side so switching back and forth is lossless.

import { t } from './i18n.js';
import { WEAPONS, ARMORS, GEAR, SKILLS, ALIENS, RANKS, BAYONET, DIFFICULTIES } from './data.js';
import { MISSIONS } from './missions.js';

const originals = new Map();

function apply(obj, fields) {
  if (!originals.has(obj)) originals.set(obj, Object.fromEntries(fields.map(f => [f, obj[f]])));
  const en = originals.get(obj);
  for (const f of fields) obj[f] = Array.isArray(en[f]) ? en[f].map(s => t(s)) : t(en[f]);
}

const RANKS_EN = [...RANKS];

export function localize() {
  for (const table of [WEAPONS, ARMORS, GEAR, SKILLS, ALIENS]) {
    for (const def of Object.values(table)) apply(def, ['name', 'desc']);
  }
  for (const def of Object.values(DIFFICULTIES)) apply(def, ['name', 'desc']);
  for (const w of Object.values(WEAPONS)) for (const m of w.modes) apply(m, ['name']);
  apply(BAYONET, ['name']);
  RANKS_EN.forEach((r, i) => { RANKS[i] = t(r); });
  for (const m of MISSIONS) apply(m, ['name', 'brief', 'tips']);

  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

// Every English string the tables hold, for the dictionary check in the tests.
export function tableStrings() {
  const out = new Set();
  const add = v => (Array.isArray(v) ? v : [v]).forEach(s => out.add(s));
  for (const table of [WEAPONS, ARMORS, GEAR, SKILLS, ALIENS]) {
    for (const def of Object.values(table)) { add(def.name); add(def.desc); }
  }
  for (const def of Object.values(DIFFICULTIES)) { add(def.name); add(def.desc); }
  for (const w of Object.values(WEAPONS)) for (const m of w.modes) add(m.name);
  add(BAYONET.name);
  RANKS_EN.forEach(add);
  for (const m of MISSIONS) { add(m.name); add(m.brief); add(m.tips); }
  return out;
}
