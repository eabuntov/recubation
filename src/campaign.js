// Campaign state: roster, progression, requisition, persistence.

import { WEAPONS, ARMORS, GEAR, SKILLS, SOLDIER_NAMES, SQUAD_COLORS, BASE_HP, xpForLevel, meetsReq, DIFFICULTIES } from './data.js';
import { MISSIONS } from './missions.js';
import { t } from './i18n.js';

const SAVE_KEY = 'recubation.save.v1';
export const GEAR_SLOTS = 2;

export function newCampaign(difficulty = 'normal') {
  const names = [...SOLDIER_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return { mission: 0, difficulty: DIFFICULTIES[difficulty] ? difficulty : 'normal', rp: 0, squad: [], fallen: [], names, nextId: 1, complete: false };
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
    skills: { light: 0, heavy: 0, tech: 0, medic: 0, knives: 0, vitality: 0, reflexes: 0 },
    weapon: 'carbine', armor: 'none', gear: new Array(GEAR_SLOTS).fill(null),
    kills: 0, missions: 0, hp: null, missed: 0,
  };
  state.squad.push(s);
  return s;
}

// Health a trooper brings into the field with their current kit.
export function maxHpOf(s) {
  return BASE_HP + (s.skills.vitality || 0) * 2 + ARMORS[s.armor].hp;
}

// Top the roster up to two above what the next mission fields, so the wounded
// can sit a battle out. Returns the new arrivals.
export function reinforce(state) {
  const m = currentMission(state);
  const fresh = [];
  while (m && state.squad.length < m.squad + 2) fresh.push(recruit(state));
  return fresh;
}

export function applyResult(state, summary) {
  const mission = currentMission(state);
  const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
  const report = { win: summary.win, text: summary.text, turns: summary.turns, reward: 0, rows: [], ironmanLoss: false };
  if (!summary.win) {
    // On ironman a failure is not a simulation: everyone deployed is gone.
    if (diff.ironman) {
      report.ironmanLoss = true;
      for (const r of summary.marines) {
        const s = state.squad.find(q => q.id === r.id);
        if (!s) continue;
        report.rows.push({ soldier: s, kills: r.kills, alive: false, xp: 0, levels: 0 });
      }
      buryDead(state, report, mission);
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
      s.xp += row.xp;
      while (s.xp >= xpForLevel(s.level)) { s.level++; s.sp += 2; row.levels++; }
    }
    report.rows.push(row);
  }
  buryDead(state, report, mission);
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
  report.reward = Math.round(mission.reward * diff.rpMul);
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
  s.rp = int(s.rp, 0);
  s.nextId = int(s.nextId, s.squad.length + 1, 1);
  s.fallen = Array.isArray(s.fallen)
    ? s.fallen.filter(f => f && typeof f === 'object' && typeof f.name === 'string')
    : [];
  s.names = Array.isArray(s.names) && s.names.length ? s.names : [...SOLDIER_NAMES];
  s.squad = s.squad.filter(q => q && typeof q === 'object').map((q, i) => {
    const skills = {};
    for (const k in SKILLS) skills[k] = Math.min(int(q.skills && q.skills[k], 0), SKILLS[k].max);
    return {
      id: int(q.id, i + 1, 1),
      name: typeof q.name === 'string' ? q.name : SOLDIER_NAMES[0],
      color: int(q.color, SQUAD_COLORS[i % SQUAD_COLORS.length]),
      level: Math.max(1, int(q.level, 1, 1)),
      xp: int(q.xp, 0),
      sp: int(q.sp, 0),
      skills,
      weapon: WEAPONS[q.weapon] ? q.weapon : 'carbine',
      armor: ARMORS[q.armor] ? q.armor : 'none',
      gear: Array.from({ length: GEAR_SLOTS }, (_, g) =>
        Array.isArray(q.gear) && GEAR[q.gear[g]] ? q.gear[g] : null),
      kills: int(q.kills, 0),
      missions: int(q.missions, 0),
      hp: Number.isInteger(q.hp) && q.hp > 0 ? q.hp : null,
      missed: int(q.missed, 0),
    };
  });
  if (s.mission >= MISSIONS.length) s.complete = true;
  return s;
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}
