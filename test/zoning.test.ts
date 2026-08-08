/**
 * Zone cell grid: cell maths, frontage derivation from the road graph, the
 * drag-paint tool, the overlay's instance buffers and the save round-trip.
 *
 * Everything here is headless — no three.js scene, no DOM — except the overlay
 * block, which builds `InstancedMesh` objects but never a WebGL context.
 */
import { describe, expect, it } from 'vitest';
import { SaveManager, SAVE_VERSION } from '../src/core/save.js';
import { Simulation, ZoningSystem } from '../src/sim/state.js';
import {
  ROAD_CLASSES,
  ROAD_GRID,
  RoadNetwork,
  createRoadNetworkData,
  type HeightSampler,
  type RoadNetworkData,
} from '../src/sim/roads.js';
import {
  NO_FRONTAGE,
  ROAD_FRONTAGE,
  UNREACHED_DEPTH,
  ZONE_CELL,
  ZONE_CELL_COUNT,
  ZONE_COST_PER_CELL,
  ZONE_GRID_SIZE,
  ZONE_MAX_DEPTH,
  ZONE_WORLD_HALF,
  ZoningState,
  cellAt,
  cellCentre,
  cellCentreX,
  cellCentreZ,
  cellKey,
  cellX,
  cellZ,
  createZoningSaveData,
  normalizeZoningData,
  quadrantOf,
  zoneCode,
  zoneFromCode,
  type CellKey,
  type ZonePaint,
} from '../src/sim/zoning.js';
import { ZoneTool } from '../src/input/zoneTool.js';
import { ZoneOverlay } from '../src/render/zoneOverlay.js';

/** Ground at a constant elevation, well above the water line. */
function flat(height = 10): HeightSampler {
  return { heightAt: () => height };
}

/** Ground below sea level everywhere: nothing may be zoned. */
function submerged(): HeightSampler {
  return { heightAt: () => -3 };
}

/** Dry land east of `x = 0`, water west of it. */
function coast(): HeightSampler {
  return { heightAt: (x: number) => (x >= 0 ? 10 : -2) };
}

function makeNetwork(sampler: HeightSampler = flat()): RoadNetwork {
  const host: { roads: RoadNetworkData } = { roads: createRoadNetworkData() };
  return new RoadNetwork(host, { sampler });
}

/** A zoning grid over a fresh network, with frontage already derived. */
function makeZoning(sampler: HeightSampler = flat()): {
  network: RoadNetwork;
  zoning: ZoningState;
} {
  const network = makeNetwork(sampler);
  const zoning = new ZoningState({ network, sampler });
  return { network, zoning };
}

/** Every cell currently carrying a frontage. */
function zonableCells(zoning: ZoningState): CellKey[] {
  const out: CellKey[] = [];
  for (let k = 0; k < ZONE_CELL_COUNT; k++) if ((zoning.frontage[k] as number) >= 0) out.push(k);
  return out;
}

/** Every cell painted with any zone. */
function paintedCells(zoning: ZoningState): CellKey[] {
  const out: CellKey[] = [];
  for (let k = 0; k < ZONE_CELL_COUNT; k++) if (zoning.zone[k] !== 0) out.push(k);
  return out;
}

// --------------------------------------------------------------------------
// Cell maths
// --------------------------------------------------------------------------

describe('zone cell grid', () => {
  it('shares the road grid, so there is only ever one alignment', () => {
    expect(ZONE_CELL).toBe(ROAD_GRID);
    expect(ZONE_GRID_SIZE * ZONE_CELL).toBe(4096);
    expect(ZONE_WORLD_HALF).toBe(2048);
    expect(ZONE_CELL_COUNT).toBe(512 * 512);
  });

  it('round-trips keys through their components', () => {
    for (const [cx, cz] of [
      [0, 0],
      [511, 511],
      [256, 256],
      [3, 509],
    ] as const) {
      const k = cellKey(cx, cz);
      expect(cellX(k)).toBe(cx);
      expect(cellZ(k)).toBe(cz);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(ZONE_CELL_COUNT);
    }
  });

  it('round-trips a cell centre back to its own cell', () => {
    for (const k of [0, 1, ZONE_CELL_COUNT - 1, cellKey(256, 256), cellKey(100, 400)]) {
      const c = cellCentre(k);
      expect(cellAt(c.x, c.z)).toBe(k);
    }
  });

  it('places the origin cell centre a half-cell off the origin', () => {
    const k = cellAt(0, 0);
    expect(k).toBe(cellKey(256, 256));
    expect(cellCentreX(k)).toBe(4);
    expect(cellCentreZ(k)).toBe(4);
    // The cell just west/north of the origin is the mirror.
    const nw = cellAt(-1, -1);
    expect(cellCentreX(nw)).toBe(-4);
    expect(cellCentreZ(nw)).toBe(-4);
  });

  it('covers the corners and rejects anything outside the grid', () => {
    expect(cellAt(-ZONE_WORLD_HALF, -ZONE_WORLD_HALF)).toBe(cellKey(0, 0));
    expect(cellAt(ZONE_WORLD_HALF - 0.001, ZONE_WORLD_HALF - 0.001)).toBe(cellKey(511, 511));
    expect(cellAt(ZONE_WORLD_HALF, 0)).toBe(-1);
    expect(cellAt(0, -ZONE_WORLD_HALF - 1)).toBe(-1);
    expect(cellAt(1e9, 0)).toBe(-1);
    expect(cellAt(Number.NaN, 0)).toBe(-1);
  });

  it('maps paints to codes and back', () => {
    for (const paint of ['residential', 'commercial', 'industrial', 'none'] as ZonePaint[]) {
      expect(zoneFromCode(zoneCode(paint))).toBe(paint);
    }
    // Unknown codes degrade to unzoned rather than throwing.
    expect(zoneFromCode(99)).toBe('none');
    expect(zoneFromCode(-1)).toBe('none');
  });

  it('resolves facing quadrants from a direction', () => {
    expect(quadrantOf(1, 0)).toBe(0);
    expect(quadrantOf(0, 1)).toBe(1);
    expect(quadrantOf(-1, 0)).toBe(2);
    expect(quadrantOf(0, -1)).toBe(3);
    expect(quadrantOf(0.9, 0.1)).toBe(0);
    expect(quadrantOf(0.1, -0.9)).toBe(3);
  });
});

// --------------------------------------------------------------------------
// Frontage derivation
// --------------------------------------------------------------------------

describe('frontage derivation', () => {
  it('produces nothing without roads', () => {
    const { zoning } = makeZoning();
    zoning.rebuildFrontage();
    expect(zoning.zonableCells).toBe(0);
    expect(zonableCells(zoning)).toHaveLength(0);
    expect(zoning.frontage[cellAt(0, 0)]).toBe(NO_FRONTAGE);
    expect(zoning.depth[cellAt(0, 0)]).toBe(UNREACHED_DEPTH);
  });

  it('emits a full-depth strip on both sides of a straight road', () => {
    const { network, zoning } = makeZoning();
    const edge = network.placeSegment(0, 0, 96, 0);
    expect(edge).not.toBeNull();
    zoning.rebuildFrontage();

    const cells = zonableCells(zoning);
    // The centreline is walked in half-cell steps from x = 0 to x = 96, which
    // touches 13 cell columns; each gets ZONE_MAX_DEPTH cells on each side.
    expect(cells).toHaveLength(13 * ZONE_MAX_DEPTH * 2);
    expect(zoning.zonableCells).toBe(cells.length);

    for (const k of cells) {
      expect(zoning.frontage[k]).toBe(edge!.id);
      expect(zoning.depth[k] as number).toBeLessThan(ZONE_MAX_DEPTH);
      expect(zoning.isRoadCell(k)).toBe(false);
      // Every claimed cell is clear of the right-of-way.
      expect(Math.abs(cellCentreZ(k))).toBeGreaterThan(ROAD_CLASSES.small.totalWidth / 2);
    }

    // Depths run 0..3 outward, and facing points back at the road.
    for (const [cz, depth, facing] of [
      [12, 0, 3],
      [20, 1, 3],
      [28, 2, 3],
      [36, 3, 3],
      [-12, 0, 1],
      [-36, 3, 1],
    ] as const) {
      const k = cellAt(48, cz);
      expect(zoning.depth[k]).toBe(depth);
      expect(zoning.facing[k]).toBe(facing);
    }
  });

  it('masks the carriageway so no cell under asphalt is zonable', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();

    for (const z of [-4, 4]) {
      const k = cellAt(48, z);
      expect(zoning.frontage[k]).toBe(ROAD_FRONTAGE);
      expect(zoning.isRoadCell(k)).toBe(true);
      expect(zoning.isZonable(k)).toBe(false);
    }
  });

  it('splits a block between two parallel roads, nearest road winning', () => {
    const { network, zoning } = makeZoning();
    const a = network.placeSegment(0, 0, 96, 0);
    const b = network.placeSegment(0, 48, 96, 48);
    zoning.rebuildFrontage();

    // 48 m apart leaves four free cell rows between the two carriageways;
    // each road takes the two nearer to it.
    expect(zoning.frontage[cellAt(48, 12)]).toBe(a!.id);
    expect(zoning.frontage[cellAt(48, 20)]).toBe(a!.id);
    expect(zoning.frontage[cellAt(48, 28)]).toBe(b!.id);
    expect(zoning.frontage[cellAt(48, 36)]).toBe(b!.id);
    for (const z of [12, 20, 28, 36]) {
      expect(zoning.depth[cellAt(48, z)] as number).toBeLessThan(ZONE_MAX_DEPTH);
    }
  });

  it('is independent of the order roads were built in', () => {
    const forward = makeZoning();
    forward.network.placeSegment(0, 0, 96, 0);
    forward.network.placeSegment(0, 48, 96, 48);
    forward.zoning.rebuildFrontage();

    const reverse = makeZoning();
    reverse.network.placeSegment(0, 48, 96, 48);
    reverse.network.placeSegment(0, 0, 96, 0);
    reverse.zoning.rebuildFrontage();

    // Edge ids differ, but the depth and facing fields must be identical.
    expect([...reverse.zoning.depth]).toEqual([...forward.zoning.depth]);
    expect([...reverse.zoning.facing]).toEqual([...forward.zoning.facing]);
  });

  it('leaves nothing at depth >= 2 between roads 32 m apart', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    network.placeSegment(0, 32, 96, 32);
    zoning.rebuildFrontage();

    // Only two cell rows survive between the carriageways, both at depth 0/1.
    for (const z of [12, 20]) {
      const k = cellAt(48, z);
      expect(zoning.isZonable(k)).toBe(true);
      expect(zoning.depth[k] as number).toBeLessThanOrEqual(1);
    }
    for (const z of [-4, 4, 28, 36]) {
      expect(zoning.isRoadCell(cellAt(48, z))).toBe(true);
    }
  });

  it('refuses to zone underwater ground', () => {
    const { network, zoning } = makeZoning(submerged());
    // The road itself would be rejected on this terrain, so build the graph by
    // hand: the point is that frontage casting consults the sampler too.
    const from = network.addNode(0, 0, 10);
    const to = network.addNode(96, 0, 10);
    network.data.edges.push({ id: 900, from, to, roadClass: 'small', length: 96 });
    network.markChanged();
    zoning.rebuildFrontage();

    expect(zoning.zonableCells).toBe(0);
  });

  it('zones only the dry side of a shoreline road', () => {
    const { network, zoning } = makeZoning(coast());
    const from = network.addNode(0, -96, 10);
    const to = network.addNode(0, 96, 10);
    network.data.edges.push({ id: 901, from, to, roadClass: 'small', length: 192 });
    network.markChanged();
    zoning.rebuildFrontage();

    const cells = zonableCells(zoning);
    expect(cells.length).toBeGreaterThan(0);
    for (const k of cells) expect(cellCentreX(k)).toBeGreaterThan(0);
  });

  it('skips road classes flagged non-zonable', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    const original = ROAD_CLASSES.small.zonable;
    try {
      (ROAD_CLASSES.small as { zonable: boolean }).zonable = false;
      zoning.rebuildFrontage();
      expect(zoning.zonableCells).toBe(0);
      // The carriageway is still masked, so nothing grows on top of it either.
      expect(zoning.isRoadCell(cellAt(48, 4))).toBe(true);
    } finally {
      (ROAD_CLASSES.small as { zonable: boolean }).zonable = original;
    }
  });

  it('rebuilds lazily, only when the road revision moves', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);

    expect(zoning.rebuildIfStale()).toBe(true);
    const revision = zoning.frontageRevision;
    expect(zoning.rebuildIfStale()).toBe(false);
    expect(zoning.frontageRevision).toBe(revision);

    network.placeSegment(0, 0, 0, 96);
    expect(zoning.rebuildIfStale()).toBe(true);
    expect(zoning.frontageRevision).toBe(revision + 1);
  });

  it('strands painted cells when their road is removed, keeping the paint', () => {
    const { network, zoning } = makeZoning();
    const edge = network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();
    const k = cellAt(48, 12);
    expect(zoning.paintCell(k, 'residential')).toBe(true);

    network.removeEdge(edge!.id);
    zoning.rebuildIfStale();

    expect(zoning.isZonable(k)).toBe(false);
    expect(zoning.isStranded(k)).toBe(true);
    // The paint survives, so re-laying the road restores the player's work.
    expect(zoning.zoneAt(k)).toBe('residential');

    network.placeSegment(0, 0, 96, 0);
    zoning.rebuildIfStale();
    expect(zoning.isZonable(k)).toBe(true);
    expect(zoning.isStranded(k)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Painting
// --------------------------------------------------------------------------

describe('painting cells', () => {
  it('paints only zonable, changed cells', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();

    const k = cellAt(48, 12);
    expect(zoning.paintCell(k, 'commercial')).toBe(true);
    expect(zoning.zoneAt(k)).toBe('commercial');
    // Repainting the same zone is a no-op, so it never bumps the revision.
    const revision = zoning.zoneRevision;
    expect(zoning.paintCell(k, 'commercial')).toBe(false);
    expect(zoning.zoneRevision).toBe(revision);

    // Road cells and cells no road reaches are refused.
    expect(zoning.paintCell(cellAt(48, 4), 'commercial')).toBe(false);
    expect(zoning.paintCell(cellAt(48, 400), 'commercial')).toBe(false);
    expect(zoning.paintCell(-1, 'commercial')).toBe(false);
  });

  it('de-zones any painted cell, including a stranded one', () => {
    const { network, zoning } = makeZoning();
    const edge = network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();
    const k = cellAt(48, 12);
    zoning.paintCell(k, 'industrial');

    network.removeEdge(edge!.id);
    zoning.rebuildIfStale();
    expect(zoning.canPaint(k, 'industrial')).toBe(false);
    expect(zoning.canPaint(k, 'none')).toBe(true);
    expect(zoning.paintCell(k, 'none')).toBe(true);
    expect(zoning.zoneAt(k)).toBe('none');
  });

  it('batches a stroke into one revision bump and counts real changes', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();

    const cells = zonableCells(zoning);
    const revision = zoning.zoneRevision;
    expect(zoning.paintCells(cells, 'residential')).toBe(cells.length);
    expect(zoning.zoneRevision).toBe(revision + 1);
    // A second pass changes nothing and leaves the revision alone.
    expect(zoning.paintCells(cells, 'residential')).toBe(0);
    expect(zoning.zoneRevision).toBe(revision + 1);

    const counts = zoning.counts();
    expect(counts.residential).toBe(cells.length);
    expect(counts.zoned).toBe(cells.length);
    expect(counts.zonable).toBe(cells.length);
  });

  it('clears every painted cell without touching derived state', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();
    zoning.paintCells(zonableCells(zoning), 'commercial');
    const zonable = zoning.zonableCells;

    zoning.clearZones();
    expect(paintedCells(zoning)).toHaveLength(0);
    expect(zoning.zonableCells).toBe(zonable);
  });
});

// --------------------------------------------------------------------------
// The zone tool
// --------------------------------------------------------------------------

describe('ZoneTool', () => {
  /** A tool over a 192 m east-west road, ready to paint. */
  function setup(money = 1_000_000): {
    zoning: ZoningState;
    tool: ZoneTool;
    budget: { money: number };
    preview: { cells: readonly CellKey[]; paint: ZonePaint };
  } {
    const { network, zoning } = makeZoning();
    network.placeSegment(-96, 0, 96, 0);
    zoning.rebuildFrontage();
    const budget = { money };
    const preview: { cells: readonly CellKey[]; paint: ZonePaint } = {
      cells: [],
      paint: 'residential',
    };
    const tool = new ZoneTool({
      zoning,
      budget,
      preview: {
        setZonePreview: (cells, paint) => {
          preview.cells = cells;
          preview.paint = paint;
        },
      },
    });
    tool.activate();
    return { zoning, tool, budget, preview };
  }

  it('defaults to the residential brush with a 3x3 square', () => {
    const { tool } = setup();
    expect(tool.id).toBe('zones');
    expect(tool.paint).toBe('residential');
    expect(tool.brushRadius).toBe(1);
    expect(tool.isPainting).toBe(false);
  });

  it('paints a contiguous run across a fast drag, with no gaps', () => {
    const { zoning, tool } = setup();
    // One begin + one extend across 192 m: without interpolation this would
    // paint two disconnected brush stamps.
    const changed = tool.paintStroke(-96, 12, 96, 12);
    expect(changed).toBeGreaterThan(20);

    // Every cell column the drag crossed, at the frontage row, is painted.
    for (let x = -92; x <= 92; x += ZONE_CELL) {
      expect(zoning.zoneAt(cellAt(x, 12))).toBe('residential');
    }
  });

  it('silently skips road cells and unzonable ground', () => {
    const { zoning, tool } = setup();
    // Drag straight down the centreline: every cell under the brush centre is
    // carriageway, and the 3x3 brush picks up the frontage rows either side.
    tool.paintStroke(-96, 0, 96, 0);
    for (let x = -92; x <= 92; x += ZONE_CELL) {
      expect(zoning.zoneAt(cellAt(x, 4))).toBe('none');
      expect(zoning.zoneAt(cellAt(x, -4))).toBe('none');
    }
    // Far from any road nothing at all is painted.
    const before = paintedCells(zoning).length;
    tool.paintStroke(-600, 600, -500, 600);
    expect(paintedCells(zoning)).toHaveLength(before);
  });

  it('charges the treasury per cell and de-zones for free', () => {
    const { zoning, tool, budget } = setup(1000);
    const start = budget.money;
    const changed = tool.paintStroke(-40, 12, 40, 12, 'commercial');
    expect(changed).toBeGreaterThan(0);
    expect(budget.money).toBe(start - changed * ZONE_COST_PER_CELL);

    const afterPaint = budget.money;
    const cleared = tool.paintStroke(-40, 12, 40, 12, 'none');
    expect(cleared).toBe(changed);
    expect(budget.money).toBe(afterPaint);
    expect(zoning.zoneAt(cellAt(0, 12))).toBe('none');
  });

  it('truncates an unaffordable stroke instead of rejecting it', () => {
    const { tool, budget } = setup(ZONE_COST_PER_CELL * 5);
    const changed = tool.paintStroke(-96, 12, 96, 12, 'industrial');
    expect(changed).toBe(5);
    expect(budget.money).toBe(0);

    // With nothing left, the next stroke does nothing at all — and never goes
    // negative.
    expect(tool.paintStroke(-96, 20, 96, 20, 'industrial')).toBe(0);
    expect(budget.money).toBe(0);
  });

  it('leaves the grid untouched when a stroke is cancelled', () => {
    const { zoning, tool } = setup();
    const revision = zoning.zoneRevision;

    tool.beginStroke(-40, 12);
    tool.extendStroke(40, 12);
    expect(tool.isPainting).toBe(true);
    expect(tool.strokeCells.length).toBeGreaterThan(0);

    tool.onKey('Escape');
    expect(tool.isPainting).toBe(false);
    expect(tool.strokeCells).toHaveLength(0);
    expect(zoning.zoneRevision).toBe(revision);
    expect(paintedCells(zoning)).toHaveLength(0);

    // Right-click cancels the same way.
    tool.beginStroke(-40, 12);
    tool.onPointerDown({ x: 0, y: 0, z: 12 }, 2);
    expect(tool.isPainting).toBe(false);
    expect(paintedCells(zoning)).toHaveLength(0);
  });

  it('drives the full pointer down/move/up gesture', () => {
    const { zoning, tool } = setup();
    tool.onPointerDown({ x: -40, y: 10, z: 12 }, 0);
    tool.onPointerMove({ x: 0, y: 10, z: 12 });
    tool.onPointerMove({ x: 40, y: 10, z: 12 });
    expect(tool.isPainting).toBe(true);
    tool.onPointerUp({ x: 40, y: 10, z: 12 }, 0);

    expect(tool.isPainting).toBe(false);
    expect(zoning.zoneAt(cellAt(0, 12))).toBe('residential');
    expect(zoning.zoneAt(cellAt(-40, 12))).toBe('residential');
    expect(zoning.zoneAt(cellAt(40, 12))).toBe('residential');
  });

  it('resizes the brush with [ and ], clamped at both ends', () => {
    const { tool } = setup();
    tool.onKey('BracketRight');
    expect(tool.brushRadius).toBe(2);
    for (let i = 0; i < 10; i++) tool.onKey('BracketRight');
    expect(tool.brushRadius).toBe(4);
    for (let i = 0; i < 10; i++) tool.onKey('BracketLeft');
    expect(tool.brushRadius).toBe(0);

    // A zero-radius brush paints exactly one cell per sample.
    const single = setup();
    single.tool.setBrushRadius(0);
    single.tool.beginStroke(0, 12);
    expect(single.tool.strokeCells).toHaveLength(1);
  });

  it('publishes a preview and a status line', () => {
    const { tool, preview } = setup();
    tool.hover(0, 12);
    // The 3 x 3 brush straddles the verge: the row nearest the centreline is
    // carriageway, so only six of the nine cells are paintable.
    expect(preview.cells).toHaveLength(6);
    expect(preview.paint).toBe('residential');
    expect(tool.status.cells).toBe(6);
    expect(tool.status.cost).toBe(6 * ZONE_COST_PER_CELL);
    expect(tool.status.message).toContain('Residential');
    expect(tool.status.message).toContain('¤');

    tool.setPaint('none');
    tool.hover(0, 12);
    // Nothing is painted yet, so the de-zone brush has nothing to erase.
    expect(preview.cells).toHaveLength(0);
    expect(tool.status.cost).toBe(0);

    // Deactivating clears the preview and blanks the hint.
    tool.deactivate();
    expect(preview.cells).toHaveLength(0);
  });

  it('reports that a road is needed before anything can be zoned', () => {
    const { network, zoning } = makeZoning();
    void network;
    const tool = new ZoneTool({ zoning });
    tool.activate();
    expect(tool.status.message).toContain('road');
  });
});

// --------------------------------------------------------------------------
// Serialization
// --------------------------------------------------------------------------

describe('zoning serialization', () => {
  it('run-length encodes an empty grid as a single run', () => {
    const { zoning } = makeZoning();
    expect(zoning.serialize()).toEqual(createZoningSaveData());
    expect(createZoningSaveData().zoneRuns).toEqual([0, ZONE_CELL_COUNT]);
  });

  it('encodes runs that sum to the whole grid and decodes them back', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    network.placeSegment(0, 0, 0, 96);
    zoning.rebuildFrontage();
    const cells = zonableCells(zoning);
    zoning.paintCells(cells.slice(0, 20), 'residential');
    zoning.paintCells(cells.slice(20, 35), 'industrial');

    const data = zoning.serialize();
    let total = 0;
    for (let i = 1; i < data.zoneRuns.length; i += 2) total += data.zoneRuns[i] as number;
    expect(total).toBe(ZONE_CELL_COUNT);
    // Compression is the whole point: a sparse city is a handful of runs.
    expect(data.zoneRuns.length).toBeLessThan(200);

    const clone = makeZoning();
    clone.network.placeSegment(0, 0, 96, 0);
    clone.network.placeSegment(0, 0, 0, 96);
    clone.zoning.deserialize(data);
    expect([...clone.zoning.zone]).toEqual([...zoning.zone]);
    expect(clone.zoning.serialize()).toEqual(data);
  });

  it('rebuilds derived state on load rather than trusting the save', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();
    zoning.paintCells(zonableCells(zoning), 'commercial');
    const data = zoning.serialize();

    // Loading into a world whose road exists reproduces frontage exactly.
    const withRoad = makeZoning();
    withRoad.network.placeSegment(0, 0, 96, 0);
    withRoad.zoning.deserialize(data);
    expect([...withRoad.zoning.frontage]).toEqual([...zoning.frontage]);
    expect([...withRoad.zoning.depth]).toEqual([...zoning.depth]);
    expect([...withRoad.zoning.facing]).toEqual([...zoning.facing]);

    // Loading into a world with no roads keeps the paint but strands it, which
    // is the correct behaviour rather than a bug.
    const roadless = makeZoning();
    roadless.zoning.deserialize(data);
    expect(roadless.zoning.zonableCells).toBe(0);
    expect(paintedCells(roadless.zoning)).toHaveLength(paintedCells(zoning).length);
    expect(roadless.zoning.isStranded(cellAt(48, 12))).toBe(true);
  });
});

describe('normalizeZoningData', () => {
  const cases: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an empty object', {}],
    ['a non-array branch', { zoneRuns: 'nope' }],
    ['an empty run list', { zoneRuns: [] }],
    ['a truncated stream', { zoneRuns: [1, 10] }],
    ['a dangling code', { zoneRuns: [1, 10, 2] }],
    ['an overrun', { zoneRuns: [2, ZONE_CELL_COUNT * 3] }],
    ['NaNs', { zoneRuns: [Number.NaN, Number.NaN, 1, 5] }],
    ['infinities', { zoneRuns: [1, Number.POSITIVE_INFINITY, 2, 4] }],
    ['negative lengths', { zoneRuns: [1, -50, 2, 4] }],
    ['unknown codes', { zoneRuns: [77, 100, 3, 20] }],
    ['fractional lengths', { zoneRuns: [1, 10.7, 2, 3.2] }],
  ];

  for (const [label, input] of cases) {
    it(`repairs ${label} into a full-length grid`, () => {
      const out = normalizeZoningData(input);
      expect(Array.isArray(out.zoneRuns)).toBe(true);
      let total = 0;
      for (let i = 0; i < out.zoneRuns.length; i += 2) {
        const code = out.zoneRuns[i] as number;
        const length = out.zoneRuns[i + 1] as number;
        expect(code).toBeGreaterThanOrEqual(0);
        expect(code).toBeLessThanOrEqual(3);
        expect(Number.isInteger(length)).toBe(true);
        expect(length).toBeGreaterThan(0);
        total += length;
      }
      expect(total).toBe(ZONE_CELL_COUNT);
    });
  }

  it('is idempotent and merges adjacent equal runs', () => {
    const once = normalizeZoningData({ zoneRuns: [1, 5, 1, 5, 0, 10] });
    expect(once.zoneRuns.slice(0, 2)).toEqual([1, 10]);
    expect(normalizeZoningData(once)).toEqual(once);
  });

  it('decodes to a grid whose painted cells match the runs', () => {
    const { zoning } = makeZoning();
    zoning.deserialize({ zoneRuns: [0, 100, 2, 3, 0, ZONE_CELL_COUNT - 103] });
    expect(zoning.zone[99]).toBe(0);
    expect(zoning.zone[100]).toBe(2);
    expect(zoning.zone[102]).toBe(2);
    expect(zoning.zone[103]).toBe(0);
    expect(zoning.zoneAt(100)).toBe('commercial');
  });
});

// --------------------------------------------------------------------------
// Save round-trip through the Simulation
// --------------------------------------------------------------------------

describe('zoning save round-trip', () => {
  /** A simulation with a small grid of roads and some paint on it. */
  function grownCity(seed = 7): Simulation {
    const sim = new Simulation(seed, { sampler: flat(), bounds: 1024 });
    sim.roads.placeSegment(-96, 0, 96, 0);
    sim.roads.placeSegment(0, -96, 0, 96);
    sim.zoning.rebuildFrontage();
    const tool = new ZoneTool({ zoning: sim.zoning, budget: sim.state });
    tool.paintStroke(-96, 12, 96, 12, 'residential');
    tool.paintStroke(-96, -12, 96, -12, 'commercial');
    tool.paintStroke(12, -96, 12, 96, 'industrial');
    return sim;
  }

  it('bumps the save version to 2 for the zoning branch', () => {
    expect(SAVE_VERSION).toBe(2);
  });

  it('restores an identical zone layer into a fresh simulation', () => {
    const source = grownCity();
    const before = source.zoning.counts();
    expect(before.residential).toBeGreaterThan(0);
    expect(before.commercial).toBeGreaterThan(0);
    expect(before.industrial).toBeGreaterThan(0);

    const saves = new SaveManager(null);
    saves.register(source);
    const json = saves.saveToString();

    const target = new Simulation(1, { sampler: flat(), bounds: 1024 });
    const loadSaves = new SaveManager(null);
    loadSaves.register(target);
    loadSaves.loadFromString(json);

    expect([...target.zoning.zone]).toEqual([...source.zoning.zone]);
    expect([...target.zoning.frontage]).toEqual([...source.zoning.frontage]);
    expect([...target.zoning.depth]).toEqual([...source.zoning.depth]);
    expect([...target.zoning.facing]).toEqual([...source.zoning.facing]);
    expect(target.zoning.counts()).toEqual(before);
    expect(target.state.money).toBe(source.state.money);
  });

  it('survives a second round-trip byte-for-byte', () => {
    const sim = grownCity();
    const saves = new SaveManager(null);
    saves.register(sim);
    const first = saves.saveToString();
    saves.loadFromString(first);
    const second = saves.saveToString();
    expect(JSON.parse(second).data.sim.zoning).toEqual(JSON.parse(first).data.sim.zoning);
  });

  it('loads a version-1 document, with no zoning branch, as an unzoned city', () => {
    const sim = grownCity();
    const saves = new SaveManager(null);
    saves.register(sim);
    const doc = JSON.parse(saves.saveToString());
    doc.version = 1;
    delete doc.data.sim.zoning;

    saves.loadFromString(JSON.stringify(doc));
    expect(paintedCells(sim.zoning)).toHaveLength(0);
    // Roads survived, so the frontage is still there to paint on again.
    expect(sim.zoning.zonableCells).toBeGreaterThan(0);
  });

  it('never throws on a corrupt zoning branch', () => {
    const sim = grownCity();
    const saves = new SaveManager(null);
    saves.register(sim);
    const doc = JSON.parse(saves.saveToString());
    doc.data.sim.zoning = { zoneRuns: [1, 'x', null, Number.NaN, 3] };

    expect(() => saves.loadFromString(JSON.stringify(doc))).not.toThrow();
    expect(sim.zoning.serialize().zoneRuns.length).toBeGreaterThan(0);
  });

  it('runs frontage maintenance as a registered system', () => {
    const sim = new Simulation(3, { sampler: flat(), bounds: 1024 });
    sim.addSystem(new ZoningSystem(sim.zoning));
    expect(sim.systemIds()).toContain('zoning');

    sim.roads.placeSegment(-96, 0, 96, 0);
    expect(sim.zoning.zonableCells).toBe(0);
    sim.step(1);
    expect(sim.zoning.zonableCells).toBeGreaterThan(0);
    // A quiet tick costs one revision comparison and changes nothing.
    const revision = sim.zoning.frontageRevision;
    sim.step(2);
    expect(sim.zoning.frontageRevision).toBe(revision);
  });
});

// --------------------------------------------------------------------------
// Overlay
// --------------------------------------------------------------------------

describe('ZoneOverlay', () => {
  it('draws one instance per painted cell, and empties only on demand', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();
    const overlay = new ZoneOverlay(zoning, flat());

    expect(overlay.paintedCount).toBe(0);
    expect(overlay.emptyCount).toBe(0);

    overlay.setShowEmptyCells(true);
    overlay.update();
    expect(overlay.emptyCount).toBe(zoning.zonableCells);

    const cells = zonableCells(zoning);
    zoning.paintCells(cells.slice(0, 10), 'residential');
    overlay.update();
    expect(overlay.paintedCount).toBe(10);
    expect(overlay.emptyCount).toBe(zoning.zonableCells - 10);

    overlay.setShowEmptyCells(false);
    overlay.update();
    expect(overlay.emptyCount).toBe(0);
    expect(overlay.paintedCount).toBe(10);

    overlay.dispose();
  });

  it('does no work when nothing changed', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();
    const overlay = new ZoneOverlay(zoning, flat());
    zoning.paintCells(zonableCells(zoning).slice(0, 4), 'commercial');
    overlay.update();

    const tint = overlay.group.getObjectByName('ZoneTint') as unknown as {
      instanceMatrix: { version: number };
    };
    const version = tint.instanceMatrix.version;
    overlay.update();
    overlay.update();
    expect(tint.instanceMatrix.version).toBe(version);
    overlay.dispose();
  });

  it('mirrors the tool preview', () => {
    const { network, zoning } = makeZoning();
    network.placeSegment(0, 0, 96, 0);
    zoning.rebuildFrontage();
    const overlay = new ZoneOverlay(zoning, flat());
    const tool = new ZoneTool({ zoning, preview: overlay });
    tool.activate();

    tool.hover(48, 12);
    expect(overlay.previewCount).toBe(6);
    tool.deactivate();
    expect(overlay.previewCount).toBe(0);
    overlay.dispose();
  });
});
