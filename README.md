# Recubation

A turn-based squad-tactics game for the browser, in the spirit of the 1997
classic *Incubation: Time Is Running Out*. Lead a squad of troopers through
eight missions in an overrun colony: spend action points carefully, set up
reaction fire, manage weapon heat and ammunition, and level your survivors
between missions.

This is an original homage, not a port: the rules follow the late-90s design,
but the names, missions, text and art are new.

## Running it

Requires Node.js 18+ and an internet connection (Three.js loads from a CDN).
There are no dependencies to install.

```bash
node serve.mjs        # or: npm start
```

Then open <http://localhost:8080>. ES modules can't load from `file://`, so the
game must be served; any static file server pointed at this folder works too.

Campaign progress is saved in the browser's local storage between missions.

## How to play

| Input | Action |
| --- | --- |
| Left click | Select a trooper · move to a blue tile · fire at a hostile · use a terminal |
| Right click | Turn the selected trooper to face that way (free) · cancel gear targeting |
| Shift + click | Fire a beam or shell at an empty tile |
| 1 – 9 | Choose fire mode |
| Tab | Next trooper |
| R | Rotate facing clockwise |
| Enter | End turn |
| W A S D / drag | Pan the camera |
| Q / E | Rotate the camera |
| Wheel | Zoom |
| Space | Centre on the selected trooper |
| F · M · H | Fast animations · mute · help |

Rules in brief:

- No dice: if you have line of sight and range, the shot lands for exactly the
  damage shown in the tooltip.
- Moving costs 1 AP per tile. Unspent AP become reaction fire during the enemy
  phase, but only into a trooper's front arc (shown in yellow).
- Weapons heat up as they fire and cool between turns; ammunition is finite.
- Height adds damage and lets you fire over heads; hits from behind do 50% more.
- Standing on a brood hatch seals it.
- Troopers who fall on a successful mission are gone for good.

Between missions, the armoury lets you spend skill points and requisition on
weapons, armour and gear (jump packs, medkits, stims, spare magazines).

## Project layout

```
index.html, style.css   page shell and HUD styling
serve.mjs               zero-dependency static server for local play
src/main.js             entry point: menus, campaign flow, battle lifecycle
src/battle.js           rules engine (movement, line of sight, combat, AI, objectives)
src/missions.js         the eight mission maps and their objectives
src/campaign.js         roster, progression, requisition, save/load
src/data.js             weapons, armour, gear, skills, aliens
src/view.js             Three.js rendering, animation and picking
src/models.js           procedural trooper and alien models
src/tactical.js         player input in the tactical view
src/ui.js               menus, briefing, armoury, debrief and HUD
src/audio.js            synthesized sound effects (Web Audio)
test/sim.mjs            headless checks
```

## Tests

```bash
npm test
```

Validates every map (ramps, reachability of units, exits, terminals, hatches
and pickups) and auto-plays the whole campaign with a simple bot to catch rule
or AI exceptions without a browser. The bot is not meant to win every mission.

## License

MIT; see [LICENSE](LICENSE).
