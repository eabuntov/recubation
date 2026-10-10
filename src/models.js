// Procedural low-poly figures. Every model faces -z and stands on y=0.
// Each builder returns { model, mats, height, bob } where `mats` are the
// materials to flash on hit and `bob(t)` is an optional idle animation.

import * as THREE from 'three';

function kit() {
  const mats = [];
  const model = new THREE.Group();
  const mat = (color, opts = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...opts });
    m.userData.glow = m.emissive.clone();
    mats.push(m);
    return m;
  };
  const add = (geo, m, x, y, z, parent = model) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (w, h, d, m, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, parent);
  const ball = (r, m, x, y, z, parent) => add(new THREE.SphereGeometry(r, 14, 10), m, x, y, z, parent);
  // A leg is a thin cylinder from a hip point on the body out and down to the floor.
  const leg = (m, hx, hy, hz, fx, fz, r = 0.022, parent) => {
    const a = new THREE.Vector3(hx, hy, hz), b = new THREE.Vector3(fx, 0, fz);
    const knee = a.clone().lerp(b, 0.45).setY(hy + 0.12);
    for (const [p, q] of [[a, knee], [knee, b]]) {
      const len = p.distanceTo(q);
      const c = add(new THREE.CylinderGeometry(r, r * 0.7, len, 5), m, 0, 0, 0, parent);
      c.position.lerpVectors(p, q, 0.5);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize());
    }
  };
  return { mats, model, mat, box, ball, leg, add };
}

const glow = (color, k = 1.4) => ({ emissive: color, emissiveIntensity: k });

export function buildMarine(color) {
  const { mats, model, mat, box } = kit();
  const plate = mat(0x6d7885, { metalness: 0.55, roughness: 0.45 });
  const under = mat(0x1d222a, { roughness: 0.8 });
  const trim = mat(color, glow(color, 0.9));
  const visor = mat(color, glow(color, 2.2));

  box(0.15, 0.34, 0.18, under, -0.11, 0.17, 0);
  box(0.15, 0.34, 0.18, under, 0.11, 0.17, 0);
  box(0.17, 0.1, 0.24, plate, -0.11, 0.05, -0.02);
  box(0.17, 0.1, 0.24, plate, 0.11, 0.05, -0.02);
  const torso = new THREE.Group();
  model.add(torso);
  box(0.44, 0.34, 0.28, plate, 0, 0.53, 0, torso);
  box(0.36, 0.1, 0.24, under, 0, 0.36, 0, torso);
  box(0.12, 0.2, 0.02, trim, 0, 0.55, -0.15, torso);
  box(0.2, 0.14, 0.24, plate, -0.31, 0.66, 0, torso);
  box(0.2, 0.14, 0.24, plate, 0.31, 0.66, 0, torso);
  box(0.2, 0.03, 0.1, trim, -0.31, 0.74, 0, torso);
  box(0.2, 0.03, 0.1, trim, 0.31, 0.74, 0, torso);
  box(0.24, 0.21, 0.25, plate, 0, 0.83, 0, torso);
  box(0.2, 0.075, 0.03, visor, 0, 0.84, -0.125, torso);
  box(0.32, 0.32, 0.13, under, 0, 0.56, 0.2, torso);
  box(0.1, 0.26, 0.11, plate, -0.29, 0.47, -0.06, torso);
  box(0.1, 0.14, 0.3, plate, 0.25, 0.5, -0.16, torso);
  box(0.09, 0.11, 0.52, under, 0.15, 0.5, -0.33, torso);
  box(0.05, 0.05, 0.14, plate, 0.15, 0.5, -0.62, torso);

  return { model, mats, height: 0.95, bob: t => { torso.position.y = Math.sin(t * 2.2) * 0.008; } };
}

function skitter() {
  const { mats, model, mat, ball, leg } = kit();
  const shell = mat(0x72913a, { roughness: 0.45 });
  const limb = mat(0x2f3d1c);
  const eye = mat(0xffe14d, glow(0xffe14d, 2));
  const body = new THREE.Group();
  model.add(body);
  ball(0.22, shell, 0, 0.22, 0.04, body).scale.set(1, 0.6, 1.35);
  ball(0.12, shell, 0, 0.23, -0.27, body);
  ball(0.03, eye, -0.06, 0.27, -0.36, body);
  ball(0.03, eye, 0.06, 0.27, -0.36, body);
  for (const s of [-1, 1]) for (const z of [-0.14, 0.04, 0.22]) leg(limb, s * 0.14, 0.2, z, s * 0.42, z * 1.5);
  return { model, mats, height: 0.5, bob: t => { body.position.y = Math.sin(t * 9) * 0.012; } };
}

function spitter() {
  const { mats, model, mat, ball, add, leg } = kit();
  const hide = mat(0x6d438f, { roughness: 0.5 });
  const limb = mat(0x33203f);
  const sac = mat(0x9dff3a, glow(0x9dff3a, 1.3));
  const eye = mat(0xff5a5a, glow(0xff5a5a, 2));
  const body = new THREE.Group();
  model.add(body);
  add(new THREE.ConeGeometry(0.22, 0.6, 9), hide, 0, 0.36, 0.04, body);
  const s = ball(0.16, sac, 0, 0.58, 0.1, body);
  ball(0.13, hide, 0, 0.72, -0.1, body);
  add(new THREE.ConeGeometry(0.05, 0.2, 6), limb, 0, 0.7, -0.26, body).rotation.x = -Math.PI / 2;
  ball(0.028, eye, -0.07, 0.77, -0.19, body);
  ball(0.028, eye, 0.07, 0.77, -0.19, body);
  for (const sx of [-1, 1]) for (const z of [-0.1, 0.16]) leg(limb, sx * 0.12, 0.22, z, sx * 0.36, z * 1.6);
  return { model, mats, height: 0.9, bob: t => { s.scale.setScalar(1 + Math.sin(t * 3) * 0.12); } };
}

function shellback() {
  const { mats, model, mat, ball, add, leg } = kit();
  const hide = mat(0x6a4a34, { roughness: 0.7 });
  const plate = mat(0x2a2e36, { metalness: 0.75, roughness: 0.3 });
  const limb = mat(0x30231a);
  const soft = mat(0xff8a2a, glow(0xff8a2a, 1.6));
  const eye = mat(0xffe14d, glow(0xffe14d, 2));
  const body = new THREE.Group();
  model.add(body);
  ball(0.3, hide, 0, 0.34, 0.06, body).scale.set(1, 0.85, 1.25);
  // The frontal plate: a slice of a sphere, opening toward the rear.
  const shield = add(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI), plate, 0, 0.36, -0.1, body);
  shield.rotation.y = Math.PI;
  shield.scale.set(1, 0.95, 0.55);
  shield.material.side = THREE.DoubleSide;
  ball(0.035, eye, -0.1, 0.5, -0.34, body);
  ball(0.035, eye, 0.1, 0.5, -0.34, body);
  ball(0.12, soft, 0, 0.36, 0.4, body);
  for (const s of [-1, 1]) for (const z of [-0.08, 0.2]) leg(limb, s * 0.2, 0.26, z, s * 0.46, z * 1.5, 0.04);
  return { model, mats, height: 0.8, bob: t => { body.position.y = Math.sin(t * 2.5) * 0.01; } };
}

function bloater() {
  const { mats, model, mat, ball, leg } = kit();
  const sac = mat(0xb9d43a, { ...glow(0x8fae1e, 0.8), roughness: 0.3 });
  const vein = mat(0xff7a1a, glow(0xff7a1a, 1.8));
  const limb = mat(0x3a421c);
  const body = new THREE.Group();
  model.add(body);
  const s = ball(0.3, sac, 0, 0.44, 0, body);
  for (const [x, y, z] of [[0.2, 0.6, -0.12], [-0.18, 0.52, 0.18], [0.05, 0.3, -0.28], [-0.12, 0.7, -0.08]]) ball(0.06, vein, x, y, z, body);
  for (const sx of [-1, 1]) for (const z of [-0.12, 0.12]) leg(limb, sx * 0.14, 0.22, z, sx * 0.34, z * 1.8);
  return { model, mats, height: 0.85, bob: t => { const k = 1 + Math.sin(t * 5) * 0.07; body.scale.set(k, 2 - k, k); s.material.emissiveIntensity = 0.8 + Math.sin(t * 5) * 0.4; } };
}

function stalker() {
  const { mats, model, mat, ball, box, add, leg } = kit();
  const hide = mat(0x8f2f2f, { roughness: 0.4 });
  const limb = mat(0x2e1414);
  const blade = mat(0xe8e8f0, { metalness: 0.9, roughness: 0.2, ...glow(0xff3030, 0.35) });
  const eye = mat(0xffffff, glow(0xffffff, 2));
  const body = new THREE.Group();
  model.add(body);
  ball(0.17, hide, 0, 0.5, 0.06, body).scale.set(0.8, 0.75, 2.0);
  add(new THREE.ConeGeometry(0.1, 0.34, 7), hide, 0, 0.54, -0.42, body).rotation.x = -Math.PI / 2;
  ball(0.025, eye, -0.05, 0.6, -0.4, body);
  ball(0.025, eye, 0.05, 0.6, -0.4, body);
  for (const s of [-1, 1]) {
    const b = box(0.02, 0.08, 0.46, blade, s * 0.2, 0.46, -0.34, body);
    b.rotation.y = s * 0.25;
  }
  for (const s of [-1, 1]) for (const z of [-0.12, 0.26]) leg(limb, s * 0.1, 0.46, z, s * 0.4, z * 1.4, 0.026);
  return { model, mats, height: 0.9, bob: t => { body.position.y = Math.sin(t * 6) * 0.015; body.rotation.z = Math.sin(t * 3) * 0.04; } };
}

function matriarch() {
  const { mats, model, mat, ball, add, leg } = kit();
  const hide = mat(0x5d2c50, { roughness: 0.5 });
  const plate = mat(0x23202a, { metalness: 0.8, roughness: 0.3 });
  const limb = mat(0x241420);
  const sac = mat(0xff8a2a, glow(0xff8a2a, 1.5));
  const eye = mat(0xff3030, glow(0xff3030, 2.4));
  const body = new THREE.Group();
  model.add(body);
  const belly = ball(0.44, hide, 0, 0.52, 0.3, body);
  belly.scale.set(1, 0.9, 1.2);
  ball(0.32, hide, 0, 0.62, -0.2, body);
  ball(0.2, hide, 0, 0.72, -0.52, body);
  const shield = add(new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI), plate, 0, 0.6, -0.34, body);
  shield.rotation.y = Math.PI;
  shield.scale.set(1, 0.9, 0.6);
  shield.material.side = THREE.DoubleSide;
  for (const [x, y] of [[-0.1, 0.8], [0.1, 0.8], [-0.05, 0.72], [0.05, 0.72], [0, 0.86]]) ball(0.03, eye, x, y, -0.68, body);
  const sacs = [[0.3, 0.7, 0.3], [-0.28, 0.72, 0.4], [0, 0.9, 0.36], [0.16, 0.66, 0.68], [-0.14, 0.6, 0.72]].map(([x, y, z]) => ball(0.1, sac, x, y, z, body));
  for (const s of [-1, 1]) for (const z of [-0.3, 0, 0.3]) leg(limb, s * 0.26, 0.5, z, s * 0.62, z * 1.5, 0.05);
  return { model, mats, height: 1.05, bob: t => { body.position.y = Math.sin(t * 1.8) * 0.02; sacs.forEach((s, i) => s.scale.setScalar(1 + Math.sin(t * 2.5 + i) * 0.15)); } };
}

const BUILDERS = { skitter, spitter, carapace: shellback, bloater, stalker, behemoth: matriarch };
const SCALE = { skitter: 0.85, spitter: 0.9, carapace: 1.1, bloater: 0.9, stalker: 1.0, behemoth: 1.45 };

export function buildAlien(kind) {
  const b = BUILDERS[kind]();
  const s = SCALE[kind];
  b.model.scale.setScalar(s);
  b.height *= s;
  return b;
}
