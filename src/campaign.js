// Campaign state: roster, progression, requisition, persistence.

import { WEAPONS, ARMORS, GEAR, SKILLS, SOLDIER_NAMES, SQUAD_COLORS, BASE_HP, xpForLevel, meetsReq, DIFFICULTIES, CALL_RADII, ALERT, RETIRED_WEAPONS, CLONE } from './data.js';
import { MISSIONS } from './missions.js';
import { t } from './i18n.js';

const SAVE_KEY = 'recubation.save.v1';
export const GEAR_SLOTS = 2;

export function newCampaign(difficulty = 'normal', limitedVision = false, callRadius = ALERT.spread) {
  const names = [...SOLDIER_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const state = { mission: 0, difficulty: DIFFICULTIES[difficulty] ? difficulty : 'normal', limitedVision: !!limitedVision, callRadius: CALL_RADII.includes(callRadius) ? callRadius : ALERT.spread, rp: 0, squad: [], fallen: [], names, nextId: 1, complete: false, clone: null, maps: {} };
  // The standing strength: five slots, or whatever a mission fields if it
  // fields more. The bench is not asked for — it fills on its own.
  const size = Math.max(5, MISSIONS[0] ? MISSIONS[0].squad : 4);
  for (let i = 0; i < size; i++) recruit(state);
  return state;
}

export function currentMission(state) { return MISSIONS[state.mission] || null; }

// How every interface lists the roster: highest level first, experience
// breaking ties. Display only — the squad array keeps its own order.
export const byLevel = (a, b) => b.level - a.level || b.xp - a.xp;

function recruit(state) {
  // Replacements arrive one level behind the squad average so they are not dead weight.
  const avg = state.squad.length ? state.squad.reduce((n, s) => n + s.level, 0) / state.squad.length : 1;
  const level = Math.max(1, Math.floor(avg) - 1);
  const id = state.nextId++;
  const s = {
    id, name: state.names[(id - 1) % state.names.length], color: SQUAD_COLORS[(id - 1) % SQUAD_COLORS.length],
    level, xp: level > 1 ? xpForLevel(level - 1) : 0, sp: (level - 1) * 2,
    skills: Object.fromEntries(Object.keys(SKILLS).map(k => [k, 0])),
    weapon: 'carbine', armor: 'none', gear: new Array(GEAR_SLOTS).fill(null),
    kills: 0, missions: 0, hp: null, missed: 0, contract: 0,
  };
  state.squad.push(s);
  return s;
}

// Health a trooper brings into the field with their current kit.
export function maxHpOf(s) {
  return BASE_HP + (s.skills.vitality || 0) * 2 + ARMORS[s.armor].hp;
}

// Replacements no longer wait to be asked for: whenever the roster runs short
// of the standing strength, the drop ship sends another body — green, a level
// behind the squad average. Returns the fresh faces, for the NEW badges.
export function topUp(state) {
  const m = currentMission(state);
  const size = Math.max(5, m ? m.squad : 4);
  const fresh = [];
  while (state.squad.length < size) fresh.push(recruit(state));
  return fresh;
}

// Contract economy. Past the fifth level a trooper fights only as long as
// their contract holds: renewing buys three missions ahead, a mission fought
// burns one, and a rested bench burns nothing. An unpaid trooper warms the
// bench until command pays up or lets them go.
export const CONTRACT_FREE_LEVEL = 5;
export const CONTRACT_RUN = 3;

export function contractDue(s) { return s.level > CONTRACT_FREE_LEVEL && (s.contract || 0) <= 0; }

export function contractPrice(s) {
  return Math.max(0, s.level * 5 - 5 * (s.skills.economy || 0));
}

export function payContract(state, s) {
  const price = contractPrice(s);
  if (state.rp < price) return t('Not enough requisition');
  state.rp -= price;
  s.contract = (s.contract || 0) + CONTRACT_RUN;
  return null;
}

// A demobilized trooper hands in their kit at full price and walks; the drop
// ship already has their replacement strapped in.
export function demobilize(state, s) {
  state.rp += loadoutValue(s);
  state.squad = state.squad.filter(q => q !== s);
  state.fallen.push({ name: s.name, level: s.level, kills: s.kills, mission: t('Demobilized') });
  topUp(state);
}

// The clone: bought once for the campaign, then leased per drop. It fields
// as a tenth of a trooper on paper and a whole extra body on the board.
export function buyClone(state) {
  if (state.clone) return t('Only one clone at a time');
  if (state.rp < CLONE.cost) return t('Not enough requisition');
  state.rp -= CLONE.cost;
  state.clone = { paid: false, weapon: 'carbine', gear: new Array(GEAR_SLOTS).fill(null) };
  return null;
}

export function payClone(state) {
  if (!state.clone || state.clone.paid) return null;
  if (state.rp < CLONE.fee) return t('Not enough requisition');
  state.rp -= CLONE.fee;
  state.clone.paid = true;
  return null;
}

// What the clone looks like to the rules engine for one drop. Its prod hits
// harder the deeper the campaign goes; nothing else about it ever changes.
export function cloneDrop(state) {
  return {
    clone: true, id: CLONE.id, name: t('Clone'), level: 1, xp: 0, sp: 0,
    skills: {}, weapon: state.clone.weapon, armor: 'none', gear: state.clone.gear,
    hp: CLONE.hp, missed: 0, prodDmg: CLONE.prod(state.mission),
  };
}

// A live view of the clone for the armoury: gear writes straight through (the
// array is shared), the weapon is written back by the caller after a swap.
// It is rated for everything — the vat did not skip the handling course.
export function cloneView(state) {
  return {
    clone: true, id: CLONE.id, name: t('Clone'), level: 1, xp: 0, sp: 0,
    skills: { light: 3, heavy: 3, tech: 3, medic: 0, knives: 0, traps: 3 },
    weapon: state.clone.weapon, armor: 'none', gear: state.clone.gear,
    kills: 0, missions: 0,
  };
}

// XP cash-in shared by mission debriefs (and, quietly, by the debug cheats):
// levels resolve immediately, each one paying two skill points.
export function grantXp(state, s, n) {
  s.xp += n;
  let levels = 0;
  while (s.xp >= xpForLevel(s.level)) { s.level++; s.sp += 2; levels++; }
  return levels;
}

export function applyResult(state, summary) {
  const mission = currentMission(state);
  const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
  const report = { win: summary.win, text: summary.text, turns: summary.turns, reward: 0, rows: [], ironmanLoss: false };
  if (!summary.win) {
    // Escrow: the drop fee rides through the battle, so a lost mission hands
    // it back - the vat got paid for a drop that never happened. On ironman
    // the hardware is still gone; only the money comes home.
    if (state.clone && summary.marines.some(r => r.id === CLONE.id)) {
      state.rp += CLONE.fee;
      state.clone.paid = false;
      report.cloneRefund = CLONE.fee;
    }
    // On ironman a failure is not a simulation: everyone deployed is gone.
    if (diff.ironman) {
      report.ironmanLoss = true;
      for (const r of summary.marines) {
        const s = state.squad.find(q => q.id === r.id);
        if (!s) continue;
        report.rows.push({ soldier: s, kills: r.kills, alive: false, xp: 0, levels: 0 });
      }
      buryDead(state, report, mission);
      // A real wipe takes the leased hardware down with the squad.
      if (state.clone && summary.marines.some(r => r.id === CLONE.id && !r.alive)) state.clone = null;
    }
    return report;
  }
  const bonus = 10 + 5 * state.mission;
  for (const r of summary.marines) {
    const s = state.squad.find(q => q.id === r.id);
    if (!s) continue;
    const row = { soldier: s, kills: r.kills, alive: r.alive, xp: 0, levels: 0, hp: r.hp };
    s.kills += r.kills;
    s.missions++;
    if (r.alive) {
      row.xp = r.xp + bonus;
      row.levels = grantXp(state, s, row.xp);
      // One mission fought, one mission off the contract.
      if (s.contract > 0) s.contract--;
    }
    report.rows.push(row);
  }
  buryDead(state, report, mission);
  // The clone is hardware: a simulation failure puts it back in its bay, a
  // won mission simply bills the next drop.
  if (state.clone && summary.marines.some(r => r.id === CLONE.id && !r.alive)) state.clone = null;
  // Escrow settled: a won mission rendered the service, fee or no fee.
  if (state.clone && summary.marines.some(r => r.id === CLONE.id)) state.clone.paid = false;
  // Wounds carry over: survivors keep whatever they walked out with, and
  // everyone heals a quarter of their maximum health per mission boundary —
  // plus another quarter for every mission they sat out on the bench.
  for (const s of state.squad) {
    const row = report.rows.find(r => r.soldier === s && r.alive);
    if (row) { s.hp = row.hp; s.missed = 0; }
    else s.missed = (s.missed || 0) + 1;
    const max = maxHpOf(s);
    const now = s.hp == null ? max : Math.min(s.hp, max);
    s.hp = Math.min(max, now + Math.round(max / 4) * (1 + (s.missed || 0)));
  }
  // Quartermasters trained in Economy scrape extra requisition out of every
  // win: their own level per skill level, on top of the mission reward — and
  // whatever cash the squad carried off the level. A lost mission pays
  // nothing, simulation or not; on a real wipe nobody is left to carry it.
  const eco = report.rows.reduce((n, r) => n + (r.alive ? r.soldier.level * (r.soldier.skills.economy || 0) : 0), 0);
  report.cash = summary.cash || 0;
  report.reward = Math.round(mission.reward * diff.rpMul) + eco + report.cash;
  state.rp += report.reward;
  state.mission++;
  if (state.mission >= MISSIONS.length) state.complete = true;
  return report;
}

function buryDead(state, report, mission) {
  for (const row of report.rows) {
    if (row.alive) continue;
    state.squad = state.squad.filter(s => s !== row.soldier);
    state.fallen.push({ name: row.soldier.name, level: row.soldier.level, kills: row.soldier.kills, mission: mission.name });
    // Their kit goes back to stores.
    state.rp += loadoutValue(row.soldier);
  }
}

export function loadoutValue(s) {
  return WEAPONS[s.weapon].cost + ARMORS[s.armor].cost + s.gear.reduce((n, g) => n + (g ? GEAR[g].cost : 0), 0);
}

export function skillCost(s, id) { return SKILLS[id].cost(s.skills[id] + 1); }

export function canRaise(s, id) { return s.skills[id] < SKILLS[id].max && s.sp >= skillCost(s, id); }

export function raiseSkill(s, id) {
  if (!canRaise(s, id)) return false;
  s.sp -= skillCost(s, id);
  s.skills[id]++;
  return true;
}

// Swapping kit refunds the old item in full, so the price is just the difference.
export function equipProblem(state, s, table, id, old) {
  const def = table[id];
  if (!meetsReq(s.skills, def.req)) return t('Not qualified');
  const delta = def.cost - (old ? table[old].cost : 0);
  if (delta > state.rp) return t('Not enough requisition');
  return null;
}

export function equip(state, s, kind, id, slot = 0) {
  if (kind === 'gear') {
    const old = s.gear[slot];
    if (id === null) { if (old) state.rp += GEAR[old].cost; s.gear[slot] = null; return true; }
    if (equipProblem(state, s, GEAR, id, old)) return false;
    state.rp -= GEAR[id].cost - (old ? GEAR[old].cost : 0);
    s.gear[slot] = id;
    return true;
  }
  const table = kind === 'weapon' ? WEAPONS : ARMORS;
  const old = s[kind];
  if (old === id || equipProblem(state, s, table, id, old)) return false;
  state.rp -= table[id].cost - table[old].cost;
  s[kind] = id;
  return true;
}

export function save(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && Array.isArray(s.squad) ? sanitize(s) : null;
  } catch { return null; }
}

// Saves may come from an older version of the game. Accept whatever shape
// roughly matches and fall back to standard kit for anything unrecognised,
// so an outdated save degrades gracefully instead of crashing mid-campaign.
function sanitize(s) {
  const int = (v, d, lo = 0) => (Number.isInteger(v) && v >= lo ? v : d);
  s.mission = Math.min(int(s.mission, 0), MISSIONS.length);
  s.difficulty = DIFFICULTIES[s.difficulty] ? s.difficulty : 'normal';
  s.limitedVision = !!s.limitedVision;
  s.callRadius = CALL_RADII.includes(s.callRadius) ? s.callRadius : ALERT.spread;
  s.rp = int(s.rp, 0);
  s.nextId = int(s.nextId, s.squad.length + 1, 1);
  s.fallen = Array.isArray(s.fallen)
    ? s.fallen.filter(f => f && typeof f === 'object' && typeof f.name === 'string')
    : [];
  s.names = Array.isArray(s.names) && s.names.length ? s.names : [...SOLDIER_NAMES];
  let refunds = 0;
  s.squad = s.squad.filter(q => q && typeof q === 'object').map((q, i) => {
    const skills = {};
    for (const k in SKILLS) skills[k] = Math.min(int(q.skills && q.skills[k], 0), SKILLS[k].max);
    // Levels bought above a newly lowered cap (Vitality went 6 → 3) come back
    // as the skill points they cost, at their old price of one point each.
    const capped = (q.skills && q.skills.vitality || 0) - skills.vitality;
    // A weapon the arsenal no longer issues goes back to stores at full price.
    if (RETIRED_WEAPONS[q.weapon]) { refunds += RETIRED_WEAPONS[q.weapon]; q = { ...q, weapon: 'carbine' }; }
    return {
      id: int(q.id, i + 1, 1),
      name: typeof q.name === 'string' ? q.name : SOLDIER_NAMES[0],
      color: int(q.color, SQUAD_COLORS[i % SQUAD_COLORS.length]),
      level: Math.max(1, int(q.level, 1, 1)),
      xp: int(q.xp, 0),
      sp: int(q.sp, 0) + Math.max(0, capped),
      skills,
      weapon: WEAPONS[q.weapon] ? q.weapon : 'carbine',
      armor: ARMORS[q.armor] ? q.armor : 'none',
      gear: Array.from({ length: GEAR_SLOTS }, (_, g) =>
        Array.isArray(q.gear) && GEAR[q.gear[g]] ? q.gear[g] : null),
      kills: int(q.kills, 0),
      missions: int(q.missions, 0),
      hp: Number.isInteger(q.hp) && q.hp > 0 ? q.hp : null,
      missed: int(q.missed, 0),
      contract: int(q.contract, CONTRACT_RUN),
    };
  });
  s.rp += refunds;
  // The leased clone: hardware data only. Its drop fee lives in escrow in
  // the paid flag since the fee stopped burning at deploy time, so a save
  // made between paying and the outcome keeps the money banked.
  s.clone = s.clone && typeof s.clone === 'object'
    ? {
        paid: !!s.clone.paid,
        weapon: WEAPONS[s.clone.weapon] ? s.clone.weapon : 'carbine',
        gear: Array.from({ length: GEAR_SLOTS }, (_, g) => Array.isArray(s.clone.gear) && GEAR[s.clone.gear[g]] ? s.clone.gear[g] : null),
      }
    : null;
  // Map rolls per mission (see genmap.js); anything odd resets to none.
  s.maps = s.maps && typeof s.maps === 'object' && !Array.isArray(s.maps) ? s.maps : {};
  if (s.mission >= MISSIONS.length) s.complete = true;
  return s;
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}
