// Headless checks: validates every map (authored and generated) and
// auto-plays the campaign with a crude bot so rule or AI exceptions show up
// without opening a browser.
//   node test/sim.mjs

import { MISSIONS } from '../src/missions.js';
import { Battle, key } from '../src/battle.js';
import { newCampaign, topUp, applyResult, raiseSkill, equip, maxHpOf } from '../src/campaign.js';
import { DIRS } from '../src/data.js';
import { mapProblems } from '../src/mapcheck.js';
import { generateMap } from '../src/genmap.js';

let failures = 0;
const fail = msg => { failures++; console.error('  FAIL ' + msg); };

function validate(m) {
  for (const p of mapProblems(m)) fail(`${m.id}: ${p}`);
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
      // A dry magazine is worth swapping when nothing can be shot.
      if (m.weapon && m.weapon.ammo === 0 && !b.reloadProblem(m)) { await b.reload(m); continue; }
      // Terminals first, then exits, then the nearest hostile.
      let used = false;
      for (const d of DIRS) {
        if (!b.terminalProblem(m, m.x + d.x, m.y + d.y)) { used = await b.useTerminal(m, m.x + d.x, m.y + d.y); break; }
      }
      if (used) continue;
      if (m.ap < 3) break; // keep something for reaction fire
      // A single shot now costs 3, so leave 3 behind instead of 2.
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
      const path = b.pathFrom(best).slice(0, m.ap - 3);
      if (!path.length || !(await b.move(m, path))) break;
    }
    if (m.alive) b.faceNearest(m);
  }
}

async function play(m, squad, difficulty = 'normal') {
  const b = new Battle(m, squad, undefined, difficulty);
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

console.log('Validating generated maps');
// Every mission rolls a batch of seeds; a roll that cannot be made valid
// inside its attempt budget falls back to the authored map, which is fine —
// but a batch of outright failures is a generator regression.
const GENERATED = MISSIONS.map((m, i) => {
  let ok = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = generateMap(m, i, seed * 7919);
    if (!g) continue;
    for (const p of mapProblems({ ...m, map: g.map, raised: g.raised })) fail(`${m.id} (roll ${seed}): ${p}`);
    ok++;
  }
  console.log(`  ${m.id.padEnd(16)} ${ok}/20 rolls valid`);
  // One fixed roll becomes the generated campaign the bot plays below.
  const pick = generateMap(m, i, 20261116 + i);
  return pick ? { ...m, map: pick.map, raised: pick.raised } : m;
});

console.log('Auto-playing campaign');
async function runCampaign(difficulty, missions = MISSIONS) {
  if (difficulty !== 'normal' || missions !== MISSIONS) console.log(`  --- ${difficulty}${missions === MISSIONS ? '' : ' · generated'} ---`);
  const state = newCampaign(difficulty);
  for (let guard = 0; guard < 40 && !state.complete; guard++) {
  const m = missions[state.mission];
  // Keep the bench at standing strength, the way the briefing does now.
  topUp(state);
  // Spend points the way a cautious player might.
  for (const s of state.squad) {
    for (const id of ['light', 'vitality', 'light', 'heavy', 'vitality', 'reflexes']) raiseSkill(s, id);
    for (const w of ['rifle', 'twin']) if (equip(state, s, 'weapon', w)) break;
    for (const a of ['shell', 'vest']) if (equip(state, s, 'armor', a)) break;
  }
  // Rotate like a cautious player would: march the healthiest first and let
  // the wounded heal on the bench.
  const pool = [...state.squad].sort((a, b) =>
    (b.hp == null ? maxHpOf(b) : b.hp) / maxHpOf(b) - (a.hp == null ? maxHpOf(a) : a.hp) / maxHpOf(a));
  const b = await play(m, pool.slice(0, m.squad), difficulty);
  const sum = b.summary();
  const alive = sum.marines.filter(r => r.alive).length;
  console.log(`  ${m.id.padEnd(16)} ${sum.win ? 'WIN ' : 'LOSS'} turn ${String(sum.turns).padStart(2)}  alive ${alive}/${sum.marines.length}  kills ${sum.marines.reduce((n, r) => n + r.kills, 0)}  (${sum.text})`);
  const report = applyResult(state, sum);
  if (!report.win) { state.mission++; if (state.mission >= MISSIONS.length) state.complete = true; }
  }
}
await runCampaign('normal');
await runCampaign('hard');
await runCampaign('normal', GENERATED);

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
