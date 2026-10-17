# Recubation

A browser squad-tactics game in the spirit of late-90s 3D turn-based strategy. Lead a squad of troopers through an eight-mission campaign, from *Cold Start* to *Matriarch*. There are no dice: if you have line of sight and range, the shot lands for exactly the damage shown.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer. Nothing to install: there are no npm dependencies.
- A modern browser with WebGL.
- An internet connection. Three.js is loaded from the jsDelivr CDN.

## Starting the game

From the project folder:

```bash
npm start
```

Then open <http://localhost:8080> in your browser.

To use a different port, pass it to the server directly:

```bash
node serve.mjs 5180
```

You can also set the `PORT` environment variable. The server listens on `127.0.0.1` only.

> Opening `index.html` straight from disk (`file://`) won't work. Browsers refuse to load ES modules that way, so the game has to be served over HTTP.

Campaign progress is saved automatically in your browser's `localStorage`. Use **Continue** on the title screen to pick up where you left off.

## Controls

| Input | Action |
| --- | --- |
| Left click | Select a trooper · move to a blue tile · fire at a hostile · use a terminal |
| Right click | Face the selected trooper that way (free) · cancel |
| Shift + click | Fire a beam or shell at an empty tile |
| 1–4 | Choose fire mode |
| Tab | Next trooper |
| R | Rotate facing clockwise |
| Enter | End turn |
| Esc | Cancel the armed action · close help |
| W A S D / arrows / drag | Pan the camera |
| Q / E | Rotate the camera |
| Mouse wheel | Zoom |
| Space | Centre on the selected trooper |
| F | Toggle fast animations |
| M | Mute |
| H | Help |

## Rules in brief

- Moving costs 1 AP per tile. Each fire mode lists its AP cost.
- Unspent AP become reaction fire during the enemy phase, but only into a trooper's front arc (shown in yellow). Set everyone's facing before you end the turn.
- Weapons heat up as they fire and cool between turns. A gun at its heat limit won't fire, not even on reaction.
- Ammunition is finite. Walk over a yellow crate to reload; a green cross heals.
- Bodies block shots, and nobody shoots through a friend. Height lets you fire over heads and adds +1 damage.
- Hits from behind deal 50% more damage, both ways.
- Standing on a brood hatch seals it.
- Troopers killed on a successful mission are gone for good. Replacements are free but green.

The in-game **How to play** screen (H) has the full rules.

## Running the tests

```bash
npm test
```

This runs `test/sim.mjs`, which needs no browser. It validates every map (reachability, ramps, start positions) and auto-plays each mission with a simple bot, so rule or AI errors surface as exceptions.

## Project layout

```
index.html      Entry page (loads Three.js via an import map)
style.css       HUD and screen styles
serve.mjs       Zero-dependency static file server
src/
  main.js       Entry point: campaign state, menus and battles
  campaign.js   Roster, progression, requisition, save/load
  missions.js   Mission definitions and maps
  battle.js     Tactical rules engine
  tactical.js   Input handling and turn control
  view.js       Three.js rendering and camera
  models.js     Procedural low-poly figures
  ui.js         Menus, armoury, debrief and HUD
  audio.js      Synthesised sound effects
  data.js       Weapons, armour, gear, skills, hostiles
test/sim.mjs    Headless map validation and auto-play
```

## License

[MIT](LICENSE)
