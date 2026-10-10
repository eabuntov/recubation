// Three.js presentation layer. Builds the level from the battle's tile grid,
// animates what the rules engine reports, and answers "which tile is under the cursor".

import * as THREE from 'three';
import { DIRS } from './data.js';
import { key } from './battle.js';
import { buildMarine, buildAlien } from './models.js';
import { sfx } from './audio.js';

const HU = 0.7;        // world height of one level
const WALL_H = 1.1;
const SLAB = 0.3;      // how far floor slabs extend below their surface
const UP = new THREE.Vector3(0, 1, 0);

const OVERLAY = {
  move: [0x3fa9ff, 0.20],
  path: [0x7fd4ff, 0.55],
  cone: [0xffd24a, 0.10],
  target: [0xff4a3d, 0.42],
  blast: [0xff8a2a, 0.50],
  bad: [0xff2a2a, 0.25],
  use: [0x55ff9a, 0.45],
  hover: [0xffffff, 0.30],
};

const angleFor = d => -d * Math.PI / 2;

export class View {
  constructor(canvas, labels) {
    this.canvas = canvas;
    this.labels = labels;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);
    this.scene.fog = new THREE.Fog(0x05070a, 20, 52);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.raycaster = new THREE.Raycaster();

    this.cam = { target: new THREE.Vector3(), goal: new THREE.Vector3(), yaw: Math.PI / 6, yawGoal: Math.PI / 6, dist: 15, distGoal: 15, pitch: 0.95, shake: 0 };
    this.keys = new Set();
    this.tweens = [];
    this.speed = 1;
    this.time = 0;
    this.battle = null;
    this.attract = false;
    this.root = null;
    this.objs = new Map();     // unit id -> { group, model, label, ... }
    this.overlays = new Map(); // tile key -> mesh
    this.pickables = [];
    this.pickups = new Map();
    this.doors = new Map();
    this.terminals = new Map();
    this.selected = null;

    this.overlayMats = {};
    for (const k in OVERLAY) {
      this.overlayMats[k] = new THREE.MeshBasicMaterial({ color: OVERLAY[k][0], transparent: true, opacity: OVERLAY[k][1], depthWrite: false });
    }

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', e => { if (!e.repeat) this.keys.add(e.code); });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.resize();

    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.update(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- level construction

  pos(x, y, lift = 0) { return new THREE.Vector3(x, this.battle.heightAt(x, y) * HU + lift, y); }

  unload() {
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !Object.values(this.overlayMats).includes(o.material)) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        }
      });
    }
    this.labels.replaceChildren();
    this.root = null; this.battle = null; this.selected = null;
    this.objs.clear(); this.overlays.clear(); this.pickups.clear(); this.doors.clear(); this.terminals.clear();
    this.pickables = []; this.tweens = []; this.hatchRings = []; this.exitMats = [];
  }

  load(battle) {
    this.unload();
    this.battle = battle;
    const root = this.root = new THREE.Group();
    this.scene.add(root);
    const b = battle;

    const all = [];
    for (const row of b.tiles) for (const t of row) all.push(t);
    const slabs = all.filter(t => t.type !== 'void' && t.type !== 'wall' && t.type !== 'pit' && t.type !== 'ramp');
    const walls = all.filter(t => t.type === 'wall');

    const unit = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();

    const floor = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.35 }), slabs.length);
    slabs.forEach((t, i) => {
      const top = t.h * HU, height = top + SLAB;
      m4.makeScale(0.96, height, 0.96).setPosition(t.x, top - height / 2, t.y);
      floor.setMatrixAt(i, m4);
      const shade = ((t.x + t.y) % 2 ? 0.0 : 0.035) + (t.h ? 0.06 : 0);
      col.setRGB(0.20 + shade, 0.25 + shade, 0.31 + shade);
      if (t.exit) col.setRGB(0.12, 0.42, 0.26);
      if (t.hatch) col.setRGB(0.10, 0.08, 0.08);
      floor.setColorAt(i, col);
    });
    floor.receiveShadow = true; floor.castShadow = true;
    root.add(floor);

    const wall = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.55 }), walls.length);
    walls.forEach((t, i) => {
      const height = WALL_H + SLAB;
      m4.makeScale(1, height, 1).setPosition(t.x, WALL_H - height / 2, t.y);
      wall.setMatrixAt(i, m4);
      const n = ((t.x * 7 + t.y * 13) % 5) * 0.008;
      col.setRGB(0.10 + n, 0.125 + n, 0.16 + n);
      wall.setColorAt(i, col);
    });
    wall.receiveShadow = true; wall.castShadow = true;
    root.add(wall);

    // Wall caps: a thin lighter lid so wall tops read as a separate plane from above.
    const cap = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x3a4656, roughness: 0.5, metalness: 0.6 }), walls.length);
    walls.forEach((t, i) => { m4.makeScale(0.9, 0.04, 0.9).setPosition(t.x, WALL_H + 0.02, t.y); cap.setMatrixAt(i, m4); });
    root.add(cap);

    const plane = new THREE.PlaneGeometry(0.94, 0.94);
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const rampGeo = wedgeGeometry();
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x4a5564, roughness: 0.7, metalness: 0.4 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xffc400, emissive: 0xffc400, emissiveIntensity: 0.35, roughness: 0.6 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.85, metalness: 0.1 });
    const crateEdge = new THREE.LineBasicMaterial({ color: 0xc9a85a });
    const crateGeo = new THREE.BoxGeometry(0.74, 0.74, 0.74);
    const crateEdges = new THREE.EdgesGeometry(crateGeo);

    for (const t of all) {
      if (t.type === 'void' || t.type === 'wall') continue;
      const top = b.heightAt(t.x, t.y) * HU;

      if (t.type === 'ramp') {
        const g = new THREE.Group();
        g.position.set(t.x, 0, t.y);
        g.rotation.y = angleFor(t.ramp);
        const mesh = new THREE.Mesh(rampGeo, rampMat);
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
        for (const sx of [-0.4, 0.4]) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, Math.hypot(1, HU) * 0.96), stripe);
          s.position.set(sx, HU / 2 + 0.012, 0);
          s.rotation.x = Math.atan(HU);
          g.add(s);
        }
        root.add(g);
      }
      if (t.type === 'pit') continue;

      if (t.type === 'crate') {
        const c = new THREE.Mesh(crateGeo, crateMat);
        c.position.set(t.x, t.h * HU + 0.37, t.y);
        c.rotation.y = ((t.x * 31 + t.y * 17) % 7) * 0.05 - 0.15;
        c.castShadow = c.receiveShadow = true;
        c.add(new THREE.LineSegments(crateEdges, crateEdge));
        root.add(c);
      }
      if (t.type === 'door') this.buildDoor(t);
      if (t.type === 'terminal') this.buildTerminal(t);
      if (t.hatch) this.buildHatch(t);
      if (t.exit) this.buildExit(t);
      if (t.pickup) this.buildPickup(t);

      // Overlay quad (tilted on ramps) and an invisible pick surface.
      const holder = new THREE.Group();
      const o = new THREE.Mesh(plane, this.overlayMats.move);
      if (t.type === 'ramp') {
        holder.position.set(t.x, HU / 2 + 0.03, t.y);
        holder.rotation.y = angleFor(t.ramp);
        o.rotation.x = -Math.PI / 2 + Math.atan(HU);
        o.scale.y = Math.hypot(1, HU);
      } else {
        holder.position.set(t.x, top + 0.02, t.y);
        o.rotation.x = -Math.PI / 2;
      }
      o.visible = false;
      o.renderOrder = 2;
      holder.add(o);
      root.add(holder);
      this.overlays.set(key(t.x, t.y), o);

      const lift = t.type === 'crate' ? 0.75 : t.type === 'terminal' ? 0.8 : t.type === 'door' ? WALL_H : 0;
      const p = new THREE.Mesh(new THREE.BoxGeometry(1, Math.max(0.05, lift), 1), pickMat);
      p.position.set(t.x, top + lift / 2, t.y);
      p.userData.tile = t;
      root.add(p);
      this.pickables.push(p);
    }

    // Lighting: cold key light with shadows, dim fill, and coloured practicals.
    root.add(new THREE.HemisphereLight(0x9fb6d8, 0x1a1410, 0.9));
    const sun = new THREE.DirectionalLight(0xdfe8ff, 2.1);
    const cx = b.w / 2, cy = b.h / 2, span = Math.max(b.w, b.h) / 2 + 3;
    sun.position.set(cx - 7, 16, cy + 6);
    sun.target.position.set(cx, 0, cy);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 50 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    root.add(sun, sun.target);

    for (const u of b.units) if (u.alive) this.addUnit(u);

    // Selection ring and facing wedge, reused for whoever is selected.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    root.add(this.ring);

    const m = b.marines();
    const c = m.length
      ? m.reduce((v, u) => v.add(this.pos(u.x, u.y)), new THREE.Vector3()).multiplyScalar(1 / m.length)
      : new THREE.Vector3(b.w / 2, 0, b.h / 2);
    this.cam.target.copy(c); this.cam.goal.copy(c);
    this.cam.dist = this.cam.distGoal = 14;
    this.cam.yaw = this.cam.yawGoal = Math.PI / 6;
  }

  buildDoor(t) {
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.y);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.98, WALL_H, 0.98), new THREE.MeshStandardMaterial({ color: 0x4b3030, roughness: 0.5, metalness: 0.7 }));
    body.position.y = WALL_H / 2;
    body.castShadow = body.receiveShadow = true;
    const glow = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 1.6 });
    for (const y of [0.3, 0.8]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 1.0), glow);
      band.position.y = y;
      g.add(band);
    }
    g.add(body);
    this.root.add(g);
    this.doors.set(key(t.x, t.y), g);
  }

  buildTerminal(t) {
    const g = new THREE.Group();
    g.position.set(t.x, t.h * HU, t.y);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.62, 0.6), new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.5, metalness: 0.6 }));
    base.position.y = 0.31;
    base.castShadow = true;
    const screenMat = new THREE.MeshStandardMaterial({ color: 0xffb300, emissive: 0xffb300, emissiveIntensity: 1.8 });
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.46), screenMat);
    screen.position.y = 0.64;
    const light = new THREE.PointLight(0xffb300, 2.5, 4, 1.6);
    light.position.y = 1.0;
    g.add(base, screen, light);
    this.root.add(g);
    this.terminals.set(key(t.x, t.y), { screenMat, light });
  }

  buildHatch(t) {
    const g = new THREE.Group();
    g.position.set(t.x, t.h * HU + 0.012, t.y);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.42, 28), new THREE.MeshBasicMaterial({ color: 0xff2e2e, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.33, 28), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    hole.rotation.x = -Math.PI / 2;
    const light = new THREE.PointLight(0xff2e2e, 2.2, 4.5, 1.6);
    light.position.y = 0.5;
    g.add(ring, hole, light);
    g.userData.pulse = ring.material;
    this.root.add(g);
    (this.hatchRings ||= []).push(ring.material);
  }

  buildExit(t) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ color: 0x3dffa0, transparent: true, opacity: 0.25, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(t.x, t.h * HU + 0.014, t.y);
    m.renderOrder = 1;
    this.root.add(m);
    (this.exitMats ||= []).push(m.material);
  }

  buildPickup(t) {
    const g = new THREE.Group();
    g.position.set(t.x, t.h * HU + 0.4, t.y);
    const ammo = t.pickup === 'ammo';
    const color = ammo ? 0xffd23d : 0x4dff88;
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 });
    if (ammo) {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.18), mat));
    } else {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.1), mat), new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), mat));
    }
    this.root.add(g);
    this.pickups.set(key(t.x, t.y), g);
  }

  // ---------------------------------------------------------------- units

  addUnit(u) {
    const group = new THREE.Group();
    const built = u.side === 'marine' ? buildMarine(u.soldier.color) : buildAlien(u.kind);
    group.add(built.model);
    group.position.copy(this.pos(u.x, u.y));
    group.rotation.y = angleFor(u.facing);

    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, built.height, 0.7), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = built.height / 2;
    hit.userData.unit = u;
    group.add(hit);
    this.pickables.push(hit);

    if (u.side === 'marine') {
      const base = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.35, 32), new THREE.MeshBasicMaterial({ color: u.soldier.color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      base.rotation.x = -Math.PI / 2;
      base.position.y = 0.03;
      const nose = new THREE.Mesh(new THREE.CircleGeometry(0.1, 3), base.material);
      nose.rotation.x = -Math.PI / 2;
      nose.rotation.z = Math.PI / 2;
      nose.position.set(0, 0.03, -0.44);
      group.add(base, nose);
    }

    const label = document.createElement('div');
    label.className = 'ulabel ' + u.side;
    label.innerHTML = '<div class="hp"><i></i></div><div class="ap"></div>';
    this.labels.appendChild(label);

    this.root.add(group);
    const o = { u, group, model: built.model, mats: built.mats, height: built.height, label, rot: group.rotation.y, aim: null, phase: Math.random() * 6, hit, bob: built.bob };
    this.objs.set(u.id, o);
    this.syncLabel(o);
    return o;
  }

  syncLabel(o) {
    const u = o.u;
    o.label.querySelector('.hp i').style.width = (100 * u.hp / u.maxHp) + '%';
    o.label.classList.toggle('hurt', u.hp <= u.maxHp / 3);
    if (u.side === 'marine') {
      const ap = o.label.querySelector('.ap');
      const n = Math.max(u.ap, 0);
      if (ap.childElementCount !== n) ap.innerHTML = '<b></b>'.repeat(n);
    }
  }

  syncLabels() { for (const o of this.objs.values()) if (o.u.alive) this.syncLabel(o); }

  setSelected(u) {
    this.selected = u && u.alive ? u : null;
    this.ring.visible = !!this.selected;
  }

  // styles: Map tile key -> overlay style name
  setOverlays(styles) {
    for (const [k, mesh] of this.overlays) {
      const s = styles.get(k);
      mesh.visible = !!s;
      if (s) mesh.material = this.overlayMats[s];
    }
  }

  pick(clientX, clientY) {
    if (!this.battle) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    for (const h of this.raycaster.intersectObjects(this.pickables, false)) {
      const d = h.object.userData;
      if (d.unit) { if (d.unit.alive) return { x: d.unit.x, y: d.unit.y }; continue; }
      return { x: d.tile.x, y: d.tile.y };
    }
    return null;
  }

  // ---------------------------------------------------------------- camera

  focus(x, y, force = false) {
    const p = this.pos(x, y);
    if (!force) {
      const s = p.clone().project(this.camera);
      if (Math.abs(s.x) < 0.7 && Math.abs(s.y) < 0.6) return;
    }
    this.cam.goal.copy(p).setY(0);
  }

  panBy(dx, dy) {
    const c = this.cam, s = c.dist * 0.0017;
    const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw), fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    c.goal.x += (-rx * dx + fx * dy) * s;
    c.goal.z += (-rz * dx + fz * dy) * s;
    c.target.copy(c.goal);
    this.clampCam();
  }

  rotate(dir) { this.cam.yawGoal += dir * Math.PI / 2; }
  zoom(delta) { this.cam.distGoal = THREE.MathUtils.clamp(this.cam.distGoal * (delta > 0 ? 1.12 : 0.89), 6, 30); }

  clampCam() {
    if (!this.battle) return;
    const c = this.cam;
    c.goal.x = THREE.MathUtils.clamp(c.goal.x, 0, this.battle.w - 1);
    c.goal.z = THREE.MathUtils.clamp(c.goal.z, 0, this.battle.h - 1);
  }

  // ---------------------------------------------------------------- frame loop

  tween(ms, fn) {
    return new Promise(res => {
      this.tweens.push({ t: 0, ms: Math.max(1, ms / this.speed), fn, res });
    });
  }

  wait(ms) { return this.tween(ms, () => {}); }

  update(dt) {
    this.time += dt;
    const c = this.cam;
    if (this.attract) c.yawGoal += dt * 0.06;

    if (this.battle && !this.attract) {
      const k = this.keys, v = 9 * dt * (c.dist / 14);
      let dx = 0, dy = 0;
      if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
      if (k.has('KeyW') || k.has('ArrowUp')) dy -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) dy += 1;
      if (dx || dy) {
        const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw), fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
        c.goal.x += (rx * dx - fx * dy) * v;
        c.goal.z += (rz * dx - fz * dy) * v;
        this.clampCam();
      }
    }
    const ease = 1 - Math.exp(-dt * 9);
    c.target.lerp(c.goal, ease);
    c.yaw += (c.yawGoal - c.yaw) * ease;
    c.dist += (c.distGoal - c.dist) * ease;
    c.shake = Math.max(0, c.shake - dt * 2.5);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const sh = c.shake * c.shake * 0.35;
    this.camera.position.set(
      c.target.x + Math.sin(c.yaw) * cp * c.dist + (Math.random() - 0.5) * sh,
      c.target.y + sp * c.dist + (Math.random() - 0.5) * sh,
      c.target.z + Math.cos(c.yaw) * cp * c.dist,
    );
    this.camera.lookAt(c.target);

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt * 1000;
      const kk = Math.min(1, tw.t / tw.ms);
      tw.fn(kk);
      if (kk >= 1) { this.tweens.splice(i, 1); tw.res(); }
    }

    if (this.battle) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
      for (const m of this.exitMats || []) m.opacity = 0.16 + 0.2 * pulse;
      for (const m of this.hatchRings || []) m.color.setRGB(0.55 + 0.45 * pulse, 0.1, 0.1);
      for (const g of this.pickups.values()) { g.rotation.y += dt * 1.6; g.position.y += Math.sin(this.time * 2.4) * 0.0012; }

      for (const o of this.objs.values()) {
        if (!o.u.alive) continue;
        const goal = o.aim ?? angleFor(o.u.facing);
        let d = (goal - o.rot) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        o.rot += d * (1 - Math.exp(-dt * 18));
        o.group.rotation.y = o.rot;
        if (o.bob) o.bob(this.time + o.phase);
      }
      if (this.selected && this.selected.alive) {
        const o = this.objs.get(this.selected.id);
        this.ring.position.copy(o.group.position).setY(o.group.position.y + 0.04);
        this.ring.scale.setScalar(1 + 0.06 * Math.sin(this.time * 5));
      } else this.ring.visible = false;
    }

    this.renderer.render(this.scene, this.camera);

    // Project unit labels after the camera has settled for this frame.
    if (this.battle) {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight, v = new THREE.Vector3();
      for (const o of this.objs.values()) {
        if (!o.u.alive) continue;
        v.copy(o.group.position); v.y += o.height + 0.22;
        v.project(this.camera);
        const show = v.z < 1;
        o.label.style.display = show ? '' : 'none';
        if (show) o.label.style.transform = `translate(-50%,-100%) translate(${((v.x + 1) / 2 * w).toFixed(1)}px,${((1 - v.y) / 2 * h).toFixed(1)}px)`;
      }
    }
  }

  floatText(world, text, cls = '') {
    const v = world.clone().project(this.camera);
    if (v.z >= 1) return;
    const el = document.createElement('div');
    el.className = 'float ' + cls;
    el.textContent = text;
    el.style.left = ((v.x + 1) / 2 * this.canvas.clientWidth) + 'px';
    el.style.top = ((1 - v.y) / 2 * this.canvas.clientHeight) + 'px';
    this.labels.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  above(u) { const o = this.objs.get(u.id); return o.group.position.clone().setY(o.group.position.y + o.height + 0.3); }

  // ---------------------------------------------------------------- effects (called by the rules engine)

  turn(u) { /* rotation eases toward u.facing in update() */ }

  async activate(u) { this.focus(u.x, u.y); }

  async step(u, from, to) {
    const o = this.objs.get(u.id);
    const a = this.pos(from.x, from.y), b = this.pos(to.x, to.y);
    if (u.side === 'marine') { sfx.step(); this.syncLabel(o); } else sfx.skitter();
    await this.tween(u.side === 'marine' ? 150 : 115, k => {
      o.group.position.lerpVectors(a, b, k);
      o.group.position.y += Math.sin(k * Math.PI) * 0.07;
    });
  }

  async jump(u, from, to) {
    const o = this.objs.get(u.id);
    const a = this.pos(from.x, from.y), b = this.pos(to.x, to.y);
    sfx.jet();
    await this.tween(480, k => {
      o.group.position.lerpVectors(a, b, k);
      o.group.position.y += Math.sin(k * Math.PI) * 1.6;
    });
    this.syncLabel(o);
  }

  spark(p, color, size = 0.25, ms = 160) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(p);
    this.root.add(m);
    return this.tween(ms, k => { m.scale.setScalar(size * (0.3 + k)); m.material.opacity = 1 - k; })
      .then(() => { this.root.remove(m); m.geometry.dispose(); m.material.dispose(); });
  }

  beam(a, b, color, radius, ms) {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.lerpVectors(a, b, 0.5);
    m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    this.root.add(m);
    return this.tween(ms, k => { m.material.opacity = 1 - k; m.scale.x = m.scale.z = 1 - k * 0.6; })
      .then(() => { this.root.remove(m); m.geometry.dispose(); m.material.dispose(); });
  }

  projectile(a, b, color, size, ms, arc = 0) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color }));
    this.root.add(m);
    return this.tween(ms, k => { m.position.lerpVectors(a, b, k); m.position.y += Math.sin(k * Math.PI) * arc; })
      .then(() => { this.root.remove(m); m.geometry.dispose(); m.material.dispose(); });
  }

  async attack(u, target, mode, tiles) {
    const o = this.objs.get(u.id);
    const from = o.group.position.clone();
    const to = this.pos(target.x, target.y);
    const dir = to.clone().sub(from).setY(0).normalize();
    o.aim = Math.atan2(-dir.x, -dir.z);
    o.rot = o.aim; o.group.rotation.y = o.rot;
    const muzzle = from.clone().addScaledVector(dir, 0.45).setY(from.y + o.height * 0.6);
    const aimAt = to.clone().setY(to.y + 0.4);
    this.syncLabel(o);

    if (mode.pattern === 'melee') {
      sfx.slash();
      await this.tween(170, k => o.group.position.copy(from).addScaledVector(dir, Math.sin(k * Math.PI) * 0.35));
      o.group.position.copy(from);
    } else if (mode.fx === 'acid') {
      sfx.spit();
      await this.projectile(muzzle, aimAt, 0x9dff3a, 0.09, 60 + 28 * from.distanceTo(to), 0.3);
      this.spark(aimAt, 0x9dff3a, 0.3);
    } else if (mode.fx === 'flame') {
      sfx.flame();
      const puffs = tiles.map((t, i) => this.wait(i * 60).then(() => this.spark(this.pos(t.x, t.y, 0.4), i % 2 ? 0xff7a1a : 0xffc233, 0.6, 320)));
      await Promise.all(puffs);
    } else if (mode.fx === 'plasma') {
      sfx.plasma();
      this.cam.shake = 0.5;
      this.spark(muzzle, 0x7df9ff, 0.35, 250);
      await this.beam(muzzle, aimAt, 0x7df9ff, 0.07, 360);
    } else if (mode.fx === 'shell') {
      sfx.launch();
      await this.projectile(muzzle, to, 0xffe08a, 0.07, 80 + 40 * from.distanceTo(to), 1.6);
      await this.explosion(target.x, target.y, 1);
    } else {
      const rounds = Math.min(4, mode.ammo || 1);
      for (let i = 0; i < rounds; i++) {
        (mode.dmg >= 10 ? sfx.heavy : sfx.shot)();
        this.spark(muzzle, 0xfff2b0, 0.2, 90);
        const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15);
        const done = this.beam(muzzle, aimAt.clone().add(jitter), 0xffe9a0, 0.018, 110);
        if (i === rounds - 1) await done; else await this.wait(55);
      }
    }
    o.aim = null;
    o.rot = angleFor(u.facing);
  }

  async damage(u, dmg, note) {
    const o = this.objs.get(u.id);
    this.syncLabel(o);
    sfx.hit();
    this.floatText(this.above(u), '-' + dmg + (note ? ' ' + note : ''), u.side === 'marine' ? 'dmg-us' : 'dmg');
    for (const m of o.mats) m.emissive.setRGB(1, 0.25, 0.15);
    const home = o.model.position.clone();
    await this.tween(170, k => {
      o.model.position.x = home.x + Math.sin(k * 25) * 0.04 * (1 - k);
      for (const m of o.mats) m.emissive.lerpColors(new THREE.Color(1, 0.25, 0.15), m.userData.glow, k);
    });
    o.model.position.copy(home);
    for (const m of o.mats) m.emissive.copy(m.userData.glow);
  }

  async note(u, text, cls) {
    if (text === 'DEFLECTED') { sfx.clang(); this.spark(this.above(u).setY(this.above(u).y - 0.5), 0xffffff, 0.2); }
    else if (cls === 'good') sfx.good();
    this.floatText(this.above(u), text, cls);
    this.syncLabel(this.objs.get(u.id));
    await this.wait(cls === 'info' ? 180 : 260);
  }

  async heal(u, v, amount) {
    sfx.good();
    this.floatText(this.above(v), '+' + amount, 'good');
    this.syncLabels();
    await this.wait(260);
  }

  async death(u) {
    const o = this.objs.get(u.id);
    o.label.remove();
    this.pickables = this.pickables.filter(p => p !== o.hit);
    if (this.selected === u) this.setSelected(null);
    if (u.side === 'marine') {
      sfx.down();
      this.floatText(this.above(u), u.name + ' is down', 'dmg-us');
      await this.tween(420, k => { o.model.rotation.x = -k * Math.PI / 2; o.model.position.y = k * 0.12; });
      for (const m of o.mats) { m.color.multiplyScalar(0.35); m.emissive.setScalar(0); }
    } else {
      sfx.squelch();
      const gore = new THREE.Mesh(new THREE.CircleGeometry(0.34 * (u.def.scale || 1), 14), new THREE.MeshBasicMaterial({ color: 0x1d2b10, transparent: true, opacity: 0.85, depthWrite: false }));
      gore.rotation.x = -Math.PI / 2;
      gore.position.copy(o.group.position).setY(o.group.position.y + 0.016);
      gore.renderOrder = 1;
      this.root.add(gore);
      await this.tween(260, k => { o.group.scale.set(1 + k * 0.3, 1 - k * 0.95, 1 + k * 0.3); gore.scale.setScalar(0.3 + k * 0.7); });
      this.root.remove(o.group);
      this.objs.delete(u.id);
    }
  }

  async explosion(x, y, r) {
    sfx.boom();
    this.cam.shake = 1;
    const p = this.pos(x, y, 0.4);
    const light = new THREE.PointLight(0xff8a2a, 30, 8, 1.5);
    light.position.copy(p);
    this.root.add(light);
    this.spark(p, 0xfff0a0, r + 0.4, 220);
    await this.tween(380, k => { light.intensity = 30 * (1 - k); }).then(() => this.root.remove(light));
    this.spark(p, 0xff5a1a, r + 0.9, 300);
  }

  async spawn(u) {
    const o = this.addUnit(u);
    sfx.spawn();
    this.focus(u.x, u.y);
    this.floatText(this.pos(u.x, u.y, 1.2), 'HATCH', 'bad');
    await this.tween(300, k => o.group.scale.setScalar(0.05 + 0.95 * k));
  }

  async hatchBlocked(t) {
    sfx.clang();
    this.floatText(this.pos(t.x, t.y, 1.5), 'SEALED', 'good');
    await this.wait(200);
  }

  async pickup(u, t, text) {
    const g = this.pickups.get(key(t.x, t.y));
    if (g) { this.root.remove(g); this.pickups.delete(key(t.x, t.y)); }
    sfx.good();
    this.floatText(this.above(u), text, 'good');
    this.syncLabels();
  }

  async terminal(u, t, doors) {
    const term = this.terminals.get(key(t.x, t.y));
    term.screenMat.color.set(0x3dffa0); term.screenMat.emissive.set(0x3dffa0); term.light.color.set(0x3dffa0);
    sfx.good();
    this.syncLabels();
    this.floatText(this.pos(t.x, t.y, 1.3), 'OVERRIDE ACCEPTED', 'good');
    if (!doors.length) return;
    sfx.door();
    this.focus(doors[0].x, doors[0].y);
    const groups = doors.map(d => this.doors.get(key(d.x, d.y)));
    await this.tween(650, k => { for (const g of groups) g.position.y = -k * (WALL_H + 0.05); });
    for (const g of groups) this.root.remove(g);
  }
}

// Ramp rising toward -z (north), from y=0 at z=+0.5 to y=HU at z=-0.5.
function wedgeGeometry() {
  const w = 0.48, a = [-w, 0, 0.5], b = [w, 0, 0.5], c = [w, HU, -0.5], d = [-w, HU, -0.5];
  const e = [-w, -SLAB, 0.5], f = [w, -SLAB, 0.5], g = [w, -SLAB, -0.5], h = [-w, -SLAB, -0.5];
  const quads = [
    [a, b, c, d],       // slope
    [e, a, d, h],       // west side
    [b, f, g, c],       // east side
    [c, g, h, d],       // back
    [e, f, b, a],       // front lip
  ];
  const v = [];
  for (const [p, q, r, s] of quads) v.push(...p, ...q, ...r, ...p, ...r, ...s);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}
