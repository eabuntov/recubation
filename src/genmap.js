// Procedural level generator. A mission keeps its size, its enemy roster and
// its spawn schedule from the authored definition; the generator rolls a new
// floor plan with the same ingredients — rooms as open rectangles between
// single wall lines, blast doors sealing the extraction room, hatches where
// the brood wants them. The same seed always rolls the same map, so a
// retried mission is the same map.
//
// generateMap returns { map, raised } or null when no roll passed the checks
// within the attempt budget — the caller then keeps the authored map.

import { mapProblems } from './mapcheck.js';

// Small, fast, seedable PRNG: deterministic maps from a 32-bit seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export function generateMap(mission, index, seed, attempts = 200) {
  for (let i = 0; i < attempts; i++) {
    const rng = mulberry32((seed ^ Math.imul(i + 1, 0x9E3779B9)) >>> 0);
    const roll = tryMap(mission, index, rng);
    if (roll && !mapProblems({ ...mission, map: roll.map, raised: roll.raised }).length) return roll;
  }
  return null;
}

// ---------------------------------------------------------------- ingredients

// What the authored map stocks, so a generated one fields the same fight:
// alien letters (elites included), hatches, crates and pickups.
function stock(mission) {
  const aliens = [];
  let hatches = 0, crates = 0, ammo = 0, med = 0, exits = 0, terminals = 0, cash = 0;
  for (const row of mission.map) for (const c of row) {
    if ('spkbtM'.includes(c)) aliens.push(c);
    // No 'T' here: the engine parses an authored 'T' as a terminal before it
    // could ever be an elite, and reading it as a stalker ate both the
    // terminal count and a flavour terminal on every generated map.
    else if ('SPKB'.includes(c)) aliens.push(c);
    else if (c === 'H') hatches++;
    else if (c === 'c') crates++;
    else if (c === 'A') ammo++;
    else if (c === '+') med++;
    else if (c === 'X') exits++;
    else if (c === 'T') terminals++;
    else if (c === '$') cash++;
  }
  return { aliens, hatches, crates, ammo, med, exits, terminals, cash };
}

// ---------------------------------------------------------------- layout

// Split the level into open floor rectangles separated by single wall lines.
// A cut is one cell of wall; both halves keep at least three floor cells in
// the cut direction, so no room is ever narrower than 3, and the two-cell
// "corridors" the old double walls produced are gone.
function bsp(x0, y0, x1, y1, rng, out) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const canV = w >= 7, canH = h >= 7;
  if ((!canV && !canH) || (out.length >= 3 && rng() < 0.4) || out.length >= 7) {
    out.push({ x0, y0, x1, y1 });
    return;
  }
  if (canV && (!canH || rng() < w / (w + h))) {
    const cut = x0 + 3 + Math.floor(rng() * (w - 6));
    bsp(x0, y0, cut - 1, y1, rng, out);
    bsp(cut + 1, y0, x1, y1, rng, out);
  } else {
    const cut = y0 + 3 + Math.floor(rng() * (h - 6));
    bsp(x0, y0, x1, cut - 1, rng, out);
    bsp(x0, cut + 1, x1, y1, rng, out);
  }
}

function tryMap(mission, index, rng) {
  const rows = mission.map;
  const W = rows[0].length, H = rows.length;
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => '#'));
  const set = (x, y, c) => { grid[y][x] = c; };
  const at = (x, y) => grid[y][x];

  // Rooms are the open rectangles; everything between them is wall.
  const rooms = [];
  bsp(1, 1, W - 2, H - 2, rng, rooms);
  for (const r of rooms)
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) set(x, y, '.');

  // Where two rooms face each other across one wall line, and the span they
  // share it on.
  const links = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    const span = (p, q) => { const lo = Math.max(p.y0, q.y0), hi = Math.min(p.y1, q.y1); return lo <= hi ? { lo, hi } : null; };
    const spanX = (p, q) => { const lo = Math.max(p.x0, q.x0), hi = Math.min(p.x1, q.x1); return lo <= hi ? { lo, hi } : null; };
    if (a.x1 + 2 === b.x0) { const s = span(a, b); if (s) links.push({ a: i, b: j, vert: true, wall: a.x1 + 1, ...s }); }
    if (b.x1 + 2 === a.x0) { const s = span(a, b); if (s) links.push({ a: j, b: i, vert: true, wall: b.x1 + 1, ...s }); }
    if (a.y1 + 2 === b.y0) { const s = spanX(a, b); if (s) links.push({ a: i, b: j, vert: false, wall: a.y1 + 1, ...s }); }
    if (b.y1 + 2 === a.y0) { const s = spanX(a, b); if (s) links.push({ a: j, b: i, vert: false, wall: b.y1 + 1, ...s }); }
  }

  // Every opening punched into a wall line; each connects rooms a and b.
  const openings = [];
  const punch = (l, p) => {
    const x = l.vert ? l.wall : p, y = l.vert ? p : l.wall;
    set(x, y, '.');
    openings.push({ x, y, a: l.a, b: l.b });
  };

  // Connectivity first: one opening along a spanning tree of the adjacency
  // graph, so no sealed pocket can strand anybody.
  const inTree = new Set([0]);
  const treeLinks = [...links].sort(() => rng() - 0.5);
  for (const l of treeLinks) {
    if (inTree.has(l.a) === inTree.has(l.b)) continue;
    const span = l.hi - l.lo;
    punch(l, l.lo + Math.floor(rng() * (span + 1)));
    inTree.add(l.a); inTree.add(l.b);
  }

  // Does this opening sit on one of the room's four walls?
  const touches = (r, o) =>
    (o.x === r.x0 - 1 && o.y >= r.y0 && o.y <= r.y1) ||
    (o.x === r.x1 + 1 && o.y >= r.y0 && o.y <= r.y1) ||
    (o.y === r.y0 - 1 && o.x >= r.x0 && o.x <= r.x1) ||
    (o.y === r.y1 + 1 && o.x >= r.x0 && o.x <= r.x1);

  // Distinct entrances: openings merged when they sit on adjacent cells of
  // the same wall, so one wide gap counts once.
  const entrancesOf = ri => {
    const r = rooms[ri];
    const bySide = new Map();
    for (const o of openings) {
      if (!touches(r, o)) continue;
      const side = o.y === r.y0 - 1 ? 'N' : o.y === r.y1 + 1 ? 'S' : o.x === r.x0 - 1 ? 'W' : 'E';
      const c = side === 'N' || side === 'S' ? o.x : o.y;
      if (!bySide.has(side)) bySide.set(side, []);
      bySide.get(side).push(c);
    }
    let n = 0;
    for (const arr of bySide.values()) {
      arr.sort((p, q) => p - q);
      let prev = -10;
      for (const c of arr) { if (c - prev > 1) n++; prev = c; }
    }
    return n;
  };

  // The request: at least two ways in and out of every room. Rooms short of
  // that get another opening punched toward a neighbour; a roll with no
  // room left to punch fails and another is drawn.
  for (let ri = 0; ri < rooms.length; ri++) {
    let guard = 0;
    while (entrancesOf(ri) < 2 && guard++ < 20) {
      const spots = [];
      for (const l of links) {
        if (l.a !== ri && l.b !== ri) continue;
        for (let p = l.lo; p <= l.hi; p++) {
          const x = l.vert ? l.wall : p, y = l.vert ? p : l.wall;
          if (at(x, y) !== '#') continue;
          const clash = openings.some(o => l.vert
            ? (o.x === x && Math.abs(o.y - y) <= 1)
            : (o.y === y && Math.abs(o.x - x) <= 1));
          if (!clash) spots.push({ x, y });
        }
      }
      if (!spots.length) break;
      const s = pick(rng, spots);
      set(s.x, s.y, '.');
      openings.push(s);
    }
    if (entrancesOf(ri) < 2) return null;
  }

  const walkableTilesIn = r => {
    const out = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (at(x, y) === '.') out.push({ x, y });
    return out;
  };

  // Start room: the roomiest floor on the level, so the squad does not spawn
  // packed into a closet. Extraction runs then take the room farthest from it
  // along the ring, which gets the exit zone and every door sealing it.
  let startIdx = 0;
  for (let ri = 0; ri < rooms.length; ri++) if (walkableTilesIn(rooms[ri]).length > walkableTilesIn(rooms[startIdx]).length) startIdx = ri;
  const startRoom = rooms[startIdx];

  // The room farthest from the start along the room ring: walk the adjacency
  // graph breadth-first and take the last room reached.
  const adj = new Map();
  for (const l of links) {
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a).push(l.b);
    adj.get(l.b).push(l.a);
  }
  let exitIdx = startIdx;
  const seen = new Set([startIdx]);
  const q = [startIdx];
  for (let i = 0; i < q.length; i++) for (const n of adj.get(q[i]) || []) if (!seen.has(n)) { seen.add(n); q.push(n); exitIdx = n; }
  const exitRoom = rooms[exitIdx];
  const otherRooms = rooms.filter(r => r !== startRoom && r !== exitRoom);

  // Squad starts in the start room, kept spread: no two troopers on adjacent
  // tiles when the room affords it, a compact clump only as the fallback.
  const free = walkableTilesIn(startRoom);
  const starts = [];
  for (const t of free) {
    if (starts.length >= mission.squad) break;
    if (starts.every(s => Math.abs(s.x - t.x) + Math.abs(s.y - t.y) >= 2)) starts.push(t);
  }
  if (starts.length < mission.squad) {
    starts.length = 0;
    for (const t of free) {
      if (starts.length >= mission.squad) break;
      if (starts.every(s => Math.abs(s.x - t.x) + Math.abs(s.y - t.y) <= starts.length)) starts.push(t);
    }
  }
  if (starts.length < mission.squad) return null;
  starts.forEach((t, i) => set(t.x, t.y, String(i + 1)));

  const take = (roomList, count, place, ok = null) => {
    let placed = 0, guard = 500;
    while (placed < count && guard-- > 0) {
      const room = pick(rng, roomList.length ? roomList : rooms);
      let tiles = walkableTilesIn(room).filter(t => at(t.x, t.y) === '.');
      if (ok) tiles = tiles.filter(t => ok(t.x, t.y));
      if (!tiles.length) continue;
      const t = pick(rng, tiles);
      place(t, placed);
      placed++;
    }
    return placed;
  };

  const items = stock(mission);

  // A raised deck for the missions that teach height: seal a room off the
  // floor plan entirely, then punch one ramp into it. The ramp is the only
  // way up. When no clean ramp site exists, the roll simply stays flat.
  let raised = null, deckRoom = null;
  if (mission.raised && otherRooms.length) {
    const candidates = otherRooms.filter(r => r.x1 - r.x0 >= 2 && r.y1 - r.y0 >= 2);
    if (candidates.length) {
      const room = pick(rng, candidates);
      const sides = [
        { wall: x => [x, room.y0 - 1, 'v'], range: [room.x0, room.x1], step: [0, -1] }, // deck lies south of its top wall
        { wall: x => [x, room.y1 + 1, '^'], range: [room.x0, room.x1], step: [0, 1] },  // deck lies north of its bottom wall
        { wall: y => [room.x0 - 1, y, '>'], range: [room.y0, room.y1], step: [-1, 0] }, // deck lies east of its west wall
        { wall: y => [room.x1 + 1, y, '<'], range: [room.y0, room.y1], step: [1, 0] },  // deck lies west of its east wall
      ].sort(() => rng() - 0.5);
      outer: for (const side of sides) {
        const spots = [];
        for (let p = side.range[0]; p <= side.range[1]; p++) spots.push(p);
        spots.sort(() => rng() - 0.5);
        for (const p of spots) {
          const [wx, wy, ch] = side.wall(p);
          if (at(wx, wy) !== '#') continue; // never over an opening or the border
          // Carve straight out until floor is met; the ramp's lower landing
          // is that first floor tile. Never touch the map border.
          const [sx, sy] = side.step;
          let cx = wx + sx, cy = wy + sy, hit = null;
          for (let n = 0; n < 4 && cx > 0 && cy > 0 && cx < W - 1 && cy < H - 1; n++) {
            if (at(cx, cy) !== '#') { hit = { x: cx, y: cy }; break; }
            cx += sx; cy += sy;
          }
          if (cx <= 0 || cy <= 0 || cx >= W - 1 || cy >= H - 1) continue;
          if (!hit) hit = { x: cx, y: cy };
          if (at(hit.x, hit.y) === '#') continue; // ran out of level before floor
          // Seal the room: every opening into it becomes wall again.
          for (const o of openings.filter(o => touches(room, o))) set(o.x, o.y, '#');
          for (let k = openings.length - 1; k >= 0; k--) if (touches(room, openings[k])) openings.splice(k, 1);
          // Carve the approach up to the hit.
          let ax = wx + sx, ay = wy + sy;
          while (ax !== hit.x || ay !== hit.y) { set(ax, ay, '.'); ax += sx; ay += sy; }
          set(wx, wy, ch);
          raised = [room.x0, room.y0, room.x1, room.y1];
          deckRoom = room;
          break outer;
        }
      }
    }
  }

  // Extraction zone in the far room; the blast doors seal every opening into
  // it, and a terminal elsewhere buys them open.
  const placeRooms = rooms.filter(r => r !== deckRoom);
  if (mission.objective.type === 'exit') {
    const exitsPlaced = take([exitRoom], Math.max(items.exits, mission.squad), t => set(t.x, t.y, 'X'));
    if (exitsPlaced < Math.min(items.exits || Infinity, mission.squad)) return null;
    let doors = 0;
    for (const o of openings) if (touches(exitRoom, o)) { set(o.x, o.y, 'D'); doors++; }
    if (doors < 2) return null;
    if (!take(otherRooms.filter(r => r !== deckRoom).length ? otherRooms.filter(r => r !== deckRoom) : [exitRoom], 1, t => set(t.x, t.y, 'T'))) return null;
  } else if (items.terminals) {
    // A flavour terminal with no doors to open: keep it out of the start room.
    take(otherRooms.filter(r => r !== deckRoom).length ? otherRooms.filter(r => r !== deckRoom) : placeRooms.slice(1), items.terminals, t => set(t.x, t.y, 'T'));
  }

  // Hatches never open under the squad's boots.
  const hatchRooms = otherRooms.filter(r => r !== deckRoom);
  const hatchTiles = [];
  if (mission.spawn) {
    const placed = take(hatchRooms.length ? hatchRooms : placeRooms.slice(1), items.hatches, t => { set(t.x, t.y, 'H'); hatchTiles.push(t); });
    if (placed < items.hatches) return null;
  }

  // The brood, exactly as the authored map stocked it, kept out of the start
  // room and at least six manhattan from every start tile, so turn one is a
  // choice of moves rather than a mugging. A roll with nowhere far enough to
  // put someone fails and another is drawn.
  const broodRooms = placeRooms.filter(r => r !== startRoom);
  const clearOfSquad = (x, y) => starts.every(s => Math.abs(s.x - x) + Math.abs(s.y - y) >= 6);
  if (items.aliens.length) {
    const placed = take(broodRooms, items.aliens.length, (t, i) => set(t.x, t.y, items.aliens[i]), clearOfSquad);
    if (placed < items.aliens.length) return null;
  }

  // The cash bonus: at least one per mission. Beside a hatch when the brood
  // has any - the ring of tiles around it, its room when those are taken;
  // without hatches, in the room farthest from the starts along the floor.
  const cashCount = Math.max(1, items.cash);
  const freeRing = h => {
    const ring = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = h.x + dx, y = h.y + dy;
      if (at(x, y) === '.') ring.push({ x, y });
    }
    return ring;
  };
  const roomOf = t => placeRooms.find(r => t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1);
  let cashPlaced = 0;
  if (hatchTiles.length) {
    for (let guard = 0; cashPlaced < cashCount && guard++ < 200;) {
      const h = pick(rng, hatchTiles);
      const ring = freeRing(h);
      if (ring.length) { const t = pick(rng, ring); set(t.x, t.y, '$'); cashPlaced++; continue; }
      const r = roomOf(h);
      const tiles = r ? walkableTilesIn(r).filter(q => at(q.x, q.y) === '.') : [];
      if (tiles.length) { const t = pick(rng, tiles); set(t.x, t.y, '$'); cashPlaced++; }
    }
  } else {
    // Doors block the flood, so a sealed exit room is out of the running.
    // Anything else already on the board (brood, terminals, exits) is floor
    // to walk over as far as placement is concerned.
    const passable = c => c !== '#' && c !== 'D';
    const dist = new Map();
    const q = starts.map(s => ({ x: s.x, y: s.y }));
    for (const s of q) dist.set(s.x + ',' + s.y, 0);
    for (let i = 0; i < q.length; i++) {
      const { x, y } = q[i];
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (dist.has(k) || !passable(at(nx, ny))) continue;
        dist.set(k, dist.get(x + ',' + y) + 1);
        q.push({ x: nx, y: ny });
      }
    }
    let best = null;
    for (const r of placeRooms) {
      if (r === startRoom) continue;
      const tiles = walkableTilesIn(r).filter(t => at(t.x, t.y) === '.' && dist.has(t.x + ',' + t.y));
      if (!tiles.length) continue;
      const d = Math.min(...tiles.map(t => dist.get(t.x + ',' + t.y)));
      if (!best || d > best.d) best = { r, tiles, d };
    }
    if (best) {
      const far = Math.max(...best.tiles.map(t => dist.get(t.x + ',' + t.y)));
      const corner = best.tiles.filter(t => dist.get(t.x + ',' + t.y) === far);
      const t = pick(rng, corner);
      set(t.x, t.y, '$');
      cashPlaced++;
    }
  }
  if (cashPlaced < cashCount) return null;

  take(placeRooms, items.crates, t => set(t.x, t.y, 'c'));
  take(placeRooms, items.ammo, t => set(t.x, t.y, 'A'));
  take(placeRooms, items.med, t => set(t.x, t.y, '+'));

  return { map: grid.map(r => r.join('')), raised: raised ? [raised] : [] };
}
