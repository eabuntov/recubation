// Map checks shared by the test suite and the generator: everything that
// would make a level unplayable. Returns a list of problems; an empty list
// means the map is fit to drop into.

import { Battle, parseMap, key } from './battle.js';
import { DIRS } from './data.js';

export function mapProblems(m) {
  const out = [];
  const fail = msg => out.push(msg);
  const widths = new Set(m.map.map(r => r.length));
  if (widths.size !== 1) fail(`ragged rows ${[...widths]}`);
  const map = parseMap(m);
  if (map.starts.length < m.squad) fail(`${map.starts.length} starts for squad of ${m.squad}`);
  const squad = Array.from({ length: m.squad }, (_, i) => ({
    id: i + 1, name: 'T' + i, skills: {}, weapon: 'carbine', armor: 'none', gear: [],
  }));
  let b;
  try { b = new Battle(m, squad); } catch (e) { fail(`battle build threw: ${e.message}`); return out; }
  for (const row of b.tiles) for (const t of row) {
    if (t.ramp == null) continue;
    const d = DIRS[t.ramp];
    const up = b.tile(t.x + d.x, t.y + d.y), down = b.tile(t.x - d.x, t.y - d.y);
    if (!up || up.h !== 1 || !b.walkable(up)) fail(`ramp ${t.x},${t.y} has no upper landing`);
    if (!down || down.h !== 0 || !b.walkable(down)) fail(`ramp ${t.x},${t.y} has no lower landing`);
  }
  // Everything that matters must be reachable on foot through the doors the
  // run can actually open. A group unlocks when one of its terminals stands
  // in reach, which may cascade - a terminal locked behind another group's
  // doors becomes reachable once those open. Whatever is still locked after
  // the chain settles is a deadlock: a group whose terminal sits behind its
  // own doors can never be opened.
  const s = map.starts[0];
  if (!s) { fail('no start tiles'); return out; }
  let reach = b.flood(s.x, s.y, 999, { ignoreUnits: true });
  const opened = new Set();
  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    for (const row of b.tiles) for (const t of row) {
      if (!t.terminal || opened.has(t.terminal.group)) continue;
      if (!DIRS.some(d => reach.has(key(t.x + d.x, t.y + d.y)))) continue;
      opened.add(t.terminal.group);
      for (const row2 of b.tiles) for (const q of row2) if (q.door && q.door.group === t.terminal.group) q.type = 'floor';
      changed = true;
    }
    if (!changed) break;
    reach = b.flood(s.x, s.y, 999, { ignoreUnits: true });
  }
  const shut = new Set();
  for (const row of b.tiles) for (const t of row) if (t.door && !opened.has(t.door.group)) shut.add(t.door.group);
  for (const g of shut) fail(`door group ${g} can never be opened`);
  for (const u of b.units) if (!reach.has(key(u.x, u.y))) fail(`${u.name} at ${u.x},${u.y} unreachable`);
  let exits = 0;
  for (const row of b.tiles) for (const t of row) {
    if (t.exit) { exits++; if (!reach.has(key(t.x, t.y))) fail(`exit ${t.x},${t.y} unreachable`); }
    if (t.hatch && !reach.has(key(t.x, t.y))) fail(`hatch ${t.x},${t.y} unreachable`);
    if (t.pickup && !reach.has(key(t.x, t.y))) fail(`pickup ${t.x},${t.y} unreachable`);
    if (t.terminal && !DIRS.some(d => reach.has(key(t.x + d.x, t.y + d.y)))) fail(`terminal ${t.x},${t.y} unreachable`);
  }
  if (m.objective.type === 'exit' && exits < m.squad) fail(`${exits} exit tiles for squad of ${m.squad}`);
  if (m.spawn && !map.hatches.length) fail('spawn schedule without hatches');
  // And the reverse: a hatch with no schedule behind it is the level lying
  // about waves that will never come (and never rendering its red ring's
  // promise true).
  if (!m.spawn && map.hatches.length) fail(`hatches without a spawn schedule (${map.hatches.length})`);
  return out;
}
