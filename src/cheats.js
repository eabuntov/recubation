// Secret cheat codes for testing the campaign. Type them anywhere, letter by
// letter; they are documented only here and appear nowhere in the manual.
//   salvage — +1000 requisition
//   veteran — +1000 XP to every trooper (levels resolve immediately)
//   arsenal — best weapon, armour and gear every trooper is qualified for, free

import { WEAPONS, ARMORS, GEAR, meetsReq } from './data.js';
import { grantXp } from './campaign.js';

// The most expensive entry of a table the trooper is qualified for.
function bestFor(table, s) {
  let best = null;
  for (const id in table) {
    if (!meetsReq(s.skills, table[id].req)) continue;
    if (!best || table[id].cost > table[best].cost) best = id;
  }
  return best;
}

const CHEATS = {
  salvage(state) { state.rp += 1000; return '+1000 RP'; },
  veteran(state) { for (const s of state.squad) grantXp(state, s, 1000); return 'Veterancy granted'; },
  arsenal(state) {
    for (const s of state.squad) {
      const w = bestFor(WEAPONS, s), a = bestFor(ARMORS, s);
      if (w) s.weapon = w;
      if (a) s.armor = a;
      for (let i = 0; i < s.gear.length; i++) {
        const g = bestFor(GEAR, s);
        if (g) s.gear[i] = g;
      }
    }
    return 'Arsenal issued';
  },
};

export function initCheats({ getState, save, toast, redraw }) {
  let buffer = '';
  window.addEventListener('keydown', e => {
    if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;
    buffer = (buffer + e.key.toLowerCase()).slice(-12);
    for (const code in CHEATS) {
      if (!buffer.endsWith(code)) continue;
      buffer = '';
      const state = getState();
      if (!state) return;
      const note = CHEATS[code](state);
      save(state);
      toast(note);
      redraw();
    }
  });
}
