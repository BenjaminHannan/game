/**
 * RCI demand maths: the "Population/jobs" and "Demand" sections of the
 * `docs/research/simulation.md` §9 test plan, plus the vacancy brake that
 * `docs/research/cs2/demand-growth.md`'s v1 adoption list adds on top.
 *
 * `test/growth.test.ts` already covers demand from the growth tick's side (the
 * bootstrap floor, the empty-city NaN guard, population derivation). These are
 * the couplings themselves, driven from hand-built building lists so each ratio
 * can be checked in isolation.
 */
import { describe, expect, it } from 'vitest';
import {
  DEMAND_TUNING,
  DemandSystem,
  FixedDemand,
  createCityTotals,
  createDemandState,
  normalizeDemandState,
} from '../src/sim/demand.js';
import { Simulation } from '../src/sim/state.js';
import { lotCapacity, type BuildingData } from '../src/sim/buildings.js';
import type { ZoneType } from '../src/sim/zoning.js';

const FLAT = { heightAt: (): number => 10 };

/** A cell far enough inside the grid that no footprint runs off an edge. */
const CENTRE_CELL = 200 * 512 + 200;

function makeSim(): Simulation {
  return new Simulation(20260101, { sampler: FLAT, bounds: 2048 });
}

/** Append `count` buildings of one zone at a fixed occupancy. */
function populate(
  sim: Simulation,
  zone: ZoneType,
  count: number,
  occupancy: number,
  capacity?: number,
): void {
  for (let i = 0; i < count; i++) {
    const building: BuildingData = {
      id: sim.state.buildings.nextId++,
      zone,
      cell: CENTRE_CELL + sim.state.buildings.items.length * 512 * 4,
      w: 1,
      d: 1,
      facing: 0,
      level: 1,
      seed: i,
      capacity: capacity ?? lotCapacity(zone, 1, 1, 1),
      occupancy,
      bornTick: 0,
    };
    sim.state.buildings.items.push(building);
  }
  sim.buildings.reindex();
}

describe('city totals', () => {
  it('reports zeroes and no NaN for an empty city', () => {
    const sim = makeSim();
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    demand.recount();
    for (const [key, value] of Object.entries(demand.totals)) {
      expect(Number.isFinite(value), key).toBe(true);
      expect(value, key).toBe(0);
    }
    expect(demand.totals).toEqual(createCityTotals());
  });

  it('derives residents and workforce from occupied households', () => {
    // simulation.md §9 pins this case: one R building, capacity 10, occupancy 1
    // gives 24 residents and a workforce of 13.
    const sim = makeSim();
    populate(sim, 'residential', 1, 1, 10);
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    demand.recount();

    expect(demand.totals.households).toBe(10);
    expect(demand.totals.householdsFilled).toBe(10);
    expect(demand.totals.residents).toBeCloseTo(24, 6);
    expect(demand.totals.workforce).toBeCloseTo(13.2, 6);
    expect(Math.round(demand.totals.workforce)).toBe(13);
    expect(demand.totals.vacancyResidential).toBeCloseTo(0, 6);
  });

  it('counts filled job slots and the goods they move', () => {
    const sim = makeSim();
    populate(sim, 'industrial', 2, 0.5, 10);
    populate(sim, 'commercial', 2, 1, 10);
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    demand.recount();

    expect(demand.totals.jobsIndustrial).toBe(20);
    expect(demand.totals.jobsCommercial).toBe(20);
    expect(demand.totals.jobsFilled).toBeCloseTo(10 + 20, 6);
    expect(demand.totals.goodsSupply).toBeCloseTo(10 * DEMAND_TUNING.goodsPerIndustrialJob, 6);
    expect(demand.totals.commercialThroughput).toBeCloseTo(
      20 * DEMAND_TUNING.goodsPerCommercialJob,
      6,
    );
    expect(demand.totals.buildingsIndustrial).toBe(2);
    expect(demand.totals.buildingsCommercial).toBe(2);
  });
});

describe('occupancy', () => {
  it('moves monotonically toward its target and never leaves [0,1]', () => {
    const sim = makeSim();
    // Homes with plenty of jobs to fill them: the target is above the floor and
    // occupancy has to climb to it.
    populate(sim, 'residential', 4, 0, 8);
    populate(sim, 'commercial', 4, 1, 8);
    const demand = new DemandSystem(sim.buildings, sim.state, 1);

    const homes = sim.buildings.items.filter((b) => b.zone === 'residential');
    let previous = 0;
    for (let t = 0; t < 40; t++) {
      demand.step(sim.state, t);
      const now = (homes[0] as BuildingData).occupancy;
      expect(now).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(now).toBeGreaterThanOrEqual(0);
      expect(now).toBeLessThanOrEqual(1);
      previous = now;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it('never moves an occupancy by more than the daily rate', () => {
    const sim = makeSim();
    populate(sim, 'residential', 2, 0, 8);
    populate(sim, 'industrial', 2, 1, 20);
    const demand = new DemandSystem(sim.buildings, sim.state, 1);

    const home = sim.buildings.items[0] as BuildingData;
    for (let t = 0; t < 20; t++) {
      const before = home.occupancy;
      demand.step(sim.state, t);
      expect(Math.abs(home.occupancy - before)).toBeLessThanOrEqual(
        DEMAND_TUNING.occupancyRate + 1e-9,
      );
    }
  });

  it('empties buildings again when the city loses the jobs that filled them', () => {
    const sim = makeSim();
    populate(sim, 'residential', 4, 1, 8);
    populate(sim, 'commercial', 4, 1, 8);
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    for (let t = 0; t < 40; t++) demand.step(sim.state, t);
    const withJobs = demand.totals.householdsFilled;

    // Bulldoze the workplaces; homes must fall back toward the base floor.
    for (const shop of sim.buildings.items.filter((b) => b.zone === 'commercial')) {
      sim.buildings.remove(shop.id);
    }
    for (let t = 0; t < 60; t++) demand.step(sim.state, t + 100);
    expect(demand.totals.householdsFilled).toBeLessThan(withJobs);
    expect(sim.state.population).toBeGreaterThan(0);
  });
});

describe('demand couplings', () => {
  it('drives C and I positive and R negative in a housing-only city', () => {
    const sim = makeSim();
    // Far past the bootstrap threshold, so the seed floor has faded out and the
    // couplings alone decide the bars.
    populate(sim, 'residential', 60, 1, 20);
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    for (let t = 0; t < 200; t++) demand.step(sim.state, t);

    expect(demand.totals.residents).toBeGreaterThan(DEMAND_TUNING.seedPopulation);
    // Residents want goods nobody sells and nobody makes.
    expect(sim.state.demand.c).toBeGreaterThan(0);
    expect(sim.state.demand.i).toBeGreaterThan(0);
    // And there are no jobs at all, so more housing is the last thing wanted.
    expect(sim.state.demand.r).toBeLessThan(0);
  });

  it('suppresses residential demand as citywide vacancy rises', () => {
    // Two cities with the same housing stock and the same jobs; only how full
    // the homes are differs. Occupancy is re-pinned after every pass so the
    // vacancy figure stays put while the smoothed bar settles.
    const settleAt = (occupancy: number): { r: number; vacancy: number } => {
      const sim = makeSim();
      populate(sim, 'residential', 20, occupancy, 20);
      populate(sim, 'commercial', 20, 1, 20);
      const demand = new DemandSystem(sim.buildings, sim.state, 1);
      for (let t = 0; t < 200; t++) {
        demand.step(sim.state, t);
        for (const b of sim.buildings.items) {
          b.occupancy = b.zone === 'residential' ? occupancy : 1;
        }
      }
      demand.recount();
      return { r: sim.state.demand.r, vacancy: demand.totals.vacancyResidential };
    };

    const tight = settleAt(0.98);
    const loose = settleAt(0.35);
    expect(tight.vacancy).toBeLessThan(DEMAND_TUNING.vacancyFloor);
    expect(loose.vacancy).toBeGreaterThan(DEMAND_TUNING.vacancyFloor);
    // High vacancy is the brake that stops overzoning from working: the bar
    // must be strictly lower, and must not be sitting at the same clamp.
    expect(loose.r).toBeLessThan(tight.r);
  });

  it('keeps the vacancy brake from deadlocking the bootstrap', () => {
    // An empty city has 100% vacancy by definition; the brake must not stop the
    // seed floor from starting it (demand-growth.md's explicit guardrail).
    const sim = makeSim();
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    for (let t = 0; t < 60; t++) demand.step(sim.state, t);
    expect(demand.totals.vacancyResidential).toBe(0);
    expect(sim.state.demand.r).toBeGreaterThan(0.5);
  });

  it('takes more than one day for a step change to reach 90% of its target', () => {
    const sim = makeSim();
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    // Start from a hand-set extreme and let the filter pull it to the empty
    // city's seeded target; the smoothing constant is what governs the pace.
    sim.state.demand.r = -1;
    const target = DEMAND_TUNING.seedDemand.r;
    demand.step(sim.state, 0);
    const afterOneDay = sim.state.demand.r;
    const travelled = (afterOneDay - -1) / (target - -1);
    expect(travelled).toBeCloseTo(DEMAND_TUNING.smoothing, 6);
    expect(travelled).toBeLessThan(0.9);

    let days = 1;
    while (sim.state.demand.r < -1 + 0.9 * (target - -1) && days < 100) {
      demand.step(sim.state, days++);
    }
    expect(days).toBeGreaterThan(1);
    expect(days).toBeLessThan(100);
  });

  it('stays clamped and finite under adversarial inputs', () => {
    const sim = makeSim();
    // Zero residents, absurd job capacity, and a hand-corrupted starting state.
    populate(sim, 'industrial', 5, 1, 1e9);
    populate(sim, 'commercial', 5, 0, 1e9);
    sim.state.demand.r = 42;
    sim.state.demand.c = Number.NaN;
    sim.state.demand.i = -99;

    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    for (let t = 0; t < 120; t++) demand.step(sim.state, t);

    for (const key of ['r', 'c', 'i'] as const) {
      const value = sim.state.demand[key];
      expect(Number.isFinite(value), key).toBe(true);
      expect(value, key).toBeGreaterThanOrEqual(-1);
      expect(value, key).toBeLessThanOrEqual(1);
    }
    expect(Number.isFinite(sim.state.population)).toBe(true);
  });

  it('grows nothing in a city with no roads, whatever demand says', () => {
    // Demand is an input to growth, never a substitute for frontage: with no
    // road there is no zonable cell, so a pinned maximum still grows nothing.
    const sim = makeSim();
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    for (let t = 0; t < 40; t++) demand.step(sim.state, t);
    expect(sim.state.demand.r).toBeGreaterThan(0);
    expect(sim.roads.edges).toHaveLength(0);
    expect(sim.buildings.count).toBe(0);
  });
});

describe('demand state plumbing', () => {
  it('clamps and repairs an untrusted branch', () => {
    expect(normalizeDemandState(undefined)).toEqual(createDemandState());
    expect(normalizeDemandState({ r: 47, c: -47, i: Number.NaN })).toEqual({
      r: 1,
      c: -1,
      i: 0,
    });
  });

  it('lets a fixed source stand in for the model', () => {
    const fixed = new FixedDemand({ r: 5, c: -5 });
    expect(fixed.demand).toEqual({ r: 1, c: -1, i: 0 });
    fixed.set({ i: 0.5 });
    expect(fixed.demand.i).toBe(0.5);
    expect(fixed.demand.r).toBe(1);
  });

  it('picks up a demand object replaced wholesale by a save load', () => {
    const sim = makeSim();
    const demand = new DemandSystem(sim.buildings, sim.state, 1);
    sim.state.demand = { r: 0.25, c: 0, i: 0 };
    expect(demand.demand.r).toBe(0.25);
    demand.step(sim.state, 0);
    expect(sim.state.demand.r).not.toBe(0.25);
  });
});
