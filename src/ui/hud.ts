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
import { ZONE_COLORS } from '../sim/zoning.js';
import type { CityTotals } from '../sim/demand.js';

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

/**
 * One entry in a tool's options row — the sub-mode strip that appears above the
 * toolbar while its owning tool is active (the "tool options panel" of the v1
 * HUD structure). Zoning uses it for its four brushes.
 */
export interface ToolModeButton {
  /** Stable id, unique within the owning tool. */
  id: string;
  /** Player-facing label. */
  label: string;
  /** Optional swatch colour as a 24-bit hex number. */
  color?: number;
  /** Invoked when the player picks this mode. */
  onSelect(): void;
}

/** The three demand bars, in RCI order. Colours match the zone overlay. */
const DEMAND_BARS: ReadonlyArray<{
  zone: 'r' | 'c' | 'i';
  title: string;
  color: number;
}> = [
  { zone: 'r', title: 'Residential demand', color: ZONE_COLORS.residential },
  { zone: 'c', title: 'Commercial demand', color: ZONE_COLORS.commercial },
  { zone: 'i', title: 'Industrial demand', color: ZONE_COLORS.industrial },
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

/** Format a monthly net as a signed delta, e.g. `+¤ 1,240 / mo`. */
export function formatMonthlyNet(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '+';
  return `${sign}¤ ${Math.abs(rounded).toLocaleString('en-US')} / mo`;
}

/**
 * Live aggregates the HUD displays but does not own.
 *
 * `CityTotals` is derived and deliberately never saved (simulation.md §8), so
 * the HUD cannot read it off `GameState` the way it reads money and population.
 * It is supplied as a getter instead, which keeps the HUD pull-based and lets
 * it render perfectly well with nothing attached.
 */
export interface HudFeeds {
  /** The last daily recount, or `null` when no demand system is running. */
  totals?: (() => Readonly<CityTotals> | null) | null;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly engine: Engine;
  private readonly state: GameState;
  private readonly tools: ToolManager;

  private readonly feeds: HudFeeds;

  private readonly nameEl: HTMLElement;
  private readonly dateEl: HTMLElement;
  private readonly moneyEl: HTMLElement;
  private readonly moneyDeltaEl: HTMLElement;
  private readonly populationEl: HTMLElement;
  private readonly jobsEl: HTMLElement;
  private readonly buildingsEl: HTMLElement;
  private readonly demandBars = new Map<'r' | 'c' | 'i', HTMLElement>();
  private readonly debugEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly modesEl: HTMLElement;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly toolButtons = new Map<string, HTMLButtonElement>();

  /** Sub-mode strips, keyed by owning tool id. */
  private readonly toolModes = new Map<
    string,
    { buttons: Map<string, HTMLButtonElement>; row: HTMLElement }
  >();

  /** Tool whose options row is currently shown, or `null`. */
  private shownModesFor: string | null = null;

  private readonly keyListener: (e: KeyboardEvent) => void;

  /** Speed restored when unpausing with Space. */
  private lastRunningSpeed: GameSpeed = 1;

  /**
   * @param mount Element to inject the HUD into, typically `#ui-root`.
   * @param engine Engine whose speed and stats are displayed and controlled.
   * @param state Game state read for city name, money and population.
   * @param tools Tool manager switched by the toolbar.
   * @param feeds Derived aggregates the HUD shows but does not own. Optional:
   *   without them the jobs sub-line simply reads as unknown.
   */
  constructor(
    mount: HTMLElement,
    engine: Engine,
    state: GameState,
    tools: ToolManager,
    feeds: HudFeeds = {},
  ) {
    this.engine = engine;
    this.state = state;
    this.tools = tools;
    this.feeds = feeds;

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
    const buildings = this.buildStat('Buildings');
    this.moneyEl = money.value;
    this.populationEl = population.value;
    this.buildingsEl = buildings.value;

    // The last settled month's net, next to the treasury (simulation.md §6).
    // Amber here is the actual anti-frustration feature: it fires while the
    // player can still act, rather than after the balance has gone red.
    this.moneyDeltaEl = el('div', 'hud-stat__sub hud-stat__sub--money');
    money.wrap.append(this.moneyDeltaEl);

    // Jobs filled / jobs total, the single most useful number for diagnosing
    // why the demand bars look the way they do.
    this.jobsEl = el('div', 'hud-stat__sub');
    population.wrap.append(this.jobsEl);

    stats.append(money.wrap, population.wrap, buildings.wrap);

    // RCI demand: three bars reading the same scalars the growth tick spends.
    // Kept as a readout, never a control (demand-growth.md: the bars are a
    // readout of a simulated market, not a dial the player turns).
    const demand = el('div', 'hud-demand');
    for (const def of DEMAND_BARS) {
      const track = el('div', 'hud-demand__track');
      track.dataset.zone = def.zone;
      track.title = def.title;
      // A centre line, so a bar growing downward reads as negative demand at a
      // glance rather than as an empty bar.
      track.append(el('div', 'hud-demand__axis'));
      const fill = el('div', 'hud-demand__fill');
      fill.style.background = `#${def.color.toString(16).padStart(6, '0')}`;
      track.append(fill);
      this.demandBars.set(def.zone, fill);
      demand.append(track);
    }

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
    status.append(stats, demand, speed);

    // --- Bottom centre ---
    const toolbar = el('div', 'hud-panel hud-toolbar');
    for (const def of TOOL_BUTTONS) {
      const btn = document.createElement('button');
      btn.className = 'hud-tool';
      btn.textContent = def.label;
      btn.dataset.tool = def.id;
      btn.addEventListener('click', () => this.selectTool(def.id));
      this.toolButtons.set(def.id, btn);
      toolbar.append(btn);
    }

    // --- Bottom centre, above the toolbar: tool options, then the hint ---
    this.modesEl = el('div', 'hud-modes');
    this.modesEl.hidden = true;

    this.hintEl = el('div', 'hud-panel hud-hint');
    this.hintEl.hidden = true;

    // --- Bottom right ---
    this.debugEl = el('div', 'hud-panel hud-debug');

    this.root.append(city, status, toolbar, this.modesEl, this.hintEl, this.debugEl);
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
    this.buildingsEl.textContent = formatPopulation(this.state.buildings.items.length);
    this.updateBudget();
    this.updateJobs();

    // Demand is [-1,1] and is drawn from the centre (simulation.md §6): the
    // upper half is what grows anything, the lower half is the city telling the
    // player it already has more of that kind than it can fill.
    for (const [zone, fill] of this.demandBars) {
      const value = clampSigned(this.state.demand[zone]);
      const magnitude = Math.abs(value) * 50;
      fill.style.height = `${magnitude.toFixed(1)}%`;
      fill.style.top = value >= 0 ? `${(50 - magnitude).toFixed(1)}%` : '50%';
      fill.classList.toggle('is-negative', value < 0);
    }

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

  /** Tool whose options row is on screen, or `null` when none is shown. */
  get visibleToolModes(): string | null {
    return this.shownModesFor;
  }

  /**
   * Attach a row of sub-mode buttons to a tool. The row is shown whenever that
   * tool is the active one and hidden otherwise, giving the zone tool its four
   * brushes without the HUD knowing anything about zoning.
   *
   * @param toolId Tool the row belongs to, e.g. `'zones'`.
   * @param modes Buttons, in display order.
   * @param activeId Mode highlighted initially.
   */
  registerToolModes(toolId: string, modes: readonly ToolModeButton[], activeId?: string): void {
    this.toolModes.get(toolId)?.row.remove();

    const row = el('div', 'hud-panel hud-mode-row');
    row.dataset.tool = toolId;
    const buttons = new Map<string, HTMLButtonElement>();
    for (const mode of modes) {
      const btn = document.createElement('button');
      btn.className = 'hud-mode';
      btn.dataset.tool = toolId;
      btn.dataset.mode = mode.id;
      if (mode.color !== undefined) {
        const swatch = el('span', 'hud-mode__swatch');
        swatch.style.background = `#${mode.color.toString(16).padStart(6, '0')}`;
        btn.append(swatch);
      }
      const text = el('span', 'hud-mode__label');
      text.textContent = mode.label;
      btn.append(text);
      btn.addEventListener('click', () => {
        mode.onSelect();
        this.setToolMode(toolId, mode.id);
      });
      buttons.set(mode.id, btn);
      row.append(btn);
    }

    this.modesEl.append(row);
    this.toolModes.set(toolId, { buttons, row });
    if (activeId) this.setToolMode(toolId, activeId);
    this.syncToolModes(this.activeToolId());
  }

  /** Highlight one sub-mode of a tool, without invoking its callback. */
  setToolMode(toolId: string, modeId: string): void {
    const entry = this.toolModes.get(toolId);
    if (!entry) return;
    for (const [id, btn] of entry.buttons) btn.classList.toggle('is-active', id === modeId);
  }

  /** Remove the HUD and its listeners. */
  dispose(): void {
    window.removeEventListener('keydown', this.keyListener);
    this.root.remove();
  }

  /**
   * Colour the treasury and show the last settled month's net.
   *
   * Red at `money < 0`, amber when the last settled month was a net loss
   * (simulation.md §5 rule 5). Before the first settlement there is nothing
   * honest to report, so the delta line stays empty rather than claiming zero.
   */
  private updateBudget(): void {
    const economy = this.state.economy;
    const broke = this.state.money < 0;
    const settled = economy.monthsSettled > 0;
    const losing = settled && economy.lastNet < 0;

    this.moneyEl.classList.toggle('is-broke', broke);
    this.moneyEl.classList.toggle('is-warning', !broke && losing);

    this.moneyDeltaEl.textContent = settled ? formatMonthlyNet(economy.lastNet) : '';
    this.moneyDeltaEl.classList.toggle('is-negative', losing);
    this.moneyDeltaEl.title = settled
      ? `Last month: tax ¤${Math.round(economy.lastMonth.tax)} · ` +
        `road upkeep ¤${Math.round(economy.lastMonth.roadUpkeep)} · ` +
        `construction ¤${Math.round(economy.lastMonth.construction)}`
      : '';
  }

  /** Jobs filled over jobs total, or an em dash before the first recount. */
  private updateJobs(): void {
    const totals = this.feeds.totals?.() ?? null;
    if (!totals) {
      this.jobsEl.textContent = '';
      this.jobsEl.title = '';
      return;
    }
    const jobs = totals.jobsCommercial + totals.jobsIndustrial;
    const filled = Math.round(totals.jobsFilled);
    this.jobsEl.textContent =
      jobs > 0
        ? `${formatPopulation(filled)} / ${formatPopulation(jobs)} jobs`
        : 'no jobs yet';
    this.jobsEl.title =
      `Unemployment ${(totals.unemployment * 100).toFixed(0)}% · ` +
      `residential vacancy ${(totals.vacancyResidential * 100).toFixed(0)}%`;
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
    this.syncToolModes(id);
  }

  /** Id of the toolbar button currently lit, or `null`. */
  private activeToolId(): string | null {
    for (const [toolId, btn] of this.toolButtons) {
      if (btn.classList.contains('is-active')) return toolId;
    }
    return null;
  }

  /** Show only the active tool's options row. */
  private syncToolModes(activeId: string | null): void {
    let shown = false;
    for (const [toolId, entry] of this.toolModes) {
      const visible = toolId === activeId;
      entry.row.hidden = !visible;
      shown = shown || visible;
    }
    this.modesEl.hidden = !shown;
    this.shownModesFor = shown ? activeId : null;
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

function clampSigned(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
