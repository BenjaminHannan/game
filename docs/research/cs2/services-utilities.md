# Cities: Skylines II — Services & Utilities: Electricity, Water, Sewage

Research notes on the utility networks of *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023), compiled to inform an original reimplementation in *Metropolis*. Scope: how utility networks attach to roads, the two-voltage electrical grid, water sourcing and sewage disposal, production/consumption balancing, outside connections and trade, coverage/info-view feedback, and what buildings do when supply fails.

**Methodology / confidence convention.** Direct page fetching is blocked in this environment for most domains (the official wiki `cs2.paradoxwikis.com` returns an egress-proxy block), so everything below comes from targeted web searches whose results are synthesized summaries of one or more sources: the official wiki, Colossal Order's pre-release "Feature Highlight" dev diaries hosted by Paradox, patch-note coverage, and player/guide discussion. Tags:

- **[Wiki]** — attributed by search results to the official Paradox CS2 wiki. Likely accurate, not independently verified.
- **[Dev]** — stated by Colossal Order in a Feature Highlight / dev diary or patch notes, as reported by coverage.
- **[Community]** — player forums, Steam discussions, third-party guides. May reflect one patch or one person's testing.
- **[Conflict]** — sources disagree; both readings given.
- **[Inferred]** — my own reconstruction of how the pieces must fit; explicitly not sourced.

Numbers should be read as "circa 1.1.5f1–1.4.x" unless noted; the utility economy was rebalanced by **Economy 2.0** (patch 1.1.5f1, June 2024), which among other things raised the electricity import price and retuned water service fees **[Coverage]**.

---

## How CS2 does it

### 1. Networks ride on roads

The single most important structural decision: **most road types carry buried low-voltage electrical cable and combined water/sewage pipe**, and any building fronting such a road is automatically hooked into all three networks the moment it is built **[Dev/Wiki]**. There is no separate "run a power line to every house" chore, unlike CS1's early game where a stray wire to an unpowered block was routine.

Exceptions and details:

- **Highways carry nothing but vehicles** — no cable, no pipe **[Wiki/Community]**. A building or service plopped only against a highway is unserviced. (The roads doc notes a streetlight upgrade on highways grants power but never water/sewage **[Community]**.)
- **Standalone pipes exist** for buildings off the road grid. Pipes are drawn underground as linear runs; the tool offers a water-only, a sewage-only, and a **combined water+sewage dual pipe**, so in practice players never need to plan two separate networks **[Wiki/Community]**. Pipes are reported at roughly **₡20 per cell to place with ₡0.08/week upkeep** **[Community]** — cheap enough to be a non-decision.
- Pipes are on their own underground layer and **do not collide with road tunnels, metro, or rail tunnels** **[Wiki]**.
- Networks must be **contiguous** — a pipe or cable run that does not physically reach a source does nothing. Gaps at map-tile boundaries or across a demolished segment are the usual player failure **[Community]**.
- **Power lines** are a separate, above-ground network type (pylons) for high voltage; they are the only way to move large blocks of power between distant parts of the map or to an outside connection.

### 2. Two voltages, and why they exist

CS2 splits electricity into **low voltage** (what buildings actually consume, carried by roads and small electric cables) and **high voltage** (what large plants generate, carried by pylon power lines) **[Dev]**.

- Every **power plant has two connection nodes**: a low-voltage node that feeds the adjacent road/cable network directly, and a high-voltage node for pylon lines to other plants, transformer stations, and outside connections **[Community]**.
- A **Transformer Station** is the bridge: it steps high voltage down to low voltage for city distribution, and steps low voltage up to high voltage when the city is exporting **[Dev/Community]**.
- The point of the split is **capacity**. Reported limits **[Community]**:
  - a **road / small power line carries ~40 MW** (and because a transformer feeds outward in both directions along a road, plopping one is often described as "40 MW each way");
  - a **large high-voltage line carries ~400 MW**;
  - a **Transformer Station handles ~80 MW**.
  - **[Conflict]** One guide states electric cables carry "80 W" of low voltage; that is almost certainly a units typo for 80 MW or a garbled restatement of the transformer figure. Treat only the 40/400/80 MW triple as usable, and treat all three as approximate.
- Consequence: **electricity is a flow problem on a graph, not a coverage radius**. If a large outer district hangs off the rest of the city by a single road, all its demand must squeeze through that one edge's 40 MW; exceed it and the game reports a **bottleneck** — power exists in the city but cannot reach the far side **[Wiki/Community]**. The documented fix is to place a transformer station beyond the bottleneck and feed it directly from the plant with a high-voltage line, i.e. add a parallel high-capacity edge **[Community]**.
- **[Inferred]** This is a max-flow / capacitated network solve over the road-and-cable graph, run per simulation tick, not a per-building radius check. The bottleneck warning is the solver reporting a saturated edge.

### 3. Generation

Plants vary in output, cost per MW, footprint, pollution, and (for renewables) time-dependence. Reported figures, all **[Community]** and patch-sensitive:

| Source | Output | Notes |
|---|---|---|
| Wind turbine | up to ~5 MW each | output depends on wind at the site; placement on ridges/coast matters |
| Coal plant (small) | ~20 MW | worst cost/MW (~₡3,500/MW) and heavy ground + air pollution |
| Gas plant | ~250 MW | mid cost/MW (~₡2,500) |
| Solar plant | varies with time of day and **map latitude** | ~₡1,500/MW; one source reports night output falling to a fraction of daytime rather than zero **[Conflict]** |
| Geothermal | — | ~₡2,000/MW; requires a geothermal resource on the map |
| Nuclear | **640 MW** or **750 MW** **[Conflict]** | best cost/MW (~₡1,333) but very high flat upkeep (a figure of ~₡1,000,000/month is cited) and heavy **water** consumption |

- **Renewables are variable in time**, which is the whole reason the **Emergency Battery Station** exists: it charges when production exceeds consumption and discharges when consumption spikes, explicitly pitched as the companion to solar for overnight coverage **[Dev/Wiki]**.
- **Demand is not flat.** Consumption rises with city size but also with **temperature in both directions** — air conditioning in heat, heating in cold — so seasonal weather drives a real load curve **[Dev]**.
- Plants themselves consume: notably nuclear draws substantial **water**, which couples the two networks **[Community]**.

### 4. Water sourcing

Two supply archetypes, plus recycling **[Dev/Wiki]**:

- **Water Pumping Station** — placed on a shoreline, draws from *surface* water (river, lake, ocean). Its intake is subject to the map's simulated water flow, so it can be poisoned by upstream sewage and can throw a "water level too low" state if the water body drops (a persistent-false-positive version of this notification was patched in the 1.4.x line **[Coverage]**).
- **Groundwater Pumping Station** — new to CS2. Draws from **groundwater deposits**, which are finite-rate: each deposit has a **replenishment rate**, and over-pumping *temporarily depletes* it until the deposit dries up. Reduce or stop pumping and it refills **[Dev/Wiki]**. Groundwater can also be **contaminated by ground pollution above the deposit** **[Wiki]**.
- **Water Tower** — small, road-placeable supply for early or remote areas.
- Reported capacities/costs **[Community]**: Water Tower ~30,000 output for ₡60,000 build; Groundwater Pumping Station ~75,000 output for ₡40,000 build, ~₡20,000/month upkeep. **[Conflict]** One source lists the Water Tower's monthly upkeep as ₡30,000, which would make it strictly worse than the larger groundwater station on every axis — probably a transcription error.
- Units are the game's abstract water units per month; the numeric scale only matters relative to consumption.

### 5. Sewage disposal

Every unit of water consumed comes back as sewage that must go somewhere, and **sewage capacity failing is as fatal as water capacity failing** **[Wiki]**.

- **Sewage Outlet** — dumps untreated wastewater into a surface water body. Cheap: reported ~₡25,000 build, ~₡20,000/month, ~100,000 capacity. Optional **Chemical Purification** upgrade (~₡12,000 build, ~₡4,000/month) cuts pollutant output **[Community]**.
- **Wastewater Treatment Plant** — reported ~400,000 capacity for ~₡400,000 build and ~₡120,000/month, i.e. roughly **16× the price for 4× the throughput** versus the outlet **[Community]**. Its **Advanced Filtering System** upgrade (~₡50,000 / ~₡20,000 per month) raises purification and, notably, **converts more of the processed sewage back into fresh water** — a recycling loop that reduces raw intake demand **[Wiki/Community]**.
- The map's **water flow simulation is the coupling mechanism**: pollution released at an outlet travels downstream, so an intake placed downstream of your own outlet contaminates the city's drinking water. Correct placement (intake upstream, outlet downstream) is a real, teachable spatial puzzle rather than a cosmetic one **[Dev]**.

### 6. Outside connections and trade

- **Electricity trades automatically.** Connect a high-voltage line from a Transformer Station to the map-edge outside connection; if the city is short, it **buys** power automatically, and if it is long, it **sells** **[Wiki/Community]**. Reported export rate ~₡2,500 per MW **[Community]**; the import price is deliberately set **above the running cost of any in-city plant**, and Economy 2.0 raised it further **[Coverage]**. So importing is a survivable emergency, never a strategy.
- **Water/sewage trade also exists but is map-dependent.** It requires a dedicated **pipe** dragged to the map edge — a road connection does not carry it — and, importantly, **none of the shipped starting maps include an outside water/sewage connection**, though map creators can author one **[Community]**. In practice water must be solved locally.
- **[Inferred]** The design intent of the asymmetry: power is a fungible commodity with a working market (a genuine early-game crutch and a late-game income source), while water is a *place* problem the player is meant to solve on the map.

### 7. Fees, budgets, and efficiency

Utilities are not just a cost line; they are a two-sided economic knob **[Wiki]**:

- **Service fees** for Electricity and Water & Sewage are paid by **citizens and companies**, set in the Economy panel alongside Roads, Healthcare, Garbage, Education, and Transport fees.
- Reported elasticity, per 1% of fee away from the 100% baseline **[Wiki]**: **below** 100%, each point adds **+0.2% electricity consumption, +0.2% company efficiency, +0.05 citizen happiness**; **above** 100%, each point cuts **−0.4% consumption, −0.4% company efficiency, −0.1 happiness**. Note the deliberate asymmetry — raising fees bites harder than lowering them helps. Cheap utilities mean people use more of them.
- **Service budget sliders** run **50%–150%** per service, scaling that service's buildings' upkeep *and* their **Efficiency** together **[Wiki]**. Running the water budget at 60% is a real way to survive a cash crunch at the price of throughput.
- Building **level-ups reduce per-unit consumption**: residential buildings consume less electricity and water per household at levels 3 and 5, and commercial buildings use less per unit of goods sold **[Wiki]**. Education also lowers per-citizen water and electricity draw **[Wiki]**.

### 8. Failure states and feedback

- **Shortfall is distributed by network distance**: when supply is short of demand, **the buildings furthest from the source along the network lose service first** **[Wiki]**. This is a much better feel than a global "everything browns out equally" and gives players a spatial reading of the problem.
- Effects of a shortfall:
  - Households lose **Well-being**; citizens tolerate it briefly and then the building is **abandoned** if it persists **[Wiki]**.
  - Companies and service buildings take an **Efficiency penalty** — reduced production, worse service output — rather than shutting off outright **[Wiki]**. Utilities therefore degrade the city gradually before they kill it.
- **Notification icons** appear on affected buildings (no electricity / no water / sewage backed up), and the per-building info panel names the specific cause **[Wiki/Community]**.
- **Info views** are the primary diagnostic. The Electricity info view shows an **Electricity Availability meter** (current consumption vs. production) and an **Electricity Trade meter** (net import/export), plus network colouring that surfaces **bottlenecked edges** **[Wiki]**. Water & Sewage has the analogous availability readouts plus pollution overlays for the water bodies.

---

## What makes it feel like CS2

Distilling the above into the properties that actually produce the experience:

1. **Utilities are free by default, and that is the point.** Because roads carry power and pipes, the player almost never thinks about connection — they think about **capacity and placement**. The tedium of CS1-style wire-stringing is gone; the interesting decisions remain.
2. **Electricity is a flow on a graph.** The bottleneck moment — plenty of power, unlit district, because everything funnels through one road — is a signature CS2 experience and is *only* possible if edges have capacity. A radius model cannot produce it.
3. **Water is a place on the map.** Upstream intake, downstream outlet, finite groundwater that visibly draws down and recovers. Water couples to terrain and pollution; power does not.
4. **Both networks degrade gracefully and spatially.** The far edge of the city browns out first; businesses lose efficiency before homes get abandoned. Failure is a gradient with a readable geography, not a binary.
5. **The market is asymmetric.** Power can be bought at a punitive price and sold at a decent one; water usually cannot be traded at all.
6. **Fees are a demand lever, not just income.** Cheap power means people burn more of it. This closes a loop most builders leave open.
7. **Time-varying supply and demand.** Weather-driven load, solar day/night, batteries as the buffer.

---

## Metropolis v1 adoption

Consistent with UNKNOWNS.md — statistical rather than agent-level simulation, browser performance budget of ~1–2k buildings at 60 fps, CS2-mirroring UI structure with original art.

**Adopt now:**

- **Roads carry power, water, and sewage implicitly.** Any zoned building with valid road frontage is on all three networks. No wiring chore in v1. This is both the CS2 feel and the cheapest possible implementation.
- **Two utility resources only: electricity and water.** Model **sewage as a shadow of water** in v1 — sewage produced = water consumed, checked against a separate disposal capacity. One consumption number, two capacity checks. Skip standalone pipes and the water/sewage/dual-pipe tool entirely for v1.
- **Electricity as a capacitated flow over the road graph.** We already have a road graph with per-edge statistical traffic flow; reuse it. Each road edge gets an electrical capacity (small road 40 units, medium/large higher, highway 0). Run a simple max-flow or, cheaper, an iterative capacity-limited BFS/relaxation from source nodes each sim tick. **This is the one piece of CS2 fidelity worth paying for**, because it produces the bottleneck moment.
  - Ship exactly two source types initially: a small dirty plant (high cost/MW, pollutes) and a mid plant, plus **one Transformer Station + high-voltage line** so the bottleneck has a documented cure. Without the cure, the bottleneck is just a bug report.
- **Water as pure capacity, not flow.** Pipes have unlimited capacity in CS2 anyway; sourcing capacity is the constraint. v1: total production vs. total consumption, with **shortfall allocated by network distance from the nearest source** — this single rule buys us the CS2 "far edge browns out first" feel at near-zero cost. Compute graph distance once per source placement, not per tick.
- **Two water sources:** a shoreline Pumping Station (must touch water) and a Water Tower (placeable anywhere, small). Defer groundwater deposits.
- **Two sewage sinks:** a cheap Outlet (pollutes the adjacent water body) and an expensive Treatment Plant (does not). This is enough to make the upstream/downstream lesson land, given a simple downstream-pollution rule on the water body.
- **Failure states, in this order:** company/service **Efficiency penalty** first (scaled by fraction of demand unmet), then a per-building notification icon, then **abandonment after sustained deprivation** (a timer, e.g. several in-game days). Never an instant kill.
- **Outside connection for electricity**, automatic buy/sell, with **import priced above every plant's per-unit cost** and export priced below it. **No water outside connection** in v1 — matching shipped CS2 maps.
- **Info views**: Electricity and Water & Sewage overlays with an availability meter (production vs. consumption), a trade meter, and network colouring for saturated edges. This is UI structure we're already mirroring.
- **A single fee slider per utility**, with CS2's asymmetric elasticity (raising fees suppresses consumption harder than lowering fees stimulates it) and a happiness effect. Fold the 50–150% service budget slider in later.
- **Consumption scaling**: per-building demand from occupancy × a per-zone-type coefficient, reduced at higher building levels. Keep the coefficients in one data table so they are tunable.

**Explicitly simplify or defer for v1:**

- No standalone pipe network or pipe tool; no underground layer.
- No groundwater deposits or depletion/replenishment.
- No weather- or temperature-driven load curve; a fixed diurnal multiplier at most.
- No batteries, no solar/wind variability (defer with the variability that motivates them).
- No plant water consumption coupling.
- No treatment-plant water recycling loop.
- No service-building efficiency upgrades (Chemical Purification, Advanced Filtering).

## Later path

Rough order of increasing cost, for after v1:

1. **Variable renewables + storage.** Wind (site-dependent), solar (day/night and map latitude), and the Emergency Battery Station charging on surplus and discharging on deficit. This is where the load curve starts to matter and where the electricity system becomes a genuine planning game rather than a capacity check.
2. **Weather-driven demand.** Consumption rising in both heat and cold. Needs a seasonal/temperature model, which likely arrives with a broader climate system rather than for utilities alone.
3. **Real water flow on the terrain.** CS2's simulated flow is what makes intake/outlet placement meaningful and what carries pollution downstream. A cheap directed-flow approximation over terrain heightmap cells gets most of the gameplay for a fraction of a real fluid sim; a full sim is a large project on its own.
4. **Groundwater deposits** with per-deposit levels, replenishment rates, drawdown, recovery, and contamination from ground pollution above. Needs a resource-deposit map layer, which pairs naturally with the natural-resources system for industry.
5. **Standalone pipe networks.** A real underground layer with water-only / sewage-only / dual pipes, plus off-road buildings that need explicit connection. Mostly a tooling and rendering cost, low simulation cost, since CS2's pipes have no capacity.
6. **The full transformer/voltage hierarchy.** Multiple power line tiers with distinct capacities, plants exposing separate low- and high-voltage nodes, transformers with their own throughput cap, and an actual min-cost-flow solve. v1's simplified version already gestures at this; full fidelity is mostly solver work plus UI to make the voltages legible.
7. **Service-building upgrade slots** (purification, filtering, capacity extensions) and the 50–150% per-service budget slider coupling upkeep to efficiency.
8. **Water/sewage outside connections** as an authorable map feature, once a map editor exists.
9. **Plant resource coupling** — nuclear drawing water, fossil plants consuming coal/oil produced by the city's own industry — which turns utilities into a node in the production chain rather than a standalone subsystem.

---

## Sources

- Paradox Interactive — Cities: Skylines II Feature Highlight #6: Electricity & Water — https://www.paradoxinteractive.com/games/cities-skylines-ii/features/electricity-water
- Paradox Interactive — Cities: Skylines II Feature Highlight #5: City Services — https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies
- Cities Skylines 2 Wiki — Services — https://cs2.paradoxwikis.com/Services
- Cities Skylines 2 Wiki — Info views — https://cs2.paradoxwikis.com/Info_views
- Cities Skylines 2 Wiki — Notifications — https://cs2.paradoxwikis.com/Notifications
- Cities Skylines 2 Wiki — Economy — https://cs2.paradoxwikis.com/Economy
- Cities Skylines 2 Wiki — Patch 1.4.X — https://cs2.paradoxwikis.com/Patch_1.4.X
- Game Rant — How to Connect a Power Network — https://gamerant.com/cities-skylines-2-how-to-connect-a-power-network/
- Game Rant — How to Import and Export Power and Water — https://gamerant.com/cities-skylines-2-how-to-import-and-export-power-and-water/
- TheGamer — Guide To Electricity And Power — https://www.thegamer.com/cities-skylines-2-electricity-power-demand/
- TheGamer — How To Handle Water And Sewage — https://www.thegamer.com/cities-skylines-2-guide-to-provide-water/
- GameSkinny — How to Fix Electricity Bottleneck — https://www.gameskinny.com/tips/cities-skylines-2-how-to-fix-electricity-bottleneck/
- GameSkinny — How to Connect Sewer Pipes — https://www.gameskinny.com/tips/cities-skylines-2-how-to-connect-sewer-pipes/
- Gamepressure — How to Deal with Electricity Bottleneck — https://www.gamepressure.com/newsroom/how-to-deal-with-electricity-bottleneck-in-cities-skylines-2/zc62bb
- Destructoid — The best types of power (electricity) — https://www.destructoid.com/the-best-types-of-power-electricity-in-cities-skylines-2/
- Destructoid — Economy 2.0 overhaul has arrived — https://www.destructoid.com/cities-skylines-2s-massive-economy-2-0-overhaul-has-arrived/
- Dexerto — Patch notes 1.1.5f1 — https://www.dexerto.com/gaming/cities-skylines-2-patch-notes-1-1-5f1-economy-changes-bug-fixes-more-2794481/
- VideoGamer — How to sell electricity and profit off power exports — https://www.videogamer.com/guides/cities-skylines-2-sell-electricity-export/
- GamesRadar — Cities Skylines 2 export guide — https://www.gamesradar.com/cities-skylines-2-export-guide/
- GamesRadar — Cities Skylines 2 pollution guide — https://www.gamesradar.com/cities-skylines-2-pollution-guide/
- Magic Game World — Water Production and Sewage Guide — https://www.magicgameworld.com/cities-skylines-2-water-production-and-sewage-guide/
- ModsCities2 — Water Production & Sewage — https://www.modscities2.com/cities-skylines-2-water-production-sewage/
- ModsCities2 — Electricity Info View — https://www.modscities2.com/cities-skylines-2-electricity-info-view/
- ModsCities2 — Service Fees — https://www.modscities2.com/cities-skylines-2-service-fees/
- Robin Hawkes — "Energy nerd? Cities Skylines 2 is the video game for you" — https://robinhawkes.com/blog/energy-nerd-cities-skylines-2-is-the-video-game-for-you/
- PCGamesN — Cities Skylines 2 is making pollution your problem — https://www.pcgamesn.com/cities-skylines-2/electricity-and-water
- Stealth Optional — Water pollution causes and fixes — https://stealthoptional.com/article/cities-skylines-2-water-pollution
- Paradox forums — "Better Sewage: offer output upgrade for Sewage Outlet" — https://forum.paradoxplaza.com/forum/threads/better-sewage-offer-output-upgrade-for-sewage-outlet-and-adjust-wastewater-treatment-plant.1610908/
- Paradox forums — "Lower service fee of electricity and water" — https://forum.paradoxplaza.com/forum/threads/stonks-lower-service-fee-of-electricity-and-water-to-10.1611728/
- Paradox forums — "Power Breakdown" — https://forum.paradoxplaza.com/forum/threads/power-breakdown.1606123/
- Steam Community — "electricity bottleneck" — https://steamcommunity.com/app/949230/discussions/0/3877095833490098956/
- Steam Community — "Water bottleneck" — https://steamcommunity.com/app/949230/discussions/0/3877096256098600444/
- Steam Community — "Why do my buildings say no water connection or backed up sewage" — https://steamcommunity.com/app/949230/discussions/0/3951406499781720352/
- Steam Community — "Sell excess water?" — https://steamcommunity.com/app/949230/discussions/0/3877095833473583558/
- Steam Community guide — "The best power plant in numbers" — https://steamcommunity.com/sharedfiles/filedetails/?id=3068846564
