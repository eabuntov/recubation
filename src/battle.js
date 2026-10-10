// Tactical rules engine. No rendering in here: every visible consequence is
// reported through the async `fx` hooks so the same code runs headless in tests.

import { DIRS, WEAPONS, ARMORS, GEAR, ALIENS, BAYONET, BASE_HP, BASE_AP } from './data.js';

export const key = (x, y) => x + ',' + y;

const NOFX = new Proxy({}, { get: () => async () => {} });

const RAMP_CHARS = { '^': 0, '>': 1, 'v': 2, '<': 3 };
const ALIEN_CHARS = { s: 'skitter', p: 'spitter', k: 'carapace', b: 'bloater', t: 'stalker', M: 'behemoth' };
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
  constructor(mission, squad, fx = NOFX) {
    this.mission = mission;
    this.fx = fx;
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
    this.spawnLeft = mission.spawn ? mission.spawn.total : 0;
    this.spawnCount = 0;

    squad.slice(0, map.starts.length).forEach((s, i) => this.addMarine(s, map.starts[i], i));
    for (const a of map.aliens) this.addAlien(a.kind, a.x, a.y);
    for (const a of this.aliens()) this.faceNearest(a);
  }

  // ---------------------------------------------------------------- setup

  addMarine(s, pos, slot) {
    const wdef = WEAPONS[s.weapon], armor = ARMORS[s.armor];
    const gear = (s.gear || []).filter(Boolean).map(id => ({ id, def: GEAR[id], charges: GEAR[id].charges || 0 }));
    const bonus = k => gear.reduce((n, g) => n + (g.def[k] || 0), 0);
    const maxHp = BASE_HP + (s.skills.vitality || 0) * 2 + armor.hp;
    const maxAp = BASE_AP + (s.skills.reflexes || 0) + bonus('apBonus');
    const u = {
      id: this.nextId++, side: 'marine', kind: 'marine', name: s.name, soldier: s, slot,
      x: pos.x, y: pos.y, facing: this.mission.facing ?? 1,
      hp: maxHp, maxHp, ap: maxAp, maxAp, alive: true, reduce: armor.reduce, guard: false,
      weapon: { id: s.weapon, def: wdef, ammo: wdef.ammo, heat: 0, range: wdef.range + bonus('rangeBonus'), cool: wdef.cool + bonus('coolBonus') },
      gear, medic: s.skills.medic || 0, kills: 0, xp: 0,
    };
    this.units.push(u);
    return u;
  }

  addAlien(kind, x, y) {
    const def = ALIENS[kind];
    const u = {
      id: this.nextId++, side: 'alien', kind, name: def.name, def,
      x, y, facing: 2, hp: def.hp, maxHp: def.hp, ap: def.ap, maxAp: def.ap, alive: true, reduce: 0,
    };
    this.units.push(u);
    return u;
  }

  // ---------------------------------------------------------------- queries

  marines() { return this.units.filter(u => u.alive && u.side === 'marine'); }
  aliens() { return this.units.filter(u => u.alive && u.side === 'alien'); }
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

  sightBlocked(x0, y0, x1, y1) {
    for (const e of trace(x0, y0, x1, y1)) {
      if (e.corner) {
        if (this.blocksSight(...e.corner[0]) && this.blocksSight(...e.corner[1])) return true;
      } else if (this.blocksSight(e.x, e.y)) return true;
    }
    return false;
  }

  // Why a shot from (fx,fy) at (tx,ty) cannot be taken, or null when it can.
  shotProblem(fx, fy, tx, ty, { range, minRange = 0, pattern = 'single', arc = false }, shooter = null) {
    if (pattern === 'melee') {
      const d = DIRS.findIndex(v => fx + v.x === tx && fy + v.y === ty);
      return d >= 0 && this.stepOk(fx, fy, d) ? null : 'Not adjacent';
    }
    const dist = Math.hypot(tx - fx, ty - fy);
    if (dist === 0) return 'Invalid target';
    if (dist > range + 0.5) return 'Out of range';
    if (dist < minRange) return 'Too close';
    if (this.sightBlocked(fx, fy, tx, ty)) return 'No line of sight';
    if (pattern === 'single' && !arc && this.heightAt(fx, fy) === this.heightAt(tx, ty)) {
      for (const e of trace(fx, fy, tx, ty)) {
        if (e.corner) continue;
        const u = this.unitAt(e.x, e.y);
        if (u && u !== shooter) return `Blocked by ${u.name}`;
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

  modes(u) { return [...u.weapon.def.modes, BAYONET]; }

  // Why this marine cannot use this fire mode right now, or null.
  fireProblem(u, mode) {
    if (u.ap < mode.ap) return 'Not enough AP';
    if (mode.pattern === 'melee') return null;
    if (u.weapon.ammo < mode.ammo) return 'Out of ammo';
    if (u.weapon.heat + mode.heat > u.weapon.def.maxHeat) return 'Weapon too hot';
    return null;
  }

  calcDamage(attacker, target, mode) {
    let dmg = mode.dmg, note = '';
    const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    if (mode.falloff) for (const [r, d] of mode.falloff) if (dist <= r) { dmg = d; break; }
    if (mode.pattern !== 'melee' && this.heightAt(attacker.x, attacker.y) > this.heightAt(target.x, target.y)) {
      dmg += 1; note = 'high ground';
    }
    const arc = this.arc(target, attacker.x, attacker.y);
    if (arc === 'rear') { dmg = Math.ceil(dmg * 1.5); note = 'rear hit'; }
    const plate = target.def && target.def.frontArmor;
    if (plate && arc === 'front' && !mode.pierce) {
      if (plate === 'immune') return { dmg: 0, note: 'deflected' };
      dmg = Math.floor(dmg / 2); note = 'armour';
    }
    if (target.reduce) dmg = Math.max(1, dmg - target.reduce);
    return { dmg, note };
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

  terminalProblem(u, tx, ty) {
    const t = this.tile(tx, ty);
    if (!t || !t.terminal) return 'Nothing to use';
    if (t.terminal.used) return 'Already activated';
    if (Math.abs(tx - u.x) + Math.abs(ty - u.y) !== 1) return 'Stand next to it';
    if (u.ap < 1) return 'Not enough AP';
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
    if (!g || !g.def.active) return 'Cannot be used';
    if (g.charges <= 0) return 'No charges left';
    if (u.ap < g.def.ap) return 'Not enough AP';
    const kind = g.def.active;
    if (kind === 'reload') return u.weapon.ammo >= u.weapon.def.ammo ? 'Magazine is full' : null;
    if (kind === 'stim') return null;
    if (tx == null) return 'Pick a target';
    if (kind === 'heal') {
      const v = this.unitAt(tx, ty);
      if (!v || v.side !== 'marine') return 'Target a trooper';
      if (Math.abs(tx - u.x) + Math.abs(ty - u.y) > 1) return 'Must be adjacent';
      if (v.hp >= v.maxHp) return 'Not wounded';
      return null;
    }
    if (kind === 'jump') {
      if (!this.walkable(this.tile(tx, ty)) || this.unitAt(tx, ty)) return 'Cannot land there';
      const dist = Math.hypot(tx - u.x, ty - u.y);
      if (dist > g.def.range + 0.5) return 'Too far';
      if (this.sightBlocked(u.x, u.y, tx, ty)) return 'No clear arc';
      return null;
    }
    return 'Cannot be used';
  }

  useGear(u, g, tx, ty) {
    if (this.gearProblem(u, g, tx, ty)) return Promise.resolve(false);
    return this._run(async () => {
      u.ap -= g.def.ap;
      g.charges--;
      const kind = g.def.active;
      if (kind === 'reload') { u.weapon.ammo = u.weapon.def.ammo; await this.fx.note(u, 'RELOADED', 'good'); }
      else if (kind === 'stim') { u.ap += 3; await this.fx.note(u, '+3 AP', 'good'); }
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
        this._checkEnd();
      }
    });
  }

  endTurn() {
    return this._run(async () => {
      for (const m of this.marines()) m.guard = true;
      this.phase = 'alien';
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
    this.turn++;
    const o = this.mission.objective;
    if (o.type === 'survive' && this.turn > o.turns) return this._finish(true, 'The line held.');
    if (this.mission.turnLimit && this.turn > this.mission.turnLimit) return this._finish(false, 'Out of time.');
    this.phase = 'player';
    for (const m of this.marines()) {
      m.ap = m.maxAp;
      m.guard = false;
      m.weapon.heat = Math.max(0, m.weapon.heat - m.weapon.cool);
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
    if (!marines.length) return this._finish(false, 'The squad has been wiped out.');
    const o = this.mission.objective;
    if (o.type === 'eliminate' && !this.aliens().length && this.spawnLeft <= 0) this._finish(true, 'Area secured.');
    else if (o.type === 'kill' && !this.aliens().some(a => a.kind === o.kind)) this._finish(true, 'Target destroyed.');
    else if (o.type === 'exit' && marines.every(m => this.tile(m.x, m.y).exit)) this._finish(true, 'Squad extracted.');
  }

  async _move(u, path) {
    for (const st of path) {
      if (!u.alive || u.ap < 1 || this.over) break;
      if (this.unitAt(st.x, st.y)) break;
      const from = { x: u.x, y: u.y };
      u.facing = st.d; u.x = st.x; u.y = st.y; u.ap -= 1; u.moved = true;
      await this.fx.step(u, from, st);
      if (u.side === 'marine') { await this._pickup(u); this._checkEnd(); }
      else await this._reactions(u);
    }
  }

  async _pickup(u) {
    const t = this.tile(u.x, u.y);
    if (t.pickup === 'ammo' && u.weapon.ammo < u.weapon.def.ammo) {
      u.weapon.ammo = u.weapon.def.ammo; t.pickup = null;
      await this.fx.pickup(u, t, 'AMMO');
    } else if (t.pickup === 'med' && u.hp < u.maxHp) {
      u.hp = u.maxHp; t.pickup = null;
      await this.fx.pickup(u, t, 'PATCHED UP');
    }
  }

  async _attack(u, tx, ty, mode) {
    const hits = this.affected(u, tx, ty, mode);
    const tiles = this.footprint(u, tx, ty, mode);
    u.ap -= mode.ap;
    if (u.side === 'marine' && mode.pattern !== 'melee') { u.weapon.ammo -= mode.ammo; u.weapon.heat += mode.heat; }
    u.facing = this.dirToward(u, tx, ty);
    await this.fx.attack(u, { x: tx, y: ty }, mode, tiles);
    for (const h of hits) if (h.unit.alive) await this._damage(h.unit, h.dmg, u, h.note);
  }

  async _damage(target, dmg, source, note) {
    if (dmg <= 0) { await this.fx.note(target, 'DEFLECTED', 'bad'); return; }
    target.hp = Math.max(0, target.hp - dmg);
    await this.fx.damage(target, dmg, note);
    if (target.hp <= 0) await this._kill(target, source);
  }

  async _kill(target, source) {
    target.alive = false;
    if (source && source.side === 'marine' && target.side === 'alien') { source.kills++; source.xp += target.def.xp; }
    await this.fx.death(target);
    const ex = target.def && target.def.explode;
    if (ex) {
      await this.fx.explosion(target.x, target.y, ex.radius);
      const victims = this.units.filter(v => v.alive && Math.max(Math.abs(v.x - target.x), Math.abs(v.y - target.y)) <= ex.radius);
      for (const v of victims) if (v.alive) await this._damage(v, Math.max(1, ex.dmg - v.reduce), source, 'blast');
    }
    this._checkEnd();
  }

  // The first usable reaction for a guarding marine against `foe`, or null.
  reactionMode(m, foe) {
    if (!this.inCone(m, foe.x, foe.y)) return null;
    for (const mode of this.modes(m)) {
      if (!this.preview(m, foe.x, foe.y, mode).ok) continue;
      if (mode.pattern !== 'single' && mode.pattern !== 'melee'
        && this.affected(m, foe.x, foe.y, mode).some(h => h.unit.side === 'marine')) continue;
      return mode;
    }
    return null;
  }

  async _reactions(foe) {
    for (const m of this.marines()) {
      if (!foe.alive || this.over) break;
      if (!m.alive || !m.guard) continue;
      const mode = this.reactionMode(m, foe);
      if (!mode) continue;
      await this.fx.note(m, 'REACTION', 'info');
      await this._attack(m, foe.x, foe.y, mode);
    }
  }

  async _act(a) {
    const def = a.def;
    a.ap = a.maxAp; a.shots = 0; a.moved = false; a.provoked = false;
    await this.fx.activate(a);

    if (def.explode) {
      await this._approach(a, true);
      if (a.alive && this.marines().some(m => Math.max(Math.abs(m.x - a.x), Math.abs(m.y - a.y)) <= def.explode.radius)) {
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
      if (a.alive && !this.over && def.melee && !(shot && def.skirmisher)) {
        await this._approach(a, false);
        while (a.alive && !this.over && a.ap >= def.melee.ap) {
          const t = this._meleeTarget(a);
          if (!t) break;
          await this._provoke(a);
          if (!a.alive || this.over) break;
          await this._attack(a, t.x, t.y, { name: 'Claw', ...def.melee, pattern: 'melee' });
        }
      }
    }
    if (a.alive) { this.faceNearest(a); this.fx.turn(a); }
  }

  // An alien that attacks without having moved still gives guards one chance to fire.
  async _provoke(a) {
    if (a.moved || a.provoked) return;
    a.provoked = true;
    await this._reactions(a);
  }

  _rangedMode(a) { return { name: 'Acid', ...a.def.ranged, pattern: 'single', fx: 'acid' }; }

  _shootTarget(a, fx, fy) {
    const mode = this._rangedMode(a);
    let best = null;
    for (const m of this.marines()) {
      if (this.shotProblem(fx, fy, m.x, m.y, mode, a)) continue;
      if (!best || m.hp < best.hp) best = m;
    }
    return best;
  }

  async _tryShoot(a) {
    const r = a.def.ranged;
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

  _firingSpot(a) {
    const reach = this.flood(a.x, a.y, a.ap - a.def.ranged.ap);
    let best = null;
    for (const n of reach.values()) {
      if (n.cost === 0 || (best && n.cost >= best.cost)) continue;
      if (this._shootTarget(a, n.x, n.y)) best = n;
    }
    return best;
  }

  _meleeTarget(a) {
    let best = null;
    for (let d = 0; d < 4; d++) {
      if (!this.stepOk(a.x, a.y, d)) continue;
      const m = this.unitAt(a.x + DIRS[d].x, a.y + DIRS[d].y);
      if (m && m.side === 'marine' && (!best || m.hp < best.hp)) best = m;
    }
    return best;
  }

  // Walk towards the closest tile next to a marine. Bloaters only need to get within blast range.
  async _approach(a, loose) {
    const goals = new Map();
    for (const m of this.marines()) {
      for (let d = 0; d < 4; d++) {
        const x = m.x - DIRS[d].x, y = m.y - DIRS[d].y;
        if (this.stepOk(x, y, d)) goals.set(key(x, y), m);
      }
      if (loose) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (this.walkable(this.tile(m.x + dx, m.y + dy))) goals.set(key(m.x + dx, m.y + dy), m);
      }
    }
    if (goals.has(key(a.x, a.y))) return;
    const pick = reach => {
      let best = null;
      for (const [k, m] of goals) {
        const n = reach.get(k);
        if (!n) continue;
        if (!best || n.cost < best.cost || (n.cost === best.cost && m.hp < best.hp)) best = { ...n, node: n, hp: m.hp };
      }
      return best && best.node;
    };
    // Prefer a route that is actually open; otherwise queue up behind whoever is in the way.
    const node = pick(this.flood(a.x, a.y, 99)) || pick(this.flood(a.x, a.y, 99, { ignoreUnits: true }));
    if (node) await this._move(a, this.pathFrom(node).slice(0, a.ap));
  }

  async _spawn() {
    const sp = this.mission.spawn;
    if (!sp || this.spawnLeft <= 0) return;
    if (this.turn < sp.start || (this.turn - sp.start) % sp.every !== 0) return;
    for (const t of this.hatches) {
      if (this.spawnLeft <= 0) break;
      const kind = sp.pool[this.spawnCount++ % sp.pool.length];
      this.spawnLeft--;
      if (this.unitAt(t.x, t.y)) { await this.fx.hatchBlocked(t); continue; }
      const u = this.addAlien(kind, t.x, t.y);
      this.faceNearest(u);
      await this.fx.spawn(u);
    }
    this._checkEnd();
  }

  summary() {
    return {
      win: !!(this.result && this.result.win),
      text: this.result ? this.result.text : '',
      turns: this.turn,
      marines: this.units.filter(u => u.side === 'marine').map(u => ({ id: u.soldier.id, alive: u.alive, kills: u.kills, xp: u.xp })),
    };
  }
}
