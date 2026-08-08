/**
 * Traffic: the test plan of `docs/research/traffic.md` §11, items 1-7.
 *
 * Topology, determinism, connectivity, road hierarchy, the congestion curve,
 * demand mapping, and the vehicle pool's bookkeeping. No DOM anywhere; the
 * vehicle-pool functions are pure and take an injected random sample precisely
 * so they can be exercised headlessly.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.js';
import { Simulation, ZoningSystem } from '../src/sim/state.js';
import {
  BOUNDARY_MARGIN,
  BPR_BETA,
  CONGESTION_CAP,
  MIN_SPEED_FRACTION,
  OUTSIDE_EMIT,
  TrafficSystem,
  assignDemand,
  assignFlow,
  buildTopology,
  congestionColor,
  createTrafficState,
  resizeTrafficState,
  sampleEdgeByFlow,
  travelSpeed,
  type RoadTopology,
  type TrafficState,
} from '../src/sim/traffic.js';
import {
  MAX_VEHICLES,
  chooseNextEdge,
  createVehiclePool,
  despawnVehicle,
  remapVehicles,
  spawnVehicle,
  targetVehicleCount,
  VEHICLE_MAX_CAMERA_HEIGHT,
} from '../src/render/vehicles.js';
import { findLot, type BuildingData } from '../src/sim/buildings.js';
import { ROAD_CLASSES, type RoadClassId } from '../src/sim/roads.js';
import { cellAt, type ZoneType } from '../src/sim/zoning.js';

/** Flat dry ground, high enough above sea level for roads to be buildable. */
const FLAT = { heightAt: (): number => 10 };

/** Half-extent used by every test, matching the world the game boots with. */
const WORLD_HALF = 2048;

/** A simulation on flat, buildable ground. */
function makeSim(): Simulation {
  const sim = new Simulation(20260101, { sampler: FLAT, bounds: WORLD_HALF });
  sim.addSystem(new ZoningSystem(sim.zoning));
  return sim;
}

/** A traffic system over a simulation, with the world half these tests use. */
function makeTraffic(sim: Simulation): TrafficSystem {
  return new TrafficSystem({
    roads: sim.roads,
    buildings: sim.buildings,
    zoning: sim.zoning,
    worldHalf: WORLD_HALF,
  });
}

/**
 * Grow one building against the road at `(x, z)`, at a chosen occupancy.
 *
 * Goes through the real path — paint a cell, find its lot, let the store claim
 * it — so the frontage the demand pass reads is the one the game would write.
 */
function plantBuilding(
  sim: Simulation,
  x: number,
  z: number,
  zone: ZoneType,
  occupancy: number,
): BuildingData | null {
  sim.zoning.rebuildFrontage();
  const key = cellAt(x, z);
  if (key < 0 || !sim.zoning.canPaint(key, zone)) return null;
  sim.zoning.paintCell(key, zone);
  const lot = findLot(sim.zoning, key);
  if (!lot) return null;
  const building = sim.buildings.add(lot, 1, 0);
  building.occupancy = occupancy;
  return building;
}

/** Total emit across every edge. */
function totalEmit(state: TrafficState, topology: RoadTopology): number {
  let sum = 0;
  for (let e = 0; e < topology.slotCount; e++) sum += state.emit[e] as number;
  return sum;
}

describe('road topology', () => {
  it('matches edgesAt for every node, as a CSR table', () => {
    const sim = makeSim();
    sim.roads.placeSegment(0, 0, 0, 128);
    sim.roads.placeSegment(0, 128, 128, 128);
    sim.roads.placeSegment(0, 128, -128, 128);
    const topology = buildTopology(sim.roads, WORLD_HALF);

    expect(topology.slotCount).toBe(sim.roads.edges.length);
    expect(topology.nodeCount).toBe(sim.roads.nodes.length);
    for (let n = 0; n < topology.nodeCount; n++) {
      const expected = sim.roads
        .edgesAt(topology.nodeId[n] as number)
        .map((e) => e.id)
        .sort((a, b) => a - b);
      const actual: number[] = [];
      for (
        let k = topology.nodeOffset[n] as number;
        k < (topology.nodeOffset[n + 1] as number);
        k++
      ) {
        actual.push(topology.edgeId[topology.nodeEdges[k] as number] as number);
      }
      expect(actual.sort((a, b) => a - b)).toEqual(expected);
    }
  });

  it('gives slots in sorted edge-id order, independent of insertion order', () => {
    const sim = makeSim();
    const a = sim.roads.placeSegment(0, 0, 0, 128);
    const b = sim.roads.placeSegment(0, 128, 128, 128);
    const topology = buildTopology(sim.roads, WORLD_HALF);
    expect(topology.slotOf.get((a as { id: number }).id)).toBe(0);
    expect(topology.slotOf.get((b as { id: number }).id)).toBe(1);
    expect([...topology.edgeId]).toEqual([...topology.edgeId].sort((x, y) => x - y));
  });

  it('carries flow across a rebuild by edge id, not by slot index', () => {
    const sim = makeSim();
    const first = sim.roads.placeSegment(0, 0, 0, 128);
    const second = sim.roads.placeSegment(0, 128, 128, 128);
    const before = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(before);
    state.flow[before.slotOf.get((first as { id: number }).id) as number] = 111;
    state.flow[before.slotOf.get((second as { id: number }).id) as number] = 222;

    sim.roads.removeEdge((first as { id: number }).id);
    const after = buildTopology(sim.roads, WORLD_HALF);
    const moved = resizeTrafficState(state, before, after);

    expect(after.slotCount).toBe(1);
    // The surviving edge kept its own volume even though it now occupies the
    // slot the bulldozed one used to hold.
    expect(moved.flow[after.slotOf.get((second as { id: number }).id) as number]).toBe(222);
  });

  it('flags nodes on the map boundary as outside connections', () => {
    const sim = makeSim();
    sim.roads.placeSegment(WORLD_HALF - 8, 0, WORLD_HALF - 200, 0);
    const topology = buildTopology(sim.roads, WORLD_HALF);
    let boundary = 0;
    for (let n = 0; n < topology.nodeCount; n++) {
      if (topology.nodeBoundary[n]) boundary++;
      const onEdge = Math.abs(topology.nodeX[n] as number) >= WORLD_HALF - BOUNDARY_MARGIN;
      expect(Boolean(topology.nodeBoundary[n])).toBe(onEdge);
    }
    expect(boundary).toBe(1);
  });
});

describe('congestion curve', () => {
  it('decreases monotonically and never goes below the floor', () => {
    const free = 11.1;
    const ratios = [0, 0.5, 1, 2, 10];
    let previous = Infinity;
    for (const ratio of ratios) {
      const speed = travelSpeed(free, ratio);
      expect(Number.isFinite(speed)).toBe(true);
      expect(speed).toBeLessThanOrEqual(previous);
      expect(speed).toBeGreaterThanOrEqual(free * MIN_SPEED_FRACTION - 1e-9);
      previous = speed;
    }
    expect(travelSpeed(free, 0)).toBe(free);
  });

  it('is barely felt below 0.7 and punishing past 1', () => {
    const free = 10;
    expect(travelSpeed(free, 0.5)).toBeGreaterThan(free * 0.9);
    expect(travelSpeed(free, 1.5)).toBeLessThan(free * 0.25);
    // The exponent is the tuning decision OVERVIEW §5 calls the most important
    // in v1; a gentle curve would make the whole system feel weightless.
    expect(BPR_BETA).toBeGreaterThanOrEqual(4);
  });

  it('survives degenerate input', () => {
    expect(travelSpeed(10, Number.NaN)).toBe(10);
    expect(travelSpeed(10, -5)).toBe(10);
    expect(travelSpeed(0, 3)).toBe(0);
  });

  it('keeps free-flowing roads at the base colour and jams red', () => {
    const asphalt = 0x3b3d44;
    expect(congestionColor(0, asphalt)).toBe(asphalt);
    expect(congestionColor(2, asphalt)).toBe(congestionColor(1, asphalt));
    expect(congestionColor(0.3, asphalt)).not.toBe(asphalt);
  });
});

describe('demand mapping', () => {
  it('books residential trips as emit and commercial as attract', () => {
    const sim = makeSim();
    const edge = sim.roads.placeSegment(-256, 0, 256, 0);
    const home = plantBuilding(sim, -100, 12, 'residential', 1);
    const shop = plantBuilding(sim, 100, 12, 'commercial', 1);
    expect(home).not.toBeNull();
    expect(shop).not.toBeNull();

    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    assignDemand(topology, state, sim.buildings, sim.zoning);
    const slot = topology.slotOf.get((edge as { id: number }).id) as number;
    expect(state.emit[slot]).toBeGreaterThan(0);
    expect(state.attract[slot]).toBeGreaterThan(0);
  });

  it('gives an empty building no trips and doubles with capacity', () => {
    const sim = makeSim();
    sim.roads.placeSegment(-256, 0, 256, 0);
    const home = plantBuilding(sim, -100, 12, 'residential', 0) as BuildingData;
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);

    assignDemand(topology, state, sim.buildings, sim.zoning);
    expect(totalEmit(state, topology)).toBe(0);

    home.occupancy = 1;
    home.capacity = 4;
    assignDemand(topology, state, sim.buildings, sim.zoning);
    const single = totalEmit(state, topology);
    expect(single).toBeGreaterThan(0);

    home.capacity = 8;
    assignDemand(topology, state, sim.buildings, sim.zoning);
    expect(totalEmit(state, topology)).toBeCloseTo(single * 2, 5);
  });

  it('contributes nowhere when its frontage road was bulldozed', () => {
    const sim = makeSim();
    const edge = sim.roads.placeSegment(-256, 0, 256, 0) as { id: number };
    plantBuilding(sim, -100, 12, 'residential', 1);
    sim.roads.removeEdge(edge.id);
    sim.zoning.rebuildFrontage();

    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    expect(() => assignDemand(topology, state, sim.buildings, sim.zoning)).not.toThrow();
    expect(totalEmit(state, topology)).toBe(0);
  });

  it('loads every boundary edge with the outside connection', () => {
    const sim = makeSim();
    const border = sim.roads.placeSegment(-WORLD_HALF + 8, 0, -1600, 0) as { id: number };
    const inland = sim.roads.placeSegment(-1600, 0, -1200, 0) as { id: number };
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    assignDemand(topology, state, sim.buildings, sim.zoning);
    expect(state.emit[topology.slotOf.get(border.id) as number]).toBe(OUTSIDE_EMIT);
    expect(state.emit[topology.slotOf.get(inland.id) as number]).toBe(0);
  });
});

describe('flow assignment', () => {
  /** A straight chain of `count` segments running east from the origin. */
  function chain(sim: Simulation, count: number, cls: RoadClassId = 'small'): number[] {
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const edge = sim.roads.placeSegment(i * 128, 0, (i + 1) * 128, 0, cls);
      if (edge) ids.push(edge.id);
    }
    return ids;
  }

  it('carries volume along every edge of a connected chain', () => {
    const sim = makeSim();
    const ids = chain(sim, 5);
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    // Trips generated at the far end of the chain, destinations at the near end.
    state.emit[topology.slotOf.get(ids[4] as number) as number] = 600;
    state.attract[topology.slotOf.get(ids[0] as number) as number] = 900;
    assignFlow(topology, state);

    for (const id of ids) {
      expect(state.flow[topology.slotOf.get(id) as number]).toBeGreaterThan(0);
    }
  });

  it('leaves a disconnected component at exactly zero', () => {
    const sim = makeSim();
    const ids = chain(sim, 3);
    // An island: far from the chain, far from the map edge, no trips of its own.
    const island = sim.roads.placeSegment(-800, -800, -800, -600) as { id: number };
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    state.emit[topology.slotOf.get(ids[0] as number) as number] = 500;
    state.attract[topology.slotOf.get(ids[2] as number) as number] = 500;
    assignFlow(topology, state);

    expect(state.flow[topology.slotOf.get(ids[1] as number) as number]).toBeGreaterThan(0);
    expect(state.flow[topology.slotOf.get(island.id) as number]).toBe(0);
  });

  it('sends the larger share down the higher-capacity of two parallel routes', () => {
    const sim = makeSim();
    // Two routes from (0,0) to (0,320): north side paved, south side gravel.
    const paved = sim.roads.placeSegment(0, 0, 256, 0, 'small') as { id: number };
    sim.roads.placeSegment(256, 0, 256, 320, 'small');
    sim.roads.placeSegment(256, 320, 0, 320, 'small');
    const gravel = sim.roads.placeSegment(0, 0, -256, 0, 'gravel') as { id: number };
    sim.roads.placeSegment(-256, 0, -256, 320, 'gravel');
    sim.roads.placeSegment(-256, 320, 0, 320, 'gravel');

    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    state.emit[topology.slotOf.get(paved.id) as number] = 400;
    state.emit[topology.slotOf.get(gravel.id) as number] = 400;
    assignFlow(topology, state);

    const pavedFlow = state.flow[topology.slotOf.get(paved.id) as number] as number;
    const gravelFlow = state.flow[topology.slotOf.get(gravel.id) as number] as number;
    expect(pavedFlow).toBeGreaterThan(gravelFlow);
    // Capacity ratio is 1600:1000; the split should reflect it rather than
    // merely breaking the tie.
    expect(pavedFlow / gravelFlow).toBeGreaterThan(1.1);
  });

  it('derives congestion and speed from flow over capacity', () => {
    const sim = makeSim();
    const ids = chain(sim, 2);
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    state.emit[topology.slotOf.get(ids[0] as number) as number] = 20000;
    for (let i = 0; i < 40; i++) assignFlow(topology, state);

    const slot = topology.slotOf.get(ids[0] as number) as number;
    const ratio = (state.flow[slot] as number) / (topology.capacity[slot] as number);
    expect(state.congestion[slot]).toBeCloseTo(Math.min(ratio, CONGESTION_CAP), 5);
    expect(state.speed[slot]).toBeCloseTo(
      travelSpeed(topology.freeSpeed[slot] as number, ratio),
      5,
    );
    expect(state.speed[slot]).toBeLessThan(topology.freeSpeed[slot] as number);
  });

  it('eases into a new solution rather than snapping to it', () => {
    const sim = makeSim();
    const ids = chain(sim, 2);
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    const slot = topology.slotOf.get(ids[0] as number) as number;
    state.emit[slot] = 1000;

    assignFlow(topology, state);
    const first = state.flow[slot] as number;
    assignFlow(topology, state);
    const second = state.flow[slot] as number;
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(state.next[slot] as number);
  });

  it('writes prefix sums that match the flow array', () => {
    const sim = makeSim();
    const ids = chain(sim, 4);
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    state.emit[topology.slotOf.get(ids[0] as number) as number] = 800;
    assignFlow(topology, state);

    let running = 0;
    for (let e = 0; e < topology.slotCount; e++) {
      running += state.flow[e] as number;
      expect(state.prefix[e]).toBeCloseTo(running, 4);
    }
  });

  it('handles an empty network without throwing', () => {
    const sim = makeSim();
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const state = createTrafficState(topology);
    expect(() => assignFlow(topology, state)).not.toThrow();
  });
});

describe('traffic determinism', () => {
  /** Lay the same small city twice and assign traffic over it. */
  function city(): { sim: Simulation; traffic: TrafficSystem } {
    const sim = makeSim();
    for (let i = 0; i < 4; i++) sim.roads.placeSegment(i * 128, 0, (i + 1) * 128, 0);
    sim.roads.placeSegment(256, 0, 256, 256);
    plantBuilding(sim, 60, 12, 'residential', 1);
    plantBuilding(sim, 300, 12, 'commercial', 0.8);
    plantBuilding(sim, 268, 120, 'industrial', 0.6);
    const traffic = makeTraffic(sim);
    return { sim, traffic };
  }

  it('produces bit-identical flow for identical state', () => {
    const a = city();
    const b = city();
    for (let i = 0; i < 5; i++) {
      a.traffic.assign();
      b.traffic.assign();
    }
    expect([...a.traffic.state.flow]).toEqual([...b.traffic.state.flow]);
    expect(a.traffic.totalFlow).toBe(b.traffic.totalFlow);
  });

  it('rebuilds the same flow after a save round-trip, proving it is derived', () => {
    const original = city();
    for (let i = 0; i < 5; i++) original.traffic.assign();

    const snapshot = JSON.parse(JSON.stringify(original.sim.serialize()));
    const restored = makeSim();
    restored.deserialize(snapshot);
    restored.zoning.rebuildFrontage();
    const traffic = makeTraffic(restored);
    for (let i = 0; i < 5; i++) traffic.assign();

    expect([...traffic.state.flow]).toEqual([...original.traffic.state.flow]);
  });

  it('reports per-edge figures through the accessors', () => {
    const { sim, traffic } = city();
    traffic.assign();
    const edge = sim.roads.edges[0] as { id: number; roadClass: RoadClassId };
    expect(traffic.capacityOf(edge.id)).toBe(
      ROAD_CLASSES[edge.roadClass].lanes * ROAD_CLASSES[edge.roadClass].laneCapacity,
    );
    expect(traffic.congestionOf(edge.id)).toBeCloseTo(
      traffic.flowOf(edge.id) / traffic.capacityOf(edge.id),
      6,
    );
    expect(traffic.travelTimeOf(edge.id)).toBeGreaterThan(0);
    // An edge the graph has never heard of reads as empty rather than throwing.
    expect(traffic.flowOf(99999)).toBe(0);
    expect(traffic.congestionOf(99999)).toBe(0);
    expect(traffic.speedOf(99999)).toBe(0);
  });

  it('follows the road graph when a segment is bulldozed mid-city', () => {
    const { sim, traffic } = city();
    traffic.assign();
    const doomed = sim.roads.edges[1] as { id: number };
    expect(traffic.flowOf(doomed.id)).toBeGreaterThan(0);
    sim.roads.removeEdge(doomed.id);
    sim.zoning.rebuildFrontage();
    traffic.assign();
    expect(traffic.flowOf(doomed.id)).toBe(0);
    expect(traffic.topology.slotCount).toBe(sim.roads.edges.length);
  });

  it('names the worst road for the info view', () => {
    const { traffic } = city();
    for (let i = 0; i < 10; i++) traffic.assign();
    const worst = traffic.worstEdge();
    expect(worst).not.toBeNull();
    const found = worst as { edgeId: number; congestion: number };
    for (let e = 0; e < traffic.topology.slotCount; e++) {
      expect(traffic.state.congestion[e]).toBeLessThanOrEqual(found.congestion + 1e-9);
    }
  });
});

describe('flow-weighted sampling', () => {
  it('never picks a zero-flow edge when others carry volume', () => {
    const prefix = Float32Array.from([0, 0, 10, 10, 30]);
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const slot = sampleEdgeByFlow(prefix, 5, rng.float());
      expect(slot === 2 || slot === 4).toBe(true);
    }
  });

  it('picks in proportion to flow', () => {
    // Slot 0 carries 90 of the 100 total.
    const prefix = Float32Array.from([90, 100]);
    const rng = new Rng(11);
    let zero = 0;
    for (let i = 0; i < 2000; i++) {
      if (sampleEdgeByFlow(prefix, 2, rng.float()) === 0) zero++;
    }
    expect(zero / 2000).toBeGreaterThan(0.85);
    expect(zero / 2000).toBeLessThan(0.95);
  });

  it('reports -1 for an empty or flowless network', () => {
    expect(sampleEdgeByFlow(new Float32Array(0), 0, 0.5)).toBe(-1);
    expect(sampleEdgeByFlow(Float32Array.from([0, 0]), 2, 0.5)).toBe(-1);
  });
});

describe('scale', () => {
  it('assigns flow over a city-sized grid and caps the fleet', () => {
    const sim = makeSim();
    // A 12x12 grid of blocks: ~264 edges, the order of magnitude the perf
    // budget in traffic.md §10 is written against once the city fills in.
    const step = 128;
    const span = 12;
    for (let i = 0; i <= span; i++) {
      for (let j = 0; j < span; j++) {
        sim.roads.placeSegment(i * step, j * step, i * step, (j + 1) * step);
        sim.roads.placeSegment(j * step, i * step, (j + 1) * step, i * step);
      }
    }
    sim.zoning.rebuildFrontage();
    let planted = 0;
    for (let i = 0; i < span; i++) {
      for (let j = 0; j < span; j++) {
        const zone: ZoneType =
          (i + j) % 3 === 0 ? 'residential' : (i + j) % 3 === 1 ? 'commercial' : 'industrial';
        if (plantBuilding(sim, i * step + 60, j * step + 12, zone, 0.9)) planted++;
      }
    }
    expect(planted).toBeGreaterThan(50);

    const traffic = makeTraffic(sim);
    for (let i = 0; i < 20; i++) traffic.assign();

    expect(traffic.topology.slotCount).toBe(sim.roads.edges.length);
    expect(traffic.totalFlow).toBeGreaterThan(0);
    let positive = 0;
    for (let e = 0; e < traffic.topology.slotCount; e++) {
      const flow = traffic.state.flow[e] as number;
      expect(Number.isFinite(flow)).toBe(true);
      expect(flow).toBeGreaterThanOrEqual(0);
      expect(traffic.state.congestion[e]).toBeLessThanOrEqual(CONGESTION_CAP);
      if (flow > 0) positive++;
    }
    // A connected grid full of buildings carries traffic essentially everywhere.
    expect(positive).toBeGreaterThan(traffic.topology.slotCount * 0.9);
    // However busy the city gets, the fleet is bounded by the pool.
    expect(targetVehicleCount(traffic.totalFlow, 200)).toBeLessThanOrEqual(MAX_VEHICLES);
  });
});

describe('vehicle pool', () => {
  it('never exceeds its capacity', () => {
    const pool = createVehiclePool(4);
    for (let i = 0; i < 20; i++) spawnVehicle(pool, 0, 1, 0, 2, 5, 0, 0);
    expect(pool.count).toBe(4);
    expect(spawnVehicle(pool, 0, 1, 0, 2, 5, 0, 0)).toBe(-1);
  });

  it('keeps live vehicles compacted below count on swap-remove', () => {
    const pool = createVehiclePool(8);
    for (let i = 0; i < 5; i++) spawnVehicle(pool, i, 1, i / 10, 2, 5 + i, 0, i);
    despawnVehicle(pool, 1);
    expect(pool.count).toBe(4);
    // The last vehicle moved into the hole; no gaps remain.
    expect(pool.edge[1]).toBe(4);
    expect(pool.hops[1]).toBe(9);
    for (let i = 0; i < pool.count; i++) expect(pool.hops[i]).toBeGreaterThan(0);
    expect(despawnVehicle(pool, 9)).toBe(false);
  });

  it('recycles a vehicle whose edge was bulldozed and keeps the rest driving', () => {
    const sim = makeSim();
    const first = sim.roads.placeSegment(0, 0, 0, 128) as { id: number };
    const second = sim.roads.placeSegment(0, 128, 128, 128) as { id: number };
    const before = buildTopology(sim.roads, WORLD_HALF);

    const pool = createVehiclePool(8);
    spawnVehicle(pool, before.slotOf.get(first.id) as number, 1, 0.5, 2, 5, 0, 0);
    spawnVehicle(pool, before.slotOf.get(second.id) as number, 1, 0.5, 2, 5, 0, 0);

    sim.roads.removeEdge(first.id);
    const after = buildTopology(sim.roads, WORLD_HALF);
    remapVehicles(pool, before, after);

    expect(pool.count).toBe(1);
    expect(pool.edge[0]).toBe(after.slotOf.get(second.id));
  });

  it('picks the dominant neighbour at a junction with the expected frequency', () => {
    const sim = makeSim();
    const inbound = sim.roads.placeSegment(0, 0, 0, 128) as { id: number };
    const busy = sim.roads.placeSegment(0, 128, 128, 128) as { id: number };
    const quiet = sim.roads.placeSegment(0, 128, -128, 128) as { id: number };
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const flow = new Float32Array(topology.slotCount);
    flow[topology.slotOf.get(busy.id) as number] = 900;
    flow[topology.slotOf.get(quiet.id) as number] = 100;

    const node = topology.edgeB[topology.slotOf.get(inbound.id) as number] as number;
    const from = topology.slotOf.get(inbound.id) as number;
    const rng = new Rng(2026);
    let busyPicks = 0;
    const draws = 2000;
    for (let i = 0; i < draws; i++) {
      const next = chooseNextEdge(topology, flow, from, node, rng.float());
      expect(next).not.toBe(from);
      if (next === topology.slotOf.get(busy.id)) busyPicks++;
    }
    expect(busyPicks / draws).toBeGreaterThan(0.8);
    expect(busyPicks / draws).toBeLessThan(0.95);
  });

  it('makes a U-turn at a dead end rather than stalling', () => {
    const sim = makeSim();
    const only = sim.roads.placeSegment(0, 0, 0, 128) as { id: number };
    const topology = buildTopology(sim.roads, WORLD_HALF);
    const flow = new Float32Array(topology.slotCount);
    const slot = topology.slotOf.get(only.id) as number;
    const node = topology.edgeB[slot] as number;
    expect(chooseNextEdge(topology, flow, slot, node, 0.5)).toBe(slot);
    expect(chooseNextEdge(topology, flow, slot, -1, 0.5)).toBe(-1);
  });

  it('scales the target count with flow and culls it with camera height', () => {
    expect(targetVehicleCount(0, 200)).toBe(0);
    expect(targetVehicleCount(1000, 200)).toBeGreaterThan(0);
    expect(targetVehicleCount(1e9, 200)).toBe(MAX_VEHICLES);
    expect(targetVehicleCount(1e9, 200, 50)).toBe(50);
    expect(targetVehicleCount(10000, VEHICLE_MAX_CAMERA_HEIGHT + 1)).toBe(0);
    expect(targetVehicleCount(10000, 1000)).toBeLessThan(targetVehicleCount(10000, 100));
  });
});
