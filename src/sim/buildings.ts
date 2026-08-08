/**
 * Buildings: the records growth writes, the lots it finds them on, and the
 * store that keeps the zone grid's `occupant` array honest.
 *
 * The model follows docs/research/zoning-growth.md §4. A **lot** is a run of
 * contiguous, same-zone, unoccupied cells sharing one frontage edge and one
 * facing, plus the cells directly behind them. Lots are never stored — they are
 * *found* on demand by {@link findLot}, which keeps persistent state small and
 * makes the growth rules easy to reason about.
 *
 * A **building** is one flat record per structure. The doc's perf budget sizes
 * this at ~2 000 x ~80 B, which is why buildings are records rather than a
 * struct-of-arrays: the array is append-mostly, iterated once per aggregate
 * pass, and never touched per frame. Everything per *cell* stays in the typed
 * arrays owned by {@link ZoningState}, where the 262 144-element scale actually
 * demands it (OVERVIEW §6 guardrail 4).
 *
 * `occupant` is derived, exactly like `frontage`: it is rebuilt from the
 * building list on load rather than trusted from a save.
 *
 * No three.js, no DOM — the module is pure data so tests drive it directly.
 */

import {
  ALONG_DX,
  ALONG_DZ,
  FACING_DX,
  FACING_DZ,
  NO_OCCUPANT,
  ZONE_CELL,
  ZONE_CELL_COUNT,
  ZONE_TYPES,
  cellCentreX,
  cellCentreZ,
  cellStep,
  zoneCode,
  zoneFromCode,
  type CellKey,
  type Facing,
  type ZoneType,
  type ZoningState,
} from './zoning.js';

/** Level every building is created at. Level-ups are a v1.5 system. */
export const BASE_LEVEL = 1;

/** Per-zone lot and occupancy rules (zoning-growth.md §4 "Lot formation"). */
export interface ZoneRule {
  /** Widest run of frontage cells one building may take. */
  readonly maxWidth: number;
  /** Deepest run of cells behind the frontage one building may take. */
  readonly maxDepth: number;
  /**
   * Occupants at full occupancy per lot cell: households for residential, job
   * slots for commercial and industrial.
   */
  readonly capacityPerCell: number;
}

/** The lot catalogue. Data, not special cases. */
export const ZONE_RULES: Readonly<Record<ZoneType, ZoneRule>> = {
  residential: { maxWidth: 2, maxDepth: 2, capacityPerCell: 2 },
  commercial: { maxWidth: 3, maxDepth: 2, capacityPerCell: 3 },
  industrial: { maxWidth: 4, maxDepth: 3, capacityPerCell: 5 },
};

/** A candidate footprint found by {@link findLot}. */
export interface Lot {
  zone: ZoneType;
  /**
   * Frontage-*corner* cell: the end of the frontage run reached by stepping
   * backwards along {@link ALONG_DX}. The whole footprint is reconstructible
   * from this plus width, depth and facing.
   */
  originKey: CellKey;
  /** Cells along the frontage. */
  width: number;
  /** Cells back from the frontage. */
  depth: number;
  /** Quadrant pointing from the lot at its road. */
  facing: Facing;
  /** Road edge every frontage cell fronts. */
  edgeId: number;
  /** Every cell the footprint covers, in row-major footprint order. */
  cells: CellKey[];
}

/** One grown structure. */
export interface BuildingData {
  /** Stable id, unique within one city. Never reused. */
  id: number;
  zone: ZoneType;
  /** Frontage-corner cell, matching {@link Lot.originKey}. */
  cell: CellKey;
  /** Lot width in cells. */
  w: number;
  /** Lot depth in cells. */
  d: number;
  /** Quadrant pointing at the road. */
  facing: Facing;
  /**
   * Density level. Growth only ever writes {@link BASE_LEVEL}; the field is
   * reserved for the v1.5 level-up system and is already read by the capacity
   * curve so that system is a one-file change.
   */
  level: number;
  /**
   * Per-building appearance seed, drawn once from the zoning RNG stream and
   * *saved*, so a reloaded city looks identical even though the render layer
   * never sees the RNG.
   */
  seed: number;
  /** Households (R) or job slots (C/I) at full occupancy. */
  capacity: number;
  /** Occupied fraction in [0,1], moved by the demand pass. */
  occupancy: number;
  /** Tick the building appeared, for the grow-in animation and save sanity. */
  bornTick: number;
}

/** Serializable form of the building list. Mirrors `RoadNetworkData`. */
export interface BuildingsData {
  /** Next id handed out. Ids are never reused. */
  nextId: number;
  items: BuildingData[];
}

/** An empty building list. */
export function createBuildingsData(): BuildingsData {
  return { nextId: 1, items: [] };
}

/** Deep copy of a building list snapshot. */
export function cloneBuildingsData(data: BuildingsData): BuildingsData {
  return { nextId: data.nextId, items: data.items.map((b) => ({ ...b })) };
}

/**
 * Capacity a lot of this size supports at a given level.
 *
 * The level term is the documented CS2 curve (`demand-growth.md` §5, adopted in
 * that doc's v1 section): level 5 is exactly twice level 1. Growth only writes
 * level 1 today, so the term is currently always 1.
 */
export function lotCapacity(zone: ZoneType, w: number, d: number, level: number): number {
  const rule = ZONE_RULES[zone];
  const base = rule.capacityPerCell * w * d;
  return Math.max(1, Math.round(base * (1 + 0.25 * (level - 1))));
}

/** Every cell a footprint covers, in row-major footprint order. */
export function footprintCells(
  originKey: CellKey,
  w: number,
  d: number,
  facing: Facing,
): CellKey[] {
  const cells: CellKey[] = [];
  const ax = ALONG_DX[facing] as number;
  const az = ALONG_DZ[facing] as number;
  // "Back" is away from the road, i.e. the opposite of the facing quadrant.
  const bx = -(FACING_DX[facing] as number);
  const bz = -(FACING_DZ[facing] as number);
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < w; i++) {
      const k = cellStep(originKey, ax * i + bx * j, az * i + bz * j);
      if (k >= 0) cells.push(k);
    }
  }
  return cells;
}

/** World centre of a footprint, in metres. */
export function footprintCentre(building: BuildingData): { x: number; z: number } {
  const cells = footprintCells(building.cell, building.w, building.d, building.facing);
  if (cells.length === 0) return { x: cellCentreX(building.cell), z: cellCentreZ(building.cell) };
  let x = 0;
  let z = 0;
  for (const k of cells) {
    x += cellCentreX(k);
    z += cellCentreZ(k);
  }
  return { x: x / cells.length, z: z / cells.length };
}

/** Footprint size in metres, before the neighbour inset. */
export function footprintSize(building: BuildingData): { width: number; depth: number } {
  return { width: building.w * ZONE_CELL, depth: building.d * ZONE_CELL };
}

/**
 * Find the largest legal lot seeded at a frontage cell, or `null`.
 *
 * Follows zoning-growth.md §4 exactly: the seed must touch the verge, be
 * painted and be vacant; the run grows along the frontage while cells match the
 * seed's zone, facing and road edge; the depth is the *minimum* over that run of
 * how far back cells remain same-zone and vacant. Both are capped per zone.
 *
 * The run is extended backwards along the frontage first and then forwards, so
 * a given grid produces the same lot regardless of which cell of the run seeded
 * it — which is what makes the growth tick order-independent.
 */
export function findLot(zoning: ZoningState, seed: CellKey): Lot | null {
  if (seed < 0 || seed >= ZONE_CELL_COUNT) return null;
  if (zoning.depth[seed] !== 0) return null;
  if (!zoning.isVacant(seed)) return null;

  const zone = zoneFromCode(zoning.zone[seed] as number);
  if (zone === 'none') return null;
  const rule = ZONE_RULES[zone];
  const facing = (zoning.facing[seed] as number) as Facing;
  const edgeId = zoning.frontage[seed] as number;

  const ax = ALONG_DX[facing] as number;
  const az = ALONG_DZ[facing] as number;

  const matchesFrontage = (k: CellKey): boolean =>
    k >= 0 &&
    zoning.depth[k] === 0 &&
    zoning.frontage[k] === edgeId &&
    zoning.facing[k] === facing &&
    zoning.zone[k] === zoneCode(zone) &&
    zoning.occupantAt(k) === NO_OCCUPANT;

  // Walk backwards to the start of the run, then forwards, both capped.
  let origin = seed;
  let width = 1;
  while (width < rule.maxWidth) {
    const back = cellStep(origin, -ax, -az);
    if (!matchesFrontage(back)) break;
    origin = back;
    width++;
  }
  let head = origin;
  for (let i = 1; i < width; i++) head = cellStep(head, ax, az);
  while (width < rule.maxWidth) {
    const next = cellStep(head, ax, az);
    if (!matchesFrontage(next)) break;
    head = next;
    width++;
  }

  // Depth is the minimum over the run: a lot is a rectangle, so one shallow
  // column caps the whole building.
  const bx = -(FACING_DX[facing] as number);
  const bz = -(FACING_DZ[facing] as number);
  let depth = rule.maxDepth;
  for (let i = 0; i < width && depth > 0; i++) {
    const column = cellStep(origin, ax * i, az * i);
    let reach = 1;
    while (reach < depth) {
      const k = cellStep(column, bx * reach, bz * reach);
      if (k < 0 || zoning.zone[k] !== zoneCode(zone) || !zoning.isVacant(k)) break;
      reach++;
    }
    depth = Math.min(depth, reach);
  }
  if (width < 1 || depth < 1) return null;

  return {
    zone,
    originKey: origin,
    width,
    depth,
    facing,
    edgeId,
    cells: footprintCells(origin, width, depth, facing),
  };
}

/**
 * Editing surface over the serializable building list, wrapped around the plain
 * {@link BuildingsData} living in the game state so saving is just serializing
 * that object — the same shape `RoadNetwork` uses for roads.
 *
 * The store is the only writer of {@link ZoningState.occupant}: every claim and
 * release goes through {@link add} and {@link remove}, so the derived array can
 * never drift from the list.
 */
export class BuildingStore {
  /** Bumped on every append; renderers append the new range on a change. */
  private revisionCounter = 0;

  /**
   * Bumped whenever the list is reordered or shortened. A renderer that sees
   * this move must rebuild wholesale rather than appending.
   */
  private structureCounter = 0;

  private readonly host: { buildings: BuildingsData };
  private readonly zoning: ZoningState;
  private readonly index = new Map<number, number>();

  /**
   * @param host Object owning the serializable list, typically `GameState`.
   * @param zoning Cell grid whose `occupant` array this store maintains.
   */
  constructor(host: { buildings: BuildingsData }, zoning: ZoningState) {
    this.host = host;
    this.zoning = zoning;
    this.reindex();
  }

  /** The live serializable list. */
  get data(): BuildingsData {
    return this.host.buildings;
  }

  /** All buildings, in creation order. */
  get items(): readonly BuildingData[] {
    return this.host.buildings.items;
  }

  /** Number of standing buildings. */
  get count(): number {
    return this.host.buildings.items.length;
  }

  /** Monotonic append counter. */
  get revision(): number {
    return this.revisionCounter;
  }

  /** Monotonic counter of removals and wholesale replacements. */
  get structureRevision(): number {
    return this.structureCounter;
  }

  /** Look up a building by id. */
  get(id: number): BuildingData | null {
    const i = this.index.get(id);
    return i === undefined ? null : (this.host.buildings.items[i] as BuildingData);
  }

  /** Position of a building in {@link items}, or -1. */
  indexOf(id: number): number {
    return this.index.get(id) ?? -1;
  }

  /**
   * Create a building on a found lot and claim its cells.
   * @returns The new record.
   */
  add(lot: Lot, seed: number, bornTick: number): BuildingData {
    const building: BuildingData = {
      id: this.host.buildings.nextId++,
      zone: lot.zone,
      cell: lot.originKey,
      w: lot.width,
      d: lot.depth,
      facing: lot.facing,
      level: BASE_LEVEL,
      seed,
      capacity: lotCapacity(lot.zone, lot.width, lot.depth, BASE_LEVEL),
      occupancy: 0,
      bornTick,
    };
    this.index.set(building.id, this.host.buildings.items.length);
    this.host.buildings.items.push(building);
    for (const k of lot.cells) this.zoning.setOccupant(k, building.id);
    this.revisionCounter++;
    return building;
  }

  /**
   * Remove a building and release its cells.
   * @returns `true` if the building existed.
   */
  remove(id: number): boolean {
    const at = this.index.get(id);
    if (at === undefined) return false;
    const building = this.host.buildings.items[at] as BuildingData;
    for (const k of footprintCells(building.cell, building.w, building.d, building.facing)) {
      if (this.zoning.occupantAt(k) === id) this.zoning.setOccupant(k, NO_OCCUPANT);
    }
    this.host.buildings.items.splice(at, 1);
    this.index.delete(id);
    for (let i = at; i < this.host.buildings.items.length; i++) {
      this.index.set((this.host.buildings.items[i] as BuildingData).id, i);
    }
    this.structureCounter++;
    this.revisionCounter++;
    return true;
  }

  /**
   * True when a building still has a road and still stands on its own paint.
   *
   * A building fails this when its road was deleted (its cells are stranded) or
   * when the player de-zoned or re-zoned underneath it. Both cases schedule a
   * demolition rather than deleting instantly, so the visual does not pop.
   */
  isViable(building: BuildingData): boolean {
    const code = zoneCode(building.zone);
    for (const k of footprintCells(building.cell, building.w, building.d, building.facing)) {
      if ((this.zoning.frontage[k] as number) < 0) return false;
      if (this.zoning.zone[k] !== code) return false;
    }
    return true;
  }

  /** Drop every building and release every cell. */
  clear(): void {
    this.host.buildings = createBuildingsData();
    this.zoning.clearOccupants();
    this.index.clear();
    this.structureCounter++;
    this.revisionCounter++;
  }

  /**
   * Rebuild the id index and the zone grid's `occupant` array from the list.
   *
   * Called after a save load, where the list arrived from outside and the
   * derived array must be recomputed rather than trusted.
   */
  reindex(): void {
    this.index.clear();
    this.zoning.clearOccupants();
    const items = this.host.buildings.items;
    for (let i = 0; i < items.length; i++) {
      const b = items[i] as BuildingData;
      this.index.set(b.id, i);
      for (const k of footprintCells(b.cell, b.w, b.d, b.facing)) {
        this.zoning.setOccupant(k, b.id);
      }
    }
    this.structureCounter++;
    this.revisionCounter++;
  }

  /**
   * Replace the whole list from a (already normalized) snapshot, then rebuild
   * every derived array.
   */
  load(data: BuildingsData): void {
    this.host.buildings = data;
    this.reindex();
  }
}

/**
 * Coerce untrusted input (an old, hand-edited or corrupt save) into a valid
 * {@link BuildingsData}. Never throws.
 *
 * Malformed records are dropped rather than repaired into nonsense: a building
 * needs a finite id, a known zone, an in-range origin cell, and a footprint that
 * fits both the grid and its zone's caps. Footprints overlapping an
 * already-accepted building are discarded — first record wins, so the result is
 * always a consistent occupancy map. `nextId` is repaired to `max(id) + 1` so
 * freshly grown buildings can never collide with restored ids.
 */
export function normalizeBuildingsData(input: unknown): BuildingsData {
  const out = createBuildingsData();
  const raw = input as Partial<BuildingsData> | null | undefined;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return out;

  const ids = new Set<number>();
  const claimed = new Set<CellKey>();
  for (const entry of raw.items) {
    if (!entry || typeof entry !== 'object') continue;
    const b = entry as Partial<BuildingData>;
    if (!isFiniteNumber(b.id)) continue;
    const id = Math.floor(b.id);
    if (id < 0 || ids.has(id)) continue;
    if (typeof b.zone !== 'string' || !(ZONE_TYPES as readonly string[]).includes(b.zone)) {
      continue;
    }
    const zone = b.zone as ZoneType;
    const rule = ZONE_RULES[zone];
    if (!isFiniteNumber(b.cell)) continue;
    const cell = Math.floor(b.cell);
    if (cell < 0 || cell >= ZONE_CELL_COUNT) continue;
    const facing = (isFiniteNumber(b.facing) ? Math.floor(b.facing) & 3 : 0) as Facing;
    const w = clampInt(b.w, 1, rule.maxWidth);
    const d = clampInt(b.d, 1, rule.maxDepth);

    // A footprint that runs off the grid edge is short, and a short footprint
    // means the record's own geometry is a lie: drop it rather than shrink it.
    const cells = footprintCells(cell, w, d, facing);
    if (cells.length !== w * d) continue;
    let overlaps = false;
    for (const k of cells) overlaps = overlaps || claimed.has(k);
    if (overlaps) continue;
    for (const k of cells) claimed.add(k);

    const level = clampInt(b.level, 1, 5);
    ids.add(id);
    out.items.push({
      id,
      zone,
      cell,
      w,
      d,
      facing,
      level,
      seed: isFiniteNumber(b.seed) ? Math.floor(b.seed) >>> 0 : 0,
      capacity: isFiniteNumber(b.capacity)
        ? Math.max(0, Math.floor(b.capacity))
        : lotCapacity(zone, w, d, level),
      occupancy: isFiniteNumber(b.occupancy) ? clamp01(b.occupancy) : 0,
      bornTick: isFiniteNumber(b.bornTick) ? Math.max(0, Math.floor(b.bornTick)) : 0,
    });
  }

  let highest = 0;
  for (const b of out.items) highest = Math.max(highest, b.id);
  const declared = isFiniteNumber(raw.nextId) ? Math.floor(raw.nextId) : 0;
  out.nextId = Math.max(declared, highest + 1, 1);
  return out;
}

function clampInt(value: unknown, min: number, max: number): number {
  if (!isFiniteNumber(value)) return min;
  const v = Math.floor(value);
  return v < min ? min : v > max ? max : v;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
