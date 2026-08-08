/**
 * Self-contained seeded value noise with fractal (multi-octave) helpers.
 *
 * Implemented from scratch: a hashed integer lattice of gradients smoothed with
 * a quintic fade curve, which gives smooth first and second derivatives and so
 * avoids the visible creasing that plain cosine-interpolated value noise
 * produces on large terrain meshes.
 */

import { hashString } from './rng.js';

/** 2D gradient noise over an integer lattice, seeded and deterministic. */
export class Noise2D {
  private readonly perm: Uint8Array;

  /**
   * @param seed Numeric seed, or a string that is hashed into one.
   */
  constructor(seed: number | string) {
    const numericSeed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.perm = buildPermutation(numericSeed);
  }

  /**
   * Sample noise at a point.
   * @returns A value in roughly [-1,1].
   */
  sample(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const u = fade(xf);
    const v = fade(yf);

    const aa = this.gradient(xi, yi, xf, yf);
    const ba = this.gradient(xi + 1, yi, xf - 1, yf);
    const ab = this.gradient(xi, yi + 1, xf, yf - 1);
    const bb = this.gradient(xi + 1, yi + 1, xf - 1, yf - 1);

    const x1 = lerp(aa, ba, u);
    const x2 = lerp(ab, bb, u);
    return lerp(x1, x2, v);
  }

  /**
   * Fractal Brownian motion: sum several octaves of {@link sample} at
   * increasing frequency and decreasing amplitude.
   *
   * @param x World-space x.
   * @param y World-space y.
   * @param octaves Number of layers to sum.
   * @param lacunarity Frequency multiplier per octave.
   * @param gain Amplitude multiplier per octave.
   * @returns A value normalized to roughly [-1,1].
   */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amplitude * this.sample(x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /**
   * Ridged multifractal noise — sharp crests, rounded valleys. Good for hill
   * ranges and mountain silhouettes.
   * @returns A value in roughly [0,1].
   */
  ridged(x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.sample(x * frequency, y * frequency));
      sum += amplitude * n * n;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  private gradient(ix: number, iy: number, dx: number, dy: number): number {
    // Hash the lattice point into one of 8 unit-ish gradient directions.
    const h = this.hash(ix, iy) & 7;
    const g = GRADIENTS[h] as readonly [number, number];
    return g[0] * dx + g[1] * dy;
  }

  private hash(ix: number, iy: number): number {
    const p = this.perm;
    const xi = ix & 255;
    const yi = iy & 255;
    return (p[(p[xi] as number) + yi] as number) & 255;
  }
}

const GRADIENTS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

/** Quintic fade curve 6t^5 - 15t^4 + 10t^3. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Build a 512-entry doubled permutation table from a seed. */
function buildPermutation(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;

  // Deterministic Fisher-Yates using an inline mulberry32.
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = base[i] as number;
    base[i] = base[j] as number;
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255] as number;
  return p;
}

/** Smoothstep between two edges. Returns 0 below `edge0`, 1 above `edge1`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Clamp a value to a range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
