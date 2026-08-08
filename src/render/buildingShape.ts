/**
 * Procedural low-poly building massing.
 *
 * The art direction is fixed by `docs/research/zoning-growth.md` §5: flat-shaded
 * low-poly, zone-conventional palette, every building 1-3 stacked boxes plus an
 * optional prism roof. Generation is entirely a function of
 * `(seed, zone, w, d)` — **pure**, so the renderer regenerates every building
 * from saved data and nothing about appearance needs persisting beyond the one
 * `seed` integer already on the record.
 *
 * The module deliberately holds no three.js: it emits plain box descriptors in
 * the building's own local frame, which the renderer turns into instance
 * matrices. That keeps the grammar unit-testable headlessly and keeps the shape
 * rules readable as rules rather than as matrix maths.
 *
 * Local frame convention, shared with the renderer:
 * - local **+x** runs along the frontage (the lot's width),
 * - local **+z** runs *away* from the road (the lot's depth),
 * - local **y** is up, and every box is anchored at its own base.
 */

import { Rng } from '../core/rng.js';
import { ZONE_CELL, type ZoneType } from '../sim/zoning.js';

/** Which instanced mesh a box belongs to. */
export type BoxRole = 'base' | 'upper' | 'annex' | 'roof';

/** Roles in mesh order. One instanced mesh exists per (zone, role) pair. */
export const BOX_ROLES: readonly BoxRole[] = ['base', 'upper', 'annex', 'roof'];

/** Most boxes any one building can produce. Bounds the renderer's slot table. */
export const MAX_BOXES_PER_BUILDING = 4;

/** Metres of gap left around a footprint so neighbouring buildings never touch. */
export const LOT_INSET = 1;

/**
 * Visual massing tiers. The simulated `level` field stays at 1 this milestone
 * (level-ups are v1.5), so silhouette variety comes from a seeded tier instead:
 * a street of identical-height boxes reads as a bug, and this is the cheapest
 * honest fix that does not pretend to be a simulation.
 */
export const MASSING_TIERS = 3;

/** Per-zone generation parameters. */
export interface ZoneStyle {
  /** Height range in metres of the base box at massing tier 0. */
  readonly minHeight: number;
  readonly maxHeight: number;
  /** Height multiplier applied per massing tier above 0. */
  readonly tierStep: number;
  /** Probability of a setback box stacked on the base. */
  readonly setbackChance: number;
  /** Probability of a low annex box beside the base (industrial sheds). */
  readonly annexChance: number;
  /** Probability of a prism roof, only ever considered on a 1-cell-wide lot. */
  readonly roofChance: number;
  /** Flat-shaded base colours. Original palette, conventional hues. */
  readonly palette: readonly number[];
}

/** The style catalogue. Data, not special cases. */
export const ZONE_STYLES: Readonly<Record<ZoneType, ZoneStyle>> = {
  residential: {
    minHeight: 6,
    maxHeight: 14,
    tierStep: 0.35,
    setbackChance: 0.15,
    annexChance: 0,
    roofChance: 0.75,
    palette: [0x8fae7a, 0xd8cfae, 0xb1855f, 0xc4b79a],
  },
  commercial: {
    minHeight: 9,
    maxHeight: 22,
    tierStep: 0.45,
    setbackChance: 0.5,
    annexChance: 0.1,
    roofChance: 0,
    palette: [0x5f86b4, 0x8fb6cf, 0x3f5f80, 0x6f9ec0],
  },
  industrial: {
    minHeight: 7,
    maxHeight: 12,
    tierStep: 0.2,
    setbackChance: 0.25,
    annexChance: 0.55,
    roofChance: 0,
    palette: [0xa89778, 0x8a8578, 0x6f6a5e, 0x9a8f76],
  },
};

/** One box of a building's massing, in the building's local frame. */
export interface BuildingBox {
  role: BoxRole;
  /** Centre offset along the frontage, in metres. */
  x: number;
  /** Centre offset away from the road, in metres. */
  z: number;
  /** Bottom of the box above the lot pad, in metres. */
  y: number;
  /** Size along local x. */
  width: number;
  /** Size along local z. */
  depth: number;
  /** Height. */
  height: number;
  /** Flat-shaded colour as a 24-bit hex number. */
  color: number;
}

/** A generated building: its boxes plus the numbers the renderer wants. */
export interface BuildingShape {
  boxes: BuildingBox[];
  /** Overall height in metres, for culling and for the grow-in animation. */
  height: number;
  /** Massing tier, `0 .. MASSING_TIERS - 1`. */
  tier: number;
}

/**
 * Generate a building's massing.
 *
 * @param zone Zone the building grew in, which picks the style and palette.
 * @param seed The building's saved appearance seed.
 * @param w Lot width in cells.
 * @param d Lot depth in cells.
 */
export function buildingShape(zone: ZoneType, seed: number, w: number, d: number): BuildingShape {
  const style = ZONE_STYLES[zone];
  // A fresh generator per building: the sequence depends only on the saved
  // seed, never on how many buildings were generated before it, so the renderer
  // can regenerate any single building at any time.
  const rng = new Rng(seed >>> 0);

  const footWidth = Math.max(2, w * ZONE_CELL - LOT_INSET * 2);
  const footDepth = Math.max(2, d * ZONE_CELL - LOT_INSET * 2);

  const tier = rng.int(0, MASSING_TIERS);
  const baseHeight =
    rng.range(style.minHeight, style.maxHeight) * (1 + style.tierStep * tier);

  const boxes: BuildingBox[] = [];
  boxes.push({
    role: 'base',
    x: 0,
    z: 0,
    y: 0,
    width: footWidth,
    depth: footDepth,
    height: baseHeight,
    color: jitter(rng, rng.pick(style.palette)),
  });
  let top = baseHeight;

  // A setback box: smaller footprint, pushed toward the street so the building
  // reads as having a front.
  if (rng.chance(style.setbackChance)) {
    const scale = rng.range(0.55, 0.85);
    const upperWidth = footWidth * scale;
    const upperDepth = footDepth * scale;
    const upperHeight = rng.range(0.4, 0.9) * baseHeight;
    boxes.push({
      role: 'upper',
      x: 0,
      // Local -z is the street side, so a negative offset is a setback toward
      // the road; half the freed depth is the most it can move without
      // overhanging.
      z: -(footDepth - upperDepth) / 2,
      y: baseHeight,
      width: upperWidth,
      depth: upperDepth,
      height: upperHeight,
      color: jitter(rng, rng.pick(style.palette)),
    });
    top = baseHeight + upperHeight;
  }

  // Industry gets a flat annex *beside* the base rather than on top, which is
  // what makes a works read as a works from the air.
  if (w >= 2 && rng.chance(style.annexChance)) {
    const annexWidth = footWidth * rng.range(0.25, 0.4);
    const annexDepth = footDepth * rng.range(0.5, 0.8);
    boxes.push({
      role: 'annex',
      x: (footWidth - annexWidth) / 2,
      z: (footDepth - annexDepth) / 2,
      y: 0,
      width: annexWidth,
      depth: annexDepth,
      height: baseHeight * 0.35,
      color: jitter(rng, rng.pick(style.palette)),
    });
  }

  // A pitched cap, only on the narrow lots where a house silhouette belongs.
  if (w === 1 && rng.chance(style.roofChance)) {
    const roofHeight = rng.range(0.18, 0.32) * baseHeight;
    boxes.push({
      role: 'roof',
      x: 0,
      z: 0,
      y: baseHeight,
      width: footWidth,
      depth: footDepth,
      height: roofHeight,
      color: jitter(rng, 0x7a4b3a),
    });
    top = Math.max(top, baseHeight + roofHeight);
  }

  return { boxes, height: top, tier };
}

/** Jitter a palette colour by up to ±4% per channel. */
function jitter(rng: Rng, hex: number): number {
  const r = clampByte(((hex >> 16) & 0xff) * rng.range(0.96, 1.04));
  const g = clampByte(((hex >> 8) & 0xff) * rng.range(0.96, 1.04));
  const b = clampByte((hex & 0xff) * rng.range(0.96, 1.04));
  return (r << 16) | (g << 8) | b;
}

function clampByte(value: number): number {
  const v = Math.round(value);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
