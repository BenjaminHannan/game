# Cities: Skylines II — Roads and Road Tools

Research notes on the road-building systems of *Cities: Skylines II* (Colossal Order / Paradox Interactive, released October 24, 2023), compiled to support an original, faithful reimplementation of the mechanics in *Civitopia*. All numeric values below are **facts about game behavior** (parameters, not expression) and are documented here in the researcher's own words.

**Methodology note / confidence convention:** this network environment could not directly fetch web pages (all outbound `WebFetch` calls were blocked by network policy, including to the official wiki). Everything below was gathered through many targeted web searches whose results are synthesized summaries of one or more sources, primarily the official wiki (`cs2.paradoxwikis.com`), Paradox forums, Steam Community discussions, and community guides. Because I could not read the primary wiki tables myself, I mark every figure with a confidence tag:
- **[Wiki]** — attributed by search results specifically to the official Paradox wiki; treated as likely-accurate but *not independently verified* by direct inspection.
- **[Community]** — sourced from player forum posts, Steam discussions, or third-party guides/wikis; may reflect a specific patch version, a specific build, or personal testing rather than an official spec.
- **[Conflict]** — two or more sources disagree; both readings are given.
- **[CS1]** — this is a *Cities: Skylines (1)* value surfaced by search, included only for context/comparison, not to be assumed valid for CS2.

---

## Overview

Roads are the foundational infrastructure system in CS2: nearly every other system attaches to them. A road segment simultaneously provides (1) a traffic surface with lanes for cars, buses, trams, bikes, and pedestrians; (2) the buildable "frontage" that zoned lots grow along, with zone depth and land value tied to what road they face; and (3) buried utility conduits — most road types carry low-voltage electrical cable and water/sewage pipe automatically, so placing a road frequently placates power and water needs at the same time. Roads are drawn with a Bezier-curve-based tool that supports multiple placement modes (straight, curved, grid, parallel), with an elevation system layered on top for bridges, tunnels, and (added later) quays and piers.

Road building was one of the most actively patched systems post-launch. Two updates particularly relevant here:
- **Economy 2.0** (patch **1.1.5f1**, shipped **June 24, 2024**): raised road construction and upkeep costs, cut the bulldoze refund, added a per-tile upkeep fee, and removed hidden budget subsidies — road networks became meaningfully more expensive to build and run relative to launch.
- **Detailer's Patch #2** (patch **1.2.0f1**, ~2024): brought back a "Traffic Routes" flow-visualization overlay, added a dedicated Cul-de-sac tool category, and expanded roundabout variety (7 new decorative styles × 4 sizes).
- **Quays & Piers patch** (**1.3.3f1**): added the Quay (waterside retaining-wall/terracing network) and Pier (pedestrian dock) network types described below.

The rest of this document works through placement/snapping/elevation tools, the road-class hierarchy and its costs, upgrading, intersection control, wear/maintenance, parking, bundled utilities, outside connections, and finally the node/segment/lane data model as understood by modders.

---

## Mechanics in detail

### 1. Road placement modes

The road tool exposes **six distinct drawing modes** (a hotkey cycles between them) **[Community/Wiki]**:

1. **Straight** — click 1 sets the start point, click 2 sets the end point. A straight segment is drawn between them.
2. **Simple Curve** — click 1 = start, click 2 = the curve's bend (control point), click 3 = end. Produces a single smooth arc.
3. **Complex Curve** — click 1 = start, click 2 = first bend, click 3 = second bend, click 4 = end. Produces an S-shaped curve with two inflection control points.
4. **Continuous** — click 1 = start, click 2 = first bend, click 3 = an end point that immediately becomes the start of the *next* curved segment; further clicks keep chaining additional bends/segments without restarting the tool, letting you lay a long, multi-curve road in one continuous drag-and-click session.
5. **Grid** — builds a rectangular block of parallel/perpendicular roads (a "city block" pattern) in three clicks: click 1 places the starting corner, moving the mouse and clicking again sets the grid's *width*, and a third click sets the grid's *length*. The resulting block layout previews live as you adjust it.
6. **Parallel** — draws two roads simultaneously, offset from each other at a fixed, **player-customizable distance**, and matching each other's curvature. Explicitly called out as intended for laying matched highway carriageways or divided boulevards.

Two additional placement-related features layered on top of the six modes:
- **Cut-and-fill construction**: lets a road be built through uneven terrain without the terrain forcing an unrealistic slope or an automatic bridge — the ground surface reshapes itself (cut into hills, filled over dips) to meet the road's chosen elevation. This is a mode of the *elevation* control (see below) rather than a 7th drawing mode.
- A **Line Tool** and **Roadside Tree Selector** (added in Detailer's Patch #2) let players fine-tune spacing of roadside props (trees, etc.) and choose which vegetation appears on each side of a street — a decoration feature layered on existing roads rather than a placement mode.

### 2. Snapping

By default, the road tool snaps to several guides simultaneously **[Community]**:
- **Zoning cell length** — snaps movement/length to 8 m increments (the width of one zoning cell).
- **90° angles** — snaps bend/end direction to right angles.
- **Sides of buildings** — snaps to align with adjacent building edges.
- **Zone grid** — snaps to the *best available* zoning grid under the cursor, which is not necessarily the same grid the road segment started from; this is a common cause of misaligned grids when building large areas, since the tool can silently jump to a neighboring grid's orientation.
- **Guide lines** — snaps to extension guide-lines projected from existing geometry.
- **Existing geometry** — snaps to already-placed nodes/segments so new roads connect cleanly.

All of these can be toggled off individually in the construction menu. Community best practice for building a perfectly regular grid with no gaps/overlaps is to **disable** "snap to guide lines" (frequently cited as the single biggest cause of grid corruption) and often "snap to sides of building," keeping only zoning-cell-length + existing-geometry + 90°-angle snapping active. A related failure mode: on longer road segments, more than one angle can read as a valid "90°/180°" snap simultaneously, which can cause the zoning grid to wedge/overlap into itself at the far end of a long straight run.

### 3. Elevation control

- **Elevation offset** is adjustable in fine increments — sources describe a range of roughly **1.25 m up to 10 m per adjustment step** **[Community]**, letting a road be raised or lowered gradually rather than snapping to a small number of fixed "levels" as in some other city builders.
- **Negative elevation** first produces a **cut/sunken road** (open trench, terrain excavated around it); pushing further negative transitions the road into a fully enclosed **tunnel**. Community discussion places the surface→full-tunnel transition around **12.5 m** of depth **[Community]**, though this boundary is a matter of player testing rather than a confirmed spec value.
- **Elevated roads** (positive elevation) let a road cross other roads, rail, or terrain as a bridge/overpass; the game is described as making an elevated road "as easy to build as a bridge." Bridge **pillars** are reported to appear once elevation reaches roughly **8.75 m**; below that height threshold the game instead renders solid, barrier-like supports rather than discrete piers **[Community]**.
- **Cut-and-fill roads**: rather than forcing a bridge over every terrain dip, the tool can reshape the ground itself (cut through high ground, fill in low ground) so the road surface stays at the chosen elevation without an unrealistic slope.
- **Quays** (added in the Quays & Piers patch): a shoreline/retaining-wall network type. Unlike ordinary roads and pedestrian paths — which only generate a retaining wall or bridge when there is a *significant* elevation change — a quay reacts to **any** elevation difference and immediately builds a retaining wall on the lower side. Quays do not require adjacent water, so they can be dragged across a slope purely to terrace the landscape; doing so automatically pushes the terrain down on the wall side, and the game is reported to want roughly a **10 m** height difference for terracing to read correctly.
- **Piers**: a pedestrian-only leisure network (found in the Landscaping → Paths menu, not the Roads menu), offered in **three width variants — Narrow, Medium, Wide** — that can be mixed and connected to build out a dock/boardwalk network.
- **Retaining walls** generally: generated automatically by roads/paths only at significant grade changes (unlike quays, which react to any change).

### 4. Road classes and hierarchy

CS2 organizes roads into a traffic hierarchy commonly described (informally, by guides) as **Alley → Gravel → Small → Medium → Large → Highway**, with each traffic tier available in several named cross-section variants. Only the basic two-lane road is available at the very start of a new save; every other tier/variant unlocks either by simply placing that first road or via later progression milestones/development points.

- **Gravel (dirt) road** — the cheapest, lowest-upkeep surface type; historically the "dirt road" from CS1, renamed. Used for early-game or rural roads, and deliberately kept slow (community-reported displayed speed **~30**) to bias traffic toward faster paved alternatives. A one-way gravel variant exists for cheap directional rural roads.
- **Alley** — one-tile-wide urban infill street. Reported as the **slowest max speed in the game, ~25% slower than a "normal street"**. Several alley variants carry roadside parking (e.g., the *One-Way Alley*); a *Parking Alley* and *One-Way Parking Alley* are explicitly named small-road variants.
- **Small roads** (two-lane class) — the only road available at city start. Named variants include Two-Lane Parking Road, Two-Lane Divided Parking Road, One-Lane One-Way Parking Road, Parking Alley, and One-Way Parking Alley.
- **Medium roads** (commonly four-lane) — intended for moderate traffic / busier residential or light-commercial streets. Named variants include Four-Lane Parking Roads with either perpendicular or angled parking, plus tram-equipped variants (Two-Lane Road with Tram Tracks, Four-Lane Road with Tram Tracks — in these, the center lane(s) become tram-exclusive).
- **Large roads** — designed for high-traffic zones: commercial hubs and major through-arteries. Higher capacity and (per one source) higher allowed speed than medium roads; see the speed-limit conflict noted in the parameters table below.
- **Highway** — the intercity backbone; highest traffic volume and speed of any tier, and **does not allow direct building/zoning access** the way lower tiers do. Highways are described as coming "in every size" as their own special category rather than fitting the small/medium/large ladder. Highway ramps (on-/off-ramps) are represented as single-lane one-way highway pieces (a single-arrow icon in the UI).
  - The maximum *buildable* highway configuration is **3 lanes in one direction** (a one-way, 3-lane highway). A 6-lane (3+3), two-way highway *does* exist in the game files as a unique, non-buildable asset — it's the model used for the Golden Gate Bridge on the San Francisco map — but community sources report it was intentionally excluded from the general highway build menu due to driver-AI issues found during development **[Community, unverified]**.
  - Highways carry **no bundled utilities** (see §9) unless a streetlight upgrade is added, which grants only power, never water/sewage.
  - Sound barriers can be added to (non-elevated) highway segments to cut traffic noise; they are unavailable on elevated/raised highway sections.
  - A city policy exists to **remove speed limits from highways entirely**, trading faster flow for a higher crash rate.
- **One-way variants** exist across nearly every tier (One-Way Alley, One-Way Gravel Road, One-Lane One-Way Parking Road, one-way highway segments, etc.) and are used both to direct traffic flow and, in some variants, to free up space for extra roadside parking on the remaining side.
- **Public-transport lanes**:
  - **Bus lanes** are added to an eligible road via the Replace tool. They behave as **priority lanes, not exclusive lanes** — general traffic is explicitly allowed to use them to turn (right, or left in left-hand-traffic setups), to go straight into a non-bus lane, or to reach a building directly. Mechanically, pathfinding simply treats the bus lane as *less attractive* to cars, so if it's still the fastest available path a car will use it anyway — a frequently-cited community complaint that bus lanes get "used by everyone."
  - **Tram tracks** can likewise be retrofitted onto qualifying roads via the Replace tool (creating shared road+tram cross-sections), or built as a **fully separate dedicated track** bypassing road traffic entirely. Tram tracks **cannot** be added to highways, alleys, gravel roads, or some bridges.
  - Dedicated **bus-only roads** also exist as their own road category, restricted to buses and service vehicles.

### 5. Road upgrading / replacing in place

CS2 replaces CS1's "Upgrade" tool with a more flexible **Replace** tool (found in the Roads menu, with bus-lane/tram-track retrofits specifically living in the Transportation menu once relevant public-transport types are unlocked). Using it on an existing road lets you, without redrawing the alignment:
- Swap the road's entire type/cross-section for a different one.
- Add or remove **trees** along the road (trees can only be added *to roads*, not as freestanding landscaping via this tool).
- Add or remove **sound barriers** (highways only).
- Replace the shoulder/roadside-parking strip with **grass**, a row of **trees**, or an **extra-wide sidewalk**.
- Add or remove **highway lighting** — this both improves nighttime visibility/safety and grants that highway segment low-voltage power-carrying capacity it wouldn't otherwise have.
- Add/remove bus lanes and tram tracks (subject to the per-type restrictions in §4).

**Cost rule**: if the replacement configuration is **more expensive** than the existing road, the upgrade costs the *difference* in price. If the replacement is the **same price or cheaper**, the replacement is **free**.

### 6. Intersections, traffic control, and roundabouts

- **Auto-generation**: whenever two or more road segments meet at a shared point, the game automatically builds the junction geometry (merged lanes, turn connections). If a pedestrian path also connects at that node, a traffic light is **automatically placed** there by default.
- CS2 supports **four intersection-control types**: right-of-way/**yield**, **stop signs**, **traffic lights** (stoplights), and **roundabouts**.
  - **Default assignment**: an intersection where two *small* roads meet defaults to **stop signs**; an intersection involving a *medium* or *large* road defaults to **traffic lights**.
  - Manual control (unlocked via a development-point spend under "Advanced Road Services") lets a player select the traffic-light tool and right-click a junction to strip its lights — doing so causes the game to automatically assign **yield** signs, prioritizing the higher-class road over the lower-class one.
  - **Known limitation**: control is applied **per whole intersection**, not per individual approach/leg. Vanilla play has no way to designate one specific road as a "priority road" that keeps flowing while only the crossing road stops (a feature CS1 had via a dedicated tool) — every leg of a given junction gets the same treatment. This gap is exactly what popular traffic-control mods (e.g., "Traffic," the spiritual successor to CS1's TM:PE, and "Advanced Road Tools") exist to fill.
  - **No protected left-turn phase**: signalized intersections do not offer a dedicated left-turn arrow; left-turning traffic must filter through oncoming traffic during the shared green phase, a frequently cited source of AI-driven congestion.
- **Crosswalks** are placed/removed with their own small tool (next to the traffic-light toggle): click a road/leg to add a crosswalk, click again (or right-click) to remove it. Removing crossings can speed car throughput through a junction at the cost of forcing pedestrians to detour to the next available crossing.
- **Lane Arrows** is a simplified per-lane turn-restriction tool — force a given lane's allowed turning movements, including a **"No Straight Through"** toggle to keep drivers from cutting across a busy junction. It's explicitly described as a lighter-weight tool than full manual lane-to-lane connection editing.
- **Auto-generated turn lanes**: transitioning a road from a wider *asymmetric* cross-section (e.g., 5-lane or 3-lane asymmetric) into a narrower *symmetric* one (4-lane / 2-lane) right at a junction causes the "extra" lane at the junction itself to read as a dedicated turn lane, with the matching stoplight phase — a workaround players use in lieu of a first-class turn-lane tool.
- **U-turn AI behavior** (known quirk, useful to be aware of rather than necessarily replicate faithfully): vehicles sometimes make unnecessary U-turns instead of continuing straight or using a marked lane — queuing in a turn lane and then reversing direction, or exiting a highway via an off-ramp only to immediately re-enter via the adjacent on-ramp, overloading the (lower-capacity) ramp pair. Where two highway carriageways meet head-on, the game places an automatic "no U-turn" restriction that AI vehicles are reported to frequently ignore.
- **Roundabouts**: a dedicated roundabout tool lives in the Roads tab **from the very start of a save**, with no milestone gate reported — drag-and-drop places a complete, ready-made circular junction wherever two roads cross, working across road classes from small two-lane up through highway width. Manual roundabouts can still be hand-built with the curved road tool: draw a one-way circular road (any width), then strip the auto-placed stoplights at each feeder leg via the traffic-light tool, which causes the game to auto-assign yield signs to the incoming roads. Building the manual way is gated behind "Advanced Road Services" (one development point). Detailer's Patch #2 expanded the roundabout catalog with **7 additional decorative variants** (e.g., striped-with-flowerbed, mosaic), each offered in **4 sizes** (small through very large) — 28 new prefabs on top of the original set.
- **Cul-de-sacs**: added as a dedicated small tool category in Detailer's Patch #2, with **3 variants** (plain asphalt, grass, tree-lined), functioning as a small roundabout-like turnaround at a dead-end street.
- **Custom intersection assets**: CS2's Asset Editor supports building and sharing custom intersection prefabs — typically by duplicating an existing vanilla intersection asset as a starting point and modifying it, then publishing it through the game's content-sharing system for other players to use.

### 7. Road wear/condition, weather, and maintenance depots

- Roads accumulate physical **wear** from traffic over time. The dedicated **Roads info-view** color-codes every segment from **green** (good condition) through to **red** (poor condition).
- **Poor road condition** slows traffic speed on the affected segment and **increases the local probability of traffic accidents**.
- The **Road Maintenance Depot** service building dispatches maintenance vehicles that patrol the surrounding road network, repairing wear and reducing accident risk. It's unlocked by spending a development point (associated with "Advanced Road Services" in community guides).
- Depot effectiveness scales with its **budget slider**: raising budget increases both the number of vehicles it fields and its effective service radius. Under-funded depots can sit below 100% efficiency and fail to reach their nominal coverage radius; players report raising the budget to roughly **120%** to restore full (100%) efficiency and vehicle count.
- Maintenance vehicles physically occupy the road while working and can themselves create minor local traffic obstructions.
- **Winter/snow**: on climates with a cold season, snow visibly accumulates on roads. The same Road Maintenance Depot deploys **snowplow** vehicles during winter, in addition to its normal repair crews, to clear accumulated snow. Excess uncleared snow reduces vehicle speed on that road, similarly to poor pavement condition — i.e., snow cover is modeled as another contributor to the same "effective road quality" that slows traffic and raises accident odds.

### 8. Parking

Parking is a first-class citizen-routing input, not just decoration. Two structural sources of parking supply:

1. **Roadside (on-street) parking** — built into specific road cross-sections as a dedicated parking lane (see width data below); notably present on Alley and Gravel road variants, and on dedicated "Parking Road" small/medium variants. Can be removed via the Replace tool (converted to grass, trees, or wider sidewalk) or a per-district **Roadside Parking fee policy** can be applied to discourage/charge for its use.
2. **Off-street parking lots and garages** — separate purchasable buildings: surface lots (small/medium/large/very-large), underground garages, and multi-story parking structures. Each individual lot/garage's parking **fee is set per-building**, independent of the district-level roadside-parking policy.

**Citizen parking choice** is one of the core inputs to CS2's pathfinding cost function (alongside travel time, money, and comfort/behavior — see §Interconnections). The general preference order is: (1) park directly at the destination building's own lot if it has one; failing that, (2) the next most attractive nearby parking (another lot, a garage, or a roadside space); failing *that*, citizens may switch to a different travel mode entirely, or even redirect to a different destination (e.g., a different shop) if parking near the original one is too scarce or unattractive. Preference weighting differs by age group:
- **Seniors** weight **comfort/proximity** most heavily and will pick nearby parking largely regardless of fee.
- **Adults** weight **time** most heavily, picking parking that's on their fastest route.
- **Teens** weight **money** most heavily, choosing the cheapest available parking even at the cost of a longer walk or a switch to another mode.

**High-density (high-rise) zoned buildings do not generate their own built-in parking supply** the way low-density buildings do, so a dense downtown must be served almost entirely by city-supplied lots/garages/roadside parking — players report needing parking supply in the thousands of spaces for a single dense district.

### 9. Power and water/sewage pipes bundled in roads

- Nearly every road category — **small, medium, and large roads** — is built with **low-voltage electrical cable and both water-supply and sewage pipe already buried beneath it**. Any building placed fronting such a road auto-connects to power, water, and sewage without the player laying separate utility lines.
- **Highways are the explicit exception**: they carry **no** power, water, or sewage by default ("highways carry nothing but vehicles"). Adding the optional **streetlight** upgrade to a highway segment grants that segment low-voltage **power** distribution only — still no water or sewage.
- Electricity has two tiers: **Low Voltage** (the kind bundled automatically in city roads) and **High Voltage** (dedicated pylon/transmission lines, not bundled in roads, used for bulk transmission and stepped down to low voltage via transformers). Power lines can be routed above-ground (pylons) or underground (buried cable) at the player's choice for most connections.
- **Water and sewage pipes have no throughput "capacity" figure to manage** — unlike power's MW rating — the real constraint is upstream treatment-plant/pumping-station capacity, not the pipe itself. Buried pipes (whether road-bundled or separately laid) also don't block buildable area — roads and buildings can be placed directly over them.
- Where a road doesn't reach a building (e.g., an isolated service structure), standalone pipe networks can still be drawn using road-like tools, as a single water pipe, a single sewage pipe, or a combined water+sewage dual pipe.

### 10. Outside connections

- Every generated map guarantees **at least one outside road connection** at the map's outer edge; most maps also pre-place potential rail and navigable-water connection points, and **every** map has at least one air-traffic connection.
- Connections exist only at the **literal edge of the full map**, not merely at the edge of a tile the player currently owns — expanding usable connections requires purchasing the border tile(s) that touch that edge point.
- Additional Outside Road / Train / Ship connections can then be built by the player by drawing their own road/rail/waterway from the city out to one of a small, fixed set of pre-existing edge "connection nodes" ringing the map.
- Relative freight characteristics of each outside-connection mode (useful context for why a city router traffic a particular way): **cargo ships** carry roughly **1000 tons** per vessel and are slow but immune to road congestion; **cargo trains** carry large tonnage on their own dedicated right-of-way; **cargo aircraft** carry comparatively little per trip but are the fastest option and are affected by neither road congestion nor waterway availability.
- Community practical guidance: spread multiple outside road connections across **different map edges** rather than funneling all traffic through one border crossing, and add a second, parallel link once a given connection's approach nears roughly **70%** congestion on the traffic overlay **[Community, rule of thumb, not a hard game threshold]**.

### 11. Road / net data model (modder's view)

This section reflects how third-party modders describe CS2's internal representation, reconstructed via community documentation (the CS2 wiki's *Systems and Components catalog*, *Common ECS Components*, and *Assets: Common Asset Principles* pages, plus independent repos like `Cities2Modding`) rather than an official single reference — treat specifics here as a reasonable approximation rather than verified engine internals.

- The road network (shared with rail, canals, fences, and powerlines — all "net" types) is stored as a **graph of Nodes and Segments (Edges)**:
  - A **Node** is a point in the network: an endpoint or a junction where multiple segments meet.
  - A **Segment/Edge** connects exactly two nodes and represents one drawn stretch of network. Where two segments share a node, that node is the intersection between them.
- Each segment's centerline is a **cubic Bezier curve** with **4 control points**: the two end control points coincide with the segment's start/end Node positions, and two additional interior control points shape the curve between them; the interior points cannot sit exactly on top of either endpoint (degenerate case). Community references sometimes describe this as a `Bezier4x3`-style curve (4 control points in 3D space) by analogy to the underlying math library type, though the literal internal type name would require decompiling the game's assemblies (e.g., with ILSpy/dnSpy) to confirm — not something I could verify through search alone.
- A segment carries **one or more parallel Lanes** running along that same curve: car-traffic lanes, parking lanes, bus lanes, tram-track lanes, bike lanes, and pedestrian/sidewalk lanes are each represented as distinct lane objects laid out side-by-side across the segment's cross-section, each with its own width and permitted-user rules.
- At a shared Node, the game auto-generates the connector geometry between every incoming and outgoing lane (equivalent to what CS1 modders called "lane connections"); this generated geometry is what the Lane Arrows tool and the stop-sign/yield/light/roundabout controls all ultimately attach to and restrict.
- The game is built on Unity's **DOTS/ECS** (Entity Component System) architecture: network data lives as components attached to entities (e.g., a curve/edge component, a "Composition" component describing which named sub-lanes make up a given cross-section, per-lane components, etc.).
- Road **assets ("prefabs")** are authored via an in-game **Asset Editor** exposing a "Net Prefab" per network type. A road's cross-section is assembled from a **Composition** — an ordered, left-to-right list of named lane pieces (traffic lane, parking lane, sidewalk, grass verge, tree row, median, etc.). This composition-of-lanes model is also what the popular community "Road Builder" mod exposes to players in a simplified drag-and-reorder UI (place a starting segment from an existing network, then add/remove/reorder lane pieces to generate a wholly new custom road asset) — confirming, from the outside, that lanes-as-ordered-pieces is the right mental model even without access to the literal source.
- Custom **intersection assets** are authored the same way: duplicate an existing intersection prefab in the Asset Editor and modify its geometry/compositions, then publish it through the game's mod/content-sharing system.

---

## Concrete parameters

### Road tool modes (summary)

| Mode | Clicks | Behavior | Confidence |
|---|---|---|---|
| Straight | 2 | Start → end, straight line | Community/Wiki |
| Simple Curve | 3 | Start → bend → end, single arc | Community/Wiki |
| Complex Curve | 4 | Start → bend 1 → bend 2 → end, S-curve | Community/Wiki |
| Continuous | 3+ (chains) | Start → bend → end, then keeps chaining new bends/ends | Community |
| Grid | 3 | Corner → width → length, generates a block grid | Community/Wiki |
| Parallel | — | Draws 2 roads at once, fixed/customizable offset distance | Community/Wiki |

### Elevation

| Parameter | Value | Confidence |
|---|---|---|
| Elevation adjustment step | ~1.25 m to 10 m per step | Community |
| Approx. depth where road becomes full tunnel | ~12.5 m | Community |
| Approx. height bridge pillars (vs. solid barrier supports) appear | ~8.75 m | Community |
| Quay terracing — height difference wanted for clean terrace | ~10 m | Community |
| Pier width variants | Narrow / Medium / Wide (3 sizes, combinable) | Community/Wiki |

### Road/lane geometry

| Road type | Total width | Paved (asphalt) width | Lane width | Notes | Confidence |
|---|---|---|---|---|---|
| Basic 2-lane road | 2 cells = 16 m | 10 m | Vehicle lane 3 m; parking lane 2 m | 1 zoning cell = 8 m | Community |
| 4-lane road (example) | 4 cells = 32 m | 22.4 m incl. median (8 m per side + 6.4 m median) | not stated | Median 6.4 m | Community |
| Highway | 22 m | 18 m | 4 m | Wider lanes than city roads | Community |

### Speed limits — **[Conflict]**: two independently-surfaced breakdowns disagree; both given below rather than forcing a false reconciliation.

**Breakdown A — reported as default/displayed speeds by road tier:**

| Tier | Displayed speed |
|---|---|
| Small roads | ~40 (30 for gravel & small-concrete variants) |
| Medium roads | ~50 |
| Large roads | mix of 50 and 60 |
| Highway | 100 or 120 |
| Highway ramps / one-way single-lane junctions | ~80 |

**Breakdown B — reported as internal (km/h) value paired with theme-localized sign display:**

| Internal value | EU-theme display | NA-theme display | Attributed tier (per search synthesis) |
|---|---|---|---|
| 40.0 | — | — | unspecified (likely alley/local) |
| 60.0 | 30 | 25 | "medium road" |
| 80.0 | 40 | 30 | "large road" |
| 200.0 | 100 | 65 | highway |
| 240.0 | 120 | 70 | highway |

Note the NA-theme numbers look like localized "common US sign value" approximations of the EU (km/h) number rather than exact unit conversion (e.g., 120 km/h ≈ 74.5 mph but displays as the more common sign value "70"). Implementers should treat the exact per-tier mapping as unresolved and pick internally-consistent placeholder values; the highway figures (100/120 km/h, i.e., roughly 60/70 mph-equivalent) and the general ordering small < medium < large < highway are the most consistently corroborated points.

### Construction & upkeep costs

| Item | Value | Confidence |
|---|---|---|
| Two-lane road, base construction cost | ~₡2 per meter | Wiki (via search synthesis) |
| Two-lane road, upkeep at surface level | ~₡16 / month per 100 m | Wiki (via search synthesis) |
| Two-lane road, upkeep at ~10 m underground | ~₡28 / month per 100 m (~1.75× surface) | Wiki (via search synthesis) |
| Two-lane road, upkeep at ~12.5 m+ (full tunnel) | ~₡90 / month per 100 m (~5.6× surface) | Wiki (via search synthesis) |
| CS1 (legacy, for comparison only) tunnel construction multiplier | 6.39× surface | **[CS1]** |
| CS1 (legacy) elevated construction multiplier | 2.65× surface | **[CS1]** |
| CS1 (legacy) tunnel/elevated upkeep multiplier | 6.39× / 2.5× surface | **[CS1]** |
| Road upgrade/replace cost | Free if new config ≤ old cost; otherwise pay the price *difference* | Community |
| Economy 2.0 (patch 1.1.5f1, June 24 2024) | Raised road construction **and** upkeep costs; reduced bulldoze refund; added per-tile upkeep fee; removed hidden budget subsidies | Wiki/Community (patch notes) |

### Power capacity

| Item | Value | Confidence |
|---|---|---|
| Low-voltage line capacity (bundled in small/medium/large roads) | 40 MW | Community/Wiki |
| High-voltage line capacity (major pylon lines) | 400 MW | Community |
| Transformer (HV→LV) capacity | 80 MW | Community |
| Highway default utility carry | None (vehicles only); streetlight upgrade adds LV power only | Community/Wiki |

### Parking

| Item | Footprint | Capacity | Monthly upkeep | Confidence |
|---|---|---|---|---|
| Small parking lot | 5×5 (25 zoning squares) | ~41 spaces (~1.64/square) | ~₡2,200 (~₡54/space) | Community (Beef Suplex wiki) |
| Medium parking lot | 5×7 (35 squares) | ~60 spaces (~1.74/square) | ~₡3,000 (~₡50/space) | Community |
| Large parking lot | 8×10 (80 squares) | ~135 spaces (~1.68/square) | ~₡7,000 (~₡52/space) | Community |
| Very large parking lot | 10×18 (180 squares) | ~321 spaces (~1.78/square) | ~₡16,000 (~₡50/space) | Community |
| Underground parking garage | — | ~200 vehicles | — | Community |
| **[Conflict]** Small parking lot (alt. source) | — | — | Build ~₡6.7K; upkeep ~₡500/mo | Community (Steam thread; disagrees with row above) |
| **[Conflict]** Medium parking lot (alt. source) | — | — | Build ~₡14.4K | Community (Steam thread) |
| Roadside/lot parking fee | Player-set, commonly ₡10–50 in examples cited by players | — | Community (not a fixed default) |

### Progression gates (approximate)

| Feature | Gate | Confidence |
|---|---|---|
| First road type (2-lane) | Available immediately at city start | Wiki/Community |
| All other road types | Unlock progressively: first by placing the initial road, the rest via later milestones | Wiki/Community |
| Advanced Road Services (stop signs, traffic-light toggle, sound barriers, crosswalks, maintenance depot) | ~1 development point | Community |
| Roundabout (manual-build unlock / dev tree entry) | ~1 development point (separate node from Advanced Road Services) | Community |
| Large roads | Development-tree node (specific point cost not confirmed) | Community |
| Heavy Traffic Ban (district policy banning trucks) | Milestone 6 | Community |
| Milestones (total) | 20 milestones; each grants Money + Development Points + Expansion Permits, raises loan limit, unlocks features | Wiki/Community |

### Intersection defaults

| Junction type | Default control | Confidence |
|---|---|---|
| Small road × small road | Stop signs | Community/Wiki |
| Medium or large road involved | Traffic lights | Community/Wiki |
| Pedestrian path connects to any junction | Traffic light auto-added | Community |
| Manually stripped traffic light | Yield sign auto-assigned, prioritizing higher-class road | Community |

### Roundabout / cul-de-sac catalog (Detailer's Patch #2, ~patch 1.2)

| Item | Count | Confidence |
|---|---|---|
| New roundabout decorative variants | 7 | Wiki/Community (patch notes) |
| Sizes per roundabout variant | 4 (small → very large) | Wiki/Community |
| Total new roundabout prefabs | 28 (7×4) | Derived |
| New cul-de-sac variants | 3 (asphalt / grass / tree) | Wiki/Community |
| New roads added in same patch | 8 | Wiki/Community |

### Outside connections

| Item | Value | Confidence |
|---|---|---|
| Minimum outside road connections per map | 1 | Community |
| Air connection availability | Every map has at least 1 | Community |
| Cargo ship capacity | ~1000 tons/vessel | Community |
| Suggested congestion threshold to add a parallel link | ~70% | Community rule of thumb |

---

## Interconnections with other systems

- **Zoning**: the road a lot fronts determines that lot's eligible zone depth/type; some high-capacity roads (highways in particular) **disallow adjacent zoning entirely**. Zoning cells snap to the same 8 m grid the road tool uses. Traffic volume and road size around a zone also feed into **land value** and **noise pollution** calculations for nearby buildings (larger/busier roads generate more noise and can suppress adjacent land value).
- **Citizens / pathfinding**: every trip a citizen (a "cim") takes is costed using a small set of weighted factors — **time, money, comfort, and behavior** — with **parking availability** as one of the concrete inputs into that cost. Age cohort changes the weighting (seniors: comfort/proximity; adults: time; teens: money), which in turn is downstream of what road/parking infrastructure the city has built. Poor road condition and heavy snow cover both raise a segment's effective "cost" by slowing vehicles and raising accident risk.
- **Economy**: road construction and upkeep are called out as one of the two largest ongoing money sinks in the game (alongside city-service buildings). The Economy 2.0 patch specifically rebalanced these costs upward and removed masking subsidies, meaning a city's road-network footprint directly and significantly affects its financial health going forward, and the newer **per-tile upkeep fee** means sprawling a road network across many owned tiles carries its own recurring cost independent of the roads themselves.
- **Public transport**: bus lines and tram lines run *on* the road network (bus lanes/stops attach to road segments; tram tracks are frequently embedded directly in a road's cross-section, though they can also run fully separately). Removing/adding these via the Replace tool is how a player converts an existing street into (or out of) a transit corridor.
- **Power & water/sewage**: as detailed in §9, most roads *are* the utility network for the buildings along them — power and water/sewage planning in CS2 is inseparable from road planning for anything other than highways or isolated buildings.
- **Progression / development points**: higher road tiers, Advanced Road Services (manual intersection control, sound barriers, crosswalks, the Road Maintenance Depot), and the manual-roundabout unlock are all gated behind the milestone/development-point system, so a faithful implementation needs a progression gate on road-tool capabilities, not just a flat unlock-everything-at-once model.
- **Districts & policies**: the **Roadside Parking fee** and **Heavy Traffic Ban** (truck ban, unaffected on highways, gated behind milestone 6) are both district-level policies that modify how the road network inside that district behaves, without changing the roads themselves.
- **Services / emergency response**: road condition (wear + snow) affects accident likelihood, and the Road Maintenance Depot's own vehicles use the same road network they're servicing (and can themselves cause minor jams) — a feedback loop worth modeling explicitly. Emergency vehicles, garbage trucks, etc. all route over the same lane/pathfinding graph as ordinary traffic.
- **Outside connections / regional economy**: cargo and commuters both enter/exit the simulated city exclusively through outside road/rail/ship/air connections at the map edge, making the road tool's reach to the map border a hard gameplay constraint on trade and commuting, not just an aesthetic one.
- **Modding / asset system**: because roads, intersections, and even parking lots are all just "prefabs" assembled from composable pieces (lane compositions for roads, duplicate-and-edit for intersections), the same underlying data model in §11 is what both the shipped road catalog *and* every player-made custom road/intersection asset are built from — an implementer aiming for "faithful systems" should treat the road catalog as data (a list of lane-composition prefabs) rather than hard-coded special cases.

---

## Sources

- [Roads - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Roads)
- [Traffic - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Traffic)
- [Zoning - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Zoning)
- [Progression - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Progression)
- [Economy - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Economy)
- [Services - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Services)
- [Speed limits - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/index.php?title=Speed_limits&redirect=no)
- [Info views - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Info_views)
- [Creating and sharing intersection assets - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Creating_and_sharing_intersection_assets)
- [PrefabSystem - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/PrefabSystem)
- [Systems and Components catalog - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Systems_and_Components_catalog)
- [Assets: Common Asset Principles - Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Assets:_Common_Asset_Principles)
- [Cities: Skylines II Feature Highlight #1: Road Tools - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools)
- [Cities: Skylines II Feature Highlight #2: Traffic AI - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai)
- [Cities: Skylines II Feature Highlight #3: Public & Cargo Transportation - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation)
- [Cities: Skylines II Feature Highlight #6: Electricity & Water - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/electricity-water)
- [Cities: Skylines II Feature Highlight #10: Game Progression - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/game-progression)
- [Quays & Piers Patch 1.3.3f1 - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/quays-and-piers-patch)
- [Detailer's Patch #2 - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/detailers-patch-2)
- [Dev Diary: Economy 2.0 Part 1 - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-one)
- [Dev Diary: Economy 2.0 Part 2 - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-two)
- [Dev Diary: Tile Upkeep Explained - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/tile-upkeep-explained)
- [Adding Custom Assets - Cities: Skylines II - Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/adding-custom-assets)
- [Development Diary #1: Road Tools - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/developer-diary/development-diary-1-road-tools.1590300/)
- [Development Diary #2: Traffic AI - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/developer-diary/development-diary-2-traffic-ai.1591141/)
- [Road hierarchy VS Road speed limit - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/road-hierarchy-vs-road-speed-limit.1617110/)
- [What are the Alley road types for? - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/what-are-the-alley-road-types-for.1682770/)
- [Heavy Traffic Ban - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/heavy-traffic-ban.1043845/)
- [Rethinking street maintenance, and private roads - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/rethinking-street-maintenance-and-private-roads.1606581/)
- [Road maintenance vehicles stop on good-condition roads - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/road-maintenance-vehicles-stop-on-good-condition-roads-blocking-traffic.1611839/)
- [Patch Notes 1.1.5f1 - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/patch-notes-1-1-5f1.1687527/)
- [Detailer's Patch #2 - 1.2.0f1 Patch Notes - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/detailers-patch-2-1-2-0f1-patch-notes.1720277/)
- [Bus lanes and bus streets - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/bus-lanes-and-bus-streets.1599586/)
- [180 and 90 Degree Hard Snapping - Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/180-and-90-degree-hard-snapping.1608414/)
- [Road Tools in Cities Skylines 2, explained - Pro Game Guides](https://progameguides.com/cities-skylines-2/road-tools-in-cities-skylines-2-explained/)
- [Cities Skylines 2 road guide - PCGamesN](https://www.pcgamesn.com/cities-skylines-2/road)
- [How to manage Cities Skylines 2 traffic - PCGamesN](https://www.pcgamesn.com/cities-skylines-2/traffic)
- [Cities Skylines 2 roads might have the one fix we always needed in CS1 - PCGamesN](https://www.pcgamesn.com/cities-skylines-2/turning-lanes)
- [Cities: Skylines 2's newest road tool has me way too excited - PC Gamer](https://www.pcgamer.com/cities-skylines-2s-newest-road-tool-has-me-way-too-excited/)
- [Cities: Skylines 2 - How to Upgrade Roads - GameRant](https://gamerant.com/cities-skylines-2-how-upgrade-roads/)
- [Cities: Skylines 2 - How to Build Roundabouts - GameRant](https://gamerant.com/cities-skylines-2-how-build-roundabouts/)
- [Cities: Skylines 2 - How to Set Policies - GameRant](https://gamerant.com/cities-skylines-2-how-to-set-policies/)
- [How To Fix Road Conditions In Cities: Skylines 2 - GameRant](https://gamerant.com/cities-skylines-2-how-fix-road-conditions-guide/)
- [Cities: Skylines 2 – How to Build Tunnels - TheGamer](https://www.thegamer.com/cities-skylines-2-tunnels-build-guide/)
- [How To Build Bridges In Cities: Skylines 2 - TheGamer](https://www.thegamer.com/cities-skylines-2-bridges-how-to-build-guide/)
- [Cities: Skylines 2 - How To Deal With Noise Pollution - TheGamer](https://www.thegamer.com/cities-skylines-2-lower-reduce-noise-pollution-guide/)
- [Cities: Skylines 2 road types and pipes explained - Destructoid](https://www.destructoid.com/cities-skylines-2-road-types-and-pipes-explained/)
- [Cities Skylines 2 development nodes progression guide - GamesRadar+](https://www.gamesradar.com/cities-skylines-2-development-nodes/)
- [Cities: Skylines 2 will let you remove speed limits - GamesRadar+](https://www.gamesradar.com/cities-skylines-2-will-let-you-remove-speed-limits-and-turn-highways-into-crash-filled-hellscapes/)
- [Building Better Cities: Mastering Road Hierarchy in Cities Skylines II - Chill Place Gaming](https://chillplacegaming.com/road-hierarchies-cities-skylines-ii/)
- [Advanced Traffic Management: Tips, Tricks, and Fixes - Chill Place Gaming](https://chillplacegaming.com/advanced-traffic-management-cities-skylines-ii/)
- [Cities: Skylines 2/Road Construction Guide - Beef Suplex Gaming Wiki](https://wiki.beefsuplex.com/wiki/Cities:_Skylines_2/Road_Construction_Guide)
- [Cities: Skylines 2/Parking Lots - Beef Suplex Gaming Wiki](https://wiki.beefsuplex.com/wiki/Cities:_Skylines_2/Parking_Lots)
- [Cities: Skylines 2 — Master City Planning Guide v3](https://cs2-master-guide.tiiny.site/)
- [Cities Skylines 2: Road Guide / Tutorial - Modscities2.com](https://www.modscities2.com/cities-skylines-2-road-guide/)
- [Cities Skylines 2: How To Use New Road Tools - Modscities2.com](https://www.modscities2.com/cities-skylines-2-how-to-use-new-road-tools/)
- [Cities Skylines 2- All Road Tools Explained And Uses - ProdigyGamers](https://prodigygamers.com/2023/10/31/cities-skylines-2-all-road-tools-explained-and-uses/)
- [Cities Skylines 2- How To Add And Remove Crosswalks - ProdigyGamers](https://prodigygamers.com/2023/11/03/cities-skylines-2-how-to-add-and-remove-crosswalks/)
- [New Cities Skylines 2 patch finally makes traffic as good as the first game - PCGamesN](https://www.pcgamesn.com/cities-skylines-2/detailers-patch-traffic-routes)
- [Cities: Skylines 2 Detailers Patch #2 Adds Traffic Routes, 8 New Roads - Simulation Daily](https://simulationdaily.com/news/cities-skylines-2-detailers-patch-2/)
- [Development Diary: Detailer's Patch #2 - Colossal Order](https://colossalorder.fi/?p=2360)
- [Economy 2.0 Development Diary #1 - Colossal Order](https://colossalorder.fi/?p=2276)
- [Roads & Vehicles Dev Diary - Colossal Order](https://colossalorder.fi/?p=1102)
- [Development Diary #2: Traffic AI - Colossal Order](https://colossalorder.fi/?p=1597)
- [Cities: Skylines 2's latest patch introduced quays and piers - Yahoo Tech](https://tech.yahoo.com/gaming/articles/cities-skylines-2s-latest-patch-113636476.html)
- [This is how Cities: Skylines 2 vastly improves on the original game's traffic AI - Neowin](https://www.neowin.net/news/this-is-how-cities-skylines-2-vastly-improves-on-the-original-games-traffic-ai/)
- [Cities: Skylines 2's simulation is so realistic that all the young people are broke - PC Gamer](https://www.pcgamer.com/cities-skyline-2s-simulation-is-so-realistic-that-all-the-young-people-are-broke/)
- [GitHub - optimus-code/Cities2Modding](https://github.com/optimus-code/Cities2Modding)
- [GitHub - ps1ke/Cities-Skylines-2-Modding-Guide](https://github.com/ps1ke/Cities-Skylines-2-Modding-Guide)
- [Cities: Skylines 2 - Modding documentation (ps1ke.github.io)](https://ps1ke.github.io/Cities-Skylines-2-Modding-Guide/)
- [GitHub - slyh/Cities2-TrafficLightsEnhancement](https://github.com/slyh/Cities2-TrafficLightsEnhancement)
- [GitHub - krzychu124/Traffic (TM:PE successor)](https://github.com/krzychu124/Traffic)
- [GitHub - JadHajjar/RoadBuilder-CSII](https://github.com/JadHajjar/RoadBuilder-CSII)
- [Nodes, Segments, Lanes - TMPE wiki (CS1, cited for concept parity)](https://github.com/CitiesSkylinesMods/TMPE/wiki/Nodes,-Segments,-Lanes)
- [Network Asset Creation - Cities Skylines Modding (cslmodding.info)](https://cslmodding.info/asset/network/)
- [Scale - Cities Skylines Modding (cslmodding.info)](https://cslmodding.info/scale/)
- [Steam Community Guide: Practical Engineering: The Optimal Square Grid](https://steamcommunity.com/sharedfiles/filedetails/?id=2035626231)
- [Steam Community Guide: Cities Skylines II Master Plan](https://steamcommunity.com/sharedfiles/filedetails/?id=3661776714)
- [Numerous Cities: Skylines II General Discussions threads (Steam Community, app 949230)](https://steamcommunity.com/app/949230/discussions/) — used for community-reported figures on parking fees/costs, snapping behavior, U-turn AI behavior, highway lane limits, bus-lane behavior, and outside-connection practice; individual thread URLs captured during research include IDs under `steamcommunity.com/app/949230/discussions/0/`.
- [Cities: Skylines II - Wikipedia](https://en.wikipedia.org/wiki/Cities:_Skylines_II)
