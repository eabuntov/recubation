// Static game data: weapons, armor, gear, skills, hostile species.
// Everything here is plain data so the rules engine and the UI can share it.

export const DIRS = [
  { x: 0, y: -1, name: 'N' },
  { x: 1, y: 0, name: 'E' },
  { x: 0, y: 1, name: 'S' },
  { x: -1, y: 0, name: 'W' },
];

export const BAYONET = { id: 'bayonet', name: 'Bayonet', ap: 3, dmg: 4, ammo: 0, heat: 0, pattern: 'melee' };

// pattern: single = one target, units block the shot
//          line   = everything along the beam is hit
//          blast  = target tile plus the eight tiles around it (half damage)
export const WEAPONS = {
  carbine: {
    name: 'SC-4 Carbine', cost: 0, req: {}, range: 6, ammo: 6, maxHeat: 8, cool: 4,
    desc: 'Standard issue. A small magazine, but it swaps fast.',
    modes: [{ name: 'Single', ap: 3, dmg: 3, ammo: 1, heat: 2, pattern: 'single' }],
  },
  twin: {
    name: 'SC-4D Twin Carbine', cost: 30, req: { light: 1 }, range: 6, ammo: 12, maxHeat: 9, cool: 4, reloadAp: 4,
    desc: 'Two barrels on one frame. The double tap hits hard, runs hot, and takes twice as long to reload.',
    modes: [
      { name: 'Single', ap: 3, dmg: 3, ammo: 1, heat: 2, pattern: 'single' },
      { name: 'Double', ap: 4, dmg: 7, ammo: 2, heat: 4, pattern: 'single' },
    ],
  },
  scatter: {
    name: 'Breacher Scattergun', cost: 40, req: { light: 1 }, range: 4, ammo: 10, maxHeat: 8, cool: 4,
    desc: 'Devastating at arm\'s length, a rumour at four tiles.',
    modes: [{ name: 'Blast', ap: 3, dmg: 9, falloff: [[1.5, 9], [3.2, 6], [99, 3]], ammo: 1, heat: 3, pattern: 'single' }],
  },
  sg5: {
    name: 'SG-5 Assault Shotgun', cost: 45, req: { heavy: 1 }, range: 4, ammo: 1, maxHeat: 6, cool: 3,
    desc: 'One fat shell per doorway. Everyone huddled beside the target catches a pellet too.',
    modes: [{ name: 'Single', ap: 4, dmg: 7, ammo: 1, heat: 3, pattern: 'single', splash: 1 }],
  },
  sg6: {
    name: 'SG-6 Double Shotgun', cost: 60, req: { heavy: 2 }, range: 4, ammo: 2, maxHeat: 7, cool: 3, reloadPerRound: 1,
    desc: 'Two barrels, reloaded as you fire: one spent shell swaps for 1 AP, both for 2.',
    modes: [
      { name: 'Single', ap: 4, dmg: 7, ammo: 1, heat: 2, pattern: 'single', splash: 1 },
      { name: 'Doublet', ap: 4, dmg: 14, ammo: 2, heat: 4, pattern: 'single', splash: 1 },
    ],
  },
  rifle: {
    name: 'AR-9 Assault Rifle', cost: 65, req: { light: 2 }, range: 7, ammo: 30, maxHeat: 10, cool: 4,
    desc: 'The workhorse of every boarding action since the Belt Wars.',
    modes: [
      { name: 'Single', ap: 3, dmg: 5, ammo: 1, heat: 2, pattern: 'single' },
      { name: 'Burst', ap: 4, dmg: 10, ammo: 3, heat: 5, pattern: 'single' },
    ],
  },
  marksman: {
    name: 'LR-7 Marksman Rifle', cost: 70, req: { light: 3 }, range: 14, ammo: 8, maxHeat: 8, cool: 4,
    desc: 'One round, one problem solved. Slow to cycle.',
    modes: [{ name: 'Aimed', ap: 4, dmg: 13, ammo: 1, heat: 4, pattern: 'single' }],
  },
  autocannon: {
    name: 'HMG-2 Autocannon', cost: 80, req: { heavy: 1 }, range: 8, ammo: 32, maxHeat: 12, cool: 5,
    desc: 'Belt-fed and bad-tempered. Sustained fire will cook the barrel.',
    modes: [
      { name: 'Burst', ap: 4, dmg: 11, ammo: 4, heat: 5, pattern: 'single' },
      { name: 'Sustained', ap: 6, dmg: 21, ammo: 8, heat: 9, pattern: 'single' },
    ],
  },
};

export const ARMORS = {
  none: { name: 'Fatigues', cost: 0, req: {}, hp: 0, reduce: 0, desc: 'Better than nothing. Barely.' },
  vest: { name: 'Flak Vest', cost: 20, req: {}, hp: 4, reduce: 0, desc: '+4 health.' },
  shell: { name: 'Combat Shell', cost: 50, req: {}, hp: 8, reduce: 0, desc: '+8 health.' },
  bulwark: { name: 'Bulwark Plate', cost: 95, req: { heavy: 1 }, hp: 10, reduce: 1, desc: '+10 health, every hit hurts 1 less.' },
  aegis: { name: 'Aegis Plate', cost: 130, req: { heavy: 2 }, hp: 12, reduce: 2, desc: '+12 health, every hit hurts 2 less.' },
};

// kind: passive gear modifies stats, active gear adds a button on the action bar.
export const GEAR = {
  medkit: { name: 'Medkit', cost: 25, req: { medic: 1 }, charges: 2, ap: 2, active: 'heal', desc: 'Heal yourself or an adjacent trooper for 5, +3 per Medic level. 2 uses.' },
  jump: { name: 'Jump Pack', cost: 60, req: { tech: 1 }, charges: 3, ap: 2, active: 'jump', range: 3, desc: 'Leap up to 3 tiles over troops and crates, onto any level. 3 uses.' },
  stim: { name: 'Combat Stim', cost: 20, req: {}, charges: 1, ap: 0, active: 'stim', desc: '+3 action points right now. Single use.' },
  mag: { name: 'Spare Magazine', cost: 15, req: {}, charges: 1, ap: 1, active: 'reload', desc: 'Fully reloads your weapon. Single use.' },
  mine: { name: 'Proximity Mine', cost: 35, req: { traps: 1 }, charges: 2, ap: 2, active: 'mine', range: 3, desc: 'Throw an armed mine up to 3 tiles. It goes off the moment a hostile steps on it — everything next to it bleeds, friendlies included. 2 uses.' },
  smoke: { name: 'Smoke Canister', cost: 25, req: { traps: 1 }, charges: 2, ap: 1, active: 'smoke', range: 4, desc: 'Pop a 3×3 smoke cloud on a tile for two turns. Nothing sees through it, in either direction. 2 uses.' },
  turret: { name: 'Auto-Turret', cost: 90, req: { traps: 2 }, charges: 1, ap: 3, active: 'turret', desc: 'Deploy a sentry gun on an adjacent tile: 6 rounds, range 5. It watches your back during the enemy phase; the brood will smash it.' },
  // Under-barrel support weapons: slung under the rifle, so the trooper keeps
  // shooting while carrying them, and each charge is one shot.
  incinerator: {
    name: 'Under-barrel Flamethrower', cost: 70, req: { heavy: 2 }, charges: 4, ap: 4, active: 'jet', range: 3,
    mode: { name: 'Jet', dmg: 8, pattern: 'line', pierce: true, fx: 'flame' },
    desc: 'A tongue of burning gel under the barrel. Scorches a short line, armour or no armour, and keeps your rifle free. 4 uses.',
  },
  launcher: {
    name: 'Under-barrel Grenade Launcher', cost: 90, req: { heavy: 2 }, charges: 3, ap: 5, active: 'shell', range: 7, minRange: 2,
    mode: { name: 'Shell', dmg: 10, pattern: 'blast', pierce: true, arc: true, fx: 'shell' },
    desc: 'Lobs a shell onto any tile in reach, over heads if need be — including your own people in the blast. 3 uses.',
  },
  servo: { name: 'Servo Harness', cost: 70, req: { tech: 2 }, apBonus: 1, desc: '+1 action point every turn.' },
  coolant: { name: 'Coolant Sleeve', cost: 35, req: { tech: 1 }, coolBonus: 2, desc: 'Weapon sheds 2 extra heat per turn.' },
  scope: { name: 'Rangefinder', cost: 30, req: { light: 1 }, rangeBonus: 2, desc: '+2 weapon range.' },
  targeter: { name: 'Marksman Optic', cost: 45, req: { light: 2 }, rangeBonus: 3, desc: '+3 weapon range.' },
};

export const SKILLS = {
  light: { name: 'Light Arms', max: 3, cost: l => l, desc: 'Qualifies for carbines, rifles and optics.' },
  heavy: { name: 'Heavy Arms', max: 3, cost: l => l, desc: 'Qualifies for support weapons and plate armour.' },
  tech: { name: 'Equipment', max: 3, cost: l => l, desc: 'Qualifies for jump packs, coolant sleeves and servo harnesses.' },
  medic: { name: 'Medicine', max: 3, cost: l => l, desc: 'Qualifies for medkits; each level heals +3.' },
  knives: { name: 'Knives', max: 3, cost: l => l, desc: 'The bayonet bites deeper: +2 damage per level, and level 3 stabs cost 1 AP less.' },
  traps: { name: 'Traps', max: 3, cost: l => l, desc: 'Qualifies for mines and smoke canisters; level 2 for auto-turrets.' },
  vitality: { name: 'Vitality', max: 3, cost: () => 1, desc: '+2 maximum health per level.' },
  reflexes: { name: 'Reflexes', max: 3, cost: () => 3, desc: '+1 action point per level.' },
};

export const RANKS = ['Recruit', 'Private', 'Lance', 'Corporal', 'Sergeant', 'Lieutenant', 'Captain', 'Major'];

// Troopers of one rank share one colour, on the board and in the HUD, so the
// pecking order reads at a glance. Promotions re-tint between missions; the
// per-soldier colour a save carries is kept but no longer displayed.
export const RANK_COLORS = [0x9aa7b0, 0x7fd18b, 0x4fc3f7, 0x4dd0c4, 0xffb74d, 0xba68c8, 0xf06292, 0xffd54f];
export const rankColor = level => RANK_COLORS[Math.min(RANK_COLORS.length, Math.max(1, level)) - 1];
export const xpForLevel = level => 14 * level * (level + 1); // total xp needed to reach level+1

export const BASE_HP = 14;

// Every fire mode costs 1 AP more than moving a tile, and troopers get a 7th
// point to spend: a turn spent repositioning now buys real ground, and
// waiting in one room for the brood is what the turn limit punishes.
export const BASE_AP = 7;

// What swapping a fresh magazine costs, for any weapon (see Battle.reload).
// A weapon def may override this with its own `reloadAp`.
export const RELOAD_AP = 2;

// Weapons folded into other roles or cut from the arsenal. A save that still
// carries one is refunded its price and reissued the standard carbine (see
// sanitize in campaign.js).
export const RETIRED_WEAPONS = { incinerator: 70, launcher: 90, lance: 140, rail: 160 };

// How far a trooper spots hostiles, whatever their gun's reach. At 25 tiles
// the whole level is within sight on paper: what hides an enemy is a wall, a
// corner or a smoke cloud, never the distance. The brood's own senses stay
// short (see ALERT) — the asymmetry is the point of limited vision.
export const SIGHT = 25;

// The brood's own fog of war: it hunts by sight and sound, not omniscience.
// sense is how far an alien sees along a clear line, hearing how far gunfire
// carries through walls, spread how far a sighting is shouted to the brood
// around the spotter — one hop only. Keep these SHORT: on a 20-tile map a
// hearing of 9 means the first shot wakes the whole level, and the far rooms
// must stay calm for the fog of war to mean anything.
export const ALERT = { sense: 8, hearing: 5, spread: 4 };

// How far a hostile that spots the squad passes the position on to the brood
// around it — a campaign-start option. 0 means they never call to each other.
export const CALL_RADII = [0, 2, 4, 6, 8];

// Campaign difficulty. Aliens are built from these numbers in Battle.addAlien;
// the requisition multiplier is applied in applyResult.
// countMul multiplies how many hostiles every mission fields: placed map
// aliens are cloned in place, and every hatch releases countMul per wave.
export const DIFFICULTIES = {
  normal: {
    name: 'Normal', hpMul: 1, apBonus: 0, countMul: 2, spawnExtra: 0, rpMul: 1, aiPenalty: 1, aiFocus: 1,
    desc: 'The campaign as intended. A failed mission is a simulation run; the squad lives to try again.',
  },
  hard: {
    name: 'Hard', hpMul: 1.15, apBonus: 1, countMul: 2, spawnExtra: 4, rpMul: 0.85, aiPenalty: 2, aiFocus: 2,
    desc: 'Tougher broods: more health, more action points, relentless hatches, thinner rewards.',
  },
  ironman: {
    name: 'Ironman', hpMul: 1.15, apBonus: 1, countMul: 2, spawnExtra: 4, rpMul: 0.85, aiPenalty: 2, aiFocus: 2, ironman: true,
    desc: 'As Hard, and a failed mission costs every trooper deployed on it. There are no simulations down here.',
  },
};

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

// Sentry gun fielded by the turret gear (built in Battle.addTurret).
export const TURRET = { hp: 8, rounds: 6, range: 5, dmg: 4 };

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
