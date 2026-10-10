// Headless checks: validates every map and auto-plays each mission with a
// crude bot so rule or AI exceptions show up without opening a browser.
//   node test/sim.mjs

import { MISSIONS } from '../src/missions.js';
import { Battle, parseMap, key } from '../src/battle.js';
import { newCampaign, reinforce, applyResult, raiseSkill, equip } from '../src/campaign.js';
import { DIRS } from '../src/data.js';

let failures = 0;
const fail = msg => { failures++; console.error('  FAIL ' + msg); };

function validate(m) {
  const widths = new Set(m.map.map(r => r.length));
  if (widths.size !== 1) fail(`${m.id}: ragged rows ${[...widths]}`);
  const map = parseMap(m);
  if (map.starts.length < m.squad) fail(`${m.id}: ${map.starts.length} starts for squad of ${m.squad}`);
  const squad = Array.from({ length: m.squad }, (_, i) => ({
    id: i + 1, name: 'T' + i, skills: {}, weapon: 'carbine', armor: 'none', gear: [],
  }));
  const b = new Battle(m, squad);
  for (const row of b.tiles) for (const t of row) {
    if (t.ramp == null) continue;
    const d = DIRS[t.ramp];
    const up = b.tile(t.x + d.x, t.y + d.y), down = b.tile(t.x - d.x, t.y - d.y);
    if (!up || up.h !== 1 || !b.walkable(up)) fail(`${m.id}: ramp ${t.x},${t.y} has no upper landing`);
    if (!down || down.h !== 0 || !b.walkable(down)) fail(`${m.id}: ramp ${t.x},${t.y} has no lower landing`);
  }
  // Everything that matters must be reachable on foot once the doors are open.
  for (const row of b.tiles) for (const t of row) if (t.door) t.type = 'floor';
  const s = map.starts[0];
  const reach = b.flood(s.x, s.y, 999, { ignoreUnits: true });
  for (const u of b.units) if (!reach.has(key(u.x, u.y))) fail(`${m.id}: ${u.name} at ${u.x},${u.y} unreachable`);
  let exits = 0;
  for (const row of b.tiles) for (const t of row) {
    if (t.exit) { exits++; if (!reach.has(key(t.x, t.y))) fail(`${m.id}: exit ${t.x},${t.y} unreachable`); }
    if (t.hatch && !reach.has(key(t.x, t.y))) fail(`${m.id}: hatch ${t.x},${t.y} unreachable`);
    if (t.pickup && !reach.has(key(t.x, t.y))) fail(`${m.id}: pickup ${t.x},${t.y} unreachable`);
    if (t.terminal && !DIRS.some(d => reach.has(key(t.x + d.x, t.y + d.y)))) fail(`${m.id}: terminal ${t.x},${t.y} unreachable`);
  }
  if (m.objective.type === 'exit' && exits < m.squad) fail(`${m.id}: ${exits} exit tiles for squad of ${m.squad}`);
  if (m.spawn && !map.hatches.length) fail(`${m.id}: spawn schedule without hatches`);
}

// A deliberately simple bot: shoot what it can, otherwise walk toward the goal.
async function botTurn(b) {
  for (const m of b.marines()) {
    for (let guard = 0; guard < 12 && m.alive && !b.over; guard++) {
      let acted = false;
      for (const mode of b.modes(m)) {
        const foe = b.aliens()
          .filter(a => {
            const p = b.preview(m, a.x, a.y, mode);
            return p.ok && p.hits.some(h => h.unit === a && h.dmg > 0) && !p.hits.some(h => h.unit.side === 'marine');
          })
          .sort((a, c) => a.hp - c.hp)[0];
        if (foe) { acted = await b.attack(m, foe.x, foe.y, mode); break; }
      }
      if (acted) continue;
      // Terminals first, then exits, then the nearest hostile.
      let used = false;
      for (const d of DIRS) {
        if (!b.terminalProblem(m, m.x + d.x, m.y + d.y)) { used = await b.useTerminal(m, m.x + d.x, m.y + d.y); break; }
      }
      if (used) continue;
      if (m.ap < 3) break; // keep something for reaction fire
      const reach = b.flood(m.x, m.y, 999);
      const goals = [];
      for (const row of b.tiles) for (const t of row) {
        if (t.terminal && !t.terminal.used) for (const d of DIRS) goals.push([t.x + d.x, t.y + d.y]);
        if (b.mission.objective.type === 'exit' && t.exit && !b.unitAt(t.x, t.y)) goals.push([t.x, t.y]);
      }
      if (b.mission.objective.type === 'exit' && b.tile(m.x, m.y).exit) break;
      if (!goals.length || b.mission.objective.type !== 'exit') for (const a of b.aliens()) for (const d of DIRS) goals.push([a.x + d.x * 3, a.y + d.y * 3]);
      let best = null;
      for (const [x, y] of goals) {
        const n = reach.get(key(x, y));
        if (n && n.cost > 0 && (!best || n.cost < best.cost)) best = n;
      }
      if (!best) break;
      const path = b.pathFrom(best).slice(0, m.ap - 2);
      if (!path.length || !(await b.move(m, path))) break;
    }
    if (m.alive) b.faceNearest(m);
  }
}

async function play(m, squad) {
  const b = new Battle(m, squad);
  await b.begin();
  for (let i = 0; i < 60 && !b.over; i++) {
    await botTurn(b);
    if (!b.over) await b.endTurn();
  }
  if (!b.over) fail(`${m.id}: no result after 60 turns`);
  return b;
}

console.log('Validating maps');
for (const m of MISSIONS) validate(m);

console.log('Auto-playing campaign');
const state = newCampaign();
for (let guard = 0; guard < 40 && !state.complete; guard++) {
  reinforce(state);
  const m = MISSIONS[state.mission];
  // Spend points the way a cautious player might.
  for (const s of state.squad) {
    for (const id of ['light', 'vitality', 'light', 'heavy', 'vitality', 'reflexes']) raiseSkill(s, id);
    for (const w of ['rifle', 'twin']) if (equip(state, s, 'weapon', w)) break;
    for (const a of ['shell', 'vest']) if (equip(state, s, 'armor', a)) break;
  }
  const b = await play(m, state.squad);
  const sum = b.summary();
  const alive = sum.marines.filter(r => r.alive).length;
  console.log(`  ${m.id.padEnd(16)} ${sum.win ? 'WIN ' : 'LOSS'} turn ${String(sum.turns).padStart(2)}  alive ${alive}/${sum.marines.length}  kills ${sum.marines.reduce((n, r) => n + r.kills, 0)}  (${sum.text})`);
  const report = applyResult(state, sum);
  if (!report.win) { state.mission++; if (state.mission >= MISSIONS.length) state.complete = true; }
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
