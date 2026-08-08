/**
 * Visual vehicles: a pooled, instanced readout of the traffic flow field.
 *
 * `docs/research/traffic.md` §6. These cars are **decoration**. They read
 * `flow` and `speed` from `src/sim/traffic.ts` and write nothing back, they move
 * on the render callback with real frame time rather than on the simulation
 * tick, and they draw from their own RNG stream seeded off the wall clock so
 * they can never perturb deterministic sim state. Switching them off, throttling
 * them, or culling them changes no simulation number — which is exactly why the
 * spawn budget is allowed to be as aggressive as it is (this is CS2's own
 * traffic-reduction coefficient taken to its logical end,
 * `cs2/traffic-pathfinding.md` §8).
 *
 * The pool is fixed. Instances are never created or destroyed: live vehicles are
 * compacted at the front of the arrays by swap-remove, so publishing
 * `InstancedMesh.count` is a correct and completely free cull.
 *
 * Junction choice is the honest hand-wave — a flow-weighted draw over the
 * incident edges. It produces vehicles that crowd onto busy arterials and
 * trickle down quiet streets, because those are the weights the diffusion pass
 * produced. It does not produce vehicles that go anywhere in particular, and no
 * player can tell, because nobody follows one car across a city.
 *
 * The pool bookkeeping below (spawn, despawn, junction choice, remap) is pure
 * and takes an injected random sample, so it is tested headlessly.
 */

import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { sampleEdgeByFlow, type RoadTopology, type TrafficField } from '../sim/traffic.js';
import { SURFACE_LIFT } from './roadMesh.js';

/** Hard ceiling on live vehicles across every variant. */
export const MAX_VEHICLES = 700;

/** Nominal vehicle length in metres, used for spacing and geometry. */
export const VEHICLE_LENGTH = 4.4;

/** Live vehicles targeted per vehicle-per-hour of citywide flow. */
export const VEHICLES_PER_VPH = 0.02;

/** Most vehicles spawned in one frame, so a sudden solve cannot spike. */
export const SPAWN_PER_FRAME = 8;

/** Edges further than this from the camera target are not spawn candidates. */
export const VEHICLE_DRAW_DISTANCE = 900;

/** Vehicles drifting past this from the camera target are recycled. */
export const VEHICLE_DESPAWN_DISTANCE = 1100;

/** Camera height above which the target count starts falling off. */
export const VEHICLE_FADE_HEIGHT = 700;

/** Camera height above which no vehicles are drawn at all. */
export const VEHICLE_MAX_CAMERA_HEIGHT = 1400;

/** Lateral offset from the centreline, in metres: right-hand traffic. */
export const VEHICLE_LANE_OFFSET = 2.1;

/** Height above the carriageway a vehicle's wheels sit at. */
export const VEHICLE_LIFT = SURFACE_LIFT + 0.05;

/** Fewest junctions a spawned trip crosses before it ends. */
export const MIN_TRIP_HOPS = 3;

/** Most junctions a spawned trip crosses before it ends. */
export const MAX_TRIP_HOPS = 14;

/** Floor on an edge's draw weight, so a zero-flow street is rare, not banned. */
export const MIN_TURN_WEIGHT = 1;

/** Slowest a vehicle may crawl, in m/s, so a stalled car cannot wedge the pool. */
export const MIN_VEHICLE_SPEED = 1.5;

/** One low-poly body shape. */
export interface VehicleVariant {
  readonly name: string;
  /** Body length in metres, along the direction of travel. */
  readonly length: number;
  readonly width: number;
  readonly height: number;
  /** Share of the body length taken by the raised cab. */
  readonly cabFraction: number;
  /** Relative share of spawns this variant takes. */
  readonly weight: number;
}

/** The vehicle catalogue. Data, not special cases — the road catalogue's shape. */
export const VEHICLE_VARIANTS: readonly VehicleVariant[] = [
  { name: 'car', length: VEHICLE_LENGTH, width: 1.9, height: 0.85, cabFraction: 0.5, weight: 7 },
  { name: 'van', length: 5.4, width: 2.1, height: 1.35, cabFraction: 0.3, weight: 2 },
  { name: 'truck', length: 7.6, width: 2.5, height: 1.7, cabFraction: 0.28, weight: 1 },
];

/** Body colours drawn per instance; original palette, muted to match the city. */
export const VEHICLE_COLORS: readonly number[] = [
  0xd8dde3, 0x2f3a4a, 0x9aa4b0, 0xb4483f, 0x3c6e8f, 0x5c6f52, 0xe0b45c, 0x6d5a7a,
];

/**
 * Per-vehicle struct-of-arrays, all preallocated at capacity.
 *
 * `edge` holds a topology **slot**, not an edge id; {@link remapVehicles}
 * translates them through edge ids whenever the slot table is rebuilt, which is
 * what stops a bulldozed road from teleporting its cars onto a stranger's street.
 */
export interface VehiclePool {
  /** Live vehicles, always occupying indices `[0, count)`. */
  count: number;
  /** Slots the arrays were allocated for. */
  readonly capacity: number;
  edge: Int32Array;
  /** +1 travelling A->B, -1 travelling B->A. */
  dir: Int8Array;
  /** Position along the edge, `[0, 1]`. */
  s: Float32Array;
  /** Lateral lane offset magnitude in metres; the sign comes from `dir`. */
  jitter: Float32Array;
  /** Junctions remaining before this trip ends. */
  hops: Int16Array;
  variant: Uint8Array;
  tint: Uint8Array;
}

/** An empty pool. */
export function createVehiclePool(capacity: number = MAX_VEHICLES): VehiclePool {
  const size = Math.max(0, Math.floor(capacity));
  return {
    count: 0,
    capacity: size,
    edge: new Int32Array(size),
    dir: new Int8Array(size),
    s: new Float32Array(size),
    jitter: new Float32Array(size),
    hops: new Int16Array(size),
    variant: new Uint8Array(size),
    tint: new Uint8Array(size),
  };
}

/**
 * Append one vehicle.
 *
 * @returns Its index, or -1 when the pool is full. Never grows the arrays: the
 *   ceiling is the point.
 */
export function spawnVehicle(
  pool: VehiclePool,
  edge: number,
  dir: 1 | -1,
  s: number,
  jitter: number,
  hops: number,
  variant: number,
  tint: number,
): number {
  if (pool.count >= pool.capacity) return -1;
  const i = pool.count++;
  pool.edge[i] = edge;
  pool.dir[i] = dir;
  pool.s[i] = s;
  pool.jitter[i] = jitter;
  pool.hops[i] = hops;
  pool.variant[i] = variant;
  pool.tint[i] = tint;
  return i;
}

/**
 * Recycle one vehicle by swapping the last live entry into its place.
 *
 * The caller must not advance its loop cursor after a despawn — the index it was
 * looking at now holds a different vehicle.
 *
 * @returns `true` if the index held a live vehicle.
 */
export function despawnVehicle(pool: VehiclePool, index: number): boolean {
  if (index < 0 || index >= pool.count) return false;
  const last = pool.count - 1;
  if (index !== last) {
    pool.edge[index] = pool.edge[last] as number;
    pool.dir[index] = pool.dir[last] as number;
    pool.s[index] = pool.s[last] as number;
    pool.jitter[index] = pool.jitter[last] as number;
    pool.hops[index] = pool.hops[last] as number;
    pool.variant[index] = pool.variant[last] as number;
    pool.tint[index] = pool.tint[last] as number;
  }
  pool.count = last;
  return true;
}

/**
 * Translate every vehicle's edge slot from one topology to the next, recycling
 * the vehicles whose edge no longer exists.
 *
 * Called after the slot table is rebuilt (a road was placed or bulldozed). Cars
 * on surviving roads keep driving; cars on a demolished road disappear rather
 * than reading a stale slot.
 *
 * @returns How many vehicles survived.
 */
export function remapVehicles(
  pool: VehiclePool,
  previous: RoadTopology,
  next: RoadTopology,
): number {
  let i = 0;
  while (i < pool.count) {
    const slot = pool.edge[i] as number;
    const edgeId = slot >= 0 && slot < previous.slotCount ? (previous.edgeId[slot] as number) : -1;
    const moved = edgeId < 0 ? undefined : next.slotOf.get(edgeId);
    if (moved === undefined) {
      despawnVehicle(pool, i);
      continue;
    }
    pool.edge[i] = moved;
    i++;
  }
  return pool.count;
}

/**
 * Choose the edge a vehicle leaves a node on, weighted by flow.
 *
 * The edge it arrived on is excluded unless it is the only one — a dead end
 * makes a U-turn, which is the correct behaviour anyway.
 *
 * @param topology Dense graph view.
 * @param flow Assigned volume per edge slot.
 * @param fromEdge Edge slot the vehicle arrived on.
 * @param node Node slot it arrived at.
 * @param r Uniform sample in `[0, 1)`, from the *vehicle* RNG stream.
 * @returns An edge slot; `fromEdge` for a U-turn, -1 for an isolated node.
 */
export function chooseNextEdge(
  topology: RoadTopology,
  flow: Float32Array,
  fromEdge: number,
  node: number,
  r: number,
): number {
  if (node < 0 || node >= topology.nodeCount) return -1;
  const from = topology.nodeOffset[node] as number;
  const to = topology.nodeOffset[node + 1] as number;
  if (from === to) return -1;

  let total = 0;
  for (let k = from; k < to; k++) {
    const edge = topology.nodeEdges[k] as number;
    if (edge === fromEdge) continue;
    total += Math.max(flow[edge] as number, MIN_TURN_WEIGHT);
  }
  if (!(total > 0)) return fromEdge;

  const target = Math.min(Math.max(r, 0), 0.999999) * total;
  let running = 0;
  for (let k = from; k < to; k++) {
    const edge = topology.nodeEdges[k] as number;
    if (edge === fromEdge) continue;
    running += Math.max(flow[edge] as number, MIN_TURN_WEIGHT);
    if (target < running) return edge;
  }
  return fromEdge;
}

/**
 * Live vehicles this frame should be aiming at.
 *
 * Proportional to citywide flow so an empty city has no cars and a busy one
 * saturates the pool, then faded out with camera height because at altitude a
 * car is sub-pixel and the congestion tint carries the information instead.
 */
export function targetVehicleCount(
  totalFlow: number,
  cameraHeight: number,
  cap = MAX_VEHICLES,
): number {
  if (!(totalFlow > 0)) return 0;
  if (!Number.isFinite(cameraHeight)) return 0;
  if (cameraHeight >= VEHICLE_MAX_CAMERA_HEIGHT) return 0;
  const fade =
    cameraHeight <= VEHICLE_FADE_HEIGHT
      ? 1
      : 1 -
        (cameraHeight - VEHICLE_FADE_HEIGHT) /
          (VEHICLE_MAX_CAMERA_HEIGHT - VEHICLE_FADE_HEIGHT);
  // Rounded up rather than down: a city with any flow at all should show at
  // least one car, or a young city reads as broken rather than quiet.
  const want = Math.ceil(totalFlow * VEHICLES_PER_VPH * fade);
  return Math.max(0, Math.min(cap, want));
}

/** Construction options for {@link VehicleRenderer}. */
export interface VehicleRendererOptions {
  /** The flow field the vehicles read. */
  traffic: TrafficField;
  /** Pool ceiling. Lower it for a graphics setting; never raise it per frame. */
  maxVehicles?: number;
  /** Seed for the vehicle RNG stream. Defaults to the wall clock, on purpose. */
  seed?: number;
}

/**
 * Keeps a pool of instanced vehicle meshes walking the road graph.
 *
 * One `InstancedMesh` per body variant — three draw calls for the whole city's
 * traffic, regardless of vehicle count, which is the entire reason for
 * instancing and must not be compromised by per-vehicle materials.
 */
export class VehicleRenderer {
  /** Scene node holding every vehicle mesh. */
  readonly group = new THREE.Group();

  /** The live pool. Exposed read-mostly for the debug API and tests. */
  readonly pool: VehiclePool;

  private readonly traffic: TrafficField;
  private readonly rng: Rng;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly material: THREE.MeshLambertMaterial;
  private readonly used: number[] = [];
  private readonly variantPick: number[] = [];

  private topology: RoadTopology;
  private enabled = true;
  private lastTarget = 0;

  /** Scratch reused every write; the frame path allocates nothing per vehicle. */
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3(1, 1, 1);
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchColor = new THREE.Color();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(options: VehicleRendererOptions) {
    this.traffic = options.traffic;
    this.topology = options.traffic.topology;
    this.pool = createVehiclePool(options.maxVehicles ?? MAX_VEHICLES);
    this.rng = new Rng(options.seed ?? (Date.now() & 0xffffffff) >>> 0);
    this.group.name = 'Vehicles';
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });

    for (let v = 0; v < VEHICLE_VARIANTS.length; v++) {
      const variant = VEHICLE_VARIANTS[v] as VehicleVariant;
      const mesh = new THREE.InstancedMesh(
        vehicleGeometry(variant),
        this.material,
        this.pool.capacity,
      );
      mesh.name = `Vehicles:${variant.name}`;
      mesh.count = 0;
      mesh.castShadow = true;
      // Vehicles are spread over the whole city; culling the instanced mesh as
      // one sphere would pop the entire fleet in and out.
      mesh.frustumCulled = false;
      mesh.setColorAt(0, this.scratchColor.setHex(0xffffff));
      this.meshes.push(mesh);
      this.used.push(0);
      this.group.add(mesh);
    }

    // Expand the variant weights once into a pick table, so choosing a body is
    // one array index rather than a loop.
    for (let v = 0; v < VEHICLE_VARIANTS.length; v++) {
      const variant = VEHICLE_VARIANTS[v] as VehicleVariant;
      for (let i = 0; i < variant.weight; i++) this.variantPick.push(v);
    }
  }

  /** Live vehicles. */
  get count(): number {
    return this.pool.count;
  }

  /** Live vehicles the last update was aiming at. */
  get target(): number {
    return this.lastTarget;
  }

  /** Draw calls the fleet costs: one per non-empty variant mesh. */
  get drawCalls(): number {
    let calls = 0;
    for (const mesh of this.meshes) if (mesh.count > 0) calls++;
    return calls;
  }

  /** Whether vehicles are drawn at all. A graphics setting, not a game rule. */
  get visible(): boolean {
    return this.enabled;
  }

  /** Show or hide the whole fleet; hiding also empties the pool. */
  setVisible(visible: boolean): void {
    this.enabled = visible;
    this.group.visible = visible;
    if (!visible) {
      this.pool.count = 0;
      for (let v = 0; v < this.used.length; v++) this.used[v] = 0;
      this.publish();
    }
  }

  /**
   * Advance every vehicle and top the pool up. Call once per rendered frame.
   *
   * @param dt Frame time in seconds, already scaled by the engine's speed.
   * @param targetX Camera focus x in metres, for the distance culls.
   * @param targetZ Camera focus z in metres.
   * @param cameraHeight Camera height in metres, for the zoom cull.
   */
  update(dt: number, targetX: number, targetZ: number, cameraHeight: number): void {
    if (this.traffic.topology !== this.topology) {
      remapVehicles(this.pool, this.topology, this.traffic.topology);
      this.topology = this.traffic.topology;
    }
    if (!this.enabled) return;

    const topology = this.topology;
    const flow = this.traffic.state.flow;
    const speed = this.traffic.state.speed;
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;

    let i = 0;
    while (i < this.pool.count) {
      const edge = this.pool.edge[i] as number;
      if (edge < 0 || edge >= topology.slotCount) {
        despawnVehicle(this.pool, i);
        continue;
      }
      const length = topology.length[edge] as number;
      const pace = Math.max(speed[edge] as number, MIN_VEHICLE_SPEED);
      const dir = this.pool.dir[i] as number;
      let s = (this.pool.s[i] as number) + (dir * pace * step) / length;

      if (s > 1 || s < 0) {
        // Arrived at a junction: end the trip, or pick the next edge.
        const node = s > 1 ? (topology.edgeB[edge] as number) : (topology.edgeA[edge] as number);
        const hops = (this.pool.hops[i] as number) - 1;
        if (hops <= 0) {
          despawnVehicle(this.pool, i);
          continue;
        }
        const nextEdge = chooseNextEdge(topology, flow, edge, node, this.rng.float());
        if (nextEdge < 0) {
          despawnVehicle(this.pool, i);
          continue;
        }
        this.pool.hops[i] = hops;
        this.pool.edge[i] = nextEdge;
        if ((topology.edgeA[nextEdge] as number) === node) {
          this.pool.dir[i] = 1;
          s = 0;
        } else {
          this.pool.dir[i] = -1;
          s = 1;
        }
      }
      this.pool.s[i] = s;

      const a = topology.edgeA[this.pool.edge[i] as number] as number;
      const b = topology.edgeB[this.pool.edge[i] as number] as number;
      const ax = topology.nodeX[a] as number;
      const az = topology.nodeZ[a] as number;
      const bx = topology.nodeX[b] as number;
      const bz = topology.nodeZ[b] as number;
      const x = ax + (bx - ax) * s;
      const z = az + (bz - az) * s;
      if (Math.hypot(x - targetX, z - targetZ) > VEHICLE_DESPAWN_DISTANCE) {
        despawnVehicle(this.pool, i);
        continue;
      }
      i++;
    }

    this.lastTarget = targetVehicleCount(
      this.traffic.totalFlow,
      cameraHeight,
      this.pool.capacity,
    );
    if (this.pool.count > this.lastTarget) {
      // Over budget after a zoom-out: trim from the back, which is free.
      this.pool.count = this.lastTarget;
    } else {
      this.spawn(targetX, targetZ);
    }

    this.writeInstances();
  }

  /** Release every GPU resource this renderer owns. */
  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
  }

  /** Top the pool up toward the target, at most `SPAWN_PER_FRAME` per frame. */
  private spawn(targetX: number, targetZ: number): void {
    const topology = this.topology;
    if (topology.slotCount === 0) return;
    const prefix = this.traffic.state.prefix;
    const budget = Math.min(SPAWN_PER_FRAME, this.lastTarget - this.pool.count);
    for (let n = 0; n < budget; n++) {
      const edge = sampleEdgeByFlow(prefix, topology.slotCount, this.rng.float());
      if (edge < 0) return;
      const a = topology.edgeA[edge] as number;
      const b = topology.edgeB[edge] as number;
      const midX = ((topology.nodeX[a] as number) + (topology.nodeX[b] as number)) / 2;
      const midZ = ((topology.nodeZ[a] as number) + (topology.nodeZ[b] as number)) / 2;
      // Hysteresis against the despawn radius: spawning inside the smaller
      // circle and recycling outside the larger one stops thrash at the edge.
      if (Math.hypot(midX - targetX, midZ - targetZ) > VEHICLE_DRAW_DISTANCE) continue;
      spawnVehicle(
        this.pool,
        edge,
        this.rng.chance(0.5) ? 1 : -1,
        this.rng.float(),
        VEHICLE_LANE_OFFSET,
        this.rng.int(MIN_TRIP_HOPS, MAX_TRIP_HOPS + 1),
        this.variantPick[this.rng.int(0, this.variantPick.length)] as number,
        this.rng.int(0, VEHICLE_COLORS.length),
      );
    }
  }

  /** Write one matrix per live vehicle and publish the instance counts. */
  private writeInstances(): void {
    for (let v = 0; v < this.used.length; v++) this.used[v] = 0;
    const topology = this.topology;

    for (let i = 0; i < this.pool.count; i++) {
      const edge = this.pool.edge[i] as number;
      const a = topology.edgeA[edge] as number;
      const b = topology.edgeB[edge] as number;
      const ax = topology.nodeX[a] as number;
      const ay = topology.nodeY[a] as number;
      const az = topology.nodeZ[a] as number;
      const bx = topology.nodeX[b] as number;
      const by = topology.nodeY[b] as number;
      const bz = topology.nodeZ[b] as number;
      const dx = bx - ax;
      const dz = bz - az;
      const span = Math.hypot(dx, dz) || 1;
      const ux = dx / span;
      const uz = dz / span;
      const s = this.pool.s[i] as number;
      const dir = this.pool.dir[i] as number;
      // Right of the direction of travel, so opposing streams pass correctly.
      const offset = (this.pool.jitter[i] as number) * dir;
      const rx = -uz * offset;
      const rz = ux * offset;

      const variantIndex = this.pool.variant[i] as number;
      const mesh = this.meshes[variantIndex] as THREE.InstancedMesh;
      const slot = this.used[variantIndex] as number;
      if (slot >= this.pool.capacity) continue;
      this.used[variantIndex] = slot + 1;

      this.scratchPosition.set(
        ax + dx * s + rx,
        ay + (by - ay) * s + VEHICLE_LIFT,
        az + dz * s + rz,
      );
      this.scratchQuaternion.setFromAxisAngle(
        VehicleRenderer.UP,
        Math.atan2(ux * dir, uz * dir),
      );
      this.scratchMatrix.compose(
        this.scratchPosition,
        this.scratchQuaternion,
        this.scratchScale,
      );
      mesh.setMatrixAt(slot, this.scratchMatrix);
      mesh.setColorAt(
        slot,
        this.scratchColor.setHex(VEHICLE_COLORS[this.pool.tint[i] as number] as number),
      );
    }

    this.publish();
  }

  /** Publish instance counts and buffer updates to the GPU. */
  private publish(): void {
    for (let v = 0; v < this.meshes.length; v++) {
      const mesh = this.meshes[v] as THREE.InstancedMesh;
      mesh.count = this.used[v] as number;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/**
 * A body and a raised cab, merged into one geometry so a variant stays one draw
 * call. The shape points along +Z and is anchored at its own base, so the
 * per-vehicle matrix is a pure Y-rotation plus a translate.
 */
function vehicleGeometry(variant: VehicleVariant): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(variant.width, variant.height, variant.length);
  body.translate(0, variant.height / 2, 0);
  const cabHeight = variant.height * 0.75;
  const cab = new THREE.BoxGeometry(
    variant.width * 0.82,
    cabHeight,
    variant.length * variant.cabFraction,
  );
  cab.translate(0, variant.height + cabHeight / 2, -variant.length * 0.08);

  const merged = new THREE.BufferGeometry();
  const parts = [body.toNonIndexed(), cab.toNonIndexed()];
  let vertices = 0;
  for (const part of parts) vertices += part.getAttribute('position').count;
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  let offset = 0;
  for (const part of parts) {
    positions.set(part.getAttribute('position').array as Float32Array, offset);
    normals.set(part.getAttribute('normal').array as Float32Array, offset);
    offset += part.getAttribute('position').count * 3;
    part.dispose();
  }
  body.dispose();
  cab.dispose();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.computeBoundingSphere();
  return merged;
}
