// Campaign missions.
//
// Map legend
//   #  wall            .  deck             :  raised deck (level 1)
//   ^ > v <  ramp, pointing at its upper end
//   c  crate (blocks movement, not fire)   ~  open shaft
//   D  blast door, opened by terminal T    E / U  second door / terminal pair
//   A  ammunition      +  aid station      X  extraction zone
//   H  brood hatch     1-6  squad start
//   s skitter  p spitter  k shellback  b bloater  t stalker  M matriarch
//
// `raised` lists [x0, y0, x1, y1] rectangles lifted to level 1 (for tiles that hold something).

export const MISSIONS = [
  {
    id: 'cold-start',
    name: 'Cold Start',
    squad: 2,
    reward: 40,
    objective: { type: 'eliminate' },
    brief: [
      'Halcyon Deep went dark eleven hours ago. The last transmission from the ice-moon colony was a maintenance request for the bore shaft, then a lot of screaming.',
      'You are the only unit in the sector. Two troopers from the picket ship are going in through the freight lock. Something is moving in the cargo bay. Clear it.',
    ],
    tips: [
      'Left-click a trooper, then a blue tile to move or a hostile to fire. Every action costs action points (AP).',
      'AP you do not spend become reaction fire during the enemy phase, but only into the 90° arc the trooper is facing. Right-click to turn.',
      'Crates stop movement, not bullets.',
    ],
    map: [
      '################',
      '#1.....#.......#',
      '#2.....#...s...#',
      '#......c.......#',
      '####.###..c..s.#',
      '#......#.......#',
      '#..A...#####.###',
      '#..........s...#',
      '#.....c....s...#',
      '################',
    ],
  },
  {
    id: 'pressure-doors',
    name: 'Pressure Doors',
    squad: 3,
    reward: 50,
    objective: { type: 'exit' },
    brief: [
      'The colony locked itself down when the breach alarms tripped. The habitat ring is behind a blast door and the override is in the pump room.',
      'Get someone to the terminal, open the door, and move the whole squad to the transit platform. Expect spitters: they will not come to you, so do not stand in the open.',
    ],
    tips: [
      'Stand next to a terminal and click it to open its doors (1 AP).',
      'A shot is blocked by anyone standing in the way, friend or foe. Stagger your line.',
      'Weapons build heat with every shot and shed it between turns. A hot gun will not fire.',
    ],
    map: [
      '####################',
      '#1..#......#.......#',
      '#2..c......D....XX.#',
      '#3..#..s...#..p.XX.#',
      '#...#......#.......#',
      '##.####.####.......#',
      '#......A..##########',
      '#..c.........p.....#',
      '#.....s...#..s.....#',
      '#.........#T.......#',
      '####################',
    ],
  },
  {
    id: 'the-gantry',
    name: 'The Gantry',
    squad: 3,
    reward: 60,
    objective: { type: 'eliminate' },
    brief: [
      'The ore-sorting hall. A maintenance gantry runs the length of the north wall and the things have learned to use it.',
      'Whoever holds the high ground shoots over heads and hits harder. Take the ramps, or make them come down.',
    ],
    tips: [
      'Firing from a higher level adds +1 damage and ignores anyone standing in the line of fire.',
      'Levels connect only by ramps. A Jump Pack ignores that.',
      'Hits from behind do 50% more damage. That works both ways.',
    ],
    raised: [[1, 1, 16, 2]],
    map: [
      '##################',
      '#p:::::::::::::p:#',
      '#:::::::c::::::::#',
      '#..^.....s...^...#',
      '#................#',
      '#..c....##....c..#',
      '#.s.....##.....s.#',
      '#................#',
      '#....c......c....#',
      '#.....1.2.3......#',
      '##################',
    ],
    facing: 0,
  },
  {
    id: 'hatchery',
    name: 'Hatchery',
    squad: 4,
    reward: 70,
    objective: { type: 'survive', turns: 8 },
    spawn: { start: 1, every: 2, total: 20, pool: ['skitter', 'skitter', 'spitter', 'skitter', 'bloater'] },
    brief: [
      'The evacuation lift needs eight minutes to cycle and the junction it opens onto is ringed with hatches. They are coming up through the floor.',
      'Hold the junction until the lift arrives. Nobody has to be a hero. Everybody has to be alive.',
    ],
    tips: [
      'Hatches release a wave every other turn. A trooper standing on a hatch seals it.',
      'Bloaters burst when they reach you or when they die, hurting everything next to them. Kill them at a distance, ideally among their friends.',
    ],
    map: [
      '#####################',
      '#H.......#.........H#',
      '#........#..........#',
      '#...##.......##.....#',
      '#...##...c...##.....#',
      '#.....A...1.2.......#',
      '#....c....3.4..c..+.#',
      '#...##.......##.....#',
      '#...##...c...##.....#',
      '#........#..........#',
      '#H.......#....H....H#',
      '#####################',
    ],
  },
  {
    id: 'shellbacks',
    name: 'Shellbacks',
    squad: 4,
    reward: 80,
    objective: { type: 'eliminate' },
    brief: [
      'Survivors report something new in the workshops: slow, plated, and entirely unbothered by rifle fire.',
      'The plate only covers the front. Split up, get an angle, and put rounds into the soft parts. Or bring fire.',
    ],
    tips: [
      'A Shellback deflects every bullet that arrives through its front arc. Shoot it from the side or rear.',
      'Incinerators, shells and plasma ignore armour entirely.',
      'It turns to face the nearest trooper at the end of its move. Use one trooper as bait and another as the knife.',
    ],
    map: [
      '######################',
      '#1.2....#......#.....#',
      '#3.4....#..k...#..p..#',
      '#.......#......#.....#',
      '###.#####.##.###.##.##',
      '#..........c.........#',
      '#.##.####.....####.#.#',
      '#.#....k#..A..#....#.#',
      '#.#.....#.....#..k.#.#',
      '#.##.####.###.####.#.#',
      '#....s.........s.....#',
      '######################',
    ],
  },
  {
    id: 'meltdown-run',
    name: 'Meltdown Run',
    squad: 4,
    reward: 90,
    turnLimit: 12,
    objective: { type: 'exit' },
    brief: [
      'Reactor Two has lost coolant. The service tunnel floods with superheated steam in twelve turns and it is the only way to the bore head.',
      'The far door is sealed; the override is at the end of the lower gallery. Open it and get everyone through. Do not stop to admire the wildlife.',
    ],
    tips: [
      'The whole squad must stand in the extraction zone before the timer runs out.',
      'Send your fastest trooper for the terminal while the rest stack up at the door.',
    ],
    map: [
      '##########################',
      '#1...#......b...#....s..X#',
      '#2...c..........D.......X#',
      '#3...#...c......#..b....X#',
      '#4...#......s...#.......X#',
      '##.#####.####.############',
      '#......#....b.....#.....T#',
      '#..s.......c.............#',
      '#......#......p...#...A..#',
      '##########################',
    ],
  },
  {
    id: 'the-deep-bore',
    name: 'The Deep Bore',
    squad: 5,
    reward: 100,
    turnLimit: 18,
    objective: { type: 'exit' },
    spawn: { start: 2, every: 3, total: 12, pool: ['skitter', 'stalker', 'skitter', 'bloater'] },
    brief: [
      'This is where they came from: the bore head, eleven kilometres down. The drill broke into a warm cavity under the ice and the cavity was not empty.',
      'The charge has to go on the upper gallery, past the control room. The hatches here never stop. Keep moving.',
    ],
    tips: [
      'The terminal in the pump annex opens the control-room door. The ramp beyond leads up to the gallery.',
      'Stalkers cover eight tiles a turn. Keep someone watching the flanks.',
    ],
    raised: [[16, 1, 26, 4]],
    map: [
      '############################',
      '#1.2.#....H....#:::::::::XX#',
      '#3.4.c.........>::::c::::XX#',
      '#5...#..k......#:::::::p:XX#',
      '##.#######D#####:::::::::XX#',
      '#........#.....#############',
      '#..c........t.............H#',
      '#........c.....#...k......+#',
      '#...s....#..A..#...........#',
      '#H.......#....T#######...###',
      '############################',
    ],
  },
  {
    id: 'matriarch',
    name: 'Matriarch',
    squad: 5,
    reward: 150,
    objective: { type: 'kill', kind: 'behemoth' },
    spawn: { start: 2, every: 2, total: 16, pool: ['skitter', 'skitter', 'bloater', 'spitter'] },
    brief: [
      'The cavity. It is warm down here, and it should not be. Everything the colony\'s reactors bled into the ice for thirty years, she drank.',
      'She is the nest. Kill her and the rest is pest control. Her front is plated; her brood will keep coming until she stops.',
    ],
    tips: [
      'Frontal hits on the Matriarch do half damage. Flank her, or use weapons that ignore armour.',
      'You only need her dead. Do not waste the clock on the brood.',
    ],
    map: [
      '#########################',
      '#1.2.3...#......H.......#',
      '#.4.5....#..............#',
      '#........c....c...c.....#',
      '#.......................#',
      '###.######......M.......#',
      '#.......................#',
      '#..A..+..c....c...c.....#',
      '#........#..............#',
      '#........#......H.......#',
      '#########################',
    ],
  },
];

export function objectiveText(m) {
  const o = m.objective;
  let s = o.type === 'eliminate' ? 'Eliminate all hostiles'
    : o.type === 'exit' ? 'Move every surviving trooper into the extraction zone'
    : o.type === 'survive' ? `Survive ${o.turns} turns`
    : 'Kill the Matriarch';
  if (m.turnLimit) s += ` within ${m.turnLimit} turns`;
  return s;
}
