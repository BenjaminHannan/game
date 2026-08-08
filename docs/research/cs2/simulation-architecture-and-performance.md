# Cities: Skylines II — Simulation Architecture and Performance

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) structures its simulation — data layout, system scheduling, tick cadence, its relationship to rendering — and on the specific technical failures that made its launch a performance story rather than a city-builder story. Compiled to inform an original implementation in *Metropolis*, which targets a **single-threaded browser budget** and therefore inherits none of CS2's parallelism but all of its architectural lessons. Written entirely in the researcher's own words; no game code, asset, data file, or text string is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains here (the primary technical writeup, the Paradox wiki, HN and Tildes threads all refused), so the material below is synthesized from many targeted web searches whose results summarize one or more pages. Every claim carries a tag:

- **[Dev]** — statements from Colossal Order / Paradox (launch statements, patch notes, feature pages) as reported by press.
- **[Analysis]** — third-party technical teardown, principally the widely-cited performance autopsy by Paavo Huhtala and GamersNexus' settings benchmarks, as summarized by outlets that covered them.
- **[Modding]** — derived from the decompiled game as documented by the modding community (CS2 wiki ECS pages, the ECS Explorer graph, modding guides).
- **[Community]** — player testing and forum measurement. Patch-specific, often unblinded.
- **[Inferred]** — my own reasoning, not stated by any source.
- **[Conflict]** — sources disagree.

Sister docs: `docs/research/cs2/traffic-pathfinding.md` (the system that dominates CS2's CPU cost), `docs/research/cs2/citizens.md` (the agent population that architecture exists to carry), `docs/research/cs2/zoning-districts.md` (doc-style reference).

---

## How CS2 does it

### 1. Data layout: Unity DOTS, ECS, and Burst

CS2 is built on Unity 2022.3 with the DOTS stack — the Entities package (ECS), the C# Job System, and the Burst compiler **[Modding]/[Analysis]**. This was a deliberate reaction to CS1, whose object-oriented, largely single-threaded simulation was the ceiling on that game's city size **[Dev]**.

The shape of it, as the modding community has reconstructed from the decompiled assemblies **[Modding]**:

- **Entities are bare IDs.** A citizen, a household, a building, a road segment, a vehicle, a company, and a *prefab definition* are all entities. There is no class hierarchy.
- **Components are small plain-data structs** attached to entities — a transform, a reference to the entity's prefab, a household's membership, a vehicle's current path. Components carry data only; they carry no behavior.
- **Prefabs are themselves entities.** Instances hold a reference component pointing at their prefab entity, so shared immutable configuration lives once and instances stay small. This is the pattern that makes "1,000 buildings of this type" cost 1,000 tiny structs plus one definition.
- **Archetypes and chunks.** Entities with the identical component set are stored together in contiguous memory chunks. A system that wants "every entity with a transform and a vehicle component" iterates dense arrays, not a pointer graph. This is the entire point: cache locality, and the ability to hand a chunk to a worker thread.
- **Systems are the behavior.** Everything the game does is a named system — loading, autosave, boarding a transit vehicle, applying the bulldozer, resource availability, company relocation. The community ECS Explorer exists precisely because there are enough systems and components that a graph is needed to navigate them **[Modding]**.

**Burst** compiles the hot job code to native SIMD rather than running it on the managed runtime. Reported speedups for simulation work of this shape run roughly an order of magnitude over plain C# **[Analysis]** — treat the specific multiplier as indicative, not measured here.

### 2. Scheduling: update phases, not a call graph

Systems do not call each other. They are registered into an ordered enumeration of **update phases**, and within a phase a system can declare that it runs after (or before) another named system **[Modding]**. Phase names visible in modding examples include a game-simulation phase, a rendering phase, and a tool-application phase; the modding API for injecting a custom system is literally "register this system at this phase, after that system" **[Modding]**.

Three consequences worth internalizing:

- **Ordering is declarative and global.** The frame's execution order is data, assembled at startup, not a hand-written sequence of function calls. New behavior is added by insertion, not by editing a master loop.
- **Phases are the synchronization boundaries.** Jobs inside a phase can run in parallel because the phase boundary guarantees the previous phase's writes are complete. **[Inferred]** from standard DOTS practice plus the observed phase enum.
- **Not every system runs every tick.** Systems can be registered to update at an interval rather than every simulation frame **[Modding]**. Expensive, slow-moving subsystems (land value, pollution diffusion, economic aggregates) are budgeted onto coarse cadences while movement and pathing run fine-grained. **[Inferred]** as to which specific systems get which cadence — the mechanism is documented, the assignment is not.

### 3. Tick rate and game speed — and why CS2 got this wrong

This is the single most instructive part of the architecture, because it is where CS2 made a mistake that a browser game can very easily repeat.

**Simulation steps are driven from the main thread, one per rendered frame.** Community testing and forum explanation converge on this: the simulation is designed around an expected update rate of **30 FPS**, and it cannot step faster than frames are produced **[Community]**. Measured consequences:

- Capped at 30 FPS, the sim runs at essentially 1.0× its intended rate. At 27 FPS it measures around 0.89×; at 20 FPS around 0.66× **[Community]**. The relationship is roughly proportional below the design point.
- Above 30 FPS the simulation runs at its designed rate — the extra frames render, they do not over-step the sim **[Community]**. So the coupling is one-directional: frames gate the sim, they do not accelerate it past target.
- **[Conflict]** One thread reports the opposite at very low caps — that limiting to ~24 FPS made in-game days and vehicles run *faster*. The most plausible reading is that the sim can lag behind and then catch up by taking larger or multiple steps, producing visible speed-up bursts **[Inferred]**. Either way the headline holds: **CS2's wall-clock simulation rate is not independent of rendering performance**, and this is a design flaw, not a feature.

The player-facing **game speed** control is a multiplier on top (normal / faster / fastest). At normal speed roughly one in-game minute passes per three real seconds; at the fastest setting roughly one in-game second per real second **[Community]**.

There is also a **separate, slower cadence for the water simulation**, which is fluid-dynamic (flow, drainage, flooding, drying) rather than agent-based. Players consistently report that water behaves on its own clock relative to game speed: floods take an implausibly long real time to drain even at maximum game speed, and the map editor exposes a *dedicated* water-simulation speed multiplier — reported as high as ~124× — separate from the game-speed control, because otherwise correcting a flooded map is impractical **[Community]**. Some players also report water animation cycling at a rate wildly out of step with the rest of the sim during flood events **[Community]**. The architectural read: the water grid is an iterative solver whose stability depends on its own step size, so it was given its own cadence and, at launch, that cadence was neither well-tuned nor well-explained. **[Inferred]**

### 4. Where the CPU actually goes

**Pathfinding dominates.** CS2 simulates individual citizens with individual journeys, and the pathfinding work is reported as running largely on a single thread **[Community]/[Analysis]**. Reported symptoms:

- Simulation speed correlates directly with the depth of the **pending pathfinding query queue**. One player's before/after: removing taxi stations in a ~360k city dropped average pending queries from roughly 250 to roughly 20, with a corresponding recovery in simulation speed **[Community]**.
- The practical ceiling players hit sits somewhere in the low hundreds of thousands of residents — reports cluster around 200k for noticeable degradation and ~250k for a modern CPU pinning a core **[Community]**. One report of a 360k city running at 10–20% of intended simulation speed **[Community]**.
- Congestion is a positive feedback loop on cost: bad traffic causes re-routing, re-routing causes more queries, more queries slow the sim, which makes traffic worse to watch **[Community]**.

There is **no citizen cap**, so this cost grows without bound as the city grows **[Community]**. The scale ambition was explicitly large — DOTS was adopted to chase full individual simulation at populations CS1 could not reach **[Dev]** — and the pathfinder is where the ambition met the wall.

### 5. What went wrong at launch: rendering, not simulation

The counterintuitive headline of the technical autopsy: **CS2 shipped GPU-bound**, which is bizarre for a city builder **[Analysis]**. Colossal Order themselves said the launch problems were tied to rendering rather than to the game's foundations **[Dev]**.

**Missing LODs.** Enormous numbers of meshes shipped without simplified level-of-detail variants, so distant geometry rendered at full authoring density **[Analysis]**. The example that went viral was that character models have modeled teeth with no reduced variant (reported around 6,100 vertices) — but the autopsy's own point was that teeth are a rounding error next to props like a pallet of canisters at ~17,000 vertices, a clothesline at ~25,000, and a log pile at over 100,000 **[Analysis]**. Colossal Order pushed back publicly on the teeth specifically while conceding the broader LOD problem **[Dev]**.

**Culling that barely culls.** The game implements **frustum culling only** — geometry outside the camera's view is skipped. There is no meaningful **occlusion culling**, so a skyscraper standing directly in front of ten thousand fully-detailed objects hides none of them from the GPU **[Analysis]**. In a top-down city view of dense downtown, occlusion is exactly where the wins are.

**Why they were in this position.** The autopsy attributes it to friction between DOTS and HDRP: Unity's high-definition render pipeline did not give the DOTS entity path the culling and LOD machinery that the classic GameObject path has, so Colossal Order wrote their own — and the custom implementation was, at ship, untuned **[Analysis]**. **[Inferred]** the deeper lesson is about coupling: choosing a bleeding-edge data architecture cost them the mature rendering tooling built for the old one, and nobody budgeted for rebuilding it.

**Virtual texturing** was also flagged as implemented with problems, including no anisotropic filtering support **[Analysis]**.

**Post-processing was overcharged.** GamersNexus' settings teardown found depth of field, volumetric effects, and global illumination to be disproportionately expensive relative to their visual contribution in a top-down strategy camera **[Analysis]**. The first performance patch decoupled LOD selection from render resolution (so LOD quality stopped silently degrading with the resolution slider) and adjusted depth of field and global illumination **[Dev]**.

**The stated target.** Colossal Order said publicly they were aiming for a steady 30 FPS, on the reasoning that a city builder gains little from 60 and will inevitably become CPU-bound as the city grows **[Dev]**. This is a defensible position that was received badly because the game was not hitting 30 either.

---

## What makes it feel like CS2

Architecture is invisible when it works. What players actually perceive:

1. **The city keeps living while you build.** Cars keep moving, the clock keeps advancing, demand keeps shifting while you are dragging a road. Nothing about the simulation waits for you to finish. A build tool that pauses the world would break the feel instantly.
2. **Time is yours to bend.** Pause, normal, faster, fastest — and the world responds smoothly to the change rather than stuttering through it. The pleasure is watching a slow process (a district filling in) compress into something you can sit through.
3. **Scale that reads as scale.** Thousands of individually-moving vehicles and pedestrians, not a texture animation. This is what DOTS bought, and it is genuinely felt.
4. **Cause and effect arrive on believable delays.** Build the power plant and the lights come back within seconds; raise taxes and the consequences take in-game days. Different systems visibly run on different clocks, and that layering is what makes the city feel like a system rather than a spreadsheet.
5. **What it did *not* feel like — and this is the load-bearing lesson.** At launch, the world slowing down as the city grew converted the player's success into punishment. The simulation getting slower is the worst possible failure mode for a city builder, because it makes late-game — the part players work toward — the worst part of the game.

---

## Metropolis v1 adoption

Consistent with `docs/UNKNOWNS.md`: **~1–2k buildings at 60 fps via instancing**, **statistical flow traffic with lightweight visual vehicles (no per-agent pathfinding)**, low-poly flat-shaded art. Single-threaded JS with a rendering thread we do not control. That budget changes almost every answer.

**Adopt directly**

- **Struct-of-arrays data layout.** Entities are integer indices into parallel typed arrays (`Float32Array` for positions, `Uint16Array` for types and flags), not JS objects in a `Map`. This is the one CS2 idea that transfers unchanged and pays off immediately in V8: it removes per-entity allocation, removes GC pressure, and keeps hot loops on contiguous memory.
- **A fixed-order phase list.** A single explicit array of `{name, phase, intervalTicks, fn}` records, iterated in order each tick. Systems declare their slot; nothing calls anything else. This is CS2's scheduling model with the parallelism removed and it costs nothing to build now — while retrofitting it later, once fifty systems call each other directly, is a rewrite.
- **Per-system tick intervals.** Every system declares how often it runs. Vehicle interpolation every tick; demand recalculation every 30; land value and budget every 300. This is the single highest-leverage performance tool available to a single-threaded sim, and CS2 already has the mechanism.
- **Shared immutable definitions referenced by index.** Building types, road types, zone types live in one flat table; instances store a `typeIndex`. CS2's prefab-entity pattern, minus the entity.

**Adopt with the mistake corrected**

- **Fixed-timestep simulation, fully decoupled from rendering.** This is where we deliberately diverge from CS2. Fix the tick at **10 Hz** of simulation, accumulate real elapsed time, step zero-or-more ticks per animation frame, and **interpolate visuals between the last two states**. Game speed is a multiplier on how much time is fed to the accumulator, never a change in tick length. Two hard rules that follow:
  - **Cap the catch-up.** Never run more than a small fixed number of sim ticks in one frame (3–4). If the accumulator overflows past that, drop the surplus time and let the in-game clock fall behind wall-clock. A spiral-of-death where each frame owes more ticks than the last is the failure mode that killed CS2's late game, and the fix is one `if`.
  - **Never derive simulation quantities from `deltaTime`.** A tick is a tick. Rates are per-tick constants. This also makes the sim deterministic and replayable for free.
- **Separate, coarser cadence for grid-diffusion systems.** CS2's water sim earns its own clock and so will ours: any grid solver (water, pollution, noise, land value) runs on its own slower interval, and its result is a smoothly-interpolated field rather than a per-tick recomputation. Unlike CS2, expose only *one* speed control to the player; internal cadences are never a user-facing setting.

**Simplify hard for v1**

- **No parallelism, and therefore no work that needs it.** The traffic decision in `UNKNOWNS.md` — statistical per-edge flow, not per-agent pathfinding — is exactly the mitigation for CS2's dominant cost. Flow on a graph of a few thousand edges is a bounded per-tick cost that does not grow with population the way a query queue does. Hold that line; per-agent pathing is the thing most likely to reintroduce CS2's failure.
- **Amortize anything O(n) over frames.** Systems that must touch every building (levelling checks, service coverage, land value) process a rotating slice — 1/N of the array per tick — rather than the whole array on a schedule. Constant cost per tick beats a periodic spike, because a spike is what the player sees as a stutter.
- **Budget for 2,000 entities, and instrument for it.** Ship a dev overlay from day one showing per-system tick cost in ms and the sim/render tick counts. CS2's launch narrative is a story about not knowing where the time went until strangers decompiled the game.

**Rendering: take the inverted lesson**

CS2's failure was rendering, not simulation, so our rendering rules are the strongest inheritance here:

- **One instanced draw call per building type**, already the plan. Low-poly is not just an art decision; it is the LOD strategy.
- **Aggressive frustum culling of instances on the CPU**, updating the instance buffer only when the visible set changes.
- **Distance-based simplification from the start** — beyond some radius, buildings become boxes and vehicles stop drawing entirely. CS2's mistake was treating LOD as an optimization to add later; adding it later is expensive and it never fully happened.
- **No expensive post-processing.** No depth of field, no volumetrics, no screen-space GI. Flat-shaded low-poly needs none of it, and CS2 demonstrated exactly how much a top-down camera pays for effects it cannot show off.

---

## Anti-pattern list (single-threaded browser budget)

Concrete things not to do, each traceable to something above:

1. **Stepping the sim once per animation frame.** Directly CS2's bug: sim rate becomes a function of frame rate, and a laggy machine plays a different game.
2. **Unbounded catch-up.** Running "however many ticks we owe" turns one slow frame into a death spiral.
3. **Scaling per-tick logic by `deltaTime`.** Destroys determinism, makes bugs unreproducible, makes the same city evolve differently on different hardware.
4. **Objects-in-a-Map as the entity store.** Every entity a heap allocation, every iteration a pointer chase, GC pauses at exactly the moment the city gets interesting.
5. **Allocating inside the tick loop.** Array literals, object literals, closures, `.map`/`.filter` chains over entity arrays. Preallocate scratch buffers and reuse them.
6. **Systems calling systems.** Ordering becomes emergent, cycles appear, and per-system cost becomes unmeasurable because the cost is nested.
7. **Everything running every tick.** The reason to build the interval mechanism before the systems, not after.
8. **Per-agent pathfinding at v1 scale.** The specific cost that capped CS2's cities.
9. **Recomputing whole-city aggregates on demand for the UI.** Demand bars, population, budget: computed once per aggregate tick, cached, read by the UI. Never a fresh pass triggered by a hover.
10. **Geometry with no distance simplification.** CS2's exact failure, and easier to prevent than to retrofit.
11. **Occluded and off-screen geometry submitted anyway.** CS2 shipped with frustum culling only; we should not ship with less.
12. **Coupling save/load format to the array layout.** Struct-of-arrays is fast but brittle to schema change; serialize through an explicit versioned format so a layout change is not a save-break.
13. **Shipping without a per-system profiler overlay.** If the cost is not visible during development, the first time anyone sees it is in a public autopsy.

---

## Later path

Roughly in the order each stops being a nice-to-have:

1. **Per-system profiler overlay and a tick-budget assertion** — arguably milestone 1, not "later". Cheap, and it makes every subsequent decision measurable.
2. **Slice-amortized whole-city passes** once building count passes ~500 and periodic spikes become visible.
3. **Typed-array save/load with a versioned schema**, before the data model calcifies.
4. **Web Workers for the one heaviest system.** The realistic candidate is whatever grid solver we add first (pollution or land value diffusion): a pure function over a `Float32Array`, transferable, no shared mutable state, results consumed one interval late. This is the only tractable parallelism in a browser and it wants a system designed for it, not a system retrofitted into it.
5. **`SharedArrayBuffer` + a worker-side sim thread** only if cross-origin isolation headers are acceptable for the deployment target and only if profiling says the main thread is the wall. High cost, high risk, real payoff.
6. **WASM for the hot inner loop** (flow solve, diffusion) if and when JS numeric code is demonstrably the bottleneck — after layout and algorithm fixes, never before.
7. **Spatial acceleration structure** (uniform grid over the map, sized to the 8 m zone cell) for neighbor queries, service coverage, and culling. Deferrable at 2k buildings, mandatory at 20k.
8. **Interest-driven detail**: full per-tick updates only for entities near the camera, coarse aggregate updates elsewhere. This is the honest long-term answer to CS2's unbounded citizen cost, and it is a design choice as much as a technical one — it means accepting that the far side of the city is simulated statistically.
9. **Per-agent pathfinding**, if ever, behind a hard query budget per tick and a queue whose depth is visible in the UI. CS2's queue was the leading indicator of its collapse; make ours an instrument rather than a surprise.
10. **A separate water/terrain solver on its own cadence**, following CS2's structure but with the cadence tuned and the player never asked to think about it.

---

## Sources

- [Why Cities: Skylines 2 performs poorly — paavohtl's blog](https://blog.paavo.me/cities-skylines-2-performance/)
- [Tom's Hardware: CS2 Performance Autopsy Highlights Massive Optimization Failures](https://www.tomshardware.com/pc-components/gpus/cities-skylines-2-performance-autopsy-highlights-massive-optimization-failures)
- [Windows Central: CS II runs horribly, a deep dive explains why](https://www.windowscentral.com/gaming/cities-skylines-ii-runs-horribly-a-deep-dive-into-unity-explains-why)
- [Tildes discussion: the teeth are not the only problem](https://tildes.net/~games/1bx1/why_cities_skylines_ii_performs_poorly_the_teeth_are_not_the_only_problem)
- [Lobsters discussion: Why CS2 performs poorly](https://lobste.rs/s/jmztxq/why_cities_skylines_2_performs_poorly)
- [GamersNexus: Terrible Optimization — CS2 GPU Benchmarks & Graphics Optimization Guide](https://gamersnexus.net/game-benchmarks-graphics-guides/terrible-optimization-cities-skylines-2-gpu-benchmarks-graphics)
- [PC Gamer: CO promises performance issues can and will be fixed](https://www.pcgamer.com/cities-skylines-2-studio-promises-performance-issues-can-and-will-be-fixed-we-want-to-assure-you-that-the-issues-are-not-deeply-rooted-in-the-games-foundation/)
- [PC Gamer: 'Yes, our characters have teeth'](https://www.pcgamer.com/cities-skyline-2-dev-says-yes-our-characters-have-teeth-no-the-characters-teeth-are-not-affecting-performance/)
- [PC Gamer: Immediately change these 5 graphics options](https://www.pcgamer.com/cities-skylines-2-immediately-change-these-5-graphics-options-for-a-big-performance-boost/)
- [GamesRadar: devs are trying to reach a steady 30 fps](https://www.gamesradar.com/cities-skylines-2-devs-are-trying-to-reach-a-steady-30-fps-because-theres-no-real-benefit-in-a-60-fps-city-builder/)
- [GamesRadar: individually rendered teeth aren't responsible](https://www.gamesradar.com/cities-skylines-2s-individually-rendered-teeth-arent-responsible-for-the-games-performance-issues-at-least-not-all-of-them/)
- [Dexerto: players expose high-poly teeth](https://www.dexerto.com/gaming/cities-skylines-2-players-expose-high-poly-teeth-as-the-reason-for-performance-issues-2355255/)
- [TechRadar: CS2's first performance patch](https://www.techradar.com/gaming/consoles-pc/cities-skylines-2s-first-performance-patch-finally-fixes-an-annoying-error)
- [Gamereactor: CO promises performance improvements](https://www.gamereactor.eu/colossal-order-promises-performance-improvements-for-cities-skylines-ii-1319653/)
- [ECS — Entity Component System (CS2 Wiki)](https://cs2.paradoxwikis.com/ECS_-_Entity_Component_System)
- [Common ECS Components (CS2 Wiki)](https://cs2.paradoxwikis.com/Common_ECS_Components)
- [PrefabSystem (CS2 Wiki)](https://cs2.paradoxwikis.com/PrefabSystem)
- [Modding (CS2 Wiki)](https://cs2.paradoxwikis.com/Modding)
- [Patch 1.1.X (CS2 Wiki)](https://cs2.paradoxwikis.com/Patch_1.1.X)
- [ECS — Cities 2 Modding Wiki](https://wiki.ciim.dev/guides/ecs.html)
- [Cities: Skylines 2 — ECS Explorer](https://captain-of-coit.github.io/cs2-ecs-explorer/)
- [Captain-Of-Coit/cs2-ecs-explorer (GitHub)](https://github.com/Captain-Of-Coit/cs2-ecs-explorer)
- [Show HN: Interactive ECS Systems/Component Explorer for CS2](https://news.ycombinator.com/item?id=38700552)
- [Cities: Skylines 2 Modding documentation (ps1ke)](https://ps1ke.github.io/Cities-Skylines-2-Modding-Guide/)
- [How I fixed Cities Skylines 2 — Igor Adrov's Blog](https://adrov.me/cs2-mod/)
- [krzychu124/SceneExplorer (GitHub)](https://github.com/krzychu124/SceneExplorer)
- [Steam: Some testing with simulation speed and FPS limit](https://steamcommunity.com/app/949230/discussions/0/3937895062995981940/)
- [Steam: Unraveling the Code — Technical Missteps and Performance Pitfalls](https://steamcommunity.com/app/949230/discussions/0/601903738647519407/)
- [Steam: Performance analysis and explanations](https://steamcommunity.com/app/949230/discussions/0/3937895474115452432/)
- [Steam: Simulation speed is so slow at times](https://steamcommunity.com/app/949230/discussions/0/797837596195805169/)
- [Steam: How to increase simulation speed?](https://steamcommunity.com/app/949230/discussions/0/3877096256094421100/)
- [Steam: Water Physics is bad](https://steamcommunity.com/app/949230/discussions/0/3877095833483994209/)
- [Steam: I messed up — I need help with water in map editor](https://steamcommunity.com/app/949230/discussions/0/4334229587334340336/)
- [Paradox forums: Let's talk seriously about Simulation Speed](https://forum.paradoxplaza.com/forum/threads/lets-talk-seriously-about-simulation-speed.1607936/)
- [Paradox forums: FPS Limiter](https://forum.paradoxplaza.com/forum/threads/fps-limiter.1655914/)
- [Paradox forums: Patch Notes 1.1.2f1](https://forum.paradoxplaza.com/forum/threads/patch-notes-1-1-2f1.1670525/)
- [Paradox support: Our Guide to Optimizing Performance](https://support.paradoxplaza.com/hc/en-us/articles/14648080779538-Cities-Skylines-2-Our-Guide-to-Optimizing-Performance)
- [Paradox: CS II Feature Highlight #6 — Electricity & Water](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/electricity-water)
- [Wikipedia: Cities: Skylines II](https://en.wikipedia.org/wiki/Cities:_Skylines_II)
- [PCGamingWiki: Cities: Skylines II](https://www.pcgamingwiki.com/wiki/Cities:_Skylines_II)
- [Sportskeeda: performance issues sour 100,000 concurrent players launch](https://sportskeeda.com/esports/cities-skylines-2-performance-issues-sours-100-000-concurrent-players-launch)
- [Sportskeeda: "Built for the future with modern hardware in mind"](https://sportskeeda.com/esports/built-future-modern-hardware-mind-cities-skylines-2-responds-performance-complaints-launch)
