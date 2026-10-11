// Player input for the tactical view: selection, hover previews, clicks and keys.

import { DIRS } from './data.js';
import { key } from './battle.js';
import { sfx, toggleMute } from './audio.js';

const DRAG_PX = 6;
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class Tactical {
  constructor(view, ui, handlers) {
    this.view = view;
    this.ui = ui;
    this.handlers = handlers; // { help, abort }
    this.battle = null;
    this.sel = null;
    this.modeIdx = 0;
    this.armed = null;       // gear item waiting for a target
    this.hover = null;
    this.mouse = { x: 0, y: 0, shift: false, over: false };
    this.base = new Map();   // overlays that do not depend on the cursor
    this.reach = new Map();
    this.drag = null;

    const c = view.canvas;
    c.addEventListener('pointerdown', e => this.onDown(e));
    c.addEventListener('pointermove', e => this.onMove(e));
    c.addEventListener('pointerup', e => this.onUp(e));
    c.addEventListener('pointerleave', () => { this.mouse.over = false; this.hover = null; this.ui.tip(null); this.paint(); });
    view.onCameraMove = () => { if (this.battle && !this.dragging) { this.repick(); this.onHover(); } };
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => { e.preventDefault(); if (this.battle) view.zoom(e.deltaY); }, { passive: false });
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => { if (e.key === 'Shift') { this.mouse.shift = false; this.onHover(); } });

    document.getElementById('btn-end').addEventListener('click', () => this.endTurn());
    document.getElementById('btn-help').addEventListener('click', () => handlers.help());
    document.getElementById('btn-abort').addEventListener('click', () => handlers.abort());
    document.getElementById('btn-mute').addEventListener('click', () => this.mute());
    document.getElementById('btn-speed').addEventListener('click', () => this.fast());
  }

  start(battle) {
    this.battle = battle;
    this.sel = null; this.modeIdx = 0; this.armed = null; this.hover = null;
  }

  stop() { this.battle = null; this.ui.tip(null); }

  get ready() { const b = this.battle; return !!b && !b.busy && !b.over && b.phase === 'player'; }
  get mode() { return this.sel ? this.battle.modes(this.sel)[this.modeIdx] : null; }
  get dragging() { return !!this.drag && this.drag.moved; }

  // A cursor that has not moved can still end up over a different tile when the camera or a unit does.
  repick() {
    if (this.mouse.over && !this.dragging) this.hover = this.view.pick(this.mouse.x, this.mouse.y);
  }

  // ---------------------------------------------------------------- state -> screen

  refresh() {
    const b = this.battle;
    if (!b) return;
    if (this.sel && !this.sel.alive) this.sel = null;
    if (!this.sel) { this.sel = b.marines().find(m => m.ap > 0) || b.marines()[0] || null; this.modeIdx = 0; this.armed = null; }
    if (this.sel && this.modeIdx >= b.modes(this.sel).length) this.modeIdx = 0;
    if (this.armed && (this.armed.charges <= 0 || !this.sel || !this.sel.gear.includes(this.armed))) this.armed = null;
    const s = this.sel;
    this.view.setSelected(s);
    this.view.syncLabels();

    this.base = new Map();
    this.reach = new Map();
    if (s && this.ready) {
      const range = s.weapon.range;
      // Reaction arc: where this trooper would fire during the enemy phase.
      for (let y = s.y - range; y <= s.y + range; y++) for (let x = s.x - range; x <= s.x + range; x++) {
        const t = b.tile(x, y);
        if (!t || !b.walkable(t) || !b.inCone(s, x, y)) continue;
        if (Math.hypot(x - s.x, y - s.y) > range + 0.5 || b.sightBlocked(s.x, s.y, x, y)) continue;
        this.base.set(key(x, y), 'cone');
      }
      if (this.armed && this.armed.def.active === 'jump') {
        const r = this.armed.def.range;
        for (let y = s.y - r; y <= s.y + r; y++) for (let x = s.x - r; x <= s.x + r; x++) {
          if (!b.gearProblem(s, this.armed, x, y)) this.base.set(key(x, y), 'use');
        }
      } else if (this.armed && this.armed.def.active === 'heal') {
        for (const m of b.marines()) if (!b.gearProblem(s, this.armed, m.x, m.y)) this.base.set(key(m.x, m.y), 'use');
      } else {
        this.reach = b.flood(s.x, s.y, s.ap);
        for (const [k, n] of this.reach) if (n.cost > 0) this.base.set(k, 'move');
        for (const a of b.aliens()) if (b.preview(s, a.x, a.y, this.mode).ok) this.base.set(key(a.x, a.y), 'target');
        for (const d of DIRS) if (!b.terminalProblem(s, s.x + d.x, s.y + d.y)) this.base.set(key(s.x + d.x, s.y + d.y), 'use');
      }
    }
    this.ui.hud(b, s, this.modeIdx, this.armed, {
      select: u => this.select(u),
      mode: i => { this.modeIdx = i; this.armed = null; this.refresh(); },
      gear: g => this.gear(g),
    });
    this.repick();
    this.onHover();
  }

  paint(extra) {
    if (!this.battle) return;
    const styles = new Map(this.base);
    if (extra) for (const [k, v] of extra) styles.set(k, v);
    this.view.setOverlays(styles);
  }

  // Recompute the cursor-dependent overlay and tooltip.
  onHover() {
    const b = this.battle;
    if (!b) return;
    const hv = this.hover, s = this.sel, extra = new Map(), lines = [];
    if (!hv) { this.paint(); this.ui.tip(null); return; }
    const k = key(hv.x, hv.y), t = b.tile(hv.x, hv.y), u = b.unitAt(hv.x, hv.y);
    extra.set(k, 'hover');

    if (u && u.side === 'alien') {
      lines.push(`<b>${esc(u.name)}</b> <span class="dim">HP ${u.hp}/${u.maxHp}</span>`, `<span class="dim">${esc(u.def.desc)}</span>`);
    } else if (u) {
      lines.push(`<b>${esc(u.name)}</b> <span class="dim">HP ${u.hp}/${u.maxHp} · AP ${u.ap}</span>`, `<span class="dim">${esc(u.weapon.def.name)} · ${u.weapon.ammo} rds</span>`);
    } else if (t.terminal) {
      lines.push('<b>Terminal</b>', t.terminal.used ? '<span class="dim">Override accepted</span>' : '<span class="dim">Opens a blast door</span>');
    } else if (t.type === 'door') lines.push('<b>Blast door</b>', '<span class="dim">Sealed. Find its terminal.</span>');
    else if (t.hatch) {
      const n = b.nextSpawnIn();
      lines.push('<b>Brood hatch</b>', `<span class="dim">${n == null ? 'Dormant' : n === 0 ? 'Opens this turn' : `Opens in ${n} turn${n === 1 ? '' : 's'}`}. Stand on it to seal it.</span>`);
    } else if (t.pickup) lines.push(t.pickup === 'ammo' ? '<b>Ammunition</b>' : '<b>Aid station</b>', '<span class="dim">Walk over it to use it.</span>');
    else if (t.exit) lines.push('<b>Extraction zone</b>');
    else if (t.type === 'crate') lines.push('<b>Crate</b>', '<span class="dim">Blocks movement, not fire.</span>');

    if (s && this.ready) {
      if (this.armed) {
        const kind = this.armed.def.active;
        const problem = b.gearProblem(s, this.armed, hv.x, hv.y);
        lines.push(problem ? `<span class="bad">${esc(this.armed.def.name)}: ${esc(problem)}</span>` : `<span class="good">${esc(this.armed.def.name)} (${this.armed.def.ap} AP)</span>`);
        extra.set(k, problem ? 'bad' : 'use');
        if (kind === 'jump' && !problem) extra.set(k, 'path');
      } else if ((u && u.side === 'alien') || (this.mouse.shift && this.mode.pattern !== 'single' && this.mode.pattern !== 'melee' && !u)) {
        const mode = this.mode, p = b.preview(s, hv.x, hv.y, mode);
        if (p.ok) {
          for (const f of p.tiles) extra.set(key(f.x, f.y), mode.pattern === 'single' || mode.pattern === 'melee' ? 'target' : 'blast');
          for (const hit of p.hits) {
            const dead = hit.dmg >= hit.unit.hp;
            const cls = hit.unit.side === 'marine' ? 'bad' : hit.dmg ? 'good' : 'warn';
            lines.push(`<span class="${cls}">${esc(mode.name)} → ${esc(hit.unit.name)}: ${hit.dmg ? hit.dmg + ' dmg' : 'no effect'}${hit.note ? ' (' + esc(hit.note) + ')' : ''}${dead ? ' · kills' : ''}</span>`);
          }
          if (!p.hits.length) lines.push('<span class="dim">Nothing in the blast</span>');
          lines.push(`<span class="dim">${mode.ap} AP</span>`);
        } else {
          lines.push(`<span class="bad">${esc(p.problem)}</span>`);
          extra.set(k, 'bad');
        }
      } else if (t.terminal && !t.terminal.used) {
        const problem = b.terminalProblem(s, hv.x, hv.y);
        lines.push(problem ? `<span class="bad">${esc(problem)}</span>` : '<span class="good">Activate (1 AP)</span>');
      } else if (!u) {
        const n = this.reach.get(k);
        if (n && n.cost > 0) {
          for (const st of b.pathFrom(n)) extra.set(key(st.x, st.y), 'path');
          lines.push(`Move <span class="dim">${n.cost} AP · ${s.ap - n.cost} left</span>`);
        }
      }
    }
    this.paint(extra);
    this.ui.tip(lines.length ? lines.map(l => `<div>${l}</div>`).join('') : null, this.mouse.x, this.mouse.y);
  }

  // ---------------------------------------------------------------- commands

  select(u) {
    if (!this.battle || !u.alive) return;
    if (this.sel !== u) { this.sel = u; this.modeIdx = 0; this.armed = null; }
    sfx.click();
    this.refresh();
  }

  gear(g) {
    if (!this.ready) return;
    const b = this.battle, s = this.sel, kind = g.def.active;
    if (kind === 'stim' || kind === 'reload') { b.useGear(s, g); return; }
    this.armed = this.armed === g ? null : g;
    this.refresh();
  }

  endTurn() {
    if (!this.ready) return;
    sfx.click();
    this.armed = null;
    this.ui.tip(null);
    this.battle.endTurn();
    this.refresh();
  }

  mute() { document.getElementById('btn-mute').textContent = toggleMute() ? 'Muted' : 'Sound'; }

  fast() {
    this.view.speed = this.view.speed === 1 ? 2.5 : 1;
    document.getElementById('btn-speed').textContent = this.view.speed === 1 ? '1×' : '2.5×';
  }

  click(x, y, shift) {
    const b = this.battle, s = this.sel;
    if (!this.ready) return;
    const u = b.unitAt(x, y), t = b.tile(x, y);

    if (this.armed && s) {
      const problem = b.gearProblem(s, this.armed, x, y);
      if (problem) return this.ui.toast(problem);
      const g = this.armed;
      this.armed = null;
      b.useGear(s, g, x, y);
      return;
    }
    if (u && u.side === 'marine') return this.select(u);
    if (!s) return;

    const mode = this.mode;
    const ground = shift && !u && mode.pattern !== 'single' && mode.pattern !== 'melee';
    if ((u && u.side === 'alien') || ground) {
      const p = b.preview(s, x, y, mode);
      if (!p.ok) return this.ui.toast(p.problem);
      b.attack(s, x, y, mode);
      return;
    }
    if (t && t.terminal) {
      const problem = b.terminalProblem(s, x, y);
      if (problem) return this.ui.toast(problem);
      b.useTerminal(s, x, y);
      return;
    }
    const n = this.reach.get(key(x, y));
    if (n && n.cost > 0) b.move(s, b.pathFrom(n));
  }

  face(x, y) {
    const b = this.battle, s = this.sel;
    if (!this.ready || !s) return;
    if (this.armed) { this.armed = null; this.refresh(); return; }
    if (x === s.x && y === s.y) return;
    const dx = x - s.x, dy = y - s.y;
    const d = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    b.setFacing(s, d);
  }

  // ---------------------------------------------------------------- raw input

  onDown(e) {
    if (!this.battle) return;
    this.drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    this.view.canvas.setPointerCapture(e.pointerId);
  }

  onMove(e) {
    if (!this.battle) return;
    this.mouse = { x: e.clientX, y: e.clientY, shift: e.shiftKey, over: true };
    const d = this.drag;
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX) d.moved = true;
      if (d.moved) {
        this.view.panBy(e.movementX, e.movementY);
        this.ui.tip(null);
        return;
      }
    }
    const hit = this.view.pick(e.clientX, e.clientY);
    if ((hit && key(hit.x, hit.y)) !== (this.hover && key(this.hover.x, this.hover.y))) { this.hover = hit; }
    this.onHover();
  }

  onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!this.battle || !d) return;
    if (d.moved) { this.repick(); this.onHover(); return; }
    const hit = this.view.pick(e.clientX, e.clientY);
    if (!hit) return;
    if (d.button === 0) this.click(hit.x, hit.y, e.shiftKey);
    else if (d.button === 2) this.face(hit.x, hit.y);
  }

  onKey(e) {
    if (!this.battle || !document.getElementById('screen').hidden) {
      if (e.code === 'Escape' && this.battle && document.getElementById('screen').classList.contains('modal')) this.handlers.closeHelp();
      return;
    }
    if (e.key === 'Shift') { this.mouse.shift = true; this.onHover(); return; }
    const b = this.battle;
    switch (e.code) {
      case 'KeyQ': this.view.rotate(-1); break;
      case 'KeyE': this.view.rotate(1); break;
      case 'KeyF': this.fast(); break;
      case 'KeyM': this.mute(); break;
      case 'KeyH': this.handlers.help(); break;
      case 'Space': if (this.sel) this.view.focus(this.sel.x, this.sel.y, true); e.preventDefault(); break;
      case 'Enter': this.endTurn(); break;
      case 'Escape': if (this.armed) { this.armed = null; this.refresh(); } break;
      case 'KeyR': if (this.ready && this.sel) b.setFacing(this.sel, (this.sel.facing + 1) % 4); break;
      case 'Tab': {
        e.preventDefault();
        const ms = b.marines();
        if (!ms.length) break;
        const i = ms.indexOf(this.sel);
        const order = [...ms.slice(i + 1), ...ms.slice(0, i + 1)];
        this.select(order.find(m => m.ap > 0) || order[0]);
        this.view.focus(this.sel.x, this.sel.y);
        break;
      }
      default:
        if (/^Digit[1-9]$/.test(e.code) && this.sel) {
          const i = +e.code.slice(5) - 1;
          if (i < b.modes(this.sel).length) { this.modeIdx = i; this.armed = null; sfx.click(); this.refresh(); }
        }
    }
  }
}
