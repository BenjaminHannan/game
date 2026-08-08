# Cities: Skylines II — Outside Connections and the Map Edge

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) models the world beyond the playable area: the per-mode connection points at the map boundary, the traffic and agents they emit, the pricing of goods that cross them, and the way a map's connection mix sets its difficulty. Compiled to inform an original implementation in *Metropolis*. Written in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains here (the official wiki included — a direct fetch of the Traffic page was refused), so the material below is synthesized from many targeted web searches over the official wiki, Paradox feature pages and forums, Steam guides and discussions, mod pages, and guide sites. Tags as in `zoning-districts.md`:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`). Likely accurate, not independently verified.
- **[Dev]** — Colossal Order / Paradox marketing, feature highlights, or dev-diary material.
- **[Community]** — player guides, Steam discussions, forum analyses, modder writeups. May be patch-specific or personal testing.
- **[Inferred]** — my own reasoning, not stated by any source.
- **[Conflict]** — sources disagree; both readings given.

Sister docs: `economy.md` (§6 imports/exports, which this doc expands), `traffic-pathfinding.md` (the statistical-flow model outside traffic feeds into), `transit.md` (lines that terminate at the edge), `services-utilities.md` (power and water trade), and `demand-growth.md` (imports as the escape valve on the demand loop).

---

## How CS2 does it

### 1. A connection is a typed spawner sitting on the map boundary

The map edge is not a wall the simulation reasons about geometrically. It is a set of discrete, typed **spawner objects** placed at specific points on the boundary by the map author, each belonging to one transport mode. The map editor makes this explicit: air connections are placed from an asset browser as spawner objects for airplanes, and shipping lanes are drawn as "seaway" paths that must cross the boundary to register **[Community]**. Road, rail, power, and water/sewage connections are created simply by carrying the relevant network — a road, a track, a high-voltage line, a pipe — out past the map limit **[Wiki]/[Community]**.

The consequences of that design are visible everywhere in play:

- **Some modes are player-extensible, some are not.** Roads, rail, and ship routes can be added by any player who owns the boundary tile and builds out to it. **Air connections cannot** — a map ships with a fixed set (commonly reported as two or three) authored into it, and there is no in-game way to create another **[Community]**. That asymmetry is the single biggest structural fact about CS2's map edge.
- **Reaching the edge costs land.** Water and sewage connections in particular have to reach the *playable* boundary, not merely the edge of the tiles you currently own, so exporting water is gated behind buying out to the rim **[Community]**.
- **Maps start unequal.** Nearly every shipped map begins with at least one highway connection and a starting power line; most have rail and a navigable waterway available; none of the base maps begin with a water or sewage connection already made **[Wiki]/[Community]**.

### 2. The mode roster and what each one is good for

| Mode | Created by | Carries | Character |
| --- | --- | --- | --- |
| Highway | Road drawn to the edge | Freight trucks, movers-in, tourists in cars, commuters, through traffic | Always present, zero infrastructure cost, and the default for everything early. Also the worst for congestion **[Wiki]/[Community]** |
| Rail | Track drawn to the edge, plus a passenger or cargo train station | Cargo trains, passenger trains (tourists, commuters, movers-in) | High capacity per vehicle; the standard fix for truck-choked highways **[Wiki]/[Community]** |
| Ship | Seaway drawn to the edge, plus harbor / cargo harbor | Cargo ships, passenger ships | Highest reported per-vehicle load (~1000 t for cargo ships) and slow; immune to road congestion **[Community]** |
| Air | Pre-authored spawners only, plus airport / cargo terminal | Passengers, air freight | Fastest, smallest per-vehicle capacity, hard-capped in route count **[Community]** |
| Power | High-voltage line to the edge via a transformer station | Electricity, both directions | Reported per-transformer trade cap of **80 MW**; add transformers to trade more. Line limits reported as ~40 MW on street-level/small lines and ~400 MW on high-voltage **[Community]** |
| Water / sewage | Pipe to the playable boundary | Fresh water in, sewage out, both tradeable | Not present by default on shipped maps; must be built to the rim **[Community]** |

The mode list is the same list the transit system uses, because **outside connections are literally the far end of a transit line** — a bus, train, ship, or plane line may terminate at the boundary, and the same line tool authors passenger and cargo routes alike (`transit.md` §on line authoring) **[Dev]/[Wiki]**.

### 3. Through ("dummy") traffic

CS2 generates vehicles that enter at one outside connection and leave at another without ever interacting with the city. The wiki describes this as traffic between other cities that does not contribute to the city's economy but becomes part of the overall flow once the player's road network is grafted onto the highway **[Wiki]**.

Two behavioural notes:

- It is **flow, not economy**. It occupies road capacity, contributes to congestion and noise, and is otherwise inert — no money, no goods, no citizens **[Wiki]**.
- It becomes the player's problem the moment they route city traffic onto the same highway segments, which is why "keep the through route separate from your arterials" is standard advice **[Community]**.

CS1's version of this was notoriously badly distributed — mods existed specifically to rebalance spawn rates across connections and to weight external traffic by road capacity rather than splitting it evenly, and community reports of dummy traffic favouring one connection are long-standing **[Community]**. CS2 draws the same complaint in new clothes: players describe cars pouring in continuously and funnelling down a single road rather than spreading over available routes **[Community]**. The volume is generally understood to scale with the city rather than being constant, though no source I found states the formula **[Inferred]**; **[Conflict]** in the sense that no primary documentation confirms scaling at all.

### 4. Inbound and outbound agents

Four distinct agent flows cross the boundary, and CS2 keeps them conceptually separate:

**Movers-in.** New households originate outside and arrive over a connection. Reported behaviour: the move-in rate is **capped at a roughly fixed absolute amount rather than being proportional to city population**, so growth does not compound freely **[Community]**. Move-in is also reported to **stall entirely while homeless households exist** — the queue does not advance until the homeless are housed or leave **[Community]**. Available housing across a spread of rent levels and wealth bands is what actually gets consumed (see `demand-growth.md`).

**Tourists.** Non-residents who arrive over a connection and stay in hotels. Numbers are driven by **city attractiveness**, itself raised by high land value and by monuments/landmarks. Early on tourists arrive by highway only; as the player builds rail, harbor, and airport links, arrivals distribute across those modes. Once inside, a tourist picks leisure destinations by weighing each destination's attractiveness against its distance from the hotel, so a sufficiently attractive venue wins even when it is far away. Tourists who arrive without a car depend on public transport, and better mobility is reported to increase their spending **[Wiki]/[Dev]**.

**Commuters.** Citizens who live outside the map and travel in to fill jobs. Reported strongly by players: adding a bus or rail connection to the boundary causes outside workers to flow in, sometimes thousands of them, filling vacancies that local residents cannot **[Community]**. This is a major departure from CS1's closed labour market and it means job vacancy does not translate one-to-one into residential demand.

**Freight.** Trucks, trains, ships, and planes moving goods in both directions, generated by companies rather than by the player. Trade is emergent — surplus exports, deficit imports, with no policy switch (`economy.md` §6) **[Wiki]**.

Community testing produces one striking result worth recording: a city with **no road outside connection at all**, served only by a rail link, is reported to work fine — imports and exports still happen, and the city is nearly traffic-free **[Community]**. The edge is a set of independent channels, not a single required gateway.

### 5. Pricing: what crossing the boundary costs

The wiki's account, as relayed by search summaries, has three parts **[Wiki]/[Community]**:

1. **The price of an import order is the resource price plus a transport cost.** They are separate terms.
2. **Transport cost rises with distance and with the weight of the resource** — metals cost more to move than textiles. Companies try to source from the nearest supplier to protect their margin, which is why a warehouse or shop will import from outside if the outside connection is closer and cheaper than a local producer.
3. **Transport cost scales with volume**: the more of a resource crosses the boundary, the farther the notional trading partner and the higher the per-unit cost (already recorded in `economy.md` §6). Importing a little is cheap; importing everything is ruinous, without any hard cap being needed.

Layered on top, **mode changes the price**: cargo trains and ships have large per-vehicle capacities, which lowers the effective transport cost even for heavy resources **[Wiki]**. So the pricing model has a per-commodity weight, a volume/distance term, and a per-mode efficiency multiplier. Building a cargo harbor is not only a congestion fix — it is a margin improvement on every heavy commodity the city trades.

Electricity and water are priced on their own separate channels rather than through the goods market, and export happens automatically once production exceeds consumption and a transformer-backed high-voltage link exists **[Community]**.

### 6. Capacity, and what happens when it runs out

Capacity in CS2 is expressed differently per mode, and the game rarely says "full" outright:

- **Road**: capacity is just road capacity. The failure mode is a queue — a single off-ramp saturates past some volume and backs up onto the highway, and community advice is to split incoming flow across multiple ramps well before the city edge **[Community]**.
- **Cargo terminals and harbors**: the terminal itself becomes the jam site. Players report miles of trucks queued at cargo hub entrances, and the fixes are fewer vehicles per line, dedicated approach roads, and one-way circulation **[Community]**.
- **Air**: hard-capped twice over — a fixed number of edge spawners per map, and a reported per-airport ceiling on daily landings independent of how many routes are assigned **[Community]**.
- **Power**: explicit numeric caps (80 MW per transformer; line-level transfer limits) **[Community]**.
- **Global**: an engine-level cap of roughly **16,000 vehicles** across cars, trucks, and bicycles constrains everything at once, so heavy import truck traffic competes for the same budget as citizens' commutes **[Community]**.

### 7. How the connection mix sets a map's difficulty

Map selection in CS2 advertises, alongside buildable area and climate, **which outside connections a map has** — and the community's difficulty rankings track it closely. Maps praised for beginners are the ones with generous buildable area, plentiful natural resources, *and* access to the full connection set; maps flagged as expert-level combine broken terrain with scarce resources and thin connectivity **[Community]**. One shipped map is described in guides specifically as offering access to all connection types **[Community]**.

The causal chain **[Inferred]** from the mechanics above: sparse local resources force imports; imports over a road-only edge mean truck volume; truck volume on one highway link means congestion plus a rising per-unit transport cost; and the escape hatch — a cargo harbor or rail terminal — is unavailable if the map has no waterway or no rail link. Connection scarcity is therefore not a separate difficulty knob bolted on; it is difficulty expressed through the economy and the traffic model at once.

---

## What makes it feel like CS2

1. **The edge is an actor, not a boundary.** Things come *from* somewhere. The city is embedded in a region that supplies workers, tourists, goods, and electricity, and that has its own traffic passing through indifferent to you.
2. **The first connection is free and bad.** Everybody starts on the highway, everybody eventually chokes on it, and the arc from "one off-ramp" to "cargo harbor plus rail terminal plus a bypass" is one of the game's best-shaped progressions.
3. **Trade is emergent and priced, never chosen.** You do not sign trade deals. You build capacity and let the cost curve teach you that local production pays. The lesson lands because the bill arrives every tick.
4. **Modes have personalities.** Slow-and-huge ships, fast-and-tiny planes, capacious trains, ubiquitous trucks. Choosing among them is a real decision with a congestion side and a margin side.
5. **Through traffic is unfair on purpose.** Traffic you did not cause, using roads you must maintain, is what makes a bypass feel like an achievement rather than a chore.
6. **Connection scarcity differentiates maps.** Two maps with identical terrain but different edge kits play completely differently, and players read the connection list before they read anything else.

What is *not* essential to the feel: per-commodity weights, hotel-anchored tourist itineraries, airport landing caps, sewage export.

---

## Metropolis v1 adoption

Consistent with the binding decisions in `docs/UNKNOWNS.md` — statistical per-edge traffic flow with decorative vehicles, no per-agent pathfinding, ~1–2k buildings — and with the trade formula already sketched in `economy.md`.

**The data model**

An outside connection is a small record on the map, authored by the map (not the player, in v1):

- `id`, `mode` (`road` | `rail` | `power` | `water`), a boundary position, and the network node it attaches to.
- `capacity` — one number per connection, in the units of its mode (vehicles/tick for road and rail, MW for power, m³/tick for water).
- `enabled` — false until the player's network actually reaches it.

**Adopt directly**

- **Typed, discrete connections placed at the boundary.** Not "the whole edge is a highway." A handful of named points, each with a mode and a capacity, is both truer to CS2 and cheaper to simulate.
- **Every map ships with exactly one road connection enabled and a power connection available.** This is the CS2 opening and it works: the first five minutes require no thought about the edge at all.
- **Volume-scaled trade pricing.** Keep the formula already fixed in `economy.md`: `unitCost = base × (1 + k × volume / capacity)`, where `capacity` is the summed capacity of the connections that serve that commodity's mode. Add one refinement from the CS2 model — a **per-mode efficiency factor** so that rail trades at a lower `base` than road. That single multiplier is what makes building a rail connection feel like an economic upgrade rather than only a traffic fix.
- **Per-commodity base prices**, but only three or four commodities in v1 (goods, raw materials, and whatever `economy.md`'s resource list settles on). No weight term — fold weight into the base price.
- **Freight as flow, not vehicles.** Import/export volume becomes load on the road edges between the connection and the consuming districts, exactly like any other flow in the statistical model. Congestion at the connection is then an emergent, visible thing without a single agent existing.
- **Through traffic.** A constant-plus-city-scaled flow injected between each pair of enabled road connections, routed on the statistical model, contributing to congestion and to nothing else. Cheap to implement, immediately legible, and it makes the highway feel like it belongs to a region.
- **Movers-in arrive over a connection, at a capped absolute rate.** Copy the CS2 cap: a fixed maximum households per tick, independent of city size, gated on available housing. This is a growth-pacing tool as much as a simulation detail.
- **A trade panel** listing, per commodity, net import/export volume and the money flowing each way, plus per-connection utilization as a fraction of capacity. Utilization is the readout that teaches the whole system.

**Simplify for v1**

- **Four modes only: road, rail, power, water.** No ships, no air. Ships need water routing; air needs an airport and a route model, and both are content-shaped rather than mechanic-shaped.
- **No commuters.** Jobs are filled by residents only, which keeps the demand loop in `demand-growth.md` closed and honest. Outside commuters are a genuinely good mechanic but they decouple job vacancy from residential demand, and v1 needs that coupling tight.
- **No tourists.** Tourism needs attractiveness, landmarks, and hotels — none of which exist yet.
- **Capacity is soft, never hard.** Exceeding a connection's capacity raises trade cost steeply and congests the attached road edges; it never blocks the trade outright. Hard failure at the boundary is confusing when the player cannot see the queue.
- **Water and power trade as a single scalar each**, priced with the same volume curve, with a per-connection MW/m³ cap borrowed in spirit from CS2's transformer limit. Sewage export folds into the water connection.
- **Connections are map-authored and cannot be created by the player.** Building the network out to a connection's node is what enables it. Player-created connections (draw a road to the edge, get a new one) is a later feature.

**Explicitly rejected for v1**

Per-vehicle import trucks; hotel/leisure itineraries; airport landing caps; per-resource weight in the transport cost; per-connection route lists; the global vehicle cap (we have no vehicle budget to cap).

---

## Later path

Roughly in the order each stops being a nice-to-have:

1. **Player-created connections** — carry a road, track, or pipe to the boundary and a new connection registers itself. This is the moment the map edge becomes something the player *plans around* rather than inherits, and it is a small change on top of the v1 model.
2. **Cargo terminals** as buildings that attach a mode to the trade system, with the terminal itself holding the capacity and being the thing that jams. Turns "rail is cheaper" into "I built the rail freight yard in the wrong place."
3. **Commuters in and out** — outside workers filling vacancies, and residents taking jobs outside when local jobs are short. Requires the demand model to distinguish resident labour supply from job demand.
4. **Tourists**, once attractiveness and landmarks exist: arrival volume from attractiveness, mode split across available connections, spending that scales with how well transit moves them.
5. **Ship and air connections**, with their asymmetry preserved — ship routes player-buildable, air connections map-authored and scarce. The scarcity is the design, not a limitation to fix.
6. **Per-commodity transport weight**, so heavy resources genuinely want rail and ships. Only meaningful once there are enough commodities for the distinction to bite.
7. **Better through-traffic distribution** — weight the injected flow by each connection's road capacity rather than splitting evenly, which is precisely the fix CS1's community had to mod in.
8. **Regional trading partners with individual prices and finite appetites**, so that dumping one commodity crashes its price. This is the natural end state of the volume curve and the point at which the outside world stops being an infinite sink.
9. **Connection mix as an authored difficulty axis** in the map picker: show the edge kit alongside terrain and resources, and tune maps deliberately across it.

---

## Sources

- [Traffic — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Traffic)
- [Transportation — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Transportation)
- [Tourism — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Tourism)
- [Citizens — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Citizens)
- [Services — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Services)
- [Editor: Interface — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Editor:_Interface)
- [Paradox: CS II Feature Highlight #3 — Public & Cargo Transportation](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation)
- [Paradox: CS II Feature Highlight #6 — Electricity & Water](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/electricity-water)
- [Paradox: CS II Feature Highlight #9 — Economy & Production](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production)
- [Paradox forums: Add outside air connection in game](https://forum.paradoxplaza.com/forum/threads/add-outside-air-connection-in-game.1667759/)
- [Paradox forums: Outside Traffic Adjuster](https://forum.paradoxplaza.com/forum/threads/outside-traffic-adjuster.1875075/)
- [Paradox forums: Infinite external connections?](https://forum.paradoxplaza.com/forum/threads/infinite-external-connections.1607673/)
- [Paradox forums: Is tourism still bugged? How do I increase tourists visiting my city?](https://forum.paradoxplaza.com/forum/threads/is-tourism-still-bugged-how-do-i-increase-tourists-visiting-my-city.1713891/)
- [Paradox forums: Dealing with traffic into the city when expanding](https://forum.paradoxplaza.com/forum/threads/dealing-with-traffic-into-the-city-when-expanding.1693353/)
- [Steam discussion: About Outside Connections](https://steamcommunity.com/app/949230/discussions/0/3877095833482632634/)
- [Steam discussion: It looks like some cims come from outside to work](https://steamcommunity.com/app/949230/discussions/0/4031346899448200917/)
- [Steam discussion: Tons of traffic from outside connection](https://steamcommunity.com/app/949230/discussions/0/4511002214535734988/)
- [Steam discussion: Infinite Outside Connections? (kinda niche)](https://steamcommunity.com/app/949230/discussions/0/4339860800345924533/)
- [Steam discussion: How to add external connections for ships and planes in the editor](https://steamcommunity.com/app/949230/discussions/0/694248809816956863/)
- [Steam discussion: Cargo Traffic Jams](https://steamcommunity.com/app/949230/discussions/0/4202489789153796692/)
- [Steam discussion: How to fix traffic jams at cargo ports?](https://steamcommunity.com/app/949230/discussions/0/4286935452895383439/)
- [Steam discussion: Export water/electricity help](https://steamcommunity.com/app/949230/discussions/0/3937895062996262300/)
- [Steam discussion: Exporting water and electricity](https://steamcommunity.com/app/949230/discussions/0/3937895063005348277/)
- [Steam discussion: High resource costs — how do u solve that?](https://steamcommunity.com/app/949230/discussions/0/3937895062994748958/)
- [Steam discussion: Citizens moving In issue](https://steamcommunity.com/app/949230/discussions/0/4845399746428141878/)
- [Steam discussion: Cargo routes?](https://steamcommunity.com/app/949230/discussions/0/3951406749572915919/)
- [Steam guide: The Ultimate Traffic Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3281715600)
- [TheGamer: How to import and export in CS2](https://www.thegamer.com/cities-skylines-2-imports-exports-guide/)
- [TheGamer: How to get more tourists in CS2](https://www.thegamer.com/cities-skylines-2-how-to-increase-attract-tourism/)
- [TheGamer: How to set up a harbor in CS2](https://www.thegamer.com/cities-skylines-2-harbor-ships-set-up/)
- [TheGamer: Best starting maps in CS2](https://www.thegamer.com/cities-skylines-2-starting-maps-ranked/)
- [GamesRadar+: CS2 export guide](https://www.gamesradar.com/cities-skylines-2-export-guide/)
- [GameRant: How to import and export power and water](https://gamerant.com/cities-skylines-2-how-to-import-and-export-power-and-water/)
- [GameRant: The best starting maps](https://gamerant.com/cities-skylines-2-best-starting-maps-initial-layout/)
- [GameRant: Easiest maps for beginners, ranked](https://gamerant.com/cities-skylines-2-easiest-beginner-maps/)
- [VideoGamer: How to sell electricity and profit off power exports](https://www.videogamer.com/guides/cities-skylines-2-sell-electricity-export/)
- [PCGamesN: CS2 intercity trading is an absolute game changer](https://www.pcgamesn.com/cities-skylines-2/public-cargo-transport)
- [GameSkinny: How to export goods and services](https://www.gameskinny.com/tips/cities-skyline-2-how-to-export-goods-and-services/)
- [Chill Place Gaming: CS II supply chains — production, storage, transportation](https://chillplacegaming.com/supply-chain-cities-skylines-ii/)
- [eXputer: 5 best starting maps](https://exputer.com/guides/cities-skylines-2-best-starting-maps/)
- [The Nerd Stash: All starting maps ranked](https://thenerdstash.com/cities-skylines-2-all-starting-maps-ranked/)
- [TMPE issue #199: Dummy traffic only entering via one outside connection](https://github.com/CitiesSkylinesMods/TMPE/issues/199)
- [Thunderstore: Cities2Mods CityPlayerTrafficCustomMod](https://thunderstore.io/c/cities-skylines-ii/p/CityPlayer/Cities2Mods_CityPlayerTrafficCustomMod/)
- [Cities 2 Modding Wiki: ECS](https://wiki.ciim.dev/guides/ecs.html)
- [CS2 ECS Explorer](https://captain-of-coit.github.io/cs2-ecs-explorer/)
