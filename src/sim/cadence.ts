/**
 * Phase buckets: how often a system runs.
 *
 * `docs/research/simulation.md` §1 and `docs/research/cs2/OVERVIEW.md` §6
 * guardrail 7 both say the same thing — every system declares its own interval,
 * and the interval mechanism is built *before* the systems that need it, because
 * it is the highest-leverage performance tool available in a single thread.
 *
 * The bucket a tick belongs to is a pure function of the absolute tick index, so
 * a save that restores `tick` resumes on exactly the same schedule, and nothing
 * anywhere may branch on wall-clock time or on the player's speed setting. Speed
 * changes how many ticks happen per real second; it never changes what a tick
 * does.
 *
 * These declarations live in their own module rather than in `state.ts` so that
 * a system module can import {@link Cadence} as a value without a runtime import
 * cycle back through the game state.
 */

import type { GameDate } from '../core/time.js';
import type { GameState } from './state.js';

/**
 * How often a system runs.
 *
 * A plain frozen object rather than a TypeScript `enum`: the build runs with
 * isolated modules, where `const enum` is not available, and a value-plus-type
 * pair keeps the ergonomics without emitting a runtime enum object per member.
 */
export const Cadence = {
  /** Every tick — 20 per real second at speed 1. Cheap counters only. */
  Tick: 0,
  /** Once per in-game day (40 ticks): recounts, demand, growth. */
  Daily: 1,
  /** Once per in-game month (1 200 ticks): tax, upkeep, settlement. */
  Monthly: 2,
} as const;

/** One of the {@link Cadence} buckets. */
export type Cadence = (typeof Cadence)[keyof typeof Cadence];

/** What a system is told about the invocation it is running in. */
export interface TickContext {
  /**
   * In-game days represented by this invocation: a fraction of a day for tick
   * systems, 1 for daily systems, 30 for monthly ones.
   *
   * Rate quantities are stored **per month** — the unit the player sees in the
   * budget — and scaled by `days / DAYS_PER_MONTH` when a shorter-cadence system
   * needs them, so retuning a cadence never silently retunes the economy.
   */
  readonly days: number;
  /** True on the tick that opens a new in-game month. */
  readonly monthBoundary: boolean;
  /** True on the tick that opens a new in-game day. */
  readonly dayBoundary: boolean;
  /**
   * The current in-game date.
   *
   * The same object every tick, rewritten in place: the tick loop must not
   * allocate (OVERVIEW §6 guardrail 5). A system that needs to keep a date
   * beyond its own invocation must copy it.
   */
  readonly date: Readonly<GameDate>;
}

/** One unit of simulation logic, run by the dispatcher at its declared cadence. */
export interface System {
  /** Stable identifier, unique within a `Simulation`. */
  readonly id: string;
  /**
   * How often this system runs. Defaults to {@link Cadence.Tick}, which is what
   * every system written before the dispatcher existed silently gets.
   */
  readonly cadence?: Cadence;
  /**
   * Advance this system.
   * @param state Mutable game state.
   * @param tick Absolute tick index being simulated.
   * @param ctx Cadence context for this invocation.
   */
  step(state: GameState, tick: number, ctx: TickContext): void;
}
