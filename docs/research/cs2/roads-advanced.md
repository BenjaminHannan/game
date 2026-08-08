# Cities: Skylines II — The Advanced Road Toolset

Research notes on the *full* road toolset in *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023): the road hierarchy, drawing modes, snapping, in-place replacement, roundabouts and cul-de-sacs, elevation (bridges, cuts, tunnels), and road wear/maintenance. The goal is to work out which of these tools carry the *feel* of the game and which are garnish, so *Metropolis* can spend its budget in the right order. Written entirely in the researcher's own words; no game text, asset, or data file is reproduced.

**Relationship to other docs.** `docs/research/roads.md` is the broad survey of CS2 roads (classes, utilities-in-roads, parking, outside connections, the net data model). This doc does not repeat it — it goes one level deeper on *the tool in the player's hand* and then does the part `roads.md` doesn't: a head-to-head against the shipped MVP in `src/sim/roads.ts` and a ranked adoption order. Sister docs: `docs/research/cs2/zoning-districts.md` (the zone strips roads generate), `docs/research/cs2/traffic-pathfinding.md`.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains here, so the material below is synthesized from many targeted web searches over official wiki pages, Paradox feature/dev-diary material, patch notes, guide sites, Steam and Paradox forum threads, and mod repositories. Primary tables could not be read directly, so every claim carries a tag:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`). Likely accurate, not independently verified.
- **[Dev]** — Colossal Order / Paradox material: the Road Tools feature highlight, Development Diary #1, patch notes.
- **[Community]** — guides, forum threads, modder writeups. Often patch-specific or from personal testing.
- **[Inferred]** — my reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree; both readings given.

---

## How CS2 does it

### 1. The hierarchy is a ladder plus a variant axis

Roads are organized as a capacity ladder — informally alley → gravel → small (two-lane) → medium (four-lane) → large → highway — and, crossing it, a *variant* axis: one-way versions, roadside-parking versions, tram-track versions, and cosmetic verge treatments **[Wiki]/[Community]**. Only the basic two-lane road is available at the start of a save; the rest, along with roundabouts of larger sizes, parking-equipped roads, and the verge upgrades (trees, grass, wide sidewalk), unlock through the progression panel **[Dev]/[Community]**.

Structurally the important fact is that a road prefab is **an ordered cross-section of lane pieces** — traffic lanes, parking lanes, medians, sidewalks, verges, tram rails — not a monolithic type **[Community]**, as `roads.md` §11 covers. That is what makes "add a bus lane to this road" and "swap this parking strip for trees" the *same operation* internally, and it is why CS2's upgrade tool is far more expressive than CS1's.

### 2. Six drawing modes, and which ones players actually use

The tool cycles through **straight, simple curve, complex curve, continuous, grid, and parallel** **[Dev]/[Community]**. Details in `roads.md` §1. Two mode-level observations matter for prioritization:

- **Grid mode is a three-click block generator**: corner, then width, then length, with a live preview of the resulting block of parallel and perpendicular streets **[Dev]**. It is the single biggest "the game builds the boring part for me" affordance in the toolset.
- **Parallel mode** draws two matched roads at once, and the offset is expressed **in zone cells, adjustable roughly 0.25–12 cells** **[Community]**. Expressing offset in cells rather than metres is a small but telling design choice: it keeps the second road landing on the same zoning grid as the first **[Inferred]**.

Elevation is *not* a seventh mode; it is a modifier that applies to whatever mode is active **[Dev]**.

### 3. Snapping is a set of independent toggles, and that is the whole problem

Default snapping simultaneously targets: zoning-cell length (8 m increments), 90° angles, the sides of buildings, the zone grid under the cursor, projected guide lines from existing geometry, and existing nodes/segments — each individually toggleable in the construction menu **[Dev]/[Community]**.

Two of these fight each other in practice:

- **Zone-grid snapping picks the *best available* grid under the cursor**, which is not necessarily the grid the segment started on **[Community]**. Drawing a long road past a neighbouring block can silently re-orient the new road's zone strip.
- **Guide-line snapping** projects alignments from every nearby network, which is invaluable for highway ramps and for tying two grids together, and destructive when you are trying to lay a plain rectangular grid **[Community]**.

The consistently repeated community remedy is to **turn off guide-line and zone-grid snapping** and keep only cell-length, 90°, and existing-geometry snapping while building ordinary blocks **[Community]**. Forum threads are blunt about the failure mode: a straight road on flat ground producing gaps in the zone strip, or zoning attaching to one side of a 90° block and not the facing road **[Community]**. The lesson for an original implementation is not "copy the six toggles" — it is that **too many simultaneous snap targets with no visible priority order produces unpredictable results**, and unpredictability in the primary verb of a city builder is the worst possible bug **[Inferred]**.

There is also a reported degenerate case on long segments where more than one direction reads as a valid right-angle snap at once, wedging the zone grid into itself at the far end **[Community]**.

### 4. Road guides: the numeric feedback layer

While drawing, the tool overlays a guide system that includes the **elevation angle — a live numeric slope percentage from the segment's start point to the cursor** **[Dev]**. This is cheap to implement and does an enormous amount of work: it converts "why won't this build?" into "ah, 18%." **[Inferred]** The rest of the guide layer is projected alignment lines and length readouts.

### 5. Replace-in-place

CS2 swapped CS1's Upgrade tool for a **Replace** tool that mutates an existing road without redrawing its alignment: change the whole cross-section to another road type, add or remove trees, sound barriers (highways only), grass verge, extra-wide sidewalk, highway lighting, bus lanes, or tram tracks **[Wiki]/[Community]**. The alignment, the connected junctions, and — crucially — the zoning and buildings along it survive.

**Cost rule** **[Community]**: upgrading to a more expensive configuration charges only the *difference*; downgrading to an equal-or-cheaper configuration is free. Deliberately generous, and it makes experimentation with hierarchy cheap.

**The known limitation**: replacement operates on a whole road between junctions, not on a player-dragged sub-length. CS1 let you drag the upgrade tool along exactly the stretch you wanted; CS2 clicking a road converts the entire run **[Community]**. **[Conflict]**: some sources describe clicking-and-dragging from a node along a length as the intended flow, others report that the click always takes the whole road; the most likely reconciliation is that the unit of replacement is the node-to-node segment, and long visually-continuous roads are frequently a single segment **[Inferred]**. Players work around it by deleting and redrawing, then patching the stub next to the junction.

### 6. Roundabouts and cul-de-sacs as ploppable junction prefabs

The roundabout tool is present from the start of a save and works by **placing a prefabricated circular junction onto an existing intersection**, in a chosen size, from small suburban up through multi-lane **[Community]**. Detailer's Patch #2 (~1.2) added **7 decorative variants in 4 sizes each**, plus a new **cul-de-sac category with 3 variants** (asphalt, grass, tree-lined) that behave like tiny roundabouts at dead ends **[Dev]**.

The hand-built alternative — draw a one-way circle with the curve tool, then strip the auto-placed lights so the game assigns yields to the feeder legs — is gated behind an Advanced Road Services development point **[Community]**. The design insight is that CS2 treats a roundabout as **a junction prefab that replaces a node**, not as a special road geometry the player must construct **[Inferred]**. That is a much cheaper thing to build than generalized curved-road authoring, and it delivers most of the visual payoff.

### 7. Elevation: one continuous axis from tunnel to bridge

Elevation is a single signed offset from ground, nudged by hotkeys with a **configurable step, reported as adjustable from 1.25 m up to 10 m** **[Community]**. What the road *becomes* is a function of that offset rather than a separate tool choice:

- Slightly negative → a **cut**: an open trench with the terrain excavated around it.
- Around **−12.5 m and below** → a fully roofed **tunnel** **[Community]**.
- Positive → an **elevated road / bridge**, needing clearance beneath. Reported thresholds: bridge **pillars** appear from roughly **8.75 m**, below which the game renders continuous barrier-style supports; tunnels may pass under a surface road at **12.5 m** separation, and may cross each other with about **8.75 m** between levels **[Community]**.
- **Cut-and-fill** reshapes the terrain to meet the chosen elevation instead of forcing a bridge over every dip **[Dev]**.

Bridges are therefore not built with a bridge tool. The player raises elevation, draws, and lowers back to zero **[Community]**. This is the strongest single ergonomic idea in the whole toolset: **one continuous control produces trenches, tunnels, embankments, overpasses, and bridges**, and the player never has to pick a construction type **[Inferred]**.

CS2 does not publish a maximum buildable grade **[Community]**; because cut-and-fill can flatten most ground, steep terrain manifests as expensive earthworks rather than a hard refusal **[Inferred]**.

### 8. Maintenance is a live per-segment state, not a flat bill

Two distinct money/state systems attach to roads:

- **Upkeep** — every segment charges a recurring cost scaled by length and type, and **elevated versions cost substantially more than their ground equivalents, reported around 2–3× and in one case a jump from roughly 0.96 to 2.08 per cell per week for a highway** **[Community]**. Treat those specific numbers as illustrative rather than current.
- **Wear / condition** — segments physically degrade under traffic. The Roads info view colours the network green-through-red by condition. Poor condition **slows traffic on that segment and raises local accident probability**. A **Road Maintenance Depot** (a development-point unlock) dispatches repair vehicles whose count and effective radius scale with its budget slider; in cold climates the same depot runs snowplows, and accumulated snow degrades effective road quality the same way worn pavement does **[Wiki]/[Community]**.

The mechanically interesting part is that condition and snow both feed the *same* effective-speed term that traffic already reads, rather than being a separate penalty system **[Inferred]**.

---

## What makes it feel like CS2

Ranked by how much each contributes to the sensation of using CS2's road tool, based on what players talk about and complain about:

1. **Continuous elevation producing bridges and tunnels implicitly.** No mode switch, no bridge type picker, just a number that goes up and down while you draw. Nothing else in the toolset is as distinctive or as satisfying.
2. **Replace-in-place with difference-only pricing.** Upgrading a spine road from two lanes to four without losing the buildings alongside it is the moment a city stops feeling disposable. The pricing rule is what makes players actually do it.
3. **Snapping that produces buildable blocks.** Not the six toggles — the *outcome*: roads land on the zone grid, right angles are right angles, and painted cells tile without gaps. When this breaks, the game feels broken, as the forum threads show.
4. **Grid mode.** Three clicks for a whole block is the strongest labour-saving affordance in the game, and it directly serves the opening minutes of a save.
5. **Roundabouts as droppable junction prefabs.** Very high visual and "my city looks real" payoff for a comparatively small implementation: swap a node for a prefab.
6. **Live numeric guides while drawing** (length, slope %, cost). Cheap, and it converts refusals into legible feedback.
7. **Curves.** Curved roads matter for organic-looking cities, but note the tension documented in `zoning-districts.md`: curves splay the zone strip and waste frontage. Players who care about density build straight; players who care about looks build curved.
8. **Parallel mode.** Nice for divided boulevards and highway pairs; a niche the game leans on more than players do.
9. **Road wear and maintenance depots.** A real system, but it reads as a service-building chore rather than as part of the road *tool*. It changes how the city is run, not how it is drawn.
10. **Cosmetic verge/tree replacement, cul-de-sac variants, sound barriers.** Detailing-patch material. Beloved by the screenshot community, invisible to everyone else.

The negative lesson is worth stating explicitly: **CS2's road tool is more praised for its ambitions than for its execution**. The most repeated complaint is unpredictability — a straight road on flat ground producing an unbuildable zone strip **[Community]**. A smaller toolset that always does what it previews will feel *better* than a larger one that sometimes doesn't.

---

## Metropolis v1 adoption

**Where the MVP stands.** `src/sim/roads.ts` today is a clean node/edge graph with straight segments only: nodes snap to the 8 m grid (`ROAD_GRID`) and reuse an existing node within `NODE_SNAP_RADIUS` (12 m); segments run 16–512 m; placement is validated against terrain by probing every 8 m for submersion, out-of-bounds, duplicate edges, affordability, and a 12% grade ceiling (`MAX_ROAD_GRADE`, explicitly a Metropolis invention since CS2 publishes no such limit). Two road classes exist, `gravel` and `small`, described purely as width + speed + cost-per-metre. There is no elevation offset (node `y` is sampled ground height), no curve, no upgrade, no junction control, no wear. Rejections are already a typed enum with player-facing text — a good foundation, because most new tools add rejection reasons.

Proposed v1 scope, in build order. Each item names the smallest version that still delivers the feel.

1. **Draw feedback and a costed preview.** Before any new tool: while dragging, show length, cost, and grade %, and show the rejection text from `ROAD_REJECTION_TEXT` inline instead of only refusing the click. This is item 6 of the feel list and it is nearly free given `plan()` already computes all of it.
2. **Replace-in-place, class swap only.** Click an edge, change its `roadClass`, charge `max(0, newCost − oldCost)` per CS2's difference rule. No cross-section editing, no verge options. This requires no geometry work at all — it is a field write plus a revision bump — and it buys feel-rank #2 outright. Add a third class (`medium`, four lanes) at the same time so there is something to upgrade *to*, and gate it behind a progression unlock so the first upgrade is an event.
3. **Continuous drawing (chained segments).** Keep the straight-segment model, but let the end node of one placement become the start of the next until the player right-clicks. Purely a UI-state change over the existing `plan`/`build` pair; enormously reduces click count.
4. **Grid mode.** Three clicks emitting a rectangle of straight segments on the 8 m grid, at a spacing chosen to fill zone depth exactly (see `zoning-districts.md` on the ~96 m figure). Built entirely on top of the straight-segment primitive — no new geometry type. This is feel-rank #4 for the cost of a preview loop.
5. **Explicit snap toggles, but only three.** Cell-length, 90°/45° angle, and existing-geometry. Deliberately omit CS2's guide-line and best-available-zone-grid snaps, which are the documented source of its grid corruption. Show the active snap target in the preview so the player can see *why* the endpoint moved.
6. **Roundabout as a node prefab.** One size to start. Select a junction node, pay, and the node is replaced by a small circular one-way ring with the incoming edges reattached to it. This needs a curved *representation* only in the renderer; the sim can model the ring as a short cycle of edges flagged one-way. Feel-rank #5 for a contained, self-limiting piece of work.
7. **Per-edge elevation offset, bridges only.** Add `startY`/`endY` (or an `elevation` offset per node) to `RoadEdgeData`, hotkey-nudged in 2 m steps while drawing, with the grade check applied to the *road* profile rather than the terrain profile. Above a clearance threshold the renderer draws piers and the edge no longer requires dry ground beneath it — which retires the `underwater` rejection for elevated spans and lets the first river crossing happen. **Tunnels are v1-optional**; if they slip, they slip. This is feel-rank #1, but it is also the only v1 item that touches the serialized data model, so it lands after the cheap wins and needs a save-migration path.

**Explicitly deferred out of v1**: curves of any kind, parallel mode, cut-and-fill terrain modification, cross-section/lane editing, bus and tram lanes, cosmetic verges, cul-de-sacs, sound barriers, per-junction traffic control, road wear, and maintenance depots.

**Consistency check against binding decisions.** The Road MVP entry in `docs/UNKNOWNS.md` reads "straight segments with node snapping first; curves later" — this plan honours that, and adds the finding that *elevation matters more to the feel than curvature does*. That is the one non-obvious recommendation in this doc and it is worth putting to the owner: if only one geometric extension ships in v1, it should be vertical, not horizontal. The statistical-traffic decision also helps here — edge condition, elevation, and class all collapse into a per-edge effective-speed multiplier, which the flow model already wants.

---

## Later path

- **Curves.** Promote the edge centreline from two node positions to a cubic Bezier with two interior control points, matching CS2's net model, and implement simple-curve (3 clicks) then complex-curve (4 clicks) on top. Everything downstream — length, terrain probing, zone-strip generation, vehicle positions — has to become curve-parameterized, so this is the single largest refactor on the road path and should be done once, deliberately, rather than by degrees.
- **Cut-and-fill.** Requires a mutable terrain heightfield with undo. Once it exists, `MAX_ROAD_GRADE` stops being a wall and becomes a price.
- **Tunnels**, once elevation is signed and the renderer can cull covered spans.
- **Cross-section composition.** Replace `RoadClass`'s flat width/speed fields with an ordered list of lane pieces, which turns bus lanes, parking strips, tram tracks, medians, and verge options into data rather than new classes. Do this before adding any of those features individually.
- **Junction control** — stop/yield/signal per node, with class-based defaults (small×small → stop, anything involving a larger class → signal), then crosswalk and lane-arrow tools. Only meaningful once traffic simulation is per-lane enough to care.
- **Parallel mode**, offset expressed in zone cells.
- **Road wear + maintenance depot**, folded into the same effective-speed multiplier as class and grade, with a condition info view. Add snow only if a seasonal climate ships.
- **Detailing pass**: cul-de-sac prefabs, roundabout variants and sizes, roadside tree selection, sound barriers. Cheap once the prefab and composition machinery exists, and disproportionately good for screenshots.

---

## Sources

- [Roads — Cities: Skylines II Wiki](https://cs2.paradoxwikis.com/Roads)
- [Cities: Skylines II Feature Highlight #1: Road Tools — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools)
- [Development Diary #1: Road Tools — Colossal Order](https://colossalorder.fi/?p=1547)
- [Development Diary #1: Road Tools — Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/developer-diary/development-diary-1-road-tools.1590300/)
- [Detailer's Patch #2 — Cities: Skylines II](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/detailers-patch-2)
- [Detailer's Patch #2 — 1.2.0f1 Patch Notes, Paradox Forums](https://forum.paradoxplaza.com/forum/threads/detailers-patch-2-1-2-0f1-patch-notes.1720277/)
- [Cities: Skylines 2 Detailer's Patch #2 — Simulation Daily](https://simulationdaily.com/news/cities-skylines-2-detailers-patch-2/)
- [New Cities Skylines 2 patch finally makes traffic as good as the first game — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/detailers-patch-traffic-routes)
- [Road Tools in Cities Skylines 2, explained — Pro Game Guides](https://progameguides.com/cities-skylines-2/road-tools-in-cities-skylines-2-explained/)
- [How to Upgrade and Elevate Roads in Cities Skylines 2 — gamepressure](https://www.gamepressure.com/newsroom/how-to-upgrade-and-elevate-roads-in-cities-skylines-2/zc621c)
- [Here's a Peek at the Features of Road Tools for Cities: Skylines II — player.one](https://www.player.one/heres-peek-features-road-tools-cities-skylines-ii-156655)
- [How to make elevated roads in Cities Skylines 2 — Dot Esports](https://dotesports.com/general/news/how-to-make-elevated-roads-in-cities-skylines-2)
- [How to build bridges in Cities: Skylines 2 — Dot Esports](https://dotesports.com/general/news/how-to-build-bridges-in-cities-skylines-2)
- [How To Build Bridges In Cities: Skylines 2 — TheGamer](https://www.thegamer.com/cities-skylines-2-bridges-how-to-build-guide/)
- [Cities: Skylines 2 – How to Build Tunnels — TheGamer](https://www.thegamer.com/cities-skylines-2-tunnels-build-guide/)
- [Key Guide for Perfect Tunnel Construction — Vortex Gaming](https://vortexgaming.io/en/postdetail/713164)
- [Cities: Skylines 2 — How to Upgrade Roads — GameRant](https://gamerant.com/cities-skylines-2-how-upgrade-roads/)
- [How to replace/upgrade only a segment of a road? — Steam Discussions](https://steamcommunity.com/app/949230/discussions/0/3877095833482036050/)
- [Bridges: "in water, elevation too low, distance too short" — Steam Discussions](https://steamcommunity.com/app/949230/discussions/0/3937895063001335768/)
- [Somebody please explain bridge building — Steam Discussions](https://steamcommunity.com/app/949230/discussions/0/3877095833482918311/)
- [I'm done. Road tools are awful. — Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/im-done-road-tools-are-awful.1621152/)
- [Rethinking street maintenance, and private roads — Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/rethinking-street-maintenance-and-private-roads.1606581/)
- [Cities Skylines 2 — How to deal with high Service Upkeep costs — Pro Game Guides](https://progameguides.com/cities-skylines-2/cities-skylines-2-how-to-deal-with-high-service-upkeep-costs/)
- [CS2-ExtendedRoadUpgrades — GitHub](https://github.com/ST-Apps/CS2-ExtendedRoadUpgrades)
- [Traffic (krzychu124) — GitHub](https://github.com/krzychu124/Traffic)
