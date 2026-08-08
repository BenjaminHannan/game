/**
 * Game state and the system runner that advances it.
 *
 * This layer is deliberately minimal for the engine foundation: it defines the
 * shape of persistent state and the ordered system pipeline that later phases
 * (economy, traffic, zoning, utilities) plug into.
 */

import type { SaveManager, SaveProvider } from '../core/save.js';

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
}

/** Create a fresh game state. */
export function createGameState(seed: number): GameState {
  return {
    seed,
    cityName: DEFAULT_CITY_NAME,
    money: STARTING_MONEY,
    population: 0,
    tick: 0,
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

  private readonly systems: System[] = [];

  /**
   * @param seed Seed for the new game state.
   */
  constructor(seed: number) {
    this.state = createGameState(seed);
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
    return { ...this.state };
  }

  deserialize(data: GameState): void {
    Object.assign(this.state, data);
  }
}
