// Static game data: weapons, armor, gear, skills, hostile species.
// Everything here is plain data so the rules engine and the UI can share it.

export const DIRS = [
  { x: 0, y: -1, name: 'N' },
  { x: 1, y: 0, name: 'E' },
  { x: 0, y: 1, name: 'S' },
  { x: -1, y: 0, name: 'W' },
];

export const BAYONET = { id: 'bayonet', name: 'Bayonet', ap: 2, dmg: 4, ammo: 0, heat: 0, pattern: 'melee' };

// pattern: single = one target, units block the shot
//          line   = everything along the beam is hit
//          blast  = target tile plus the eight tiles around it (half damage)
export const WEAPONS = {
  carbine: {
    name: 'SC-4 Carbine', cost: 0, req: {}, range: 6, ammo: 20, maxHeat: 8, cool: 4,
    desc: 'Standard issue. Reliable, forgiving, unremarkable.',
    modes: [{ name: 'Single', ap: 2, dmg: 3, ammo: 1, heat: 2, pattern: 'single' }],
  },
  twin: {
    name: 'SC-4D Twin Carbine', cost: 30, req: { light: 1 }, range: 6, ammo: 24, maxHeat: 9, cool: 4,
    desc: 'Two barrels on one frame. The double tap hits hard but runs hot.',
    modes: [
      { name: 'Single', ap: 2, dmg: 3, ammo: 1, heat: 2, pattern: 'single' },
      { name: 'Double', ap: 3, dmg: 7, ammo: 2, heat: 4, pattern: 'single' },
    ],
  },
  scatter: {
    name: 'Breacher Scattergun', cost: 40, req: { light: 1 }, range: 4, ammo: 10, maxHeat: 8, cool: 4,
    desc: 'Devastating at arm\'s length, a rumour at four tiles.',
    modes: [{ name: 'Blast', ap: 2, dmg: 9, falloff: [[1.5, 9], [3.2, 6], [99, 3]], ammo: 1, heat: 3, pattern: 'single' }],
  },
  rifle: {
    name: 'AR-9 Assault Rifle', cost: 65, req: { light: 2 }, range: 7, ammo: 30, maxHeat: 10, cool: 4,
    desc: 'The workhorse of every boarding action since the Belt Wars.',
    modes: [
      { name: 'Single', ap: 2, dmg: 5, ammo: 1, heat: 2, pattern: 'single' },
      { name: 'Burst', ap: 3, dmg: 10, ammo: 3, heat: 5, pattern: 'single' },
    ],
  },
  marksman: {
    name: 'LR-7 Marksman Rifle', cost: 70, req: { light: 3 }, range: 14, ammo: 8, maxHeat: 8, cool: 4,
    desc: 'One round, one problem solved. Slow to cycle.',
    modes: [{ name: 'Aimed', ap: 3, dmg: 13, ammo: 1, heat: 4, pattern: 'single' }],
  },
  autocannon: {
    name: 'HMG-2 Autocannon', cost: 80, req: { heavy: 1 }, range: 8, ammo: 32, maxHeat: 12, cool: 5,
    desc: 'Belt-fed and bad-tempered. Sustained fire will cook the barrel.',
    modes: [
      { name: 'Burst', ap: 3, dmg: 11, ammo: 4, heat: 5, pattern: 'single' },
      { name: 'Sustained', ap: 5, dmg: 21, ammo: 8, heat: 9, pattern: 'single' },
    ],
  },
  incinerator: {
    name: 'Furnace Incinerator', cost: 70, req: { heavy: 1 }, range: 3, ammo: 12, maxHeat: 10, cool: 4,
    desc: 'A tongue of burning gel. Scorches everything in a line and ignores armour.',
    modes: [{ name: 'Jet', ap: 3, dmg: 8, ammo: 2, heat: 5, pattern: 'line', pierce: true, fx: 'flame' }],
  },
  launcher: {
    name: 'GL-3 Launcher', cost: 90, req: { heavy: 2 }, range: 7, minRange: 2, ammo: 6, maxHeat: 8, cool: 4,
    desc: 'Lobs a fragmentation shell over heads. Mind the blast radius.',
    modes: [{ name: 'Shell', ap: 4, dmg: 10, ammo: 1, heat: 4, pattern: 'blast', pierce: true, arc: true, fx: 'shell' }],
  },
  lance: {
    name: 'PL-1 Plasma Lance', cost: 140, req: { heavy: 2, tech: 2 }, range: 9, ammo: 6, maxHeat: 10, cool: 4,
    desc: 'Prototype. Burns a hole through everything between you and the far wall.',
    modes: [{ name: 'Beam', ap: 4, dmg: 18, ammo: 1, heat: 8, pattern: 'line', pierce: true, fx: 'plasma' }],
  },
};

export const ARMORS = {
  none: { name: 'Fatigues', cost: 0, req: {}, hp: 0, reduce: 0, desc: 'Better than nothing. Barely.' },
  vest: { name: 'Flak Vest', cost: 20, req: {}, hp: 4, reduce: 0, desc: '+4 health.' },
  shell: { name: 'Combat Shell', cost: 50, req: {}, hp: 8, reduce: 0, desc: '+8 health.' },
  bulwark: { name: 'Bulwark Plate', cost: 95, req: { heavy: 1 }, hp: 10, reduce: 1, desc: '+10 health, every hit hurts 1 less.' },
};

// kind: passive gear modifies stats, active gear adds a button on the action bar.
export const GEAR = {
  medkit: { name: 'Medkit', cost: 25, req: { medic: 1 }, charges: 2, ap: 2, active: 'heal', desc: 'Heal yourself or an adjacent trooper for 5, +3 per Medic level. 2 uses.' },
  jump: { name: 'Jump Pack', cost: 60, req: { tech: 1 }, charges: 3, ap: 2, active: 'jump', range: 3, desc: 'Leap up to 3 tiles over anything, onto any level. 3 uses.' },
  stim: { name: 'Combat Stim', cost: 20, req: {}, charges: 1, ap: 0, active: 'stim', desc: '+3 action points right now. Single use.' },
  mag: { name: 'Spare Magazine', cost: 15, req: {}, charges: 1, ap: 1, active: 'reload', desc: 'Fully reloads your weapon. Single use.' },
  servo: { name: 'Servo Harness', cost: 70, req: { tech: 2 }, apBonus: 1, desc: '+1 action point every turn.' },
  coolant: { name: 'Coolant Sleeve', cost: 35, req: { tech: 1 }, coolBonus: 2, desc: 'Weapon sheds 2 extra heat per turn.' },
  scope: { name: 'Rangefinder', cost: 30, req: { light: 1 }, rangeBonus: 2, desc: '+2 weapon range.' },
};

export const SKILLS = {
  light: { name: 'Light Arms', max: 3, cost: l => l, desc: 'Qualifies for carbines, rifles and optics.' },
  heavy: { name: 'Heavy Arms', max: 3, cost: l => l, desc: 'Qualifies for support weapons and plate armour.' },
  tech: { name: 'Technician', max: 3, cost: l => l, desc: 'Qualifies for jump packs, servos and prototypes.' },
  medic: { name: 'Field Medic', max: 3, cost: l => l, desc: 'Qualifies for medkits; each level heals +3.' },
  vitality: { name: 'Vitality', max: 5, cost: () => 1, desc: '+2 maximum health per level.' },
  reflexes: { name: 'Reflexes', max: 2, cost: () => 3, desc: '+1 action point per level.' },
};

export const RANKS = ['Recruit', 'Private', 'Lance', 'Corporal', 'Sergeant', 'Lieutenant', 'Captain', 'Major'];
export const xpForLevel = level => 12 * level * (level + 1); // total xp needed to reach level+1

export const BASE_HP = 14;
export const BASE_AP = 6;

export const ALIENS = {
  skitter: {
    name: 'Skitter', hp: 6, ap: 5, xp: 5, scale: 0.8,
    melee: { ap: 2, dmg: 3 },
    desc: 'Fast, fragile, never alone.',
  },
  spitter: {
    name: 'Spitter', hp: 8, ap: 4, xp: 8, scale: 0.9,
    melee: { ap: 2, dmg: 2 },
    ranged: { ap: 2, dmg: 3, range: 5, perTurn: 1 },
    skirmisher: true,
    desc: 'Hangs back and spits acid along any clear line.',
  },
  carapace: {
    name: 'Shellback', hp: 14, ap: 4, xp: 15, scale: 1.15,
    melee: { ap: 2, dmg: 6 },
    frontArmor: 'immune',
    desc: 'Its frontal plate shrugs off bullets. Hit it from the side or behind, or burn it.',
  },
  bloater: {
    name: 'Bloater', hp: 5, ap: 5, xp: 8, scale: 0.9,
    explode: { dmg: 7, radius: 1 },
    desc: 'A walking sac of volatile gas. Bursts when it reaches you, or when it dies.',
  },
  stalker: {
    name: 'Stalker', hp: 10, ap: 8, xp: 12, scale: 1.0,
    melee: { ap: 2, dmg: 4 },
    desc: 'Crosses a room before you can turn around.',
  },
  behemoth: {
    name: 'Matriarch', hp: 70, ap: 4, xp: 60, scale: 1.7,
    melee: { ap: 2, dmg: 9 },
    ranged: { ap: 2, dmg: 5, range: 6, perTurn: 1 },
    frontArmor: 'half',
    desc: 'The heart of the nest. Frontal hits do half damage.',
  },
};

export const SOLDIER_NAMES = [
  'Vega', 'Okafor', 'Lindqvist', 'Marrow', 'Tanaka', 'Reyes', 'Kowal', 'Idris', 'Brandt', 'Solano',
  'Petrov', 'Achebe', 'Nakai', 'Dufresne', 'Halloran', 'Moreau', 'Zielinski', 'Castellan', 'Ibarra', 'Quist',
];

export const SQUAD_COLORS = [0x4fc3f7, 0xffb74d, 0xaed581, 0xf06292, 0xba68c8, 0xfff176];

export function meetsReq(skills, req) {
  for (const k in req) if ((skills[k] || 0) < req[k]) return false;
  return true;
}

export function reqText(req) {
  const parts = Object.keys(req).map(k => `${SKILLS[k].name} ${req[k]}`);
  return parts.length ? parts.join(', ') : '';
}
