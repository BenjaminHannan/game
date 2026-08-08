# Cities: Skylines II — Environment: Pollution, Land Value, Wind & Water, Time & Weather

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) models its environmental layers — the four pollution types, the land-value field they feed, the wind and water-flow fields that transport them, and the day/night, seasonal, and weather cycles that modulate everything. Compiled to inform an original implementation in *Metropolis*. Written entirely in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Same as `zoning-districts.md`: outbound page fetches are blocked for most domains here, so the material below is synthesized from many targeted web searches whose results summarize one or more pages. Every claim carries a tag:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`). Likely accurate, not independently verified.
- **[Dev]** — Colossal Order / Paradox dev diaries, feature-highlight pages, or press coverage of them.
- **[Community]** — player guides, Steam discussions, forum analyses, modder writeups. May be patch-specific or personal testing.
- **[Inferred]** — my own reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree; both readings given.

Sister docs: `docs/research/cs2/zoning-districts.md` (the zone grid these fields are sampled against), `docs/research/roads.md`.

---

## How CS2 does it

### 1. Four pollution types, one shared shape

CS2 simulates **air, ground, water, and noise** pollution as four separate scalar fields spread over the map **[Wiki]/[Community]**. Each has its own info view, and the info views share a consistent visual grammar that is itself a design lesson: the **terrain** is tinted on a cool-to-hot ramp showing the *accumulated* level at that point, while **buildings and roads** are tinted on a separate ramp showing how much each one is *emitting* **[Wiki]**. Cause and effect are legible in the same picture.

The four differ in source, transport, and consequence:

| Type | Main sources | Transport | Hits |
| --- | --- | --- | --- |
| Air | Traffic, industry, fossil-fuel power, garbage facilities | Carried downwind, diluting as it spreads | Health |
| Ground | Industry zoning above all; landfills, some services | Static; seeps into adjacent water | Health |
| Water | Sewage outfalls; ground pollution reaching water | Carried downstream, diluting as it spreads | Health, severely, via the water supply |
| Noise | Large roads, transit stations, schools, any non-residential zone | Local radius falloff only | Well-being |

Sources **[Wiki]/[Community]**.

**Air.** Traffic and generic industry are the main emitters; the specialized farming and forestry industries are explicitly excused **[Wiki]**. Polluting buildings each carry an emission radius. The plume then **advects with the prevailing wind** and **dilutes as it mixes with clean air** — i.e. it is a transported-and-diffused field, not a static radius **[Wiki]**. Near residential, it costs citizens health.

**Ground.** Overwhelmingly industrial **[Community]**. Its distinguishing property is **persistence**: removing the source does not clear the contamination, which decays only slowly and needs sustained effort (relocating industry, planting trees, switching to renewable generation) to bring down **[Community]**. Several guides stress that the slowness is deliberate, mimicking real remediation. Ground pollution that reaches a shoreline becomes water pollution.

**Water.** Two inputs: sewage discharged directly into a body of water, and ground pollution leaching in **[Wiki]**. Like air, it **advects with the water flow and dilutes** **[Wiki]**. The consequence is the sharpest in the game: if a pump station draws contaminated water into the network, citywide health drops fast **[Wiki]**. This is what makes the "pumps upstream, outfalls downstream" rule the single most repeated piece of CS2 utility advice **[Community]**.

**Noise.** The most promiscuous field — nearly every non-residential thing emits some, with severity by type **[Community]**. It spreads only a short distance and does not advect. Crucially, **only residential buildings are affected**, and the cost is to **well-being rather than health** **[Community]**. Mitigations reported: sound barriers on at-grade highways (not available on elevated ones), tunnelling roads underground, dense tree planting, park buffers between noisy services and homes, and pedestrian streets that remove the traffic source entirely **[Community]**.

**Health vs. well-being.** CS2 splits citizen happiness into two components: **health** and **well-being** **[Wiki]**. Air and ground pollution attack health, scaling with intensity; noise, garbage, missing utilities, crime risk, and lack of leisure attack well-being **[Wiki]**. Contaminated tap water attacks health hardest. Keeping the two channels distinct is what lets pollution types have genuinely different feels rather than all being "the bad number."

**Resolution.** No source I found documents the pollution field's cell size or update cadence. The info-view rendering is a smooth terrain tint, and the fields clearly persist and diffuse, so a coarse raster (much coarser than the 8 m zone cell) updated on a slow tick is the natural implementation **[Inferred]**.

### 2. Land value

Land value is CS2's summary statistic for "how desirable is this spot," read by both households and companies **[Community]**. It is a continuous field over the map, exposed as its own info view.

**Inputs.** Since the 1.1.0 patch, sources describe land value as bound to five **service coverage** terms — transportation, healthcare, education, police, and commercial coverage **[Community]**. Around those, guides consistently report the same broader set: proximity to parks, plazas, libraries, and unique buildings raises it; pollution of any kind lowers it; and high-level buildings raise the value of their surroundings, which is the ripple mechanism described in `zoning-districts.md` §5 **[Community]**.

**Outputs.** Land value sets rent. Rent above upkeep produces a surplus that accumulates and eventually levels a building up **[Community]**. Every zone type except industry benefits from high land value; industry does not care and pollutes it away regardless **[Community]**. Land value therefore sits at the center of a feedback loop: services and amenities → land value → rent → building level → more land value.

**The famous bug, and what it teaches.** That loop ran away at launch. Industry and offices became very profitable, their high tax contribution pushed their own land value up, and the elevated value **spread into neighbouring residential**, driving rents to absurd levels and mass-abandoning housing **[Community]**. Two fixes shipped: land value was **capped**, and the "virtual landlord" was removed so a building's upkeep is split evenly across its renters **[Community]**. Even after the patch, community reports are mixed — some densities now level too slowly or abandon anyway **[Conflict]**.

The community **Land Value Overhaul** mod is the most informative artifact here, because its changelog effectively documents the vanilla parameters it changes: it shortens the distance over which land value spreads (reported as **200 down from 2000** units) and slows the per-tick spread rate (**0.001 down from 0.01**), producing a sharper, more "cliffy" distribution instead of a map-wide smear; it also stops extreme renter profit from producing extreme land value **[Community]**. Whatever the exact units, the shape is clear: vanilla CS2 propagates land value as a **slow diffusion with a very long range**, and that long range is precisely what let one hot industrial block poison a whole district.

**[Inferred] design reading:** land value in CS2 is a diffusing field seeded by per-building contributions, and its two dangerous knobs are *range* and *whether a building's own success feeds back into its own seed*. Uncapped positive feedback plus long range equals a runaway.

### 3. Wind and water as flow fields

Every map carries a **prevailing wind direction** and a **water flow field**. Both are surfaced to the player as **arrows drawn on the terrain in the relevant pollution info view** — direction by orientation, strength by arrow length — and the arrow overlay can be toggled **[Community]/[Wiki]**. This is a small UI decision doing enormous work: it turns two invisible simulation inputs into things the player can plan against before making a mistake.

**Water** is a genuine fluid simulation rather than a static height field **[Dev]**. Reported properties:

- Rivers, lakes and oceans are dynamic and flowing **[Dev]**.
- Map-edge **water sources** inject flow that runs across and off the map; the map editor exposes source types at different scales **[Dev]**.
- **Hydroelectric dams** are placed across flowing water; output depends on flow speed through the turbines, and generation stability is a direct function of the water sim **[Dev]**. A dam is the clearest case of the environment layer being *load-bearing gameplay* rather than decoration. Dams produce noise pollution but no air pollution **[Dev]**.
- Water simulation speed is a **separate setting from game speed**, with an explicit performance warning **[Dev]**. That is a strong hint the fluid sim is the expensive part of the environment budget **[Inferred]**.
- Terraforming near water is a well-known trouble spot: players report flooding that reaches roads and refuses to drain, leaving terrain permanently marked as water **[Community]**.
- Community mods add seasonal flow variation driven by precipitation and snowmelt, plus tides — features vanilla does **not** have **[Community]**, which is a useful map of where the vanilla sim stops.

**Wind** appears to be far simpler: a per-map (possibly per-season) direction and strength used to advect the air pollution field, with no reported turbulence, terrain deflection, or player-visible variation over time **[Inferred]** — no source describes wind doing anything except carrying smoke and, separately, driving wind turbine output.

### 4. Time, seasons, and weather

**Time mapping.** One day/night cycle equals **one in-game month**; a season is about three months; a year is **twelve in-game days** **[Dev]/[Community]**. At normal speed a day runs a bit over an hour of real time; the fastest speed compresses it to roughly a third of that **[Community]**.

**Day/night.** Citizens have real schedules: wake, commute to work or school, return home, sleep **[Dev]**. Observable consequences: traffic thins visibly at night, some zoned areas run below full efficiency after dark, and construction firms shut for the night except for interior trades **[Community]**. Separately, there is a **day/night visuals toggle that is purely graphical** and changes no gameplay **[Community]** — the simulation keeps running on schedule either way. Community complaints that the cycle is unbalanced (too much darkness) are common **[Community]**.

**Climate.** Maps are built on climate types — three are named in coverage of Dev Diary #8: **temperate, continental, and polar** **[Dev]**, with the underlying references spanning real latitudes from Finland to Brisbane. Climate governs temperature range over the year, precipitation and cloud probability, weather event types, and **day length** — winter nights are longer, and how much longer depends on latitude **[Dev]**.

**Weather and its gameplay effects.** Rain, cloud, heat, cold, and hailstorms occur; cold-season maps accumulate snow cover **[Dev]**. The reported effects are the interesting part, because they are all **economic**, not cosmetic:

- **Electricity demand tracks temperature in both directions** — heating in cold weather, air conditioning in hot **[Dev]**. This is the headline seasonal mechanic: the power grid you sized in spring browns out in January.
- **Snow demands road maintenance.** Uncleared snowy roads raise accident rates and can put a road out of service **[Dev]**.
- **Citizen behaviour shifts indoors** in cold or wet weather, raising patronage of indoor commercial venues like restaurants and cinemas, and lowering outdoor leisure use **[Dev]**.
- Winter also raises the load on emergency services **[Community]**.

**[Inferred]:** the common thread is that weather is a *multiplier on existing demand curves* — power draw, service budgets, commercial patronage — rather than a separate subsystem. That is a cheap and very effective pattern.

---

## What makes it feel like CS2

Six things, none of which requires a fluid solver:

1. **Pollution is spatial and you can see it.** The info view that tints terrain by accumulated level *and* buildings by emission in a second colour is the whole experience. It answers "how bad" and "whose fault" in one glance, and it turns an invisible penalty into a planning surface.
2. **Direction matters, and the game tells you the direction.** Wind arrows and flow arrows are what convert pollution from a radius-avoidance puzzle into a genuinely urban-planning one: put the smokestacks downwind of the houses, the intake upstream of the outfall. Without the arrows this is unfair; with them it is a lesson.
3. **Different pollutions punish differently.** Noise nags residents' mood; air and ground grind down health; bad tap water is a citywide emergency. Four fields that all did the same thing would be one field.
4. **Ground pollution has memory.** Contamination outlasting its cause is the only mechanic in the set that makes a past decision permanently expensive. It is what makes zoning an industrial district feel like a commitment.
5. **Land value is the reward channel.** Everything good you build — parks, schools, transit, clinics — resolves into one field that raises rents and levels buildings up. It is the loop that makes service spending feel like investment rather than tax.
6. **Seasons are felt through the budget.** The city that works in summer struggles in winter because power demand and road maintenance move with the thermometer. Snow on rooftops is nice; the electricity bill is the mechanic.

What is **not** essential to the feel: an actual Navier-Stokes water simulation, hydroelectric output tied to turbine flow rate, hailstorms, three distinct climate models, or per-citizen daily schedules.

---

## Metropolis v1 adoption

Consistent with `docs/UNKNOWNS.md` (statistical traffic flow, ~1–2k buildings at 60 fps in a browser, first five minutes = roads → zones → buildings) and with the zone grid in `zoning-districts.md`.

**Adopt directly**

- **Four named pollution channels** — air, ground, water, noise — each a scalar field, each with its own info-view overlay. Cheap to add once one exists, and the qualitative differences are most of the value.
- **Two-ramp info views.** Terrain tinted by accumulated level, emitters tinted on a separate ramp. This is the single highest-value borrowing in this document and costs almost nothing.
- **Split the citizen penalty in two.** Air + ground + dirty water → a **health** scalar; noise + garbage + missing utilities → a **well-being** scalar; happiness is their combination. Two channels, not one.
- **Noise affects residential only.** Keeps the field from turning into a universal tax and matches how players reason about it.
- **A per-map prevailing wind vector and a per-water-body flow direction, both drawn as arrows in the matching info view.** Constant per map in v1 — no seasonal variation, no terrain deflection.
- **Ground pollution decays much more slowly than it accumulates.** One asymmetric constant; it buys the "commitment" feel outright.
- **Land value as a diffusing field** seeded by positive contributions (parks, services, transit stops) and negative ones (all four pollution types), sampled per building.
- **Day/night as a visual cycle with a small set of real effects**, plus a graphics-only toggle that leaves the sim running.
- **Weather as multipliers on existing curves**, not as a new subsystem.

**Simplify for v1**

- **Pollution field resolution: a coarse raster, roughly 32 m cells (4 zone cells), updated a few times a second**, not every frame. Buildings deposit into the cell they occupy; the field then diffuses. Deliberately much coarser than the 8 m zone grid — the tint is smooth on screen anyway, and this keeps the whole map to a few tens of thousands of cells per channel. Revisit the constant after profiling.
- **Advection is a directional bias in the diffusion kernel, not a fluid sim.** Air diffuses with the map's wind vector added as drift; water pollution does the same along its water body's flow direction. This reproduces the plume shape and the upwind/downwind lesson at the cost of one extra term.
- **No water simulation at all.** Water is static geometry with a per-body flow *direction* used only for routing water pollution and for the pump-vs-outfall rule. No flow rate, no dams, no hydro power, no terraforming-into-water. This is the largest single cut in this document and it removes the biggest performance risk.
- **Land value capped, and short-range.** Take the lesson of the launch bug directly: cap the field, keep the diffusion range short (CS2's own community fix), and **never let a building's own profitability feed its own land-value seed**. Seeds come from amenities and services only. Rent derives from land value; nothing derives back into the seed in v1.
- **Land value does not drive building levels in v1**, because `zoning-districts.md` already defers levels. It drives rent, tax revenue, and which zone types will grow where. Levels are where it earns its keep later.
- **One climate, four seasons, fixed length.** Adopt the day = month, year = 12 days mapping, since it makes the clock readable and gives the season a natural period. No climate selection, no latitude-varying day length.
- **Weather: a single temperature scalar plus a precipitation flag** driven by season with light noise. Effects in v1, all one-line multipliers:
  - electricity demand rises as temperature departs from a comfort band, in both directions;
  - winter snow cover as a visual, plus a road-maintenance cost multiplier;
  - a modest commercial-demand shift toward indoor venues in cold or wet weather, only once commercial subtypes exist — otherwise skip it.
- **Day/night effects: three of them.** Traffic volume on the statistical flow model drops at night; commercial output runs below peak; nothing under construction advances overnight. No per-citizen schedules — we have no citizen agents.

**Explicitly rejected for v1**

Hydroelectric dams and flow-rate-dependent generation; tides and seasonal streams; hailstorms and natural disasters; terraforming interacting with water; sound barriers and road tunnels as noise mitigations (they need road upgrade slots we do not have); tree-based pollution absorption; multiple climates; latitude-varying day length; a citizen-level health model.

---

## Later path

Roughly in the order each stops being a nice-to-have:

1. **Land value drives building levels**, once levels exist. This is where the whole environment layer starts paying for itself — it closes the services → land value → rent → level → land value loop that makes a city visibly improve. Keep the range short and the cap in place from day one; do not repeat CS2's launch.
2. **Noise mitigation as road and building options** — sound barriers on at-grade roads, road tunnels, park buffers, tree planting that absorbs ground pollution. These turn noise from a constraint into a design problem with solutions, which is what makes a constraint fun.
3. **Water and sewage as a real network** with pump intakes and treatment plants, so the upstream/downstream rule becomes a live decision rather than a documented one. Water pollution is inert until there is something drawing from the water.
4. **Terrain-aware wind.** Let hills block or funnel the plume so map geography reads in the air-pollution overlay. Purely a change to the diffusion kernel's weights; no new system.
5. **Seasonal wind and flow variation**, plus precipitation feeding water levels — the vanilla-CS2 gap that its own modding community rushed to fill, which suggests players want it.
6. **District policies that touch the environment**: the combustion-engine and heavy-traffic bans from `zoning-districts.md`, which only mean something once air and noise are simulated per road edge. Good payoff, and the statistical traffic model already gives us per-edge flow to multiply.
7. **Real water simulation** — flowing rivers, hydroelectric dams, flow-rate-dependent output — with the simulation speed decoupled from game speed as CS2 does. Highest cost of anything here and the last thing to attempt in a browser.
8. **Multiple climates** as a map property, controlling temperature range, precipitation, and day length. Pure content once the weather multipliers exist.
9. **Weather events** — storms, heatwaves, freezes — as bounded shocks to the same multipliers, then optionally as disasters.

---

## Sources

- [Pollution — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Pollution)
- [Info views — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Info_views)
- [Citizens — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Citizens)
- [Paradox: CS II Feature Highlight #6 — Electricity & Water](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/electricity-water)
- [Paradox: CS II Feature Highlight #8 — Climate & Seasons](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/climate-seasons)
- [Paradox: CS II Feature Highlight #5 — City Services, Districts & Policies](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies)
- [Paradox: CS II Feature Highlight #11 — Citizen Simulation & Lifepath](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/citizen-simulation-lifepath)
- [Paradox: Modding Dev Diary #2 — Map Editor](https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-2-map-editor)
- [Colossal Order: Development Diary #8 — Climate & Seasons](https://colossalorder.fi/?p=1788)
- [Paradox forums: Development Diary #8 — Climate & Seasons](https://forum.paradoxplaza.com/forum/threads/development-diary-8-climate-seasons.1593180/)
- [Paradox forums: High rents / land value bug](https://forum.paradoxplaza.com/forum/threads/high-rents-land-value-bug.1613686/)
- [Paradox forums: Land value bugged since latest update](https://forum.paradoxplaza.com/forum/threads/land-value-bugged-since-latest-update.1617289/)
- [Paradox forums: Day and night cycle duration](https://forum.paradoxplaza.com/forum/threads/day-and-night-cycle-duration.1596145/)
- [Paradox forums: Produces crazy amounts of air pollution](https://forum.paradoxplaza.com/forum/threads/produces-crazy-amounts-of-air-pollution.1605869/)
- [Steam discussion: Water / wind flow direction](https://steamcommunity.com/app/949230/discussions/0/3877095833476847780/)
- [Steam discussion: Water and terraforming](https://steamcommunity.com/app/949230/discussions/0/3877095833475827369/)
- [Steam discussion: Water bug with landscaping tool](https://steamcommunity.com/app/949230/discussions/0/3877096256097986168/)
- [Steam discussion: Noise pollution from underground highway](https://steamcommunity.com/app/949230/discussions/0/4406291673454401192/)
- [Steam discussion: How do you lower land value](https://steamcommunity.com/app/949230/discussions/0/4031348273658175267/)
- [Steam discussion: Land value is broken](https://steamcommunity.com/app/949230/discussions/0/4362372817692702683/)
- [Steam discussion: Land value bug?](https://steamcommunity.com/app/949230/discussions/0/4029096764571166851/)
- [Steam discussion: Day/night cycle unbalanced and annoying](https://steamcommunity.com/app/949230/discussions/0/3937895063005320114/)
- [GamesRadar: CS2 pollution guide](https://www.gamesradar.com/cities-skylines-2-pollution-guide/)
- [GamesRadar: CS2 tips and tricks](https://www.gamesradar.com/cities-skylines-2-tips-strategy/)
- [GamesRadar: Patch throws out the virtual landlord to fix high rent](https://www.gamesradar.com/games/city-builder/cities-skylines-2s-upcoming-patch-will-fix-the-city-builders-high-rent-issue-by-throwing-out-the-virtual-landlord-and-letting-renters-pay-for-a-buildings-upkeep-equally/)
- [PCGamesN: CS2 is making pollution your problem](https://www.pcgamesn.com/cities-skylines-2/electricity-and-water)
- [PCGamesN: CS2 seasons system](https://www.pcgamesn.com/cities-skylines-2/weather-seasons)
- [PCGamesN: Mod fixes the land values bug](https://www.pcgamesn.com/cities-skylines-2/land-values-bug-fix)
- [TheGamer: How to increase and manage land value](https://www.thegamer.com/cities-skylines-2-increase-manage-land-value-explained-guide/)
- [TheGamer: How to deal with noise pollution](https://www.thegamer.com/cities-skylines-2-lower-reduce-noise-pollution-guide/)
- [ScreenRant: How to remove pollution in CS2](https://screenrant.com/how-to-remove-rid-pollution-cities-skylines-2/)
- [VideoGamer: How to get rid of pollution](https://www.videogamer.com/guides/cities-skylines-2-pollution-how-to/)
- [VideoGamer: How to fix air pollution](https://www.videogamer.com/guides/cities-skylines-2-air-pollution-how-to-fix/)
- [SegmentNext: CS2 climate and seasons guide](https://segmentnext.com/cities-skylines-2-climate-and-seasons/)
- [TechRaptor: New CS2 video introduces climate, seasons and natural disasters](https://techraptor.net/gaming/news/cities-skylines-2-climate-video)
- [Neowin: CS II will add changing seasons, climates and natural disasters](https://www.neowin.net/news/cities-skylines-ii-will-add-changing-seasons-climates-and-natural-disasters/)
- [Attack of the Fanboy: How to stop ground pollution](https://attackofthefanboy.com/guides/how-to-stop-ground-pollution-in-cities-skylines-2/)
- [The Nerd Stash: How to remove ground pollution](https://thenerdstash.com/how-to-remove-ground-pollution-in-cities-skylines-2/)
- [Love Cities: Skylines — Land value complete guide](https://www.lovecitiesskylines.com/land-value-guide/)
- [Magic Game World: CS2 land value](https://www.magicgameworld.com/cities-skylines-2-land-value/)
- [LandValueOverhaul mod (GitHub)](https://github.com/Jimmyokok/LandValueOverhaul)
- [LandValueOverhaul on Thunderstore](https://thunderstore.io/c/cities-skylines-ii/p/Jimmyok/LandValueOverhaul/)
- [Water Features mod (Nexus Mods)](https://www.nexusmods.com/citiesskylines2/mods/121)
- [Time and Weather Anarchy mod (Nexus Mods)](https://www.nexusmods.com/citiesskylines2/mods/161)
- [Gamepur: How to turn off the day & night cycle](https://www.gamepur.com/guides/how-to-turn-off-the-day-night-cycle-in-cities-skylines-2)
