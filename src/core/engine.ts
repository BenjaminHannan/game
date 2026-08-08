/**
 * Engine: owns the render loop and a fixed-timestep simulation stepper that is
 * fully decoupled from rendering.
 *
 * The simulation advances at {@link TICKS_PER_SECOND} ticks per real second at
 * speed 1. Speed multipliers scale that rate; rendering always runs at display
 * refresh rate and receives an interpolation alpha so visuals can smooth
 * between simulation states.
 */

/** Simulation ticks per real second at speed multiplier 1. */
export const TICKS_PER_SECOND = 20;

/** Seconds of real time per simulation tick at speed multiplier 1. */
export const SECONDS_PER_TICK = 1 / TICKS_PER_SECOND;

/**
 * Maximum real time (seconds) consumed in a single frame. Prevents a "spiral of
 * death" when the tab is backgrounded or the machine hitches.
 */
export const MAX_FRAME_TIME = 0.25;

/** Speed multipliers the engine accepts. 0 means paused. */
export type GameSpeed = 0 | 1 | 2 | 4;

/** Callback invoked once per simulation tick, with the absolute tick index. */
export type TickCallback = (tick: number) => void;

/**
 * Callback invoked once per rendered frame.
 * @param alpha Interpolation factor in [0,1) between the previous and next tick.
 * @param dt Real seconds elapsed since the previous frame.
 */
export type FrameCallback = (alpha: number, dt: number) => void;

/** Live performance counters, updated roughly once per second. */
export interface EngineStats {
  /** Rendered frames per real second. */
  fps: number;
  /** Simulation ticks per real second. */
  tps: number;
}

/**
 * Pure fixed-timestep accumulator. Extracted from {@link Engine} so the stepping
 * math is testable without a DOM or animation frames.
 */
export class FixedStepAccumulator {
  private accumulator = 0;
  private tick = 0;

  /**
   * @param stepSeconds Real seconds represented by one simulation step at speed 1.
   * @param maxFrameSeconds Upper clamp applied to each advance() delta.
   */
  constructor(
    public readonly stepSeconds: number = SECONDS_PER_TICK,
    public readonly maxFrameSeconds: number = MAX_FRAME_TIME,
  ) {}

  /** Absolute number of steps taken since construction (or the last reset). */
  get currentTick(): number {
    return this.tick;
  }

  /** Unconsumed time remaining in the accumulator, in seconds. */
  get pending(): number {
    return this.accumulator;
  }

  /**
   * Interpolation factor in [0,1) describing how far the accumulator has
   * progressed toward the next step.
   */
  get alpha(): number {
    return this.stepSeconds > 0 ? this.accumulator / this.stepSeconds : 0;
  }

  /**
   * Consume real elapsed time and report how many simulation steps are due.
   *
   * The delta is clamped to {@link maxFrameSeconds} before being scaled by
   * `speed`, so a long stall costs at most a bounded burst of steps. At speed 0
   * no time is accumulated and no steps are produced.
   *
   * @param dt Real seconds elapsed since the previous call.
   * @param speed Speed multiplier (0 pauses).
   * @returns Number of steps that should run this frame.
   */
  advance(dt: number, speed: number): number {
    if (speed <= 0 || dt <= 0 || !Number.isFinite(dt)) return 0;
    const clamped = Math.min(dt, this.maxFrameSeconds);
    this.accumulator += clamped * speed;

    // Divide rather than repeatedly subtract, and bias by a tiny epsilon.
    // Frame deltas like 1/60 do not sum to exactly one second in binary
    // floating point, so an exact comparison would silently drop roughly one
    // tick per second. The epsilon can only ever run a step a nanosecond of
    // simulated time early, which is far cheaper than the lost tick.
    const steps = Math.floor(this.accumulator / this.stepSeconds + 1e-9);
    if (steps > 0) {
      this.accumulator = Math.max(0, this.accumulator - steps * this.stepSeconds);
      this.tick += steps;
    }
    return steps;
  }

  /** Reset the tick counter and drop any partially accumulated time. */
  reset(tick = 0): void {
    this.tick = tick;
    this.accumulator = 0;
  }
}

/** Drives simulation and rendering. */
export class Engine {
  private readonly accumulator: FixedStepAccumulator;
  private readonly tickCallbacks = new Set<TickCallback>();
  private readonly frameCallbacks = new Set<FrameCallback>();

  private speed: GameSpeed = 1;
  private running = false;
  private rafHandle = 0;
  private lastTime = 0;

  private frameCount = 0;
  private tickCount = 0;
  private statsWindowStart = 0;
  private readonly statsObj: EngineStats = { fps: 0, tps: 0 };

  constructor(stepSeconds: number = SECONDS_PER_TICK) {
    this.accumulator = new FixedStepAccumulator(stepSeconds, MAX_FRAME_TIME);
  }

  /** Live performance counters. The same object is returned each call. */
  get stats(): Readonly<EngineStats> {
    return this.statsObj;
  }

  /** Absolute simulation tick index. */
  get tick(): number {
    return this.accumulator.currentTick;
  }

  /** Register a per-tick simulation callback. Returns an unsubscribe function. */
  onTick(cb: TickCallback): () => void {
    this.tickCallbacks.add(cb);
    return () => this.tickCallbacks.delete(cb);
  }

  /** Register a per-frame render callback. Returns an unsubscribe function. */
  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.add(cb);
    return () => this.frameCallbacks.delete(cb);
  }

  /** Current speed multiplier (0 = paused). */
  getSpeed(): GameSpeed {
    return this.speed;
  }

  /** Set the speed multiplier. */
  setSpeed(s: GameSpeed): void {
    this.speed = s;
  }

  /**
   * Run `count` simulation ticks immediately, outside the accumulator.
   *
   * For tests and the debug console: a scripted browser run needs to fast
   * forward a year without waiting twelve real minutes, and doing it here keeps
   * the engine's tick index and the simulation's in step — which stepping the
   * simulation directly would not. Any partially accumulated real time is
   * dropped, so the next frame starts from a clean boundary.
   *
   * @returns How many ticks were run.
   */
  advanceTicks(count: number): number {
    const steps = Math.max(0, Math.floor(count));
    for (let i = 0; i < steps; i++) {
      const tick = this.accumulator.currentTick + 1;
      this.accumulator.reset(tick);
      for (const cb of this.tickCallbacks) cb(tick);
    }
    this.tickCount += steps;
    return steps;
  }

  /** Begin the render loop. Safe to call more than once. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.statsWindowStart = this.lastTime;
    this.rafHandle = requestAnimationFrame(this.loop);
  }

  /** Stop the render loop. */
  stop(): void {
    this.running = false;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.loop);

    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const steps = this.accumulator.advance(dt, this.speed);
    for (let i = 0; i < steps; i++) {
      const tickIndex = this.accumulator.currentTick - steps + i + 1;
      for (const cb of this.tickCallbacks) cb(tickIndex);
    }

    const alpha = this.speed > 0 ? this.accumulator.alpha : 0;
    for (const cb of this.frameCallbacks) cb(alpha, dt);

    this.frameCount++;
    this.tickCount += steps;
    const windowMs = now - this.statsWindowStart;
    if (windowMs >= 500) {
      const seconds = windowMs / 1000;
      this.statsObj.fps = this.frameCount / seconds;
      this.statsObj.tps = this.tickCount / seconds;
      this.frameCount = 0;
      this.tickCount = 0;
      this.statsWindowStart = now;
    }
  };
}
