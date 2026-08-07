/**
 * Deterministic seeded pseudo-random number generation.
 *
 * Uses mulberry32, a small fast 32-bit generator with good statistical
 * properties for game use. Streams can be {@link Rng.fork | forked} by name so
 * independent subsystems (terrain, economy, events) never disturb each other's
 * sequences.
 */

/** Hash an arbitrary string into a 32-bit unsigned integer seed. */
export function hashString(str: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Create a raw mulberry32 generator function.
 * @param seed 32-bit unsigned seed.
 * @returns A function producing floats in [0,1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded random number source. */
export class Rng {
  private readonly next: () => number;

  /** The seed this generator was constructed with. */
  readonly seed: number;

  /**
   * @param seed A numeric seed, or a string that is hashed into one.
   */
  constructor(seed: number | string) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.next = mulberry32(this.seed);
  }

  /** Next float in [0,1). */
  float(): number {
    return this.next();
  }

  /** Next float in [min,max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Next integer in [min,max) — `min` inclusive, `max` exclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max));
  }

  /** True with the given probability (0-1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Pick a uniformly random element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length)] as T;
  }

  /** Shuffle a copy of the array (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /**
   * Derive an independent generator from this one's seed and a stream name.
   *
   * Forking is pure: the same parent seed and stream name always yield the same
   * child sequence, and drawing from the parent does not affect the child.
   */
  fork(streamName: string): Rng {
    return new Rng((this.seed ^ hashString(streamName)) >>> 0);
  }
}
