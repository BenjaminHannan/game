/**
 * Money: the ledger funnel, the monthly settlement, and the broke state.
 *
 * Implements `docs/research/simulation.md` §4 and §5, which are in turn the v1
 * row of `docs/research/cs2/OVERVIEW.md` §4 ("one ledger funnel, monthly
 * settlement, two budget lines, soft brake instead of game over").
 *
 * Three things are load-bearing here:
 *
 * - **One funnel.** Nothing outside {@link CityLedger} writes `state.money`.
 *   Every build tool, every tax credit and every upkeep debit goes through
 *   `spend` / `earn` / `pay`, which is what makes the per-category monthly
 *   accumulators trustworthy and the broke rules a single decision point.
 * - **Failure-soft.** `spend` returns `false` instead of overdrawing, so a
 *   tool refuses a plan it cannot pay for; `pay` overdraws deliberately, so
 *   upkeep can never be dodged by building more than the city can afford.
 *   Being broke stalls growth, it does not end the game (§5, no game over).
 * - **Monthly, not per-tick.** {@link EconomySystem} declares
 *   {@link Cadence.Monthly}, so the settlement is a pure function of the tick
 *   index and a save that restores `tick` resumes on exactly the same schedule.
 *
 * `docs/research/cs2/economy.md`'s v1 list is deliberately only partly adopted:
 * its monthly tick, its building-driven taxation and its "pick our own numbers"
 * tuning stance are here; its circular flow between household and company pools,
 * loans, imports and per-service budgets are not, because `simulation.md` §4 is
 * explicit that the v1 budget has exactly two lines and that everything else is
 * phase 8. The data model leaves room: {@link LedgerCategory} is a union and the
 * accumulators are a record keyed by it, so a new line is one member.
 */

import { TICKS_PER_MONTH } from '../core/time.js';
import type { BuildingData, BuildingStore } from './buildings.js';
import {
  BULLDOZE_REFUND_FRACTION,
  type RoadEdgeData,
  type RoadNetwork,
} from './roads.js';
import { Cadence, type System, type TickContext } from './cadence.js';
import type { GameState } from './state.js';
import type { ZoneType } from './zoning.js';

/** Every line the treasury can move on. */
export type LedgerCategory = 'construction' | 'roadUpkeep' | 'tax' | 'refund';

/** Every category, in budget-panel display order. Iterating never allocates. */
export const LEDGER_CATEGORIES: readonly LedgerCategory[] = [
  'tax',
  'refund',
  'construction',
  'roadUpkeep',
];

/** Categories that credit the treasury. The rest debit it. */
const CREDIT_CATEGORIES: ReadonlySet<LedgerCategory> = new Set<LedgerCategory>([
  'tax',
  'refund',
]);

/** Per-category amounts, always positive magnitudes. */
export type LedgerTotals = Record<LedgerCategory, number>;

/** Tax rate per zone kind, each in `[0, MAX_TAX_RATE]`. */
export type TaxRates = Record<ZoneType, number>;

/** Everything about money that has to survive a save. */
export interface EconomyState {
  /** Player-set tax rates. Sliders are phase 8; the data model is here now. */
  taxRates: TaxRates;
  /**
   * Amounts accrued since the last settlement.
   *
   * Persisted rather than recomputed: simulation.md §8 asks for a save at tick
   * 12 345 to resume mid-month with the partial month's accumulators intact,
   * and persisting is cheaper than explaining the discrepancy.
   */
  month: LedgerTotals;
  /** The last fully settled month, for the HUD and the future budget panel. */
  lastMonth: LedgerTotals;
  /** Net of {@link lastMonth}: credits minus debits. */
  lastNet: number;
  /** How many months have been settled. 0 before the first settlement. */
  monthsSettled: number;
}

/**
 * Every economic tunable in one object (simulation.md §4's "one-file edit"
 * requirement for the eventual balance pass).
 *
 * The bases are monthly *taxable income* per unit, not tax; the rate is applied
 * on top. They are chosen against the target in §4 — "a healthy mid-game city
 * runs a small surplus at 10% at ~5 000 population". Worked through: 5 000
 * residents imply ~2 750 workers, so roughly 1 100 commercial and 1 650
 * industrial jobs filled, and a city that size carries on the order of 20 km of
 * two-lane road, i.e. ~3 200/month of upkeep. At 10%:
 * `5000×0.4 + 1100×1.0 + 1650×0.6 ≈ 4 100`. A small surplus, as specified.
 *
 * These are our numbers, not the reference game's: `cs2/economy.md` is explicit
 * that its absolute figures do not transfer across a different tick rate and
 * cost scale, only its ratios and signs.
 */
export const ECONOMY_TUNING = {
  /** Monthly taxable income per resident living in a residential building. */
  taxableIncomePerResident: 4,
  /** Monthly taxable profit per filled commercial job slot. */
  taxableProfitPerCommercialJob: 10,
  /** Monthly taxable profit per filled industrial job slot. */
  taxableProfitPerIndustrialJob: 6,
  /** Tax rate every zone starts at. */
  defaultTaxRate: 0.1,
  /**
   * Growth-probability multiplier while the treasury is negative (§5 rule 3).
   * The city visibly stalls; nothing is destroyed and no plan is queued.
   */
  brokeGrowthPenalty: 0.35,
  /**
   * Demand-bar multiplier while the treasury is negative. Positive demand only:
   * being broke must not manufacture *negative* demand out of nothing.
   */
  brokeDemandDamping: 0.5,
} as const;

/** Highest tax rate the player will ever be able to set (simulation.md §4). */
export const MAX_TAX_RATE = 0.3;

/** Residents per occupied household, mirrored from the demand model's tuning. */
const HOUSEHOLD_SIZE = 2.4;

/** Fresh, unsettled economy state. */
export function createEconomyState(): EconomyState {
  return {
    taxRates: {
      residential: ECONOMY_TUNING.defaultTaxRate,
      commercial: ECONOMY_TUNING.defaultTaxRate,
      industrial: ECONOMY_TUNING.defaultTaxRate,
    },
    month: createLedgerTotals(),
    lastMonth: createLedgerTotals(),
    lastNet: 0,
    monthsSettled: 0,
  };
}

/** A zeroed per-category accumulator. */
export function createLedgerTotals(): LedgerTotals {
  return { construction: 0, roadUpkeep: 0, tax: 0, refund: 0 };
}

/** Deep copy of economy state, so a snapshot cannot be mutated by a later tick. */
export function cloneEconomyState(data: EconomyState): EconomyState {
  return {
    taxRates: { ...data.taxRates },
    month: { ...data.month },
    lastMonth: { ...data.lastMonth },
    lastNet: data.lastNet,
    monthsSettled: data.monthsSettled,
  };
}

/**
 * Coerce untrusted input (an older, hand-edited or corrupt save) into valid
 * economy state. Never throws.
 *
 * A save written before this milestone simply has no `economy` branch and
 * normalizes to a fresh one at the default tax rate, which is exactly right:
 * the city keeps its treasury and starts settling from the next month boundary.
 */
export function normalizeEconomyState(input: unknown): EconomyState {
  const out = createEconomyState();
  const raw = input as Partial<EconomyState> | null | undefined;
  if (!raw || typeof raw !== 'object') return out;

  const rates = raw.taxRates as Partial<TaxRates> | undefined;
  if (rates && typeof rates === 'object') {
    out.taxRates.residential = clampRate(rates.residential);
    out.taxRates.commercial = clampRate(rates.commercial);
    out.taxRates.industrial = clampRate(rates.industrial);
  }
  readTotals(raw.month, out.month);
  readTotals(raw.lastMonth, out.lastMonth);
  out.lastNet = isFiniteNumber(raw.lastNet) ? raw.lastNet : netOf(out.lastMonth);
  out.monthsSettled = isFiniteNumber(raw.monthsSettled)
    ? Math.max(0, Math.floor(raw.monthsSettled))
    : 0;
  return out;
}

/** Credits minus debits over one set of per-category totals. */
export function netOf(totals: Readonly<LedgerTotals>): number {
  let net = 0;
  for (const category of LEDGER_CATEGORIES) {
    net += CREDIT_CATEGORIES.has(category) ? totals[category] : -totals[category];
  }
  return net;
}

/** The one funnel every treasury movement goes through (simulation.md §4). */
export interface Ledger {
  /** Current balance. Read-only by design: writing it is what this type prevents. */
  readonly money: number;
  /** Attempt to spend. Returns false and changes nothing if unaffordable. */
  spend(amount: number, category: LedgerCategory): boolean;
  /** Unconditional credit. */
  earn(amount: number, category: LedgerCategory): void;
  /** Unconditional debit; may drive the balance negative. */
  pay(amount: number, category: LedgerCategory): void;
  /** Amounts accrued since the last settlement. */
  readonly month: Readonly<LedgerTotals>;
  /** The last settled month, for the HUD/budget panel. */
  readonly lastMonth: Readonly<LedgerTotals>;
}

/** The object a ledger owns: normally `GameState`. */
export interface LedgerHost {
  money: number;
  economy: EconomyState;
}

/**
 * The concrete ledger over a {@link LedgerHost}.
 *
 * The host is read on every access rather than cached, so replacing
 * `state.economy` wholesale (as loading a save does) is picked up immediately —
 * the same contract `RoadNetwork` has with `state.roads`.
 */
export class CityLedger implements Ledger {
  private readonly host: LedgerHost;

  constructor(host: LedgerHost) {
    this.host = host;
  }

  get money(): number {
    return this.host.money;
  }

  get month(): Readonly<LedgerTotals> {
    return this.host.economy.month;
  }

  get lastMonth(): Readonly<LedgerTotals> {
    return this.host.economy.lastMonth;
  }

  /** Tax rates in force. Mutate through {@link setTaxRate}. */
  get taxRates(): Readonly<TaxRates> {
    return this.host.economy.taxRates;
  }

  /**
   * Spend, if the balance covers it.
   *
   * @returns `false` — leaving the balance untouched — when the amount is not a
   *   finite positive number, or when paying it would overdraw. That boolean is
   *   the whole broke state: the caller turns it into a rejected plan and a HUD
   *   hint instead of a queued debt (§5 rule 1).
   */
  spend(amount: number, category: LedgerCategory): boolean {
    if (!isSpendable(amount)) return false;
    if (amount > this.host.money) return false;
    this.host.money -= amount;
    this.host.economy.month[category] += amount;
    return true;
  }

  /** Credit the treasury. Non-finite and negative amounts are ignored. */
  earn(amount: number, category: LedgerCategory): void {
    if (!isSpendable(amount)) return;
    this.host.money += amount;
    this.host.economy.month[category] += amount;
  }

  /**
   * Debit the treasury even if that drives it negative (§5 rule 2).
   *
   * Upkeep uses this rather than {@link spend}: clamping upkeep at zero would
   * let a player lay an enormous network and simply never pay for it.
   */
  pay(amount: number, category: LedgerCategory): void {
    if (!isSpendable(amount)) return;
    this.host.money -= amount;
    this.host.economy.month[category] += amount;
  }

  /** True while the treasury is overdrawn — the soft brake's trigger. */
  get broke(): boolean {
    return this.host.money < 0;
  }

  /** Set one zone's tax rate, clamped to `[0, MAX_TAX_RATE]`. */
  setTaxRate(zone: ZoneType, rate: number): void {
    this.host.economy.taxRates[zone] = clampRate(rate);
  }

  /**
   * Close the current month: snapshot the accumulators, zero them, and record
   * the net.
   *
   * @returns The month just closed. The returned object is a fresh copy, safe to
   *   hand to an event payload that may outlive the tick.
   */
  settle(): LedgerTotals {
    const economy = this.host.economy;
    for (const category of LEDGER_CATEGORIES) {
      economy.lastMonth[category] = economy.month[category];
      economy.month[category] = 0;
    }
    economy.lastNet = netOf(economy.lastMonth);
    economy.monthsSettled++;
    return { ...economy.lastMonth };
  }
}

/**
 * Monthly tax a single building owes at the given rates.
 *
 * Residential is taxed on the residents it houses, commercial and industrial on
 * the job slots they actually fill — so an empty building generates nothing,
 * which is the feedback the player needs (simulation.md §4).
 *
 * The level term uses the same `1 + 0.25 × (level - 1)` curve that
 * `lotCapacity` applies, rather than a bare `× level`: capacity and taxable
 * income should scale together, or a level-5 building would pay five times the
 * tax on twice the occupants. Identical at v1, where every building is level 1.
 */
export function buildingTax(building: BuildingData, rates: Readonly<TaxRates>): number {
  const occupied = building.capacity * building.occupancy;
  if (!(occupied > 0)) return 0;
  const levelFactor = 1 + 0.25 * (building.level - 1);
  const tune = ECONOMY_TUNING;
  const base =
    building.zone === 'residential'
      ? occupied * HOUSEHOLD_SIZE * tune.taxableIncomePerResident
      : building.zone === 'commercial'
        ? occupied * tune.taxableProfitPerCommercialJob
        : occupied * tune.taxableProfitPerIndustrialJob;
  return base * levelFactor * clampRate(rates[building.zone]);
}

/** Refund owed for demolishing one road segment. */
export function roadRefund(edge: RoadEdgeData): number {
  const cost = isFiniteNumber(edge.cost) ? Math.max(0, edge.cost) : 0;
  return Math.round(cost * BULLDOZE_REFUND_FRACTION);
}

/** Payload of the `'economy:settled'` event. */
export interface EconomySettledEvent {
  /** Tick the settlement ran on. */
  tick: number;
  /** Amounts for the month just closed. */
  totals: LedgerTotals;
  /** Credits minus debits. */
  net: number;
  /** Treasury balance after settling. */
  money: number;
}

/** Anything the economy system can announce through. `EventBus` satisfies it. */
export interface EconomyEventSink {
  emit(event: 'economy:settled', payload: EconomySettledEvent): void;
}

/** Construction options for {@link EconomySystem}. */
export interface EconomySystemOptions {
  /** Ledger every movement goes through. */
  ledger: CityLedger;
  /** Buildings taxed each month. */
  buildings: BuildingStore;
  /** Road graph charged maintenance each month. Omit for a free network. */
  roads?: RoadNetwork | null;
  /** Event sink. Omit to stay silent. */
  events?: EconomyEventSink | null;
  /**
   * Ticks between settlements. One in-game month by default. Overriding it is
   * for tests only — the cadence dispatcher already gates this system, so a
   * shorter interval here does nothing unless the system is stepped directly.
   */
  interval?: number;
}

/**
 * The monthly settlement: tax in, road upkeep out.
 *
 * Exactly two budget lines, per simulation.md §4. Service upkeep, loans and tile
 * upkeep are phase 8 and are deliberately *not* stubbed with zeros — the
 * category record simply has no member for them yet, so adding one later is an
 * additive save migration rather than a change of meaning.
 */
export class EconomySystem implements System {
  readonly id = 'economy';

  /** Settled once per in-game month by the cadence dispatcher. */
  readonly cadence = Cadence.Monthly;

  private readonly ledger: CityLedger;
  private readonly store: BuildingStore;
  private readonly roads: RoadNetwork | null;
  private readonly events: EconomyEventSink | null;
  private readonly interval: number;

  /** Last settlement's gross figures, for the HUD and for tests. */
  private lastTax = 0;
  private lastUpkeep = 0;

  constructor(options: EconomySystemOptions) {
    this.ledger = options.ledger;
    this.store = options.buildings;
    this.roads = options.roads ?? null;
    this.events = options.events ?? null;
    this.interval = Math.max(1, Math.floor(options.interval ?? TICKS_PER_MONTH));
  }

  /** Tax collected at the last settlement. */
  get taxCollected(): number {
    return this.lastTax;
  }

  /** Road maintenance paid at the last settlement. */
  get upkeepPaid(): number {
    return this.lastUpkeep;
  }

  /**
   * Tax the city would owe right now, without charging it.
   *
   * One linear pass over the building list, allocating nothing. Used by the
   * settlement, by the HUD's projection and by tests that verify the settled
   * amount against an independently computed one.
   */
  projectedTax(): number {
    const rates = this.ledger.taxRates;
    const items = this.store.items;
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      total += buildingTax(items[i] as BuildingData, rates);
    }
    return total;
  }

  /** Road maintenance the city would owe right now, without charging it. */
  projectedUpkeep(): number {
    return this.roads ? this.roads.upkeepPerMonth : 0;
  }

  step(state: GameState, tick: number, _ctx?: TickContext): void {
    // The interval check is redundant under the cadence dispatcher and load
    // bearing when a test steps the system directly. Both are pure functions of
    // the tick index, so neither can drift.
    if (tick % this.interval !== 0) return;
    this.settle(state, tick);
  }

  /**
   * Run one settlement immediately, ignoring the interval.
   *
   * @returns The month that was closed.
   */
  settle(state: GameState, tick: number): EconomySettledEvent {
    this.lastTax = round2(this.projectedTax());
    this.lastUpkeep = round2(this.projectedUpkeep());

    // Tax is a credit and can never fail. Upkeep is paid unconditionally and is
    // allowed to overdraw — §5 rule 2.
    this.ledger.earn(this.lastTax, 'tax');
    this.ledger.pay(this.lastUpkeep, 'roadUpkeep');

    const totals = this.ledger.settle();
    const payload: EconomySettledEvent = {
      tick,
      totals,
      net: state.economy.lastNet,
      money: state.money,
    };
    this.events?.emit('economy:settled', payload);
    return payload;
  }
}

function clampRate(value: unknown): number {
  if (!isFiniteNumber(value)) return ECONOMY_TUNING.defaultTaxRate;
  return value < 0 ? 0 : value > MAX_TAX_RATE ? MAX_TAX_RATE : value;
}

function readTotals(input: unknown, out: LedgerTotals): void {
  const raw = input as Partial<LedgerTotals> | null | undefined;
  if (!raw || typeof raw !== 'object') return;
  for (const category of LEDGER_CATEGORIES) {
    const value = raw[category];
    out[category] = isFiniteNumber(value) ? Math.max(0, value) : 0;
  }
}

/** Amounts must be finite and non-negative; direction is the method's job. */
function isSpendable(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Round to cents, so a month of float accumulation cannot drift visibly. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
