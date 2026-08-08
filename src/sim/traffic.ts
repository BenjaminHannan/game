/**
 * Traffic: statistical flow per road edge.
 *
 * Implements `docs/research/traffic.md`, which is in turn the binding v1
 * decision recorded in `docs/UNKNOWNS.md` and repeated in
 * `docs/research/cs2/traffic-pathfinding.md` — **statistical flow per road edge
 * plus lightweight visual vehicles, no per-vehicle pathfinding in v1**
 * (OVERVIEW §6 guardrail 17).
 *
 * The model is two layers that talk through exactly one array:
 *
 * 1. **Assignment** — this module. Buildings generate trips; trips are spread
 *    across the road graph by a bounded diffusion pass; the result is one
 *    `flow[e]` per edge plus a derived `congestion[e]` and `speed[e]`. This is
 *    the only layer anything gameplay-visible reads.
 * 2. **Vehicles** — `src/render/vehicles.ts`. Instanced meshes walking edge
 *    polylines, a readout of layer 1 that can be throttled or switched off
 *    without changing a single simulation number.
 *
 * Four properties are load-bearing:
 *
 * - **Nothing here is persisted.** `flow` is fully derived from the building
 *   list and the graph, so a save carries no traffic branch and the first
 *   assignment after a load refills it. One less migration surface (traffic.md
 *   §2), and it is why `TrafficSystem` is absent from `GameState`.
 * - **Determinism.** Pure float arithmetic over slot tables built in sorted
 *   edge-id order. No RNG, no `Map` iteration order, no wall-clock. Same save,
 *   same flow — which is what makes the round-trip test in the plan meaningful.
 * - **Bounded cost.** The solve is `DIFFUSION_SWEEPS * O(E)` and runs at
 *   {@link Cadence.Daily}, never per tick (guardrail 7). Every array is
 *   preallocated and reallocated only on a topology change, which is user-paced
 *   (guardrail 5).
 * - **Steep congestion.** OVERVIEW §5 divergence 1 calls the BPR exponent the
 *   single most important tuning decision in v1: our flow model cannot deadlock,
 *   so the curve has to supply the punishment that CS2 gets from gridlock.
 *
 * Pure data and maths — no three.js, no DOM — so tests drive it directly, the
 * same shape `roads.ts` has.
 */

import type { BuildingData, BuildingStore } from './buildings.js';
import { DEMAND_TUNING } from './demand.js';
import { Cadence, type System } from './cadence.js';
import {
  DEFAULT_WORLD_BOUNDS,
  ROAD_CLASSES,
  type RoadEdgeData,
  type RoadNetwork,
} from './roads.js';
import type { ZoningState } from './zoning.js';

// --- Congestion curve (traffic.md §3) ------------------------------------

/** BPR curve coefficient: how much delay a fully loaded road accumulates. */
export const BPR_ALPHA = 0.9;

/** BPR curve exponent. High on purpose — see the note about punishment above. */
export const BPR_BETA = 4;

/** Gridlock still crawls; this also guarantees we never divide by zero. */
export const MIN_SPEED_FRACTION = 0.12;

/** Ceiling on the reported volume/capacity ratio, so the tint has a top stop. */
export const CONGESTION_CAP = 2;

/**
 * Effective travel speed on an edge at a given volume/capacity ratio.
 *
 * Below ratio 0.7 the penalty is barely visible; past 1.0 it falls off a cliff,
 * which matches the lived feel of a city builder where a road is fine until
 * suddenly it very much is not.
 *
 * @param free Free-flow speed in m/s.
 * @param ratio Volume over capacity. Negative and non-finite inputs read as 0.
 * @returns Speed in m/s, never below `MIN_SPEED_FRACTION * free`, never NaN.
 */
export function travelSpeed(free: number, ratio: number): number {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
  const factor = 1 / (1 + BPR_ALPHA * Math.pow(r, BPR_BETA));
  return free * Math.max(factor, MIN_SPEED_FRACTION);
}

// --- Trip generation (traffic.md §4) -------------------------------------

/** Vehicle trips one resident makes per day, both directions counted. */
export const TRIPS_PER_RESIDENT_PER_DAY = 2.2;

/** Vehicle trips one filled job slot generates per day. */
export const TRIPS_PER_JOB_PER_DAY = 1.8;

/** Share of trips taken by car. v1 has no transit; the rest is walking. */
export const CAR_MODE_SHARE = 0.75;

/** Fraction of a day's trips falling in the peak hour. Flow is peak-hour vph. */
export const PEAK_FACTOR = 0.11;

/**
 * Share of a building's trips booked against the *other* side of the ledger:
 * homes receive visitors, workplaces send deliveries (traffic.md §4).
 */
export const CROSS_SHARE = 0.25;

/** Peak-hour trips a boundary edge sends into the city, vph. */
export const OUTSIDE_EMIT = 240;

/** Peak-hour trips a boundary edge pulls out of the city, vph. */
export const OUTSIDE_ATTRACT = 300;

/**
 * Distance from the world edge, in metres, within which a node counts as an
 * outside connection (`outside-connections.md`'s v1 row: one map-authored
 * connection supplying constant emit and attract on boundary edges).
 */
export const BOUNDARY_MARGIN = 96;

// --- Assignment (traffic.md §5) ------------------------------------------

/** Diffusion sweeps per solve. A deliberate truncation, not a convergence test. */
export const DIFFUSION_SWEEPS = 6;

/** Share of load surviving each hop; models trips terminating. */
export const DIFFUSION_DECAY = 0.82;

/** Fraction of the gap to the new solution `flow` closes each solve. */
export const FLOW_SMOOTHING = 0.25;

/** Sweeps used to spread the attraction potential that steers the load. */
export const POTENTIAL_SWEEPS = 12;

/** Share of a neighbour's attraction potential that reaches back one hop. */
export const POTENTIAL_FALLOFF = 0.75;

/**
 * How strongly the attraction potential biases a turn away from a pure
 * capacity split. 0 would make the pass a plain capacity-weighted random walk;
 * high values make traffic beeline and lose the hierarchy effect.
 */
export const ATTRACT_BIAS = 3;

/**
 * Dense, revision-scoped view of the road graph for the traffic passes.
 *
 * `RoadNetwork` ids are stable but not contiguous, and `edgesAt()` allocates an
 * array per call — fine for tools, fatal in a relaxation. This table is the
 * contiguous, allocation-free replacement, rebuilt when `RoadNetwork.revision`
 * moves, exactly like `RoadRenderer` already does.
 *
 * Slots are assigned in ascending edge-id (and node-id) order, which is what
 * makes the whole assignment independent of `Map` iteration order.
 */
export interface RoadTopology {
  /** `RoadNetwork.revision` this table was built from. */
  revision: number;
  /** Edges in the table. */
  slotCount: number;
  /** Nodes in the table. */
  nodeCount: number;
  /** edgeId -> slot. */
  slotOf: Map<number, number>;
  /** slot -> edgeId. */
  edgeId: Int32Array;
  /** Node slot at the `from` end of each edge. */
  edgeA: Int32Array;
  /** Node slot at the `to` end of each edge. */
  edgeB: Int32Array;
  /** Edge length in metres. */
  length: Float32Array;
  /** Free-flow speed in m/s, from the class's speed limit. */
  freeSpeed: Float32Array;
  /** Capacity in vehicles per hour, `lanes * laneCapacity`. */
  capacity: Float32Array;
  /**
   * CSR adjacency: edges incident to node slot `n` are
   * `nodeEdges[nodeOffset[n] .. nodeOffset[n + 1])`. This is already the graph
   * an A-star or Dijkstra search needs, so the v2 router inherits it unchanged
   * (traffic.md §8).
   */
  nodeOffset: Int32Array;
  nodeEdges: Int32Array;
  /** nodeId per node slot. */
  nodeId: Int32Array;
  /** Node world positions, so the render layer needs no graph lookups. */
  nodeX: Float32Array;
  nodeY: Float32Array;
  nodeZ: Float32Array;
  /** 1 where the node sits on the map boundary (an outside connection). */
  nodeBoundary: Uint8Array;
}

/** An empty topology, so consumers never have to null-check. */
export function createEmptyTopology(): RoadTopology {
  return {
    revision: -1,
    slotCount: 0,
    nodeCount: 0,
    slotOf: new Map(),
    edgeId: new Int32Array(0),
    edgeA: new Int32Array(0),
    edgeB: new Int32Array(0),
    length: new Float32Array(0),
    freeSpeed: new Float32Array(0),
    capacity: new Float32Array(0),
    nodeOffset: new Int32Array(1),
    nodeEdges: new Int32Array(0),
    nodeId: new Int32Array(0),
    nodeX: new Float32Array(0),
    nodeY: new Float32Array(0),
    nodeZ: new Float32Array(0),
    nodeBoundary: new Uint8Array(0),
  };
}

/**
 * Build the dense table from a road graph.
 *
 * Two counting passes over the edges, O(V + E), allocating once per array
 * rather than once per edge. Called only when the graph changed.
 *
 * @param network Graph to snapshot.
 * @param worldHalf Half-extent of the world, for the boundary-node test.
 */
export function buildTopology(
  network: RoadNetwork,
  worldHalf = DEFAULT_WORLD_BOUNDS,
): RoadTopology {
  const topo = createEmptyTopology();
  topo.revision = network.revision;

  // Sorted ids, so slot assignment cannot depend on insertion order.
  const nodes = [...network.nodes].sort((a, b) => a.id - b.id);
  const nodeSlot = new Map<number, number>();
  const nodeCount = nodes.length;
  topo.nodeCount = nodeCount;
  topo.nodeId = new Int32Array(nodeCount);
  topo.nodeX = new Float32Array(nodeCount);
  topo.nodeY = new Float32Array(nodeCount);
  topo.nodeZ = new Float32Array(nodeCount);
  topo.nodeBoundary = new Uint8Array(nodeCount);
  const edgeLimit = worldHalf - BOUNDARY_MARGIN;
  for (let n = 0; n < nodeCount; n++) {
    const node = nodes[n] as { id: number; x: number; y: number; z: number };
    nodeSlot.set(node.id, n);
    topo.nodeId[n] = node.id;
    topo.nodeX[n] = node.x;
    topo.nodeY[n] = node.y;
    topo.nodeZ[n] = node.z;
    topo.nodeBoundary[n] =
      Math.abs(node.x) >= edgeLimit || Math.abs(node.z) >= edgeLimit ? 1 : 0;
  }

  const edges = [...network.edges]
    .filter((e) => nodeSlot.has(e.from) && nodeSlot.has(e.to))
    .sort((a, b) => a.id - b.id);
  const slotCount = edges.length;
  topo.slotCount = slotCount;
  topo.edgeId = new Int32Array(slotCount);
  topo.edgeA = new Int32Array(slotCount);
  topo.edgeB = new Int32Array(slotCount);
  topo.length = new Float32Array(slotCount);
  topo.freeSpeed = new Float32Array(slotCount);
  topo.capacity = new Float32Array(slotCount);
  topo.nodeOffset = new Int32Array(nodeCount + 1);
  topo.nodeEdges = new Int32Array(slotCount * 2);

  for (let e = 0; e < slotCount; e++) {
    const edge = edges[e] as RoadEdgeData;
    const cls = ROAD_CLASSES[edge.roadClass] ?? ROAD_CLASSES.small;
    const a = nodeSlot.get(edge.from) as number;
    const b = nodeSlot.get(edge.to) as number;
    topo.slotOf.set(edge.id, e);
    topo.edgeId[e] = edge.id;
    topo.edgeA[e] = a;
    topo.edgeB[e] = b;
    topo.length[e] = Math.max(1e-3, edge.length);
    // Catalogue speed limits are km/h; the whole render path is metres/second.
    topo.freeSpeed[e] = (cls.speedLimit * 1000) / 3600;
    topo.capacity[e] = Math.max(1, cls.lanes * cls.laneCapacity);
    topo.nodeOffset[a] = (topo.nodeOffset[a] as number) + 1;
    topo.nodeOffset[b] = (topo.nodeOffset[b] as number) + 1;
  }

  // Counting sort: turn per-node degrees into start offsets, then fill.
  let running = 0;
  for (let n = 0; n < nodeCount; n++) {
    const degree = topo.nodeOffset[n] as number;
    topo.nodeOffset[n] = running;
    running += degree;
  }
  topo.nodeOffset[nodeCount] = running;
  const cursor = new Int32Array(nodeCount);
  for (let e = 0; e < slotCount; e++) {
    const a = topo.edgeA[e] as number;
    const b = topo.edgeB[e] as number;
    topo.nodeEdges[(topo.nodeOffset[a] as number) + (cursor[a] as number)] = e;
    cursor[a] = (cursor[a] as number) + 1;
    topo.nodeEdges[(topo.nodeOffset[b] as number) + (cursor[b] as number)] = e;
    cursor[b] = (cursor[b] as number) + 1;
  }

  return topo;
}

/**
 * Structure-of-arrays traffic state, sized to the topology's slot count.
 *
 * Nothing in here is serialized; see the module note.
 */
export interface TrafficState {
  /** Trips generated adjacent to this edge, vph. Written by the demand pass. */
  emit: Float32Array;
  /** Trip attraction adjacent to this edge, vph-equivalent. */
  attract: Float32Array;
  /** Assigned volume, vph. The one number the rest of the game reads. */
  flow: Float32Array;
  /** The solve's raw result, before smoothing into {@link flow}. */
  next: Float32Array;
  /** `flow / capacity`, clamped to `[0, CONGESTION_CAP]`. Derived. */
  congestion: Float32Array;
  /** Effective travel speed, m/s. Derived. */
  speed: Float32Array;
  /** Prefix sums over {@link flow}, for O(log E) flow-weighted sampling. */
  prefix: Float32Array;
  /** Per-node trips still in motion this sweep, vph. Scratch. */
  load: Float32Array;
  /** Double buffer for {@link load}, so a sweep is order-independent. */
  loadNext: Float32Array;
  /** Per-node attraction potential in `[0, 1]`, steering the load. Scratch. */
  potential: Float32Array;
  /** Double buffer for {@link potential}. */
  potentialNext: Float32Array;
}

/** Traffic arrays sized for a topology. */
export function createTrafficState(topology: RoadTopology): TrafficState {
  const e = topology.slotCount;
  const n = topology.nodeCount;
  return {
    emit: new Float32Array(e),
    attract: new Float32Array(e),
    flow: new Float32Array(e),
    next: new Float32Array(e),
    congestion: new Float32Array(e),
    speed: new Float32Array(e),
    prefix: new Float32Array(e),
    load: new Float32Array(n),
    loadNext: new Float32Array(n),
    potential: new Float32Array(n),
    potentialNext: new Float32Array(n),
  };
}

/**
 * Reallocate traffic arrays for a new topology, carrying `flow` across **by edge
 * id** rather than by slot.
 *
 * Slots are not stable across a rebuild — bulldozing edge 3 shifts everything
 * after it — so copying by index would teleport a jammed arterial's volume onto
 * whatever quiet street inherited its slot. Copying by id is what makes a road
 * edit a local change rather than a citywide flicker.
 */
export function resizeTrafficState(
  previous: TrafficState,
  previousTopology: RoadTopology,
  topology: RoadTopology,
): TrafficState {
  const out = createTrafficState(topology);
  for (let e = 0; e < topology.slotCount; e++) {
    const old = previousTopology.slotOf.get(topology.edgeId[e] as number);
    if (old === undefined) continue;
    out.flow[e] = previous.flow[old] as number;
  }
  return out;
}

/**
 * Fill `emit` and `attract` from the building list and the outside connections.
 *
 * O(buildings) plus O(edges), allocating nothing. A building's frontage edge is
 * read from the zone grid rather than stored on the record, so a bulldozed road
 * simply leaves `frontage` at -1 and that building contributes nowhere.
 *
 * @param topology Dense graph view.
 * @param state Arrays to fill.
 * @param buildings Every standing building.
 * @param zoning Cell grid holding the frontage map.
 */
export function assignDemand(
  topology: RoadTopology,
  state: TrafficState,
  buildings: BuildingStore,
  zoning: ZoningState,
): void {
  state.emit.fill(0);
  state.attract.fill(0);

  const items = buildings.items;
  for (let i = 0; i < items.length; i++) {
    const b = items[i] as BuildingData;
    const edgeId = zoning.frontage[b.cell] as number;
    if (edgeId === undefined || edgeId < 0) continue;
    const slot = topology.slotOf.get(edgeId);
    if (slot === undefined) continue;

    const occupied = b.capacity * b.occupancy;
    if (!(occupied > 0)) continue;

    // Residential capacity counts households, so it converts to people before
    // it converts to trips; the workplace zones already count job slots.
    const trips =
      b.zone === 'residential'
        ? occupied * DEMAND_TUNING.householdSize * TRIPS_PER_RESIDENT_PER_DAY
        : occupied * TRIPS_PER_JOB_PER_DAY;
    const peak = trips * CAR_MODE_SHARE * PEAK_FACTOR;
    const primary = peak * (1 - CROSS_SHARE);
    const cross = peak * CROSS_SHARE;
    if (b.zone === 'residential') {
      state.emit[slot] = (state.emit[slot] as number) + primary;
      state.attract[slot] = (state.attract[slot] as number) + cross;
    } else {
      state.attract[slot] = (state.attract[slot] as number) + primary;
      state.emit[slot] = (state.emit[slot] as number) + cross;
    }
  }

  // Outside connections. This is what stops all traffic from being internal,
  // and why a city with one border road jams at that road.
  for (let e = 0; e < topology.slotCount; e++) {
    const a = topology.edgeA[e] as number;
    const b = topology.edgeB[e] as number;
    if (!topology.nodeBoundary[a] && !topology.nodeBoundary[b]) continue;
    state.emit[e] = (state.emit[e] as number) + OUTSIDE_EMIT;
    state.attract[e] = (state.attract[e] as number) + OUTSIDE_ATTRACT;
  }
}

/**
 * Spread the generated trips over the graph and derive congestion and speed.
 *
 * The expensive thing in real traffic is "for every origin-destination pair,
 * find a path". The cheap thing that produces a strikingly similar answer is a
 * bounded diffusion: trips leave their origin node, split across the incident
 * edges by capacity weighted toward attraction, decay as they terminate, and
 * whatever is still moving after {@link DIFFUSION_SWEEPS} hops is dropped.
 *
 * Two notes on the shape, both deliberate deviations from the literal
 * pseudo-code in traffic.md §5:
 *
 * - The doc's one-line sweep reads node excess directly into adjacent edges,
 *   which cannot carry volume more than one edge away from a building — and the
 *   doc's own §11 test 3 requires exactly that (a positive flow along every edge
 *   of a connecting chain). Load is therefore *propagated* between sweeps rather
 *   than recomputed from a static potential.
 * - Attraction enters as a per-node potential (a decayed maximum, spread by its
 *   own sweeps) that biases the turn split, rather than as a signed excess.
 *   That keeps every weight positive, which is what guarantees a reachable edge
 *   never reads zero and an unreachable one never reads anything else.
 *
 * Convergence is not required and not claimed: the truncation is what bounds the
 * cost exactly.
 */
export function assignFlow(topology: RoadTopology, state: TrafficState): void {
  const e = topology.slotCount;
  const n = topology.nodeCount;
  state.next.fill(0);
  if (e === 0 || n === 0) {
    state.flow.fill(0);
    state.congestion.fill(0);
    state.speed.fill(0);
    state.prefix.fill(0);
    return;
  }

  // --- Attraction potential: a normalized, decayed distance-to-destination
  // field. Each node keeps the best of its own attraction and a discounted view
  // of its neighbours', so the gradient always points at somewhere worth going.
  state.potential.fill(0);
  let peakAttract = 0;
  for (let i = 0; i < e; i++) {
    const value = state.attract[i] as number;
    if (value > peakAttract) peakAttract = value;
  }
  if (peakAttract > 0) {
    for (let i = 0; i < e; i++) {
      const share = (state.attract[i] as number) / peakAttract;
      const a = topology.edgeA[i] as number;
      const b = topology.edgeB[i] as number;
      if (share > (state.potential[a] as number)) state.potential[a] = share;
      if (share > (state.potential[b] as number)) state.potential[b] = share;
    }
    for (let sweep = 0; sweep < POTENTIAL_SWEEPS; sweep++) {
      for (let node = 0; node < n; node++) {
        let best = state.potential[node] as number;
        const from = topology.nodeOffset[node] as number;
        const to = topology.nodeOffset[node + 1] as number;
        for (let k = from; k < to; k++) {
          const edge = topology.nodeEdges[k] as number;
          const other =
            (topology.edgeA[edge] as number) === node
              ? (topology.edgeB[edge] as number)
              : (topology.edgeA[edge] as number);
          const reach = (state.potential[other] as number) * POTENTIAL_FALLOFF;
          if (reach > best) best = reach;
        }
        state.potentialNext[node] = best;
      }
      const swap = state.potential;
      state.potential = state.potentialNext;
      state.potentialNext = swap;
    }
  }

  // --- Load: trips leave the edge they were generated on, half toward each end.
  state.load.fill(0);
  for (let i = 0; i < e; i++) {
    const half = (state.emit[i] as number) / 2;
    if (half === 0) continue;
    const a = topology.edgeA[i] as number;
    const b = topology.edgeB[i] as number;
    state.load[a] = (state.load[a] as number) + half;
    state.load[b] = (state.load[b] as number) + half;
  }

  for (let sweep = 0; sweep < DIFFUSION_SWEEPS; sweep++) {
    state.loadNext.fill(0);
    for (let node = 0; node < n; node++) {
      const carried = state.load[node] as number;
      if (carried <= 0) continue;
      const from = topology.nodeOffset[node] as number;
      const to = topology.nodeOffset[node + 1] as number;
      if (from === to) continue;

      // Two passes over a node's incident edges: total the weights, then split.
      // Degree is 1-4 in practice, so this is cheaper than any scratch buffer.
      let total = 0;
      for (let k = from; k < to; k++) {
        total += turnWeight(topology, state, node, topology.nodeEdges[k] as number);
      }
      if (!(total > 0)) continue;
      for (let k = from; k < to; k++) {
        const edge = topology.nodeEdges[k] as number;
        const share = (carried * turnWeight(topology, state, node, edge)) / total;
        if (share <= 0) continue;
        state.next[edge] = (state.next[edge] as number) + share;
        const other =
          (topology.edgeA[edge] as number) === node
            ? (topology.edgeB[edge] as number)
            : (topology.edgeA[edge] as number);
        state.loadNext[other] = (state.loadNext[other] as number) + share * DIFFUSION_DECAY;
      }
    }
    const swap = state.load;
    state.load = state.loadNext;
    state.loadNext = swap;
  }

  // Smoothing, so tinting and vehicle density ease into a change over a few
  // days instead of popping when one building finishes (traffic.md §5).
  let running = 0;
  for (let i = 0; i < e; i++) {
    const blended =
      (state.flow[i] as number) +
      ((state.next[i] as number) - (state.flow[i] as number)) * FLOW_SMOOTHING;
    const value = blended > 0 ? blended : 0;
    state.flow[i] = value;
    const ratio = value / (topology.capacity[i] as number);
    state.congestion[i] = ratio > CONGESTION_CAP ? CONGESTION_CAP : ratio;
    state.speed[i] = travelSpeed(topology.freeSpeed[i] as number, ratio);
    running += value;
    state.prefix[i] = running;
  }
}

/** Weight of leaving `node` along `edge`: capacity, biased toward attraction. */
function turnWeight(
  topology: RoadTopology,
  state: TrafficState,
  node: number,
  edge: number,
): number {
  const other =
    (topology.edgeA[edge] as number) === node
      ? (topology.edgeB[edge] as number)
      : (topology.edgeA[edge] as number);
  return (
    (topology.capacity[edge] as number) *
    (1 + ATTRACT_BIAS * (state.potential[other] as number))
  );
}

/**
 * Pick an edge slot with probability proportional to its flow.
 *
 * Binary search over the prefix sums the assignment pass already wrote — O(log E)
 * per draw against O(E) for naive roulette selection, which matters because the
 * vehicle layer draws several of these per frame.
 *
 * @param prefix Prefix sums over flow.
 * @param count Slots in use.
 * @param r Uniform sample in `[0, 1)`.
 * @returns An edge slot, or -1 when there is no flow anywhere.
 */
export function sampleEdgeByFlow(prefix: Float32Array, count: number, r: number): number {
  if (count <= 0) return -1;
  const total = prefix[count - 1] as number;
  if (!(total > 0)) return -1;
  const target = Math.min(Math.max(r, 0), 0.999999) * total;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((prefix[mid] as number) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The read-only face of the traffic model.
 *
 * Everything outside this module goes through the accessors rather than the
 * arrays, so widening flow to per-direction (`flow[e * 2 + dir]`, traffic.md §8)
 * stays a one-file change.
 */
export interface TrafficField {
  readonly topology: RoadTopology;
  readonly state: TrafficState;
  /** Assigned volume on an edge, vph. 0 for an unknown edge. */
  flowOf(edgeId: number): number;
  /** Volume over capacity on an edge, clamped to `[0, CONGESTION_CAP]`. */
  congestionOf(edgeId: number): number;
  /** Effective travel speed on an edge, m/s. */
  speedOf(edgeId: number): number;
  /** Traversal time of an edge at its current speed, seconds. */
  travelTimeOf(edgeId: number): number;
  /** Sum of flow over every edge, vph — the vehicle layer's spawn budget. */
  readonly totalFlow: number;
  /** Monotonic counter bumped on every assignment pass. */
  readonly revision: number;
}

/** Construction options for {@link TrafficSystem}. */
export interface TrafficSystemOptions {
  /** Graph the flow is assigned over. */
  roads: RoadNetwork;
  /** Buildings generating the trips. */
  buildings: BuildingStore;
  /** Cell grid supplying each building's frontage edge. */
  zoning: ZoningState;
  /** Half-extent of the world, for the boundary-node test. */
  worldHalf?: number;
}

/**
 * The daily assignment pass, and the owner of the traffic arrays.
 *
 * Registered after the growth and demand systems so it reads settled occupancy,
 * and declared {@link Cadence.Daily} so it runs once per in-game day rather than
 * 40 times (guardrail 7). Nothing is added to `GameState`.
 */
export class TrafficSystem implements System, TrafficField {
  readonly id = 'traffic';

  readonly cadence = Cadence.Daily;

  private readonly network: RoadNetwork;
  private readonly store: BuildingStore;
  private readonly zoning: ZoningState;
  private readonly worldHalf: number;

  private topo: RoadTopology;
  private arrays: TrafficState;
  private revisionCounter = 0;
  private total = 0;

  constructor(options: TrafficSystemOptions) {
    this.network = options.roads;
    this.store = options.buildings;
    this.zoning = options.zoning;
    this.worldHalf = options.worldHalf ?? DEFAULT_WORLD_BOUNDS;
    this.topo = createEmptyTopology();
    this.arrays = createTrafficState(this.topo);
  }

  get topology(): RoadTopology {
    return this.topo;
  }

  get state(): TrafficState {
    return this.arrays;
  }

  get totalFlow(): number {
    return this.total;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  /** Rebuild the slot table if the graph moved. Cheap when it did not. */
  refreshTopology(): boolean {
    if (this.topo.revision === this.network.revision) return false;
    const previousTopology = this.topo;
    const previous = this.arrays;
    this.topo = buildTopology(this.network, this.worldHalf);
    this.arrays = resizeTrafficState(previous, previousTopology, this.topo);
    return true;
  }

  step(): void {
    this.assign();
  }

  /**
   * Run one full assignment immediately: topology check, demand pass, solve.
   *
   * Exposed so a scripted test (and the debug API) can force a pass without
   * waiting a simulated day.
   */
  assign(): void {
    this.refreshTopology();
    assignDemand(this.topo, this.arrays, this.store, this.zoning);
    assignFlow(this.topo, this.arrays);
    const count = this.topo.slotCount;
    this.total = count > 0 ? (this.arrays.prefix[count - 1] as number) : 0;
    this.revisionCounter++;
  }

  flowOf(edgeId: number): number {
    const slot = this.topo.slotOf.get(edgeId);
    return slot === undefined ? 0 : (this.arrays.flow[slot] as number);
  }

  congestionOf(edgeId: number): number {
    const slot = this.topo.slotOf.get(edgeId);
    return slot === undefined ? 0 : (this.arrays.congestion[slot] as number);
  }

  speedOf(edgeId: number): number {
    const slot = this.topo.slotOf.get(edgeId);
    return slot === undefined ? 0 : (this.arrays.speed[slot] as number);
  }

  travelTimeOf(edgeId: number): number {
    const slot = this.topo.slotOf.get(edgeId);
    if (slot === undefined) return 0;
    const speed = this.arrays.speed[slot] as number;
    return speed > 0 ? (this.topo.length[slot] as number) / speed : Infinity;
  }

  /** Capacity of an edge in vph, 0 for an unknown edge. */
  capacityOf(edgeId: number): number {
    const slot = this.topo.slotOf.get(edgeId);
    return slot === undefined ? 0 : (this.topo.capacity[slot] as number);
  }

  /**
   * The most congested edge, for the HUD's "worst road" readout and for the info
   * view's legend. One linear pass, called on demand rather than per frame.
   */
  worstEdge(): { edgeId: number; congestion: number; flow: number } | null {
    let best = -1;
    let worst = 0;
    for (let e = 0; e < this.topo.slotCount; e++) {
      const value = this.arrays.congestion[e] as number;
      if (value > worst) {
        worst = value;
        best = e;
      }
    }
    if (best < 0) return null;
    return {
      edgeId: this.topo.edgeId[best] as number,
      congestion: worst,
      flow: this.arrays.flow[best] as number,
    };
  }

  /** Drop every assigned volume, e.g. after a save load replaced the city. */
  reset(): void {
    this.topo = createEmptyTopology();
    this.arrays = createTrafficState(this.topo);
    this.total = 0;
    this.revisionCounter++;
  }
}

/**
 * The three-stop congestion palette (traffic.md §7).
 *
 * Free-flowing keeps the base asphalt colour, so an uncongested city looks
 * normal rather than uniformly green; amber at 0.6, red at and above 1.0. The
 * function is here rather than in the renderer because it is the *meaning* of
 * the number, and the info view and any future minimap must agree with the road
 * tint on what "red" is.
 *
 * @param congestion Volume over capacity.
 * @param base Packed RGB of the uncongested road surface.
 * @returns Packed RGB.
 */
export function congestionColor(congestion: number, base: number): number {
  const t = Number.isFinite(congestion) ? Math.max(0, congestion) : 0;
  const amber = 0xd9a441;
  const red = 0xd1483c;
  if (t <= 0) return base;
  if (t < 0.6) return mixRgb(base, amber, t / 0.6);
  if (t < 1) return mixRgb(amber, red, (t - 0.6) / 0.4);
  return red;
}

function mixRgb(a: number, b: number, t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}
