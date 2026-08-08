/**
 * Bulldoze: target resolution, refunds, and the tool's gesture.
 *
 * The rules under test are the ones a balance pass must not be able to break
 * silently: resolution order (building, then road, then paint), the stingy
 * refund fractions from `simulation.md` §4, the fact that a grown building
 * refunds nothing, and that every treasury movement goes through the ledger.
 */

import { describe, expect, it } from 'vitest';
import {
  BULLDOZE_FILTERS,
  applyBulldoze,
  buildingRefund,
  filterAdmits,
  resolveBulldozeTarget,
  roadAt,
  roadFootprintCells,
  roadSegmentRefund,
  zoneRefund,
  ZONE_REFUND_FRACTION,
} from '../src/sim/bulldoze.js';
import { BulldozeTool } from '../src/input/bulldozeTool.js';
import { Simulation } from '../src/sim/state.js';
import { ZoneTool } from '../src/input/zoneTool.js';
import { GrowthSystem } from '../src/sim/growth.js';
import { DemandSystem } from '../src/sim/demand.js';
import { ZoningSystem } from '../src/sim/state.js';
import { BULLDOZE_REFUND_FRACTION, ROAD_CLASSES } from '../src/sim/roads.js';
import { ZONE_COST_PER_CELL, cellAt } from '../src/sim/zoning.js';

/** A flat-ground simulation with one 200 m road laid along z = 0. */
function cityWithRoad(): {
  sim: Simulation;
  edgeId: number;
  world: { roads: Simulation['roads']; zoning: Simulation['zoning']; buildings: Simulation['buildings'] };
} {
  const sim = new Simulation(4242, { bounds: 2048 });
  // No sampler: heightAt returns 0 everywhere, which is under MIN_ROAD_ELEVATION,
  // so give it a flat sampler above sea level instead.
  sim.roads.setSampler({ heightAt: () => 10 });
  const edge = sim.roads.placeSegment(-100, 0, 100, 0);
  if (!edge) throw new Error('road not placeable on flat ground');
  sim.zoning.rebuildFrontage();
  return {
    sim,
    edgeId: edge.id,
    world: { roads: sim.roads, zoning: sim.zoning, buildings: sim.buildings },
  };
}

describe('bulldoze refunds', () => {
  it('returns a quarter of what a road actually cost', () => {
    const { sim, edgeId } = cityWithRoad();
    const edge = sim.roads.edge(edgeId);
    expect(edge).not.toBeNull();
    const paid = (edge as { cost: number }).cost;
    expect(paid).toBeGreaterThan(0);
    expect(roadSegmentRefund(edge as never)).toBe(
      Math.round(paid * BULLDOZE_REFUND_FRACTION),
    );
  });

  it('prices a road refund on what was paid, not on the current catalogue', () => {
    const { sim, edgeId } = cityWithRoad();
    const edge = sim.roads.edge(edgeId) as { cost: number };
    // A hand-edited save, or a future price change, must not move the refund.
    edge.cost = 1000;
    expect(roadSegmentRefund(edge as never)).toBe(250);
  });

  it('refunds a quarter of the zoning fee per cell', () => {
    expect(zoneRefund(4)).toBe(Math.round(4 * ZONE_COST_PER_CELL * ZONE_REFUND_FRACTION));
    expect(zoneRefund(0)).toBe(0);
    expect(zoneRefund(-3)).toBe(0);
    expect(zoneRefund(Number.NaN)).toBe(0);
  });

  it('never refunds a grown building — the player did not pay for it', () => {
    // The one rule that stops "zone, wait, bulldoze" being a money printer.
    expect(
      buildingRefund({
        id: 1,
        zone: 'residential',
        cell: 0,
        w: 1,
        d: 1,
        facing: 0,
        level: 1,
        seed: 0,
        capacity: 2,
        occupancy: 1,
        bornTick: 0,
      }),
    ).toBe(0);
  });
});

describe('filters', () => {
  it('admits exactly one layer each, and everything under "all"', () => {
    for (const kind of ['road', 'zone', 'building'] as const) {
      expect(filterAdmits('all', kind)).toBe(true);
    }
    expect(filterAdmits('roads', 'road')).toBe(true);
    expect(filterAdmits('roads', 'zone')).toBe(false);
    expect(filterAdmits('zones', 'zone')).toBe(true);
    expect(filterAdmits('buildings', 'building')).toBe(true);
    expect(filterAdmits('buildings', 'road')).toBe(false);
  });

  it('ships every filter the tool options row offers', () => {
    expect([...BULLDOZE_FILTERS]).toEqual(['all', 'roads', 'zones', 'buildings']);
  });
});

describe('target resolution', () => {
  it('finds the road under a point on its carriageway and nothing beside it', () => {
    const { sim } = cityWithRoad();
    const half = ROAD_CLASSES.small.totalWidth / 2;
    expect(roadAt(sim.roads, 0, 0)).not.toBeNull();
    expect(roadAt(sim.roads, 0, half - 1)).not.toBeNull();
    expect(roadAt(sim.roads, 0, half + 4)).toBeNull();
    // Past the end of the segment, not merely past its side.
    expect(roadAt(sim.roads, 300, 0)).toBeNull();
  });

  it('covers the whole carriageway with the cells the frontage pass masked', () => {
    const { sim, edgeId } = cityWithRoad();
    const edge = sim.roads.edge(edgeId);
    const cells = roadFootprintCells(sim.roads, edge as never);
    expect(cells.length).toBeGreaterThan(0);
    for (const k of cells) expect(sim.zoning.isRoadCell(k)).toBe(true);
  });

  it('reports empty ground as no target at all', () => {
    const { world } = cityWithRoad();
    expect(resolveBulldozeTarget(world, 900, 900)).toBeNull();
  });

  it('prefers the road over the paint beside it, and the filter can invert that', () => {
    const { sim, world, edgeId } = cityWithRoad();
    new ZoneTool({ zoning: sim.zoning }).paintStroke(-90, 14, 90, 14, 'residential');
    expect(sim.zoning.counts().residential).toBeGreaterThan(0);

    // Over the carriageway: the road wins.
    const onRoad = resolveBulldozeTarget(world, 0, 0);
    expect(onRoad?.kind).toBe('road');
    expect(onRoad?.id).toBe(edgeId);

    // Over the painted verge: there is no road there, so the paint answers.
    const onPaint = resolveBulldozeTarget(world, 0, 14);
    expect(onPaint?.kind).toBe('zone');
    expect(onPaint?.refund).toBe(zoneRefund(onPaint?.cells.length ?? 0));

    // A zones-only filter aimed straight down at the carriageway finds nothing
    // rather than falling through to the road: cells under asphalt are skipped.
    expect(resolveBulldozeTarget(world, 0, 0, 'zones', 0)).toBeNull();
  });

  it('puts the building ahead of the road and the paint under it', () => {
    const sim = new Simulation(7, { bounds: 2048 });
    sim.roads.setSampler({ heightAt: () => 10 });
    sim.addSystem(new ZoningSystem(sim.zoning));
    const demand = new DemandSystem(sim.buildings, sim.state);
    sim.addSystem(demand);
    sim.addSystem(
      new GrowthSystem({
        zoning: sim.zoning,
        buildings: sim.buildings,
        demand,
        roads: sim.roads,
        seed: 7,
      }),
    );
    sim.roads.placeSegment(-120, 0, 120, 0);
    sim.step(0);
    new ZoneTool({ zoning: sim.zoning }).paintStroke(-110, 14, 110, 14, 'residential');
    for (let tick = 1; tick <= 200; tick++) sim.step(tick);
    expect(sim.buildings.count).toBeGreaterThan(0);

    const building = sim.buildings.items[0] as { id: number; cell: number };
    const world = { roads: sim.roads, zoning: sim.zoning, buildings: sim.buildings };
    const centre = building.cell;
    const x = (centre % 512) * 8 - 2048 + 4;
    const z = Math.floor(centre / 512) * 8 - 2048 + 4;

    const target = resolveBulldozeTarget(world, x, z);
    expect(target?.kind).toBe('building');
    expect(target?.id).toBe(building.id);
    expect(target?.refund).toBe(0);

    // The zoning under it is still reachable through the filter.
    expect(resolveBulldozeTarget(world, x, z, 'zones')?.kind).toBe('zone');
  });
});

describe('applying a bulldoze', () => {
  it('removes the road and credits the ledger, never state.money directly', () => {
    const { sim, world } = cityWithRoad();
    const before = sim.state.money;
    const target = resolveBulldozeTarget(world, 0, 0);
    expect(target?.kind).toBe('road');

    expect(applyBulldoze(world, target as never, sim.ledger)).toBe(true);
    expect(sim.roads.edges).toHaveLength(0);
    expect(sim.state.money).toBe(before + (target as { refund: number }).refund);
    // The credit landed on the refund line, so the monthly panel can explain it.
    expect(sim.ledger.month.refund).toBe((target as { refund: number }).refund);
  });

  it('drops the nodes a removed segment left with nothing attached', () => {
    const { sim, world } = cityWithRoad();
    expect(sim.roads.nodes).toHaveLength(2);
    applyBulldoze(world, resolveBulldozeTarget(world, 0, 0) as never, sim.ledger);
    expect(sim.roads.nodes).toHaveLength(0);
  });

  it('re-prices a zone patch on what actually changed', () => {
    const { sim, world } = cityWithRoad();
    new ZoneTool({ zoning: sim.zoning }).paintStroke(-90, 14, 90, 14, 'commercial');
    const target = resolveBulldozeTarget(world, 0, 14, 'zones', 2);
    expect(target?.cells.length).toBeGreaterThan(0);

    // Clear it out from under the target, then apply: the refund must follow
    // reality rather than the stale hover.
    sim.zoning.paintCells(target?.cells ?? [], 'none');
    const before = sim.state.money;
    expect(applyBulldoze(world, target as never, sim.ledger)).toBe(false);
    expect(sim.state.money).toBe(before);
  });

  it('leaves buildings beside a removed road to the growth system', () => {
    // Removing a road does not demolish anything itself — stranding does, on the
    // next tick, so demolition stays on one schedule with one animation.
    const { sim, world } = cityWithRoad();
    new ZoneTool({ zoning: sim.zoning }).paintStroke(-90, 14, 90, 14, 'residential');
    const painted = sim.zoning.counts().residential;
    applyBulldoze(world, resolveBulldozeTarget(world, 0, 0) as never, sim.ledger);
    sim.zoning.rebuildFrontage();
    // The paint survives — it is stranded, not erased, so re-laying the road
    // restores the player's work.
    expect(sim.zoning.counts().residential).toBe(painted);
    expect(sim.zoning.isStranded(cellAt(0, 14))).toBe(true);
  });
});

describe('BulldozeTool', () => {
  it('prices a hover without changing anything, then commits on click', () => {
    const { sim, world } = cityWithRoad();
    const statuses: string[] = [];
    const tool = new BulldozeTool({
      world,
      budget: sim.ledger,
      onStatus: (status) => statuses.push(status.message),
    });

    const hovered = tool.hover(0, 0);
    expect(hovered?.kind).toBe('road');
    expect(sim.roads.edges).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toContain('refund');

    const before = sim.state.money;
    const removed = tool.demolishAt(0, 0);
    expect(removed?.kind).toBe('road');
    expect(sim.roads.edges).toHaveLength(0);
    expect(sim.state.money).toBeGreaterThan(before);
    // The highlight re-resolves after the edit rather than pointing at a ghost.
    expect(tool.target).toBeNull();
  });

  it('feeds the highlight through the same preview target the zone tool uses', () => {
    const { sim, world } = cityWithRoad();
    let lastCells = 0;
    let lastPaint = '';
    const tool = new BulldozeTool({
      world,
      budget: sim.ledger,
      preview: {
        setZonePreview: (cells, paint) => {
          lastCells = cells.length;
          lastPaint = paint;
        },
      },
    });
    tool.hover(0, 0);
    expect(lastCells).toBeGreaterThan(0);
    // 'none' is the de-zone brush, drawn in the overlay's rejection red.
    expect(lastPaint).toBe('none');

    tool.hover(900, 900);
    expect(lastCells).toBe(0);
  });

  it('narrows to one layer and resizes its zoning brush from the keyboard', () => {
    const { sim, world } = cityWithRoad();
    new ZoneTool({ zoning: sim.zoning }).paintStroke(-90, 14, 90, 14, 'industrial');
    const tool = new BulldozeTool({ world, budget: sim.ledger, filter: 'zones' });

    tool.hover(0, 14);
    const narrow = tool.target?.cells.length ?? 0;
    expect(narrow).toBeGreaterThan(0);

    tool.onKey('BracketRight');
    tool.onKey('BracketRight');
    expect(tool.brushRadius).toBe(3);
    expect(tool.target?.cells.length ?? 0).toBeGreaterThan(narrow);

    // The zones filter refuses to eat the road even when pointed straight at
    // it: a single-cell brush over the carriageway resolves to nothing.
    tool.setBrushRadius(0);
    tool.hover(0, 0);
    expect(tool.target).toBeNull();
    expect(tool.demolishAt(0, 0)).toBeNull();
    expect(sim.roads.edges).toHaveLength(1);
  });

  it('right-click clears the highlight and never destroys anything', () => {
    const { sim, world } = cityWithRoad();
    const tool = new BulldozeTool({ world, budget: sim.ledger });
    tool.onPointerMove({ x: 0, y: 10, z: 0 });
    expect(tool.target).not.toBeNull();
    tool.onPointerDown({ x: 0, y: 10, z: 0 }, 2);
    expect(tool.target).toBeNull();
    expect(sim.roads.edges).toHaveLength(1);
  });

  it('demolishes on a left press through the tool contract', () => {
    const { sim, world } = cityWithRoad();
    const tool = new BulldozeTool({ world, budget: sim.ledger });
    tool.onPointerDown({ x: 0, y: 10, z: 0 }, 0);
    expect(sim.roads.edges).toHaveLength(0);
  });

  it('goes quiet when it is deactivated', () => {
    const { sim, world } = cityWithRoad();
    let cells = -1;
    let message = 'x';
    const tool = new BulldozeTool({
      world,
      budget: sim.ledger,
      preview: { setZonePreview: (c) => (cells = c.length) },
      onStatus: (status) => (message = status.message),
    });
    tool.hover(0, 0);
    tool.deactivate();
    expect(cells).toBe(0);
    expect(message).toBe('');
  });
});
