import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  GRID_SIZE,
  WATER_LEVEL,
  WORLD_HALF,
  WORLD_SIZE,
  generateHeightfield,
} from '../src/render/terrain.js';

const SEED = 20260101;

/** Sample the field by grid index. */
function at(field: Float32Array, i: number, j: number): number {
  return field[j * GRID_SIZE + i] as number;
}

/**
 * Measure the widest run of contiguous below-water samples on the line
 * perpendicular to the river, at a given distance along its diagonal axis.
 */
function waterWidthAt(field: Float32Array, along: number): number {
  let widest = 0;
  let run = 0;
  const step = 4;
  for (let across = -1500; across <= 1500; across += step) {
    const x = (along - across) * Math.SQRT1_2;
    const z = (along + across) * Math.SQRT1_2;
    const i = Math.round((x + WORLD_HALF) / CELL_SIZE);
    const j = Math.round((z + WORLD_HALF) / CELL_SIZE);
    if (i < 0 || j < 0 || i >= GRID_SIZE || j >= GRID_SIZE) {
      run = 0;
      continue;
    }
    if (at(field, i, j) <= WATER_LEVEL) {
      run += step;
      if (run > widest) widest = run;
    } else {
      run = 0;
    }
  }
  return widest;
}

describe('terrain generation', () => {
  const field = generateHeightfield(SEED);

  it('fills the whole heightfield with finite heights', () => {
    expect(field.length).toBe(GRID_SIZE * GRID_SIZE);
    for (let k = 0; k < field.length; k++) {
      expect(Number.isFinite(field[k] as number)).toBe(true);
    }
  });

  it('is deterministic for a seed, and different across seeds', () => {
    expect(Array.from(generateHeightfield(SEED))).toEqual(Array.from(field));
    expect(Array.from(generateHeightfield(SEED + 1))).not.toEqual(Array.from(field));
  });

  it('covers a 4096m world at 8m resolution', () => {
    expect(WORLD_SIZE).toBe(4096);
    expect(CELL_SIZE).toBe(8);
  });

  it('stays within a sane height range', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < field.length; k++) {
      const h = field[k] as number;
      if (h < min) min = h;
      if (h > max) max = h;
    }
    // Deep enough for a sea bed, high enough for hills, no runaway spikes.
    expect(min).toBeGreaterThan(-40);
    expect(min).toBeLessThan(-10);
    expect(max).toBeGreaterThan(80);
    expect(max).toBeLessThan(250);
  });

  it('keeps the central plains flat enough to build on', () => {
    // Sample a 1200m box at the map centre, skipping the river itself.
    const radius = Math.floor(600 / CELL_SIZE);
    const centre = Math.floor(GRID_SIZE / 2);
    let steep = 0;
    let counted = 0;
    for (let j = centre - radius; j <= centre + radius; j++) {
      for (let i = centre - radius; i <= centre + radius; i++) {
        const h = at(field, i, j);
        if (h <= WATER_LEVEL + 2) continue; // river and its banks
        const rise = Math.max(
          Math.abs(at(field, i + 1, j) - h),
          Math.abs(at(field, i, j + 1) - h),
        );
        counted++;
        if (rise / CELL_SIZE > 0.2) steep++;
      }
    }
    expect(counted).toBeGreaterThan(1000);
    // Away from the river, the core should be almost entirely gentle.
    expect(steep / counted).toBeLessThan(0.05);
  });

  it('raises hills toward the map edges', () => {
    const centre = Math.floor(GRID_SIZE / 2);
    const centreHeight = at(field, centre, centre);
    // Mid-edge samples on all four sides, away from the river diagonal.
    const edgeSamples = [
      at(field, 4, centre),
      at(field, GRID_SIZE - 5, centre),
      at(field, centre, 4),
      at(field, centre, GRID_SIZE - 5),
    ];
    const meanEdge = edgeSamples.reduce((a, b) => a + b, 0) / edgeSamples.length;
    expect(meanEdge).toBeGreaterThan(centreHeight + 25);
  });

  it('carves a river 80-140m wide across the map', () => {
    for (const along of [-2000, -1000, 0, 1000]) {
      const width = waterWidthAt(field, along);
      expect(width).toBeGreaterThanOrEqual(80);
      expect(width).toBeLessThanOrEqual(140);
    }
  });

  it('opens into a sea inlet at the south-east edge', () => {
    // Near the mouth the water is far wider than the river proper.
    expect(waterWidthAt(field, 2100)).toBeGreaterThan(300);
    // The south-east corner itself is open water.
    expect(at(field, GRID_SIZE - 1, GRID_SIZE - 1)).toBeLessThan(WATER_LEVEL);
  });

  it('leaves most of the map above water', () => {
    let under = 0;
    for (let k = 0; k < field.length; k++) {
      if ((field[k] as number) <= WATER_LEVEL) under++;
    }
    const fraction = under / field.length;
    expect(fraction).toBeGreaterThan(0.03);
    expect(fraction).toBeLessThan(0.2);
  });

  it('has no vertical spikes between neighbouring samples', () => {
    let maxRise = 0;
    for (let j = 0; j < GRID_SIZE; j++) {
      for (let i = 0; i < GRID_SIZE - 1; i++) {
        const rise = Math.abs(at(field, i + 1, j) - at(field, i, j));
        if (rise > maxRise) maxRise = rise;
      }
    }
    // Mountain crags may legitimately approach 45 degrees between adjacent 8m
    // samples; anything beyond this is a carving artifact, not landscape.
    expect(maxRise).toBeLessThan(CELL_SIZE * 1.5);
  });
});
