/**
 * Road network: the node/edge graph every later system attaches to.
 *
 * The model follows the "net" data model described in docs/research/roads.md
 * §11: a **node** is a point in the network (a free endpoint or a junction) and
 * an **edge** (segment) connects exactly two nodes. Where two segments share a
 * node, that node *is* the intersection between them.
 *
 * This milestone ships straight segments only, so an edge's centreline is fully
 * described by its two node positions; the Bezier control points the research
 * doc describes are deliberately deferred until curved drawing modes exist.
 *
 * The module is pure data and geometry maths — no three.js, no DOM — so it can
 * be exercised directly by the simulation and by tests. Terrain is consulted
 * only through the small {@link HeightSampler} interface.
 */

/** Zoning-cell size in metres; road endpoints snap to this grid (roads.md §2). */
export const ROAD_GRID = 8;

/** Radius in metres within which a new endpoint reuses an existing node. */
export const NODE_SNAP_RADIUS = 12;

/** Shortest placeable segment, in metres (two zoning cells). */
export const MIN_SEGMENT_LENGTH = 16;

/** Longest placeable segment, in metres. Keeps one click from spanning the map. */
export const MAX_SEGMENT_LENGTH = 512;

/**
 * Steepest buildable grade, as rise over run. roads.md does not publish a grade
 * limit for CS2 (its answer to steep ground is cut-and-fill, which this
 * milestone does not implement), so 12% is chosen as a plausible, playable
 * ceiling that keeps roads off cliffs.
 */
export const MAX_ROAD_GRADE = 0.12;

/** Lowest ground elevation a road may sit on, in metres. Sea level is 0. */
export const MIN_ROAD_ELEVATION = 0.5;

/** Spacing in metres at which a candidate segment is probed against terrain. */
export const TERRAIN_PROBE_SPACING = 8;

/** Default half-extent of the buildable world, in metres. */
export const DEFAULT_WORLD_BOUNDS = 2048;

/** Identifier of a road class in {@link ROAD_CLASSES}. */
export type RoadClassId = 'gravel' | 'small';

/** Static description of one road class (a "net prefab", roads.md §11). */
export interface RoadClass {
  readonly id: RoadClassId;
  /** Player-facing name. */
  readonly name: string;
  /** Full right-of-way width in metres, including verges (roads.md §Road/lane geometry). */
  readonly totalWidth: number;
  /** Paved carriageway width in metres. */
  readonly pavedWidth: number;
  /** Displayed speed limit. */
  readonly speedLimit: number;
  /** Construction cost per metre (roads.md: ~2 per metre for a two-lane road). */
  readonly costPerMetre: number;
}

/** The road catalogue. Kept as data, not special cases (roads.md §Interconnections). */
export const ROAD_CLASSES: Readonly<Record<RoadClassId, RoadClass>> = {
  gravel: {
    id: 'gravel',
    name: 'Gravel Road',
    totalWidth: 12,
    pavedWidth: 7,
    speedLimit: 30,
    costPerMetre: 1,
  },
  small: {
    id: 'small',
    name: 'Two-Lane Road',
    totalWidth: 16,
    pavedWidth: 10,
    speedLimit: 40,
    costPerMetre: 2,
  },
};

/** Road class used when none is specified. */
export const DEFAULT_ROAD_CLASS: RoadClassId = 'small';

/** A network node: an endpoint or junction, in world metres. */
export interface RoadNodeData {
  /** Stable id, unique within one network. */
  id: number;
  x: number;
  /** Ground elevation at the node. */
  y: number;
  z: number;
}

/** A network edge: one straight stretch of road between two nodes. */
export interface RoadEdgeData {
  /** Stable id, unique within one network. */
  id: number;
  /** Id of the node the segment starts at. */
  from: number;
  /** Id of the node the segment ends at. */
  to: number;
  /** Which {@link ROAD_CLASSES} entry this segment was built as. */
  roadClass: RoadClassId;
  /** Horizontal length in metres, cached at placement time. */
  length: number;
}

/** Serializable form of a whole road network. */
export interface RoadNetworkData {
  /** Next id handed out to a node or edge. Ids are never reused. */
  nextId: number;
  nodes: RoadNodeData[];
  edges: RoadEdgeData[];
}

/** Why a candidate segment cannot be built. */
export type RoadRejection =
  | 'no-start'
  | 'too-short'
  | 'too-long'
  | 'too-steep'
  | 'underwater'
  | 'out-of-bounds'
  | 'duplicate'
  | 'degenerate'
  | 'unaffordable';

/** Human-readable text for each rejection reason. */
export const ROAD_REJECTION_TEXT: Readonly<Record<RoadRejection, string>> = {
  'no-start': 'No start point',
  'too-short': 'Segment too short',
  'too-long': 'Segment too long',
  'too-steep': 'Ground too steep',
  underwater: 'Cannot build on water',
  'out-of-bounds': 'Outside the buildable area',
  duplicate: 'A road already connects these points',
  degenerate: 'Start and end are the same point',
  unaffordable: 'Not enough funds',
};

/** A snapped endpoint: a world position plus the node it reuses, if any. */
export interface RoadPoint {
  x: number;
  y: number;
  z: number;
  /** Existing node this point snapped onto, or `null` for a fresh position. */
  nodeId: number | null;
}

/** A fully resolved, validated candidate segment. */
export interface RoadPlan {
  /** True when {@link RoadNetwork.commit} would succeed. */
  ok: boolean;
  /** Why the plan is not buildable, or `null` when it is. */
  reason: RoadRejection | null;
  roadClass: RoadClassId;
  start: RoadPoint;
  end: RoadPoint;
  /** Horizontal length in metres. */
  length: number;
  /** Steepest grade found along the segment, as rise over run. */
  grade: number;
  /** Construction cost for this segment. */
  cost: number;
}

/** Anything that can report ground elevation, e.g. `Terrain`. */
export interface HeightSampler {
  heightAt(x: number, z: number): number;
}

/** Options accepted by {@link RoadNetwork}. */
export interface RoadNetworkOptions {
  /** Terrain used for elevation and grade checks. Flat ground when omitted. */
  sampler?: HeightSampler | null;
  /** Half-extent of the buildable world in metres. */
  bounds?: number;
}

/** An empty network. */
export function createRoadNetworkData(): RoadNetworkData {
  return { nextId: 1, nodes: [], edges: [] };
}

/** Deep copy of a network snapshot. */
export function cloneRoadNetworkData(data: RoadNetworkData): RoadNetworkData {
  return {
    nextId: data.nextId,
    nodes: data.nodes.map((n) => ({ ...n })),
    edges: data.edges.map((e) => ({ ...e })),
  };
}

/**
 * Coerce untrusted input (an old or hand-edited save) into a valid network.
 *
 * Malformed nodes and edges are dropped rather than throwing, edges referring to
 * missing nodes are discarded, and `nextId` is repaired so freshly placed roads
 * can never collide with restored ids.
 */
export function normalizeRoadNetworkData(input: unknown): RoadNetworkData {
  const out = createRoadNetworkData();
  const raw = input as Partial<RoadNetworkData> | null | undefined;
  if (!raw || typeof raw !== 'object') return out;

  const seen = new Set<number>();
  if (Array.isArray(raw.nodes)) {
    for (const n of raw.nodes) {
      if (!n || typeof n !== 'object') continue;
      const { id, x, y, z } = n as RoadNodeData;
      if (!isFiniteNumber(id) || seen.has(id)) continue;
      if (!isFiniteNumber(x) || !isFiniteNumber(z)) continue;
      seen.add(id);
      out.nodes.push({ id, x, y: isFiniteNumber(y) ? y : 0, z });
    }
  }

  const edgeIds = new Set<number>();
  if (Array.isArray(raw.edges)) {
    for (const e of raw.edges) {
      if (!e || typeof e !== 'object') continue;
      const { id, from, to, roadClass, length } = e as RoadEdgeData;
      if (!isFiniteNumber(id) || edgeIds.has(id)) continue;
      if (!seen.has(from) || !seen.has(to) || from === to) continue;
      const cls: RoadClassId = roadClass in ROAD_CLASSES ? roadClass : DEFAULT_ROAD_CLASS;
      const a = out.nodes.find((n) => n.id === from) as RoadNodeData;
      const b = out.nodes.find((n) => n.id === to) as RoadNodeData;
      edgeIds.add(id);
      out.edges.push({
        id,
        from,
        to,
        roadClass: cls,
        length: isFiniteNumber(length) ? length : Math.hypot(b.x - a.x, b.z - a.z),
      });
    }
  }

  let highest = 0;
  for (const n of out.nodes) highest = Math.max(highest, n.id);
  for (const e of out.edges) highest = Math.max(highest, e.id);
  const declared = isFiniteNumber(raw.nextId) ? raw.nextId : 0;
  out.nextId = Math.max(declared, highest + 1, 1);
  return out;
}

/** Snap a world coordinate to the zoning-cell grid. */
export function snapToGrid(value: number): number {
  const snapped = Math.round(value / ROAD_GRID) * ROAD_GRID;
  // Normalize negative zero so snapped coordinates compare and serialize cleanly.
  return snapped === 0 ? 0 : snapped;
}

/**
 * The road graph, wrapped around a plain {@link RoadNetworkData} living in the
 * game state so saving is just serializing that object.
 *
 * The host object is read on every access rather than cached, so replacing
 * `host.roads` wholesale (as loading a save does) is picked up immediately.
 */
export class RoadNetwork {
  /** Bumped on every mutation; renderers rebuild when it changes. */
  private revisionCounter = 0;

  private readonly host: { roads: RoadNetworkData };
  private sampler: HeightSampler | null;
  private bounds: number;

  /**
   * @param host Object owning the serializable network, typically `GameState`.
   * @param options Terrain sampler and world bounds.
   */
  constructor(host: { roads: RoadNetworkData }, options: RoadNetworkOptions = {}) {
    this.host = host;
    this.sampler = options.sampler ?? null;
    this.bounds = options.bounds ?? DEFAULT_WORLD_BOUNDS;
  }

  /** The live serializable network. */
  get data(): RoadNetworkData {
    return this.host.roads;
  }

  /** All nodes, in insertion order. */
  get nodes(): readonly RoadNodeData[] {
    return this.host.roads.nodes;
  }

  /** All edges, in insertion order. */
  get edges(): readonly RoadEdgeData[] {
    return this.host.roads.edges;
  }

  /** Monotonic change counter. */
  get revision(): number {
    return this.revisionCounter;
  }

  /** Total centreline length of the network, in metres. */
  get totalLength(): number {
    let sum = 0;
    for (const e of this.host.roads.edges) sum += e.length;
    return sum;
  }

  /** Attach (or detach) the terrain used for elevation and grade checks. */
  setSampler(sampler: HeightSampler | null): void {
    this.sampler = sampler;
    this.refreshNodeHeights();
  }

  /** Set the half-extent of the buildable world, in metres. */
  setBounds(bounds: number): void {
    this.bounds = bounds;
  }

  /** Ground elevation at a world position, or 0 without a sampler. */
  heightAt(x: number, z: number): number {
    return this.sampler ? this.sampler.heightAt(x, z) : 0;
  }

  /** Look up a node by id. */
  node(id: number): RoadNodeData | null {
    return this.host.roads.nodes.find((n) => n.id === id) ?? null;
  }

  /** Look up an edge by id. */
  edge(id: number): RoadEdgeData | null {
    return this.host.roads.edges.find((e) => e.id === id) ?? null;
  }

  /** Every edge touching a node. */
  edgesAt(nodeId: number): RoadEdgeData[] {
    return this.host.roads.edges.filter((e) => e.from === nodeId || e.to === nodeId);
  }

  /**
   * Nearest existing node to a world position.
   * @param radius Maximum distance in metres. Defaults to {@link NODE_SNAP_RADIUS}.
   */
  nearestNode(x: number, z: number, radius = NODE_SNAP_RADIUS): RoadNodeData | null {
    let best: RoadNodeData | null = null;
    let bestDist = radius;
    for (const n of this.host.roads.nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d <= bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Resolve a raw world position into a placement anchor: reuse a nearby node
   * when there is one, otherwise snap to the zoning-cell grid (roads.md §2).
   */
  snap(x: number, z: number): RoadPoint {
    const existing = this.nearestNode(x, z);
    if (existing) {
      return { x: existing.x, y: existing.y, z: existing.z, nodeId: existing.id };
    }
    const sx = snapToGrid(x);
    const sz = snapToGrid(z);
    return { x: sx, y: this.heightAt(sx, sz), z: sz, nodeId: null };
  }

  /**
   * Snap and validate a candidate segment without changing anything.
   *
   * @param ax Start x in raw world metres (unsnapped).
   * @param az Start z in raw world metres.
   * @param bx End x in raw world metres.
   * @param bz End z in raw world metres.
   * @param roadClass Class to price and validate against.
   */
  plan(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    roadClass: RoadClassId = DEFAULT_ROAD_CLASS,
  ): RoadPlan {
    const start = this.snap(ax, az);
    const end = this.snap(bx, bz);
    return this.planBetween(start, end, roadClass);
  }

  /** Validate a segment between two already-snapped endpoints. */
  planBetween(
    start: RoadPoint,
    end: RoadPoint,
    roadClass: RoadClassId = DEFAULT_ROAD_CLASS,
  ): RoadPlan {
    const cls = ROAD_CLASSES[roadClass] ? roadClass : DEFAULT_ROAD_CLASS;
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const plan: RoadPlan = {
      ok: false,
      reason: null,
      roadClass: cls,
      start,
      end,
      length,
      grade: 0,
      cost: Math.round(length * ROAD_CLASSES[cls].costPerMetre),
    };

    if (start.nodeId !== null && start.nodeId === end.nodeId) {
      plan.reason = 'degenerate';
      return plan;
    }
    if (length < MIN_SEGMENT_LENGTH) {
      plan.reason = length <= 1e-6 ? 'degenerate' : 'too-short';
      return plan;
    }
    if (length > MAX_SEGMENT_LENGTH) {
      plan.reason = 'too-long';
      return plan;
    }
    if (!this.inBounds(start.x, start.z) || !this.inBounds(end.x, end.z)) {
      plan.reason = 'out-of-bounds';
      return plan;
    }
    if (this.hasEdgeBetween(start.nodeId, end.nodeId)) {
      plan.reason = 'duplicate';
      return plan;
    }

    // Probe the ground along the centreline: any submerged sample or any step
    // steeper than MAX_ROAD_GRADE rejects the whole segment.
    const steps = Math.max(1, Math.ceil(length / TERRAIN_PROBE_SPACING));
    let previous = start.y;
    let steepest = 0;
    const stepLength = length / steps;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = start.x + (end.x - start.x) * t;
      const pz = start.z + (end.z - start.z) * t;
      const py = i === 0 ? start.y : i === steps ? end.y : this.heightAt(px, pz);
      if (py < MIN_ROAD_ELEVATION) {
        plan.reason = 'underwater';
        plan.grade = steepest;
        return plan;
      }
      if (i > 0) steepest = Math.max(steepest, Math.abs(py - previous) / stepLength);
      previous = py;
    }
    plan.grade = steepest;
    if (steepest > MAX_ROAD_GRADE) {
      plan.reason = 'too-steep';
      return plan;
    }

    plan.ok = true;
    return plan;
  }

  /**
   * Apply a plan, creating nodes as needed and appending the edge.
   *
   * @returns The new edge, or `null` when the plan was not buildable.
   */
  commit(plan: RoadPlan): RoadEdgeData | null {
    if (!plan.ok) return null;
    const from = plan.start.nodeId ?? this.addNode(plan.start.x, plan.start.z, plan.start.y);
    const to = plan.end.nodeId ?? this.addNode(plan.end.x, plan.end.z, plan.end.y);
    if (from === to) return null;

    const edge: RoadEdgeData = {
      id: this.takeId(),
      from,
      to,
      roadClass: plan.roadClass,
      length: plan.length,
    };
    this.host.roads.edges.push(edge);
    this.revisionCounter++;
    return edge;
  }

  /**
   * Plan and commit in one call — the convenience entry point used by tests and
   * the debug hook.
   *
   * @returns The new edge, or `null` if the segment was rejected.
   */
  placeSegment(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    roadClass: RoadClassId = DEFAULT_ROAD_CLASS,
  ): RoadEdgeData | null {
    return this.commit(this.plan(ax, az, bx, bz, roadClass));
  }

  /**
   * Add a standalone node at a world position, snapped to the zoning grid.
   * @returns The new node's id.
   */
  addNode(x: number, z: number, y = this.heightAt(x, z)): number {
    const node: RoadNodeData = { id: this.takeId(), x, y, z };
    this.host.roads.nodes.push(node);
    this.revisionCounter++;
    return node.id;
  }

  /**
   * Remove an edge, and any node left with no edges attached.
   * @returns `true` if the edge existed.
   */
  removeEdge(id: number): boolean {
    const edges = this.host.roads.edges;
    const index = edges.findIndex((e) => e.id === id);
    if (index < 0) return false;
    const [edge] = edges.splice(index, 1) as [RoadEdgeData];
    for (const nodeId of [edge.from, edge.to]) {
      if (this.edgesAt(nodeId).length === 0) {
        const ni = this.host.roads.nodes.findIndex((n) => n.id === nodeId);
        if (ni >= 0) this.host.roads.nodes.splice(ni, 1);
      }
    }
    this.revisionCounter++;
    return true;
  }

  /** Drop the whole network. */
  clear(): void {
    this.host.roads = createRoadNetworkData();
    this.revisionCounter++;
  }

  /**
   * Announce that the underlying data was replaced from outside (a save load),
   * so renderers rebuild.
   */
  markChanged(): void {
    this.revisionCounter++;
  }

  /** True when a segment already joins these two nodes, in either direction. */
  hasEdgeBetween(a: number | null, b: number | null): boolean {
    if (a === null || b === null) return false;
    return this.host.roads.edges.some(
      (e) => (e.from === a && e.to === b) || (e.from === b && e.to === a),
    );
  }

  /** True when a world position lies inside the buildable world. */
  inBounds(x: number, z: number): boolean {
    return Math.abs(x) <= this.bounds && Math.abs(z) <= this.bounds;
  }

  /** Re-sample every node's elevation from the current terrain. */
  private refreshNodeHeights(): void {
    if (!this.sampler) return;
    for (const n of this.host.roads.nodes) n.y = this.sampler.heightAt(n.x, n.z);
    this.revisionCounter++;
  }

  private takeId(): number {
    return this.host.roads.nextId++;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
