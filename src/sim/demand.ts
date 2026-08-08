/**
 * RCI demand — the placeholder model the growth tick reads.
 *
 * `docs/research/zoning-growth.md` §4 is explicit that demand is a *placeholder*
 * for this milestone and that the growth system must read it and nothing else,
 * so swapping in the real economy model is a one-file change. That seam is
 * {@link DemandSource}: growth depends on the interface, never on this class.
 *
 * What is here is the skeleton `docs/research/simulation.md` §3 specifies and
 * `docs/research/cs2/demand-growth.md` ("Metropolis v1 adoption") endorses
 * keeping — three scalars in `[-1, 1]`, each a single ratio, exponentially
 * smoothed — plus the one CS2 term that doc says to add now because it is what
 * most defines the feel: **vacancy suppression** on residential demand, applied
 * before the bootstrap floor so an empty city can still start.
 *
 * Deliberately *not* here (the Simulation milestone owns them): money, tax,
 * upkeep, the broke state, households, wealth tiers. This module only reads
 * buildings and writes demand, occupancy and population.
 *
 * Cadence follows guardrail 7: demand is a daily system, not a per-tick one.
 */

import { TICKS_PER_DAY } from '../core/time.js';
import type { BuildingData, BuildingStore } from './buildings.js';
import type { GameState, System } from './state.js';

/** The three demand scalars, each in `[-1, 1]`. */
export interface DemandState {
  /** Residential. */
  r: number;
  /** Commercial. */
  c: number;
  /** Industrial. */
  i: number;
}

/**
 * The seam the growth tick reads. Any model that can answer "would something
 * grow here right now?" satisfies it, so the economy milestone can replace
 * {@link DemandSystem} without touching {@link GrowthSystem}.
 */
export interface DemandSource {
  readonly demand: Readonly<DemandState>;
}

/** Citywide aggregates, recomputed once per day and cached (guardrail 10). */
export interface CityTotals {
  /** Residential capacity, in households. */
  households: number;
  /** Occupied households. */
  householdsFilled: number;
  /** Residents implied by occupied households. */
  residents: number;
  /** Residents who want a job. */
  workforce: number;
  /** Commercial job slots. */
  jobsCommercial: number;
  /** Industrial job slots. */
  jobsIndustrial: number;
  /** Job slots actually filled, across both. */
  jobsFilled: number;
  /** Share of the workforce without a job, in `[0, 1]`. */
  unemployment: number;
  /** Share of housing standing empty, in `[0, 1]`. */
  vacancyResidential: number;
  /** Goods industry produces per day. */
  goodsSupply: number;
  /** Goods residents want per day. */
  goodsDemand: number;
  /** Goods commerce can move per day. */
  commercialThroughput: number;
  /** Standing buildings per zone — the counter signature unlocks will read. */
  buildingsResidential: number;
  buildingsCommercial: number;
  buildingsIndustrial: number;
}

/**
 * Every tunable in one object, so the balance pass the economy milestone will
 * want is a single-file edit.
 */
export const DEMAND_TUNING = {
  /** Residents per occupied household. */
  householdSize: 2.4,
  /** Share of residents who want a job. */
  workingAgeFraction: 0.55,
  /** Goods one filled industrial job produces per day. */
  goodsPerIndustrialJob: 1,
  /** Goods one filled commercial job can move per day. */
  goodsPerCommercialJob: 1.4,
  /** Goods one resident consumes per day. Flat on purpose. */
  goodsPerResident: 0.35,
  /** Most a building's occupancy may move in one day. */
  occupancyRate: 0.15,
  /**
   * Occupancy homes reach with no jobs at all. Without a floor a city with no
   * commerce or industry has no residents, so it has no workforce, so nothing
   * else can ever fill — the bootstrap deadlocks.
   */
  residentialBaseOccupancy: 0.35,
  /** Occupancy workplaces reach with no workforce at all. */
  jobBaseOccupancy: 0.1,
  /** Vacancy below which residential demand is not suppressed at all. */
  vacancyFloor: 0.1,
  /** Weight of the jobs-minus-workers term in residential demand. */
  weightJobsGap: 0.7,
  /** Weight of the low-vacancy term in residential demand. */
  weightHousingPressure: 0.5,
  /** Weight of the idle-labour term in industrial demand. */
  weightUnemployment: 0.6,
  /** Population below which the bootstrap floor applies, fading linearly. */
  seedPopulation: 200,
  /** Demand floor while bootstrapping. */
  seedDemand: { r: 0.8, c: 0.3, i: 0.5 } as const,
  /** Fraction of the gap the smoothing filter closes each day. */
  smoothing: 0.2,
} as const;

/** Neutral demand: what a city with nothing in it reports. */
export function createDemandState(): DemandState {
  return { r: 0, c: 0, i: 0 };
}

/** Empty aggregates. */
export function createCityTotals(): CityTotals {
  return {
    households: 0,
    householdsFilled: 0,
    residents: 0,
    workforce: 0,
    jobsCommercial: 0,
    jobsIndustrial: 0,
    jobsFilled: 0,
    unemployment: 0,
    vacancyResidential: 0,
    goodsSupply: 0,
    goodsDemand: 0,
    commercialThroughput: 0,
    buildingsResidential: 0,
    buildingsCommercial: 0,
    buildingsIndustrial: 0,
  };
}

/** Coerce untrusted input into a valid {@link DemandState}. Never throws. */
export function normalizeDemandState(input: unknown): DemandState {
  const raw = input as Partial<DemandState> | null | undefined;
  if (!raw || typeof raw !== 'object') return createDemandState();
  return {
    r: clampSigned(raw.r),
    c: clampSigned(raw.c),
    i: clampSigned(raw.i),
  };
}

/**
 * Daily recount of city aggregates, building occupancy, population and the
 * three demand bars.
 *
 * One linear pass over the building list per day. The pass allocates nothing:
 * the totals object is owned by the system and overwritten in place, so a
 * 2 000-building city costs one traversal a day with no GC pressure
 * (guardrails 5 and 10).
 */
export class DemandSystem implements System, DemandSource {
  readonly id = 'demand';

  private readonly store: BuildingStore;
  private readonly state: DemandState;
  private readonly cityTotals = createCityTotals();
  private readonly interval: number;

  /**
   * @param store Building list the aggregates are computed from.
   * @param state Demand scalars to advance in place — usually `GameState.demand`
   *   so the bars survive a save round-trip.
   * @param interval Ticks between recounts. One in-game day by default.
   */
  constructor(store: BuildingStore, state: DemandState, interval: number = TICKS_PER_DAY) {
    this.store = store;
    this.state = state;
    this.interval = Math.max(1, Math.floor(interval));
  }

  /** The live demand scalars. */
  get demand(): Readonly<DemandState> {
    return this.state;
  }

  /** The cached aggregates from the last recount. */
  get totals(): Readonly<CityTotals> {
    return this.cityTotals;
  }

  step(state: GameState, tick: number): void {
    if (tick % this.interval !== 0) return;
    this.recount();
    this.advanceOccupancy();
    // Occupancy moved, so the aggregates the demand formulas read are stale by
    // exactly one pass. Recount rather than extrapolate: it is one more linear
    // walk a day and it keeps population and demand describing the same city.
    this.recount();
    state.population = Math.round(this.cityTotals.residents);
    this.updateDemand();
  }

  /** Recompute {@link totals} from the building list, in place. */
  recount(): void {
    const t = this.cityTotals;
    t.households = 0;
    t.householdsFilled = 0;
    t.jobsCommercial = 0;
    t.jobsIndustrial = 0;
    t.jobsFilled = 0;
    t.buildingsResidential = 0;
    t.buildingsCommercial = 0;
    t.buildingsIndustrial = 0;
    let industrialFilled = 0;
    let commercialFilled = 0;

    const items = this.store.items;
    for (let n = 0; n < items.length; n++) {
      const b = items[n] as BuildingData;
      const filled = b.capacity * b.occupancy;
      switch (b.zone) {
        case 'residential':
          t.households += b.capacity;
          t.householdsFilled += filled;
          t.buildingsResidential++;
          break;
        case 'commercial':
          t.jobsCommercial += b.capacity;
          commercialFilled += filled;
          t.buildingsCommercial++;
          break;
        default:
          t.jobsIndustrial += b.capacity;
          industrialFilled += filled;
          t.buildingsIndustrial++;
          break;
      }
    }

    const tune = DEMAND_TUNING;
    t.jobsFilled = commercialFilled + industrialFilled;
    t.residents = t.householdsFilled * tune.householdSize;
    t.workforce = t.residents * tune.workingAgeFraction;
    t.unemployment = clamp01((t.workforce - t.jobsFilled) / Math.max(t.workforce, 1));
    t.vacancyResidential = clamp01(1 - t.householdsFilled / Math.max(t.households, 1));
    t.goodsSupply = industrialFilled * tune.goodsPerIndustrialJob;
    t.commercialThroughput = commercialFilled * tune.goodsPerCommercialJob;
    t.goodsDemand = t.residents * tune.goodsPerResident;
  }

  /**
   * Move every building's occupancy one day toward its citywide target.
   *
   * Homes fill while there are jobs to be had; workplaces fill while there is
   * labour to hire. Both have a floor, which is the abstraction standing in for
   * the outside connection until that system exists.
   */
  private advanceOccupancy(): void {
    const t = this.cityTotals;
    const tune = DEMAND_TUNING;

    const jobs = t.jobsCommercial + t.jobsIndustrial;
    const potentialWorkers =
      t.households * tune.householdSize * tune.workingAgeFraction;
    const homeTarget = clamp01(
      Math.max(tune.residentialBaseOccupancy, jobs / Math.max(potentialWorkers, 1)),
    );
    const jobTarget = clamp01(
      Math.max(tune.jobBaseOccupancy, t.workforce / Math.max(jobs, 1)),
    );

    const items = this.store.items;
    for (let n = 0; n < items.length; n++) {
      const b = items[n] as BuildingData;
      const target = b.zone === 'residential' ? homeTarget : jobTarget;
      const delta = target - b.occupancy;
      const step = delta > tune.occupancyRate
        ? tune.occupancyRate
        : delta < -tune.occupancyRate
          ? -tune.occupancyRate
          : delta;
      b.occupancy = clamp01(b.occupancy + step);
    }
  }

  /** Recompute the three raw scalars and smooth them into the stored state. */
  private updateDemand(): void {
    const t = this.cityTotals;
    const tune = DEMAND_TUNING;
    const jobs = t.jobsCommercial + t.jobsIndustrial;

    // Residential: jobs outnumbering workers pulls people in; a full city
    // pulls harder. Every denominator is max(x, 1), so an empty city is 0, not
    // NaN — one of the two guardrails simulation.md §3 asks for a test on.
    let rawR =
      tune.weightJobsGap * ((jobs - t.workforce) / Math.max(jobs, 1)) +
      tune.weightHousingPressure * (1 - t.vacancyResidential);

    // Vacancy suppression (demand-growth.md v1 adoption): the brake that stops
    // overzoning from working. Only ever damps positive demand — it must not
    // manufacture demand for an empty city.
    if (rawR > 0) {
      const floor = tune.vacancyFloor;
      rawR *= clamp01(1 - (t.vacancyResidential - floor) / (1 - floor));
    }

    const rawC = (t.goodsDemand - t.commercialThroughput) / Math.max(t.goodsDemand, 1);
    const rawI =
      (t.goodsDemand - t.goodsSupply) / Math.max(t.goodsDemand, 1) +
      tune.weightUnemployment * t.unemployment;

    // Bootstrap floor, applied *after* vacancy suppression so an empty city
    // always starts. Faded linearly rather than cut off, or the city stalls
    // hard at the threshold.
    const fade = clamp01(1 - t.residents / Math.max(tune.seedPopulation, 1));
    const seed = tune.seedDemand;
    const targetR = Math.max(clampSigned(rawR), seed.r * fade);
    const targetC = Math.max(clampSigned(rawC), seed.c * fade);
    const targetI = Math.max(clampSigned(rawI), seed.i * fade);

    const s = tune.smoothing;
    this.state.r = clampSigned(this.state.r + (targetR - this.state.r) * s);
    this.state.c = clampSigned(this.state.c + (targetC - this.state.c) * s);
    this.state.i = clampSigned(this.state.i + (targetI - this.state.i) * s);
  }
}

/**
 * A demand source pinned to constant values. Useful for tests and for the debug
 * API, where "what happens with residential demand at 1?" is the question.
 */
export class FixedDemand implements DemandSource {
  readonly demand: DemandState;

  constructor(demand: Partial<DemandState> = {}) {
    this.demand = {
      r: clampSigned(demand.r ?? 0),
      c: clampSigned(demand.c ?? 0),
      i: clampSigned(demand.i ?? 0),
    };
  }

  /** Overwrite the pinned values. */
  set(demand: Partial<DemandState>): void {
    if (demand.r !== undefined) this.demand.r = clampSigned(demand.r);
    if (demand.c !== undefined) this.demand.c = clampSigned(demand.c);
    if (demand.i !== undefined) this.demand.i = clampSigned(demand.i);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampSigned(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value < -1 ? -1 : value > 1 ? 1 : value;
}
