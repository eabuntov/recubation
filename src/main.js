// Entry point: owns the campaign state and moves between menu screens and battles.

import { View } from './view.js';
import { UI } from './ui.js';
import { Tactical } from './tactical.js';
import { Battle } from './battle.js';
import { MISSIONS } from './missions.js';
import { newCampaign, currentMission, reinforce, applyResult, save, load, clearSave } from './campaign.js';
import { sfx, unlock, ambience } from './audio.js';

const view = new View(document.getElementById('view'), document.getElementById('labels'));
const ui = new UI();
let state = null;
let battle = null;
let helpReturn = null;

const tactical = new Tactical(view, ui, {
  help: () => showHelp(null),
  closeHelp: () => closeHelp(),
  abort: () => { if (battle && tactical.ready && confirm('Abandon this mission? Nothing is lost; you return to the briefing.')) staging(); },
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
    if (name === 'alien') { sfx.alarm(); ui.banner('Hostile phase', 'alien'); await view.wait(650); return; }
    const m = b.mission, left = m.turnLimit ? m.turnLimit - b.turn : null;
    const sub = m.objective.type === 'survive' ? `${m.objective.turns - b.turn + 1} to hold`
      : left != null && left <= 4 ? (left === 0 ? 'Final turn' : `${left + 1} turns remain`) : '';
    sfx.turn();
    ui.banner(`Turn ${b.turn}`, '', sub);
    await view.wait(450);
  },
  async finish(result) {
    ui.hud(battle, null, 0, null, {});
    (result.win ? sfx.win : sfx.lose)();
    ui.banner(result.win ? 'Mission complete' : 'Mission failed', result.win ? 'win' : 'alien', result.text, true);
    await view.wait(2200);
    const done = battle;
    const mission = done.mission;
    endBattle();
    const report = applyResult(state, done.summary());
    save(state);
    ui.debrief(report, mission, { onContinue: staging, onRetry: deploy, onArmory: () => armory() });
  },
}, {
  // Anything not handled above is a visual effect owned by the view.
  get(own, name) {
    if (name in own) return own[name];
    return async (...args) => {
      if (typeof view[name] === 'function') await view[name](...args);
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
      if (load() && !confirm('Start over? The current campaign will be erased.')) return;
      clearSave();
      state = newCampaign();
      staging();
    },
    onHelp: () => showHelp(title),
  });
}

function staging() {
  if (battle) endBattle();
  if (!view.attract) backdrop();
  if (state.complete) { ui.ending(state, { onDone: () => { clearSave(); title(); } }); return; }
  const fresh = reinforce(state);
  save(state);
  ui.staging(state, currentMission(state), fresh, { onDeploy: deploy, onArmory: () => armory(), onQuit: title });
}

function armory() {
  ui.armory(state, { onBack: staging, onChange: () => save(state) });
}

async function deploy() {
  const mission = currentMission(state);
  ui.hide();
  document.body.classList.remove('menu');
  view.attract = false;
  battle = new Battle(mission, state.squad, fx);
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
  if (helpReturn) helpReturn(); else ui.hide();
}

window.addEventListener('error', e => fatal(e.message));
window.addEventListener('unhandledrejection', e => fatal(e.reason && e.reason.stack || String(e.reason)));
function fatal(msg) {
  const el = document.getElementById('fatal');
  el.textContent = 'Something broke:\n\n' + msg + '\n\nReload the page to continue; campaign progress is saved between missions.';
  el.hidden = false;
}

// Small hook for automated checks and the curious.
window.recubation = { view, tactical, get battle() { return battle; }, get state() { return state; } };

title();
