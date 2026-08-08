# Cities: Skylines II — Specialized Industry Areas: Deposits, Extractors, and the Raw-Material Chain

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) handles the systems that sit *underneath* ordinary industrial zoning: the natural-resource layers baked into every map, the area-drawing tool used to claim them, the extractor and processor buildings that work a claimed area, how yield responds to deposit density and depletion, how an area levels and what levelling unlocks, and how the raw materials that come out reach the rest of the economy on trucks. Compiled to inform an original implementation in *Metropolis*. Everything below is written in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains in this environment (including the official wiki), so the material below comes from many targeted web searches whose results are synthesized summaries of one or more pages. A further hazard specific to this topic: *Cities: Skylines 1* shipped an **Industries** DLC with a superficially similar "industry area" feature, and a large share of search hits describe **CS1**, not CS2. Where the two designs differ I say so explicitly, and I have discarded CS1-only mechanics (main-building-defines-area-type, five named building tiers, unique factories per area) unless a CS2 source corroborates them. Tags:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`).
- **[Dev]** — Colossal Order / Paradox dev diary or feature-highlight material (notably Dev Diary #9, *Economy & Production*).
- **[Community]** — player guides, Steam discussions, forum analyses. Often patch-specific.
- **[Inferred]** — my own reasoning, not stated by any source.
- **[Conflict]** — sources disagree, or CS1 and CS2 descriptions have contaminated each other.
- **[CS1]** — believed to describe *Cities: Skylines 1*; recorded because it is a useful design reference, not because CS2 does it.

Sister docs: `docs/research/cs2/economy.md` (resources, companies, imports/exports, Economy 2.0), `docs/research/cs2/zoning-districts.md` (why specialized industry is *not* a zone), `docs/research/cs2/environment.md` (the pollution fields that eat renewable deposits), `docs/research/cs2/progression.md` (milestones and development trees that gate the industry types), and `docs/research/cs2/ux-conventions.md` (info-view and tool grammar).

---

## How CS2 does it

### 1. Five resource layers, painted into the map

Every CS2 map carries five natural-resource fields, distributed over the terrain independently of anything the player builds: **groundwater, fertile land, forest, ore, and oil** **[Wiki]**. They are map data, authored per map (and visible per tile in the map-selection screen, where clicking a tile reports what it contains **[Community]**), not procedurally generated at runtime.

Two properties matter mechanically:

**Density, not presence.** A location does not simply *have* ore; it has an amount. The natural-resources info view renders each layer as a terrain tint whose **saturation encodes local abundance** — darker means richer — with a distinct hue per resource **[Community]**. The reported hues are green for forest, yellow for fertile land, black for oil, blue for ore **[Community]**; that mapping is a convention worth borrowing but is exactly the kind of surface detail that patches move around **[Inferred]**. The same info view also carries citywide statistics on availability and consumption per resource **[Wiki]**, so it doubles as the "am I running out?" screen.

**Renewability splits the set in two [Wiki]/[Dev]:**

| Layer | Renewable? | Behaviour |
| --- | --- | --- |
| Groundwater | Yes | Regenerates at a constant rate; over-pumping draws it down (see `services-utilities.md`) |
| Fertile land | Yes | Regenerates; **destroyed by ground pollution** |
| Forest | Yes | Regenerates; destroyed by ground pollution **and by forest fires** |
| Ore | **No** | Finite stock, monotonically drawn down by extraction |
| Oil | **No** | Finite stock, monotonically drawn down by extraction |

Renewable layers have a **constant renewal rate that is itself displayed in the info view** **[Wiki]** — the game tells you the recovery speed rather than making you infer it from a slowly-changing tint.

The pollution coupling is the elegant part. Farming and forestry in CS2 emit essentially no ground pollution themselves (agriculture is described as water-hungry but ground-clean; forestry as electricity-hungry and *noisy*) **[Community]**, so a farming belt does not poison its own soil. What kills fertile land is somebody else's ground pollution drifting in — a heavy-manufacturing district, a landfill, a coal plant. Since ground pollution in CS2 has memory and decays far more slowly than it accumulates (`environment.md` §1), placing dirty industry upwind of farmland is a decision the player pays for over hours. **[Inferred]**: this is the single strongest reason the resource layers are *fields* rather than discrete deposit blobs — a scalar layer can be subtracted from by another scalar field cell-for-cell.

### 2. The claim: a building first, then an area drawn around it

This is the structural point that most distinguishes CS2 from both CS1 and from ordinary zoning, and it is easy to get wrong from search results.

Specialized industry in CS2 is **not a paintable zone type** — you cannot drag it along road frontage the way you drag residential (`zoning-districts.md` §2) **[Wiki]**. Nor is it a free-floating district you paint first and populate later. The reported flow is **[Community]**:

1. The player picks a specialized industry type from the toolbar (farming variants, forestry, mining, oil drilling) and **places the building** against a road, exactly like a service building — footprint ghost, road-access check, cost tooltip.
2. Placement immediately activates an **area tool bound to that building**, and the player draws the parcel this particular installation works. The parcel is edited with area nodes / a brush rather than being constrained to the 8 m zoning grid, and it does not have to follow road geometry.
3. The parcel must lie **inside a limited radius around its building** — sources describe a circle within which the drawn area must fit, and describe players deliberately "using the full circle" to maximize output **[Community]**. No source I found states the radius in metres **[Unknown]**.
4. The area is **re-editable afterwards** — you can grow or shrink an installation's worked parcel at any later time **[Community]**. Community advice leans on this heavily: start small so you produce a modest surplus rather than a glut, then enlarge as demand grows.

So the unit of play is *one installation plus the land it works*, not *a district that contains many installations*. Multiple installations are placed side by side, each with its own parcel; the parcels tile the resource patch between them.

**[Conflict]** — the CS1 model is superficially similar but genuinely different, and search results freely mix them. In CS1 you place a **main building** that defines the area's *type*, paint a district-like area with a brush from the Districts menu, and then hand-place five categories of building inside it (extractors, processors, factories, auxiliary, warehouses) **[CS1]**. In CS2 there is no separate main building whose only job is to name the area, and no five-category ploppable catalogue; the extraction installation *is* the placement. What survives into CS2 is the brush-drawn, road-independent area and the rule that the area must contain the resource.

**Companies still move in.** Even though the player places the building, the lot behaves like a zoned lot underneath: a company occupies it and hires citizens, and the installation is inert until that happens **[Community]**. This is why the classic failure mode is a placed-but-transparent building — the game placed the shell but no company took it, usually because the driveway never connected to the road. Community threads are full of it: the connection is tested against the building's *driveway*, not against any edge of its footprint, so a road grazing the wrong side leaves the installation permanently unstaffed, and the fix is bulldoze-and-replace **[Community]**. There are also reports of the area failing to materialize when there is not enough clear ground around the building for the parcel to fit **[Community]**.

**Livestock and stone are the exceptions.** Livestock farming and stone mining require **no underlying resource layer at all** and can go anywhere **[Wiki]**. Their output is therefore a pure function of parcel area — players report that for these two, doubling the drawn area doubles potential production, and that one large installation ≈ two half-sized ones **[Community]**. That makes them the "always available" floor of the extraction economy, which matters because they are also among the types unlocked by default (below).

### 3. Yield: how much comes out

The reported production model, assembled from several partial descriptions **[Community]/[Wiki]**, is a product of independent multipliers:

**Yield ≈ (worked-area size) × (average deposit density under that area) × (workforce term) × (area level bonus) × (budget/efficiency modifiers)**

Component by component:

- **Area × density.** Extractors are described as producing "at a rate dependent on resource abundance and building maximum" **[Community]** — i.e. the parcel integrates the resource field beneath it, capped by the installation's own throughput ceiling. This is why drawing a big sloppy parcel that includes weak patches is still recommended: a low-density cell contributes a little rather than nothing.
- **Workforce.** CS2's general company rule applies: output scales with employee education level and staffed hours, with a reported **+15% efficiency from happy workers** (`economy.md` §4) **[Wiki]**. Extraction is low-education work, which is exactly why it is the employer of last resort for an under-educated early city **[Inferred]**.
- **Area level.** Each level adds a flat production bonus and cuts pollution (§4).
- **Budget / policy modifiers.** **[Conflict]/[CS1]** — the widely-quoted numbers (+4% per level, up to +25% from an area budget slider at +50% upkeep, +5% per barracks to a cap of +100%, +10% from an automation policy, a 255% overall ceiling) come from CS1's Industries DLC and I would not carry any of them into a CS2 description. The one figure that *is* attributed to CS2 is **+4% production and −10% pollution per area level** **[Wiki]**, which is suspiciously the same 4%; it may be a genuine carry-over or may be contamination **[Inferred]**.
- **Agglomeration.** Several sources describe a specialization bonus: multiple companies producing the same resource inside one area become more efficient together **[Community]**. Whether this is a modelled CS2 term or a restatement of CS1's behaviour is unclear **[Conflict]**, but the design intent — reward concentration, punish scattering one farm per hillside — reads true for both.

**Depletion, concretely.** For ore and oil, extraction subtracts from the field permanently, and the effect the player sees is not a sudden stop but a **slow decline in output from the same installation** — "less and less resources being extracted" **[Dev]**. Nothing is destroyed; the building keeps standing and keeps employing people at falling productivity. That is a deliberately gentle failure mode, and it interacts with a rule from `economy.md`: **specialized industry companies cannot go bankrupt — they downsize, shedding employees, instead of vacating the lot** **[Wiki]**. A depleted oil field therefore leaves a half-staffed derrick and a slow unemployment problem rather than a crater in the city, which is much more forgiving than the generic-industry bankruptcy path.

For fertile land and forest, the equivalent decline comes from pollution encroachment or (forest only) fire, and it is **recoverable** — remove the pollution source, wait out the slow ground-pollution decay, and the layer regrows at its constant rate **[Wiki]/[Inferred]**.

### 4. Levelling and unlocks

Two separate ladders gate specialized industry, and conflating them is a common source of confusion.

**The area's own level (1→5).** An industry area levels up "as you produce resources and supply jobs", from level 1 to a maximum of 5; each level **unlocks new buildings, adds ~4% production, and reduces pollution by ~10%** **[Wiki]**. Storage is the most-cited unlock: resource-specific storage (a silo only ever holds crops) is tied to the area's level, while generic warehouses that can be retasked between processed goods are not (`economy.md` §5) **[Community]**.

Levelling is reported to be **finicky in practice** **[Community]**: installations that stay at level 1 for hours are a common complaint, and the diagnosis players converge on is that levelling tracks **company profitability**, which in turn depends on being able to buy inputs *locally*. An installation whose downstream processor has to import everything never accumulates enough margin to level. The standard player workaround is to drop the industry tax rate to near zero until the companies establish themselves, then raise it in small steps **[Community]**. Whether the stubbornness is intended difficulty or a bug is genuinely disputed — some threads treat it as the former, some as the latter **[Conflict]**.

**The progression ladder.** Which industry types exist at all is controlled by milestones and development trees (`progression.md`). Since patch **1.1.5f1**, four types are **unlocked from the start** — livestock farming, stone mining, grain farming, and forestry **[Wiki]** — with the rest (vegetable and cotton farming, coal and ore mining, oil drilling) bought later with development points. The **natural-resources info view itself unlocks at a milestone** (reported as the fifth) **[Community]**, which means for the first stretch of the game the player is placing farms and quarries without being able to see the resource map at all. That is not obviously good design, but it does explain why the two resource-free types are the ones handed out for free **[Inferred]**.

The full CS2 roster is reported as **nine specialized industry types** **[Community]**: livestock, grain, vegetable and cotton farming (the last three on fertile land); forestry (forest); stone mining (anywhere); coal and ore mining (ore); oil drilling (oil).

### 5. From raw material to finished good, and the trucks in between

CS2's chain shape is uniform (`economy.md` §5) **[Wiki]/[Community]**:

**natural-resource layer → extractor → raw material → processor → material good → factory → finished good → commerce / export**

Specialized industry occupies the first two arrows only. The commonly-repeated summary is that specialized industry buildings come in two functional flavours: **extractors, which turn the natural resource into a raw material, and processors, which turn that raw material into the material goods generic industry actually accepts** **[Community]**. Wood is the canonical worked example: forestry produces wood, which is either consumed directly (as heating fuel), sold on to processing companies, or exported **[Wiki]**. The reported total inventory is 36 resources — 10 raw, 18 material, 8 immaterial — and each specialized industry type is described as owning one raw material plus roughly two processed materials **[Wiki]/[Community]**.

**Everything moves on trucks, and distance is the whole logistics model [Wiki]/[Community]:**

- Deliveries are **door to door**. There is no abstract resource pool; a company that needs wood dispatches (or receives) an actual vehicle.
- **The vehicle belongs to the selling building** and returns home when done. One truck sources from a single supplier but may drop at several customers on one circuit.
- **Buyers pick the nearest seller.** This is the single most consequential rule: purchasing is a proximity query, not a price auction. A cargo terminal close to a factory will out-compete a local supplier that is farther away, and — read the other direction — placing terminals far from the industrial core is what keeps local producers in business.
- **Import/export cost scales with volume**, because the notional external destination gets farther away the more you ship (`economy.md` §6) **[Wiki]**. Autarky is therefore economically attractive without being mandated.
- **Cargo terminals behave as warehouses with an outside connection** — a staging buffer that absorbs inbound and stages outbound freight, not merely a transport stop **[Community]**.
- **Storage is two-tier**: resource-specific storage unlocked by area level, plus generic retaskable warehouses **[Community]**.

The consequence for extraction siting is sharp and is the thing players actually feel: a farm belt on the far side of the map from its processors generates a permanent, heavy freight flow down whatever road connects them, and CS2's proximity rule means you cannot fix it with policy — only with geometry. Extraction is a **traffic** problem disguised as an economy problem **[Inferred]**.

---

## What makes it feel like CS2

1. **The map has an opinion about where your industry goes.** Resource layers are authored per map, so the extraction economy is site-specific in a way zoning never is. Two players on the same map build recognisably different farm belts; two players on different maps build different *economies*. This is the strongest argument for the whole feature existing.
2. **Density is visible before it is relevant.** The info view's saturation ramp answers "how good is this spot" as a picture. The player scouts, then commits. Every good decision in this system is made in the overlay, not in a panel.
3. **You place the building, then draw its reach.** Two-step placement is unusual and it reads as *claiming* rather than *painting*. The re-editable parcel turns the claim into a dial the player keeps adjusting as demand moves — an ongoing relationship with a building rather than a one-time plop.
4. **Depletion is a fade, not a cliff.** Output sagging over an hour, with the building still standing and still employing people, is far better texture than a derrick that vanishes. Combined with the no-bankruptcy rule, running a field dry produces a *neighbourhood in decline* — which is exactly the kind of problem a city-builder wants to hand you.
5. **Renewables punish you for something you did somewhere else.** Farmland dying because of a factory two kilometres upwind is the most satisfying long-range coupling in the game: two systems the player thinks of as unrelated, joined by a field that has memory.
6. **The trucks make it legible.** Because supply is a nearest-seller query resolved by a visible vehicle, a badly-sited farm belt announces itself as a queue of trucks on one road. The simulation's mistake and the player's view of it are the same object.
7. **Failure is quiet, which is the one weak spot.** The transparent unstaffed building, the installation stuck at level 1, the resource overlay you cannot see until milestone five — CS2's specialized industry fails silently more often than it should, and the community threads are the evidence. Whatever else we copy, we should not copy that.

---

## Metropolis v1 adoption

`economy.md` already places natural-resource deposits and specialized industry **outside v1** ("explicitly not in v1: multi-stage production chains, natural-resource deposits and specialized industry, warehouses and storage buffering, cargo vehicles"), and `zoning-districts.md` puts extraction areas last on its later-path list. Nothing found in this research argues for pulling that forward: extraction is only meaningful once there is a resource graph for it to feed, and v1 tracks two abstractions ("goods" and "services"), not a graph.

**So the v1 position is: build nothing, but reserve three things in the data model**, all of which are cheap now and expensive to retrofit:

1. **A per-map scalar resource-layer raster.** Store the map as carrying N named scalar layers on a coarse grid (much coarser than the 8 m zone cell — the same class of raster as the pollution fields in `environment.md` §1, and ideally literally the same grid so subtraction is cell-for-cell). In v1 the layer set is empty and the raster is never sampled. Adding a layer later is then data, not architecture.
2. **A "worked area" concept on the building record** — an optional polygon (or brush-painted cell mask) attached to a building instance, distinct from its footprint. Zero buildings use it in v1. This is the one CS2 idea that does not fall out naturally from any other system, and it is the reason to write it down now.
3. **A renewable/finite flag and a regeneration rate per layer**, even though nothing reads them.

**If extraction does get pulled into v1 scope** — which I would only recommend if the owner wants the map to feel authored rather than generic — the minimum honest version is:

- **Two layers only: fertile land and ore.** One renewable, one finite, so both behaviours exist. Skip groundwater (it belongs to the water system), oil (a third layer buys nothing the ore layer does not), and forest (needs tree rendering and fire).
- **One info view** with a saturation ramp per layer, following the `ux-conventions.md` overlay grammar, and **available from the start** — CS2 gating the resource overlay behind a milestone is a mistake, not a feature.
- **Place-then-draw, with the radius limit.** Plop the installation on a road, then drag a rectangular parcel constrained to a fixed radius around it. Rectangle, not free polygon: it is trivially editable, trivially area-computed, and reads fine. Re-editable from the building's info panel.
- **Yield = clamp(parcel area × mean density under parcel) × staffing fraction.** One line. No level bonus, no budget slider, no agglomeration term.
- **Depletion on the finite layer only**, subtracting extracted volume from the raster cells under the parcel, so the tint visibly fades where you have been digging. Renewal on the other layer at a constant rate. That single visible feedback — the overlay changing because of your own activity — is most of the feature's value.
- **Output flows into the existing "goods" pool** with no processing step, and moves by the statistical freight flow already chosen in `UNKNOWNS.md` rather than by per-vehicle trucks. Distance can enter as a cost term on the flow without any pathfinding.

**Explicitly rejected for v1 even under that expansion:** area levels and level-gated unlocks; storage and warehouse buildings; processors as a distinct building class; the nine-type roster (two types is enough to teach the mechanic); pollution eating renewable layers; agglomeration bonuses; per-vehicle cargo trucks.

---

## Later path

Roughly in dependency order — each item is close to worthless before the one above it exists:

1. **The resource raster and its info view.** Layers authored per map, saturation ramp, statistics readout. Purely a map-data and rendering job; no simulation depends on it yet, so it can land early and make maps feel distinct on its own.
2. **Place-then-draw extraction installations** with a radius-bounded, re-editable parcel, yield proportional to area × density, and finite-layer depletion. This is the smallest slice that delivers the CS2 feel.
3. **The resource graph** (`economy.md` later-path item 2): ~8–12 resources in an authored DAG. Extraction now has somewhere to send its output, and "raw material" becomes a real category rather than a synonym for goods.
4. **Processors as a second building class** inside the worked area, converting raw → material. The chain is now two links long and siting matters twice.
5. **Nearest-seller sourcing with a distance cost**, still on statistical flows. This is where extraction stops being a number and starts being a traffic decision — the highest feel-per-line item in the whole list.
6. **Pollution coupling**: ground pollution subtracts from the renewable layers, which regenerate at a constant rate. Needs `environment.md`'s pollution fields on a compatible grid, which is why item 1 should share their raster.
7. **Area levelling 1→5**, driven by accumulated profitable production rather than by placement, granting a small production bonus and a pollution reduction. Add the level-gated resource-specific storage building at the same time, since level unlocks are pointless with nothing to unlock.
8. **Per-vehicle freight**, once `UNKNOWNS.md`'s statistical traffic model gives way to agents. Seller-owned trucks, multi-drop circuits, cargo terminals acting as warehouse buffers.
9. **The full nine-type roster plus resource-free types** (the livestock/stone equivalents, whose yield is pure parcel area) — content work, once the art pipeline can absorb it.
10. **Forest fires and forestry replanting.** Last, and honestly optional: a whole event system for one layer's failure mode.

**Two things to do differently from CS2, deliberately:**

- **Never fail silently.** If an installation has no company, no road connection, no workforce, or a parcel that overlaps zero resource, say so in the building panel *and* on the building itself. CS2's transparent-building and stuck-at-level-1 complaints are entirely avoidable UI failures.
- **Show the depletion curve.** A small sparkline of this installation's output over time, in its panel, converts "my economy feels worse" into "that field is running dry" — which is the difference between a mechanic the player experiences and one they only suffer.

---

## Sources

- [Natural resources — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Natural_resources)
- [Supply Chains — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Supply_Chains)
- [Economy — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/index.php?title=Economy)
- [Zoning — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Zoning)
- [Progression — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Progression)
- [Transportation — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Transportation)
- [Patch 1.1.X — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Patch_1.1.X)
- [Paradox: CS II Feature Highlight #9 — Economy & Production](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production)
- [Paradox forums: Development Diary #9 — Economy & Production](https://forum.paradoxplaza.com/forum/threads/development-diary-9-economy-production.1595744/)
- [Colossal Order: Development Diary #9 — Economy & Production](https://colossalorder.fi/?p=1809)
- [Paradox: CS II Feature Highlight #3 — Public & Cargo Transportation](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation)
- [Paradox: CS II Feature Highlight #10 — Game Progression](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/game-progression)
- [Paradox forums: Specialized industries Cities Skylines 2](https://forum.paradoxplaza.com/forum/threads/specialized-industries-cities-skylines-2.1594227/)
- [Chill Place Gaming: How Industry Areas Work in Cities: Skylines II](https://chillplacegaming.com/industry-areas-cities-skylines-ii/)
- [Chill Place Gaming: CS II Supply Chains — production, storage, transportation](https://chillplacegaming.com/supply-chain-cities-skylines-ii/)
- [PCGamesN: Cities Skylines 2 industry guide](https://www.pcgamesn.com/cities-skylines-2/industry)
- [modscities2: Cities Skylines 2 — Specialized Industries](https://www.modscities2.com/cities-skylines-2-specialized-industries)
- [modscities2: Cities Skylines 2 — Industry Guide / Tutorial](https://www.modscities2.com/cities-skylines-2-industry-guide/)
- [Gamepressure: Specialized Industry in Cities Skylines 2, bug explained](https://www.gamepressure.com/newsroom/specialized-industry-in-cities-skylines-2-bug-explained/z36292)
- [Steam discussion: Specialized industry size and number](https://steamcommunity.com/app/949230/discussions/0/3937895474111749173/)
- [Steam discussion: Specialised industry won't level up](https://steamcommunity.com/app/949230/discussions/0/601902244366916612/)
- [Steam discussion: specialized industry NO ROAD ACCESS](https://steamcommunity.com/app/949230/discussions/0/3877095833476747823/)
- [Steam discussion: Road/path problems with specialized industry zones](https://steamcommunity.com/app/949230/discussions/0/3877095833481369845/)
- [Steam discussion: Possible cause of the cargo transportation issues](https://steamcommunity.com/app/949230/discussions/0/4031347072448117383/)
- [Magic Game World: CS2 guide to cargo transportation](https://www.magicgameworld.com/cities-skylines-2-guide-to-cargo-transportation/)
- [My Gaming Tutorials: Optimizing natural resources in Cities Skylines II](https://mygamingtutorials.com/2025/06/06/optimizing-natural-resources-in-city-skylines-ii/)
- [Dexerto: CS2 development trees — unlockables and costs](https://www.dexerto.com/gaming/cities-skylines-2-development-trees-unlockables-and-costs-2349659/)
- [GameRant: CS2 — every development tree and what to buy first](https://gamerant.com/cities-skylines-2-every-development-tree-and-what-to-buy-first/)
- CS1 comparison material (used only to mark what CS2 does *not* do): [Industry areas — Cities: Skylines Wiki](https://skylines.paradoxwikis.com/Industry_areas), [Industries DLC Tutorial](https://skylines.paradoxwikis.com/Industries_DLC_Tutorial), [Supply chain — CS1 Wiki](https://skylines.paradoxwikis.com/Supply_chain), [Warehouses — CS1 Wiki](https://skylines.paradoxwikis.com/Warehouses), [Love Cities Skylines: Specialised industry supply chain](https://www.lovecitiesskylines.com/supply-chain-specialised-industry/)
