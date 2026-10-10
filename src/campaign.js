// Campaign state: roster, progression, requisition, persistence.

import { WEAPONS, ARMORS, GEAR, SKILLS, SOLDIER_NAMES, SQUAD_COLORS, xpForLevel, meetsReq } from './data.js';
import { MISSIONS } from './missions.js';

const SAVE_KEY = 'recubation.save.v1';
export const GEAR_SLOTS = 2;

export function newCampaign() {
  const names = [...SOLDIER_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return { mission: 0, rp: 0, squad: [], fallen: [], names, nextId: 1, complete: false };
}

export function currentMission(state) { return MISSIONS[state.mission] || null; }

function recruit(state) {
  // Replacements arrive one level behind the squad average so they are not dead weight.
  const avg = state.squad.length ? state.squad.reduce((n, s) => n + s.level, 0) / state.squad.length : 1;
  const level = Math.max(1, Math.floor(avg) - 1);
  const id = state.nextId++;
  const s = {
    id, name: state.names[(id - 1) % state.names.length], color: SQUAD_COLORS[(id - 1) % SQUAD_COLORS.length],
    level, xp: level > 1 ? xpForLevel(level - 1) : 0, sp: (level - 1) * 2,
    skills: { light: 0, heavy: 0, tech: 0, medic: 0, vitality: 0, reflexes: 0 },
    weapon: 'carbine', armor: 'none', gear: new Array(GEAR_SLOTS).fill(null),
    kills: 0, missions: 0,
  };
  state.squad.push(s);
  return s;
}

// Top the roster up to what the next mission needs. Returns the new arrivals.
export function reinforce(state) {
  const m = currentMission(state);
  const fresh = [];
  while (m && state.squad.length < m.squad) fresh.push(recruit(state));
  return fresh;
}

export function applyResult(state, summary) {
  const mission = currentMission(state);
  const report = { win: summary.win, text: summary.text, turns: summary.turns, reward: 0, rows: [] };
  if (!summary.win) return report;
  const bonus = 10 + 5 * state.mission;
  for (const r of summary.marines) {
    const s = state.squad.find(q => q.id === r.id);
    if (!s) continue;
    const row = { soldier: s, kills: r.kills, alive: r.alive, xp: 0, levels: 0 };
    s.kills += r.kills;
    s.missions++;
    if (r.alive) {
      row.xp = r.xp + bonus;
      s.xp += row.xp;
      while (s.xp >= xpForLevel(s.level)) { s.level++; s.sp += 2; row.levels++; }
    }
    report.rows.push(row);
  }
  for (const row of report.rows) {
    if (row.alive) continue;
    state.squad = state.squad.filter(s => s !== row.soldier);
    state.fallen.push({ name: row.soldier.name, level: row.soldier.level, kills: row.soldier.kills, mission: mission.name });
    // Their kit goes back to stores.
    state.rp += loadoutValue(row.soldier);
  }
  report.reward = mission.reward;
  state.rp += mission.reward;
  state.mission++;
  if (state.mission >= MISSIONS.length) state.complete = true;
  return report;
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
  if (!meetsReq(s.skills, def.req)) return 'Not qualified';
  const delta = def.cost - (old ? table[old].cost : 0);
  if (delta > state.rp) return 'Not enough requisition';
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
    return s && Array.isArray(s.squad) ? s : null;
  } catch { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}
