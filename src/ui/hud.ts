/**
 * HUD: a DOM overlay rendered above the 3D view.
 *
 * Layout: city identity top-left, treasury/population and speed controls
 * top-right, the tool palette bottom-centre, and a small debug readout
 * bottom-right. The HUD reads engine and simulation state each frame rather
 * than subscribing to change events, which keeps it decoupled from the sim.
 */

import './styles.css';
import type { Engine, GameSpeed } from '../core/engine.js';
import type { GameState } from '../sim/state.js';
import type { ToolManager } from '../input/tools.js';
import { formatDate, formatTimeOfDay } from '../core/time.js';

/** Toolbar entries. Ids without a registered tool fall back to select. */
const TOOL_BUTTONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'select', label: 'Select' },
  { id: 'roads', label: 'Roads' },
  { id: 'zones', label: 'Zones' },
  { id: 'power', label: 'Power' },
  { id: 'water', label: 'Water' },
  { id: 'services', label: 'Services' },
  { id: 'info', label: 'Info' },
];

const SPEED_BUTTONS: ReadonlyArray<{ speed: GameSpeed; label: string; title: string }> = [
  { speed: 0, label: '‖', title: 'Pause (Space)' },
  { speed: 1, label: '1x', title: 'Normal speed (1)' },
  { speed: 2, label: '2x', title: 'Fast (2)' },
  { speed: 4, label: '4x', title: 'Fastest (3)' },
];

/** Format a treasury amount as `¤ 500,000`. */
export function formatMoney(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}¤ ${Math.abs(rounded).toLocaleString('en-US')}`;
}

/** Format a population count with thousands separators. */
export function formatPopulation(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly engine: Engine;
  private readonly state: GameState;
  private readonly tools: ToolManager;

  private readonly nameEl: HTMLElement;
  private readonly dateEl: HTMLElement;
  private readonly moneyEl: HTMLElement;
  private readonly populationEl: HTMLElement;
  private readonly debugEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly toolButtons = new Map<string, HTMLButtonElement>();

  private readonly keyListener: (e: KeyboardEvent) => void;

  /** Speed restored when unpausing with Space. */
  private lastRunningSpeed: GameSpeed = 1;

  /**
   * @param mount Element to inject the HUD into, typically `#ui-root`.
   * @param engine Engine whose speed and stats are displayed and controlled.
   * @param state Game state read for city name, money and population.
   * @param tools Tool manager switched by the toolbar.
   */
  constructor(mount: HTMLElement, engine: Engine, state: GameState, tools: ToolManager) {
    this.engine = engine;
    this.state = state;
    this.tools = tools;

    this.root = el('div', 'hud');

    // --- Top left ---
    const city = el('div', 'hud-panel hud-city');
    this.nameEl = el('div', 'hud-city__name');
    this.dateEl = el('div', 'hud-city__date');
    city.append(this.nameEl, this.dateEl);

    // --- Top right ---
    const status = el('div', 'hud-panel hud-status');
    const stats = el('div', 'hud-stats');
    const money = this.buildStat('Treasury', 'hud-stat__value--money');
    const population = this.buildStat('Population');
    this.moneyEl = money.value;
    this.populationEl = population.value;
    stats.append(money.wrap, population.wrap);

    const speed = el('div', 'hud-speed');
    for (const def of SPEED_BUTTONS) {
      const btn = document.createElement('button');
      btn.className = 'hud-speed__btn';
      btn.textContent = def.label;
      btn.title = def.title;
      btn.addEventListener('click', () => this.setSpeed(def.speed));
      this.speedButtons.set(def.speed, btn);
      speed.append(btn);
    }
    status.append(stats, speed);

    // --- Bottom centre ---
    const toolbar = el('div', 'hud-panel hud-toolbar');
    for (const def of TOOL_BUTTONS) {
      const btn = document.createElement('button');
      btn.className = 'hud-tool';
      btn.textContent = def.label;
      btn.addEventListener('click', () => this.selectTool(def.id));
      this.toolButtons.set(def.id, btn);
      toolbar.append(btn);
    }

    // --- Bottom centre, above the toolbar: active-tool hint ---
    this.hintEl = el('div', 'hud-panel hud-hint');
    this.hintEl.hidden = true;

    // --- Bottom right ---
    this.debugEl = el('div', 'hud-panel hud-debug');

    this.root.append(city, status, toolbar, this.hintEl, this.debugEl);
    mount.append(this.root);

    this.keyListener = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyListener);

    this.setToolActive(tools.current?.id ?? 'select');
  }

  /**
   * Refresh all readouts. Call once per frame.
   * @param cameraHeight Camera altitude in metres, for the debug panel.
   */
  update(cameraHeight: number): void {
    const tick = this.state.tick;
    this.nameEl.textContent = this.state.cityName;
    this.dateEl.textContent = `${formatDate(tick)} · ${formatTimeOfDay(tick)}`;
    this.moneyEl.textContent = formatMoney(this.state.money);
    this.populationEl.textContent = formatPopulation(this.state.population);

    const active = this.engine.getSpeed();
    for (const [speed, btn] of this.speedButtons) {
      btn.classList.toggle('is-active', speed === active);
    }

    const { fps, tps } = this.engine.stats;
    this.debugEl.innerHTML =
      `fps <span class="hud-debug__value">${fps.toFixed(0)}</span> · ` +
      `tps <span class="hud-debug__value">${tps.toFixed(0)}</span><br>` +
      `cam <span class="hud-debug__value">${cameraHeight.toFixed(0)}m</span> · ` +
      `tick <span class="hud-debug__value">${tick}</span>`;
  }

  /**
   * Show a short hint for the active tool above the toolbar.
   * @param text Hint text, or `null`/empty to hide the hint.
   * @param warning Style the hint as a rejection.
   */
  setHint(text: string | null, warning = false): void {
    if (!text) {
      this.hintEl.hidden = true;
      this.hintEl.textContent = '';
      return;
    }
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('is-warning', warning);
    this.hintEl.hidden = false;
  }

  /** Remove the HUD and its listeners. */
  dispose(): void {
    window.removeEventListener('keydown', this.keyListener);
    this.root.remove();
  }

  private buildStat(
    label: string,
    valueModifier = '',
  ): { wrap: HTMLElement; value: HTMLElement } {
    const wrap = el('div', 'hud-stat');
    const labelEl = el('div', 'hud-stat__label');
    labelEl.textContent = label;
    const value = el('div', `hud-stat__value ${valueModifier}`.trim());
    wrap.append(labelEl, value);
    return { wrap, value };
  }

  private setSpeed(speed: GameSpeed): void {
    if (speed !== 0) this.lastRunningSpeed = speed;
    this.engine.setSpeed(speed);
  }

  private togglePause(): void {
    if (this.engine.getSpeed() === 0) this.engine.setSpeed(this.lastRunningSpeed);
    else this.engine.setSpeed(0);
  }

  private selectTool(id: string): void {
    // Clear first: the incoming tool publishes its own hint as it activates.
    this.setHint(null);
    // Buttons without a registered tool fall back to select but still light up.
    this.tools.setActive(this.tools.ids().includes(id) ? id : 'select');
    this.setToolActive(id);
  }

  private setToolActive(id: string): void {
    for (const [toolId, btn] of this.toolButtons) {
      btn.classList.toggle('is-active', toolId === id);
    }
  }

  private onKey(e: KeyboardEvent): void {
    // Ignore shortcuts while a text field has focus.
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.togglePause();
        break;
      case 'Digit1':
        this.setSpeed(1);
        break;
      case 'Digit2':
        this.setSpeed(2);
        break;
      case 'Digit3':
        this.setSpeed(4);
        break;
      default:
        break;
    }
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
