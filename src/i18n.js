// Translation. Source strings are written in English and double as lookup keys:
// t('Out of range') returns the current language's version, or the English one
// when a translation is missing. Placeholders look like {name}. A dictionary
// entry may be an object of plural forms ({ one, few, many, other }) chosen by
// the `n` parameter under the language's own plural rules.

export const LANGS = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
  pl: 'Polski',
  zh: '简体中文',
  ja: '日本語',
};

const KEY = 'recubation.lang';

// English only needs entries for strings that change with a count.
const EN = {
  '{n} hostiles': { one: '{n} hostile', other: '{n} hostiles' },
  'Opens in {n} turns': { one: 'Opens in {n} turn', other: 'Opens in {n} turns' },
  '{n} turns remain': { one: '{n} turn remains', other: '{n} turns remain' },
  'Survive {n} turns': { one: 'Survive {n} turn', other: 'Survive {n} turns' },
  '{objective} within {n} turns': { one: '{objective} within {n} turn', other: '{objective} within {n} turns' },
  'Completed in {n} turns.': { one: 'Completed in {n} turn.', other: 'Completed in {n} turns.' },
  'Final tally: {n} hostiles destroyed.': { one: 'Final tally: {n} hostile destroyed.', other: 'Final tally: {n} hostiles destroyed.' },
  '{n} troopers came home; {names} did not.': { one: '{n} trooper came home; {names} did not.', other: '{n} troopers came home; {names} did not.' },
  '{n} troopers came home, every one of them.': { one: '{n} trooper came home, every one of them.', other: '{n} troopers came home, every one of them.' },
};

let lang = 'en';
let dict = EN;
let rules = new Intl.PluralRules('en');

export const currentLang = () => lang;

export function t(text, params) {
  let s = dict[text] ?? EN[text] ?? text;
  if (typeof s === 'object') s = s[rules.select(params && params.n != null ? params.n : 0)] ?? s.other;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m)) : s;
}

// The language picked by hand, or null to follow the browser.
export function savedLang() {
  try {
    const v = localStorage.getItem(KEY);
    return v in LANGS ? v : null;
  } catch { return null; }
}

export function browserLang() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  for (const l of (nav && (nav.languages || [nav.language])) || []) {
    const base = String(l).toLowerCase().split('-')[0];
    if (base in LANGS) return base;
  }
  return 'en';
}

// code null = follow the browser from now on.
export async function setLang(code, remember = false) {
  if (remember) {
    try { code ? localStorage.setItem(KEY, code) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  }
  let next = code || browserLang();
  try {
    dict = next === 'en' ? EN : (await import(`./lang/${next}.js`)).default;
  } catch (e) {
    console.warn(`Could not load language "${next}", using English.`, e);
    next = 'en';
    dict = EN;
  }
  lang = next;
  rules = new Intl.PluralRules(next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

export function initLang() { return setLang(savedLang()); }
