/**
 * Zoning: the cell grid the player paints, derived from road frontage.
 *
 * The model follows docs/research/zoning-growth.md §1-§3 and the v1 adoption
 * section of docs/research/cs2/zoning-districts.md: roads emit an 8 m cell grid
 * along both sides of their right-of-way, the player paints those cells, and
 * painting is only ever legal on a cell some road produced.
 *
 * The cell grid is the *same* grid road endpoints already snap to — `ZONE_CELL`
 * is `ROAD_GRID` — so there is no second alignment system to keep honest.
 *
 * Storage follows guardrail 4 of the engineering guardrails (OVERVIEW §6):
 * per-cell state lives in parallel typed arrays allocated once, never in JS
 * objects, so a 512 x 512 grid costs ~2 MB of ArrayBuffer and zero GC pressure.
 *
 * | array      | type         | meaning                                        |
 * | ---------- | ------------ | ---------------------------------------------- |
 * | `zone`     | `Uint8Array` | 0 unzoned, 1/2/3 = R/C/I. **Authored**, saved.  |
 * | `frontage` | `Int32Array` | road edge id, or a negative sentinel. Derived.  |
 * | `depth`    | `Uint8Array` | rank back from the verge, 0 = touching. Derived.|
 * | `facing`   | `Uint8Array` | quadrant from the cell toward its road. Derived.|
 * | `occupant` | `Int32Array` | building id on this cell, or -1. Derived.       |
 *
 * Only `zone` is persisted (run-length encoded); everything else is rebuilt from
 * the road graph on load, which is cheaper and safer than trusting a save.
 *
 * The module is pure data and geometry maths — no three.js, no DOM — so tests
 * drive it directly. Terrain is consulted only through {@link HeightSampler}.
 */

import {
  MIN_ROAD_ELEVATION,
  ROAD_CLASSES,
  ROAD_GRID,
  type HeightSampler,
  type RoadNetwork,
  type RoadNodeData,
} from './roads.js';

/** Zoning cell size in metres. Identical to {@link ROAD_GRID} by construction. */
export const ZONE_CELL: number = ROAD_GRID;

/** Cells per side of the zone grid. 512 x 8 m spans the 4096 m world. */
export const ZONE_GRID_SIZE = 512;

/** Total addressable cells. */
export const ZONE_CELL_COUNT = ZONE_GRID_SIZE * ZONE_GRID_SIZE;

/** Half the extent the grid covers, in metres. World origin is the map centre. */
export const ZONE_WORLD_HALF = (ZONE_GRID_SIZE * ZONE_CELL) / 2;

/** Buildable depth behind a frontage, in cells (4 x 8 m = 32 m). */
export const ZONE_MAX_DEPTH = 4;

/** {@link ZoningState.frontage} value for a cell no road reaches. */
export const NO_FRONTAGE = -1;

/** {@link ZoningState.frontage} value for a cell sitting under a carriageway. */
export const ROAD_FRONTAGE = -2;

/** {@link ZoningState.depth} value for a cell with no frontage. */
export const UNREACHED_DEPTH = 255;

/** {@link ZoningState.occupant} value for a cell with no building on it. */
export const NO_OCCUPANT = -1;

/** Spacing in metres at which an edge centreline is walked while deriving cells. */
export const FRONTAGE_STEP = ZONE_CELL / 2;

/** Flat fee charged per cell zoned. De-zoning is free. */
export const ZONE_COST_PER_CELL = 10;

/** Packed cell key: `cz * ZONE_GRID_SIZE + cx`, both in `[0, ZONE_GRID_SIZE)`. */
export type CellKey = number;

/** Quadrant index: 0 = +x, 1 = +z, 2 = -x, 3 = -z. */
export type Facing = 0 | 1 | 2 | 3;

/** Column step of each {@link Facing} quadrant. */
export const FACING_DX: readonly number[] = [1, 0, -1, 0];

/** Row step of each {@link Facing} quadrant. */
export const FACING_DZ: readonly number[] = [0, 1, 0, -1];

/**
 * Column step *along* a frontage line, i.e. the quadrant rotated a quarter turn.
 * Walking a lot's width uses this; walking its depth uses `-FACING_D*`.
 */
export const ALONG_DX: readonly number[] = [0, -1, 0, 1];

/** Row step along a frontage line. */
export const ALONG_DZ: readonly number[] = [1, 0, -1, 0];

/**
 * Step from a cell by whole cells, or -1 when the result leaves the grid.
 *
 * Stepping through packed keys arithmetically would wrap around a row edge, so
 * the column is unpacked and bounds-checked explicitly.
 */
export function cellStep(k: CellKey, dx: number, dz: number): CellKey {
  if (k < 0 || k >= ZONE_CELL_COUNT) return -1;
  const cx = cellX(k) + dx;
  const cz = cellZ(k) + dz;
  if (cx < 0 || cx >= ZONE_GRID_SIZE || cz < 0 || cz >= ZONE_GRID_SIZE) return -1;
  return cellKey(cx, cz);
}

/** The three zone types v1 ships (RCI; office folds into commercial). */
export const ZONE_TYPES = ['residential', 'commercial', 'industrial'] as const;

/** One of the RCI zone types. */
export type ZoneType = (typeof ZONE_TYPES)[number];

/** What the zone brush applies. `'none'` is the de-zone brush. */
export type ZonePaint = ZoneType | 'none';

/** Every brush the zone tool offers, in toolbar order. */
export const ZONE_PAINTS: readonly ZonePaint[] = [...ZONE_TYPES, 'none'];

/** Stored code for each paint. `zone[k] === 0` means unzoned. */
export const ZONE_CODES: Readonly<Record<ZonePaint, number>> = {
  none: 0,
  residential: 1,
  commercial: 2,
  industrial: 3,
};

/** Player-facing name of each brush. */
export const ZONE_LABELS: Readonly<Record<ZonePaint, string>> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  none: 'De-zone',
};

/**
 * Overlay tint for each zone type. Conventional for the genre (green homes,
 * blue shops, ochre works) but drawn from an original palette.
 */
export const ZONE_COLORS: Readonly<Record<ZoneType, number>> = {
  residential: 0x5fbf68,
  commercial: 0x4a90d9,
  industrial: 0xd9a441,
};

/** Tint for a zonable but unpainted cell, shown while the zone tool is active. */
export const UNZONED_COLOR = 0xdfe4e8;

/** Tint for the de-zone brush preview. */
export const DEZONE_COLOR = 0xe1544a;

/** Serializable form of all zoning state. */
export interface ZoningSaveData {
  /**
   * Run-length encoded {@link ZoningState.zone}: `[code, runLength, ...]`,
   * whose run lengths sum to {@link ZONE_CELL_COUNT}. A typical city is a
   * handful of long zero runs, so 262 144 cells compress to a few hundred
   * numbers.
   */
  zoneRuns: number[];
}

/** Packed key for a cell. */
export function cellKey(cx: number, cz: number): CellKey {
  return cz * ZONE_GRID_SIZE + cx;
}

/** Column index of a cell key. */
export function cellX(k: CellKey): number {
  return k % ZONE_GRID_SIZE;
}

/** Row index of a cell key. */
export function cellZ(k: CellKey): number {
  return (k / ZONE_GRID_SIZE) | 0;
}

/** World x of a cell's centre, in metres. */
export function cellCentreX(k: CellKey): number {
  return cellX(k) * ZONE_CELL - ZONE_WORLD_HALF + ZONE_CELL / 2;
}

/** World z of a cell's centre, in metres. */
export function cellCentreZ(k: CellKey): number {
  return cellZ(k) * ZONE_CELL - ZONE_WORLD_HALF + ZONE_CELL / 2;
}

/**
 * World centre of a cell, in metres. Allocates; the scalar
 * {@link cellCentreX}/{@link cellCentreZ} pair is the hot-path form.
 */
export function cellCentre(k: CellKey): { x: number; z: number } {
  return { x: cellCentreX(k), z: cellCentreZ(k) };
}

/** Column index containing a world x, or -1 when outside the grid. */
export function cellColumnAt(x: number): number {
  const cx = Math.floor((x + ZONE_WORLD_HALF) / ZONE_CELL);
  return cx >= 0 && cx < ZONE_GRID_SIZE ? cx : -1;
}

/** Cell containing a world position, or -1 when outside the grid. */
export function cellAt(x: number, z: number): CellKey {
  const cx = cellColumnAt(x);
  const cz = cellColumnAt(z);
  if (cx < 0 || cz < 0) return -1;
  return cellKey(cx, cz);
}

/** Numeric code for a paint, e.g. `'commercial'` -> 2. */
export function zoneCode(paint: ZonePaint): number {
  return ZONE_CODES[paint] ?? 0;
}

/** Paint for a stored code, defaulting to `'none'` for anything unrecognized. */
export function zoneFromCode(code: number): ZonePaint {
  switch (code) {
    case 1:
      return 'residential';
    case 2:
      return 'commercial';
    case 3:
      return 'industrial';
    default:
      return 'none';
  }
}

/** An empty zoning save: one run of unzoned cells. */
export function createZoningSaveData(): ZoningSaveData {
  return { zoneRuns: [0, ZONE_CELL_COUNT] };
}

/**
 * Coerce untrusted input (an old, truncated or hand-edited save) into a valid
 * {@link ZoningSaveData}. Never throws.
 *
 * A run stream that is truncated is padded with unzoned cells; one that
 * overruns is clipped; unknown zone codes and non-finite lengths become
 * unzoned. A missing or malformed branch yields an empty grid, which is exactly
 * what a version-1 save (written before zoning existed) should decode to.
 */
export function normalizeZoningData(input: unknown): ZoningSaveData {
  const raw = input as Partial<ZoningSaveData> | null | undefined;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.zoneRuns)) {
    return createZoningSaveData();
  }

  const runs: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < raw.zoneRuns.length; i += 2) {
    if (total >= ZONE_CELL_COUNT) break;
    const rawCode = raw.zoneRuns[i];
    const rawLength = raw.zoneRuns[i + 1];
    if (!isFiniteNumber(rawLength)) continue;
    const length = Math.min(Math.floor(rawLength), ZONE_CELL_COUNT - total);
    if (length <= 0) continue;
    // Any code outside 0-3 is treated as unzoned rather than rejected wholesale,
    // so one bad byte cannot cost the player their whole zoning layer.
    const code = isFiniteNumber(rawCode) ? zoneCode(zoneFromCode(Math.floor(rawCode))) : 0;
    // Merge with the previous run so the encoding stays canonical and a
    // save -> load -> save cycle is byte-stable.
    const last = runs.length - 2;
    if (last >= 0 && runs[last] === code) runs[last + 1] = (runs[last + 1] as number) + length;
    else runs.push(code, length);
    total += length;
  }

  if (total < ZONE_CELL_COUNT) {
    const pad = ZONE_CELL_COUNT - total;
    const last = runs.length - 2;
    if (last >= 0 && runs[last] === 0) runs[last + 1] = (runs[last + 1] as number) + pad;
    else runs.push(0, pad);
  }
  return { zoneRuns: runs };
}

/** Construction options for {@link ZoningState}. */
export interface ZoningOptions {
  /** Road graph the cell grid is derived from. */
  network: RoadNetwork;
  /**
   * Terrain consulted so lots never form in water. Defaults to the network's
   * own sampler via {@link RoadNetwork.heightAt}.
   */
  sampler?: HeightSampler | null;
}

/**
 * The zone cell grid: derived frontage plus the player's painted zones.
 *
 * Frontage is a full recompute triggered lazily whenever the road network's
 * revision moves, exactly the pattern `RoadRenderer.update()` already uses.
 * Incremental frontage updates are deliberately not attempted in this
 * milestone — the road tool invalidates wholesale and correctness is worth more.
 */
export class ZoningState {
  /** Authored zone code per cell: 0 unzoned, 1/2/3 = R/C/I. */
  readonly zone = new Uint8Array(ZONE_CELL_COUNT);

  /** Road edge id this cell fronts, or {@link NO_FRONTAGE}/{@link ROAD_FRONTAGE}. */
  readonly frontage = new Int32Array(ZONE_CELL_COUNT);

  /** Rank back from the verge: 0 touches the road, up to `ZONE_MAX_DEPTH - 1`. */
  readonly depth = new Uint8Array(ZONE_CELL_COUNT);

  /** Quadrant from the cell toward its road: 0 = +x, 1 = +z, 2 = -x, 3 = -z. */
  readonly facing = new Uint8Array(ZONE_CELL_COUNT);

  /** Building id standing on this cell, or {@link NO_OCCUPANT}. */
  readonly occupant = new Int32Array(ZONE_CELL_COUNT);

  private readonly network: RoadNetwork;
  private readonly sampler: HeightSampler | null;

  private zoneRevisionCounter = 0;
  private frontageRevisionCounter = 0;
  private builtRoadRevision = -1;

  /** Cells currently zonable, cached so the overlay does not rescan 262 k cells. */
  private zonableCount = 0;

  constructor(options: ZoningOptions) {
    this.network = options.network;
    this.sampler = options.sampler ?? null;
    this.frontage.fill(NO_FRONTAGE);
    this.depth.fill(UNREACHED_DEPTH);
    this.occupant.fill(NO_OCCUPANT);
  }

  /** Bumped whenever painted zones change; the overlay rebuilds on a change. */
  get zoneRevision(): number {
    return this.zoneRevisionCounter;
  }

  /** Bumped whenever the derived frontage is recomputed. */
  get frontageRevision(): number {
    return this.frontageRevisionCounter;
  }

  /** Number of cells a road currently makes zonable. */
  get zonableCells(): number {
    return this.zonableCount;
  }

  /** Ground elevation at a world position, via the sampler or the road network. */
  heightAt(x: number, z: number): number {
    return this.sampler ? this.sampler.heightAt(x, z) : this.network.heightAt(x, z);
  }

  /** True when a road produced this cell and it can therefore be painted. */
  isZonable(k: CellKey): boolean {
    return k >= 0 && k < ZONE_CELL_COUNT && (this.frontage[k] as number) >= 0;
  }

  /** True when this cell sits under a carriageway. */
  isRoadCell(k: CellKey): boolean {
    return k >= 0 && k < ZONE_CELL_COUNT && this.frontage[k] === ROAD_FRONTAGE;
  }

  /**
   * A cell that keeps its paint but no longer has a road: the road it fronted
   * was deleted. Stranded cells are excluded from growth but retain their zone,
   * so re-laying the road restores the player's work.
   */
  isStranded(k: CellKey): boolean {
    if (k < 0 || k >= ZONE_CELL_COUNT) return false;
    return this.zone[k] !== 0 && (this.frontage[k] as number) < 0;
  }

  /**
   * True when a building could stand on this cell right now: a road reaches it,
   * the player painted it, and nothing occupies it yet.
   */
  isVacant(k: CellKey): boolean {
    if (k < 0 || k >= ZONE_CELL_COUNT) return false;
    return (
      this.zone[k] !== 0 &&
      (this.frontage[k] as number) >= 0 &&
      this.occupant[k] === NO_OCCUPANT
    );
  }

  /** Building standing on a cell, or {@link NO_OCCUPANT}. */
  occupantAt(k: CellKey): number {
    if (k < 0 || k >= ZONE_CELL_COUNT) return NO_OCCUPANT;
    return this.occupant[k] as number;
  }

  /** Claim or release a cell for a building. Derived state; never serialized. */
  setOccupant(k: CellKey, buildingId: number): void {
    if (k < 0 || k >= ZONE_CELL_COUNT) return;
    this.occupant[k] = buildingId;
  }

  /** Release every claimed cell. Called before rebuilding from a save. */
  clearOccupants(): void {
    this.occupant.fill(NO_OCCUPANT);
  }

  /** Painted zone of a cell, or `'none'`. */
  zoneAt(k: CellKey): ZonePaint {
    if (k < 0 || k >= ZONE_CELL_COUNT) return 'none';
    return zoneFromCode(this.zone[k] as number);
  }

  /** Painted zone at a world position. */
  zoneAtWorld(x: number, z: number): ZonePaint {
    return this.zoneAt(cellAt(x, z));
  }

  /**
   * True when the brush may legally change this cell.
   *
   * Zoning requires a road frontage and a vacant cell; de-zoning only requires
   * that there is something to clear, so a stranded cell can always be tidied
   * up even after its road is gone.
   */
  canPaint(k: CellKey, paint: ZonePaint): boolean {
    if (k < 0 || k >= ZONE_CELL_COUNT) return false;
    const code = zoneCode(paint);
    if (this.zone[k] === code) return false;
    if (paint === 'none') return true;
    return this.isZonable(k) && this.occupant[k] === NO_OCCUPANT;
  }

  /**
   * Apply one cell of paint.
   * @returns `true` if the cell changed.
   */
  paintCell(k: CellKey, paint: ZonePaint): boolean {
    if (!this.canPaint(k, paint)) return false;
    this.zone[k] = zoneCode(paint);
    this.zoneRevisionCounter++;
    return true;
  }

  /**
   * Apply paint to a batch of cells as one revision bump.
   * @returns How many cells actually changed.
   */
  paintCells(cells: Iterable<CellKey>, paint: ZonePaint): number {
    const code = zoneCode(paint);
    let changed = 0;
    for (const k of cells) {
      if (!this.canPaint(k, paint)) continue;
      this.zone[k] = code;
      changed++;
    }
    if (changed > 0) this.zoneRevisionCounter++;
    return changed;
  }

  /** Cells painted with each zone type, plus the unpainted zonable remainder. */
  counts(): Record<ZoneType, number> & { zonable: number; zoned: number } {
    const out = { residential: 0, commercial: 0, industrial: 0, zonable: 0, zoned: 0 };
    for (let k = 0; k < ZONE_CELL_COUNT; k++) {
      if ((this.frontage[k] as number) >= 0) out.zonable++;
      const code = this.zone[k] as number;
      if (code === 0) continue;
      out.zoned++;
      const type = zoneFromCode(code);
      if (type !== 'none') out[type]++;
    }
    return out;
  }

  /** Erase every painted cell. Derived arrays are untouched. */
  clearZones(): void {
    this.zone.fill(0);
    this.zoneRevisionCounter++;
  }

  /**
   * Recompute frontage if the road network moved since the last rebuild.
   * Called once per tick by the zoning system.
   * @returns `true` if a rebuild happened.
   */
  rebuildIfStale(): boolean {
    if (this.network.revision === this.builtRoadRevision) return false;
    this.rebuildFrontage();
    return true;
  }

  /**
   * Full recompute of `frontage`, `depth` and `facing` from the road graph
   * (zoning-growth.md §2). Two passes over every edge: the first masks the road
   * footprint so a cell under asphalt can never be claimed as a lot, which is
   * what makes the second pass order-independent.
   */
  rebuildFrontage(): void {
    this.frontage.fill(NO_FRONTAGE);
    this.depth.fill(UNREACHED_DEPTH);
    this.facing.fill(0);

    const nodes = new Map<number, RoadNodeData>();
    for (const n of this.network.nodes) nodes.set(n.id, n);

    // --- Pass 1: mask the carriageway ---
    for (const edge of this.network.edges) {
      const a = nodes.get(edge.from);
      const b = nodes.get(edge.to);
      if (!a || !b) continue;
      const cls = ROAD_CLASSES[edge.roadClass] ?? ROAD_CLASSES.small;
      this.maskRoad(a.x, a.z, b.x, b.z, cls.totalWidth / 2);
    }

    // --- Pass 2: cast frontage outward from both verges ---
    for (const edge of this.network.edges) {
      const a = nodes.get(edge.from);
      const b = nodes.get(edge.to);
      if (!a || !b) continue;
      const cls = ROAD_CLASSES[edge.roadClass] ?? ROAD_CLASSES.small;
      // Highways will be non-zonable frontage; reading the flag now keeps that
      // a data change rather than a special case.
      if (!cls.zonable) continue;
      this.castFrontage(a.x, a.z, b.x, b.z, cls.totalWidth / 2, edge.id);
    }

    let zonable = 0;
    for (let k = 0; k < ZONE_CELL_COUNT; k++) if ((this.frontage[k] as number) >= 0) zonable++;
    this.zonableCount = zonable;

    this.builtRoadRevision = this.network.revision;
    this.frontageRevisionCounter++;
    // Stranding and un-stranding change what the overlay draws, so the zone
    // layer is logically dirty too even though no cell was repainted.
    this.zoneRevisionCounter++;
  }

  /** Serialize the painted layer. Derived arrays are never persisted. */
  serialize(): ZoningSaveData {
    const runs: number[] = [];
    let code = this.zone[0] as number;
    let run = 0;
    for (let k = 0; k < ZONE_CELL_COUNT; k++) {
      const c = this.zone[k] as number;
      if (c === code) {
        run++;
        continue;
      }
      runs.push(code, run);
      code = c;
      run = 1;
    }
    runs.push(code, run);
    return { zoneRuns: runs };
  }

  /**
   * Restore the painted layer from a save, then rebuild every derived array
   * from the current road graph. Input is normalized first, so a corrupt or
   * absent branch degrades to an empty grid instead of throwing.
   */
  deserialize(data: unknown): void {
    const safe = normalizeZoningData(data);
    this.zone.fill(0);
    let k = 0;
    for (let i = 0; i + 1 < safe.zoneRuns.length; i += 2) {
      const code = safe.zoneRuns[i] as number;
      const length = safe.zoneRuns[i + 1] as number;
      if (code !== 0) this.zone.fill(code, k, k + length);
      k += length;
    }
    this.occupant.fill(NO_OCCUPANT);
    this.zoneRevisionCounter++;
    // Derived state is always rebuilt on load: cheaper and safer than trusting
    // a save, and it correctly strands cells whose roads did not survive.
    this.builtRoadRevision = -1;
    this.rebuildFrontage();
  }

  /**
   * Stamp every cell within `halfWidth` of a segment as road-occupied.
   *
   * Walks the centreline in half-cell steps and tests only the small box around
   * each sample, so cost scales with road length rather than with the segment's
   * bounding box (which for a long diagonal would be enormous).
   */
  private maskRoad(ax: number, az: number, bx: number, bz: number, halfWidth: number): void {
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    const steps = Math.max(1, Math.ceil(length / FRONTAGE_STEP));
    const reach = Math.ceil(halfWidth / ZONE_CELL) + 1;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = ax + dx * t;
      const pz = az + dz * t;
      const cx0 = cellColumnAt(px);
      const cz0 = cellColumnAt(pz);
      if (cx0 < 0 || cz0 < 0) continue;
      for (let ox = -reach; ox <= reach; ox++) {
        const cx = cx0 + ox;
        if (cx < 0 || cx >= ZONE_GRID_SIZE) continue;
        for (let oz = -reach; oz <= reach; oz++) {
          const cz = cz0 + oz;
          if (cz < 0 || cz >= ZONE_GRID_SIZE) continue;
          const k = cellKey(cx, cz);
          if (this.frontage[k] === ROAD_FRONTAGE) continue;
          const d = distanceToSegment(
            cellCentreX(k),
            cellCentreZ(k),
            ax,
            az,
            bx,
            bz,
          );
          if (d <= halfWidth) this.frontage[k] = ROAD_FRONTAGE;
        }
      }
    }
  }

  /**
   * Claim up to {@link ZONE_MAX_DEPTH} cells on each side of a segment.
   *
   * Probing stops at the first road-occupied cell so a parallel street two cells
   * away splits the block instead of letting one road reach through it, and a
   * cell is only re-claimed by a strictly nearer road, which makes the whole
   * pass independent of edge order.
   */
  private castFrontage(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    halfWidth: number,
    edgeId: number,
  ): void {
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    const nx = dz / length;
    const nz = -dx / length;
    const steps = Math.max(1, Math.ceil(length / FRONTAGE_STEP));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = ax + dx * t;
      const cz = az + dz * t;
      for (let s = -1; s <= 1; s += 2) {
        // Direction from a claimed cell back toward its road.
        const face = quadrantOf(-nx * s, -nz * s);
        for (let d = 0; d < ZONE_MAX_DEPTH; d++) {
          const reach = halfWidth + (d + 0.5) * ZONE_CELL;
          const k = cellAt(cx + nx * s * reach, cz + nz * s * reach);
          if (k < 0) break;
          if (this.frontage[k] === ROAD_FRONTAGE) break;
          if ((this.depth[k] as number) <= d) continue;
          if (this.heightAt(cellCentreX(k), cellCentreZ(k)) < MIN_ROAD_ELEVATION) continue;
          this.frontage[k] = edgeId;
          this.depth[k] = d;
          this.facing[k] = face;
        }
      }
    }
  }
}

/** Quadrant index of a direction: 0 = +x, 1 = +z, 2 = -x, 3 = -z. */
export function quadrantOf(x: number, z: number): number {
  if (Math.abs(x) >= Math.abs(z)) return x >= 0 ? 0 : 2;
  return z >= 0 ? 1 : 3;
}

/** Shortest distance from a point to a segment, in the ground plane. */
export function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-12) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
