// Procedural level generator. A mission keeps its size, its enemy roster and
// its spawn schedule from the authored definition; the generator rolls a new
// floor plan with the same ingredients — rooms on a ring of corridors, blast
// doors sealing the extraction room, hatches where the brood wants them. The
// same seed always rolls the same map, so a retried mission is the same map.
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

// Split the level into wall-bounded rectangles, each a future room.
function bsp(x0, y0, x1, y1, rng, out) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const canV = w >= 11, canH = h >= 9;
  if ((!canV && !canH) || (out.length >= 3 && rng() < 0.4) || out.length >= 7) {
    out.push({ x0, y0, x1, y1 });
    return;
  }
  if (canV && (!canH || rng() < w / (w + h))) {
    const cut = x0 + 5 + Math.floor(rng() * (w - 10));
    bsp(x0, y0, cut, y1, rng, out);
    bsp(cut + 1, y0, x1, y1, rng, out);
  } else {
    const cut = y0 + 4 + Math.floor(rng() * (h - 8));
    bsp(x0, y0, x1, cut, rng, out);
    bsp(x0, cut + 1, x1, y1, rng, out);
  }
}

function tryMap(mission, index, rng) {
  const rows = mission.map;
  const W = rows[0].length, H = rows.length;
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => '#'));
  const set = (x, y, c) => { grid[y][x] = c; };
  const at = (x, y) => grid[y][x];

  const rooms = [];
  bsp(1, 1, W - 2, H - 2, rng, rooms);
  const inner = r => ({ x0: r.x0 + 1, y0: r.y0 + 1, x1: r.x1 - 1, y1: r.y1 - 1 });
  for (const r of rooms) {
    const i = inner(r);
    for (let y = i.y0; y <= i.y1; y++) for (let x = i.x0; x <= i.x1; x++) set(x, y, '.');
  }

  // A ring of corridors: every room connects to the next, so there are no
  // dead corners, and the loop keeps one sealed room from stranding anybody.
  const order = [...rooms.keys()];
  for (let n = order.length - 1; n > 0; n--) { // shuffle
    const k = Math.floor(rng() * (n + 1));
    [order[n], order[k]] = [order[k], order[n]];
  }
  const centre = r => {
    const i = inner(r);
    return { x: Math.floor((i.x0 + i.x1) / 2), y: Math.floor((i.y0 + i.y1) / 2) };
  };
  const corridor = (a, b) => {
    let x = a.x, y = a.y;
    const horizontalFirst = rng() < 0.5;
    const stepTo = (tx, ty) => {
      while (x !== tx) { x += Math.sign(tx - x); if (at(x, y) === '#') set(x, y, '.'); }
      while (y !== ty) { y += Math.sign(ty - y); if (at(x, y) === '#') set(x, y, '.'); }
    };
    if (horizontalFirst) stepTo(b.x, a.y), stepTo(b.x, b.y);
    else stepTo(a.x, b.y), stepTo(b.x, b.y);
  };
  for (let n = 0; n < order.length; n++) {
    const a = rooms[order[n]], b = rooms[order[(n + 1) % order.length]];
    corridor(centre(a), centre(b));
  }

  const walkableTilesIn = r => {
    const i = inner(r), out = [];
    for (let y = i.y0; y <= i.y1; y++) for (let x = i.x0; x <= i.x1; x++) if (at(x, y) === '.') out.push({ x, y });
    return out;
  };

  // Start room: the roomiest floor on the level, so the squad does not spawn
  // packed into a closet. Extraction runs then take the room farthest from it
  // along the ring, which gets the exit zone and every door sealing it.
  let startIdx = order[0];
  for (const n of order) if (walkableTilesIn(rooms[n]).length > walkableTilesIn(rooms[startIdx]).length) startIdx = n;
  const ringNext = n => order[(order.indexOf(n) + 1) % order.length];
  let far = startIdx;
  for (let n = 0, cur = startIdx; n < order.length; n++, cur = ringNext(cur)) far = cur;
  const startRoom = rooms[startIdx], exitRoom = rooms[far];
  const otherRooms = order.map(i => rooms[i]).filter(r => r !== startRoom && r !== exitRoom);

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
  // ring entirely, then punch one ramp into it. The ring loses that room and
  // stays a path, so the level remains connected; the ramp is the only way
  // up. When no clean ramp site exists, the roll simply stays flat.
  let raised = null;
  if (mission.raised) {
    const candidates = rooms.filter(r => r !== startRoom && r !== exitRoom
      && inner(r).x1 - inner(r).x0 >= 2 && inner(r).y1 - inner(r).y0 >= 2);
    if (candidates.length) {
      const room = pick(rng, candidates);
      // Seal every opening on the room's walls.
      for (let x = room.x0; x <= room.x1; x++) for (const y of [room.y0, room.y1]) if (at(x, y) === '.') set(x, y, '#');
      for (let y = room.y0; y <= room.y1; y++) for (const x of [room.x0, room.x1]) if (at(x, y) === '.') set(x, y, '#');
      // Punch a ramp: room wall tile plus a short carved approach outward.
      const sides = [
        { wall: x => [x, room.y0, 'v', room.y0 - 2], range: [room.x0 + 1, room.x1 - 1] }, // north wall: the room lies south, so the ramp points south
        { wall: x => [x, room.y1, '^', room.y1 + 2], range: [room.x0 + 1, room.x1 - 1] }, // south wall: the room lies north
        { wall: y => [room.x0, y, '>', room.x0 - 2], range: [room.y0 + 1, room.y1 - 1] }, // west wall: the room lies east
        { wall: y => [room.x1, y, '<', room.x1 + 2], range: [room.y0 + 1, room.y1 - 1] }, // east wall: the room lies west
      ].sort(() => rng() - 0.5);
      outer: for (const side of sides) {
        const spots = [];
        for (let p = side.range[0]; p <= side.range[1]; p++) spots.push(p);
        spots.sort(() => rng() - 0.5);
        for (const p of spots) {
          const [wx, wy, ch, outward] = side.wall(p);
          // Carve straight out until floor is met; the ramp's lower landing
          // is that first floor tile. Never touch the map border.
          const step = (ch === '^' || ch === 'v') ? [0, Math.sign(outward - wy)] : [Math.sign(outward - wx), 0];
          let cx = wx + step[0], cy = wy + step[1], hit = null;
          for (let n = 0; n < 4 && cx > 0 && cy > 0 && cx < W - 1 && cy < H - 1; n++) {
            if (at(cx, cy) !== '#') { hit = { x: cx, y: cy }; break; }
            cx += step[0]; cy += step[1];
          }
          if (cx <= 0 || cy <= 0 || cx >= W - 1 || cy >= H - 1) continue;
          if (!hit) hit = { x: cx, y: cy };
          if (at(hit.x, hit.y) === '#') continue; // ran out of level before floor
          // Carve the approach up to the hit.
          let ax = wx + step[0], ay = wy + step[1];
          while (ax !== hit.x || ay !== hit.y) { set(ax, ay, '.'); ax += step[0]; ay += step[1]; }
          set(wx, wy, ch);
          const i = inner(room);
          raised = [i.x0, i.y0, i.x1, i.y1];
          break outer;
        }
      }
    }
  }

  // Extraction zone in the far room; the blast doors seal every opening into
  // it, and a terminal elsewhere buys them open.
  if (mission.objective.type === 'exit') {
    const exitsPlaced = take([exitRoom], Math.max(items.exits, mission.squad), t => set(t.x, t.y, 'X'));
    if (exitsPlaced < Math.min(items.exits || Infinity, mission.squad)) return null;
    let doors = 0;
    for (let x = exitRoom.x0; x <= exitRoom.x1; x++) {
      for (const y of [exitRoom.y0, exitRoom.y1]) {
        if (at(x, y) === '.') { set(x, y, 'D'); doors++; }
      }
    }
    for (let y = exitRoom.y0; y <= exitRoom.y1; y++) {
      for (const x of [exitRoom.x0, exitRoom.x1]) {
        if (at(x, y) === '.') { set(x, y, 'D'); doors++; }
      }
    }
    if (!doors) return null;
    if (!take(otherRooms.length ? otherRooms : [exitRoom], 1, t => set(t.x, t.y, 'T'))) return null;
  } else if (items.terminals) {
    // A flavour terminal with no doors to open: keep it out of the start room.
    take(otherRooms.length ? otherRooms : rooms.slice(1), items.terminals, t => set(t.x, t.y, 'T'));
  }

  // Hatches never open under the squad's boots.
  const hatchTiles = [];
  if (mission.spawn) {
    const placed = take(otherRooms.length ? otherRooms : rooms.slice(1), items.hatches, t => { set(t.x, t.y, 'H'); hatchTiles.push(t); });
    if (placed < items.hatches) return null;
  }

  // The brood, exactly as the authored map stocked it, kept out of the start
  // room and at least six manhattan from every start tile, so turn one is a
  // choice of moves rather than a mugging. A roll with nowhere far enough to
  // put someone fails and another is drawn.
  const broodRooms = rooms.filter(r => r !== startRoom);
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
  const roomOf = t => rooms.find(r => {
    const i = inner(r);
    return t.x >= i.x0 && t.x <= i.x1 && t.y >= i.y0 && t.y <= i.y1;
  });
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
    for (const r of rooms) {
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

  take(rooms, items.crates, t => set(t.x, t.y, 'c'));
  take(rooms, items.ammo, t => set(t.x, t.y, 'A'));
  take(rooms, items.med, t => set(t.x, t.y, '+'));

  return { map: grid.map(r => r.join('')), raised: raised ? [raised] : [] };
}
