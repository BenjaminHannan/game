/**
 * Bulldoze: what the destructive tool is pointing at, and what the city gets
 * back for removing it.
 *
 * The reference game keeps its bulldozer visually apart from the constructive
 * categories and lets it eat anything (`docs/research/cs2/ux-conventions.md`
 * §2). We mirror that: one tool, one gesture, and a **filter** that narrows it to
 * a single layer when the player wants to clear paint without losing the road
 * underneath it.
 *
 * Refunds follow the "stingy refunds on demolition" line of
 * `docs/research/cs2/OVERVIEW.md` §5 and `docs/research/simulation.md` §4 —
 * demolition is a correction, not a savings account:
 *
 * | layer      | refund                                                        |
 * | ---------- | ------------------------------------------------------------- |
 * | road       | {@link BULLDOZE_REFUND_FRACTION} of what the player *paid*     |
 * | zone cells | the same fraction of {@link ZONE_COST_PER_CELL}, per cell      |
 * | building   | nothing — the player never paid for it, the market grew it     |
 *
 * That last row is deliberate. Growth is free to the treasury, so paying to
 * demolish what grew itself would make "zone, wait, bulldoze" a money printer.
 *
 * The module is pure data and geometry maths — no three.js, no DOM — so tests
 * drive it directly and the tool in `src/input` is a thin shell over it.
 */

import {
  footprintCells,
  type BuildingData,
  type BuildingStore,
} from './buildings.js';
import { BULLDOZE_REFUND_FRACTION, ROAD_CLASSES, type RoadEdgeData, type RoadNetwork } from './roads.js';
import type { LedgerCategory } from './economy.js';
import {
  FRONTAGE_STEP,
  NO_OCCUPANT,
  ROAD_FRONTAGE,
  ZONE_CELL,
  ZONE_COST_PER_CELL,
  ZONE_GRID_SIZE,
  ZONE_LABELS,
  cellAt,
  cellCentreX,
  cellCentreZ,
  cellKey,
  cellX,
  cellZ,
  cellColumnAt,
  distanceToSegment,
  zoneFromCode,
  type CellKey,
  type ZoningState,
} from './zoning.js';

/** Which layers the tool is allowed to eat. */
export const BULLDOZE_FILTERS = ['all', 'roads', 'zones', 'buildings'] as const;

/** One entry of {@link BULLDOZE_FILTERS}. */
export type BulldozeFilter = (typeof BULLDOZE_FILTERS)[number];

/** Player-facing name of each filter, for the tool options row. */
export const BULLDOZE_FILTER_LABELS: Readonly<Record<BulldozeFilter, string>> = {
  all: 'Anything',
  roads: 'Roads',
  zones: 'Zoning',
  buildings: 'Buildings',
};

/** The layer a resolved target belongs to. */
export type BulldozeKind = 'road' | 'zone' | 'building';

/** Share of the zoning fee returned when a cell is cleared. */
export const ZONE_REFUND_FRACTION = BULLDOZE_REFUND_FRACTION;

/** Refund for clearing `cells` painted cells. */
export function zoneRefund(cells: number): number {
  if (!Number.isFinite(cells) || cells <= 0) return 0;
  return Math.round(cells * ZONE_COST_PER_CELL * ZONE_REFUND_FRACTION);
}

/**
 * Refund for demolishing one grown building: always zero.
 *
 * Written as a function rather than inlined as a `0` so that the day buildings
 * cost something to place (services, in v1.5) this is the only line that moves.
 */
export function buildingRefund(_building: BuildingData): number {
  return 0;
}

/** Refund for demolishing one road segment, on what the player actually paid. */
export function roadSegmentRefund(edge: RoadEdgeData): number {
  const cost = Number.isFinite(edge.cost) ? Math.max(0, edge.cost) : 0;
  return Math.round(cost * BULLDOZE_REFUND_FRACTION);
}

/** Everything one click of the bulldozer would do. */
export interface BulldozeTarget {
  /** Which layer this hit. */
  kind: BulldozeKind;
  /** Road edge id, building id, or -1 for a patch of zoning. */
  id: number;
  /** Cells the action covers — the highlight payload for the preview. */
  cells: CellKey[];
  /** Treasury credit the action would produce. */
  refund: number;
  /** Player-facing name of the thing under the cursor. */
  label: string;
  /** One short qualifier: a length, a footprint, a cell count. */
  detail: string;
}

/** The three stores the bulldozer edits. */
export interface BulldozeWorld {
  roads: RoadNetwork;
  zoning: ZoningState;
  buildings: BuildingStore;
}

/** Treasury the refund is credited to. A bare `{ money }` works headless. */
export interface BulldozeBudget {
  money: number;
  earn?(amount: number, category: LedgerCategory): void;
}

/** True when a filter admits a layer. */
export function filterAdmits(filter: BulldozeFilter, kind: BulldozeKind): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'roads':
      return kind === 'road';
    case 'zones':
      return kind === 'zone';
    case 'buildings':
      return kind === 'building';
    default:
      return false;
  }
}

/**
 * Every cell a road segment's carriageway covers.
 *
 * Walked along the centreline in half-cell steps exactly as
 * `ZoningState.rebuildFrontage` masks it, so the highlight is the same footprint
 * the frontage pass will free up.
 */
export function roadFootprintCells(
  network: RoadNetwork,
  edge: RoadEdgeData,
  out: CellKey[] = [],
): CellKey[] {
  const a = network.node(edge.from);
  const b = network.node(edge.to);
  if (!a || !b) return out;
  const cls = ROAD_CLASSES[edge.roadClass] ?? ROAD_CLASSES.small;
  const halfWidth = cls.totalWidth / 2;

  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return out;
  const steps = Math.max(1, Math.ceil(length / FRONTAGE_STEP));
  const reach = Math.ceil(halfWidth / ZONE_CELL) + 1;
  const seen = new Set<CellKey>();

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
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
        if (seen.has(k)) continue;
        const d = distanceToSegment(cellCentreX(k), cellCentreZ(k), a.x, a.z, b.x, b.z);
        if (d <= halfWidth) {
          seen.add(k);
          out.push(k);
        }
      }
    }
  }
  return out;
}

/**
 * Nearest road segment whose carriageway covers a world position, or `null`.
 *
 * Linear over the edge list. The graph is a few hundred segments at v1 scale and
 * this runs on hover, not per tick, so the simple form wins over an index that
 * would have to be invalidated on every road edit.
 */
export function roadAt(network: RoadNetwork, x: number, z: number): RoadEdgeData | null {
  let best: RoadEdgeData | null = null;
  let bestDistance = Infinity;
  for (const edge of network.edges) {
    const a = network.node(edge.from);
    const b = network.node(edge.to);
    if (!a || !b) continue;
    const cls = ROAD_CLASSES[edge.roadClass] ?? ROAD_CLASSES.small;
    const d = distanceToSegment(x, z, a.x, a.z, b.x, b.z);
    if (d <= cls.totalWidth / 2 && d < bestDistance) {
      bestDistance = d;
      best = edge;
    }
  }
  return best;
}

/**
 * What one click at a world position would remove, or `null` for empty ground.
 *
 * Resolution order under the `'all'` filter is **building, road, zoning**: the
 * thing standing on the cell before the thing under it before the paint beneath
 * that, which is the order the player perceives depth in. A narrower filter
 * simply skips the layers it excludes rather than reordering them, so switching
 * filters never changes what a given click means for the layer you kept.
 *
 * @param brushRadius Cells either side of the centre for the zoning brush. Roads
 *   and buildings are whole objects and ignore it.
 */
export function resolveBulldozeTarget(
  world: BulldozeWorld,
  x: number,
  z: number,
  filter: BulldozeFilter = 'all',
  brushRadius = 1,
): BulldozeTarget | null {
  const centre = cellAt(x, z);
  if (centre < 0) return null;

  if (filterAdmits(filter, 'building')) {
    const occupant = world.zoning.occupantAt(centre);
    if (occupant !== NO_OCCUPANT) {
      const building = world.buildings.get(occupant);
      if (building) {
        return {
          kind: 'building',
          id: building.id,
          cells: footprintCells(building.cell, building.w, building.d, building.facing),
          refund: buildingRefund(building),
          label: `${capitalize(building.zone)} Building`,
          detail: `${building.w} x ${building.d} lot`,
        };
      }
    }
  }

  if (filterAdmits(filter, 'road')) {
    const edge = roadAt(world.roads, x, z);
    if (edge) {
      const cls = ROAD_CLASSES[edge.roadClass] ?? ROAD_CLASSES.small;
      return {
        kind: 'road',
        id: edge.id,
        cells: roadFootprintCells(world.roads, edge),
        refund: roadSegmentRefund(edge),
        label: cls.name,
        detail: `${edge.length.toFixed(0)} m`,
      };
    }
  }

  if (filterAdmits(filter, 'zone')) {
    const cells = paintedCellsUnderBrush(world.zoning, centre, brushRadius);
    if (cells.length > 0) {
      const type = world.zoning.zoneAt(cells[0] as CellKey);
      return {
        kind: 'zone',
        id: -1,
        cells,
        refund: zoneRefund(cells.length),
        label: `${ZONE_LABELS[type]} Zoning`,
        detail: `${cells.length} cell${cells.length === 1 ? '' : 's'}`,
      };
    }
  }

  return null;
}

/**
 * Carry out a resolved target and credit its refund.
 *
 * Every treasury movement goes through {@link BulldozeBudget.earn} when one is
 * offered, so the single-funnel invariant of `simulation.md` §4 holds — the tool
 * never writes `state.money` itself in a real session.
 *
 * Removing a road deliberately does **not** demolish the buildings beside it
 * here: the frontage rebuild strands their cells on the next tick and the growth
 * system's viability pass queues them, which keeps demolition on one schedule
 * with one animation instead of two code paths that must agree.
 *
 * @returns `true` when something was actually removed.
 */
export function applyBulldoze(
  world: BulldozeWorld,
  target: BulldozeTarget,
  budget?: BulldozeBudget | null,
): boolean {
  let removed = false;
  let refund = target.refund;

  switch (target.kind) {
    case 'building':
      removed = world.buildings.remove(target.id);
      break;
    case 'road': {
      const edge = world.roads.edge(target.id);
      if (edge) {
        refund = roadSegmentRefund(edge);
        removed = world.roads.removeEdge(target.id);
      }
      break;
    }
    case 'zone': {
      // Re-price on what actually changed: the grid may have moved between the
      // hover that built the target and the click that spends it.
      const changed = world.zoning.paintCells(target.cells, 'none');
      refund = zoneRefund(changed);
      removed = changed > 0;
      break;
    }
    default:
      break;
  }

  if (!removed) return false;
  if (budget && refund > 0) {
    if (budget.earn) budget.earn(refund, 'refund');
    else budget.money += refund;
  }
  return true;
}

/** Painted cells under a square brush, in row-major order. */
function paintedCellsUnderBrush(
  zoning: ZoningState,
  centre: CellKey,
  radius: number,
): CellKey[] {
  const r = Math.max(0, Math.floor(radius));
  const cx0 = cellX(centre);
  const cz0 = cellZ(centre);
  const out: CellKey[] = [];
  for (let oz = -r; oz <= r; oz++) {
    const cz = cz0 + oz;
    if (cz < 0 || cz >= ZONE_GRID_SIZE) continue;
    for (let ox = -r; ox <= r; ox++) {
      const cx = cx0 + ox;
      if (cx < 0 || cx >= ZONE_GRID_SIZE) continue;
      const k = cellKey(cx, cz);
      // A cell under a carriageway can carry stale paint; clearing it would be
      // a no-op that still charged a refund, so it is skipped here.
      if (zoning.frontage[k] === ROAD_FRONTAGE) continue;
      if (zoneFromCode(zoning.zone[k] as number) === 'none') continue;
      out.push(k);
    }
  }
  return out;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}
