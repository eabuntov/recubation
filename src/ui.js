// DOM interface: menus, armoury, debrief and the tactical HUD.

import { WEAPONS, ARMORS, GEAR, SKILLS, RANKS, BASE_HP, BASE_AP, xpForLevel, meetsReq, reqText } from './data.js';
import { objectiveText, MISSIONS } from './missions.js';
import { GEAR_SLOTS, canRaise, raiseSkill, skillCost, equip, equipProblem } from './campaign.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);

// h('div.card.sel', { onclick }, child, 'text', ...)
export function h(spec, props, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const k in props || {}) {
    const v = props[k];
    if (k === 'style') for (const p in v) p.startsWith('--') ? el.style.setProperty(p, v[p]) : (el.style[p] = v[p]);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const hex = c => '#' + c.toString(16).padStart(6, '0');
export const rankOf = s => RANKS[Math.min(RANKS.length - 1, s.level - 1)];
const click = fn => e => { sfx.click(); fn(e); };
const btn = (label, fn, cls = '', props = {}) => h('button' + (cls ? '.' + cls : ''), { onclick: click(fn), ...props }, label);

function soldierStats(s) {
  const gear = s.gear.filter(Boolean).map(g => GEAR[g]);
  return {
    hp: BASE_HP + s.skills.vitality * 2 + ARMORS[s.armor].hp,
    ap: BASE_AP + s.skills.reflexes + gear.reduce((n, g) => n + (g.apBonus || 0), 0),
  };
}

function modeLine(w) {
  return w.modes.map(m => `${m.name} ${m.dmg}dmg/${m.ap}AP`).join(' · ');
}

export class UI {
  constructor() {
    this.screen = $('screen');
    this.hudEl = $('hud');
    this.tipEl = $('tip');
    this.toastTimer = 0;
  }

  // ---------------------------------------------------------------- screens

  show(node, modal = false) {
    this.screen.replaceChildren(node);
    this.screen.classList.toggle('modal', modal);
    this.screen.hidden = false;
    this.screen.scrollTop = 0;
    this.tip(null);
  }

  hide() { this.screen.hidden = true; this.screen.replaceChildren(); }

  title({ hasSave, onNew, onContinue, onHelp }) {
    this.show(h('div.title',
      h('h1', 'Recubation'),
      h('div.sub', 'Squad tactics under the ice'),
      h('div.menu',
        hasSave && btn('Continue campaign', onContinue, 'primary'),
        btn('New campaign', onNew, hasSave ? '' : 'primary'),
        btn('How to play', onHelp),
      ),
      h('p.note', 'An original, fan-made homage to the 3D turn-based squad tactics games of the late 1990s. All names, art, missions and writing here are new.'),
    ));
  }

  staging(state, mission, fresh, { onDeploy, onArmory, onQuit }) {
    const unspent = state.squad.some(s => s.sp > 0);
    this.show(h('div.sheet',
      h('header',
        h('h2', mission.name),
        h('span.tag', `Mission ${state.mission + 1} of ${MISSIONS.length}`),
        h('span.rp', `${state.rp} RP`),
      ),
      h('div.body.cols',
        h('div',
          mission.brief.map(p => h('p', p)),
          h('h3', 'Objective'),
          h('div.objective', objectiveText(mission)),
          h('h3', 'Field notes'),
          h('ul', mission.tips.map(t => h('li', t))),
        ),
        h('div',
          h('h3', { style: { marginTop: 0 } }, `Squad · ${mission.squad} deploy`),
          h('div.roster', state.squad.slice(0, mission.squad).map(s => {
            const st = soldierStats(s);
            return h('div.card', { style: { '--c': hex(s.color) } },
              h('div.row',
                h('span.name', s.name, fresh.includes(s) && h('span.badge.new', 'NEW'), s.sp > 0 && h('span.badge', `${s.sp} SP`)),
                h('span.num', `${rankOf(s)} · L${s.level}`)),
              h('div.kit', `${WEAPONS[s.weapon].name} · ${ARMORS[s.armor].name}`),
              h('div.kit', `${st.hp} HP · ${st.ap} AP` + (s.gear.filter(Boolean).length ? ' · ' + s.gear.filter(Boolean).map(g => GEAR[g].name).join(', ') : '')),
            );
          })),
          state.fallen.length > 0 && h('p', { style: { marginTop: '14px', fontSize: '12px' } }, `In memoriam: ${state.fallen.map(f => f.name).join(', ')}.`),
        ),
      ),
      h('footer',
        btn('Main menu', onQuit),
        h('span.spacer'),
        btn(unspent ? 'Armoury · points to spend' : 'Armoury', onArmory, unspent ? 'on' : ''),
        btn('Deploy', onDeploy, 'primary'),
      ),
    ));
  }

  armory(state, { onBack, onChange }, pickId, scroll = 0) {
    const s = state.squad.find(q => q.id === pickId) || state.squad[0];
    // Rebuilding the sheet after a change must not throw the player back to the top of the list.
    const redraw = () => { onChange(); this.armory(state, { onBack, onChange }, s.id, this.screen.querySelector('.body').scrollTop); };
    const st = soldierStats(s);

    const itemRow = (table, kind, id) => {
      const def = table[id], on = s[kind] === id;
      const problem = on ? null : equipProblem(state, s, table, id, s[kind]);
      const delta = def.cost - table[s[kind]].cost;
      return h('div.item' + (on ? '.on' : '') + (problem === 'Not qualified' ? '.locked' : ''),
        h('div',
          h('span.name', def.name), ' ',
          h('span.meta', `${def.cost} RP` + (kind === 'weapon' ? ` · range ${def.range} · ${def.ammo} rds` : '')),
          reqText(def.req) && h('span.meta.req', '  needs ' + reqText(def.req)),
        ),
        on ? h('span.meta', 'EQUIPPED')
          : btn(problem || (delta > 0 ? `Buy ${delta}` : delta < 0 ? `Swap +${-delta}` : 'Swap'), () => { equip(state, s, kind, id); redraw(); }, '', { disabled: !!problem }),
        h('div.desc', kind === 'weapon' ? `${modeLine(def)}. ${def.desc}` : def.desc),
      );
    };

    const slot = i => {
      const cur = s.gear[i];
      const sel = h('select', {
        onchange: e => { equip(state, s, 'gear', e.target.value || null, i); sfx.click(); redraw(); },
      },
        h('option', { value: '' }, '— empty —'),
        Object.keys(GEAR).map(id => {
          const g = GEAR[id];
          const problem = id === cur ? null : equipProblem(state, s, GEAR, id, cur);
          const need = reqText(g.req);
          return h('option', { value: id, selected: id === cur, disabled: !!problem },
            `${g.name} · ${g.cost} RP` + (need && !meetsReq(s.skills, g.req) ? ` · needs ${need}` : '') + (problem === 'Not enough requisition' ? ' · too expensive' : ''));
        }),
      );
      return h('div.slot', sel, h('div.desc', cur ? GEAR[cur].desc : 'Nothing carried in this slot.'));
    };

    this.show(h('div.sheet',
      h('header', h('h2', 'Armoury'), h('span.tag', 'Kit can be swapped freely; old items are refunded in full.'), h('span.rp', `${state.rp} RP`)),
      h('div.body.armory',
        h('div.roster', state.squad.map(q => h('div.card' + (q === s ? '.sel' : ''), { style: { '--c': hex(q.color) }, onclick: click(() => this.armory(state, { onBack, onChange }, q.id)) },
          h('div.row', h('span.name', q.name), q.sp > 0 && h('span.badge', `${q.sp} SP`)),
          h('div.num', `${rankOf(q)} · L${q.level}`),
        ))),
        h('div',
          h('div.stats',
            h('span', h('b', s.name), ` · ${rankOf(s)}`),
            h('span', 'Level ', h('b', s.level)),
            h('span', 'XP ', h('b', s.xp), ` / ${xpForLevel(s.level)}`),
            h('span', 'Health ', h('b', st.hp)),
            h('span', 'AP ', h('b', st.ap)),
            h('span', 'Kills ', h('b', s.kills)),
            h('span', 'Skill points ', h('b', { style: { color: s.sp ? 'var(--warn)' : '' } }, s.sp)),
          ),
          h('h3', 'Training'),
          Object.keys(SKILLS).map(id => {
            const sk = SKILLS[id], lvl = s.skills[id], maxed = lvl >= sk.max;
            return h('div.skill',
              h('span', sk.name),
              h('span.pips', Array.from({ length: sk.max }, (_, i) => h('b' + (i < lvl ? '' : '.off')))),
              h('span.desc', sk.desc),
              btn(maxed ? 'Max' : `+ ${skillCost(s, id)} SP`, () => { raiseSkill(s, id); redraw(); }, '', { disabled: !canRaise(s, id) }),
            );
          }),
          h('div.grid2',
            h('div', h('h3', 'Weapon'), Object.keys(WEAPONS).map(id => itemRow(WEAPONS, 'weapon', id))),
            h('div',
              h('h3', 'Armour'), Object.keys(ARMORS).map(id => itemRow(ARMORS, 'armor', id)),
              h('h3', 'Gear'), Array.from({ length: GEAR_SLOTS }, (_, i) => slot(i)),
            ),
          ),
        ),
      ),
      h('footer', btn('Back to briefing', onBack, 'primary')),
    ));
    this.screen.querySelector('.body').scrollTop = scroll;
  }

  debrief(report, mission, { onContinue, onRetry, onArmory }) {
    const body = report.win
      ? h('div',
        h('p', `${report.text} Completed in ${report.turns} turns. Requisition awarded: ${report.reward} RP.`),
        h('table.report',
          h('tr', h('th', 'Trooper'), h('th', 'Kills'), h('th', 'Experience'), h('th', 'Status')),
          report.rows.map(r => h('tr',
            h('td', r.soldier.name),
            h('td.num', r.kills),
            h('td.num', r.alive ? `+${r.xp}` : '—'),
            h('td', r.alive
              ? (r.levels ? h('span.promo', `Promoted to ${rankOf(r.soldier)} · +${r.levels * 2} skill points`) : 'Fit for duty')
              : h('span.kia', 'Killed in action')),
          )),
        ))
      : h('div',
        h('p', report.text),
        h('p', 'Command is treating that as a simulation run. The squad is intact and the mission can be attempted again; consider a different loadout.'));
    this.show(h('div.sheet', { style: { width: 'min(720px, 100%)' } },
      h('header', h('h2', { style: { color: report.win ? 'var(--good)' : 'var(--bad)' } }, report.win ? 'Mission complete' : 'Mission failed'), h('span.tag', mission.name)),
      h('div.body', body),
      h('footer', report.win
        ? [btn('Continue', onContinue, 'primary')]
        : [btn('Armoury', onArmory), btn('Retry', onRetry, 'primary')]),
    ));
  }

  ending(state, { onDone }) {
    const kills = state.squad.reduce((n, s) => n + s.kills, 0) + state.fallen.reduce((n, f) => n + f.kills, 0);
    this.show(h('div.sheet', { style: { width: 'min(720px, 100%)' } },
      h('header', h('h2', { style: { color: 'var(--good)' } }, 'Halcyon Deep is quiet')),
      h('div.body', h('div',
        h('p', 'The Matriarch is dead and the cavity is cooling. Without her the brood slows, then stops, like a machine with the power cut.'),
        h('p', 'The picket ship lifts the survivors off the ice eleven hours later. The bore shaft is sealed with forty metres of foamcrete and a warning in six languages.'),
        h('p', `Final tally: ${kills} hostiles destroyed. ${state.squad.length} troopers came home` + (state.fallen.length ? `; ${state.fallen.map(f => f.name).join(', ')} did not.` : ', every one of them.')),
        h('table.report',
          h('tr', h('th', 'Trooper'), h('th', 'Rank'), h('th', 'Missions'), h('th', 'Kills')),
          state.squad.map(s => h('tr', h('td', s.name), h('td', rankOf(s)), h('td.num', s.missions), h('td.num', s.kills))),
        ),
      )),
      h('footer', btn('Main menu', onDone, 'primary')),
    ));
  }

  help(onClose) {
    const dl = rows => h('dl', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
    this.show(h('div.sheet', { style: { width: 'min(900px, 100%)' } },
      h('header', h('h2', 'How to play')),
      h('div.body.help',
        h('div',
          h('h3', { style: { marginTop: 0 } }, 'Controls'),
          dl([
            ['Left click', 'Select a trooper · move to a blue tile · fire at a hostile · use a terminal'],
            ['Right click', 'Turn the selected trooper to face that way (free) · cancel'],
            ['Shift + click', 'Fire a beam or shell at an empty tile'],
            ['1 – 4', 'Choose fire mode'],
            ['Tab', 'Next trooper'],
            ['R', 'Rotate facing clockwise'],
            ['Enter', 'End turn'],
            ['W A S D / drag', 'Pan the camera'],
            ['Q / E', 'Rotate the camera'],
            ['Wheel', 'Zoom'],
            ['Space', 'Centre on the selected trooper'],
            ['F · M · H', 'Fast animations · mute · this help'],
          ]),
        ),
        h('div',
          h('h3', { style: { marginTop: 0 } }, 'Rules of engagement'),
          h('ul',
            h('li', 'There are no dice. If you have a line and the range, the shot lands for exactly the damage shown.'),
            h('li', 'Moving costs 1 AP per tile. Each fire mode lists its AP cost.'),
            h('li', 'Unspent AP turn into reaction fire in the enemy phase, but only into the trooper\'s front arc (shown in yellow). Choose where everyone is looking before you end the turn.'),
            h('li', 'Weapons heat up as they fire and cool between turns. A gun at its limit will not fire, even on reaction.'),
            h('li', 'Ammunition is finite. Walk over a yellow crate to reload; a green cross patches a trooper up.'),
            h('li', 'Bodies block bullets. Nobody shoots through a friend. Height lets you fire over heads and adds +1 damage.'),
            h('li', 'Hits from behind do 50% more damage, to them and to you.'),
            h('li', 'Standing on a brood hatch seals it.'),
            h('li', 'Troopers killed on a successful mission are gone for good; replacements are free but green.'),
          ),
        ),
      ),
      h('footer', btn('Close', onClose, 'primary')),
    ), true);
  }

  // ---------------------------------------------------------------- tactical HUD

  hudShow(on) { this.hudEl.hidden = !on; if (!on) { this.tip(null); $('banner').className = ''; } }

  hud(battle, sel, modeIdx, armed, handlers) {
    const m = battle.mission;
    $('mission').replaceChildren(h('b', m.name), h('span', objectiveText(m)));

    const clock = $('clock');
    const parts = [];
    const o = m.objective;
    if (o.type === 'survive') parts.push(h('span', `TURN ${battle.turn} / ${o.turns}`));
    else if (m.turnLimit) {
      const left = m.turnLimit - battle.turn;
      parts.push(h('span' + (left <= 2 ? '.bad' : left <= 4 ? '.warn' : ''), `TURN ${battle.turn} / ${m.turnLimit}`));
    } else parts.push(h('span', `TURN ${battle.turn}`));
    const hostile = battle.aliens().length;
    const next = battle.nextSpawnIn();
    parts.push(h('small', `${hostile} hostile${hostile === 1 ? '' : 's'}` + (next == null ? '' : next === 0 ? ' · hatches open this turn' : ` · hatches open in ${next}`)));
    clock.replaceChildren(...parts);

    const mine = battle.units.filter(u => u.side === 'marine');
    $('squad').replaceChildren(...mine.map(u => h('div.card' + (u === sel ? '.sel' : '') + (u.alive ? '' : '.dead'), {
      style: { '--c': hex(u.soldier.color) },
      onclick: () => u.alive && handlers.select && handlers.select(u),
    },
      h('div.row', h('span.name', u.name), h('span.num', u.alive ? `${u.hp}/${u.maxHp}` : 'KIA')),
      h('div.bar' + (u.hp <= u.maxHp / 3 ? '.low' : ''), h('i', { style: { width: (100 * u.hp / u.maxHp) + '%' } })),
      u.alive && h('div.pips', Array.from({ length: Math.max(u.maxAp, u.ap) }, (_, i) => h('b' + (i < u.ap ? '' : '.off')))),
    )));

    const panel = $('panel');
    const mineTurn = battle.phase === 'player' && !battle.over;
    $('btn-end').disabled = !mineTurn || battle.busy;
    if (!sel) { panel.replaceChildren(); return; }
    const w = sel.weapon, modes = battle.modes(sel);
    panel.replaceChildren(
      h('div.who',
        h('b', sel.name),
        h('small', `${rankOf(sel.soldier)} · HP ${sel.hp}/${sel.maxHp}`),
        h('small', `AP ${sel.ap}/${sel.maxAp}`),
        h('div.pips', { style: { marginTop: '5px' } }, Array.from({ length: Math.max(sel.maxAp, sel.ap) }, (_, i) => h('b' + (i < sel.ap ? '' : '.off')))),
      ),
      h('div.gun',
        h('div.label', h('b', w.def.name), h('span', `rng ${w.range}`)),
        h('div.label', { style: { marginTop: '6px' } }, 'Ammo', h('span', `${w.ammo}/${w.def.ammo}`)),
        h('div.bar', h('i', { style: { width: (100 * w.ammo / w.def.ammo) + '%', background: 'var(--accent)' } })),
        h('div.label', 'Heat', h('span', `${w.heat}/${w.def.maxHeat} · −${w.cool}/turn`)),
        h('div.bar.heat', h('i', { style: { width: (100 * Math.min(1, w.heat / w.def.maxHeat)) + '%' } })),
      ),
      h('div.acts',
        modes.map((mode, i) => {
          const problem = battle.fireProblem(sel, mode);
          return h('button.act' + (i === modeIdx && !armed ? '.on' : ''), {
            onclick: click(() => handlers.mode(i)), title: problem || '', style: problem ? { opacity: 0.55 } : {},
          },
            h('kbd', String(i + 1)), mode.name,
            h('small', `${mode.dmg} dmg · ${mode.ap} AP` + (mode.heat ? ` · +${mode.heat}°` : '')),
          );
        }),
        sel.gear.filter(g => g.def.active).map(g => {
          const problem = battle.gearProblem(sel, g, sel.x, sel.y);
          const blocked = g.charges <= 0 || sel.ap < g.def.ap || (g.def.active === 'reload' && problem);
          return h('button.act' + (armed === g ? '.on' : ''), { onclick: click(() => handlers.gear(g)), disabled: !!blocked || !mineTurn },
            g.def.name, h('small', `×${g.charges} · ${g.def.ap} AP`));
        }),
      ),
    );
  }

  banner(text, cls = '', sub = '', hold = false) {
    const b = $('banner');
    b.className = '';
    void b.offsetWidth; // restart the animation
    b.replaceChildren(text, sub ? h('small', sub) : '');
    b.className = (hold ? 'hold ' : 'show ') + cls;
  }

  toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
    sfx.deny();
  }

  tip(html, x = 0, y = 0) {
    const t = this.tipEl;
    if (!html) { t.hidden = true; return; }
    t.innerHTML = html;
    t.hidden = false;
    const w = t.offsetWidth, hh = t.offsetHeight;
    t.style.left = Math.min(window.innerWidth - w - 8, x + 18) + 'px';
    t.style.top = Math.min(window.innerHeight - hh - 8, y + 18) + 'px';
  }
}
