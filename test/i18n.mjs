// Dictionary check: every language covers every string the game shows, with the
// same placeholders and every plural form its grammar needs. No browser needed.
//
//   node test/i18n.mjs          check all languages
//   node test/i18n.mjs --keys   print the English strings, one JSON array

import { readFileSync, readdirSync } from 'node:fs';
import { LANGS } from '../src/i18n.js';
import { tableStrings } from '../src/locale.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const lit = s => s.replace(/\\(.)/g, '$1');
const STR = String.raw`'((?:[^'\\]|\\.)*)'`;

function sourceStrings() {
  const keys = new Set(tableStrings());
  for (const f of readdirSync(new URL('src/', root)).filter(f => f.endsWith('.js'))) {
    const src = read('src/' + f);
    // t('…') and tr('…')
    for (const m of src.matchAll(new RegExp(String.raw`\btr?\(` + STR, 'g'))) keys.add(lit(m[1]));
    // t(cond ? '…' : '…')
    for (const m of src.matchAll(new RegExp(String.raw`\btr?\([^'()]*\?\s*` + STR + String.raw`\s*:\s*` + STR + String.raw`\s*\)`, 'g'))) {
      keys.add(lit(m[1])); keys.add(lit(m[2]));
    }
    // the help screen's [key, action] rows
    if (f === 'ui.js') for (const m of src.matchAll(new RegExp(String.raw`\[` + STR + ', ' + STR + String.raw`\]`, 'g'))) {
      keys.add(lit(m[1])); keys.add(lit(m[2]));
    }
  }
  for (const m of read('index.html').matchAll(/data-i18n(?:-title)?="([^"]*)"/g)) keys.add(m[1]);
  keys.add('Muted'); // set by Tactical.mute()
  return keys;
}

const keys = sourceStrings();
if (process.argv.includes('--keys')) {
  console.log(JSON.stringify([...keys], null, 1));
  process.exit(0);
}

const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
let problems = 0;
const fail = (lang, msg) => { problems++; console.log(`  ${lang}: ${msg}`); };

console.log(`Checking ${Object.keys(LANGS).length - 1} translations against ${keys.size} strings`);
for (const lang of Object.keys(LANGS).filter(l => l !== 'en')) {
  const dict = (await import(`../src/lang/${lang}.js`)).default;
  // Counts in the game are whole numbers, so only the forms those can select are required.
  const rules = new Intl.PluralRules(lang);
  const forms = new Set(Array.from({ length: 1001 }, (_, n) => rules.select(n)));
  for (const k of keys) {
    const v = dict[k];
    if (v == null) {
      // Bare key names such as 'R' or 'Q / E' may stay as they are.
      if (!/[A-Za-z]{2,}/.test(k)) continue;
      fail(lang, `missing ${JSON.stringify(k)}`);
      continue;
    }
    const variants = typeof v === 'object' ? Object.entries(v) : [['', v]];
    if (typeof v === 'object') {
      for (const f of forms) if (!(f in v)) fail(lang, `${JSON.stringify(k)} lacks plural form "${f}"`);
    }
    for (const [form, s] of variants) {
      if (typeof s !== 'string' || !s) { fail(lang, `${JSON.stringify(k)} ${form} is empty`); continue; }
      if (holes(s) !== holes(k)) fail(lang, `${JSON.stringify(k)} ${form} has placeholders {${holes(s)}}, expected {${holes(k)}}`);
    }
  }
  for (const k of Object.keys(dict)) if (!keys.has(k)) fail(lang, `unused ${JSON.stringify(k)}`);
}
if (problems) { console.log(`${problems} problem(s)`); process.exit(1); }
console.log('All translations complete');
