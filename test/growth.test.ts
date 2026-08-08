/**
 * Building growth: lot formation, the demand-driven growth tick, demolition of
 * stranded and de-zoned lots, the demand placeholder, the procedural massing
 * grammar, the instanced renderer and the save round-trip.
 *
 * Everything is headless — no WebGL context, no DOM — including the renderer
 * block, which builds `InstancedMesh` objects but never draws them.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SaveManager } from '../src/core/save.js';
import { Simulation, ZoningSystem } from '../src/sim/state.js';
import type { HeightSampler } from '../src/sim/roads.js';
import {
  NO_OCCUPANT,
  ZONE_CELL_COUNT,
  cellAt,
  cellCentreX,
  cellCentreZ,
  type CellKey,
  type ZonePaint,
  type ZoneType,
  type ZoningState,
} from '../src/sim/zoning.js';
import {
  BuildingStore,
  ZONE_RULES,
  createBuildingsData,
  findLot,
  footprintCells,
  lotCapacity,
  normalizeBuildingsData,
  type BuildingData,
  type BuildingsData,
} from '../src/sim/buildings.js';
import {
  DEMAND_TUNING,
  DemandSystem,
  FixedDemand,
  createDemandState,
  normalizeDemandState,
  type DemandState,
} from '../src/sim/demand.js';
import {
  CANDIDATE_ATTEMPTS,
  GROWTH_SPAWN_BUDGET,
  GrowthSystem,
  type GrowthEvents,
} from '../src/sim/growth.js';
import {
  MAX_BOXES_PER_BUILDING,
  ZONE_STYLES,
  buildingShape,
} from '../src/render/buildingShape.js';
import { BUILDING_LIFT, BuildingRenderer, growScale } from '../src/render/buildingMesh.js';

/** Ground at a constant elevation, well above the water line. */
function flat(height = 10): HeightSampler {
  return { heightAt: () => height };
}

/** A simulation on flat ground with one 400 m east-west road through the origin. */
function city(seed = 4242): Simulation {
  const sim = new Simulation(seed, { sampler: flat(), bounds: 2048 });
  sim.roads.placeSegment(-200, 0, 200, 0);
  sim.zoning.rebuildFrontage();
  return sim;
}

/**
 * Paint every paintable cell whose centre falls in a world rectangle.
 * Direct, so the tests exercise growth rather than the zone tool's gesture.
 */
function paintRect(
  zoning: ZoningState,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  paint: ZonePaint,
): number {
  const cells: CellKey[] = [];
  for (let k = 0; k < ZONE_CELL_COUNT; k++) {
    if ((zoning.frontage[k] as number) < 0) continue;
    const x = cellCentreX(k);
    const z = cellCentreZ(k);
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    cells.push(k);
  }
  return zoning.paintCells(cells, paint);
}

/** A growth system over a simulation, with demand pinned. */
function growthOver(sim: Simulation, demand: Partial<DemandState>, seed = 7): {
  growth: GrowthSystem;
  demand: FixedDemand;
  events: Array<keyof GrowthEvents>;
} {
  const fixed = new FixedDemand(demand);
  const events: Array<keyof GrowthEvents> = [];
  const growth = new GrowthSystem({
    zoning: sim.zoning,
    buildings: sim.buildings,
    demand: fixed,
    roads: sim.roads,
    seed,
    events: { emit: (event) => void events.push(event) },
  });
  return { growth, demand: fixed, events };
}

/** Every cell every building claims, as a flat list. */
function allCells(store: BuildingStore): CellKey[] {
  const out: CellKey[] = [];
  for (const b of store.items) out.push(...footprintCells(b.cell, b.w, b.d, b.facing));
  return out;
}

describe('lot formation', () => {
  it('finds a lot on painted frontage and reports a footprint that fits', () => {
    const sim = city();
    paintRect(sim.zoning, -100, 100, 4, 40, 'residential');

    const seed = cellAt(0, 12);
    expect(sim.zoning.depth[seed]).toBe(0);
    const lot = findLot(sim.zoning, seed);
    expect(lot).not.toBeNull();
    const found = lot as NonNullable<typeof lot>;
    expect(found.zone).toBe('residential');
    expect(found.cells).toHaveLength(found.width * found.depth);
    expect(new Set(found.cells).size).toBe(found.cells.length);
    // Every cell of the lot is painted residential and vacant.
    for (const k of found.cells) {
      expect(sim.zoning.zoneAt(k)).toBe('residential');
      expect(sim.zoning.occupantAt(k)).toBe(NO_OCCUPANT);
    }
  });

  it('never exceeds the per-zone width and depth caps', () => {
    for (const zone of ['residential', 'commercial', 'industrial'] as const) {
      const sim = city();
      // A generous painted block: wider and deeper than any cap.
      paintRect(sim.zoning, -160, 160, 4, 40, zone);
      const lot = findLot(sim.zoning, cellAt(0, 12));
      expect(lot).not.toBeNull();
      const found = lot as NonNullable<typeof lot>;
      const rule = ZONE_RULES[zone];
      expect(found.width).toBeLessThanOrEqual(rule.maxWidth);
      expect(found.depth).toBeLessThanOrEqual(rule.maxDepth);
      expect(found.width).toBeGreaterThanOrEqual(1);
      expect(found.depth).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects seeds that are unpainted, occupied, or behind the verge', () => {
    const sim = city();
    paintRect(sim.zoning, -100, 100, 4, 40, 'commercial');

    // Unpainted: a cell well away from the painted strip.
    expect(findLot(sim.zoning, cellAt(600, 12))).toBeNull();
    // Behind the verge: depth 1 is not a frontage cell.
    const behind = cellAt(0, 20);
    expect(sim.zoning.depth[behind]).toBe(1);
    expect(findLot(sim.zoning, behind)).toBeNull();
    // Occupied.
    const seed = cellAt(0, 12);
    const lot = findLot(sim.zoning, seed) as NonNullable<ReturnType<typeof findLot>>;
    sim.buildings.add(lot, 1, 0);
    expect(findLot(sim.zoning, seed)).toBeNull();
  });

  it('finds the same lot regardless of which cell of the run seeds it', () => {
    const sim = city();
    // Exactly two frontage cells wide, so the residential cap is the whole run.
    paintRect(sim.zoning, -4, 12, 4, 20, 'residential');
    const a = findLot(sim.zoning, cellAt(-4, 12));
    const b = findLot(sim.zoning, cellAt(4, 12));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((b as NonNullable<typeof b>).originKey).toBe((a as NonNullable<typeof a>).originKey);
    expect((b as NonNullable<typeof b>).width).toBe((a as NonNullable<typeof a>).width);
  });

  it('prices capacity off lot area and level', () => {
    expect(lotCapacity('residential', 2, 2, 1)).toBe(ZONE_RULES.residential.capacityPerCell * 4);
    // The reserved level curve doubles capacity at level 5.
    expect(lotCapacity('commercial', 1, 1, 5)).toBe(
      Math.round(ZONE_RULES.commercial.capacityPerCell * 2),
    );
  });
});

describe('growth tick', () => {
  it('grows buildings on zoned cells and claims each cell exactly once', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    const { growth, events } = growthOver(sim, { r: 1 });

    const passes = 30;
    let grown = 0;
    for (let i = 0; i < passes; i++) grown += growth.growthTick(i * 10);

    expect(grown).toBeGreaterThan(0);
    expect(sim.buildings.count).toBe(grown);
    // The budget is a hard ceiling per pass.
    expect(grown).toBeLessThanOrEqual(GROWTH_SPAWN_BUDGET * passes);
    expect(events.filter((e) => e === 'zoning:grew')).toHaveLength(grown);

    const cells = allCells(sim.buildings);
    expect(new Set(cells).size).toBe(cells.length);
    for (const b of sim.buildings.items) {
      expect(b.zone).toBe('residential');
      expect(b.level).toBe(1);
      expect(b.capacity).toBeGreaterThan(0);
      for (const k of footprintCells(b.cell, b.w, b.d, b.facing)) {
        expect(sim.zoning.occupantAt(k)).toBe(b.id);
      }
    }
  });

  it('grows nothing at zero demand, and nothing on unzoned frontage', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    const { growth } = growthOver(sim, { r: 0, c: 0, i: 0 });
    for (let i = 0; i < 20; i++) growth.growthTick(i * 10);
    expect(sim.buildings.count).toBe(0);

    // Frontage without paint grows nothing even at full demand.
    const bare = city();
    const bareGrowth = growthOver(bare, { r: 1, c: 1, i: 1 }).growth;
    expect(bare.zoning.zonableCells).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) bareGrowth.growthTick(i * 10);
    expect(bare.buildings.count).toBe(0);
  });

  it('grows nothing without a road, however much is painted', () => {
    const sim = new Simulation(9, { sampler: flat(), bounds: 2048 });
    sim.zoning.rebuildFrontage();
    // No frontage exists, so paint cannot even be applied — the hard
    // precondition is owned by zoning, not by demand.
    expect(paintRect(sim.zoning, -200, 200, -200, 200, 'residential')).toBe(0);
    const { growth } = growthOver(sim, { r: 1, c: 1, i: 1 });
    for (let i = 0; i < 20; i++) growth.growthTick(i * 10);
    expect(sim.buildings.count).toBe(0);
  });

  it('splits the budget across zones in proportion to demand', () => {
    const sim = city();
    paintRect(sim.zoning, -180, -20, 4, 40, 'residential');
    paintRect(sim.zoning, 20, 180, 4, 40, 'industrial');
    const { growth } = growthOver(sim, { r: 1, c: 0, i: 1 });
    for (let i = 0; i < 40; i++) growth.growthTick(i * 10);

    const kinds = { residential: 0, commercial: 0, industrial: 0 };
    for (const b of sim.buildings.items) kinds[b.zone]++;
    expect(kinds.residential).toBeGreaterThan(0);
    expect(kinds.industrial).toBeGreaterThan(0);
    expect(kinds.commercial).toBe(0);
  });

  it('spends its whole per-pass budget when demand and candidates allow', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    // Land value peaks at the network centroid, so the origin block rolls
    // through reliably; a run of passes must hit the ceiling at least once.
    const { growth } = growthOver(sim, { r: 1 });
    let best = 0;
    for (let i = 0; i < 20; i++) best = Math.max(best, growth.growthTick(i * 10));
    expect(best).toBe(GROWTH_SPAWN_BUDGET);
    expect(best).toBeLessThanOrEqual(CANDIDATE_ATTEMPTS * GROWTH_SPAWN_BUDGET);
  });
});

describe('demolition', () => {
  it('condemns a building whose cells were de-zoned, and frees them', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    const { growth, events } = growthOver(sim, { r: 1 });
    for (let i = 0; i < 20; i++) growth.growthTick(i * 10);
    expect(sim.buildings.count).toBeGreaterThan(0);

    const victim = sim.buildings.items[0] as BuildingData;
    const cells = footprintCells(victim.cell, victim.w, victim.d, victim.facing);
    expect(sim.zoning.paintCells(cells, 'none')).toBeGreaterThan(0);
    expect(sim.buildings.isViable(victim)).toBe(false);

    // Bounded, not instant: the queue drains a couple per pass.
    let ticks = 0;
    while (sim.buildings.get(victim.id) && ticks < 200) {
      growth.growthTick(1000 + ticks * 10);
      ticks++;
    }
    expect(sim.buildings.get(victim.id)).toBeNull();
    expect(events).toContain('zoning:demolished');
    for (const k of cells) expect(sim.zoning.occupantAt(k)).toBe(NO_OCCUPANT);
  });

  it('condemns buildings stranded by a deleted road', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'commercial');
    const { growth } = growthOver(sim, { c: 1 });
    for (let i = 0; i < 30; i++) growth.growthTick(i * 10);
    const before = sim.buildings.count;
    expect(before).toBeGreaterThan(0);

    for (const edge of [...sim.roads.edges]) sim.roads.removeEdge(edge.id);
    sim.zoning.rebuildIfStale();
    // Paint survives a road deletion; the buildings on it do not.
    expect(sim.zoning.counts().commercial).toBeGreaterThan(0);

    for (let i = 0; i < 400 && sim.buildings.count > 0; i++) growth.growthTick(2000 + i * 10);
    expect(sim.buildings.count).toBe(0);
    for (let k = 0; k < ZONE_CELL_COUNT; k++) expect(sim.zoning.occupant[k]).toBe(NO_OCCUPANT);
  });

  it('re-checks the queue and spares a building that is still viable', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    const { growth } = growthOver(sim, { r: 1 });
    growth.growthTick(0);
    const survivor = sim.buildings.items[0] as BuildingData;

    // Queueing is a request, not a verdict: the road could come back or the
    // paint could be restored between queueing and the queue draining.
    growth.scheduleDemolition(survivor.id);
    growth.scheduleDemolition(survivor.id);
    expect(growth.pendingDemolitions).toBe(1);
    expect(growth.processDemolitions(4)).toBe(0);
    expect(sim.buildings.get(survivor.id)).not.toBeNull();
    expect(growth.pendingDemolitions).toBe(0);
  });

  it('restores a demolished block to zonable, paintable ground', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    const { growth } = growthOver(sim, { r: 1 });
    for (let i = 0; i < 10; i++) growth.growthTick(i * 10);
    const victim = sim.buildings.items[0] as BuildingData;
    const cells = footprintCells(victim.cell, victim.w, victim.d, victim.facing);

    // De-zoning under a building is legal; re-zoning is not, until the
    // building has actually gone. That ordering is what stops the paint layer
    // and the occupancy map from disagreeing.
    sim.zoning.paintCells(cells, 'none');
    expect(sim.zoning.paintCells(cells, 'residential')).toBe(0);
    for (let i = 0; i < 200 && sim.buildings.get(victim.id); i++) growth.growthTick(1000 + i * 10);
    expect(sim.buildings.get(victim.id)).toBeNull();
    expect(sim.zoning.paintCells(cells, 'residential')).toBe(cells.length);
  });
});

describe('demand', () => {
  it('never produces NaN for an empty city', () => {
    const sim = new Simulation(1, { sampler: flat() });
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    for (let t = 0; t < 50; t++) demand.step(sim.state, t);
    for (const value of [sim.state.demand.r, sim.state.demand.c, sim.state.demand.i]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(sim.state.population).toBe(0);
  });

  it('floors demand while bootstrapping so the first zoned cells always grow', () => {
    const sim = new Simulation(1, { sampler: flat() });
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    for (let t = 0; t < 60; t++) demand.step(sim.state, t);
    expect(sim.state.demand.r).toBeGreaterThan(0.5);
    expect(sim.state.demand.i).toBeGreaterThan(0.2);
  });

  it('fills buildings and derives population from occupied households', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    const { growth } = growthOver(sim, { r: 1 });
    for (let i = 0; i < 20; i++) growth.growthTick(i * 10);

    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    for (let t = 0; t < 60; t++) demand.step(sim.state, t);

    expect(demand.totals.households).toBeGreaterThan(0);
    expect(demand.totals.householdsFilled).toBeGreaterThan(0);
    expect(sim.state.population).toBeGreaterThan(0);
    expect(sim.state.population).toBe(Math.round(demand.totals.residents));
    // With no workplaces the base occupancy floor is the ceiling.
    for (const b of sim.buildings.items) {
      expect(b.occupancy).toBeLessThanOrEqual(DEMAND_TUNING.residentialBaseOccupancy + 1e-9);
    }
  });

  it('suppresses residential demand as vacancy rises', () => {
    // Two identical cities of homes; the second has its homes standing empty.
    const build = (occupancy: number): DemandSystem => {
      const sim = new Simulation(3, { sampler: flat() });
      const store = sim.buildings;
      const zoning = sim.zoning;
      for (let i = 0; i < 20; i++) {
        store.add(
          {
            zone: 'residential',
            originKey: 100 + i * 4,
            width: 1,
            depth: 1,
            facing: 0,
            edgeId: 1,
            cells: [100 + i * 4],
          },
          i,
          0,
        );
      }
      void zoning;
      for (const b of store.items) b.occupancy = occupancy;
      const demand = new DemandSystem(store, sim.state, 1);
      demand.recount();
      return demand;
    };

    const full = build(1);
    const empty = build(0);
    expect(full.totals.vacancyResidential).toBeCloseTo(0, 6);
    expect(empty.totals.vacancyResidential).toBeCloseTo(1, 6);
  });

  it('normalizes a corrupt demand branch instead of throwing', () => {
    expect(normalizeDemandState(undefined)).toEqual(createDemandState());
    expect(normalizeDemandState({ r: Number.NaN, c: 12, i: '3' })).toEqual({
      r: 0,
      c: 1,
      i: 0,
    });
  });
});

describe('determinism', () => {
  it('reproduces an identical city from the same seed and the same inputs', () => {
    const run = (): BuildingData[] => {
      const sim = city(31337);
      paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
      paintRect(sim.zoning, -180, 180, -40, -4, 'commercial');
      const { growth } = growthOver(sim, { r: 0.8, c: 0.6, i: 0.2 }, 555);
      for (let i = 0; i < 120; i++) growth.growthTick(i * 10);
      return sim.buildings.items.map((b) => ({ ...b }));
    };

    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
    // Seeds are saved, so appearance is reproducible too.
    expect(a.map((x) => x.seed)).toEqual(b.map((x) => x.seed));
  });

  it('produces a different city from a different seed', () => {
    const run = (seed: number): number[] => {
      const sim = city(31337);
      paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
      const { growth } = growthOver(sim, { r: 0.5 }, seed);
      for (let i = 0; i < 60; i++) growth.growthTick(i * 10);
      return sim.buildings.items.map((x) => x.cell);
    };
    expect(run(1)).not.toEqual(run(2));
  });
});

describe('save round-trip', () => {
  function grownCity(): { sim: Simulation; saves: SaveManager } {
    const saves = new SaveManager(null);
    const sim = city(2026);
    sim.registerWith(saves);
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    paintRect(sim.zoning, -180, 180, -40, -4, 'industrial');
    const { growth } = growthOver(sim, { r: 1, i: 1 });
    for (let i = 0; i < 60; i++) growth.growthTick(i * 10);
    sim.state.demand = { r: 0.4, c: -0.2, i: 0.7 };
    return { sim, saves };
  }

  it('restores buildings and rebuilds occupancy in a fresh simulation', () => {
    const { sim, saves } = grownCity();
    expect(sim.buildings.count).toBeGreaterThan(5);
    const json = saves.saveToString();

    const target = new Simulation(1, { sampler: flat(), bounds: 2048 });
    const targetSaves = new SaveManager(null);
    target.registerWith(targetSaves);
    targetSaves.loadFromString(json);

    expect(target.buildings.items).toEqual(sim.buildings.items);
    expect(target.state.buildings.nextId).toBe(sim.state.buildings.nextId);
    expect(target.state.demand).toEqual({ r: 0.4, c: -0.2, i: 0.7 });
    // `occupant` is derived: never saved, always rebuilt, and identical.
    expect(Array.from(target.zoning.occupant)).toEqual(Array.from(sim.zoning.occupant));
    expect(Array.from(target.zoning.zone)).toEqual(Array.from(sim.zoning.zone));
    for (const b of target.buildings.items) {
      for (const k of footprintCells(b.cell, b.w, b.d, b.facing)) {
        expect(target.zoning.occupantAt(k)).toBe(b.id);
      }
    }
  });

  it('survives a save, load and save cycle unchanged', () => {
    const { sim, saves } = grownCity();
    const first = saves.saveToString();
    saves.loadFromString(first);
    const second = saves.saveToString();
    expect(JSON.parse(second).data.sim.buildings).toEqual(JSON.parse(first).data.sim.buildings);
    void sim;
  });

  it('loads a pre-growth save as a city with no buildings', () => {
    const { sim, saves } = grownCity();
    const doc = JSON.parse(saves.saveToString()) as {
      version: number;
      data: { sim: Record<string, unknown> };
    };
    delete doc.data.sim.buildings;
    delete doc.data.sim.demand;
    doc.version = 2;
    saves.loadFromString(JSON.stringify(doc));

    expect(sim.buildings.count).toBe(0);
    expect(sim.state.demand).toEqual(createDemandState());
    for (let k = 0; k < ZONE_CELL_COUNT; k++) expect(sim.zoning.occupant[k]).toBe(NO_OCCUPANT);
  });

  it('advances a loaded city with the whole system pipeline', () => {
    const { saves } = grownCity();
    const json = saves.saveToString();

    const target = new Simulation(1, { sampler: flat(), bounds: 2048 });
    const targetSaves = new SaveManager(null);
    target.registerWith(targetSaves);
    target.addSystem(new ZoningSystem(target.zoning));
    const demand = new DemandSystem(target.buildings, target.state);
    target.addSystem(demand);
    target.addSystem(
      new GrowthSystem({
        zoning: target.zoning,
        buildings: target.buildings,
        demand,
        roads: target.roads,
        seed: 1,
      }),
    );
    targetSaves.loadFromString(json);

    const before = target.buildings.count;
    for (let t = 0; t < 400; t++) target.step(t);
    expect(target.buildings.count).toBeGreaterThanOrEqual(before);
    expect(target.state.population).toBeGreaterThan(0);
  });
});

describe('normalizeBuildingsData', () => {
  it('returns an empty list for anything unusable', () => {
    for (const input of [undefined, null, 0, 'x', [], {}, { items: 'no' }]) {
      const out = normalizeBuildingsData(input);
      expect(out.items).toEqual([]);
      expect(out.nextId).toBe(1);
    }
  });

  it('drops malformed records and repairs nextId', () => {
    const data = {
      nextId: 2,
      items: [
        { id: 5, zone: 'residential', cell: 1000, w: 2, d: 2, facing: 1, seed: 3, bornTick: 4 },
        { id: Number.NaN, zone: 'residential', cell: 2000, w: 1, d: 1, facing: 0 },
        { id: 6, zone: 'office', cell: 3000, w: 1, d: 1, facing: 0 },
        { id: 7, zone: 'commercial', cell: -1, w: 1, d: 1, facing: 0 },
        { id: 8, zone: 'commercial', cell: ZONE_CELL_COUNT + 5, w: 1, d: 1, facing: 0 },
        { id: 5, zone: 'commercial', cell: 9000, w: 1, d: 1, facing: 0 },
        'nonsense',
        null,
      ],
    };
    const out = normalizeBuildingsData(data);
    expect(out.items.map((b) => b.id)).toEqual([5]);
    // nextId is repaired past the highest surviving id.
    expect(out.nextId).toBe(6);
    const kept = out.items[0] as BuildingData;
    expect(kept.capacity).toBe(lotCapacity('residential', 2, 2, 1));
    expect(kept.occupancy).toBe(0);
  });

  it('clamps footprints to the zone caps and discards overlaps', () => {
    const out = normalizeBuildingsData({
      nextId: 1,
      items: [
        { id: 1, zone: 'residential', cell: 5000, w: 99, d: 99, facing: 0 },
        // Same origin: whatever the first record clamped to, this overlaps it.
        { id: 2, zone: 'residential', cell: 5000, w: 1, d: 1, facing: 0 },
      ],
    });
    expect(out.items).toHaveLength(1);
    const kept = out.items[0] as BuildingData;
    expect(kept.w).toBe(ZONE_RULES.residential.maxWidth);
    expect(kept.d).toBe(ZONE_RULES.residential.maxDepth);
  });

  it('discards records whose footprint runs off the grid', () => {
    // Bottom-left corner, facing -x: the footprint would step out of bounds.
    const out = normalizeBuildingsData({
      nextId: 1,
      items: [{ id: 1, zone: 'industrial', cell: 0, w: 4, d: 3, facing: 1 }],
    });
    expect(out.items).toEqual([]);
  });

  it('is idempotent', () => {
    const once = normalizeBuildingsData({
      nextId: 3,
      items: [{ id: 2, zone: 'commercial', cell: 40000, w: 2, d: 2, facing: 3, occupancy: 5 }],
    });
    expect(normalizeBuildingsData(once)).toEqual(once);
    expect((once.items[0] as BuildingData).occupancy).toBe(1);
  });

  it('keeps the store and the occupant array consistent through a reload', () => {
    const sim = city();
    const host: { buildings: BuildingsData } = { buildings: createBuildingsData() };
    const store = new BuildingStore(host, sim.zoning);
    paintRect(sim.zoning, -100, 100, 4, 40, 'residential');
    const lot = findLot(sim.zoning, cellAt(0, 12)) as NonNullable<ReturnType<typeof findLot>>;
    const building = store.add(lot, 11, 0);
    expect(store.count).toBe(1);

    store.load(normalizeBuildingsData(host.buildings));
    expect(store.count).toBe(1);
    for (const k of footprintCells(building.cell, building.w, building.d, building.facing)) {
      expect(sim.zoning.occupantAt(k)).toBe(building.id);
    }
    store.remove(building.id);
    expect(store.count).toBe(0);
    for (const k of lot.cells) expect(sim.zoning.occupantAt(k)).toBe(NO_OCCUPANT);
  });
});

describe('procedural massing', () => {
  it('is a pure function of seed, zone and lot size', () => {
    const a = buildingShape('commercial', 12345, 2, 2);
    const b = buildingShape('commercial', 12345, 2, 2);
    expect(b).toEqual(a);
    expect(buildingShape('commercial', 12346, 2, 2)).not.toEqual(a);
  });

  it('keeps every building within its budget and its footprint', () => {
    for (const zone of ['residential', 'commercial', 'industrial'] as ZoneType[]) {
      const rule = ZONE_RULES[zone];
      const style = ZONE_STYLES[zone];
      for (let seed = 0; seed < 200; seed++) {
        const w = 1 + (seed % rule.maxWidth);
        const d = 1 + (seed % rule.maxDepth);
        const shape = buildingShape(zone, seed * 7919, w, d);
        expect(shape.boxes.length).toBeGreaterThan(0);
        expect(shape.boxes.length).toBeLessThanOrEqual(MAX_BOXES_PER_BUILDING);
        expect(shape.height).toBeGreaterThanOrEqual(style.minHeight);
        for (const box of shape.boxes) {
          expect(box.width).toBeGreaterThan(0);
          expect(box.depth).toBeGreaterThan(0);
          expect(box.height).toBeGreaterThan(0);
          // Nothing overhangs the 8 m cell footprint it was given.
          expect(Math.abs(box.x) + box.width / 2).toBeLessThanOrEqual(w * 8 + 1e-6);
          expect(Math.abs(box.z) + box.depth / 2).toBeLessThanOrEqual(d * 8 + 1e-6);
        }
      }
    }
  });

  it('draws each zone from its own palette family', () => {
    // Residential greens are the only palette with a green-dominant entry, and
    // commercial blues the only blue-dominant one: a cheap guard against the
    // palettes being crossed by a future edit.
    const res = buildingShape('residential', 1, 1, 1).boxes[0] as { color: number };
    const com = buildingShape('commercial', 1, 1, 1).boxes[0] as { color: number };
    expect((com.color & 0xff) > ((com.color >> 16) & 0xff)).toBe(true);
    expect(((res.color >> 8) & 0xff) >= (res.color & 0xff)).toBe(true);
  });

  it('gives some residential lots a pitched roof and some industry an annex', () => {
    let roofs = 0;
    let annexes = 0;
    for (let seed = 0; seed < 300; seed++) {
      if (buildingShape('residential', seed, 1, 1).boxes.some((b) => b.role === 'roof')) roofs++;
      if (buildingShape('industrial', seed, 3, 2).boxes.some((b) => b.role === 'annex')) {
        annexes++;
      }
    }
    expect(roofs).toBeGreaterThan(50);
    expect(annexes).toBeGreaterThan(50);
    // Wide lots never get the house-shaped cap.
    for (let seed = 0; seed < 100; seed++) {
      expect(buildingShape('residential', seed, 2, 2).boxes.some((b) => b.role === 'roof')).toBe(
        false,
      );
    }
  });
});

describe('scale', () => {
  it('grows a city into the 1-2k budget and draws it in a handful of calls', () => {
    const sim = new Simulation(7, { sampler: flat(), bounds: 2048 });
    // A grid of streets, each within the max segment length.
    for (let i = 0; i < 26; i++) {
      const z = -900 + i * 72;
      sim.roads.placeSegment(-500, z, 0, z);
      sim.roads.placeSegment(0, z, 500, z);
    }
    sim.zoning.rebuildFrontage();

    // Paint the whole frontage in wide same-zone bands, so lots reach their
    // caps the way a real player's blocks do.
    const zones: ZoneType[] = ['residential', 'commercial', 'industrial'];
    const band: CellKey[][] = [[], [], []];
    let seen = 0;
    for (let k = 0; k < ZONE_CELL_COUNT; k++) {
      if ((sim.zoning.frontage[k] as number) < 0) continue;
      band[Math.floor(seen / 400) % 3]?.push(k);
      seen++;
    }
    for (let i = 0; i < 3; i++) sim.zoning.paintCells(band[i] as CellKey[], zones[i] as ZoneType);
    expect(seen).toBeGreaterThan(20000);

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
    // 12 000 ticks is ten minutes of unpaused play at speed 1.
    for (let t = 1; t <= 12000; t++) sim.step(t);

    expect(sim.buildings.count).toBeGreaterThan(1000);
    expect(sim.state.population).toBeGreaterThan(5000);
    const cells = allCells(sim.buildings);
    expect(new Set(cells).size).toBe(cells.length);
    // Demand settles rather than pinning at the bootstrap floor forever.
    expect(sim.state.demand.c).toBeLessThan(DEMAND_TUNING.seedDemand.c);

    const renderer = new BuildingRenderer(sim.buildings, flat());
    renderer.update(20000);
    expect(renderer.drawnBuildings).toBe(sim.buildings.count);
    expect(renderer.drawCalls).toBeLessThanOrEqual(4);
    renderer.dispose();
  });
});

describe('building renderer', () => {
  it('writes one instanced draw call per box role and lays pads on the ground', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    paintRect(sim.zoning, -180, 180, -40, -4, 'industrial');
    const { growth } = growthOver(sim, { r: 1, i: 1 });
    for (let i = 0; i < 40; i++) growth.growthTick(i * 10);
    expect(sim.buildings.count).toBeGreaterThan(10);

    const renderer = new BuildingRenderer(sim.buildings, flat());
    renderer.update(10000);
    expect(renderer.drawnBuildings).toBe(sim.buildings.count);
    expect(renderer.drawCalls).toBeGreaterThan(0);
    // The whole city is a handful of draw calls, which is the point.
    expect(renderer.drawCalls).toBeLessThanOrEqual(4);
    expect(renderer.instanceCount).toBeGreaterThanOrEqual(sim.buildings.count);

    const base = renderer.group.getObjectByName('Buildings:base') as THREE.InstancedMesh;
    expect(base.count).toBe(sim.buildings.count);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let i = 0; i < base.count; i++) {
      base.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.y).toBeCloseTo(10 + BUILDING_LIFT, 5);
    }
    renderer.dispose();
  });

  it('is free on a frame where nothing changed, and appends when it does', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    const { growth } = growthOver(sim, { r: 1 });
    growth.growthTick(0);

    const renderer = new BuildingRenderer(sim.buildings, flat());
    renderer.update(1000);
    const first = renderer.instanceCount;
    renderer.update(1000);
    expect(renderer.instanceCount).toBe(first);

    growth.growthTick(1010);
    renderer.update(2000);
    expect(renderer.drawnBuildings).toBe(sim.buildings.count);
    renderer.dispose();
  });

  it('rebuilds after a demolition rather than leaving a hole', () => {
    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    const { growth } = growthOver(sim, { r: 1 });
    for (let i = 0; i < 10; i++) growth.growthTick(i * 10);
    const renderer = new BuildingRenderer(sim.buildings, flat());
    renderer.update(10000);
    const before = renderer.drawnBuildings;
    expect(before).toBeGreaterThan(1);

    sim.buildings.remove((sim.buildings.items[0] as BuildingData).id);
    renderer.update(10001);
    expect(renderer.drawnBuildings).toBe(before - 1);
    const base = renderer.group.getObjectByName('Buildings:base') as THREE.InstancedMesh;
    expect(base.count).toBe(before - 1);
    renderer.dispose();
  });

  it('animates a grow-in and settles at full height', () => {
    expect(growScale(0, 0)).toBeLessThan(0.2);
    expect(growScale(100, 0)).toBe(1);
    expect(growScale(4, 0)).toBeGreaterThan(growScale(1, 0));

    const sim = city();
    paintRect(sim.zoning, -180, 180, 4, 40, 'residential');
    const { growth } = growthOver(sim, { r: 1 });
    growth.growthTick(0);

    const renderer = new BuildingRenderer(sim.buildings, flat());
    renderer.update(0);
    expect(renderer.growingCount).toBeGreaterThan(0);

    const base = renderer.group.getObjectByName('Buildings:base') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    base.getMatrixAt(0, matrix);
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    const young = scale.y;

    renderer.update(100);
    expect(renderer.growingCount).toBe(0);
    base.getMatrixAt(0, matrix);
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.y).toBeGreaterThan(young);
    renderer.dispose();
  });
});
