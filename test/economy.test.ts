/**
 * Money and cadence: the test plan of `docs/research/simulation.md` §9 for the
 * "Cadence", "Money", "Broke behaviour" and economy half of "Save" sections.
 *
 * No DOM is required for any of these, and none of them touch three.js.
 */
import { describe, expect, it } from 'vitest';
import {
  DAYS_PER_MONTH,
  TICKS_PER_DAY,
  TICKS_PER_MONTH,
  dateFromTick,
} from '../src/core/time.js';
import { SaveManager, SAVE_VERSION, type KeyValueStore } from '../src/core/save.js';
import { FixedStepAccumulator } from '../src/core/engine.js';
import {
  Cadence,
  Simulation,
  STARTING_MONEY,
  ZoningSystem,
  type GameState,
  type System,
  type TickContext,
} from '../src/sim/state.js';
import {
  CityLedger,
  ECONOMY_TUNING,
  EconomySystem,
  LEDGER_CATEGORIES,
  MAX_TAX_RATE,
  buildingTax,
  createEconomyState,
  netOf,
  normalizeEconomyState,
  roadRefund,
  type EconomySettledEvent,
} from '../src/sim/economy.js';
import { DemandSystem } from '../src/sim/demand.js';
import { GrowthSystem } from '../src/sim/growth.js';
import { ROAD_CLASSES, BULLDOZE_REFUND_FRACTION, type RoadClassId } from '../src/sim/roads.js';
import { lotCapacity, type BuildingData } from '../src/sim/buildings.js';
import type { ZoneType } from '../src/sim/zoning.js';

/** In-memory stand-in for `localStorage`. */
class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

/** Flat dry ground, high enough above sea level for roads to be buildable. */
const FLAT = { heightAt: (): number => 10 };

/** A simulation on flat, buildable ground. */
function makeSim(): Simulation {
  return new Simulation(20260101, { sampler: FLAT, bounds: 2048 });
}

/**
 * A cell well inside the 512x512 grid, so a multi-cell footprint cannot run off
 * an edge and be dropped by the building normalizer.
 */
const CENTRE_CELL = 200 * 512 + 200;

/** Append a building directly, bypassing lot finding. */
function addBuilding(
  sim: Simulation,
  zone: ZoneType,
  occupancy: number,
  overrides: Partial<BuildingData> = {},
): BuildingData {
  const w = overrides.w ?? 1;
  const d = overrides.d ?? 1;
  const level = overrides.level ?? 1;
  const building: BuildingData = {
    id: sim.state.buildings.nextId++,
    zone,
    cell: CENTRE_CELL + sim.state.buildings.items.length * 512 * 8,
    w,
    d,
    facing: 0,
    level,
    seed: 1,
    capacity: overrides.capacity ?? lotCapacity(zone, w, d, level),
    occupancy,
    bornTick: 0,
    ...overrides,
  };
  sim.state.buildings.items.push(building);
  return building;
}

/** Lay `count` straight segments of a class, returning their total length. */
function layRoads(sim: Simulation, count: number, cls: RoadClassId = 'small'): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    const z = i * 64 - 512;
    const edge = sim.roads.placeSegment(-256, z, 256 - 56, z, cls);
    if (edge) total += edge.length;
  }
  return total;
}

describe('cadence', () => {
  /** Records which ticks each bucket was invoked on. */
  class Recorder implements System {
    readonly ticks: number[] = [];
    readonly days: number[] = [];
    constructor(
      readonly id: string,
      readonly cadence: Cadence,
    ) {}
    step(_state: GameState, tick: number, ctx: TickContext): void {
      this.ticks.push(tick);
      this.days.push(ctx.days);
    }
  }

  it('fires daily systems once per 40 ticks and monthly once per 1200', () => {
    const sim = makeSim();
    const perTick = new Recorder('t', Cadence.Tick);
    const daily = new Recorder('d', Cadence.Daily);
    const monthly = new Recorder('m', Cadence.Monthly);
    sim.addSystem(perTick);
    sim.addSystem(daily);
    sim.addSystem(monthly);

    // Three in-game years, starting at tick 1 so the tick-0 boundary (which the
    // engine never emits) does not flatter the counts.
    const years = 3;
    const ticks = TICKS_PER_MONTH * 12 * years;
    for (let t = 1; t <= ticks; t++) sim.step(t);

    expect(perTick.ticks).toHaveLength(ticks);
    expect(daily.ticks).toHaveLength(ticks / TICKS_PER_DAY);
    expect(monthly.ticks).toHaveLength(ticks / TICKS_PER_MONTH);
    expect(monthly.ticks[0]).toBe(TICKS_PER_MONTH);
    for (const t of daily.ticks) expect(t % TICKS_PER_DAY).toBe(0);
    for (const t of monthly.ticks) expect(t % TICKS_PER_MONTH).toBe(0);
  });

  it('sums TickContext.days to the elapsed in-game days across a run', () => {
    const sim = makeSim();
    const perTick = new Recorder('t', Cadence.Tick);
    const daily = new Recorder('d', Cadence.Daily);
    const monthly = new Recorder('m', Cadence.Monthly);
    sim.addSystem(perTick);
    sim.addSystem(daily);
    sim.addSystem(monthly);

    const ticks = TICKS_PER_MONTH * 4;
    for (let t = 1; t <= ticks; t++) sim.step(t);
    const elapsedDays = ticks / TICKS_PER_DAY;
    const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

    expect(sum(perTick.days)).toBeCloseTo(elapsedDays, 6);
    expect(sum(daily.days)).toBeCloseTo(elapsedDays, 6);
    expect(sum(monthly.days)).toBeCloseTo(elapsedDays, 6);
    expect(monthly.days.every((d) => d === DAYS_PER_MONTH)).toBe(true);
  });

  it('exposes the in-game date and the month boundary through the context', () => {
    const sim = makeSim();
    const perTick = new Recorder('t', Cadence.Tick);
    sim.addSystem(perTick);

    sim.step(TICKS_PER_MONTH);
    const ctx = sim.context(Cadence.Tick);
    expect(ctx.monthBoundary).toBe(true);
    expect(ctx.dayBoundary).toBe(true);
    expect({ ...ctx.date }).toEqual(dateFromTick(TICKS_PER_MONTH));

    sim.step(TICKS_PER_MONTH + 1);
    expect(sim.context(Cadence.Tick).monthBoundary).toBe(false);
    expect(sim.context(Cadence.Tick).dayBoundary).toBe(false);
  });

  it('produces identical state at 1x and 4x over the same simulated span', () => {
    const build = (): Simulation => {
      const sim = makeSim();
      sim.addSystem(new ZoningSystem(sim.zoning));
      const demand = new DemandSystem(sim.buildings, sim.state, undefined, sim.state);
      sim.addSystem(demand);
      sim.addSystem(
        new GrowthSystem({
          zoning: sim.zoning,
          buildings: sim.buildings,
          demand,
          roads: sim.roads,
          treasury: sim.state,
          seed: 4242,
        }),
      );
      sim.addSystem(
        new EconomySystem({
          ledger: sim.ledger,
          buildings: sim.buildings,
          roads: sim.roads,
        }),
      );
      layRoads(sim, 6);
      sim.zoning.rebuildFrontage();
      return sim;
    };

    // A speed multiplier only changes how many ticks a frame runs, never what a
    // tick does. Drive one city through the real accumulator at 1x and another
    // at 4x over the same span of simulated real time: both must land on the
    // same tick with byte-identical state, or the economy is speed-dependent.
    const run = (speed: 1 | 4, frames: number): Simulation => {
      const sim = build();
      const accumulator = new FixedStepAccumulator();
      let tick = 0;
      for (let f = 0; f < frames; f++) {
        const steps = accumulator.advance(1 / 60, speed);
        for (let i = 0; i < steps; i++) sim.step(++tick);
      }
      return sim;
    };

    const slow = run(1, 5400);
    const fast = run(4, 1350);
    expect(slow.state.tick).toBe(fast.state.tick);
    expect(slow.state.tick).toBeGreaterThan(TICKS_PER_MONTH);
    expect(JSON.stringify(fast.serialize())).toBe(JSON.stringify(slow.serialize()));
  });
});

describe('ledger', () => {
  it('refuses a spend it cannot cover and leaves the balance untouched', () => {
    const sim = makeSim();
    sim.state.money = 100;

    expect(sim.ledger.spend(101, 'construction')).toBe(false);
    expect(sim.state.money).toBe(100);
    expect(sim.ledger.month.construction).toBe(0);

    expect(sim.ledger.spend(100, 'construction')).toBe(true);
    expect(sim.state.money).toBe(0);
    expect(sim.ledger.month.construction).toBe(100);
  });

  it('always credits an earn, and accumulates per category', () => {
    const sim = makeSim();
    sim.ledger.earn(250, 'tax');
    sim.ledger.earn(50, 'refund');
    expect(sim.state.money).toBe(STARTING_MONEY + 300);
    expect(sim.ledger.month.tax).toBe(250);
    expect(sim.ledger.month.refund).toBe(50);
  });

  it('rejects non-finite and negative amounts without moving anything', () => {
    const sim = makeSim();
    const before = sim.state.money;
    for (const bad of [NaN, Infinity, -Infinity, -5]) {
      expect(sim.ledger.spend(bad, 'construction')).toBe(false);
      sim.ledger.earn(bad, 'tax');
      sim.ledger.pay(bad, 'roadUpkeep');
    }
    expect(sim.state.money).toBe(before);
    expect(Number.isFinite(sim.state.money)).toBe(true);
    for (const category of LEDGER_CATEGORIES) expect(sim.ledger.month[category]).toBe(0);
  });

  it('lets pay drive the treasury negative rather than clamping at zero', () => {
    const sim = makeSim();
    sim.state.money = 10;
    sim.ledger.pay(60, 'roadUpkeep');
    expect(sim.state.money).toBe(-50);
    expect(sim.ledger.broke).toBe(true);
    // spend still refuses while overdrawn: construction is blocked, not queued.
    expect(sim.ledger.spend(1, 'construction')).toBe(false);
  });

  it('settles a month into lastMonth and resets the accumulators', () => {
    const sim = makeSim();
    sim.ledger.earn(400, 'tax');
    sim.ledger.pay(150, 'roadUpkeep');
    sim.ledger.spend(50, 'construction');

    const closed = sim.ledger.settle();
    expect(closed.tax).toBe(400);
    expect(closed.roadUpkeep).toBe(150);
    expect(closed.construction).toBe(50);
    expect(netOf(closed)).toBe(400 - 150 - 50);
    expect(sim.state.economy.lastNet).toBe(200);
    expect(sim.state.economy.monthsSettled).toBe(1);
    for (const category of LEDGER_CATEGORIES) expect(sim.ledger.month[category]).toBe(0);

    // The returned object is a copy: mutating it cannot corrupt live state.
    closed.tax = 99999;
    expect(sim.state.economy.lastMonth.tax).toBe(400);
  });

  it('clamps tax rates into [0, MAX_TAX_RATE]', () => {
    const sim = makeSim();
    sim.ledger.setTaxRate('residential', 5);
    sim.ledger.setTaxRate('commercial', -1);
    sim.ledger.setTaxRate('industrial', 0.2);
    expect(sim.ledger.taxRates.residential).toBe(MAX_TAX_RATE);
    expect(sim.ledger.taxRates.commercial).toBe(0);
    expect(sim.ledger.taxRates.industrial).toBe(0.2);
  });

  it('reads the host on every access, so a save load is picked up', () => {
    const state = { money: 10, economy: createEconomyState() };
    const ledger = new CityLedger(state);
    state.economy = createEconomyState();
    state.economy.taxRates.residential = 0.25;
    expect(ledger.taxRates.residential).toBe(0.25);
    ledger.earn(5, 'tax');
    expect(state.economy.month.tax).toBe(5);
  });
});

describe('build tools charge through the ledger', () => {
  it('debits exactly the plan cost on a road commit', () => {
    const sim = makeSim();
    const edge = sim.roads.placeSegment(-100, 0, 100, 0, 'small');
    expect(edge).not.toBeNull();
    // placeSegment is the graph-level call and does not touch money; the tool
    // is what charges. Verify the cost the plan quoted is what the edge stored.
    expect((edge as { cost: number }).cost).toBe(
      Math.round((edge as { length: number }).length * ROAD_CLASSES.small.costPerMetre),
    );
  });

  it('refunds the configured fraction of the stored cost on bulldoze', () => {
    const sim = makeSim();
    const edge = sim.roads.placeSegment(-100, 0, 100, 0, 'small');
    const built = edge as NonNullable<typeof edge>;
    const refund = roadRefund(built);
    expect(refund).toBe(Math.round(built.cost * BULLDOZE_REFUND_FRACTION));

    const before = sim.state.money;
    sim.ledger.earn(refund, 'refund');
    expect(sim.state.money).toBe(before + refund);
    expect(sim.ledger.month.refund).toBe(refund);
  });
});

describe('monthly settlement', () => {
  it('equals tax minus upkeep computed independently', () => {
    const sim = makeSim();
    const roadLength = layRoads(sim, 4);
    addBuilding(sim, 'residential', 1, { w: 2, d: 2 });
    addBuilding(sim, 'commercial', 0.5, { w: 3, d: 2 });
    addBuilding(sim, 'industrial', 0.75, { w: 4, d: 3 });
    sim.buildings.reindex();

    const economy = new EconomySystem({
      ledger: sim.ledger,
      buildings: sim.buildings,
      roads: sim.roads,
    });

    // Independent computation, from the tuning table rather than from the code
    // under test.
    const tune = ECONOMY_TUNING;
    const rate = tune.defaultTaxRate;
    const expectedTax =
      lotCapacity('residential', 2, 2, 1) * 1 * 2.4 * tune.taxableIncomePerResident * rate +
      lotCapacity('commercial', 3, 2, 1) * 0.5 * tune.taxableProfitPerCommercialJob * rate +
      lotCapacity('industrial', 4, 3, 1) * 0.75 * tune.taxableProfitPerIndustrialJob * rate;
    const expectedUpkeep = roadLength * ROAD_CLASSES.small.upkeepPerMetre;

    const before = sim.state.money;
    const settled = economy.settle(sim.state, TICKS_PER_MONTH);

    expect(settled.totals.tax).toBeCloseTo(expectedTax, 1);
    expect(settled.totals.roadUpkeep).toBeCloseTo(expectedUpkeep, 1);
    expect(settled.net).toBeCloseTo(expectedTax - expectedUpkeep, 1);
    expect(sim.state.money).toBeCloseTo(before + expectedTax - expectedUpkeep, 1);
  });

  it('charges nothing for an empty building and never produces NaN', () => {
    const sim = makeSim();
    addBuilding(sim, 'residential', 0, { w: 2, d: 2 });
    sim.buildings.reindex();
    const economy = new EconomySystem({ ledger: sim.ledger, buildings: sim.buildings });

    expect(economy.projectedTax()).toBe(0);
    const settled = economy.settle(sim.state, 0);
    expect(settled.totals.tax).toBe(0);
    expect(settled.totals.roadUpkeep).toBe(0);
    expect(Number.isFinite(sim.state.money)).toBe(true);
    expect(sim.state.money).toBe(STARTING_MONEY);
  });

  it('taxes residents for R and filled jobs for C and I', () => {
    const rates = { residential: 0.1, commercial: 0.1, industrial: 0.1 };
    const home = { zone: 'residential', capacity: 10, occupancy: 1, level: 1 } as BuildingData;
    const shop = { zone: 'commercial', capacity: 10, occupancy: 1, level: 1 } as BuildingData;
    const half = { zone: 'commercial', capacity: 10, occupancy: 0.5, level: 1 } as BuildingData;

    expect(buildingTax(home, rates)).toBeCloseTo(
      10 * 2.4 * ECONOMY_TUNING.taxableIncomePerResident * 0.1,
      6,
    );
    expect(buildingTax(shop, rates)).toBeCloseTo(
      10 * ECONOMY_TUNING.taxableProfitPerCommercialJob * 0.1,
      6,
    );
    // Occupancy is the whole feedback: half full pays half the tax.
    expect(buildingTax(half, rates)).toBeCloseTo(buildingTax(shop, rates) / 2, 6);
  });

  it('drives money negative through upkeep rather than clamping', () => {
    const sim = makeSim();
    layRoads(sim, 8);
    sim.state.money = 5;
    const economy = new EconomySystem({
      ledger: sim.ledger,
      buildings: sim.buildings,
      roads: sim.roads,
    });
    economy.settle(sim.state, TICKS_PER_MONTH);
    expect(sim.state.money).toBeLessThan(0);
    expect(sim.state.economy.lastNet).toBeLessThan(0);
  });

  it('runs exactly once per in-game month under the dispatcher', () => {
    const sim = makeSim();
    layRoads(sim, 2);
    const settlements: EconomySettledEvent[] = [];
    sim.addSystem(
      new EconomySystem({
        ledger: sim.ledger,
        buildings: sim.buildings,
        roads: sim.roads,
        events: { emit: (_e, p) => settlements.push(p) },
      }),
    );
    for (let t = 1; t <= TICKS_PER_MONTH * 3; t++) sim.step(t);
    expect(settlements).toHaveLength(3);
    expect(settlements.map((s) => s.tick)).toEqual([
      TICKS_PER_MONTH,
      TICKS_PER_MONTH * 2,
      TICKS_PER_MONTH * 3,
    ]);
  });

  it('caches road length per class and invalidates it on a change', () => {
    const sim = makeSim();
    const length = layRoads(sim, 3, 'gravel');
    expect(sim.roads.lengthByClass.gravel).toBeCloseTo(length, 6);
    expect(sim.roads.lengthByClass.small).toBe(0);
    expect(sim.roads.upkeepPerMonth).toBeCloseTo(
      length * ROAD_CLASSES.gravel.upkeepPerMetre,
      6,
    );

    const removed = sim.roads.edges[0] as { id: number; length: number };
    const shorter = length - removed.length;
    sim.roads.removeEdge(removed.id);
    expect(sim.roads.lengthByClass.gravel).toBeCloseTo(shorter, 6);
    expect(sim.roads.totalLength).toBeCloseTo(shorter, 6);
  });
});

describe('being broke', () => {
  it('blocks construction, penalizes growth and destroys nothing', () => {
    const sim = makeSim();
    layRoads(sim, 2);
    addBuilding(sim, 'residential', 1, { w: 2, d: 2 });
    sim.buildings.reindex();
    const standing = sim.buildings.count;

    const growth = new GrowthSystem({
      zoning: sim.zoning,
      buildings: sim.buildings,
      demand: { demand: { r: 1, c: 1, i: 1 } },
      roads: sim.roads,
      treasury: sim.state,
      seed: 7,
    });

    expect(growth.brokeFactor()).toBe(1);
    sim.state.money = -1;
    expect(growth.brokeFactor()).toBe(ECONOMY_TUNING.brokeGrowthPenalty);
    // A brake, never a wall: growth is still possible.
    expect(growth.brokeFactor()).toBeGreaterThan(0);

    // Construction is refused outright while overdrawn.
    expect(sim.ledger.spend(1, 'construction')).toBe(false);

    // Nothing standing is removed by being broke (§5 rule 4).
    for (let t = 1; t <= TICKS_PER_MONTH; t++) sim.step(t);
    expect(sim.buildings.count).toBe(standing);
  });

  it('damps positive demand while overdrawn without inverting it', () => {
    const build = (money: number): DemandSystem => {
      const sim = makeSim();
      sim.state.money = money;
      addBuilding(sim, 'residential', 0.9, { w: 2, d: 2 });
      addBuilding(sim, 'commercial', 0.2, { w: 3, d: 2 });
      sim.buildings.reindex();
      const demand = new DemandSystem(sim.buildings, sim.state, 1, sim.state);
      for (let t = 0; t < 60; t++) demand.step(sim.state, t);
      return demand;
    };

    const solvent = build(STARTING_MONEY);
    const broke = build(-1000);
    expect(broke.demand.r).toBeLessThan(solvent.demand.r);
    expect(broke.demand.r).toBeGreaterThan(0);
    expect(Number.isFinite(broke.demand.c)).toBe(true);
  });

  it('recovers on its own once tax income clears the overdraft', () => {
    const sim = makeSim();
    sim.state.money = -400;
    // A modest employed city, no roads to maintain.
    addBuilding(sim, 'residential', 1, { w: 2, d: 2 });
    addBuilding(sim, 'commercial', 1, { w: 3, d: 2 });
    addBuilding(sim, 'industrial', 1, { w: 4, d: 3 });
    sim.buildings.reindex();
    sim.ledger.setTaxRate('residential', MAX_TAX_RATE);
    sim.ledger.setTaxRate('commercial', MAX_TAX_RATE);
    sim.ledger.setTaxRate('industrial', MAX_TAX_RATE);

    const economy = new EconomySystem({ ledger: sim.ledger, buildings: sim.buildings });
    let months = 0;
    while (sim.state.money < 0 && months < 120) {
      economy.settle(sim.state, TICKS_PER_MONTH * ++months);
    }
    expect(sim.state.money).toBeGreaterThanOrEqual(0);
    expect(months).toBeLessThan(120);
  });
});

describe('economy save round-trip', () => {
  it('restores tax rates, the running month and the settled one', () => {
    const source = makeSim();
    layRoads(source, 3);
    addBuilding(source, 'residential', 1, { w: 2, d: 2 });
    source.buildings.reindex();
    source.ledger.setTaxRate('commercial', 0.22);
    source.ledger.spend(1234, 'construction');
    new EconomySystem({
      ledger: source.ledger,
      buildings: source.buildings,
      roads: source.roads,
    }).settle(source.state, TICKS_PER_MONTH);
    source.ledger.spend(77, 'construction');

    const saves = new SaveManager(new MemoryStore());
    saves.register(source);
    const json = saves.saveToString();

    const target = makeSim();
    const restore = new SaveManager(new MemoryStore());
    restore.register(target);
    const doc = restore.loadFromString(json);

    expect(doc.version).toBe(SAVE_VERSION);
    expect(target.state.money).toBe(source.state.money);
    expect(target.state.economy).toEqual(source.state.economy);
    // A partial month survives the round-trip (simulation.md §8).
    expect(target.state.economy.month.construction).toBe(77);
    expect(target.state.economy.monthsSettled).toBe(1);
    expect(JSON.stringify(target.serialize())).toBe(JSON.stringify(source.serialize()));
  });

  it('returns a deep copy that a later tick cannot mutate', () => {
    const sim = makeSim();
    const snapshot = sim.serialize();
    sim.ledger.earn(500, 'tax');
    sim.ledger.setTaxRate('residential', 0.3);
    expect(snapshot.economy.month.tax).toBe(0);
    expect(snapshot.economy.taxRates.residential).toBe(ECONOMY_TUNING.defaultTaxRate);
  });

  it('loads a save written before the economy branch existed', () => {
    const sim = makeSim();
    const legacy = sim.serialize() as Partial<GameState>;
    delete legacy.economy;
    expect(() => sim.deserialize(legacy as GameState)).not.toThrow();
    expect(sim.state.economy).toEqual(createEconomyState());
    expect(sim.state.money).toBe(STARTING_MONEY);
  });

  it('normalizes a corrupted economy branch into something playable', () => {
    const sim = makeSim();
    const corrupt = sim.serialize() as unknown as Record<string, unknown>;
    corrupt.money = NaN;
    corrupt.population = -12;
    corrupt.tick = Number.POSITIVE_INFINITY;
    corrupt.cityName = 42;
    corrupt.economy = {
      taxRates: { residential: 47, commercial: 'lots', industrial: -3 },
      month: { tax: NaN, roadUpkeep: -5, construction: 'x' },
      lastMonth: null,
      lastNet: Infinity,
      monthsSettled: -9,
    };

    sim.deserialize(corrupt as unknown as GameState);

    expect(Number.isFinite(sim.state.money)).toBe(true);
    expect(sim.state.money).toBe(STARTING_MONEY);
    expect(sim.state.population).toBe(0);
    expect(sim.state.tick).toBe(0);
    expect(typeof sim.state.cityName).toBe('string');
    expect(sim.state.economy.taxRates.residential).toBe(MAX_TAX_RATE);
    expect(sim.state.economy.taxRates.commercial).toBe(ECONOMY_TUNING.defaultTaxRate);
    expect(sim.state.economy.taxRates.industrial).toBe(0);
    expect(sim.state.economy.month.tax).toBe(0);
    expect(sim.state.economy.month.roadUpkeep).toBe(0);
    expect(sim.state.economy.monthsSettled).toBe(0);
    expect(Number.isFinite(sim.state.economy.lastNet)).toBe(true);
  });

  it('tolerates garbage handed straight to the normalizer', () => {
    for (const bad of [null, undefined, 7, 'nope', [], { taxRates: 3 }]) {
      const out = normalizeEconomyState(bad);
      expect(Number.isFinite(out.lastNet)).toBe(true);
      for (const category of LEDGER_CATEGORIES) {
        expect(Number.isFinite(out.month[category])).toBe(true);
      }
    }
  });

  it('re-derives road cost for an edge saved before the field existed', () => {
    const sim = makeSim();
    const edge = sim.roads.placeSegment(-100, 0, 100, 0, 'small') as { id: number };
    expect(edge).not.toBeNull();
    const doc = sim.serialize();
    for (const e of doc.roads.edges) delete (e as Partial<typeof e>).cost;

    const target = makeSim();
    target.deserialize(doc);
    const restored = target.roads.edge(edge.id) as { length: number; cost: number };
    expect(restored.cost).toBe(
      Math.round(restored.length * ROAD_CLASSES.small.costPerMetre),
    );
  });
});
