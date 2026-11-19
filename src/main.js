// Entry point: owns the campaign state and moves between menu screens and battles.

import { View } from './view.js';
import { UI } from './ui.js';
import { Tactical } from './tactical.js';
import { Battle } from './battle.js';
import { MISSIONS } from './missions.js';
import { newCampaign, currentMission, topUp, applyResult, save, load, clearSave, byLevel, contractDue, payContract, demobilize, buyClone, payClone, cloneDrop, cloneView } from './campaign.js';
import { initCheats } from './cheats.js';
import { generateMap } from './genmap.js';
import { sfx, unlock, ambience } from './audio.js';
import { t, initLang, setLang } from './i18n.js';
import { localize } from './locale.js';

const view = new View(document.getElementById('view'), document.getElementById('labels'));
const ui = new UI();
let state = null;
let battle = null;
let helpReturn = null;

const tactical = new Tactical(view, ui, {
  help: () => showHelp(null),
  abort: () => {
    if (!(battle && tactical.ready)) return;
    // A battle with nobody left to fight is lost whatever the difficulty says.
    if (state.difficulty === 'ironman' && battle.marines().length) { ui.toast(t('On Ironman the mission has to be seen through.')); return; }
    ui.confirm(t('Abandon this mission? Nothing is lost; you return to the briefing.'), t('Abort'), staging);
  },
});

// Modal screens handle their keys at the document level: the title screen has
// no battle for Tactical's own handler to lean on. Esc closes, Enter confirms.
window.addEventListener('keydown', e => {
  const screen = document.getElementById('screen');
  if (screen.hidden || !screen.classList.contains('modal')) return;
  if (e.code === 'Escape') { e.preventDefault(); closeHelp(); }
  else if (e.code === 'Enter' && ui.confirming) { e.preventDefault(); ui.settleConfirm(true); }
});

window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });

// Effects after which the HUD should catch up even mid-phase.
const LIVE = new Set(['damage', 'death', 'spawn', 'heal', 'pickup']);

// The rules engine reports events here; each one fans out to whoever cares.
const fx = new Proxy({
  refresh() { tactical.refresh(); },
  async phase(name, b) {
    tactical.refresh();
    if (name === 'alien') { sfx.alarm(); ui.banner(t('Hostile phase'), 'alien'); await view.wait(650); return; }
    // Spawns may have dragged the camera to a visible hatch; the player's turn
    // starts looking at the squad. Soft focus: no yank when they are in frame.
    if (tactical.sel) view.focus(tactical.sel.x, tactical.sel.y);
    const m = b.mission, left = m.turnLimit ? m.turnLimit - b.turn : null;
    const sub = m.objective.type === 'survive' ? t('{n} to hold', { n: m.objective.turns - b.turn + 1 })
      : left != null && left <= 4 ? (left === 0 ? t('Final turn') : t('{n} turns remain', { n: left + 1 })) : '';
    sfx.turn();
    ui.banner(t('Turn {n}', { n: b.turn }), '', sub);
    await view.wait(450);
  },
  async finish(result) {
    ui.hud(battle, null, 0, null, {});
    (result.win ? sfx.win : sfx.lose)();
    ui.banner(t(result.win ? 'Mission complete' : 'Mission failed'), result.win ? 'win' : 'alien', result.text, true);
    await view.wait(2200);
    const done = battle;
    const mission = done.mission;
    endBattle();
    const report = applyResult(state, done.summary());
    save(state);
    ui.debrief(report, mission, { onContinue: staging, onRetry: staging });
  },
}, {
  // Anything not handled above is a visual effect owned by the view.
  get(own, name) {
    if (name in own) return own[name];
    return async (...args) => {
      // An enemy stepping out of the dark shows itself before it acts: the
      // shooter is revealed, then the shot — never a beam from nowhere.
      if (battle && battle.limited && args[0] && args[0].side === 'alien') {
        battle.updateVision();
        view.syncVision(battle);
      }
      if (typeof view[name] === 'function') await view[name](...args);
      // During the enemy phase, hostiles stepping in or out of sight must
      // show or vanish right away — not after the next damage number.
      if (name === 'step' && battle && battle.limited) { battle.updateVision(); view.syncVision(battle); }
      if (LIVE.has(name)) tactical.refresh();
    };
  },
});

function backdrop() {
  // A slowly turning empty level behind the menus.
  const m = MISSIONS[2];
  const b = new Battle({ ...m, map: m.map.map(r => r.replace(/[spkbtM1-9]/g, '.')) }, []);
  view.load(b);
  view.attract = true;
  view.cam.distGoal = 17;
  document.body.classList.add('menu');
}

function endBattle() {
  tactical.stop();
  battle = null;
  ui.hudShow(false);
  ambience(false);
  document.body.classList.add('menu');
}

function title() {
  if (battle) endBattle();
  if (!view.attract) backdrop();
  ui.title({
    hasSave: !!load(),
    onContinue: () => { state = load(); staging(); },
    onNew: () => {
      const start = (difficulty, limitedVision, callRadius) => {
        if (!load()) { clearSave(); state = newCampaign(difficulty, limitedVision, callRadius); staging(); return; }
        ui.confirm(t('Start over? The current campaign will be erased.'), t('New campaign'), () => {
          clearSave();
          state = newCampaign(difficulty, limitedVision, callRadius);
          staging();
        }, title);
      };
      ui.difficultyPick({ onPick: start, onCancel: title });
    },
    onHelp: () => showHelp(title),
    onLang: async code => { await setLang(code, true); localize(); title(); },
  });
}

let deployIds = null; // soldier ids picked for the next drop; null = best of the roster
let deployClone = false; // whether the leased clone takes a slot on the next drop
let freshIds = new Set(); // recently hired, for the NEW badge

// The mission as it will actually be fought: the authored definition with a
// rolled floor plan — same size, same brood, same schedule, new geography.
// The seed is drawn once per mission per campaign and kept in the save, so a
// retried mission replays the same map while a new campaign rolls fresh ones.
// A roll the checks reject falls back to the authored map.
function stagedMission() {
  const mission = currentMission(state);
  if (!(state.mission in state.maps)) state.maps[state.mission] = (Math.random() * 0x7fffffff) | 0;
  const gen = generateMap(mission, state.mission, state.maps[state.mission]);
  return gen ? { ...mission, map: gen.map, raised: gen.raised } : mission;
}

function staging() {
  if (battle) endBattle();
  if (!view.attract) backdrop();
  if (state.complete) { ui.ending(state, { onDone: () => { clearSave(); title(); } }); return; }
  const mission = stagedMission();
  // Replacements walk off the drop ship on their own now; badge them NEW.
  for (const s of topUp(state)) freshIds.add(s.id);
  // An unpaid clone cannot take a slot; a missing one ends the lease talk.
  if (!state.clone || !state.clone.paid) deployClone = false;
  save(state);
  // Keep what the player last picked; bury whoever has since been lost, drop
  // whoever is off-contract, and fall back to the top of the roster.
  const deployable = s => !contractDue(s);
  const cap = mission.squad - (deployClone ? 1 : 0);
  const top = () => [...state.squad].filter(deployable).sort(byLevel).slice(0, cap).map(s => s.id);
  const alive = new Set(state.squad.filter(deployable).map(s => s.id));
  deployIds = new Set([...(deployIds || top())].filter(id => alive.has(id)));
  while (deployIds.size > cap) deployIds.delete([...deployIds].pop());
  if (!deployIds.size) deployIds = new Set(top());
  // Picking a perk rebuilds the sheet; hand the scroll position back to it.
  const scroll = Math.max(ui.screen.scrollTop, document.querySelector('#screen .body')?.scrollTop || 0);
  ui.staging(state, mission, state.squad.filter(s => freshIds.has(s.id)), {
    onDeploy: () => deploy(state.squad.filter(s => deployIds.has(s.id))),
    onArmory: () => armory(),
    onQuit: () => { deployIds = null; title(); },
    onPay: s => { const err = payContract(state, s); if (err) ui.toast(err); save(state); staging(); },
    onDemobilize: s => { demobilize(state, s); save(state); staging(); },
    onBuyClone: () => { const err = buyClone(state); if (err) ui.toast(err); save(state); staging(); },
    onPayClone: () => { const err = payClone(state); if (err) ui.toast(err); save(state); staging(); },
    onToggleClone: () => {
      if (!state.clone) return;
      if (!state.clone.paid) return ui.toast(t('Pay for the drop first'));
      deployClone = !deployClone;
      staging();
    },
  }, deployIds, (id, add) => { add ? deployIds.add(id) : deployIds.delete(id); staging(); }, deployClone, cap, scroll);
}

function armory() {
  ui.armory(state, { onBack: staging, onChange: () => save(state) });
}

async function deploy(soldiers) {
  const mission = stagedMission();
  freshIds.clear();
  const squad = soldiers && soldiers.length
    ? soldiers
    : [...state.squad].filter(s => !contractDue(s)).sort(byLevel).slice(0, mission.squad);
  const drop = [...squad];
  // The clone takes a slot, its fee burns with the drop.
  if (deployClone && state.clone && state.clone.paid) {
    state.clone.paid = false;
    drop.push(cloneDrop(state));
    deployClone = false;
  }
  ui.hide();
  document.body.classList.remove('menu');
  view.attract = false;
  battle = new Battle(mission, drop, fx, state.difficulty, state.limitedVision, state.callRadius);
  view.load(battle);
  tactical.start(battle);
  ui.hudShow(true);
  ambience(true);
  await battle.begin();
}

function showHelp(back) {
  helpReturn = back;
  ui.help(closeHelp);
}

function closeHelp() {
  if (ui.closeConfirm()) return;
  if (helpReturn) helpReturn(); else ui.hide();
}

// The fatal screen is for the game's own bugs only. Browser extensions inject
// code into the page as well; their crashes arrive as stacks of bare <anonymous>
// frames naming no file of ours, and must not cover the game with this overlay.
window.addEventListener('error', e => {
  if (e.filename && new URL(e.filename, location.href).origin === location.origin) fatal(e.message);
  else console.error('Non-game error ignored:', e.message);
});
window.addEventListener('unhandledrejection', e => {
  const stack = e.reason && e.reason.stack;
  if (stack && stack.includes(location.origin)) fatal(stack);
  else console.warn('Non-game rejection ignored:', e.reason);
});
function fatal(msg) {
  const el = document.getElementById('fatal');
  el.textContent = t('Something broke:') + '\n\n' + msg + '\n\n' + t('Reload the page to continue; campaign progress is saved between missions.');
  el.hidden = false;
}

// Small hook for automated checks and the curious.
window.recubation = { view, tactical, get battle() { return battle; }, get state() { return state; } };

// Testing cheats: typed codes (see src/cheats.js). They touch the campaign
// only, so mid-battle they take effect at the next screen.
initCheats({
  getState: () => state,
  save,
  toast: msg => ui.toast(msg),
  redraw: () => { if (!battle) staging(); },
});

await initLang();
localize();
title();
