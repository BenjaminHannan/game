# Zoning and Building Growth — design for Metropolis

Design notes for the zoning/growth milestone (ORCHESTRATION phase 4). This doc is the
implementation brief: it fixes the data structures, the algorithms, the seams against the
modules that already exist, and the perf budget. It is written against the codebase as of the
roads milestone (`src/sim/roads.ts`, `src/input/tools.ts`, `src/core/rng.ts`, `src/core/save.ts`).

Binding context from `docs/UNKNOWNS.md`: painted zone cells along road frontage with CS-style
drag painting; low-poly flat-shaded art with a zone-conventional palette; ~1–2k buildings at
60 fps via instancing; first five minutes = lay roads, paint zones, watch buildings grow.
Building *levels* are explicitly out of scope for this milestone — the data model reserves a
`level` field but growth only ever writes level 1.

Units are metres throughout, matching roads. The zoning cell is **8 m**, the same
`ROAD_GRID` constant road endpoints already snap to (`src/sim/roads.ts`), so the zone grid and
the road grid are the same grid by construction — no second alignment system.

---

## 1. The cell grid

The world is `WORLD_SIZE = 4096` m (`src/render/terrain.ts`), so an 8 m grid is 512 × 512 =
262 144 cells. That is small enough to address densely but far too large to *store* densely as
objects. The rule: **dense typed arrays for derived data, sparse map for authored data.**

```ts
export const ZONE_CELL = 8;                 // metres; === ROAD_GRID
export const ZONE_GRID_SIZE = 512;          // cells per side
export const ZONE_MAX_DEPTH = 4;            // cells of buildable depth behind frontage (32 m)

/** Packed cell key: cz * ZONE_GRID_SIZE + cx, both in [0, ZONE_GRID_SIZE). */
export type CellKey = number;

export function cellKey(cx: number, cz: number): CellKey { return cz * ZONE_GRID_SIZE + cx; }
export function cellX(k: CellKey): number { return k % ZONE_GRID_SIZE; }
export function cellZ(k: CellKey): number { return (k / ZONE_GRID_SIZE) | 0; }

/** World centre of a cell, in metres (world origin is the map centre). */
export function cellCentre(k: CellKey): { x: number; z: number };
/** Cell containing a world position, or -1 when outside the grid. */
export function cellAt(x: number, z: number): CellKey;
```

Zone types mirror the RCI triple plus the eraser:

```ts
export type ZoneType = 'residential' | 'commercial' | 'industrial';
export type ZonePaint = ZoneType | 'none';   // 'none' is the de-zone brush
```

Three parallel arrays own all per-cell state:

| array | type | length | meaning |
|---|---|---|---|
| `zone` | `Uint8Array` | 262 144 | 0 = unzoned, 1/2/3 = R/C/I (authored) |
| `frontage` | `Int32Array` | 262 144 | road edge id this cell fronts, or −1 (derived) |
| `occupant` | `Int32Array` | 262 144 | building id sitting on this cell, or −1 (derived) |

Three arrays of 256–1024 KB each is ~2 MB of ArrayBuffer, allocated once at startup. Nothing
per-cell is ever a JS object, so there is no GC pressure from zoning at all.

`frontage` additionally encodes orientation: alongside it keep a `Uint8Array facing` giving the
quadrant direction (0=+x, 1=+z, 2=−x, 3=−z) from the cell toward its road, and a `Uint8Array
depth` giving the cell's rank back from the road (0 = touching the verge). Both are derived,
both rebuild with `frontage`.

---

## 2. Deriving zonable cells from the road graph

A cell is **zonable** iff it has a road frontage: it lies within `ZONE_MAX_DEPTH` cells of a
road edge's right-of-way, on a straight line perpendicular to that edge, with no other road
between it and its edge.

Algorithm — `rebuildFrontage(network: RoadNetwork)`, a full recompute:

1. Clear `frontage` to −1, `depth` to 255.
2. **Mask the road footprint.** For each edge, walk its centreline in `ZONE_CELL/2` steps and
   stamp every cell whose centre is within `ROAD_CLASSES[e.roadClass].totalWidth / 2` of the
   line as *road-occupied* (`frontage = -2`, a sentinel distinct from "no frontage"). Doing
   this for the whole network first is what makes step 3 order-independent: a cell already
   under asphalt can never be claimed as a lot.
3. **Cast frontage outward.** For each edge, again walking in half-cell steps, compute the
   unit normal `n = (dz, -dx)/len`. For each side `s ∈ {+1, −1}` and each depth
   `d ∈ [0, ZONE_MAX_DEPTH)`, probe the point
   `p = centre + n·s·(halfWidth + (d + 0.5)·ZONE_CELL)`. Take `k = cellAt(p)`; skip if it is
   road-occupied, out of bounds, below `MIN_ROAD_ELEVATION` (reuse the terrain sampler — no
   lots in water), or already claimed at a *shallower or equal* depth. Otherwise write
   `frontage[k] = e.id`, `depth[k] = d`, `facing[k] = quadrant(-n·s)`. **Break out of the depth
   loop on the first road-occupied probe**, so a parallel street two cells away correctly
   splits the block instead of letting one road reach through it.
4. Bump a `frontageRevision` counter.

Cost: the network at 1–2k buildings is on the order of 300–600 edges averaging ~100 m, so
~10 k centreline steps × 2 sides × 4 depths ≈ 80 k cheap probes — low single-digit
milliseconds. That is fine as a **full rebuild triggered lazily** whenever
`network.revision !== builtRevision`, checked once per tick, exactly the pattern
`RoadRenderer.update()` already uses. Do not attempt incremental frontage updates in this
milestone; the road tool already invalidates wholesale and correctness is worth more here.

Deleting a road therefore orphans cells: after a rebuild, any cell with `zone !== 0` and
`frontage < 0` is a **stranded** cell. Stranded cells keep their paint (so re-laying the road
restores the zoning, which is what players expect) but are excluded from growth, and any
building standing on one is marked for demolition over the following ticks — see §4.

Highways would be non-zonable frontage; the current catalogue has only `gravel` and `small`,
both zonable. Add `zonable: boolean` to `RoadClass` now so the later highway tier is data, not
a special case, and read it in step 3.

---

## 3. The zone tool

`ZoneTool extends BaseTool` in `src/input/zoneTool.ts`, registered with `ToolManager`
alongside `RoadTool`. It follows the existing tool contract exactly and, like `RoadTool`, holds
no three.js references — it talks to an interface so tests can drive it headlessly.

```ts
export interface ZonePreviewTarget { setZonePreview(cells: readonly CellKey[], paint: ZonePaint): void; }

export interface ZoneToolOptions {
  zoning: ZoningState;
  preview?: ZonePreviewTarget | null;
  budget?: { money: number } | null;
  onStatus?: ((s: ZoneToolStatus) => void) | null;
}
```

Interaction (drag painting, per the decided "zoning feel"):

- `onPointerDown(hit, 0)` starts a stroke; `onPointerMove` while the stroke is live accumulates
  cells; `onPointerUp` commits the stroke as one undoable batch. Right-click or `Escape`
  cancels the in-progress stroke without applying it.
- The brush is a square of `brushRadius` cells (default 1 → 3 × 3), adjustable with `[` / `]`
  in `onKey`. Cells enter the stroke set only if `frontage[k] >= 0` and `occupant[k] < 0`;
  everything else is silently skipped so dragging across a road or an existing building is
  harmless.
- Between two consecutive pointer samples, interpolate along the segment at half-cell spacing.
  A fast drag at 60 fps can cross many cells per frame; without interpolation the stroke comes
  out dotted.
- Because the stroke set is a `Set<CellKey>`, repainting the same cell during one drag is free,
  and the preview is just that set handed to the renderer.
- The active paint (`'residential' | 'commercial' | 'industrial' | 'none'`) is tool state, set
  by four HUD buttons; add them to `TOOL_BUTTONS` in `src/ui/hud.ts` as sub-modes of a single
  "Zone" entry. Status text follows the road tool's convention:
  `"Residential · 24 cells · ¤240"`, or a rejection string when nothing under the brush is
  zonable.

Cost: charge a flat per-cell fee (suggested ¤10 zoning, ¤0 de-zoning) against
`simulation.state.money`, checked at commit time on the whole stroke; if the stroke exceeds the
treasury, truncate it to what is affordable rather than rejecting the whole drag.

Commit applies `zone[k] = code` for each cell and bumps `zoneRevision`. De-zoning a cell whose
`occupant >= 0` schedules that building for demolition (§4) rather than deleting it instantly,
so the visual does not pop.

---

## 4. Lots, buildings, and growth

### Lot formation

A **lot** is a run of contiguous, same-zone, unoccupied cells sharing one frontage edge and one
facing, plus the cells directly behind them. Lots are not stored — they are *found* on demand
by the growth system, which keeps state small and makes the rules easy to reason about.

`findLot(seed: CellKey): Lot | null`:

1. Require `depth[seed] === 0`, `zone[seed] !== 0`, `occupant[seed] < 0`.
2. Walk left and right along the frontage line (perpendicular to `facing`) while cells match
   the seed's zone, facing, and edge id, and are unoccupied. Cap the run at the zone's max
   width (R: 2 cells, C: 3, I: 4).
3. Depth is the min over the run of how far back cells remain same-zone and unoccupied, capped
   per zone (R: 2, C: 2, I: 3).
4. Reject lots smaller than 1 × 1. Return `{ cells, width, depth, edgeId, facing, originKey }`.

### Building records

```ts
export interface BuildingData {
  id: number;
  zone: ZoneType;
  /** Frontage-corner cell; the lot is reconstructible from this plus w/d/facing. */
  cell: CellKey;
  w: number;              // lot width in cells
  d: number;              // lot depth in cells
  facing: 0 | 1 | 2 | 3;  // quadrant pointing at the road
  level: 1;               // reserved; growth never writes anything else this milestone
  /** Per-building variation seed, drawn from the zoning RNG stream. */
  seed: number;
  /** Occupancy: residents for R, jobs for C/I. */
  capacity: number;
  /** Tick the building appeared, for the grow-in animation and for save sanity. */
  bornTick: number;
}

export interface ZoningSaveData {
  /** Run-length encoded zone codes: [code, runLength, code, runLength, …]. */
  zoneRuns: number[];
  buildings: BuildingData[];
  nextBuildingId: number;
}
```

### Demand

Demand is a placeholder here — the economy milestone owns the real model. For now a
`DemandSystem` exposes `{ residential: number; commercial: number; industrial: number }` in
0–1, computed from simple ratios (unemployment drives C/I demand up, job surplus drives R
demand up, all seeded off population and building counts) and smoothed with an exponential
filter so it does not oscillate tick to tick. The growth system reads it and nothing else, so
swapping in the real model later is a one-file change.

### The growth tick

`GrowthSystem implements System` (`src/sim/state.ts` pipeline), registered after the demand
system. Engine ticks at 20 Hz, so a per-tick budget matters:

```
step(state, tick):
  if tick % GROWTH_INTERVAL !== 0: return          // GROWTH_INTERVAL = 10 → twice a second
  rebuildFrontageIfStale()
  spawnBudget = 4                                  // buildings created per growth tick
  for zone in shuffledByDemand(['residential','commercial','industrial']):
     n = round(spawnBudget * demand[zone] / demandTotal)
     for i in 0..n:  tryGrowOne(zone)
  processDemolitions(2)                            // stranded / de-zoned, 2 per growth tick
```

`tryGrowOne(zone)` draws candidate seed cells from a **per-zone candidate ring buffer**: a
`Uint32Array` of vacant depth-0 cells of that zone, refilled by a cursor that sweeps the zone
array incrementally (a few thousand cells per tick, wrapping) rather than scanning 262 k cells
every time. Pop a candidate, validate it still qualifies, `findLot`, and if the lot is good:

- Roll `rng.chance(p)` where `p` scales with demand and with a small land-value proxy
  (currently: closer to the road network's centroid = higher). This makes growth spread out
  from the built-up area instead of filling in scan order — the visual difference is large and
  the cost is one distance computation.
- Allocate `BuildingData`, write `occupant[k] = id` for every lot cell, push to
  `state.buildings`, bump `buildingRevision`, emit `zoning:grew` on the event bus.

At 4 buildings per growth tick × 2 growth ticks/second, a city reaches 2 000 buildings in about
four minutes of unpaused play — brisk but not instant, and tunable by one constant.

**Determinism.** All randomness comes from `rng.fork('zoning')` derived from `state.seed`
(`src/core/rng.ts`). The candidate cursor and the ring buffer are ordinary state, advanced only
inside `step`, so replaying the same tick sequence produces byte-identical results. Per-building
appearance uses `building.seed`, drawn once at spawn and *saved*, so a reloaded city looks
identical even though the render layer never sees the RNG.

Demolition: a building whose cells are stranded or de-zoned enters a `pendingDemolish` queue;
`processDemolitions` clears `occupant`, splices it from `state.buildings`, and emits
`zoning:demolished`.

---

## 5. Procedural low-poly buildings

Art direction is fixed: flat-shaded low-poly, zone-conventional palette. Generation is entirely
a function of `(building.seed, zone, w, d)` — pure, so the renderer can regenerate everything
from saved data with no extra persistence.

**Shape grammar.** Each building is 1–3 stacked boxes:

- Base box: footprint `(w·8 − inset·2) × (d·8 − inset·2)` metres, `inset = 1.0` so neighbours
  do not touch. Height `h0` drawn from a per-zone range.
- With probability `pSetback` (R: 0.15, C: 0.5, I: 0.25), a second box on top, footprint scaled
  by `rng.range(0.55, 0.85)`, offset toward the road-facing edge, height `rng.range(0.4, 0.9)·h0`.
- Industrial gets a third flat "annex" box beside the base instead of on top, at 0.35 height.
- Residential gets a prism roof (a 4-triangle cap) when `w === 1`; everything else is flat.

| zone | height range (m) | palette (flat-shaded base colours) |
|---|---|---|
| residential | 6–14 | warm greens/creams: `0x8fae7a`, `0xd8cfae`, `0xb1855f` |
| commercial | 9–22 | cool blues: `0x5f86b4`, `0x8fb6cf`, `0x3f5f80` |
| industrial | 7–12 | desaturated ochres/greys: `0xa89778`, `0x8a8578`, `0x6f6a5e` |

Colour is picked with `rng.pick(palette)` then jittered ±4% per channel, which reads as variety
without breaking the palette. `MeshLambertMaterial` with `flatShading: true` matches the road
renderer's existing material choice.

**Instanced rendering.** `BuildingRenderer` keeps **one `THREE.InstancedMesh` per (zone × box
role)** — nine meshes total for 3 zones × {base, upper, annex}, plus one for roof prisms. Each
uses a unit `BoxGeometry(1,1,1)` anchored at its base (`translate(0, 0.5, 0)`), so the per-box
matrix is a pure scale + translate + Y-rotation from `facing`. Per-instance colour goes through
`InstancedMesh.setColorAt` / `instanceColor` — one draw call per mesh regardless of count.

Update loop mirrors `RoadRenderer.update()`: compare `buildingRevision` to `builtRevision`, and
on a change rewrite only the changed range. Because buildings are append-mostly, keep a
`dirtyFrom` index and call `instanceMatrix.updateRange` / `needsUpdate` for that slice; a
demolition swaps the last instance into the freed slot and shrinks `count` (with a
`slotOfBuilding: Map<number, number>` to keep ids and slots in sync). Capacity grows in
increments of 512 by reallocating the `InstancedMesh` — five reallocations gets you to 2 560.

Y placement samples `terrain.heightAt()` at the lot centre once, at spawn, and caches it on the
render side; a building sits on a single flat pad rather than following the ground, which is
both cheaper and closer to how the road verge already behaves.

**Grow-in.** Animate `scale.y` from 0.05 to 1 over ~0.4 s using `tick - bornTick`, evaluated in
the frame callback. Purely visual, no sim state.

---

## 6. Performance budget

Target: 1–2k buildings, 60 fps.

- **Draw calls:** ≤ 10 for all buildings (one per zone × box role). This is the whole reason
  for instancing; a `Mesh` per building would be 2 000 draw calls and would not hold 60 fps.
- **Per-frame CPU:** zero when nothing changed. `BuildingRenderer.update()` is a revision
  comparison and returns immediately, matching `RoadRenderer`.
- **Per-tick CPU:** growth touches at most a few thousand `Uint8Array` reads (candidate sweep)
  plus ≤ 4 lot searches. Sub-0.1 ms. Growth runs on 1 tick in 10, so the average is lower still.
- **Frontage rebuild:** the one spiky operation, low single-digit ms, and it happens only on the
  frame after a road edit — a frame the player has already spent clicking. If profiling shows it
  hitching, split it across ticks by edge index; do not optimise it pre-emptively.
- **Memory:** ~2 MB of typed arrays for cells, ~2 000 × ~80 B ≈ 160 KB of building records, plus
  instance buffers (2 560 × 16 floats × 4 B ≈ 164 KB per mesh).
- **Zone overlay** (the coloured cell tint shown while the zone tool is active): a single
  `InstancedMesh` of flat 8 × 8 quads, or better, a 512 × 512 `DataTexture` of zone codes sampled
  by a small shader patch on the terrain material. Prefer the texture — it is one upload on
  `zoneRevision` change and costs nothing per frame.
- **Avoid:** per-building `Object3D`s, per-cell JS objects, sorting buildings every frame, and
  rebuilding instance buffers wholesale on every spawn.

---

## 7. Save round-trip

Zoning joins the existing `Simulation` save provider (`src/sim/state.ts`) rather than
registering its own, so one `GameState` still describes the whole city.

- `GameState` gains `zoning: ZoningSaveData`.
- `serialize()` RLE-encodes the `zone` array. A typical city has a handful of long runs of
  zeros, so 262 144 cells compress to a few hundred numbers. `frontage`, `depth`, `facing` and
  `occupant` are **not saved** — they are derived, and rebuilding them on load is cheaper and
  safer than trusting them.
- `deserialize()` follows the roads precedent exactly: run everything through a
  `normalizeZoningData(input: unknown)` that drops malformed buildings, clamps cell keys into
  range, discards buildings whose zone code is unknown or whose cells overlap another
  building's, repairs `nextBuildingId` to `max(id) + 1`, and tolerates a missing `zoning` branch
  entirely (old saves → empty zoning). Never throw on a bad save.
- After decoding, call `rebuildFrontage()` and then rebuild `occupant` from the building list.
  Buildings that land on cells with no frontage after the rebuild are stranded and enter the
  demolition queue on the next tick — which is the correct behaviour, not a bug.
- Bump `SAVE_VERSION` to 2 and treat version-1 documents as "no zoning branch".

---

## 8. Test plan

Unit tests in `test/zoning.test.ts` and `test/growth.test.ts`, headless (no three.js), matching
the style of `test/roads.test.ts`.

**Cell maths.** `cellAt`/`cellKey`/`cellCentre` round-trip for the grid corners, the origin, and
out-of-bounds coordinates (expect −1). Confirm `ZONE_CELL === ROAD_GRID`.

**Frontage derivation.**
1. A single 100 m road on flat terrain yields exactly `2 × 4 × (100/8)` zonable cells, none of
   them under the carriageway.
2. Two parallel roads 48 m apart split the block: no cell is claimed by the far road, and each
   side gets ≤ `ZONE_MAX_DEPTH` cells.
3. Two parallel roads 32 m apart leave zero cells between them at depth ≥ 2.
4. Removing the road strands previously-zonable cells (`frontage < 0`) while `zone` is retained.
5. Frontage over water is rejected (stub `HeightSampler` returning a negative height).

**Zone tool.** Drag from A to B paints a contiguous run with no gaps (the interpolation test).
Painting over a road cell is a no-op. De-zone clears cells and queues occupants for demolition.
An unaffordable stroke truncates instead of failing. `Escape` mid-stroke leaves `zone` untouched.

**Growth.** With demand pinned at 1.0, N growth ticks produce ≤ `4·N` buildings and every
building's cells report `occupant === building.id` with no cell claimed twice. With demand at
0, nothing grows. Lots never exceed the per-zone width/depth caps. A building on de-zoned cells
disappears within a bounded number of ticks and frees its cells.

**Determinism.** Two `Simulation`s with the same seed, driven through 2 000 identical ticks with
identical scripted paint strokes, produce identical `buildings` arrays including every `seed`
and `capacity`. This is the single most valuable test in the suite — write it first.

**Save round-trip.** Serialize a grown city, deserialize into a fresh `Simulation`, and assert
deep equality of `buildings` and of the decoded `zone` array, plus that `frontage` and
`occupant` rebuilt identically. Separately: feed `normalizeZoningData` a truncated RLE stream,
NaNs, out-of-range cell keys, overlapping buildings, and `undefined`, asserting it returns a
valid empty-or-repaired structure every time and never throws.

**Integration (Playwright, phase 10).** Via `window.metropolis`: place a road path, call a new
`paintZone(x1, z1, x2, z2, 'residential')` debug hook, run the engine at speed 4 for a few
seconds, and assert `simulation.state.buildings.length > 0` and that FPS from `engine.stats`
stayed above 50 with 1 000+ buildings on screen.
