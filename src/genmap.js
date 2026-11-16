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
  let hatches = 0, crates = 0, ammo = 0, med = 0, exits = 0, terminals = 0;
  for (const row of mission.map) for (const c of row) {
    if ('spkbtM'.includes(c)) aliens.push(c);
    else if ('SPKBT'.includes(c)) aliens.push(c);
    else if (c === 'H') hatches++;
    else if (c === 'c') crates++;
    else if (c === 'A') ammo++;
    else if (c === '+') med++;
    else if (c === 'X') exits++;
    else if (c === 'T') terminals++;
  }
  return { aliens, hatches, crates, ammo, med, exits };
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

  // Start room, then — for extraction runs — the room farthest from it along
  // the ring, which gets the exit zone and every door sealing it.
  const startIdx = order[0];
  const ringNext = n => order[(order.indexOf(n) + 1) % order.length];
  let far = startIdx;
  for (let n = 0, cur = startIdx; n < order.length; n++, cur = ringNext(cur)) far = cur;
  const startRoom = rooms[startIdx], exitRoom = rooms[far];
  const otherRooms = order.map(i => rooms[i]).filter(r => r !== startRoom && r !== exitRoom);

  // Squad starts: a run of adjacent free tiles in the start room.
  const free = walkableTilesIn(startRoom);
  const starts = [];
  for (const t of free) {
    if (starts.length >= mission.squad) break;
    if (starts.every(s => Math.abs(s.x - t.x) + Math.abs(s.y - t.y) <= starts.length)) starts.push(t);
  }
  if (starts.length < mission.squad) return null;
  starts.forEach((t, i) => set(t.x, t.y, String(i + 1)));

  const take = (roomList, count, place) => {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 500) {
      const room = pick(rng, roomList.length ? roomList : rooms);
      const tiles = walkableTilesIn(room).filter(t => at(t.x, t.y) === '.');
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
  if (mission.spawn) {
    const placed = take(otherRooms.length ? otherRooms : rooms.slice(1), items.hatches, t => set(t.x, t.y, 'H'));
    if (placed < items.hatches) return null;
  }

  // The brood, exactly as the authored map stocked it, kept out of the start
  // room so turn one is still a choice rather than a mugging.
  const broodRooms = rooms.filter(r => r !== startRoom);
  if (items.aliens.length) {
    const placed = take(broodRooms, items.aliens.length, (t, i) => set(t.x, t.y, items.aliens[i]));
    if (placed < items.aliens.length) return null;
  }

  take(rooms, items.crates, t => set(t.x, t.y, 'c'));
  take(rooms, items.ammo, t => set(t.x, t.y, 'A'));
  take(rooms, items.med, t => set(t.x, t.y, '+'));

  return { map: grid.map(r => r.join('')), raised: raised ? [raised] : [] };
}
