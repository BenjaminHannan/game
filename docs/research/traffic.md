# Traffic — statistical flow with visual vehicles

Implementation brief for the traffic milestone (ORCHESTRATION phase 7). Written against the
codebase as it stands after the roads milestone (`src/sim/roads.ts`, `src/sim/state.ts`,
`src/core/engine.ts`, `src/render/roadMesh.ts`) and alongside the zoning/simulation briefs
(`docs/research/zoning-growth.md`, `docs/research/simulation.md`), whose `BuildingData` and
`System` shapes this design consumes rather than redefines.

Binding decision from `docs/UNKNOWNS.md` (2026-08-08): **statistical flow per road edge plus
lightweight visual vehicles (instanced meshes moving along edges). No per-vehicle pathfinding in
v1.** The point of this doc is to make the cheap model good enough that it reads as real traffic,
and to shape its data so the eventual agent-based upgrade is an addition, not a rewrite.

Units are metres and seconds. Flow is expressed in **vehicles per hour (vph)** of simulated city
time so the numbers stay legible against real traffic-engineering intuition.

---

## 1. What the model is

Two layers that talk through exactly one array:

1. **Assignment (simulation, deterministic, saved-free).** Buildings generate trips. Trips are
   spread across the road graph by an iterative diffusion pass. Result: one `flow[e]` number per
   edge, plus a derived `congestion[e]` and `speed[e]`.
2. **Vehicles (render, non-deterministic, never touches game state).** A fixed pool of instanced
   meshes walks edge polylines. Where a vehicle goes at a junction is a flow-weighted coin flip;
   how fast it goes is `speed[e]`. Vehicles are a readout of layer 1 and can be switched off,
   throttled, or LOD-culled without changing a single simulation number.

The separation matters for the upgrade path: everything gameplay-visible (congestion penalties on
land value, travel-time effects, the traffic info view) reads layer 1. Layer 2 is decoration.

---

## 2. Per-edge data

Edge ids from `RoadNetwork` are stable but not contiguous (`nextId` never reuses). Traffic wants
contiguous slots for typed arrays, so the system keeps its own **slot table**, rebuilt whenever
`RoadNetwork.revision` changes — the same trigger `RoadRenderer` already uses.

```ts
/** Dense, revision-scoped view of the road graph for the traffic passes. */
export interface RoadTopology {
  /** RoadNetwork.revision this table was built from. */
  revision: number;
  /** edgeId -> slot, and slot -> edgeId. */
  slotOf: Map<number, number>;
  edgeId: Int32Array;          // [slotCount]
  /** Node slots for each edge end (nodes get their own dense slots too). */
  edgeA: Int32Array;           // [slotCount]
  edgeB: Int32Array;           // [slotCount]
  length: Float32Array;        // metres
  freeSpeed: Float32Array;     // m/s, from ROAD_CLASSES[..].speedLimit
  capacity: Float32Array;      // vph, see §3
  /** CSR adjacency: edges incident to node slot n are
   *  nodeEdges[nodeOffset[n] .. nodeOffset[n+1]). */
  nodeOffset: Int32Array;      // [nodeCount + 1]
  nodeEdges: Int32Array;       // [2 * slotCount]
}
```

Building the CSR table is a two-pass counting sort over edges: O(V + E), no allocation per edge.
It replaces `RoadNetwork.edgesAt()` inside the hot loops — that method allocates an array per call
and is fine for tools, fatal in a per-tick relaxation.

State proper is structure-of-arrays, sized to `slotCount` and reallocated (with copy by edge id)
only on topology change:

```ts
export interface TrafficState {
  topology: RoadTopology;
  /** Trips generated adjacent to this edge, vph. Written by the demand pass. */
  emit: Float32Array;
  /** Trip attraction adjacent to this edge, vph-equivalent. */
  attract: Float32Array;
  /** Assigned volume, vph. The one number the rest of the game reads. */
  flow: Float32Array;
  /** Scratch buffer for the Jacobi sweep; swapped with `flow`. */
  next: Float32Array;
  /** flow / capacity, clamped to [0, CONGESTION_CAP]. Derived, recomputed with flow. */
  congestion: Float32Array;
  /** Effective travel speed, m/s. Derived. */
  speed: Float32Array;
}
```

Nothing here is persisted. `flow` is fully derived from buildings + graph, so `deserialize`
simply marks traffic dirty and the next assignment pass refills it — consistent with the
"repair, don't trust" rule in the simulation brief, and one less save-migration surface.

---

## 3. Capacity and the congestion curve

Capacity comes from the road catalogue, as data, not special cases. Add to `RoadClass`:

```ts
/** Lanes carrying traffic (both directions summed). */
readonly lanes: number;
/** Vehicles per hour per lane at the point where flow degrades. */
readonly laneCapacity: number;
```

Suggested values, chosen to be internally consistent rather than sourced: `gravel` — 2 lanes,
500 vph/lane; `small` — 2 lanes, 800 vph/lane. `capacity[e] = lanes * laneCapacity`. Later road
tiers (medium/large/highway) slot in as more catalogue rows.

Speed degrades with a BPR-style curve, the standard shape in transport planning and cheap to
evaluate:

```ts
export const BPR_ALPHA = 0.9;
export const BPR_BETA = 4;
export const MIN_SPEED_FRACTION = 0.12;   // gridlock still crawls; never divide by zero

function travelSpeed(free: number, ratio: number): number {
  const factor = 1 / (1 + BPR_ALPHA * Math.pow(ratio, BPR_BETA));
  return free * Math.max(factor, MIN_SPEED_FRACTION);
}
```

Below ratio 0.7 the penalty is barely visible; past 1.0 it falls off a cliff. That matches the
lived feel of a city builder, where a road is fine until suddenly it very much is not.
`travelTime[e] = length[e] / speed[e]` is the cost function — and, crucially, it is the *same*
cost function a real router would use in v2 (§8).

---

## 4. Turning buildings into edge demand

`BuildingData` already carries the frontage `edgeId` of the lot's road (via the zoning pass), so
the mapping is direct and needs no spatial query.

```ts
export const TRIPS_PER_RESIDENT_PER_DAY = 2.2;
export const TRIPS_PER_JOB_PER_DAY = 1.8;
export const CAR_MODE_SHARE = 0.75;        // v1 has no transit; the rest is walking/none
export const PEAK_FACTOR = 0.11;           // fraction of daily trips in the peak hour
```

Daily pass (`Cadence.Daily`, per the simulation brief), O(buildings):

1. Zero `emit` and `attract`.
2. For each building: `trips = capacity * occupancy * TRIPS_PER_*_PER_DAY * CAR_MODE_SHARE * PEAK_FACTOR`.
   Residential adds to `emit[slot]`, commercial/industrial add to `attract[slot]`; each also adds a
   small share to the other side, since homes receive visitors and workplaces send delivery trips
   (`CROSS_SHARE = 0.25`).
3. Outside connections: every edge with a node on the map boundary gets a fixed
   `attract += OUTSIDE_ATTRACT` and `emit += OUTSIDE_EMIT`. This is what stops all traffic from
   being purely internal, and it is why a city with one border road jams at that road — the
   emergent behaviour players expect.

The building loop must not allocate. Buildings live in a flat array with an id→index map already;
iterate it by index.

---

## 5. Assignment by diffusion

The expensive thing in real traffic is "for every origin-destination pair, find a path." The cheap
thing that produces a strikingly similar-looking answer is **potential diffusion**: treat trip
generation as a source field, attraction as a sink field, and let volume equalise across the graph
in a handful of Jacobi sweeps.

Per node slot `n`, define excess `P[n]` = (sum of adjacent `emit`) − (sum of adjacent `attract`).
Flow then relaxes toward carrying volume from high potential to low, with each edge taking a share
proportional to its capacity (wide roads soak up more, which gives the road hierarchy meaning for
free):

```ts
export const DIFFUSION_SWEEPS = 6;
export const DIFFUSION_DECAY = 0.82;       // per sweep; models trips terminating
export const FLOW_SMOOTHING = 0.25;        // exponential smoothing toward the new solution

// one sweep, per edge slot e with ends a, b:
//   share  = capacity[e] / capacitySum[node]
//   inflow = decay * (P[a] * share_a + P[b] * share_b)
//   next[e] = base[e] + inflow
```

Cost: `DIFFUSION_SWEEPS * O(E)` plus two O(E) node-accumulation passes per sweep. At 2k buildings
a network is on the order of 1.5–3k edges, so a full solve is roughly 40k float operations —
sub-millisecond, and it runs **daily, not per tick**.

Three properties worth defending in review:

- **Convergence is not required.** Six sweeps is a deliberate truncation. The result is a smooth,
  plausible volume field, not a fixed point; nobody can tell, and it bounds the cost exactly.
- **Determinism.** Pure float arithmetic over a deterministic building list in a fixed slot order.
  No RNG, no Map iteration order (the slot table is built by sorted edge id). Same save → same
  flow.
- **Smoothing.** Write `flow = lerp(flow, next, FLOW_SMOOTHING)` rather than replacing outright, so
  congestion tinting and vehicle density ease into changes over a few days instead of popping when
  one building finishes.

Amortisation: if profiling ever shows the daily solve in frame, stripe it — run one sweep per day
and rotate, giving a full solve each in-game week. Do not build that until measured.

---

## 6. Visual vehicles

### Pool and instancing

One `THREE.InstancedMesh` per vehicle body variant (3–4 low-poly shapes: car, van, truck), each
with `instanceColor` for palette variation, all sharing one `MeshLambertMaterial` per variant to
match the flat-shaded look of the existing road and terrain meshes.

```ts
export const MAX_VEHICLES = 700;           // hard ceiling across all variants
export const VEHICLE_LENGTH = 4.4;         // metres, for spacing checks
```

Instances are never created or destroyed. Slots above the live count are parked by setting
`instancedMesh.count`, which is the cheapest possible "despawn" — no matrix writes, no draw cost,
no GC. Because live vehicles are kept compacted at the front of the array (swap-remove on
despawn), `count` alone is a correct cull.

Per-vehicle SoA, all preallocated at `MAX_VEHICLES`:

```ts
export interface VehiclePool {
  count: number;
  edge: Int32Array;      // current edge slot
  dir: Int8Array;        // +1 travelling A->B, -1 travelling B->A
  s: Float32Array;       // position along the edge, [0, 1]
  jitter: Float32Array;  // lateral lane offset in metres, signed by dir
  hops: Int16Array;      // junctions remaining before this trip ends
  variant: Uint8Array;
  tint: Uint8Array;
}
```

### Movement

Per rendered frame, for each live vehicle: `s += dir * speed[edge] * dt / length[edge]`. Position
is `lerp(nodeA, nodeB, sOrDirAdjusted)` plus `jitter * rightVector`, with `y` interpolated between
node elevations plus the existing `SURFACE_LIFT` so cars sit on the road ribbon rather than in it.
Per-edge unit direction, right vector, and end elevations are precomputed into the topology table,
so the per-vehicle cost is a handful of multiply-adds and one `Matrix4.compose` — the dominant
cost is the matrix write, not the math.

Vehicles move on the **render** callback with real `dt` scaled by `engine.getSpeed()`, not on the
sim tick. They are decoration; interpolating them at display rate is what makes the city look
alive, and it keeps them off the deterministic path entirely.

### Junction choice — the honest hand-wave

At `s` leaving [0,1], the vehicle arrives at a node. It picks its next edge by sampling the
incident edges (excluding the one it came from, unless that is the only option — dead ends make
U-turns, which is correct behaviour anyway) with weight `flow[e]`. Trips end when `hops` hits
zero, or immediately if the node has no other edge and the vehicle has already turned around once.

That single weighted choice is the whole "no pathfinding" decision. It produces vehicles that
crowd onto busy arterials and trickle down quiet residential streets, because those are exactly
the weights the diffusion pass produced. It does **not** produce vehicles that go anywhere in
particular — and no player can tell, because nobody follows one car across a city.

Use a dedicated `Rng` instance seeded from `performance.now()`, deliberately *not* the simulation
RNG stream. Vehicles must never be able to perturb deterministic sim state.

### Spawn budget

Target live count is `min(MAX_VEHICLES, totalFlow * VEHICLES_PER_VPH)` with
`VEHICLES_PER_VPH ≈ 0.02`, so an empty city has no cars and a busy one saturates the pool. Each
frame, spawn at most `SPAWN_PER_FRAME = 8` toward the target, choosing the edge by flow-weighted
sampling using a **prefix-sum table over `flow`** rebuilt on each assignment pass — O(log E) per
spawn via binary search, versus O(E) for naive roulette selection.

Two culls keep the pool spent where it is seen:

- **Distance**: edges beyond `VEHICLE_DRAW_DISTANCE = 900` m from the camera target are not spawn
  candidates, and vehicles that drift past `VEHICLE_DESPAWN_DISTANCE = 1100` m are recycled. The
  hysteresis gap prevents thrash at the boundary.
- **Zoom**: above a camera height threshold, scale the target count down and skip vehicles
  entirely past `VEHICLE_MAX_CAMERA_HEIGHT`. At that altitude individual cars are sub-pixel; the
  congestion tint (§7) carries the information instead.

Both culls are gameplay-neutral by construction, because gameplay reads `flow`, not vehicles.

---

## 7. Congestion tinting

`RoadRenderer.rebuild()` currently regenerates one merged geometry per revision. Extend it to
record, per edge id, the `[vertexStart, vertexCount)` range it wrote into the surface geometry,
and to allocate a `color` attribute on that geometry. Congestion tinting then becomes: on each
assignment pass, for each edge, write one RGB triple across its vertex range and set
`needsUpdate`. No geometry rebuild, no material swap, no extra draw call.

Palette (three stops, lerped by `congestion`): free-flowing keeps the base asphalt colour, so an
uncongested city looks normal rather than uniformly green; 0.6 → amber; 1.0+ → red. The overlay
should be gated behind a HUD toggle (a "traffic view", matching how the roads info view works in
the source material) with the default off, and a subtle always-on variant is worth prototyping —
a slight darkening of jammed roads reads as traffic grime without shouting.

Cost: ~3k float writes plus one buffer upload per assignment (daily). Negligible.

---

## 8. The upgrade path to real pathfinding

The v1 model is deliberately shaped so that v2 replaces **one function** and inherits everything
else:

- `flow`, `congestion`, `speed`, `travelTime` keep their meaning and their consumers. The traffic
  info view, land-value penalties, and any future emergency-response timing all read the same
  arrays whether they were filled by diffusion or by a router.
- The CSR adjacency in `RoadTopology` is already the graph an A\* or Dijkstra needs — same slots,
  same neighbour lists, same `travelTime` edge cost.
- Replace §5's diffusion with **incremental assignment**: split demand into 4 slices, and for each
  slice run shortest paths from a sampled set of origin edges to attraction-weighted destinations,
  load the volumes, recompute `speed` from the BPR curve, and repeat. That is the textbook
  algorithm, it converges toward a user-equilibrium, and it consumes exactly the `emit`/`attract`
  fields the demand pass already produces. The v1 diffusion result makes an excellent warm start.
- Vehicles gain a `path: Int32Array` and a cursor; the junction-choice function is deleted and
  everything else in `VehiclePool` — pooling, LOD, instancing, movement — is untouched.
- The one thing v1 must *not* do is let anything outside the traffic module reach into vehicle
  state or assume flow is symmetric per-edge. Keep flow directionless in v1 (one number per edge,
  not per direction); when direction matters, widen to `flow[e * 2 + dir]` behind the same
  accessor. Every consumer should go through `flowOf(edgeId)` / `congestionOf(edgeId)` helpers
  from day one so that widening is a one-file change.

---

## 9. Integration points

| Module | Change |
|---|---|
| `src/sim/roads.ts` | Add `lanes` + `laneCapacity` to `RoadClass` and both catalogue rows. No behavioural change. |
| `src/sim/traffic.ts` *(new)* | `RoadTopology` builder, `TrafficState`, demand pass, diffusion pass, `flowOf`/`congestionOf`/`speedOf` accessors. Pure data + math; no three.js, no DOM — testable like `roads.ts`. |
| `src/sim/state.ts` | Register `TrafficSystem` in the pipeline *after* the growth/demand systems so it reads settled building occupancy. Nothing added to `GameState`. |
| `src/render/vehicles.ts` *(new)* | `VehicleRenderer(traffic, network, terrain)` with `group`, `update(dt, camera)`, `dispose()` — the shape `RoadRenderer` already establishes. Added to the scene and ticked in `main.ts`'s frame callback next to `roadRenderer.update()`. |
| `src/render/roadMesh.ts` | Record per-edge vertex ranges during `rebuild()`; add a vertex colour attribute and a `setCongestion(traffic)` method. |
| `src/ui/hud.ts` | Traffic-view toggle; optionally a "worst congested road" readout. |
| `src/main.ts` | Construct the vehicle renderer, wire the frame callback, expose `traffic` on the debug API so Playwright tests can assert on flow without reading pixels. |

Save format is untouched. That is a feature: the traffic milestone ships without a migration.

---

## 10. Performance budget

Against 1–2k buildings / ~2–3k edges at 60 fps:

- **Daily assignment**: ~40k float ops plus two O(E) accumulations per sweep. Target < 0.5 ms;
  runs once per in-game day, so its amortised per-frame cost is effectively zero.
- **Per-frame vehicles**: 700 instances × (one lerp + one `compose` + one 16-float matrix write)
  ≈ 12k float writes/frame. That is well under 0.5 ms in practice; the risk is not arithmetic but
  allocation, so the update loop must reuse module-level scratch `Vector3`/`Quaternion`/`Matrix4`
  objects and never construct inside the loop.
- **Draw calls**: 3–4, one per vehicle variant, regardless of vehicle count. This is the entire
  reason for instancing and it must not be compromised by per-vehicle materials.
- **GC**: zero steady-state allocation in both passes. Every array is preallocated; the only
  allocations happen on topology change (road placed or bulldozed), which is user-paced.
- **Memory**: per-edge arrays at 3k edges ≈ 100 KB; vehicle pool at 700 ≈ 25 KB plus three
  instance matrix buffers. Rounding error next to the terrain and building meshes.

The realistic failure mode is not the traffic math — it is `roadMesh` rebuilding its merged
geometry every time congestion changes. The per-edge vertex range table in §7 exists specifically
to prevent that, and any implementation that instead calls `rebuild()` on flow change has missed
the point of the design.

---

## 11. Test plan

Pure-module tests (vitest, no DOM), against `src/sim/traffic.ts`:

1. **Topology** — build a small hand-made network; assert CSR adjacency matches `edgesAt()` for
   every node, that slot tables survive an edge removal, and that flow values follow their edge id
   across a rebuild rather than following the slot index.
2. **Determinism** — run the demand + diffusion passes twice over identical state; assert
   bit-identical `flow` arrays. Then serialize/deserialize the sim, re-run, and assert the same
   result, proving flow is genuinely derived.
3. **Conservation-ish sanity** — with a single residential building on a dead-end street and one
   outside connection, assert flow is strictly positive along every edge on the connecting chain
   and zero on a disconnected component. A disconnected subgraph carrying traffic is the most
   likely diffusion bug and this catches it directly.
4. **Hierarchy** — two parallel routes between the same nodes, one `gravel` and one `small`;
   assert the higher-capacity route takes the larger share.
5. **Congestion curve** — unit-test `travelSpeed` at ratios 0, 0.5, 1, 2, 10: monotonically
   decreasing, never below `MIN_SPEED_FRACTION * free`, never NaN at ratio 0 or with zero-capacity
   input.
6. **Demand mapping** — a building with zero occupancy contributes zero; doubling capacity doubles
   its contribution; a building whose frontage edge was bulldozed contributes nowhere and does not
   throw.
7. **Vehicle pool logic** — extract junction choice and spawn/despawn bookkeeping into pure
   functions taking an injected RNG so they can be tested headlessly: assert the pool never exceeds
   `MAX_VEHICLES`, that swap-remove keeps live vehicles compacted below `count`, that a vehicle on
   a removed edge is recycled rather than reading a stale slot, and that flow-weighted choice with
   one dominant neighbour picks it with the expected frequency under a seeded RNG.
8. **Integration smoke** (Playwright, phase 10) — place a road grid, zone, run at 4× until
   buildings appear, then assert via the debug API that total flow is positive and that the vehicle
   count settles below the cap without the frame rate dropping below 55 fps.
