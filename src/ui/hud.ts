/**
 * HUD: a corner-anchored DOM overlay above the 3D view.
 *
 * The structure mirrors `docs/research/cs2/ux-conventions.md` §1 and its v1
 * adoption list; every pixel of the expression — palette, glyphs, chrome, copy —
 * is original to this project, which is the binding constraint from
 * `docs/research/cs2/OVERVIEW.md`.
 *
 * ```
 *  ┌ city name / date / speed ─────────── treasury · population · RCI ┐
 *  │ info-view openers                                        toasts   │
 *  │                                                                   │
 *  │                       (the world, unobstructed)                   │
 *  │                                                                   │
 *  │ info-view panel              tool options row            fps/tick │
 *  └───────────────────────── build toolbar ──────────────────────────┘
 * ```
 *
 * Four rules from the doc are load-bearing rather than decorative:
 *
 * - **Category → subtool → tool options, three stable levels.** The toolbar row
 *   says *what kind of thing*, the options row says *which one*, and the options
 *   row never resets when the category changes back and forth.
 * - **Locked entries stay visible.** Power, water and services are disabled
 *   buttons with tooltips, not absences, so the toolbar reads as a promise.
 * - **Icons index, tooltips explain.** No control is a bare label: everything
 *   with a cost decomposes into a structured card on hover *or focus*.
 * - **Info views are a mode over the world.** The opener sits top-left with the
 *   clock, and the panel is a floating card, never a screen.
 *
 * The HUD stays pull-based: it reads engine and simulation state once per frame
 * rather than subscribing to change events, so nothing in the simulation knows
 * it exists. It also never computes an aggregate itself (guardrail 10) — the
 * derived figures arrive through {@link HudFeeds}.
 */

import './styles.css';
import type { Engine, GameSpeed } from '../core/engine.js';
import type { GameState } from '../sim/state.js';
import type { ToolManager } from '../input/tools.js';
import { formatDate, formatTimeOfDay } from '../core/time.js';
import { ZONE_COLORS } from '../sim/zoning.js';
import type { CityTotals } from '../sim/demand.js';
import { icon, type IconId } from './icons.js';
import { TooltipLayer, type TooltipContent, type TooltipSource } from './tooltip.js';
import { NotificationCenter, type ToastOptions } from './notifications.js';
import type { InfoViewManager } from './infoViews.js';

/** One entry of the top-level toolbar row. */
interface ToolbarEntry {
  /** Tool id. Entries with no registered tool fall back to select. */
  id: string;
  label: string;
  glyph: IconId;
  /** Keyboard shortcut, as a `KeyboardEvent.code`. */
  code?: string;
  /** How the shortcut is written in the tooltip. */
  keyHint?: string;
  /** Locked categories render disabled rather than being hidden. */
  locked?: boolean;
  /** Why a locked category is locked, and what will unlock it. */
  lockedNote?: string;
  /** Styles the button as destructive; the bulldozer sits apart. */
  destructive?: boolean;
  /** One sentence for the tooltip. */
  description: string;
}

/**
 * The v1 category row.
 *
 * Four live categories matching the systems that exist, then three reserved
 * slots. The reserved three are exactly the subsystems `OVERVIEW.md` §4 puts in
 * v1.5, so the toolbar is already telling the truth about what comes next.
 */
const TOOL_BUTTONS: readonly ToolbarEntry[] = [
  {
    id: 'select',
    label: 'Select',
    glyph: 'select',
    code: 'KeyV',
    keyHint: 'V',
    description: 'Inspect roads, lots and buildings without changing anything.',
  },
  {
    id: 'roads',
    label: 'Roads',
    glyph: 'roads',
    code: 'KeyR',
    keyHint: 'R',
    description: 'Draw straight segments. Click to start, click again to chain.',
  },
  {
    id: 'zones',
    label: 'Zones',
    glyph: 'zones',
    code: 'KeyZ',
    keyHint: 'Z',
    description: 'Drag paint over the cells a road makes zonable.',
  },
  {
    id: 'bulldoze',
    label: 'Bulldoze',
    glyph: 'bulldoze',
    code: 'KeyB',
    keyHint: 'B',
    destructive: true,
    description: 'Remove roads, zoning or buildings. Refunds are deliberately stingy.',
  },
  {
    id: 'power',
    label: 'Power',
    glyph: 'power',
    locked: true,
    lockedNote: 'Electricity arrives with the utilities milestone.',
    description: 'Generation and the capacitated flow that carries it down roads.',
  },
  {
    id: 'water',
    label: 'Water',
    glyph: 'water',
    locked: true,
    lockedNote: 'Water and sewage arrive with the utilities milestone.',
    description: 'Pumping, treatment and the capacity the network can move.',
  },
  {
    id: 'services',
    label: 'Services',
    glyph: 'services',
    locked: true,
    lockedNote: 'Service coverage arrives with the social-services milestone.',
    description: 'Coverage that floods down streets and is spent by the people it passes.',
  },
];

/**
 * One entry in a tool's options row — the sub-mode strip that appears above the
 * toolbar while its owning tool is active (§3's "tool options panel": the asset
 * row says *what*, the options row says *how*, and the two are independent).
 */
export interface ToolModeButton {
  /** Stable id, unique within the owning tool. */
  id: string;
  /** Player-facing label. */
  label: string;
  /** Optional swatch colour as a 24-bit hex number. */
  color?: number;
  /** Optional glyph, drawn in place of the swatch. */
  glyph?: IconId;
  /** Structured tooltip payload, built at hover time. */
  tooltip?: TooltipSource;
  /** Invoked when the player picks this mode. */
  onSelect(): void;
}

/** The three demand bars, in RCI order. Colours match the zone overlay. */
const DEMAND_BARS: ReadonlyArray<{
  zone: 'r' | 'c' | 'i';
  letter: string;
  title: string;
  color: number;
}> = [
  { zone: 'r', letter: 'R', title: 'Residential demand', color: ZONE_COLORS.residential },
  { zone: 'c', letter: 'C', title: 'Commercial demand', color: ZONE_COLORS.commercial },
  { zone: 'i', letter: 'I', title: 'Industrial demand', color: ZONE_COLORS.industrial },
];

const SPEED_BUTTONS: ReadonlyArray<{
  speed: GameSpeed;
  label: string;
  glyph?: IconId;
  title: string;
}> = [
  { speed: 0, label: '', glyph: 'pause', title: 'Pause (Space)' },
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
  /** Projected monthly tax and upkeep, for the treasury tooltip. */
  budget?: (() => { tax: number; upkeep: number; roadLength: number } | null) | null;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly engine: Engine;
  private readonly state: GameState;
  private readonly tools: ToolManager;

  private readonly feeds: HudFeeds;

  /** The single tooltip card every control shares. */
  readonly tooltips: TooltipLayer;

  /** The toast area. */
  readonly notifications: NotificationCenter;

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

  // --- Info views ---
  private views: InfoViewManager | null = null;
  private readonly viewsRow: HTMLElement;
  private readonly viewButtons = new Map<string, HTMLButtonElement>();
  private readonly viewPanel: HTMLElement;
  private readonly viewPanelTitle: HTMLElement;
  private readonly viewPanelValue: HTMLElement;
  private readonly viewPanelLabel: HTMLElement;
  private readonly viewPanelNote: HTMLElement;
  private readonly viewPanelLegend: HTMLElement;
  private unsubscribeViews: (() => void) | null = null;

  private readonly keyListener: (e: KeyboardEvent) => void;

  /** Speed restored when unpausing with Space. */
  private lastRunningSpeed: GameSpeed = 1;

  /** Whether the whole overlay is visible (backtick toggles it, §1). */
  private chromeVisible = true;

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
    this.tooltips = new TooltipLayer(this.root);
    this.notifications = new NotificationCenter(this.root);

    // --- Top left: identity, clock, speed ---
    const city = el('div', 'hud-panel hud-city');
    const cityText = el('div', 'hud-city__text');
    this.nameEl = el('div', 'hud-city__name');
    this.dateEl = el('div', 'hud-city__date');
    cityText.append(this.nameEl, this.dateEl);

    const speed = el('div', 'hud-speed');
    speed.setAttribute('role', 'group');
    speed.setAttribute('aria-label', 'Simulation speed');
    for (const def of SPEED_BUTTONS) {
      const btn = document.createElement('button');
      btn.className = 'hud-speed__btn';
      btn.type = 'button';
      btn.dataset.speed = String(def.speed);
      if (def.glyph) btn.innerHTML = icon(def.glyph, 13);
      else btn.textContent = def.label;
      btn.setAttribute('aria-label', def.title);
      btn.addEventListener('click', () => this.setSpeed(def.speed));
      this.tooltips.bind(btn, () => ({
        title: def.speed === 0 ? 'Pause' : `Speed ${def.label}`,
        subtitle: def.title.replace(/^.*\(/, '').replace(/\)$/, ''),
        note:
          def.speed === 0
            ? 'The world holds still. Tools still work while paused.'
            : 'Simulation rate only — the tick is fixed, so the city plays the same on any machine.',
      }));
      this.speedButtons.set(def.speed, btn);
      speed.append(btn);
    }
    city.append(cityText, speed);

    // --- Top left, below the clock: the info-view openers ---
    this.viewsRow = el('div', 'hud-panel hud-views');
    this.viewsRow.setAttribute('role', 'group');
    this.viewsRow.setAttribute('aria-label', 'Info views');
    this.viewsRow.hidden = true;

    // --- Top right: the vital signs ---
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

    this.tooltips.bind(money.wrap, () => this.treasuryTooltip());
    this.tooltips.bind(population.wrap, () => this.populationTooltip());
    this.tooltips.bind(buildings.wrap, () => this.buildingsTooltip());

    stats.append(money.wrap, population.wrap, buildings.wrap);

    // RCI demand: three bars reading the same scalars the growth tick spends.
    // Kept as a readout, never a control (demand-growth.md: the bars are a
    // readout of a simulated market, not a dial the player turns).
    const demand = el('div', 'hud-demand');
    demand.setAttribute('aria-label', 'Residential, commercial and industrial demand');
    for (const def of DEMAND_BARS) {
      const column = el('div', 'hud-demand__column');
      column.dataset.zone = def.zone;
      const track = el('div', 'hud-demand__track');
      track.dataset.zone = def.zone;
      // A centre line, so a bar growing downward reads as negative demand at a
      // glance rather than as an empty bar.
      track.append(el('div', 'hud-demand__axis'));
      const fill = el('div', 'hud-demand__fill');
      fill.style.background = `#${def.color.toString(16).padStart(6, '0')}`;
      track.append(fill);
      const letter = el('div', 'hud-demand__letter');
      letter.textContent = def.letter;
      column.append(track, letter);
      this.demandBars.set(def.zone, fill);
      this.tooltips.bind(column, () => this.demandTooltip(def.zone, def.title));
      demand.append(column);
    }
    status.append(stats, demand);

    // --- Bottom centre: the category row ---
    const toolbar = el('div', 'hud-panel hud-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Build tools');
    for (const def of TOOL_BUTTONS) {
      const btn = document.createElement('button');
      btn.className = def.destructive ? 'hud-tool hud-tool--destructive' : 'hud-tool';
      btn.type = 'button';
      btn.dataset.tool = def.id;
      btn.setAttribute('aria-pressed', 'false');
      const glyph = el('span', 'hud-tool__icon');
      glyph.innerHTML = icon(def.glyph, 20);
      const label = el('span', 'hud-tool__label');
      label.textContent = def.label;
      btn.append(glyph, label);
      // Locked entries are `aria-disabled`, not `disabled`. A `disabled` button
      // fires no pointer events and takes no focus, which would make the one
      // thing a locked entry exists to do — explain itself on hover — impossible.
      // This way it stays tabbable, still announces as unavailable, and simply
      // has no click handler to run.
      if (def.locked) {
        btn.classList.add('is-locked');
        btn.dataset.locked = 'true';
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.addEventListener('click', () => this.selectTool(def.id));
      }
      this.tooltips.bind(btn, () => this.toolTooltip(def));
      this.toolButtons.set(def.id, btn);
      toolbar.append(btn);
    }

    // --- Bottom centre, above the toolbar: tool options, then the hint ---
    this.modesEl = el('div', 'hud-modes');
    this.modesEl.hidden = true;

    this.hintEl = el('div', 'hud-panel hud-hint');
    this.hintEl.hidden = true;

    // --- Bottom left: the active info view's panel ---
    this.viewPanel = el('div', 'hud-panel hud-infopanel');
    this.viewPanel.hidden = true;
    this.viewPanelTitle = el('div', 'hud-infopanel__title');
    const readout = el('div', 'hud-infopanel__readout');
    this.viewPanelValue = el('div', 'hud-infopanel__value');
    this.viewPanelLabel = el('div', 'hud-infopanel__label');
    readout.append(this.viewPanelValue, this.viewPanelLabel);
    this.viewPanelNote = el('div', 'hud-infopanel__note');
    this.viewPanelLegend = el('div', 'hud-legend');
    this.viewPanel.append(
      this.viewPanelTitle,
      readout,
      this.viewPanelNote,
      this.viewPanelLegend,
    );

    // --- Bottom right ---
    this.debugEl = el('div', 'hud-panel hud-debug');

    this.root.append(
      city,
      this.viewsRow,
      status,
      toolbar,
      this.modesEl,
      this.hintEl,
      this.viewPanel,
      this.debugEl,
    );
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
    this.updateInfoPanel();

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
      const on = speed === active;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
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

  /** Raise a toast. Thin passthrough so callers need only the HUD. */
  notify(options: ToastOptions): number {
    return this.notifications.push(options);
  }

  /** Tool whose options row is on screen, or `null` when none is shown. */
  get visibleToolModes(): string | null {
    return this.shownModesFor;
  }

  /** Whether the overlay is currently drawn. Toggled with the backtick key. */
  get chromeShown(): boolean {
    return this.chromeVisible;
  }

  /** Show or hide the whole overlay, for an unobstructed look at the city. */
  setChromeVisible(visible: boolean): void {
    if (this.chromeVisible === visible) return;
    this.chromeVisible = visible;
    this.root.classList.toggle('is-hidden', !visible);
    if (!visible) this.tooltips.close();
  }

  /**
   * Attach the info-view registry: builds one opener button per view and keeps
   * the bottom-left panel in sync with whichever is active.
   *
   * Called once, after every view is registered. Registering a view later is
   * fine — call this again and the row rebuilds.
   */
  attachInfoViews(views: InfoViewManager): void {
    this.unsubscribeViews?.();
    this.views = views;
    this.viewButtons.clear();
    this.viewsRow.replaceChildren();

    for (const view of views.all) {
      const btn = document.createElement('button');
      btn.className = 'hud-view';
      btn.type = 'button';
      btn.dataset.view = view.id;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', `${view.label} info view`);
      const glyph = el('span', 'hud-view__icon');
      glyph.innerHTML = icon(view.icon, 16);
      const label = el('span', 'hud-view__label');
      label.textContent = view.label;
      btn.append(glyph, label);
      if (view.available === false) {
        btn.classList.add('is-locked');
        btn.dataset.locked = 'true';
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.addEventListener('click', () => this.toggleInfoView(view.id));
      }
      this.tooltips.bind(btn, () => {
        const metric = view.available === false ? null : (view.metric?.() ?? null);
        const content: TooltipContent = {
          title: view.label,
          subtitle: view.available === false ? 'Not available yet' : 'Info view',
          note: view.available === false ? (view.lockedNote ?? view.description) : view.description,
        };
        if (metric) {
          content.rows = [{ label: metric.label, value: metric.value }];
        }
        return content;
      });
      this.viewButtons.set(view.id, btn);
      this.viewsRow.append(btn);
    }

    this.viewsRow.hidden = views.all.length === 0;
    this.unsubscribeViews = views.onChange(() => this.syncInfoViews());
    this.syncInfoViews();
  }

  /**
   * Turn an info view on, or off if it is already on.
   * @returns The id now active, or `null`.
   */
  toggleInfoView(id: string): string | null {
    if (!this.views) return null;
    return this.views.toggle(id);
  }

  /**
   * Attach a row of sub-mode buttons to a tool. The row is shown whenever that
   * tool is the active one and hidden otherwise, giving the zone tool its four
   * brushes and the bulldozer its filters without the HUD knowing anything about
   * either subsystem.
   *
   * @param toolId Tool the row belongs to, e.g. `'zones'`.
   * @param modes Buttons, in display order.
   * @param activeId Mode highlighted initially.
   */
  registerToolModes(toolId: string, modes: readonly ToolModeButton[], activeId?: string): void {
    this.toolModes.get(toolId)?.row.remove();

    const row = el('div', 'hud-panel hud-mode-row');
    row.dataset.tool = toolId;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${toolId} options`);
    const buttons = new Map<string, HTMLButtonElement>();
    for (const mode of modes) {
      const btn = document.createElement('button');
      btn.className = 'hud-mode';
      btn.type = 'button';
      btn.dataset.tool = toolId;
      btn.dataset.mode = mode.id;
      btn.setAttribute('aria-pressed', 'false');
      if (mode.glyph) {
        const glyph = el('span', 'hud-mode__icon');
        glyph.innerHTML = icon(mode.glyph, 15);
        btn.append(glyph);
      } else if (mode.color !== undefined) {
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
      if (mode.tooltip) this.tooltips.bind(btn, mode.tooltip);
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
    for (const [id, btn] of entry.buttons) {
      const on = id === modeId;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /** Switch the active tool as if its toolbar button had been clicked. */
  selectToolById(id: string): void {
    this.selectTool(id);
  }

  /** Remove the HUD and its listeners. */
  dispose(): void {
    window.removeEventListener('keydown', this.keyListener);
    this.unsubscribeViews?.();
    this.notifications.dispose();
    this.tooltips.dispose();
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
  }

  /** Jobs filled over jobs total, or nothing before the first recount. */
  private updateJobs(): void {
    const totals = this.feeds.totals?.() ?? null;
    if (!totals) {
      this.jobsEl.textContent = '';
      return;
    }
    const jobs = totals.jobsCommercial + totals.jobsIndustrial;
    const filled = Math.round(totals.jobsFilled);
    this.jobsEl.textContent =
      jobs > 0
        ? `${formatPopulation(filled)} / ${formatPopulation(jobs)} jobs`
        : 'no jobs yet';
  }

  /** Reflect the active info view in the opener row and the panel. */
  private syncInfoViews(): void {
    const active = this.views?.active ?? null;
    for (const [id, btn] of this.viewButtons) {
      const on = id === active;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    this.root.dataset.infoView = active ?? '';

    const view = this.views?.activeView ?? null;
    if (!view) {
      this.viewPanel.hidden = true;
      this.viewPanel.removeAttribute('data-view');
      return;
    }
    this.viewPanel.dataset.view = view.id;
    this.viewPanelTitle.textContent = view.label;

    this.viewPanelLegend.replaceChildren();
    for (const stop of view.legend ?? []) {
      const item = el('div', 'hud-legend__stop');
      const swatch = el('span', 'hud-legend__swatch');
      swatch.style.background = stop.color;
      const label = el('span', 'hud-legend__label');
      label.textContent = stop.label;
      item.append(swatch, label);
      this.viewPanelLegend.append(item);
    }
    this.viewPanelLegend.hidden = (view.legend?.length ?? 0) === 0;

    this.viewPanel.hidden = false;
    this.updateInfoPanel();
  }

  /** Refresh only the active panel's headline figure. Cheap; called per frame. */
  private updateInfoPanel(): void {
    const view = this.views?.activeView ?? null;
    if (!view || this.viewPanel.hidden) return;
    const metric = view.metric?.() ?? null;
    this.viewPanelValue.textContent = metric ? metric.value : '—';
    this.viewPanelLabel.textContent = metric ? metric.label : view.description;
    this.viewPanelNote.textContent = metric?.note ?? '';
    this.viewPanelNote.hidden = !metric?.note;
  }

  private toolTooltip(def: ToolbarEntry): TooltipContent {
    const rows: Array<{ label: string; value: string }> = [];
    if (def.keyHint) rows.push({ label: 'Shortcut', value: def.keyHint });
    const content: TooltipContent = {
      title: def.label,
      subtitle: def.locked ? 'Not available yet' : 'Build tool',
      note: def.locked ? (def.lockedNote ?? def.description) : def.description,
    };
    if (rows.length > 0) content.rows = rows;
    return content;
  }

  private treasuryTooltip(): TooltipContent {
    const economy = this.state.economy;
    const budget = this.feeds.budget?.() ?? null;
    const rows: Array<{ label: string; value: string; warn?: boolean }> = [];
    if (budget) {
      rows.push({ label: 'Tax, projected', value: formatMoney(budget.tax) });
      rows.push({
        label: 'Road upkeep, projected',
        value: formatMoney(-budget.upkeep),
        warn: budget.upkeep > budget.tax,
      });
      rows.push({ label: 'Network', value: `${(budget.roadLength / 1000).toFixed(2)} km` });
    }
    if (economy.monthsSettled > 0) {
      rows.push({ label: 'Last month, tax', value: formatMoney(economy.lastMonth.tax) });
      rows.push({
        label: 'Last month, upkeep',
        value: formatMoney(-economy.lastMonth.roadUpkeep),
      });
      rows.push({
        label: 'Last month, building',
        value: formatMoney(-economy.lastMonth.construction),
      });
      rows.push({
        label: 'Last month, net',
        value: formatMonthlyNet(economy.lastNet),
        warn: economy.lastNet < 0,
      });
    }
    return {
      title: formatMoney(this.state.money),
      subtitle: 'Treasury',
      rows,
      note:
        this.state.money < 0
          ? 'Overdrawn: growth is slowed until the balance recovers. There is no game over.'
          : economy.monthsSettled === 0
            ? 'Nothing has settled yet — the first month closes on the month boundary.'
            : undefined,
    };
  }

  private populationTooltip(): TooltipContent {
    const totals = this.feeds.totals?.() ?? null;
    const rows: Array<{ label: string; value: string }> = [];
    if (totals) {
      rows.push({
        label: 'Households',
        value: `${formatPopulation(totals.householdsFilled)} / ${formatPopulation(totals.households)}`,
      });
      rows.push({ label: 'Workforce', value: formatPopulation(totals.workforce) });
      rows.push({
        label: 'Jobs filled',
        value: `${formatPopulation(totals.jobsFilled)} / ${formatPopulation(
          totals.jobsCommercial + totals.jobsIndustrial,
        )}`,
      });
      rows.push({
        label: 'Unemployment',
        value: `${(totals.unemployment * 100).toFixed(0)}%`,
      });
      rows.push({
        label: 'Housing vacancy',
        value: `${(totals.vacancyResidential * 100).toFixed(0)}%`,
      });
    }
    return {
      title: formatPopulation(this.state.population),
      subtitle: 'Population',
      rows,
      note: 'Derived from occupied housing, not counted per person — individuals arrive later.',
    };
  }

  private buildingsTooltip(): TooltipContent {
    const totals = this.feeds.totals?.() ?? null;
    const rows: Array<{ label: string; value: string }> = [];
    if (totals) {
      rows.push({ label: 'Residential', value: formatPopulation(totals.buildingsResidential) });
      rows.push({ label: 'Commercial', value: formatPopulation(totals.buildingsCommercial) });
      rows.push({ label: 'Industrial', value: formatPopulation(totals.buildingsIndustrial) });
    }
    return {
      title: formatPopulation(this.state.buildings.items.length),
      subtitle: 'Standing buildings',
      rows,
      note: 'Buildings grow themselves into zoned lots. You never place one directly.',
    };
  }

  private demandTooltip(zone: 'r' | 'c' | 'i', title: string): TooltipContent {
    const value = clampSigned(this.state.demand[zone]);
    const totals = this.feeds.totals?.() ?? null;
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Current', value: value.toFixed(2) },
    ];
    if (totals) {
      if (zone === 'r') {
        rows.push({
          label: 'Housing vacancy',
          value: `${(totals.vacancyResidential * 100).toFixed(0)}%`,
        });
        rows.push({
          label: 'Unemployment',
          value: `${(totals.unemployment * 100).toFixed(0)}%`,
        });
      } else if (zone === 'c') {
        rows.push({ label: 'Goods wanted', value: formatPopulation(totals.goodsDemand) });
        rows.push({
          label: 'Shop throughput',
          value: formatPopulation(totals.commercialThroughput),
        });
      } else {
        rows.push({ label: 'Goods supplied', value: formatPopulation(totals.goodsSupply) });
        rows.push({ label: 'Goods wanted', value: formatPopulation(totals.goodsDemand) });
      }
    }
    return {
      title,
      subtitle: value >= 0 ? 'Room to grow' : 'Oversupplied',
      rows,
      note: 'A readout of the market, not a dial. Overpaint and vacancy pushes it back down.',
    };
  }

  private buildStat(
    label: string,
    valueModifier = '',
  ): { wrap: HTMLElement; value: HTMLElement } {
    const wrap = el('div', 'hud-stat');
    wrap.tabIndex = 0;
    wrap.dataset.stat = label.toLowerCase();
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
      const on = toolId === id;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
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
    // Modified chords belong to the browser, not to us.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.togglePause();
        return;
      case 'Digit1':
        this.setSpeed(1);
        return;
      case 'Digit2':
        this.setSpeed(2);
        return;
      case 'Digit3':
        this.setSpeed(4);
        return;
      case 'Backquote':
        this.setChromeVisible(!this.chromeVisible);
        return;
      case 'Escape':
        // Esc backs out of the info-view mode; the active tool gets the same
        // key from main.ts and cancels its own pending gesture independently.
        this.views?.clear();
        this.tooltips.close();
        return;
      default:
        break;
    }

    for (const def of TOOL_BUTTONS) {
      if (def.code === e.code && !def.locked) {
        this.selectTool(def.id);
        return;
      }
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
