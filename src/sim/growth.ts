/**
 * Building growth: the payoff half of the opening loop.
 *
 * Implements the growth tick of `docs/research/zoning-growth.md` §4. Once every
 * {@link GROWTH_INTERVAL} ticks the system spends a small fixed budget of
 * spawns, split between the three zones in proportion to demand, and retires a
 * couple of buildings whose ground has gone out from under them.
 *
 * Three properties are load-bearing and each one costs something to get right:
 *
 * - **Bounded cost.** Candidate seed cells come from a per-zone ring buffer
 *   refilled by a cursor that sweeps the 262 144-cell zone array incrementally,
 *   not by rescanning it. Viability of standing buildings is checked on a
 *   rotating slice, never as a whole-city pass (OVERVIEW §6 guardrails 5 and 8).
 * - **Determinism.** Every draw comes from `Rng.fork('zoning')` off the city
 *   seed. The cursor, the rings and the demolition queue are ordinary state
 *   advanced only inside {@link GrowthSystem.growthTick}, so replaying the same
 *   tick sequence reproduces the same city byte for byte.
 * - **Growth spreads.** A spawn's probability scales with demand *and* with a
 *   land-value proxy — proximity to the road network's centroid — so a city
 *   fills outward from where it already is instead of in cell-scan order. The
 *   `demand-growth.md` v1 note replaces this proxy with a real land-value field
 *   later at about the same cost; it is deliberately one call
 *   ({@link GrowthSystem.landValueAt}) so that swap stays local.
 *
 * Demand arrives only through {@link DemandSource}, so the economy milestone can
 * replace the model without this file changing.
 */

import { Rng } from '../core/rng.js';
import {
  BuildingStore,
  findLot,
  type BuildingData,
} from './buildings.js';
import type { DemandSource } from './demand.js';
import { ECONOMY_TUNING } from './economy.js';
import type { GameState, System } from './state.js';
import {
  ZONE_CELL_COUNT,
  ZONE_TYPES,
  cellCentreX,
  cellCentreZ,
  type CellKey,
  type ZoneType,
  type ZoningState,
} from './zoning.js';
import type { RoadNetwork } from './roads.js';

/** Ticks between growth passes. 10 at 20 Hz is twice a second. */
export const GROWTH_INTERVAL = 10;

/** Buildings created per growth pass, across all zones. */
export const GROWTH_SPAWN_BUDGET = 4;

/** Buildings retired per growth pass. */
export const GROWTH_DEMOLISH_BUDGET = 2;

/** Standing buildings checked for viability per growth pass. */
export const GROWTH_SCAN_BUDGET = 64;

/** Cells the candidate cursor sweeps per growth pass in the steady state. */
export const CANDIDATE_SWEEP = 8192;

/** Candidate seed cells buffered per zone. */
export const CANDIDATE_CAPACITY = 2048;

/**
 * Buffered candidates below which the sweep keeps going past
 * {@link CANDIDATE_SWEEP} within one pass, up to one full lap of the grid.
 *
 * This is what makes freshly painted cells grow promptly: without it the player
 * waits for the cursor to wrap round to their new zoning, which at the steady
 * rate is up to a dozen seconds of nothing happening.
 */
export const CANDIDATE_HUNGRY = 48;

/** Candidates popped per spawn attempt before the attempt is abandoned. */
export const CANDIDATE_ATTEMPTS = 8;

/** Spawn probability at zero land value and full demand. */
export const GROWTH_BASE_CHANCE = 0.35;

/** Distance in metres over which the land-value proxy falls to zero. */
export const LAND_VALUE_RANGE = 700;

/** Weight of the land-value proxy in the spawn roll. */
export const LAND_VALUE_WEIGHT = 0.6;

/** Events the growth system announces. */
export interface GrowthEvents {
  'zoning:grew': { building: BuildingData };
  'zoning:demolished': { id: number; zone: ZoneType; cell: CellKey };
}

/**
 * Anything the growth system can announce through. `EventBus<GrowthEvents>`
 * satisfies it structurally, so wiring one in costs nothing here.
 */
export interface GrowthEventSink {
  emit<K extends keyof GrowthEvents>(event: K, payload: GrowthEvents[K]): void;
}

/** Construction options for {@link GrowthSystem}. */
export interface GrowthSystemOptions {
  zoning: ZoningState;
  buildings: BuildingStore;
  /** Demand model. Only `demand` is read, so any source will do. */
  demand: DemandSource;
  /** Road graph, used for the land-value proxy. Omit for a flat proxy. */
  roads?: RoadNetwork | null;
  /**
   * Treasury consulted for the broke brake (simulation.md §5 rule 3). Only the
   * balance is read — growth never spends. Omit to grow regardless of money.
   */
  treasury?: { readonly money: number } | null;
  /** City seed. The zoning RNG stream is forked from it. */
  seed: number;
  /** Ticks between passes. Defaults to {@link GROWTH_INTERVAL}. */
  interval?: number;
  /** Buildings per pass. Defaults to {@link GROWTH_SPAWN_BUDGET}. */
  spawnBudget?: number;
  /** Event sink. Omit to stay silent. */
  events?: GrowthEventSink | null;
}

export class GrowthSystem implements System {
  readonly id = 'growth';

  private readonly zoning: ZoningState;
  private readonly store: BuildingStore;
  private readonly demandSource: DemandSource;
  private readonly roads: RoadNetwork | null;
  private readonly treasury: { readonly money: number } | null;
  private readonly events: GrowthEventSink | null;
  private readonly interval: number;
  private readonly spawnBudget: number;
  private readonly rng: Rng;

  /** One ring of candidate seed cells per zone, indexed by zone ordinal. */
  private readonly rings: Uint32Array[];
  private readonly ringHead = [0, 0, 0];
  private readonly ringCount = [0, 0, 0];

  /** Sweep cursor over the zone array, and the revision it was reset for. */
  private cursor = 0;
  private sweptZoneRevision = -1;

  /** Cells swept since the cursor was last reset, capped at one full lap. */
  private sweptSinceReset = 0;

  /** Rotating viability-scan cursor over the building list. */
  private scanCursor = 0;

  /** Ids awaiting demolition, and the read position within it. */
  private readonly demolishQueue: number[] = [];
  private demolishHead = 0;

  /** Scratch, reused every pass so the tick loop allocates nothing. */
  private readonly order = [0, 1, 2];
  private readonly pressure = [0, 0, 0];
  private readonly quota = [0, 0, 0];

  /** Land-value proxy centre, refreshed once per pass. */
  private centroidX = 0;
  private centroidZ = 0;

  /** Buildings grown since construction, for the HUD and for tests. */
  private grownCounter = 0;

  /** Buildings retired since construction. */
  private demolishedCounter = 0;

  constructor(options: GrowthSystemOptions) {
    this.zoning = options.zoning;
    this.store = options.buildings;
    this.demandSource = options.demand;
    this.roads = options.roads ?? null;
    this.treasury = options.treasury ?? null;
    this.events = options.events ?? null;
    this.interval = Math.max(1, Math.floor(options.interval ?? GROWTH_INTERVAL));
    this.spawnBudget = Math.max(0, Math.floor(options.spawnBudget ?? GROWTH_SPAWN_BUDGET));
    this.rng = new Rng(options.seed).fork('zoning');
    this.rings = [
      new Uint32Array(CANDIDATE_CAPACITY),
      new Uint32Array(CANDIDATE_CAPACITY),
      new Uint32Array(CANDIDATE_CAPACITY),
    ];
  }

  /** Total buildings grown by this system. */
  get grown(): number {
    return this.grownCounter;
  }

  /** Total buildings retired by this system. */
  get demolished(): number {
    return this.demolishedCounter;
  }

  /** Buildings queued for demolition but not yet removed. */
  get pendingDemolitions(): number {
    return this.demolishQueue.length - this.demolishHead;
  }

  /** Candidate seed cells currently buffered for a zone. */
  candidateCount(zone: ZoneType): number {
    return this.ringCount[ZONE_TYPES.indexOf(zone)] as number;
  }

  step(_state: GameState, tick: number): void {
    if (tick % this.interval !== 0) return;
    this.growthTick(tick);
  }

  /**
   * Run one growth pass immediately, ignoring the interval.
   *
   * @param tick Tick to stamp new buildings with.
   * @returns How many buildings were created.
   */
  growthTick(tick: number): number {
    // Frontage must be current before anything reads it: a road placed this
    // frame has not been through the zoning system yet.
    this.zoning.rebuildIfStale();
    this.refreshCentroid();
    this.refillCandidates();

    const spawned = this.spawn(tick);
    this.scanViability();
    this.processDemolitions(GROWTH_DEMOLISH_BUDGET);
    return spawned;
  }

  /**
   * Land-value proxy in `[0, 1]` at a world position.
   *
   * Currently distance to the road network's centroid, per zoning-growth.md §4.
   * The `demand-growth.md` v1 plan replaces the body of this method with a
   * lookup into a diffused land-value field; nothing else has to change.
   */
  landValueAt(x: number, z: number): number {
    if (!this.roads || this.roads.nodes.length === 0) return 1;
    const distance = Math.hypot(x - this.centroidX, z - this.centroidZ);
    return clamp01(1 - distance / LAND_VALUE_RANGE);
  }

  /**
   * Growth-probability multiplier from the treasury's state.
   *
   * 1 while solvent, {@link ECONOMY_TUNING.brokeGrowthPenalty} while overdrawn.
   * A brake, not a wall (simulation.md §5): the city still grows, slowly, and
   * nothing standing is destroyed — the player's way out is time and the tax
   * rate, both available and neither instant.
   */
  brokeFactor(): number {
    if (this.treasury === null || this.treasury.money >= 0) return 1;
    return ECONOMY_TUNING.brokeGrowthPenalty;
  }

  /** Queue a building for demolition. Ignores ids already queued. */
  scheduleDemolition(id: number): void {
    for (let i = this.demolishHead; i < this.demolishQueue.length; i++) {
      if (this.demolishQueue[i] === id) return;
    }
    this.demolishQueue.push(id);
  }

  /**
   * Retire up to `budget` queued buildings.
   *
   * A queued building is re-checked first: the player may have repainted the
   * cells or rebuilt the road since it was queued, in which case it is spared.
   *
   * @returns How many were removed.
   */
  processDemolitions(budget: number): number {
    let removed = 0;
    while (removed < budget && this.demolishHead < this.demolishQueue.length) {
      const id = this.demolishQueue[this.demolishHead++] as number;
      const building = this.store.get(id);
      if (!building) continue;
      if (this.store.isViable(building)) continue;
      const payload = { id, zone: building.zone, cell: building.cell };
      this.store.remove(id);
      this.demolishedCounter++;
      removed++;
      this.events?.emit('zoning:demolished', payload);
    }
    // Compact once the queue has been fully drained, so it cannot grow forever.
    if (this.demolishHead >= this.demolishQueue.length) {
      this.demolishQueue.length = 0;
      this.demolishHead = 0;
    }
    return removed;
  }

  /** Drop every buffered candidate and restart the sweep. */
  resetCandidates(): void {
    this.ringCount[0] = 0;
    this.ringCount[1] = 0;
    this.ringCount[2] = 0;
    this.ringHead[0] = 0;
    this.ringHead[1] = 0;
    this.ringHead[2] = 0;
    this.cursor = 0;
    this.sweptSinceReset = 0;
  }

  /** Split the spawn budget across zones by demand and try to fill it. */
  private spawn(tick: number): number {
    const demand = this.demandSource.demand;
    // Only positive demand grows anything: a negative bar means the city has
    // more of that kind than it can fill.
    this.pressure[0] = Math.max(0, demand.r);
    this.pressure[1] = Math.max(0, demand.c);
    this.pressure[2] = Math.max(0, demand.i);
    const total = (this.pressure[0] as number) + (this.pressure[1] as number) + (this.pressure[2] as number);
    if (total <= 0 || this.spawnBudget === 0) return 0;

    let remaining = this.spawnBudget;
    for (let i = 0; i < 3; i++) {
      const share = Math.round((this.spawnBudget * (this.pressure[i] as number)) / total);
      this.quota[i] = Math.min(share, remaining);
      remaining -= this.quota[i] as number;
    }
    // Hand any rounding remainder to the hungriest zone rather than losing it.
    if (remaining > 0) {
      let best = 0;
      for (let i = 1; i < 3; i++) {
        if ((this.pressure[i] as number) > (this.pressure[best] as number)) best = i;
      }
      this.quota[best] = (this.quota[best] as number) + remaining;
    }

    // Shuffle the zone order in place, so a tie between two zones does not
    // always resolve the same way. Fisher-Yates over a preallocated array.
    this.order[0] = 0;
    this.order[1] = 1;
    this.order[2] = 2;
    for (let i = 2; i > 0; i--) {
      const j = this.rng.int(0, i + 1);
      const tmp = this.order[i] as number;
      this.order[i] = this.order[j] as number;
      this.order[j] = tmp;
    }

    let spawned = 0;
    for (let n = 0; n < 3; n++) {
      const zoneIndex = this.order[n] as number;
      const count = this.quota[zoneIndex] as number;
      for (let i = 0; i < count; i++) {
        if (this.tryGrowOne(zoneIndex, this.pressure[zoneIndex] as number, tick)) spawned++;
      }
    }
    return spawned;
  }

  /** One spawn attempt for one zone. */
  private tryGrowOne(zoneIndex: number, pressure: number, tick: number): boolean {
    const zone = ZONE_TYPES[zoneIndex] as ZoneType;
    for (let attempt = 0; attempt < CANDIDATE_ATTEMPTS; attempt++) {
      const seedCell = this.popCandidate(zoneIndex);
      if (seedCell < 0) return false;
      const lot = findLot(this.zoning, seedCell);
      if (!lot || lot.zone !== zone) continue;

      const value = this.landValueAt(cellCentreX(seedCell), cellCentreZ(seedCell));
      const chance =
        (GROWTH_BASE_CHANCE + (1 - GROWTH_BASE_CHANCE) * pressure) *
        (1 - LAND_VALUE_WEIGHT + LAND_VALUE_WEIGHT * value) *
        this.brokeFactor();
      if (!this.rng.chance(chance)) {
        // The cell is fine, it just lost the roll — put it back so the same
        // block keeps competing on later passes instead of being burned.
        this.pushCandidate(zoneIndex, seedCell);
        continue;
      }

      const building = this.store.add(lot, this.rng.int(0, 0x7fffffff), tick);
      this.grownCounter++;
      this.events?.emit('zoning:grew', { building });
      return true;
    }
    return false;
  }

  /**
   * Advance the sweep cursor, buffering vacant frontage cells as candidates.
   *
   * Cheap in the steady state ({@link CANDIDATE_SWEEP} typed-array reads), and
   * willing to run a full lap when the rings are empty, which is exactly the
   * frame after the player painted their first block.
   */
  private refillCandidates(): void {
    // Repainting invalidates what the cursor has already passed, so restart it.
    if (this.zoning.zoneRevision !== this.sweptZoneRevision) {
      this.sweptZoneRevision = this.zoning.zoneRevision;
      this.cursor = 0;
      this.sweptSinceReset = 0;
    }
    // Once a full lap has been walked since the last repaint, the grid holds no
    // candidates the cursor has not already seen — so an empty ring means the
    // city genuinely has nowhere to grow, not that the cursor is behind. Drop
    // back to the cheap steady-state sweep rather than re-reading 262 k cells
    // twice a second for a city that is simply full.
    const lapped = this.sweptSinceReset >= ZONE_CELL_COUNT;

    const zone = this.zoning.zone;
    const depth = this.zoning.depth;
    const frontage = this.zoning.frontage;
    const occupant = this.zoning.occupant;

    let swept = 0;
    while (swept < ZONE_CELL_COUNT) {
      if (
        swept >= CANDIDATE_SWEEP &&
        (lapped || this.bufferedCandidates() >= CANDIDATE_HUNGRY)
      ) {
        break;
      }
      const k = this.cursor;
      this.cursor = k + 1 >= ZONE_CELL_COUNT ? 0 : k + 1;
      swept++;
      if (this.sweptSinceReset < ZONE_CELL_COUNT) this.sweptSinceReset++;
      const code = zone[k] as number;
      if (code === 0 || code > 3) continue;
      if (depth[k] !== 0) continue;
      if ((frontage[k] as number) < 0) continue;
      if (occupant[k] !== -1) continue;
      this.pushCandidate(code - 1, k);
    }
  }

  private bufferedCandidates(): number {
    return (this.ringCount[0] as number) + (this.ringCount[1] as number) + (this.ringCount[2] as number);
  }

  private pushCandidate(zoneIndex: number, k: CellKey): void {
    const count = this.ringCount[zoneIndex] as number;
    if (count >= CANDIDATE_CAPACITY) return;
    const ring = this.rings[zoneIndex] as Uint32Array;
    const head = this.ringHead[zoneIndex] as number;
    ring[(head + count) % CANDIDATE_CAPACITY] = k;
    this.ringCount[zoneIndex] = count + 1;
  }

  /** Pop the next still-valid candidate for a zone, or -1 when none is left. */
  private popCandidate(zoneIndex: number): CellKey {
    const ring = this.rings[zoneIndex] as Uint32Array;
    while ((this.ringCount[zoneIndex] as number) > 0) {
      const head = this.ringHead[zoneIndex] as number;
      const k = ring[head] as number;
      this.ringHead[zoneIndex] = (head + 1) % CANDIDATE_CAPACITY;
      this.ringCount[zoneIndex] = (this.ringCount[zoneIndex] as number) - 1;
      // Buffered cells go stale: the player may have de-zoned them, a road may
      // have been deleted, or a neighbouring lot may have swallowed them.
      if (this.zoning.zone[k] !== zoneIndex + 1) continue;
      if (this.zoning.depth[k] !== 0) continue;
      if (!this.zoning.isVacant(k)) continue;
      return k;
    }
    return -1;
  }

  /**
   * Check a rotating slice of the building list and queue anything that has
   * lost its road or its paint. Constant cost per pass regardless of city size.
   */
  private scanViability(): void {
    const items = this.store.items;
    if (items.length === 0) {
      this.scanCursor = 0;
      return;
    }
    const budget = Math.min(GROWTH_SCAN_BUDGET, items.length);
    for (let n = 0; n < budget; n++) {
      if (this.scanCursor >= items.length) this.scanCursor = 0;
      const building = items[this.scanCursor++] as BuildingData;
      if (!this.store.isViable(building)) this.scheduleDemolition(building.id);
    }
  }

  private refreshCentroid(): void {
    if (!this.roads) return;
    const nodes = this.roads.nodes;
    if (nodes.length === 0) return;
    let x = 0;
    let z = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i] as { x: number; z: number };
      x += n.x;
      z += n.z;
    }
    this.centroidX = x / nodes.length;
    this.centroidZ = z / nodes.length;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
