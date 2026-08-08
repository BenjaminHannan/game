/**
 * Game state and the system runner that advances it.
 *
 * This layer is deliberately minimal for the engine foundation: it defines the
 * shape of persistent state and the ordered system pipeline that later phases
 * (economy, traffic, zoning, utilities) plug into.
 */

import type { SaveManager, SaveProvider } from '../core/save.js';
import {
  RoadNetwork,
  cloneRoadNetworkData,
  createRoadNetworkData,
  normalizeRoadNetworkData,
  type RoadNetworkData,
  type RoadNetworkOptions,
} from './roads.js';
import { ZoningState, createZoningSaveData, type ZoningSaveData } from './zoning.js';
import {
  BuildingStore,
  cloneBuildingsData,
  createBuildingsData,
  normalizeBuildingsData,
  type BuildingsData,
} from './buildings.js';
import { createDemandState, normalizeDemandState, type DemandState } from './demand.js';

/** Default name for a new city. */
export const DEFAULT_CITY_NAME = 'Riverbend';

/** Starting treasury for a new city. */
export const STARTING_MONEY = 500000;

/** All persistent game state. */
export interface GameState {
  /** Seed driving terrain and any other deterministic generation. */
  seed: number;
  /** Player-visible city name. */
  cityName: string;
  /** Treasury balance. */
  money: number;
  /** Total residents. */
  population: number;
  /** Simulation ticks elapsed. */
  tick: number;
  /** The road graph. Wrapped for editing by {@link Simulation.roads}. */
  roads: RoadNetworkData;
  /**
   * The painted zone layer, run-length encoded.
   *
   * Unlike `roads`, this is a *snapshot* rather than the live representation:
   * the working data is 262 144 cells of typed array owned by
   * {@link Simulation.zoning}, which no JSON document can hold. The field is
   * refreshed on serialize and repopulated on deserialize.
   */
  zoning: ZoningSaveData;
  /**
   * Every grown building. Wrapped for editing by {@link Simulation.buildings}.
   *
   * The zone grid's `occupant` array is derived from this list and rebuilt on
   * load, the same way `frontage` is derived from `roads`.
   */
  buildings: BuildingsData;
  /** The three RCI demand scalars, advanced daily by the demand system. */
  demand: DemandState;
}

/** Create a fresh game state. */
export function createGameState(seed: number): GameState {
  return {
    seed,
    cityName: DEFAULT_CITY_NAME,
    money: STARTING_MONEY,
    population: 0,
    tick: 0,
    roads: createRoadNetworkData(),
    zoning: createZoningSaveData(),
    buildings: createBuildingsData(),
    demand: createDemandState(),
  };
}

/** One unit of simulation logic, run once per tick in registration order. */
export interface System {
  /** Stable identifier, unique within a {@link Simulation}. */
  readonly id: string;
  /**
   * Advance this system by one tick.
   * @param state Mutable game state.
   * @param tick Absolute tick index being simulated.
   */
  step(state: GameState, tick: number): void;
}

/**
 * Runs an ordered pipeline of {@link System}s over a {@link GameState}, and
 * acts as the save provider for that state.
 */
export class Simulation implements SaveProvider<GameState> {
  readonly key = 'sim';

  /** The live game state. */
  readonly state: GameState;

  /** Editing surface over {@link GameState.roads}. */
  readonly roads: RoadNetwork;

  /** The zone cell grid, derived from {@link roads} and painted by the player. */
  readonly zoning: ZoningState;

  /** Editing surface over {@link GameState.buildings}. */
  readonly buildings: BuildingStore;

  private readonly systems: System[] = [];

  /**
   * @param seed Seed for the new game state.
   * @param roadOptions Terrain sampler and world bounds for the road network.
   *   The sampler can also be attached later via `roads.setSampler()`.
   */
  constructor(seed: number, roadOptions: RoadNetworkOptions = {}) {
    this.state = createGameState(seed);
    this.roads = new RoadNetwork(this.state, roadOptions);
    this.zoning = new ZoningState({ network: this.roads });
    this.buildings = new BuildingStore(this.state, this.zoning);
  }

  /** Append a system to the end of the pipeline. */
  addSystem(system: System): void {
    if (this.systems.some((s) => s.id === system.id)) {
      throw new Error(`Simulation already has a system with id "${system.id}".`);
    }
    this.systems.push(system);
  }

  /** Ids of registered systems, in execution order. */
  systemIds(): string[] {
    return this.systems.map((s) => s.id);
  }

  /**
   * Advance the simulation by exactly one tick, running every system in order.
   * @param tick Absolute tick index supplied by the engine.
   */
  step(tick: number): void {
    this.state.tick = tick;
    for (const system of this.systems) system.step(this.state, tick);
  }

  /** Register this simulation with a save manager. */
  registerWith(saves: SaveManager): void {
    saves.register(this);
  }

  serialize(): GameState {
    // The zone layer is encoded fresh: the live cells are typed arrays, and
    // `state.zoning` is only ever the snapshot of them.
    this.state.zoning = this.zoning.serialize();
    return {
      ...this.state,
      roads: cloneRoadNetworkData(this.state.roads),
      zoning: { zoneRuns: [...this.state.zoning.zoneRuns] },
      buildings: cloneBuildingsData(this.state.buildings),
      demand: { ...this.state.demand },
    };
  }

  deserialize(data: GameState): void {
    // Read the derived branches before the merge: an older document has no such
    // key, and `Object.assign` would silently leave the *previous* session's
    // state in place instead of clearing it.
    const incoming = data as Partial<GameState> | null | undefined;
    const zoningBranch = incoming?.zoning;
    const buildingBranch = incoming?.buildings;
    Object.assign(this.state, data);
    // Saves written before roads existed, or hand-edited ones, are repaired
    // rather than trusted; renderers are told to rebuild from the new graph.
    this.state.roads = normalizeRoadNetworkData(this.state.roads);
    this.roads.markChanged();
    // Zoning decodes after roads, because frontage is rebuilt from the graph
    // that just landed. A version-1 save has no zoning branch at all, which
    // normalizes to an empty grid.
    this.zoning.deserialize(zoningBranch);
    this.state.zoning = this.zoning.serialize();
    // Buildings decode after zoning, because loading them re-derives the zone
    // grid's `occupant` array. Records that no longer have a road under them
    // are kept and left stranded: the growth system's viability scan will
    // condemn them over the next few ticks, which is the correct behaviour.
    this.buildings.load(normalizeBuildingsData(buildingBranch));
    this.state.demand = normalizeDemandState(this.state.demand);
  }
}

/**
 * Keeps the derived zone cells in step with the road graph.
 *
 * Frontage is a full recompute (zoning-growth.md §2) triggered lazily by a
 * revision comparison, so a tick in which no road changed costs one integer
 * compare. Registered before any system that reads zonable cells.
 */
export class ZoningSystem implements System {
  readonly id = 'zoning';

  private readonly zoning: ZoningState;

  constructor(zoning: ZoningState) {
    this.zoning = zoning;
  }

  step(): void {
    this.zoning.rebuildIfStale();
  }
}
