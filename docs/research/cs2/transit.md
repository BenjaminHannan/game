# Cities: Skylines II — Public Transport: Lines, Stops, Ridership, and Transit Economics

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, October 2023) structures public transport: the modes it ships, the depot → stop → network → line authoring loop, how citizens decide to ride, and how lines earn and cost money. Compiled to inform an original implementation in *Metropolis*. Everything below is written in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most relevant domains in this environment, so the material here is synthesized from many targeted web searches whose results are summaries of one or more pages (official wiki, Paradox feature-highlight pages and forums, Colossal Order dev diaries, Steam guides and discussions, press coverage, guide sites). Tags follow the house convention used in the sister docs:

- **[Dev]** — attributed to Colossal Order / Paradox's own material (feature highlights, dev diaries, press coverage of them). Best evidence for *intent*; prose, not spec.
- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`). Likely accurate, not independently read.
- **[Community]** — player guides, Steam discussions, forum analyses. Symptom reports at some patch version, not spec.
- **[Inferred]** — my own reasoning, not stated by any source.
- **[Conflict]** — sources disagree; both readings given.

Sister docs: `docs/research/cs2/traffic-pathfinding.md` (the four-term path cost that transit plugs into — read that first, this doc assumes it), `docs/research/cs2/economy.md` (budget lines), `docs/research/cs2/services-utilities.md` (the ploppable-service pattern depots follow), `docs/research/cs2/zoning-districts.md` (doc style, district policies that interact with mode choice).

---

## How CS2 does it

### 1. The authoring loop: depot → stops/stations → network → line

CS2 standardizes every transport mode onto one four-step sequence, and the standardization is itself the headline design change from CS1 **[Dev]/[Wiki]**:

1. **Build a depot.** Every land-based mode has one — bus depot, tram depot, subway/metro depot, rail yard, taxi depot — and it is where vehicles spawn and are maintained **[Dev]/[Wiki]**. A depot supports a capped number of vehicles; the cap can be raised with a building upgrade, and past the cap you need a second depot **[Wiki]/[Community]**. CS1 had this only for some modes; making it universal is explicitly called out in press coverage as the notable sequel change **[Dev]**.
2. **Place stops and stations.** Small roadside stops (a bus stop sign or a shelter) for surface modes; larger footprint stations for rail and metro, upgradeable with extra platforms **[Wiki]/[Community]**.
3. **Build the network the mode needs** — tram track, subway track, rail track, seaways, or nothing at all for buses, which ride the existing roads.
4. **Draw the line** with the Line Tool, connecting stops in order.

The ordering matters and the game enforces it: no depot, no vehicles, and a line with no vehicles carries nobody. Players routinely hit exactly that failure mode — a drawn line that shows zero vehicles because the depot is missing, full, or disconnected from the network **[Community]**.

**Taxis** are the odd mode out: a taxi depot plus taxi stands, no line at all. Vehicles wait at stands and pick up fares; a dispatch-center upgrade on the depot removes the stand restriction and lets taxis pick up anywhere in the city **[Wiki]**. Both unlock at the same progression milestone **[Wiki]**.

### 2. Modes and what distinguishes them

| Mode | Own network? | Role as sources describe it |
| --- | --- | --- |
| Bus | No — uses roads | Cheap, flexible, unlocks first, backbone of the early network; shares congestion with cars. Fuel and electric variants **[Wiki]/[Dev]** |
| Tram | Track, can be laid *into* an existing road via the replace/upgrade tool, or run on its own right-of-way | Higher up-front cost than bus, quiet, no air pollution; on dedicated track it bypasses car traffic entirely **[Wiki]** |
| Subway / metro | Dedicated track, usually tunneled; can also be elevated or at grade | Highest up-front cost, fast, high capacity, popular with citizens *because* it is fast; underground routing costs almost no surface land **[Wiki]** |
| Passenger rail | Heavy rail track, large stations | Big capacity, best suited to intercity but usable locally if you accept the station footprint **[Wiki]** |
| Ship | Seaways + harbors | High passenger volume, both city-internal harbor-to-harbor lines and lines out to the map edge **[Wiki]** |
| Air | None — airport connects straight to outside connections | Low capacity per vehicle, high speed; the airport exposes a small fixed number of gates (reported as five) that lines are assigned to **[Wiki]** |
| Taxi | Roads | Door-to-door, no line, demand-driven dispatch **[Wiki]** |

Tram, subway, rail, ship, and air tracks all support elevated, bridged, cut-and-fill, and tunnel variants through the same elevation controls the road tool uses — the network tools are one family, not per-mode one-offs **[Wiki]**.

Two structural notes. First, **outside connections are just the far end of a line**: bus, train, ship, and plane lines can terminate at the map edge, bringing in citizens and tourists rather than only shuffling residents **[Dev]/[Wiki]**. Second, **cargo uses the identical tooling** — cargo train terminals, cargo harbors, cargo airplane routes, all drawn with the same line tool, listed in the same overview panel under a separate cargo tab **[Dev]/[Wiki]**. Unifying passenger and freight line authoring is described by Colossal Order as a deliberate simplification of the gameplay loop **[Dev]**.

Reported vehicle capacities **[Community]**, useful only as ratios and almost certainly patch-dependent: bus ≈ 30, tram ≈ 90, passenger train ≈ 240, metro train much larger (one figure of ~1080 per train circulates, which reads as a whole train rather than a car despite how it is sometimes phrased) **[Conflict]**. The design intent behind the spread is legible regardless: roughly 1 : 3 : 8 : 30+ across bus, tram, train, metro, so each tier up is a step change rather than an increment.

### 3. The Line Tool and what makes it feel good

The Line Tool is one tool reused across every mode **[Dev]**. You pick a line type, then click stops in sequence; the tool routes the vehicle between consecutive stops using the underlying network, previewing the path as you go.

The important addition over CS1 is **waypoints**: between two stops you may place intermediate points that constrain the route without creating a passenger stop **[Dev]**. This exists because the auto-route between stops is a pathfinding result, and pathfinding results are not always what a player wants — waypoints let you push a bus off a congested arterial or force it through a specific intersection while keeping the stop list clean. It is the difference between "the game decides my route" and "I decide my route." **[Inferred]** The stop list and the waypoint list are almost certainly the same ordered polyline internally, with a flag marking which entries are boardable.

Per-line properties exposed in the line panel **[Wiki]/[Dev]**:

- **Name** and **colour** — colour is what makes the transport info view legible, exactly like a real transit map.
- **Ticket price.**
- **Vehicle count** assigned to the line.
- **Operating hours** — day only, night only, or both. A cheap, expressive lever: night buses without night metros.
- Read-outs: **length**, **number of stops**, **current passengers**, and a **usage percentage**.

**Line usage percentage** is the key diagnostic. Near 100% means the line is saturated, and the prescribed fix is to add vehicles, which shortens waiting time at stops, which in turn feeds back into citizens' path costs and makes the line more attractive **[Dev]/[Wiki]**. That loop — crowding → wait → path cost → ridership → crowding — is the whole transit-management game in one number.

The **Transportation Overview** panel lists every line, split passenger/cargo and then by mode, showing per-mode line counts, monthly passengers carried, tourists carried, and cargo tonnage **[Wiki]**. The **Transport info view** paints all lines and vehicles on the map with their icons and colours **[Dev]**.

### 4. Ridership and modal choice

CS2 has **no modal-split dial anywhere**. A citizen rides the bus if and only if riding the bus wins the same pathfinding cost minimization that decides everything else in `traffic-pathfinding.md`: **Time, Comfort, Money, Behavior**, summed, lowest wins **[Dev]**. Transit is not a parallel system — it is a set of extra edges in one multimodal graph.

How each term touches transit:

- **Time** — in-vehicle travel time plus **waiting time at the stop**, which is a function of how many vehicles are on the line and how long the loop is **[Dev]**. This is why a long line with too few vehicles loses riders even when it goes where people want.
- **Comfort** — includes how convenient the endpoint is: whether there is a stop near the origin and near the destination, and how far the citizen must walk **[Dev]**. Walking is a real leg with a real cost, so stop coverage is a comfort term, not a binary catchment radius.
- **Money** — the **ticket price**, weighed against the money cost of the alternative: fuel plus parking fees **[Dev]**. Fares and parking policy are two ends of one lever.
- **Behavior/cohort** — age shifts the weights: teens weight money (cheap transit, long walks accepted), adults weight time (fastest wins, price irrelevant), seniors weight comfort (nearest, least-transfer option) **[Dev]**.

Consequences players report, which are exactly what this model predicts **[Community]**:

- Overly long lines lose ridership — the in-vehicle time term grows faster than the walk saved.
- Cutting the fare below the default sharply raises ridership. One widely repeated observation is that dropping a bus fare from the default to a noticeably lower value converts a dead line into a busy one **[Community]** — plausible in shape, and the specific numbers should be treated as one player's patch-version anecdote.
- *Reducing* vehicles on an under-used line raises passengers-per-vehicle without much hurting total ridership, because the wait penalty was not the binding constraint. This is the correct optimization for a line's profitability and a nice emergent bit of realism **[Community]**.
- Paid parking is one of the strongest transit incentives available, since it moves the money term on the *car* side rather than the transit side **[Community]**.
- Trunk-and-feeder — rail or metro for the long haul, buses feeding the stations — is the community consensus structure, which is what you would expect from a cost model where mode changes are cheap but in-vehicle time is expensive **[Community]**.
- Transfers are handled implicitly: a transfer is just a walk edge between two stops, so stacked or adjacent platforms make interchanges cheap and separated ones make them expensive **[Community]/[Inferred]**.

**[Community]/[Conflict]** A persistent complaint at launch was that transit usage was implausibly low overall, with some players arguing citizens simply were not making enough long trips to need it. Whether that was a simulation bug, a tuning issue, or players misreading the numbers is not something the sources settle.

### 5. Transit economics

Transit is a line item in the city budget with both sides populated **[Wiki]/[Community]**:

- **Expenses**: a one-off construction cost plus a recurring upkeep for each depot, each stop/station, and — reported separately — each **line** itself, scaling with the vehicles assigned to it **[Community]**.
- **Income**: fares collected per boarding.

CS2 does not ship CS1's per-service budget sliders for transit **[Inferred, from the absence of any mention across searches]**; the equivalent lever is direct — set the fare, set the vehicle count, set the operating hours per line. That is a strictly better design: the same control at a granularity the player can actually reason about, attached to the object being controlled.

The characteristic experience is that **public transport runs at a loss and players are surprised by how large a loss** — forum threads about transport expenses dwarfing fare income are common **[Community]**. The tension is genuine and well-shaped: a busy line pays for itself, a line built ahead of demand bleeds, and the fare slider trades revenue-per-rider against ridership on the money term of the path cost. Because fares also reduce car traffic, the correct fare is frequently *below* the revenue-maximizing one, and the game never says so — the player has to work it out.

**[Inferred]** Reported figures (a bus depot's upkeep being a large multiple of a line's, a line's upkeep being tens of thousands per month against fares of single-digit units per boarding) imply a deliberately low farebox recovery ratio: transit is meant to read as subsidized infrastructure that pays off in land value, traffic relief, and happiness, not as a revenue centre.

---

## What makes it feel like CS2

Strip away the mode list and the feel rests on six things:

1. **One tool, every mode.** Bus, metro, ferry, cargo plane — same click-the-stops gesture, same panel, same properties. Learning transit once means knowing all of it. This is the single most transferable idea in the whole system.
2. **The depot precondition.** You cannot conjure vehicles. Something physical, sited, and paid-for has to exist and be connected before a line moves. It makes transit feel like infrastructure rather than a menu toggle.
3. **The drawn line as an artifact.** A named, coloured polyline on a map, showing up in an info view that looks like a transit diagram. Players get attached to their lines in a way they never get attached to a road. Naming and colouring are cheap and carry enormous ownership.
4. **Waypoints — authorship over routing.** The moment where the tool stops arguing with you and does what you meant.
5. **Ridership is earned, not granted.** Nobody rides because you built it. They ride because it beat driving on time, comfort, money. A line that fails teaches you *why* it failed, via usage %, wait, and fare.
6. **Usage % as the one number that matters.** A single legible saturation gauge with an obvious remedy (add vehicles) and an obvious cost (upkeep). Perfect management-loop ergonomics.

What is *not* essential: seven modes, cargo lines, operating hours, day/night variants, tourists, airport gates, taxis. Depth, added later.

---

## Metropolis v1 adoption

Consistent with the binding decisions in `docs/UNKNOWNS.md` — **statistical flow per road edge with lightweight visual vehicles, no per-agent pathfinding in v1**; straight-road MVP; CS2-structured UI with original art; ~1–2k buildings at 60 fps — transit has to be rebuilt on a statistical substrate rather than an agent one. That is a real constraint and it shapes everything below.

**Adopt directly**

- **The four-step loop: depot → stops → (network) → line.** Non-negotiable; it is the feel.
- **One Line Tool for all modes**, click-stops-in-order, live route preview between consecutive stops using the road graph.
- **Per-line: name, colour, vehicle count, fare.** Four properties, all of which the player touches constantly.
- **Line panel read-outs: length, stop count, passengers/period, usage %.** Usage % is the whole management loop; ship it in v1.
- **A depot with a vehicle cap** that lines draw from, and a hard, visible failure state when a line has no vehicles or no depot connection.
- **Transit info view** that paints lines in their colours over a desaturated city, matching the info-view convention already fixed for the UI.
- **Both budget sides**: construction + upkeep for depot, stops, and per-line-vehicle; fare income per boarding. Tuned so a well-used line roughly breaks even and a speculative one hurts.

**Simplify for v1**

- **Two modes: bus and metro.** Bus rides existing roads (zero new network code, unlocks first, teaches the loop). Metro is the tier-two upgrade: dedicated underground track drawn with the road tool's geometry, immune to congestion, high capacity. Two modes is enough to make trunk-and-feeder emerge; tram/rail/ship/air are content on the same machinery.
- **Ridership without agents.** With statistical flow, ridership must be computed as a **flow assignment, not a simulation**. Proposed v1 model: for each origin-destination pair that the flow model already produces, compute a road-path generalized cost and a best transit generalized cost (walk-to-stop + expected wait + in-vehicle time + fare, using a fixed value-of-time), then split the flow between them with a **logit share** rather than a winner-takes-all rule. Logit is one line of code, is what real transport planning uses, and gives smooth, tunable behaviour instead of cliff-edge flips.
  - **expected wait = line loop time / (2 × vehicle count)** — a standard headway approximation. This alone makes "add vehicles" the correct, discoverable remedy without simulating a single bus.
  - **walk access** as a distance-decay term from stop to origin/destination cell, not a hard radius. Coverage then degrades gracefully, which is what makes stop siting a skill.
  - **usage % = assigned riders / (vehicle count × capacity × trips per period)**, capped at 1 with the overflow expressed as extra wait. This closes the crowding→wait→ridership loop honestly.
- **Fares as a single per-line number** feeding the money term of the split. No per-mode defaults, no discounts, no passes.
- **No transfers in v1.** Each trip rides at most one line. Transfers require a transit graph search and are the natural first extension, not a launch feature.
- **No operating hours, no day/night**, no fuel/electric variants, no tourists, no taxis, no cargo lines, no outside connections. All of these are the same tool with more rows.
- **Visual vehicles are instanced meshes moving along the line polyline at a spacing derived from vehicle count** — decorative, driven by the same numbers the sim uses, never authoritative. Identical treatment to the road traffic decision already made.
- **Waypoints: yes, but cheap.** With straight roads only, auto-routing between stops is nearly always sane, so ship the stop list first and add waypoint entries to the same polyline as soon as curves or congestion routing arrive. Design the line data as an ordered list of `{node, isStop}` from day one so this costs nothing later.

**Explicitly rejected for v1**

Per-agent boarding and alighting; multi-mode transfer trips; depot vehicle maintenance/refueling behaviour; upgradeable stations and platform counts; separate cargo lines; airport gates; district policies interacting with transit; anything that requires transit vehicles to exist as pathfinding agents.

---

## Later path

Roughly in the order each stops being a nice-to-have:

1. **Transfers.** Build the transit network as its own graph (stops as nodes, line segments and walk links as edges) and run a shortest-generalized-cost search on it. This is what turns a set of lines into a *system* and makes interchange siting matter. Biggest single feel gain after v1.
2. **Trams**, as the proof that the mode system generalizes: track laid into an existing road segment via the replace tool, sharing the roadway. Cheap content, and the road-upgrade path it needs is useful anyway.
3. **Operating hours and a day/night demand curve**, once the sim has a time-of-day flow profile. Very high expressiveness per line of code.
4. **Passenger rail and outside connections**, which brings tourists and inbound population and connects transit to the growth model.
5. **Per-agent transit riders**, if and only if per-agent pathfinding lands for traffic generally. Everything above should be written so the flow-assignment model can be swapped for an agent model behind the same line/stop/usage data.
6. **Cargo lines** on the same tooling, once a resource economy exists to move goods for (see the zoning doc's later path — same prerequisite).
7. **Ship and air**, terrain and outside-connection dependent, pure content once 4 and 6 exist.
8. **Taxis**, which need door-to-door dispatch and therefore agents; strictly after 5.
9. **District/policy interaction** — transit priority lanes, fare-free districts, combustion bans that push the modal split — once districts carry policies at all.
10. **Station upgrades and transport hubs** (multi-mode buildings that make transfers free), which are only meaningful after transfers exist.

---

## Sources

- [Transportation — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Transportation)
- [Traffic — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Traffic)
- [Info views — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Info_views)
- [City Stations — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/City_Stations)
- [Paradox: CS II Feature Highlight #3 — Public & Cargo Transportation](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation)
- [Paradox: CS II Feature Highlight #2 — Traffic AI](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai)
- [Paradox: CS II Feature Highlight #1 — Road Tools](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools)
- [Paradox: CS II Feature Highlight #11 — Citizen Simulation & Lifepath](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/citizen-simulation-lifepath)
- [Colossal Order: Hubs & Transport Dev Diary #1 — Transport Additions](https://colossalorder.fi/?p=1295)
- [PC Gamer: CS2 is making an important change to how public transportation works](https://www.pcgamer.com/cities-skylines-2-is-making-an-important-change-to-how-public-transportation-works/)
- [PCGamesN: CS2 intercity trading is an absolute game changer](https://www.pcgamesn.com/cities-skylines-2/public-cargo-transport)
- [Steam guide: Master Guide to Alternative Transit Systems in Cities Skylines 2](https://steamcommunity.com/sharedfiles/filedetails/?id=3434362773)
- [Steam discussion: Public Transit not really utilized](https://steamcommunity.com/app/949230/discussions/0/3877096256096163953/)
- [Steam discussion: No one is taking the bus](https://steamcommunity.com/app/949230/discussions/0/3877095833476361260/)
- [Steam discussion: Transportation has literally 0 usage](https://steamcommunity.com/app/949230/discussions/0/3877095833474918438/)
- [Steam discussion: No Vehicles — Bus lines](https://steamcommunity.com/app/949230/discussions/0/4845400125743703437/)
- [Steam discussion: Public transport efficiency?](https://steamcommunity.com/app/949230/discussions/0/3937895062996578538/)
- [Steam discussion: Increasing Subway vehicle count issue](https://steamcommunity.com/app/949230/discussions/0/4031347296572200400/)
- [Steam discussion: Enormous transportation services cost](https://steamcommunity.com/app/949230/discussions/0/4406291673453568293/)
- [Steam discussion: Planes, Trains and... Boats](https://steamcommunity.com/app/949230/discussions/0/4030223677062075746/)
- [Steam discussion: Cargo routes?](https://steamcommunity.com/app/949230/discussions/0/3951406749572915919/)
- [Steam discussion: Bus direction on pedestrian roads](https://steamcommunity.com/app/949230/discussions/0/3877095833487329889/)
- [Paradox forums: Enhancing Public Transportation in CS2 — Comprehensive Feature Suggestions](https://forum.paradoxplaza.com/forum/threads/enhancing-public-transportation-in-cities-skylines-2-comprehensive-feature-suggestions.1704111/)
- [TheGamer: How to set up bus routes in CS2](https://www.thegamer.com/cities-skylines-2-bus-routes-basic-transportation-set-up/)
- [TheGamer: How to set up tram lines in CS2](https://www.thegamer.com/cities-skylines-2-tram-lines-trams-set-up/)
- [TheGamer: How to set up an airport in CS2](https://www.thegamer.com/cities-skylines-2-airport-air-transportation-set-up/)
- [TheGamer: How to set up a harbor in CS2](https://www.thegamer.com/cities-skylines-2-harbor-ships-set-up/)
- [TheGamer: How to make walkable cities in CS2](https://www.thegamer.com/cities-skylines-2-walkable-cities-pedestrian-guide/)
- [eXputer: CS2 — How to create bus routes](https://exputer.com/guides/cities-skylines-2-bus-routes/)
- [Item Level Gaming: CS2 Ultimate Bus Guide](https://itemlevel.net/cities-skylines-2-ultimate-bus-guide/)
- [The Nerd Stash: Best practices for public transit in CS2](https://thenerdstash.com/best-practices-for-public-transit-in-cities-skylines-2/)
- [Chill Place Gaming: Public transport showdown — bus vs tram vs metro](https://chillplacegaming.com/cities-skylines-ii-public-transport/)
- [Magic Game World: CS2 guide to cargo transportation](https://www.magicgameworld.com/cities-skylines-2-guide-to-cargo-transportation/)
- [GameRant: CS2 — How to set up ship connections](https://gamerant.com/cities-skylines-2-how-to-set-up-ship-connections/)
- [GameRant: CS2 — How to build pedestrian paths](https://gamerant.com/cities-skylines-2-how-to-build-pedestrian-paths/)
- [GamesRadar: How to make money in CS2](https://www.gamesradar.com/cities-skylines-2-money/)
- [Medium: Transport Fever in Cities: Skylines II](https://medium.com/@bangaip/transport-fever-in-cities-skylines-ii-c2a8576c758c)
- [modscities2: CS2 Transportation Overview](https://www.modscities2.com/cities-skylines-2-transportation-overview/)
- [modscities2: CS2 Public Transport Types](https://www.modscities2.com/cities-skylines-2-public-transport-types/)
