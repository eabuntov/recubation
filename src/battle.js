// Tactical rules engine. No rendering in here: every visible consequence is
// reported through the async `fx` hooks so the same code runs headless in tests.

import { DIRS, WEAPONS, ARMORS, GEAR, ALIENS, BAYONET, BASE_HP, BASE_AP, RELOAD_AP, TURRET, DIFFICULTIES, SIGHT, ALERT, CALL_RADII } from './data.js';
import { t as tr } from './i18n.js';

export const key = (x, y) => x + ',' + y;

// How every interface lists troopers: highest level first, experience breaking
// ties. Display only — spawn slots and turn order stay as deployed.
export const byUnit = (a, b) => b.soldier.level - a.soldier.level || b.soldier.xp - a.soldier.xp;

const NOFX = new Proxy({}, { get: () => async () => {} });

const RAMP_CHARS = { '^': 0, '>': 1, 'v': 2, '<': 3 };
const ALIEN_CHARS = { s: 'skitter', p: 'spitter', k: 'carapace', b: 'bloater', t: 'stalker', M: 'behemoth' };
// Uppercase letters place an elite of the same species: more health, more damage.
const ELITE_CHARS = { S: 'skitter', P: 'spitter', K: 'carapace', B: 'bloater', T: 'stalker' };
const DOOR_FOR_TERMINAL = { T: 'D', U: 'E' };

export function parseMap(mission) {
  const rows = mission.map;
  const w = Math.max(...rows.map(r => r.length));
  const h = rows.length;
  const tiles = [];
  const starts = [], aliens = [], hatches = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const c = rows[y][x] || ' ';
      const t = { x, y, type: 'floor', h: 0, ramp: null, door: null, terminal: null, exit: false, hatch: false, pickup: null };
      if (c === ' ') t.type = 'void';
      else if (c === '#') t.type = 'wall';
      else if (c === '~') t.type = 'pit';
      else if (c === 'c') t.type = 'crate';
      else if (c === ':') t.h = 1;
      else if (c in RAMP_CHARS) { t.type = 'ramp'; t.ramp = RAMP_CHARS[c]; }
      else if (c === 'D' || c === 'E') { t.type = 'door'; t.door = { group: c, open: false }; }
      else if (c in DOOR_FOR_TERMINAL) { t.type = 'terminal'; t.terminal = { group: DOOR_FOR_TERMINAL[c], used: false }; }
      else if (c === 'A') t.pickup = 'ammo';
      else if (c === '+') t.pickup = 'med';
      else if (c === 'X') t.exit = true;
      else if (c === 'H') { t.hatch = true; hatches.push(t); }
      else if (c >= '1' && c <= '9') starts.push({ x, y, slot: +c });
      else if (c in ALIEN_CHARS) aliens.push({ kind: ALIEN_CHARS[c], x, y });
      else if (c in ELITE_CHARS) aliens.push({ kind: ELITE_CHARS[c], x, y, elite: true });
      row.push(t);
    }
    tiles.push(row);
  }
  for (const [x0, y0, x1, y1] of mission.raised || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = tiles[y][x];
      if (t.type !== 'ramp' && t.type !== 'wall' && t.type !== 'void') t.h = 1;
    }
  }
  starts.sort((a, b) => a.slot - b.slot);
  return { w, h, tiles, starts, aliens, hatches };
}

// Tiles strictly between two tile centres. When the line passes exactly through
// a tile corner we emit a `corner` entry naming the two tiles it squeezes between.
export function trace(x0, y0, x1, y1) {
  const out = [];
  const dx = x1 - x0, dy = y1 - y0, sx = Math.sign(dx), sy = Math.sign(dy);
  const adx = Math.abs(dx), ady = Math.abs(dy);
  let x = x0, y = y0, ix = 0, iy = 0, guard = adx + ady + 2;
  while ((x !== x1 || y !== y1) && guard-- > 0) {
    const a = (2 * ix + 1) * ady, b = (2 * iy + 1) * adx;
    if (adx && ady && a === b) {
      out.push({ corner: [[x + sx, y], [x, y + sy]] });
      x += sx; y += sy; ix++; iy++;
    } else if (!ady || (adx && a < b)) { x += sx; ix++; }
    else { y += sy; iy++; }
    if (x !== x1 || y !== y1) out.push({ x, y });
  }
  return out;
}

export class Battle {
  constructor(mission, squad, fx = NOFX, difficulty = 'normal', limitedVision = false, callRadius = ALERT.spread) {
    this.mission = mission;
    this.fx = fx;
    this.diff = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    this.limited = !!limitedVision; // fog of war: only what the squad can see
    // How far a sighting travels mouth to mouth through the brood.
    this.spread = CALL_RADII.includes(callRadius) ? callRadius : ALERT.spread;
    const map = parseMap(mission);
    this.w = map.w; this.h = map.h; this.tiles = map.tiles; this.hatches = map.hatches;
    this.units = [];
    this.nextId = 1;
    this.turn = 0;
    this.phase = 'player';
    this.busy = false;
    this.over = false;
    this.result = null;
    this.announced = false;
    this.countMul = this.diff.countMul || 1;
    this.spawnLeft = mission.spawn ? Math.round(mission.spawn.total * this.countMul) + this.diff.spawnExtra : 0;
    // Hatches hold the rest of the brood back while the map is already crowded:
    // the wave is delayed, not cancelled, so holding still costs something.
    this.maxAlive = (mission.spawn && mission.spawn.maxAlive) || 10;
    this.spawnCount = 0;
    this.engaged = {};        // marine id -> alien attacks against them this phase
    this.shielded = new Set(); // marine ids that already spent their Defence this phase
    this.mines = new Map();   // tile key -> {x, y}: armed, hostile-triggered
    this.smoke = new Map();   // tile key -> turns of cloud left
    this.seen = new Set();    // alien ids currently in some trooper's sight
    this.ghosts = new Map();  // alien id -> tile last seen on (limited vision)
    this.alert = new Map();   // alien id -> tile the brood last saw or heard the squad on
    this._threatCache = null;

    squad.slice(0, map.starts.length).forEach((s, i) => this.addMarine(s, map.starts[i], i));
    for (const a of map.aliens) {
      this.addAlien(a.kind, a.x, a.y, a.elite);
      // The Matriarch is one of a kind; everything else arrives with backup.
      if (a.kind === 'behemoth') continue;
      for (let n = 1; n < this.countMul; n++) {
        const spot = this._freeTileNear(a.x, a.y);
        if (!spot) break;
        this.addAlien(a.kind, spot.x, spot.y, a.elite);
      }
    }
    // The brood starts unaware; facings point wherever, not at the squad.
    for (const a of this.aliens()) a.facing = Math.floor(Math.random() * 4);
  }

  // ---------------------------------------------------------------- setup

  addMarine(s, pos, slot) {
    const wdef = WEAPONS[s.weapon], armor = ARMORS[s.armor];
    const gear = (s.gear || []).filter(Boolean).map(id => ({ id, def: GEAR[id], charges: GEAR[id].charges || 0 }));
    const bonus = k => gear.reduce((n, g) => n + (g.def[k] || 0), 0);
    const maxHp = BASE_HP + (s.skills.vitality || 0) * 2 + armor.hp;
    const maxAp = BASE_AP + (s.skills.reflexes || 0) + bonus('apBonus');
    // Wounds from earlier missions walk in with the trooper; a null hp means
    // untouched, and an out-of-range value (new armour since) clamps.
    const hp = s.hp == null ? maxHp : Math.max(1, Math.min(maxHp, s.hp));
    const u = {
      id: this.nextId++, side: 'marine', kind: 'marine', name: s.name, soldier: s, slot,
      x: pos.x, y: pos.y, facing: this.mission.facing ?? 1,
      hp, maxHp, ap: maxAp, maxAp, alive: true, reduce: armor.reduce, guard: false,
      sight: Math.max(SIGHT, wdef.range) + bonus('rangeBonus'),
      weapon: { id: s.weapon, def: wdef, ammo: wdef.ammo, heat: 0, streak: 0, range: wdef.range + bonus('rangeBonus') + (s.skills.range || 0), cool: wdef.cool + bonus('coolBonus') },
      gear, medic: s.skills.medic || 0, kills: 0, xp: 0,
    };
    this.units.push(u);
    return u;
  }

  // Per-mission scaling and the campaign difficulty bend every alien that
  // enters play, spawned or placed; elites (uppercase map letters) on top.
  addAlien(kind, x, y, elite = false) {
    const def = ALIENS[kind];
    const sc = this.mission.scaling || {};
    const hp = Math.max(1, Math.round(def.hp * (sc.hp || 1) * (elite ? 1.6 : 1) * this.diff.hpMul));
    const ap = Math.max(1, def.ap + (sc.ap || 0) + (elite ? 1 : 0) + this.diff.apBonus);
    const boost = atk => atk && { ...atk, dmg: atk.dmg + (elite ? 2 : 0) };
    const u = {
      id: this.nextId++, side: 'alien', kind, elite,
      name: elite ? tr('Elite {name}', { name: def.name }) : def.name, def,
      x, y, facing: 2, hp, maxHp: hp, ap, maxAp: ap, alive: true, reduce: 0,
      melee: boost(def.melee), ranged: boost(def.ranged),
      xpValue: Math.round(def.xp * (elite ? 2 : 1)),
    };
    this.units.push(u);
    return u;
  }

  // A fielded sentry gun: its own side, so it neither counts as a trooper nor
  // takes orders — it just watches its arc while the brood moves.
  addTurret(x, y) {
    const u = {
      id: this.nextId++, side: 'turret', kind: 'turret', name: tr('Turret'), def: TURRET,
      x, y, facing: 2, hp: TURRET.hp, maxHp: TURRET.hp, ap: 0, maxAp: 0, alive: true, reduce: 0,
      rounds: TURRET.rounds, xpValue: 0,
    };
    this.units.push(u);
    return u;
  }

  // ---------------------------------------------------------------- queries

  marines() { return this.units.filter(u => u.alive && u.side === 'marine'); }
  aliens() { return this.units.filter(u => u.alive && u.side === 'alien'); }
  turrets() { return this.units.filter(u => u.alive && u.side === 'turret'); }

  // Under limited vision a hostile shows only while some trooper holds it in
  // sight range along a clear line; where one was last seen is remembered.
  // Sight is its own sense, longer than any gun's reach: walls and corners
  // hide, distance does not (see SIGHT in data.js).
  updateVision() {
    if (!this.limited) return;
    const visible = new Set();
    for (const a of this.aliens()) {
      const spotted = this.marines().some(m =>
        Math.hypot(a.x - m.x, a.y - m.y) <= m.sight + 0.5 && !this.sightBlocked(m.x, m.y, a.x, a.y));
      if (spotted) { visible.add(a.id); this.ghosts.set(a.id, { x: a.x, y: a.y }); }
    }
    this.seen = visible;
  }

  isVisible(u) { return !this.limited || u.side !== 'alien' || this.seen.has(u.id); }

  // What the HUD counts: everything, or only what the squad can see.
  knownAliens() { return this.limited ? this.aliens().filter(a => this.seen.has(a.id)) : this.aliens(); }
  tile(x, y) { return (x >= 0 && y >= 0 && x < this.w && y < this.h) ? this.tiles[y][x] : null; }
  unitAt(x, y) { return this.units.find(u => u.alive && u.x === x && u.y === y) || null; }
  walkable(t) { return !!t && (t.type === 'floor' || t.type === 'ramp'); }
  blocksSight(x, y) { const t = this.tile(x, y); return !t || t.type === 'wall' || t.type === 'door'; }
  heightAt(x, y) { const t = this.tile(x, y); return !t ? 0 : t.ramp != null ? 0.5 : t.h; }

  edgeH(t, d) {
    if (t.ramp == null) return t.h;
    if (d === t.ramp) return 1;
    if (d === (t.ramp + 2) % 4) return 0;
    return null;
  }

  // Can something on foot cross from (x,y) to its neighbour in direction d? Terrain only.
  stepOk(x, y, d) {
    const a = this.tile(x, y), b = this.tile(x + DIRS[d].x, y + DIRS[d].y);
    if (!this.walkable(a) || !this.walkable(b)) return false;
    const ha = this.edgeH(a, d), hb = this.edgeH(b, (d + 2) % 4);
    return ha !== null && ha === hb;
  }

  // Breadth-first flood. Returns Map key -> {x, y, cost, prev, d}.
  flood(sx, sy, max, { ignoreUnits = false } = {}) {
    const occupied = new Set();
    if (!ignoreUnits) for (const u of this.units) if (u.alive) occupied.add(key(u.x, u.y));
    const start = { x: sx, y: sy, cost: 0, prev: null, d: -1 };
    const out = new Map([[key(sx, sy), start]]);
    const q = [start];
    for (let i = 0; i < q.length; i++) {
      const n = q[i];
      if (n.cost >= max) continue;
      for (let d = 0; d < 4; d++) {
        if (!this.stepOk(n.x, n.y, d)) continue;
        const x = n.x + DIRS[d].x, y = n.y + DIRS[d].y, k = key(x, y);
        if (out.has(k) || occupied.has(k)) continue;
        const nn = { x, y, cost: n.cost + 1, prev: n, d };
        out.set(k, nn);
        q.push(nn);
      }
    }
    return out;
  }

  pathFrom(node) {
    const path = [];
    for (let n = node; n && n.prev; n = n.prev) path.unshift({ x: n.x, y: n.y, d: n.d });
    return path;
  }

  smokeAt(x, y) { return this.smoke.has(key(x, y)); }

  sightBlocked(x0, y0, x1, y1) {
    for (const e of trace(x0, y0, x1, y1)) {
      const opaque = (x, y) => this.blocksSight(x, y) || this.smokeAt(x, y);
      if (e.corner) {
        if (opaque(...e.corner[0]) && opaque(...e.corner[1])) return true;
      } else if (opaque(e.x, e.y)) return true;
    }
    return false;
  }

  // Why a shot from (fx,fy) at (tx,ty) cannot be taken, or null when it can.
  shotProblem(fx, fy, tx, ty, { range, minRange = 0, pattern = 'single', arc = false }, shooter = null) {
    if (pattern === 'melee') {
      const d = DIRS.findIndex(v => fx + v.x === tx && fy + v.y === ty);
      return d >= 0 && this.stepOk(fx, fy, d) ? null : tr('Not adjacent');
    }
    const dist = Math.hypot(tx - fx, ty - fy);
    if (dist === 0) return tr('Invalid target');
    if (dist > range + 0.5) return tr('Out of range');
    if (dist < minRange) return tr('Too close');
    if (this.sightBlocked(fx, fy, tx, ty)) return tr('No line of sight');
    if (pattern === 'single' && !arc && this.heightAt(fx, fy) === this.heightAt(tx, ty)) {
      for (const e of trace(fx, fy, tx, ty)) {
        if (e.corner) continue;
        const u = this.unitAt(e.x, e.y);
        if (u && u !== shooter) return tr('Blocked by {name}', { name: u.name });
      }
    }
    return null;
  }

  inCone(u, x, y) {
    const vx = x - u.x, vy = y - u.y, d = DIRS[u.facing];
    const fwd = vx * d.x + vy * d.y, lat = Math.abs(vx * d.y - vy * d.x);
    return fwd > 0 && lat <= fwd;
  }

  // From which side of `target` does something at (x,y) strike it?
  arc(target, x, y) {
    const vx = x - target.x, vy = y - target.y, d = DIRS[target.facing];
    const fwd = vx * d.x + vy * d.y, lat = Math.abs(vx * d.y - vy * d.x);
    if (fwd > 0 && lat <= fwd) return 'front';
    if (fwd < 0 && lat <= -fwd) return 'rear';
    return 'side';
  }

  dirToward(u, tx, ty) {
    const dx = tx - u.x, dy = ty - u.y;
    if (dx === 0 && dy === 0) return u.facing;
    if (Math.abs(dx) === Math.abs(dy)) {
      const f = DIRS[u.facing];
      if (f.x && Math.sign(dx) === f.x) return u.facing;
      if (f.y && Math.sign(dy) === f.y) return u.facing;
    }
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
    return dy > 0 ? 2 : 0;
  }

  faceNearest(u) {
    const foes = u.side === 'alien' ? this.marines() : this.aliens();
    let best = null, bd = Infinity;
    for (const f of foes) {
      const d = Math.hypot(f.x - u.x, f.y - u.y);
      if (d < bd) { bd = d; best = f; }
    }
    if (best) u.facing = this.dirToward(u, best.x, best.y);
  }

  // A personalised bayonet: the Knives skill sharpens it, and level 3 also
  // quickens the stab. Everyone carries the stock one for free.
  bayonet(u) {
    const lv = (u.soldier && u.soldier.skills && u.soldier.skills.knives) || 0;
    if (!lv) return BAYONET;
    return { ...BAYONET, dmg: BAYONET.dmg + 2 * lv, ap: lv >= 3 ? BAYONET.ap - 1 : BAYONET.ap };
  }

  modes(u) { return [...u.weapon.def.modes, this.bayonet(u)]; }

  // Heat the next shot actually adds. Shots fired without a pause run the
  // barrel hotter: the second costs double, the third triple, so sustained
  // fire now ends in a lockup instead of a steady state. An experienced hand
  // keeps the bursts short and the barrel cool.
  shotHeat(u, mode) {
    const calm = (u.soldier && 1 - 0.25 * (u.soldier.skills.experience || 0)) || 1;
    return mode.heat * (1 + (u.weapon.streak || 0)) * calm;
  }

  // What a fire mode takes out of the magazine. Thrift trims the long bursts;
  // a round is saved at most, never spent from an empty belt.
  modeAmmo(u, mode) {
    if (!mode.ammo || !u.soldier) return mode.ammo || 0;
    const lv = u.soldier.skills.thrift || 0;
    if (!lv) return mode.ammo;
    let n = mode.ammo;
    if (mode.tag === 'burst') n -= 1;
    if (mode.tag === 'sustained') n -= lv >= 3 ? 3 : lv >= 2 ? 2 : 0;
    return Math.max(1, n);
  }

  // Why this marine cannot use this fire mode right now, or null.
  fireProblem(u, mode) {
    if (u.ap < mode.ap) return tr('Not enough AP');
    if (mode.pattern === 'melee') return null;
    if (u.weapon.ammo < this.modeAmmo(u, mode)) return tr('Out of ammo');
    if (u.weapon.heat + this.shotHeat(u, mode) > u.weapon.def.maxHeat) return tr('Weapon too hot');
    return null;
  }

  calcDamage(attacker, target, mode) {
    let dmg = mode.dmg, note = '';
    const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    if (mode.falloff) for (const [r, d] of mode.falloff) if (dist <= r) { dmg = d; break; }
    const acc = (attacker.soldier && attacker.soldier.skills.accuracy) || 0;
    if (acc) dmg += acc;
    if (mode.pattern !== 'melee' && this.heightAt(attacker.x, attacker.y) > this.heightAt(target.x, target.y)) {
      dmg += 1; note = tr('high ground');
    }
    const arc = this.arc(target, attacker.x, attacker.y);
    if (arc === 'rear') { dmg = Math.ceil(dmg * 1.5); note = tr('rear hit'); }
    const plate = target.def && target.def.frontArmor;
    if (plate && arc === 'front' && !mode.pierce) {
      if (plate === 'immune') return { dmg: 0, note: tr('deflected') };
      dmg = Math.floor(dmg / 2); note = tr('armour');
    }
    if (mode.pattern !== 'melee' && this._inCover(target, attacker)) {
      dmg = Math.max(1, dmg - 2); note = tr('cover');
    }
    if (target.reduce) dmg = Math.max(1, dmg - target.reduce);
    return { dmg, note };
  }

  // Does the shot at `target` from `attacker` skim a crate or a body huddled
  // next to the target? Such cover soaks part of the blow. Melee ignores it,
  // and so do blast footprints (they never route through calcDamage).
  _inCover(target, attacker) {
    for (const e of trace(attacker.x, attacker.y, target.x, target.y)) {
      if (e.corner) continue;
      if (Math.max(Math.abs(e.x - target.x), Math.abs(e.y - target.y)) !== 1) continue;
      const t = this.tile(e.x, e.y);
      if (t && t.type === 'crate') return true;
      const u = this.unitAt(e.x, e.y);
      if (u && u !== attacker && u !== target) return true;
    }
    return false;
  }

  // Tiles touched by an attack, for previews and effects.
  footprint(u, tx, ty, mode) {
    if (mode.pattern === 'line') {
      return [...trace(u.x, u.y, tx, ty).filter(e => !e.corner), { x: tx, y: ty }];
    }
    if (mode.pattern === 'blast') {
      const out = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const t = this.tile(tx + dx, ty + dy);
        if (t && t.type !== 'wall' && t.type !== 'void') out.push({ x: t.x, y: t.y, edge: !!(dx || dy) });
      }
      return out;
    }
    return [{ x: tx, y: ty }];
  }

  // Everyone an attack would hurt and by how much.
  affected(u, tx, ty, mode) {
    const hits = [];
    for (const f of this.footprint(u, tx, ty, mode)) {
      const v = this.unitAt(f.x, f.y);
      if (!v || v === u) continue;
      if (mode.pattern === 'blast') {
        const raw = f.edge ? Math.ceil(mode.dmg / 2) : mode.dmg;
        hits.push({ unit: v, dmg: Math.max(1, raw - v.reduce), note: '' });
      } else {
        hits.push({ unit: v, ...this.calcDamage(u, v, mode) });
      }
    }
    // Shotgun spread: hostiles crowded beside the target tile each catch a
    // pellet. Friendlies are safe — the spread goes forward, not sideways.
    if (mode.splash) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const v = this.unitAt(tx + dx, ty + dy);
        if (!v || v === u || v.side !== 'alien') continue;
        if (hits.some(h => h.unit === v)) continue;
        hits.push({ unit: v, dmg: Math.max(1, mode.splash - v.reduce), note: tr('splash') });
      }
    }
    return hits;
  }

  // Full preview for the UI: can `u` attack (tx,ty) with `mode`, and what happens?
  preview(u, tx, ty, mode) {
    const range = u.weapon ? u.weapon.range : mode.range;
    const problem = (u.side === 'marine' ? this.fireProblem(u, mode) : null)
      || this.shotProblem(u.x, u.y, tx, ty, { ...mode, range, minRange: u.weapon?.def.minRange }, u);
    return { ok: !problem, problem, hits: problem ? [] : this.affected(u, tx, ty, mode), tiles: problem ? [] : this.footprint(u, tx, ty, mode) };
  }

  nextSpawnIn() {
    const sp = this.mission.spawn;
    if (!sp || this.spawnLeft <= 0) return null;
    if (this.turn <= sp.start) return sp.start - this.turn;
    const since = (this.turn - sp.start) % sp.every;
    return since === 0 ? 0 : sp.every - since;
  }

  // ---------------------------------------------------------------- player actions

  async _run(fn) {
    if (this.busy || this.over || this.phase !== 'player') return false;
    this.busy = true;
    try { await fn(); } finally { this.busy = false; }
    await this._announce();
    this.fx.refresh();
    return true;
  }

  async _announce() {
    if (this.over && !this.announced) { this.announced = true; await this.fx.finish(this.result); }
  }

  async begin() {
    this.busy = true;
    await this._startTurn();
    this.busy = false;
    await this._announce();
    this.fx.refresh();
  }

  move(u, path) { return this._run(() => this._move(u, path)); }

  attack(u, tx, ty, mode) {
    if (!this.preview(u, tx, ty, mode).ok) return Promise.resolve(false);
    return this._run(() => this._attack(u, tx, ty, mode));
  }

  setFacing(u, d) {
    if (this.busy || this.over || u.facing === d) return;
    u.facing = d;
    this.fx.turn(u);
    this.fx.refresh();
  }

  // Swapping magazines costs RELOAD_AP unless the weapon is slower about it;
  // break-open shotguns pay per spent barrel instead of per magazine.
  reloadAp(u) {
    const def = u.weapon.def;
    if (def.reloadPerRound) return def.reloadPerRound * (def.ammo - u.weapon.ammo);
    return def.reloadAp ?? RELOAD_AP;
  }

  // Why this trooper cannot swap magazines right now, or null when they can.
  reloadProblem(u) {
    if (u.side !== 'marine' || !u.weapon) return tr('Cannot be used');
    if (u.weapon.ammo >= u.weapon.def.ammo) return tr('Magazine is full');
    if (u.ap < this.reloadAp(u)) return tr('Not enough AP');
    return null;
  }

  reload(u) {
    if (this.reloadProblem(u)) return Promise.resolve(false);
    return this._run(async () => {
      u.ap -= this.reloadAp(u);
      u.weapon.ammo = u.weapon.def.ammo;
      await this.fx.note(u, tr('RELOADED'), 'good');
    });
  }

  terminalProblem(u, tx, ty) {
    const t = this.tile(tx, ty);
    if (!t || !t.terminal) return tr('Nothing to use');
    if (t.terminal.used) return tr('Already activated');
    if (Math.abs(tx - u.x) + Math.abs(ty - u.y) !== 1) return tr('Stand next to it');
    if (u.ap < 1) return tr('Not enough AP');
    return null;
  }

  useTerminal(u, tx, ty) {
    if (this.terminalProblem(u, tx, ty)) return Promise.resolve(false);
    return this._run(async () => {
      const t = this.tile(tx, ty);
      u.ap -= 1;
      u.facing = this.dirToward(u, tx, ty);
      t.terminal.used = true;
      const doors = [];
      for (const row of this.tiles) for (const d of row) {
        if (d.door && !d.door.open && d.door.group === t.terminal.group) {
          d.door.open = true; d.type = 'floor'; doors.push(d);
        }
      }
      await this.fx.terminal(u, t, doors);
    });
  }

  gearProblem(u, g, tx, ty) {
    if (!g || !g.def.active) return tr('Cannot be used');
    if (g.charges <= 0) return tr('No charges left');
    if (u.ap < g.def.ap) return tr('Not enough AP');
    const kind = g.def.active;
    if (kind === 'reload') return u.weapon.ammo >= u.weapon.def.ammo ? tr('Magazine is full') : null;
    if (kind === 'stim') return null;
    if (tx == null) return tr('Pick a target');
    if (kind === 'heal') {
      const v = this.unitAt(tx, ty);
      if (!v || v.side !== 'marine') return tr('Target a trooper');
      if (Math.abs(tx - u.x) + Math.abs(ty - u.y) > 1) return tr('Must be adjacent');
      if (v.hp >= v.maxHp) return tr('Not wounded');
      return null;
    }
    if (kind === 'jump') {
      if (!this.walkable(this.tile(tx, ty)) || this.unitAt(tx, ty)) return tr('Cannot land there');
      const dist = Math.hypot(tx - u.x, ty - u.y);
      if (dist > g.def.range + 0.5) return tr('Too far');
      if (this.sightBlocked(u.x, u.y, tx, ty)) return tr('No clear arc');
      return null;
    }
    if (kind === 'mine') {
      const t = this.tile(tx, ty);
      if (!t || !this.walkable(t) || this.unitAt(tx, ty) || this.mines.has(key(tx, ty))) return tr('Cannot place it there');
      const dist = Math.hypot(tx - u.x, ty - u.y);
      if (dist > g.def.range + 0.5) return tr('Too far');
      if (this.sightBlocked(u.x, u.y, tx, ty)) return tr('No clear arc');
      return null;
    }
    if (kind === 'smoke') {
      const t = this.tile(tx, ty);
      if (!t || t.type === 'wall' || t.type === 'void' || t.type === 'door') return tr('Cannot place it there');
      const dist = Math.hypot(tx - u.x, ty - u.y);
      if (dist > g.def.range + 0.5) return tr('Too far');
      if (this.sightBlocked(u.x, u.y, tx, ty)) return tr('No clear arc');
      return null;
    }
    if (kind === 'turret') {
      const t = this.tile(tx, ty);
      if (Math.abs(tx - u.x) + Math.abs(ty - u.y) !== 1) return tr('Must be adjacent');
      if (!t || !this.walkable(t) || this.unitAt(tx, ty) || this.mines.has(key(tx, ty)) || t.hatch) return tr('Cannot place it there');
      return null;
    }
    if (kind === 'shell' || kind === 'jet') {
      // Under-barrel support weapons aim at a tile, not a unit — over heads if
      // the shell arcs — but never through walls or without a clear sightline.
      const t = this.tile(tx, ty);
      if (!t || t.type === 'wall' || t.type === 'void' || t.type === 'door') return tr('Cannot target there');
      const dist = Math.hypot(tx - u.x, ty - u.y);
      if (dist === 0) return tr('Invalid target');
      if (dist > g.def.range + 0.5) return tr('Too far');
      if (g.def.minRange && dist < g.def.minRange) return tr('Too close');
      if (this.sightBlocked(u.x, u.y, tx, ty)) return tr('No line of sight');
      return null;
    }
    return tr('Cannot be used');
  }

  useGear(u, g, tx, ty) {
    if (this.gearProblem(u, g, tx, ty)) return Promise.resolve(false);
    return this._run(async () => {
      u.ap -= g.def.ap;
      g.charges--;
      const kind = g.def.active;
      if (kind === 'reload') { u.weapon.ammo = u.weapon.def.ammo; await this.fx.note(u, tr('RELOADED'), 'good'); }
      else if (kind === 'stim') { u.ap += 3; await this.fx.note(u, tr('+{n} AP', { n: 3 }), 'good'); }
      else if (kind === 'heal') {
        const v = this.unitAt(tx, ty);
        const amount = Math.min(v.maxHp - v.hp, 5 + 3 * u.medic);
        v.hp += amount;
        if (v !== u) u.facing = this.dirToward(u, tx, ty);
        await this.fx.heal(u, v, amount);
      } else if (kind === 'jump') {
        const from = { x: u.x, y: u.y };
        u.facing = this.dirToward(u, tx, ty);
        u.x = tx; u.y = ty;
        await this.fx.jump(u, from, { x: tx, y: ty });
        await this._pickup(u);
        this._markSightings(u);
        this._checkEnd();
      } else if (kind === 'mine') {
        u.facing = this.dirToward(u, tx, ty);
        this.mines.set(key(tx, ty), { x: tx, y: ty });
        await this.fx.mineSet(this.tile(tx, ty));
      } else if (kind === 'smoke') {
        u.facing = this.dirToward(u, tx, ty);
        const tiles = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const t = this.tile(tx + dx, ty + dy);
          if (t && t.type !== 'wall' && t.type !== 'void' && t.type !== 'door') {
            this.smoke.set(key(t.x, t.y), 2);
            tiles.push(t);
          }
        }
        await this.fx.smokeSet(this.tile(tx, ty), tiles);
      } else if (kind === 'turret') {
        u.facing = this.dirToward(u, tx, ty);
        const tur = this.addTurret(tx, ty);
        await this.fx.turretSet(tur, u);
      } else if (kind === 'shell' || kind === 'jet') {
        // One charge, one shot: the under-barrel mode rides the normal attack
        // path so blasts, lines and damage notes all behave — flagged so it
        // takes no rounds and heats no barrel of its own.
        await this._attack(u, tx, ty, { ...g.def.mode, ap: 0, ammo: 0, gear: true });
      }
    });
  }

  endTurn() {
    return this._run(async () => {
      // Guard arcs open; a new phase is a fresh barrel as far as the streak goes.
      for (const m of this.marines()) { m.guard = true; m.weapon.streak = 0; }
      this.phase = 'alien';
      this.engaged = {};        // focus-fire bookkeeping for the alien phase
      this.shielded = new Set(); // Defence soaks are fresh for the new phase
      this._threatCache = null; // guard arcs may have changed; recompute lazily
      await this.fx.phase('alien', this);
      for (const a of this.aliens()) {
        if (this.over) break;
        if (a.alive) await this._act(a);
      }
      if (!this.over) await this._spawn();
      if (!this.over) await this._startTurn();
    });
  }

  // ---------------------------------------------------------------- internals

  async _startTurn() {
    // A battle fielded with nobody alive is already lost; without this check no
    // marine would ever move, kill or spawn, so _checkEnd would never fire and
    // the mission would hang with no way out.
    if (!this.marines().length) return this._finish(false, tr('The squad has been wiped out.'));
    this.turn++;
    const o = this.mission.objective;
    if (o.type === 'survive' && this.turn > o.turns) return this._finish(true, tr('The line held.'));
    if (this.mission.turnLimit && this.turn > this.mission.turnLimit) return this._finish(false, tr('Out of time.'));
    this.phase = 'player';
    for (const m of this.marines()) {
      m.ap = m.maxAp;
      m.guard = false;
      m.rallied = false;
      m.hurt = false;
      m.weapon.heat = Math.max(0, m.weapon.heat - m.weapon.cool);
      m.weapon.streak = 0;
    }
    // Clouds thin and drift apart at the top of each turn.
    const clear = [];
    for (const [k, n] of this.smoke) {
      if (n <= 1) clear.push(k); else this.smoke.set(k, n - 1);
    }
    for (const k of clear) this.smoke.delete(k);
    if (clear.length) {
      await this.fx.smokeClear(clear.map(k => {
        const [x, y] = k.split(',').map(Number);
        return this.tile(x, y);
      }));
    }
    await this.fx.phase('player', this);
  }

  _finish(win, text) {
    if (this.over) return;
    this.over = true;
    this.result = { win, text };
  }

  _checkEnd() {
    if (this.over) return;
    const marines = this.marines();
    if (!marines.length) return this._finish(false, tr('The squad has been wiped out.'));
    const o = this.mission.objective;
    if (o.type === 'eliminate' && !this.aliens().length && this.spawnLeft <= 0) this._finish(true, tr('Area secured.'));
    else if (o.type === 'kill' && !this.aliens().some(a => a.kind === o.kind)) this._finish(true, tr('Target destroyed.'));
    else if (o.type === 'exit' && marines.every(m => this.tile(m.x, m.y).exit)) this._finish(true, tr('Squad extracted.'));
  }

  async _move(u, path) {
    for (const st of path) {
      if (!u.alive || u.ap < 1 || this.over) break;
      if (this.unitAt(st.x, st.y)) break;
      const from = { x: u.x, y: u.y };
      u.facing = st.d; u.x = st.x; u.y = st.y; u.ap -= 1; u.moved = true;
      await this.fx.step(u, from, st);
      if (u.side === 'marine') {
        await this._pickup(u);
        this._checkEnd();
        this._markSightings(u);
        this._rally(u);
      }
      else {
        // The brood does not read minefield markings.
        if (this.mines.has(key(st.x, st.y))) await this._detonate(st.x, st.y);
        if (!u.alive || this.over) break;
        this._spreadAlert(u, st.x, st.y);
        await this._reactions(u);
      }
    }
  }

  // A mine goes off: everything beside it bleeds, friendlies included.
  async _detonate(x, y) {
    this.mines.delete(key(x, y));
    this._noise(x, y);
    await this.fx.mineBoom(x, y);
    const victims = this.units.filter(v => v.alive && Math.max(Math.abs(v.x - x), Math.abs(v.y - y)) <= 1);
    for (const v of victims) if (v.alive) await this._damage(v, Math.max(1, 7 - v.reduce), null, 'blast');
    this._checkEnd();
  }

  async _pickup(u) {
    const t = this.tile(u.x, u.y);
    if (t.pickup === 'ammo' && u.weapon.ammo < u.weapon.def.ammo) {
      u.weapon.ammo = u.weapon.def.ammo; t.pickup = null;
      await this.fx.pickup(u, t, tr('AMMO'));
    } else if (t.pickup === 'med' && u.hp < u.maxHp) {
      u.hp = u.maxHp; t.pickup = null;
      await this.fx.pickup(u, t, tr('PATCHED UP'));
    }
  }

  async _attack(u, tx, ty, mode) {
    const hits = this.affected(u, tx, ty, mode);
    const tiles = this.footprint(u, tx, ty, mode);
    if (u.side === 'alien') for (const h of hits)
      if (h.unit.side === 'marine') this.engaged[h.unit.id] = (this.engaged[h.unit.id] || 0) + 1;
    u.ap -= mode.ap;
    if (u.side === 'marine' && mode.pattern !== 'melee') {
      if (mode.gear) this._noise(u.x, u.y); // a launched shell is loud, barrel or no barrel
      else {
        u.weapon.ammo -= this.modeAmmo(u, mode);
        u.weapon.heat += this.shotHeat(u, mode);
        u.weapon.streak = (u.weapon.streak || 0) + 1;
        this._noise(u.x, u.y); // gunfire carries, walls or no walls
      }
    }
    u.facing = this.dirToward(u, tx, ty);
    await this.fx.attack(u, { x: tx, y: ty }, mode, tiles);
    for (const h of hits) {
      if (!h.unit.alive) continue;
      if (u.side === 'alien' && h.unit.side === 'marine' && h.dmg > 0) {
        const soak = this._soak(h.unit);
        if (soak) h.dmg = Math.max(0, h.dmg - soak);
      }
      await this._damage(h.unit, h.dmg, u, h.note);
    }
  }

  // How much of a hostile attack a Defence-trained trooper — or anyone
  // standing beside one — shrugs off. Each protected marine gets one soak
  // per hostile phase; the strongest nearby protector sets the amount.
  _soak(u) {
    if (this.shielded.has(u.id)) return 0;
    let best = 0;
    const lv = u.soldier.skills.defense || 0;
    if (lv) best = lv >= 2 ? 2 : 1;
    for (const d of this.marines()) {
      if (d === u || Math.max(Math.abs(d.x - u.x), Math.abs(d.y - u.y)) > 1) continue;
      const dl = d.soldier.skills.defense || 0;
      if (dl >= 2) best = Math.max(best, dl >= 3 ? 2 : 1);
    }
    if (best) this.shielded.add(u.id);
    return best;
  }

  async _damage(target, dmg, source, note) {
    if (dmg <= 0) { await this.fx.note(target, tr('DEFLECTED'), 'bad'); return; }
    // A hit focuses the brood's attention on whoever dealt it — and the
    // shriek carries to the creatures nearby.
    if (target.side === 'alien' && source && source.side !== 'alien') this._raise(target, source.x, source.y);
    // Pain teaches the alacritous to move: a hit taken buys back an AP or
    // three, once a turn.
    if (target.side === 'marine' && !target.hurt) {
      const al = target.soldier.skills.alacrity || 0;
      if (al) { target.ap += al; target.hurt = true; this.fx.note(target, tr('+{n} AP', { n: al }), 'good'); }
    }
    target.hp = Math.max(0, target.hp - dmg);
    await this.fx.damage(target, dmg, note);
    if (target.hp <= 0) await this._kill(target, source);
  }

  async _kill(target, source) {
    target.alive = false;
    this.ghosts.delete(target.id);
    if (source && source.side === 'marine' && target.side === 'alien') { source.kills++; source.xp += target.xpValue ?? target.def.xp; }
    await this.fx.death(target);
    const ex = target.def && target.def.explode;
    if (ex) {
      this._noise(target.x, target.y);
      await this.fx.explosion(target.x, target.y, ex.radius);
      const victims = this.units.filter(v => v.alive && Math.max(Math.abs(v.x - target.x), Math.abs(v.y - target.y)) <= ex.radius);
      for (const v of victims) if (v.alive) await this._damage(v, Math.max(1, ex.dmg - v.reduce), source, 'blast');
    }
    this._checkEnd();
  }

  // The first mode a guarding marine would fire at a hostile standing on
  // (tx,ty), or null. The HUD asks the same question to draw the reaction arc.
  reactionMode(m, tx, ty) {
    if (!this.inCone(m, tx, ty)) return null;
    for (const mode of this.modes(m)) {
      const p = this.preview(m, tx, ty, mode);
      if (!p.ok) continue;
      if (mode.pattern !== 'single' && mode.pattern !== 'melee'
        && p.hits.some(h => h.unit.side === 'marine')) continue;
      return mode;
    }
    return null;
  }

  async _reactions(foe) {
    for (const m of this.marines()) {
      if (!foe.alive || this.over) break;
      if (!m.alive || !m.guard) continue;
      const mode = this.reactionMode(m, foe.x, foe.y);
      if (!mode) continue;
      await this.fx.note(m, tr('REACTION'), 'info');
      await this._attack(m, foe.x, foe.y, mode);
    }
    if (foe.alive && !this.over) await this._turretFire(foe);
  }

  // Sentry guns shoot at each hostile once per that hostile's activation, the
  // first moment it crosses a gun's line of sight. An empty gun powers down.
  async _turretFire(foe) {
    if (foe.turretShot) return;
    for (const t of this.turrets()) {
      if (Math.hypot(foe.x - t.x, foe.y - t.y) > TURRET.range + 0.5) continue;
      if (this.sightBlocked(t.x, t.y, foe.x, foe.y)) continue;
      foe.turretShot = true;
      t.facing = this.dirToward(t, foe.x, foe.y);
      this._noise(t.x, t.y); // a sentry gun announcing itself to the whole deck
      this.fx.turn(t);
      await this.fx.note(t, tr('TURRET'), 'info');
      t.rounds--;
      await this._attack(t, foe.x, foe.y, { name: tr('Burst'), ap: 0, dmg: TURRET.dmg, ammo: 1, heat: 0, pattern: 'single' });
      if (t.rounds <= 0 && t.alive) await this._kill(t, null);
      break;
    }
  }

  async _act(a) {
    const def = a.def;
    a.ap = a.maxAp; a.shots = 0; a.moved = false; a.provoked = false; a.turretShot = false;
    // A lucky trooper's mere presence gums up the brood's footing: standing
    // next to one costs the creature its haste, but never its last step.
    let luck = 0;
    for (const m of this.marines())
      if (Math.max(Math.abs(m.x - a.x), Math.abs(m.y - a.y)) <= 1) luck = Math.max(luck, m.soldier.skills.luck || 0);
    a.ap = Math.max(1, a.ap - luck);
    await this.fx.activate(a);

    // The brood hunts by sight and sound. Whatever it has not seen or heard
    // about does not exist for it: unaware creatures mill in place instead of
    // homing on the squad through the walls.
    const sensed = this._sensedFoes(a);
    const seen = sensed.filter(m => m.side === 'marine');
    if (seen.length) {
      const near = seen.reduce((b, c) => Math.hypot(c.x - a.x, c.y - a.y) < Math.hypot(b.x - a.x, b.y - a.y) ? c : b);
      this._raise(a, near.x, near.y);
    }
    if (!sensed.length && !this.alert.has(a.id)) {
      await this._mill(a);
      if (a.alive) { this._faceThreat(a); this.fx.turn(a); }
      return;
    }

    if (def.explode) {
      await this._approach(a, true);
      if (a.alive && [...this.marines(), ...this.turrets()].some(m => Math.max(Math.abs(m.x - a.x), Math.abs(m.y - a.y)) <= def.explode.radius)) {
        await this._kill(a, null);
      }
    } else {
      let shot = false;
      if (def.ranged) {
        shot = await this._tryShoot(a);
        if (!shot && a.alive) {
          const spot = this._firingSpot(a);
          if (spot) { await this._move(a, this.pathFrom(spot)); if (a.alive && !this.over) shot = await this._tryShoot(a); }
        }
      }
      if (a.alive && !this.over && a.melee && !(shot && def.skirmisher)) {
        await this._approach(a, false);
        while (a.alive && !this.over && a.ap >= a.melee.ap) {
          const t = this._meleeTarget(a);
          if (!t) break;
          await this._provoke(a);
          if (!a.alive || this.over) break;
          await this._attack(a, t.x, t.y, { name: tr('Claw'), ...a.melee, pattern: 'melee' });
        }
      }
    }
    if (a.alive) { this._faceThreat(a); this.fx.turn(a); }
  }

  // What this alien can actually perceive right now: foes inside its sense
  // radius along a clear line. Smoke blinds the brood as readily as it blinds
  // the squad, and Stealth-n trained troopers register from closer in — the
  // floor keeps them from being invisible at knifepoint.
  _sensedFoes(a) {
    return [...this.marines(), ...this.turrets()].filter(m => {
      const sense = m.side === 'marine' ? Math.max(2, ALERT.sense - 5 * (m.soldier.skills.stealth || 0)) : ALERT.sense;
      return Math.hypot(m.x - a.x, m.y - a.y) <= sense + 0.5 && !this.sightBlocked(a.x, a.y, m.x, m.y);
    });
  }

  // One alien learns where the squad is, and calls the nearest of its kin to
  // come along. The call is a whisper, not a shout: at most three creatures
  // per sighting end up converging — the spotter, its nearest neighbour, and
  // one more that the neighbour brushes past on the way.
  _raise(a, x, y) {
    if (!a.alive) return;
    this.alert.set(a.id, { x, y, left: 2 });
    if (!this.spread) return;
    let best = null, bd = Infinity;
    for (const b of this.aliens()) {
      if (b === a || this.alert.has(b.id)) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= this.spread + 0.5 && d < bd) { bd = d; best = b; }
    }
    if (best) this.alert.set(best.id, { x, y, left: 1 });
  }

  // An alerted creature on the move passes the call to whoever it runs past,
  // one hop at a time and only while the sighting's budget of recruits lasts.
  _spreadAlert(u, x, y) {
    const call = this.alert.get(u.id);
    if (!call || !call.left) return;
    for (const b of this.aliens()) {
      if (b === u || this.alert.has(b.id)) continue;
      if (Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) > 1) continue;
      call.left--;
      this.alert.set(b.id, { x: call.x, y: call.y, left: call.left });
      if (!call.left) break;
    }
  }

  // Gunfire, sentry guns and blasts carry through walls to everything nearby.
  _noise(x, y) {
    for (const a of this.aliens()) {
      if (Math.hypot(a.x - x, a.y - y) <= ALERT.hearing + 0.5) this.alert.set(a.id, { x, y });
    }
  }

  // A trooper moving where the brood can see keeps teaching it where the
  // squad is: whoever holds them in sense range right now marks this tile, so
  // a marine breaking line of sight is chased to the last tile they were seen
  // on — not to where they stood a whole turn ago.
  _markSightings(u) {
    for (const a of this.aliens()) {
      if (Math.hypot(u.x - a.x, u.y - a.y) > ALERT.sense + 0.5) continue;
      if (this.sightBlocked(a.x, a.y, u.x, u.y)) continue;
      this.alert.set(a.id, { x: u.x, y: u.y });
    }
  }

  // Stepping beside a leader puts a spring in the step: +1 AP per Leadership
  // level, once a turn — the strongest leader nearby sets the pace, and the
  // extra point can ride above the usual maximum, like a stim.
  _rally(u) {
    if (u.rallied) return;
    let lead = 0;
    for (const m of this.marines()) {
      if (m === u) continue;
      if (Math.max(Math.abs(m.x - u.x), Math.abs(m.y - u.y)) > 1) continue;
      lead = Math.max(lead, m.soldier.skills.leadership || 0);
    }
    if (lead) { u.ap += lead; u.rallied = true; this.fx.note(u, tr('+{n} AP', { n: lead }), 'good'); }
  }

  // Face what this alien knows about: a foe in view, else the last place the
  // brood caught wind of the squad, else wherever it was looking.
  _faceThreat(a) {
    const sensed = this._sensedFoes(a);
    let tx, ty;
    if (sensed.length) {
      let bd = Infinity;
      for (const m of sensed) { const d = Math.hypot(m.x - a.x, m.y - a.y); if (d < bd) { bd = d; tx = m.x; ty = m.y; } }
    } else {
      const p = this.alert.get(a.id);
      if (p) { tx = p.x; ty = p.y; }
    }
    if (tx != null) a.facing = this.dirToward(a, tx, ty);
  }

  // Nothing sensed, nothing heard: the creature picks a bearing and walks it
  // — up to four tiles, swerving around whatever blocks it, and never onto
  // the brood's own hatches. It stops the moment anything comes into view.
  async _mill(a) {
    let dir = Math.floor(Math.random() * 4);
    for (let steps = 0; steps < 4 && a.alive && !this.over && a.ap >= 1; steps++) {
      if (this._sensedFoes(a).length) return;
      let moved = false;
      // Straight on if possible, then either side, and only then about-turn.
      for (const d of [dir, (dir + 1) % 4, (dir + 3) % 4, (dir + 2) % 4]) {
        const x = a.x + DIRS[d].x, y = a.y + DIRS[d].y;
        if (this.stepOk(a.x, a.y, d) && !this.unitAt(x, y) && !this.tiles[y][x].hatch) {
          await this._move(a, [{ x, y, d }]);
          dir = d;
          moved = true;
          break;
        }
      }
      if (!moved) return; // boxed in: stand and taste the air
    }
  }

  // An alien that attacks without having moved still gives guards one chance to fire.
  async _provoke(a) {
    if (a.moved || a.provoked) return;
    a.provoked = true;
    await this._reactions(a);
  }

  _rangedMode(a) { return { name: tr('Acid'), ...a.ranged, pattern: 'single', fx: 'acid' }; }

  // How badly this alien wants to hit that trooper: finish the wounded first,
  // then whoever the brood is already pressing. Lower is tastier.
  _targetScore(m, dmg) {
    return (m.hp <= dmg ? -1000 : 0) + m.hp - this.diff.aiFocus * (this.engaged[m.id] || 0);
  }

  // Tiles a guarding marine can reach with reaction fire this phase.
  _reactionThreat() {
    if (this._threatCache) return this._threatCache;
    const set = new Set();
    for (const m of this.marines()) {
      if (!m.guard) continue;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (!this.walkable(this.tiles[y][x])) continue;
        if (this.reactionMode(m, x, y)) set.add(key(x, y));
      }
    }
    this._threatCache = set;
    return set;
  }

  _nearestMarineDist(x, y) {
    let d = Infinity;
    for (const m of this.marines()) d = Math.min(d, Math.hypot(m.x - x, m.y - y));
    return d;
  }

  _shootTarget(a, fx, fy) {
    const mode = this._rangedMode(a);
    let best = null, bestScore = Infinity;
    // Troopers first; a sentry gun is worth spitting at when nobody softer shows.
    for (const m of [...this.marines(), ...this.turrets()]) {
      if (this.shotProblem(fx, fy, m.x, m.y, mode, a)) continue;
      const score = this._targetScore(m, mode.dmg) + (m.side === 'turret' ? 6 : 0);
      if (score < bestScore) { best = m; bestScore = score; }
    }
    return best;
  }

  async _tryShoot(a) {
    const r = a.ranged;
    if (a.ap < r.ap || a.shots >= r.perTurn) return false;
    if (!this._shootTarget(a, a.x, a.y)) return false;
    await this._provoke(a);
    if (!a.alive || this.over) return false;
    const t = this._shootTarget(a, a.x, a.y);
    if (!t) return false;
    a.shots++;
    await this._attack(a, t.x, t.y, this._rangedMode(a));
    return true;
  }

  // Cheapest tile with a shot, kept off reaction arcs where possible and as
  // far from the squad as the map allows, since spitters would rather not be
  // walked up to.
  _firingSpot(a) {
    const reach = this.flood(a.x, a.y, a.ap - a.ranged.ap);
    const threat = this._reactionThreat();
    let best = null, bestCost = Infinity;
    for (const n of reach.values()) {
      if (n.cost === 0 || !this._shootTarget(a, n.x, n.y)) continue;
      const cost = n.cost
        + (threat.has(key(n.x, n.y)) ? this.diff.aiPenalty * 2 : 0)
        - 0.01 * this._nearestMarineDist(n.x, n.y);
      if (cost < bestCost) { best = n; bestCost = cost; }
    }
    return best;
  }

  _meleeTarget(a) {
    let best = null, bestScore = Infinity;
    for (let d = 0; d < 4; d++) {
      if (!this.stepOk(a.x, a.y, d)) continue;
      const m = this.unitAt(a.x + DIRS[d].x, a.y + DIRS[d].y);
      if (!m || (m.side !== 'marine' && m.side !== 'turret')) continue;
      const score = this._targetScore(m, a.melee.dmg) + (m.side === 'turret' ? 6 : 0);
      if (score < bestScore) { best = m; bestScore = score; }
    }
    return best;
  }

  // Walk towards the closest tile next to a foe it can see — or, blind but
  // alerted, towards where the brood last caught wind of the squad. Bloaters
  // only need to get within blast range. Sentry guns are valid destinations
  // too, at a discount: worth smashing once the soft targets are out of easy
  // reach.
  async _approach(a, loose) {
    const goals = new Map();
    const addFoe = m => {
      for (let d = 0; d < 4; d++) {
        const x = m.x - DIRS[d].x, y = m.y - DIRS[d].y;
        if (this.stepOk(x, y, d)) goals.set(key(x, y), m);
      }
      if (loose) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (this.walkable(this.tile(m.x + dx, m.y + dy))) goals.set(key(m.x + dx, m.y + dy), m);
      }
    };
    const sensed = this._sensedFoes(a);
    if (sensed.length) {
      for (const m of sensed) addFoe(m);
    } else {
      const p = this.alert.get(a.id);
      if (!p) return;
      addFoe({ x: p.x, y: p.y });
      // Arrived with nothing to show for it: forget what the brood heard.
      if (goals.has(key(a.x, a.y))) { this.alert.delete(a.id); return; }
    }
    if (goals.has(key(a.x, a.y))) return;
    // Charging through a reaction arc is allowed but expensive, and costs more
    // the higher the difficulty; the brood is dumb, not suicidal.
    const threat = this._reactionThreat();
    const pick = reach => {
      let best = null;
      for (const [k, m] of goals) {
        const n = reach.get(k);
        if (!n) continue;
        const cost = n.cost + (threat.has(k) ? this.diff.aiPenalty : 0) + (m.side === 'turret' ? 6 : 0);
        if (!best || cost < best.cost || (cost === best.cost && m.hp < best.hp)) best = { node: n, cost, hp: m.hp };
      }
      return best && best.node;
    };
    // Prefer a route that is actually open; otherwise queue up behind whoever is in the way.
    const node = pick(this.flood(a.x, a.y, 99)) || pick(this.flood(a.x, a.y, 99, { ignoreUnits: true }));
    if (node) await this._move(a, this.pathFrom(node).slice(0, a.ap));
  }

  // Nearest unoccupied walkable tile that is not a hatch — the brood never
  // clogs its own hatches. Null when the neighbourhood is full.
  _freeTileNear(x, y, max = 4) {
    let best = null;
    for (const n of this.flood(x, y, max).values()) {
      if (n.cost === 0) continue;
      if (!this.tiles[n.y][n.x].hatch && (!best || n.cost < best.cost)) best = n;
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  async _spawn() {
    const sp = this.mission.spawn;
    if (!sp || this.spawnLeft <= 0) return;
    if (this.turn < sp.start || (this.turn - sp.start) % sp.every !== 0) return;
    for (const t of this.hatches) {
      if (this.spawnLeft <= 0) break;
      // A crowded map delays the rest of the wave, it does not cancel it.
      if (this.aliens().length >= this.maxAlive) break;
      const block = this.unitAt(t.x, t.y);
      if (block && block.side === 'alien') continue; // the brood never clogs its own hatch
      // A trooper standing on a hatch seals it, and the whole wave it would
      // have produced is lost.
      if (block) {
        for (let n = 0; n < this.countMul && this.spawnLeft > 0; n++) {
          this.spawnCount++;
          this.spawnLeft--;
        }
        await this.fx.hatchBlocked(t);
        continue;
      }
      // The first of the wave comes up through the hatch; the rest squeeze
      // out alongside it.
      for (let n = 0; n < this.countMul && this.spawnLeft > 0; n++) {
        const spot = n === 0 ? t : this._freeTileNear(t.x, t.y);
        if (!spot) break;
        const kind = sp.pool[this.spawnCount++ % sp.pool.length];
        this.spawnLeft--;
        const u = this.addAlien(kind, spot.x, spot.y);
        // Fresh from the hatch, it comes up hunting: the brood below felt the
        // squad's footsteps, so it knows roughly where to look.
        let near = null, nd = Infinity;
        for (const m of this.marines()) {
          const d = Math.hypot(m.x - spot.x, m.y - spot.y);
          if (d < nd) { nd = d; near = m; }
        }
        if (near) { this.alert.set(u.id, { x: near.x, y: near.y }); u.facing = this.dirToward(u, near.x, near.y); }
        await this.fx.spawn(u);
        // A mine laid on the hatch takes the wave's firstborn with it.
        if (this.mines.has(key(spot.x, spot.y))) await this._detonate(spot.x, spot.y);
      }
    }
    this._checkEnd();
  }

  summary() {
    return {
      win: !!(this.result && this.result.win),
      text: this.result ? this.result.text : '',
      turns: this.turn,
      marines: this.units.filter(u => u.side === 'marine').map(u => ({ id: u.soldier.id, alive: u.alive, kills: u.kills, xp: u.xp, hp: u.hp })),
    };
  }
}
