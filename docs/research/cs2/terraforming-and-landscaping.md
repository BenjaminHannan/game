# Cities: Skylines II — Terraforming and Landscaping

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) handles terrain editing: the four terraforming brushes, brush size and strength, what terraforming costs, what undo does and does not exist, how terrain edits interact with roads, buildings and zone cells, and how the in-game Map Editor relates to the same toolset. Compiled to inform an original implementation in *Metropolis*. Written entirely in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains here, so the material below comes from targeted web searches whose results are synthesized summaries of one or more pages (Paradox dev diaries and forums, Steam guides and discussions, mod repositories, guide sites, press coverage). Primary tables could not be read directly, so every claim carries a tag:

- **[Wiki]** — attributed by search results to the official Paradox wiki. Likely accurate, not independently verified.
- **[Dev]** — Colossal Order / Paradox dev-diary or feature material, or press reporting of it.
- **[Community]** — player guides, Steam discussions, forum analyses, modder writeups. May be patch-specific or personal testing.
- **[Press]** — games-press reporting based on hands-on play.
- **[Inferred]** — my own reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree; both readings given.

Sister docs: `docs/research/cs2/roads-advanced.md` (road elevation and cut-and-fill, which is terraforming done by the road tool), `docs/research/cs2/zoning-districts.md` (the 8 m zone cell that terrain edits sit under), `docs/research/cs2/ux-conventions.md` (the category → asset → tool-options panel structure the landscaping menu obeys), `docs/research/cs2/environment.md` (water simulation, which terraforming perturbs).

---

## How CS2 does it

### 1. Where the tools live

Landscaping is one of the top-level categories on the bottom toolbar, with a shovel-style icon, alongside roads, zoning, services and so on **[Community]**. Opening it reveals tabs, of which terraforming is the first; the others in the base game are reported as **vegetation** (trees and plants, planted as saplings that grow over time), **pedestrian paths** (concrete and gravel walkways that carry foot traffic but not cars), and **water structures** (quays and similar shoreline pieces) **[Community]**.

That grouping is worth noticing. CS2 does not treat "editing the ground" as a separate mode away from building. It is a *category of things you place*, sitting in the same toolbar row and using the same tool-options panel grammar as roads (see `ux-conventions.md` §3): pick a category, pick a tool, then set *how* it applies. Terrain editing is an ordinary verb in the build loop, not a modal excursion **[Inferred]**.

### 2. The four terraforming tools

All four are brushes applied to the ground under the cursor. Reported behaviour **[Community]**, consistent across several independent guides:

| Tool | Primary (left) click | Secondary (right) click |
| --- | --- | --- |
| **Shift** | Raise terrain under the brush | Lower terrain under the brush |
| **Level** | Pull terrain toward the stored target height | *Sample* the height under the cursor and store it as the target |
| **Slope** | Blend terrain between terraformed areas / toward a target grade | (sets endpoints or reference height) |
| **Soften** | Smooth the local heightfield, blurring sharp edges | — |

Three points about this set:

- **Shift is a signed brush.** One tool, one button pair, raise and lower. There is no separate "dig" tool **[Community]**.
- **Level is a two-step verb — sample, then apply.** Right-click somewhere to say "this height", then hold left-click to drag everything under the brush to that height. This is the workhorse for making a buildable pad, and the sample step is what makes it usable: the player never types a number, they point at ground that is already the right height **[Community]/[Inferred]**.
- **Soften preserves the large-scale shape while removing the small-scale roughness.** Guides describe it as keeping the overall height difference between two areas but making the transition between them gradual **[Community]**. Mechanically that reads as a blur kernel over the heightfield rather than a pull toward any target **[Inferred]**.

**Slope is the least well documented of the four.** Descriptions in guides are vague — "evens out the ground between terraformed areas and your target height" **[Community]** — and I could not find a source that clearly states whether it works from two clicked endpoints (a start height and an end height, interpolated along the drag) or as a constant-grade brush. The two-endpoint reading matches how the CS1 slope tool is generally described and is the more likely mechanic **[Inferred]**, but flag this as unresolved.

### 3. Brush size and strength

The tool-options panel exposes at minimum **brush size** and **brush strength**, plus a snapping control **[Community]**.

- **Size** is reported to run from **10 to 1000**, with the low end described as roughly the size of one zoning cell **[Community]**. **[Conflict]**: the zone cell is firmly established as 8 m (`zoning-districts.md` §1), so either the unit here is not metres, or the "one cell" comparison is approximate. Treating the range as ~10 m to ~1 km of brush diameter is the reading that matches how players describe using it — the top end sculpts whole valleys, the bottom end tidies a single lot **[Inferred]**.
- **Strength** runs **1% to 100%** **[Community]**. It scales how fast the brush moves terrain per unit of time held, not how far it can ultimately go.
- The brush appears to have a soft falloff toward its rim rather than a hard disc edge — no source states this outright, but it follows from the smooth results players show and from the existence of a separate soften tool for the cases where falloff is not enough **[Inferred]**.

A **snapping** option is mentioned in the same breath as size and strength **[Community]**, but no source I found explains what terraforming snaps *to* — most likely height increments, possibly the same 1.25 / 2.5 / 5 / 10 m ladder the road elevation step uses (`roads-advanced.md` §7) **[Inferred]**.

### 4. Cost: it is free

This is the single most consequential design decision in the area, and the sources agree: **terraforming in CS2 costs the player nothing** — no money, and no CS1-style finite "soil" resource that had to be excavated from elsewhere before it could be dumped **[Community]/[Press]**. It is not gated behind a progression milestone either, as far as any source states; contrast CS1, where landscaping unlocked at an early milestone and charged per volume of earth moved **[Community]**.

The reasoning players and reviewers converge on is not generosity, it is necessity. CS2's buildings and roads sit badly on uneven ground — the game auto-flattens plots inconsistently, and even a small incline can produce visibly broken lots — so landscaping is not an optional flourish, it is remedial work the player is *forced* to do constantly. Charging for a mandatory chore would just be a tax **[Community]/[Press]**.

**[Inferred]** The design lesson generalizes past CS2: *the price of a terrain edit should be proportional to how optional it is.* If your building system tolerates slopes, terraforming becomes an expressive choice and can carry a price; if it does not, terraforming becomes maintenance and must be free. CS1 charged and could, because its buildings coped better with rough ground; CS2 does not charge, and given its lot behaviour it could hardly do otherwise.

There is a live community argument that free terraforming removes a real planning constraint — that a city builder where flattening a mountain is costless makes terrain purely decorative rather than a thing you must design around **[Community]**. Both positions have merit and the resolution depends entirely on how forgiving the building system is.

### 5. Undo: there isn't one

**CS2 shipped without an undo for terraforming**, and without a general undo at all; restoring undo has been one of the most persistently requested features on the Paradox forums since launch **[Community]**. The workaround players teach each other is to switch to Soften (or Level, sampling from untouched ground nearby) at maximum size and strength and manually smooth the damage back out **[Community]**.

That is a genuinely bad experience and it is worth naming as such. A destructive brush over a shared heightfield with no history is the classic case *for* an undo stack, and the absence of one makes players terraform timidly. **[Inferred]** Any clone should treat undo as part of the terraforming feature, not as a separate "nice to have" — the tool is not really finished without it.

The related preview question is thinner in the sources. The brush shows a footprint decal on the ground while hovering **[Community]**, but I found no evidence of a *result* preview — no ghosted "here is the terrain after this stroke". Terraforming appears to apply live as you hold the button, with continuous visual feedback but no commit/cancel step **[Inferred]**. That is the opposite convention from the road tool, which previews an entire segment before you commit it (`roads-advanced.md`).

### 6. How terrain edits interact with what is already built

This is the messiest part of the system and the sources are consistent about the mess.

**Existing roads and buildings block the brush.** Guides report that you cannot terraform ground that is already occupied — the brush skips over roads and building footprints, raising or lowering only the terrain *around* them **[Community]**. The practical consequence is the well-known workflow rule: **terraform first, build second.** Players who try to fix a hill after zoning it end up bulldozing the district, editing, and rebuilding.

**[Inferred]** Mechanically this reads as a per-sample occupancy mask over the heightfield: before writing a new height at a heightfield sample, the game checks whether that sample is under a network segment or a building footprint and skips it if so. That is cheap and it explains the visible artifact — a road left standing on a plinth of untouched ground after the surroundings are lowered.

**Roads do their own terraforming.** Independently of the landscaping tools, the road tool performs **cut-and-fill**: drawing a road at a chosen elevation excavates a trench or raises an embankment so the terrain meets the road profile, rather than forcing a bridge over every dip **[Dev]** (see `roads-advanced.md` §7). Where a cut or fill meets a steep enough face, the game generates a concrete **retaining wall** automatically — CS2 has no retaining-wall *asset*, the wall is an emergent piece of geometry at the terrain/road boundary **[Community]**. Players exploit this deliberately: use Level to build a flat shelf with a sharp edge, then run a road along the edge, and the game draws the wall for you **[Community]**.

So there are two terrain-modifying systems in the game — the landscaping brushes, which the player drives, and network cut-and-fill, which the road tool drives — writing to the same heightfield with different rules about what they will overwrite **[Inferred]**. That is a real source of the "non-euclidean" terrain players describe.

**Buildings flatten their own plots, inconsistently.** Grown buildings are always themselves flat, but how much of the surrounding lot the game levels varies, so neighbouring houses on the same incline can end up with one tidy garden and one visibly warped one **[Press]**. Terrain morphing on placement is reported as markedly more aggressive than in CS1 **[Press]**.

**Zone cells.** No source describes zone cells being invalidated by terrain edits, and since cells are generated by roads rather than painted on the ground (`zoning-districts.md` §1), the natural reading is that cells simply follow the terrain height beneath them and are unaffected by terraforming per se **[Inferred]**. Steepness does affect *growth*, though, in the sense that steep zoned ground produces the ugly auto-flattened plots described above — the constraint is aesthetic, not a hard build rejection **[Community]**.

**Water is the danger zone.** Terraforming near water is a known trouble spot: players report raising land in water and getting terrain permanently flagged as wet, floods that reach roads and refuse to drain, and roads that morph the ground under themselves instead of generating a wall **[Community]** (see `environment.md`). The water simulation is stateful and volumetric, so terrain edits do not simply move a shoreline — they change where a live simulation puts its water **[Inferred]**.

### 7. The Map Editor and the in-game tools

The Map Editor is not a different terrain system; it is the same one with the guardrails removed **[Dev]**.

- The editor's terrain tools live in the same shovel-icon menu at the bottom of the screen and are described as the familiar tools for bending terrain **[Dev]**.
- The editor **imports and exports heightmaps**: greyscale, 16-bit, **4096 × 4096**, PNG or TIFF, read from and written to a fixed folder in the user's game data directory **[Dev]**. A heightmap covers the playable area; an *additional* extended world map can optionally be imported covering both the playable area and the surrounding non-playable scenery ring **[Dev]**.
- **[Conflict]/[Inferred]** on the resulting resolution. The playable area is reported as 14,336 m across (23 tiles of 512 m), which over a 4096-px heightmap gives ~3.5 m per texel; one community source instead states ~13.9 m per heightmap pixel, which would correspond to the full ~57 km world extent rather than the playable area. The 3.5 m figure for the playable area is the one that is arithmetically consistent with the stated tile sizes.
- Beyond terrain, the editor adds authoring layers the base game does not expose: **water sources** as placeable objects whose flow rate and extent are dragged by handles, **natural resource painting** (ore, oil, fertile land, groundwater) with the same brush metaphor as terrain plus an option to import a **256 × 256** greyscale mask per resource, forests, outside connections, and per-map climate and weather settings **[Dev]**.
- Colossal Order state that the editor is the same tool they used to author the shipped maps **[Dev]**.

**[Inferred]** The structural takeaway: one heightfield, one brush implementation, two *permission sets*. In-game you may edit terrain but not water sources or resources, and edits are masked by existing construction; in the editor everything is editable and nothing is masked because nothing is built yet. Building the editor as a permission-widened view of the game tools, rather than as a separate application, is why the two feel identical.

### 8. What mods change

Terraforming shows up repeatedly in the CS2 modding scene, which is a good signal about where the vanilla tools frustrate people:

- **Anarchy** (yenyang) relaxes placement restrictions, and is explicitly documented as working with the terrain tool to let edits cross boundaries that vanilla refuses **[Community]**.
- **Better Bulldozer** (same author, forked out of Anarchy) adds filtered bulldozing — networks, buildings, trees, plants, decals, props as separate toggles — and single-click removal of ground surfaces and spaces **[Community]**. The interesting part for us is the *filter* idea: a bulldozer with type toggles is far more usable than one that deletes whatever is under the cursor.
- CS1's long-lived **Extra Landscaping Tools** did the equivalent job in the first game, adding brushes and surface painting the base game lacked **[Community]**.

---

## What makes it feel like CS2

Ranked by how much each contributes to the sensation, not by implementation cost.

1. **Four brushes, not forty.** Shift / Level / Slope / Soften is a complete vocabulary for city-scale terrain with almost no learning curve. Every one of them is discoverable in about five seconds of play, and the set has survived unchanged across both games.
2. **Level's right-click-to-sample.** The single best ergonomic idea in the whole toolset. It converts "what height should this be?" — an unanswerable question with a number box — into "the same height as that" — a pointing gesture. It is also what makes building flat pads for districts fast enough to be routine.
3. **Free and unmetered.** No cost readout, no resource bar, no unlock. You reshape the world as casually as you pan the camera, and that permissiveness is a large part of why players terraform constantly rather than treating it as a special occasion.
4. **A huge size range on one slider.** The same tool sculpts a whole valley and tidies a single lot. Nothing in the UI changes between those two uses.
5. **Roads that terraform themselves.** Cut-and-fill means most everyday earthworks happen as a side effect of drawing a road, and the automatic retaining wall at the cut face makes the result look intentional. The landscaping brushes are then for the cases the road tool did not cover.
6. **Terrain edits are masked by construction.** Genuinely a mixed blessing — it protects a built city from a careless stroke, and it is also the reason terraforming after the fact is so painful. Whether it belongs on this list is arguable, but it unmistakably *is* how the game feels.
7. **The editor is the same tools.** A player who has terraformed a city can make a map without learning anything new.

And the anti-pattern, which is just as much part of the CS2 experience and should not be reproduced: **no undo**. It makes players cautious with a tool whose whole appeal is that it is cheap to try things with.

---

## Metropolis v1 adoption

**Where the codebase stands.** `src/render/terrain.ts` already has exactly the right substrate for this: a **513 × 513 heightfield** (`GRID_SIZE`) over a **4096 m** world (`WORLD_SIZE`), giving `CELL_SIZE` = **8 m per heightfield sample** — the same 8 m as the zone cell, which is a happy accident worth keeping. The mesh is split into **8 × 8 chunks** (`CHUNKS_PER_SIDE`), so a brush stroke only needs to rebuild the chunks it touched. Heights are generated from composed noise (`DEFAULT_TERRAIN_PARAMS`) and are currently **read-only** — `heightAt` does bilinear sampling, roads probe it for grade and submersion, but nothing writes back. Making the array mutable and dirtying chunks is the whole of the plumbing work.

Proposed v1 scope, in build order:

1. **Make the heightfield mutable and chunk-dirtying.** A `setHeights(indices, values)` path on `Terrain` that marks affected chunks and rebuilds their geometry (and normals/colors) on the next frame. Everything else in this list depends on it. Keep the noise generator as the *initial* state so maps stay reproducible from a seed plus a diff.
2. **Three brushes: Shift, Level, Soften.** Skip Slope for v1 — it is the least documented, the least used in practice, and Level plus Soften covers most of what players actually reach for. Shift is signed (left raise / right lower). Level samples on right-click and applies on left-drag, exactly as CS2 does; this is the one interaction to copy precisely. Soften is a small Gaussian blur over the samples in the brush.
3. **Radial falloff, size and strength.** Brush weight = `strength × smoothstep` falloff from centre to rim, applied per frame while held. Size slider in metres, roughly **16 m to 512 m** — one heightfield cell up to an eighth of the world — which is CS2's spirit scaled to our smaller map. Strength 1–100%.
4. **A tool-options panel that matches the road tool's.** Per `ux-conventions.md` §3, landscaping is a toolbar *category*, the brush is the *asset*, and size/strength live in the same bottom-left options panel roads already use. Options persist when the player switches brush.
5. **Undo, from day one.** Ring buffer of strokes; each entry stores the bounding rect of touched samples plus the pre-stroke heights for that rect (a 64 × 64-sample rect is 4k floats — trivial). Push on mouse-up, so one stroke = one undo step. Depth of ~20 strokes. This is the deliberate divergence from CS2 and it is not negotiable: a destructive brush without history is hostile.
6. **Free, like CS2.** No cost, no unlock, no soil budget in v1. Our building system will be at least as unforgiving about slopes as CS2's is, so charging for mandatory flattening would be pure friction. Revisit only if buildings ever learn to sit on slopes gracefully.
7. **Occupancy masking against roads.** Before writing a sample, skip it if it lies within a road segment's footprint (a distance test against edge centrelines using existing road geometry, plus half-width plus a small margin). This reproduces CS2's protection behaviour, prevents the brush from tearing up a road the renderer assumes is grounded, and — importantly — means the existing road placement validation (`MAX_ROAD_GRADE`, submersion checks) stays true after an edit. Buildings get the same treatment once they exist.
8. **Re-validate nothing else.** Zone cells hang off roads, not off terrain, so a terrain edit does not invalidate them; they just render at the new height. Confirm this holds when the zone renderer lands.

**Explicitly deferred out of v1**: the Slope tool, terraforming cost or a soil resource, road cut-and-fill (see below), retaining-wall geometry at cut faces, water reacting to terrain edits, vegetation and surface painting, heightmap import/export, and any map editor.

**Consistency check against binding decisions.** Nothing here contradicts `docs/UNKNOWNS.md`. It does add one item the owner may want to weigh in on: **CS2's no-undo behaviour is being deliberately rejected**, which is the first place we knowingly diverge from the reference game on an interaction. The justification is that the absence is universally complained about rather than a design choice anyone defends.

**Interaction with the roads plan.** `roads-advanced.md` lists cut-and-fill as a later-path item explicitly blocked on "a mutable terrain heightfield with undo". Item 1 and item 5 above unblock it. That doc also notes that once cut-and-fill exists, `MAX_ROAD_GRADE` stops being a wall and becomes a price — worth keeping in view, but the sequencing is right: manual brushes first, road-driven terrain second.

---

## Later path

Roughly in the order they would pay off:

1. **The Slope tool**, once we can watch players hit the cases Level and Soften handle badly — long constant-grade ramps between two heights, mainly for rail and highway approaches.
2. **Road cut-and-fill**, per `roads-advanced.md`: drawing at an elevation offset excavates or fills terrain to meet the road profile instead of rejecting the placement. The largest single quality-of-life gain available on the terrain side, and the point at which terrain becomes something you shape *by building* rather than *before building*.
3. **Automatic retaining walls** at steep cut faces — a strip of vertical geometry generated where the terrain gradient at a road edge exceeds a threshold. Cheap, and it is most of why CS2's earthworks read as engineered rather than melted.
4. **Water responding to terrain.** Once there is a real water simulation rather than a flat plane at `WATER_LEVEL`, terrain edits start moving shorelines and filling basins. Learn from CS2's failure mode here and make the water state recoverable — a terrain edit should never be able to permanently mark ground as wet with no way back.
5. **Building plot flattening.** When a building claims its cells, level the heightfield under the footprint and blend outward over a short distance. CS2's inconsistency here is a known visual wart; doing it uniformly is not harder.
6. **Vegetation and surface brushes.** Trees, plants, and ground surface painting — the rest of the landscaping category. Purely decorative, which is exactly why it can wait, and exactly why players will eventually want it.
7. **Heightmap import/export and a map editor.** Build the editor as the same tools with the occupancy mask disabled and extra layers (water sources, resources) enabled, per §7 — a permission-widened view, never a second codebase. 16-bit greyscale PNG at the heightfield's native resolution is the obvious interchange format.
8. **A filtered bulldozer**, borrowing from Better Bulldozer: type toggles rather than "delete whatever is under the cursor". Not strictly terrain, but it is the same family of destructive-tool ergonomics and it benefits from the same undo stack.

---

## Sources

- [Paradox: Modding Dev Diary #2 — Map Editor](https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-2-map-editor)
- [Paradox forums: Modding Development Diary #2 — Map Editor](https://forum.paradoxplaza.com/forum/developer-diary/modding-development-diary-2-map-editor.1626922/)
- [Paradox forums: Behind the Scenes #2 — Editor](https://forum.paradoxplaza.com/forum/developer-diary/behind-the-scenes-2-editor.1602378/)
- [Colossal Order: Behind the Scenes #2 — Editor](https://colossalorder.fi/?p=2013)
- [Paradox forums: Strongly recommend adding an undo feature](https://forum.paradoxplaza.com/forum/threads/strongly-recommend-adding-an-undo-feature.1607353/)
- [Paradox forums: Terraforming payment](https://forum.paradoxplaza.com/forum/threads/terraforming-payment.1605965/)
- [Paradox forums: Auto-landscape for buildings is terrible](https://forum.paradoxplaza.com/forum/threads/auto-landscape-for-buildings-is-terrible.1606738/)
- [Paradox forums: Considering zoning in steep terrain](https://forum.paradoxplaza.com/forum/threads/considering-zoning-in-steep-terrain.1602525/)
- [Paradox forums: Cities Skylines 2 — Map size](https://forum.paradoxplaza.com/forum/threads/cities-skylines-2-map-size.1603586/page-2)
- [PC Gamer: CS2's weird terrain quirks mean you'll need to start landscaping immediately](https://www.pcgamer.com/cities-skylines-2s-weird-terrain-quirks-mean-youll-need-to-start-landscaping-immediately/)
- [GGRecon: How to terraform in Cities Skylines 2](https://www.ggrecon.com/guides/cities-skylines-2-how-to-terraform/)
- [Prima Games: How to terraform your city in Cities: Skylines 2](https://primagames.com/tips/how-to-terraform-your-city-in-cities-skylines-2)
- [DualShockers: How to use the landscaping tool](https://www.dualshockers.com/cities-skylines-2-how-to-use-landscaping-tool/)
- [The Nerd Stash: How to use the landscaping tools in CS2](https://thenerdstash.com/how-to-use-the-landscaping-tools-in-cities-skylines-2/)
- [GameWatcher: How can you change the terrain in CS2?](https://www.gamewatcher.com/news/cities-skylines-ii-change-terrain-how-to)
- [ToadieZzz: Cities: Skylines II landscaping for beginners](https://toadiezzz.com/cities-skylines-ii-tutorials/cities-skylines-ii-landscaping-for-beginners/)
- [GameSkinny: How to build retaining walls in CS2](https://www.gameskinny.com/tips/cities-skylines-2-how-to-build-retaining-walls/)
- [Steam discussion: Landscaping is now free](https://steamcommunity.com/app/949230/discussions/0/3815166994155568953/)
- [Steam discussion: Retaining walls](https://steamcommunity.com/app/949230/discussions/0/3877095833479834862/)
- [Steam discussion: Map import — heightmaps, terrain.party, etc.](https://steamcommunity.com/app/949230/discussions/0/3878221560440550550/)
- [Steam discussion: How to import a heightmap into the map editor?](https://steamcommunity.com/app/949230/discussions/0/4299322040762242211/)
- [Steam discussion: Heightmap for the editor](https://steamcommunity.com/app/949230/discussions/0/4349988819860740323/)
- [Steam discussion: Water bug with landscaping tool](https://steamcommunity.com/app/949230/discussions/0/3877096256097986168/)
- [Pinter Computing: Using the Map Editor in Cities: Skylines 2](https://pinter.org/archives/15403)
- [TechRadar: CS2 lets you build on an area 5 times bigger than before](https://www.techradar.com/gaming/consoles-pc/cities-skylines-2-lets-you-build-on-an-area-5-times-bigger-than-before)
- [Anarchy mod (yenyang) — Thunderstore](https://thunderstore.io/c/cities-skylines-ii/p/yenyang/Anarchy/)
- [Better Bulldozer — Nexus Mods](https://www.nexusmods.com/citiesskylines2/mods/129)
- [PCGamesN: The best Cities Skylines 2 mods](https://www.pcgamesn.com/cities-skylines-2/mods)
- [CS2 heightmap generator (GitHub)](https://github.com/danielnichols/CS2-heightmap-generator)
- [Extra Landscaping Tools (CS1) — Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=502750307)
