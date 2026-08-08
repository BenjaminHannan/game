# Cities: Skylines II — Traffic and Per-Agent Pathfinding

Research notes on the traffic simulation and pathfinding model of *Cities: Skylines II* (Colossal Order / Paradox Interactive, October 2023), compiled to support an original reimplementation in *Metropolis*. Everything below is written in the researcher's own words; no game text, asset, or data file is reproduced. Numbers are facts about behavior, not expression, and each is tagged with a confidence marker.

**Methodology / confidence convention.** This environment blocks outbound page fetches for most of the relevant domains (the official wiki, Colossal Order's own site, Medium, PCGamesN, the ECS explorer). Almost everything here is synthesized from web-search result summaries across many queries, plus two pages that *were* fetchable directly (a traffic-light mod's guide and a pathfinding mod's README). Tags:

- **[Dev]** — attributed by sources to Colossal Order's own dev diary / feature highlight material. Highest confidence on intent, but the diary is prose, not a spec: it names components, rarely numbers.
- **[Wiki]** — attributed to the official Paradox wiki by search summaries; likely accurate, not independently read.
- **[Modder]** — derived from mod documentation or decompiled-source discussion. Strongest evidence for *internal structure*, because a mod that patches a field proves the field exists.
- **[Community]** — player forums, Steam discussions, guides. Reflects observed behavior at some patch version; treat as symptom reports, not spec.
- **[Inferred]** — my own reconstruction, clearly not sourced. Flagged inline.

---

## How CS2 does it

### 1. The headline claim: pathfinding is a cost minimization with four named components

CS2's traffic AI is built around a single idea the developers repeat constantly: every agent picks the route that minimizes a **pathfinding cost**, and that cost is assembled from four aspects — **Time, Comfort, Money, and Behavior** **[Dev]**.

- **Time** — the dominant term. All agents want to arrive sooner, so travel time along the candidate route (a function of distance, road speed limits, and expected congestion) forms the backbone of the cost **[Dev]**.
- **Comfort** — a smoothness/hassle term. Sources describe it as covering unnecessary turns at intersections, awkward maneuvers, how pleasant the route is, and crucially *how convenient the endpoint is*: finding a parking space or transit stop near the destination is a comfort factor folded directly into the path cost **[Dev]**.
- **Money** — out-of-pocket cost: fuel burned proportional to distance, parking fees (per-lot, per-building, and district-wide roadside fees), and transit ticket prices **[Dev]**. This is what makes transit fares an actual traffic lever rather than just a budget line.
- **Behavior** — willingness to break rules. U-turns, unsafe maneuvers, and intersection violations are *not forbidden*; they carry a large cost that some agents will pay when the legal alternative is bad enough **[Dev][Modder]**.

The four are not equal for everyone. Age cohort shifts the weights **[Dev]**:

| Cohort | Dominant weight | Observable consequence |
| --- | --- | --- |
| Teen | Money | Takes cheap/free parking and cheap transit even at a large walking penalty |
| Adult | Time | Takes the fastest route; parks wherever is quickest along it |
| Senior | Comfort | Parks close to the destination and eats the fee to do it |

This is the mechanism behind CS2's most-cited emergent story: raise a parking fee in a district and you sort *who* drives there by wealth and age, rather than uniformly reducing traffic **[Dev]**.

### 2. What the cost actually looks like internally

The strongest evidence about the real implementation comes from `CustomVehiclePathfind`, a BepInEx mod that patches the game's pre-computed cost constants. Its author states plainly that the game "finds an optimal path that minimizes the pathfinding cost" by summing per-move costs, and the mod exposes three multipliers **[Modder]**:

- `m_unsafe_punishment` — the penalty attached to rule-breaking moves (intersection violations, unsafe U-turns). The author suggests values above **1000** to make violations effectively impossible, which implies the vanilla constant is small enough that a few hundred meters of detour can outweigh it.
- `m_lane_punishment` — the penalty for a lane change. The author explicitly warns against raising it much, because lane changes are load-bearing for normal flow.
- `m_driving_punishment` — a general per-distance driving cost applied to personal cars only (cargo and service vehicles are exempt). Suggested tuning range **0.01–1.0** as a soft car-usage discouragement.

Taken together this reads as a graph search — Dijkstra/A\* over a lane-level graph — where **the edges are lane moves and the cost is a weighted sum of scalar terms**, including a distinct cost for driving a lane, for turning, for u-turning, for changing lanes, and for violating an intersection rule **[Modder]**. That granularity matters: the graph is not "roads," it's **lanes**, and choosing a lane is part of choosing a path, not a separate steering behavior.

**[Inferred]** A plausible reading of the numbers: costs are in a normalized "generalized cost" unit where time is converted at some value-of-time per cohort, money is converted at the inverse, and comfort/behavior are additive constants attached to specific move types. The mod's multipliers being unitless scalars is consistent with all four aspects sharing one accumulator.

### 3. Pathfinding is continuous, not one-shot

The single biggest architectural break from CS1: **paths are recomputed repeatedly during the trip, not fixed at spawn** **[Dev]**. Sources are explicit that pathfinding "is not made once when an agent starts moving but over and over again." Triggers include:

- an accident or blockage appearing on the planned route;
- a prolonged jam on the route (agents may then re-path *and* pay the unsafe-U-turn cost to escape it) **[Dev]**;
- network edits by the player — which is why community advice is to wait several in-game minutes after a road change before judging whether it helped, since in-flight vehicles are still carrying older plans **[Community]**.

Coupled to this: **there is no despawning**. CS1's infamous escape valve — vehicles that vanish when stuck too long — is gone, so a gridlock is permanent until the player fixes the geometry **[Dev][Community]**. This is a design decision with enormous downstream consequences: every modeling shortcut you take must not produce deadlock, because there is no garbage collector for stuck agents.

### 4. Lane selection and lane math

CS2 assigns lane connections at nodes automatically; there is no vanilla lane-connector UI (a mod, `Traffic` by krzychu124, adds one) **[Community]**. Vanilla behavior as reported by players:

- Vehicles decide which lane they need **one node before** the maneuver **[Community]**. If a highway exit's node sits close to the previous node, cars have almost no runway and perform violent multi-lane merges immediately before the exit.
- The most-reported failure mode at launch was **late lane changes**: a car in the second-from-right lane of a four-lane road crossing two lanes at the last moment, or every incoming vehicle converging on a single center lane and creating a self-inflicted bottleneck on an otherwise wide road **[Community]**. Players called it the number-one traffic complaint.
- The community's countermeasure is "lane mathematics" imported from CS1: keep lane counts balanced across a junction (3 lanes plus a merging lane equals 4 outgoing), and space nodes far apart so a car's one-node lookahead spans real distance **[Community]**.
- Vehicles do change lanes reactively as well as for routing: to get around a fully blocked lane (accident, stopped ambulance, jam) and to make room for emergency vehicles where possible **[Dev]**.

Colossal Order eventually addressed this directly. Patch **1.5.9f1** ("Morning Dew," May 2026) changed lane-selection logic so vehicles pick their turn lane **earlier** on approach to exits and intersections, and **significantly raised the U-turn cost** in the route calculation to cut unsafe and illegal U-turns **[Community/patch coverage]**. That the fix was framed as *retuning cost constants and lookahead distance* — not rewriting the model — is a useful signal about where the levers are.

### 5. Parking as a real constraint

Parking is treated as one of the pillars of the pathfinding system rather than decoration **[Dev]**.

- A car trip is not "drive to destination." It is **drive → find a parking slot → walk the remainder**. The parking slot is chosen as part of the same cost minimization, so slot availability, walking distance from slot to destination, and slot price all enter the route cost **[Dev]**.
- Supply comes from three places: dedicated parking lots, parking built into buildings/garages, and **roadside parking lanes** on road types that have them **[Dev][Wiki]**.
- Pricing is a player lever at two levels: a per-lot/per-building fee, and a **district-wide roadside parking fee policy** set through the Areas tool with an adjustable exact value **[Community]**. Low fees make everyone park close; high fees sort by cohort, pushing teens (money-weighted) into longer walks while seniors (comfort-weighted) still pay to park at the door **[Dev]**.
- Observed pathologies: cims strongly favoring roadside parking over lots, and long walks after parking that look absurd to players (parking then walking on the order of a kilometer home) **[Community]**. Modest fees were reported as revenue-generating rather than behavior-changing **[Community]** — evidence that in practice the money term was weighted low relative to the comfort/time gain from a nearby slot.

### 6. Intersections and traffic lights

- Junction control is **automatic by default and player-overridable**: the game places traffic lights on higher-volume junctions and yields/stops on lower ones, and removing a light from a junction leaves priority signage favoring the denser road **[Community]**.
- Vanilla signals run a small fixed phase repertoire — described from the outside as protected-straight, protected-turn-in-one-direction, and permissive-turn-in-the-other, mirrored for left/right-hand traffic **[Modder]**.
- Vanilla lights are **adaptive in duration**: they extend the green phase while traffic is still flowing through it **[Modder]**. Pedestrian signals are *not* adaptive and do not extend **[Modder]**. There is no dedicated all-stop pedestrian phase in vanilla (a mod adds one) **[Modder]**.
- **Roundabouts** are not a special entity — they are ordinary geometry with yield priority. Entering vehicles generally give way to circulating ones but will accept a gap and cut in when one appears **[Community]**. The classic roundabout failure is a vehicle stopping *inside* the circle because its exit is blocked, which is why players avoid zoning directly onto roundabouts **[Community]**.
- Emergency vehicles are **not** given global right of way: they queue in traffic and stop at reds, relying only on neighbors' opportunistic lane-yielding **[Community]**. Accidents therefore compound — the responder is stuck in the jam it is meant to clear.
- Pedestrians are agents in the same simulation and can obstruct vehicles; jaywalking into the roadway causing vehicle stalls was common enough that a mod exists purely to make pedestrians prefer safe crossings **[Community]**.

### 7. How jams emerge, and how they dissolve

The car-following layer is a continuous local model, not a queue: agents "take into account nearby agents at all times" and make repeated micro-decisions — accelerate with the flow, brake, yield to oncoming traffic while turning, change lanes to optimize flow **[Dev]**. Jams therefore emerge the way real ones do, from local capacity violations, not from a congestion formula.

Documented seeds of a jam:

1. **Lane misallocation** — everyone converging into one lane because of the one-node lookahead, so a 4-lane road delivers 1-lane throughput **[Community]**.
2. **Accidents** — probability rises with poor road condition; the crash blocks lanes until responders clear it, and responders are themselves stuck in traffic **[Community/Wiki]**.
3. **Degraded surfaces and snow** — bad road condition lowers effective travel speed, which both slows throughput and shifts route costs; a Road Maintenance Depot dispatches trucks (reported around **10** per depot, upgradeable to **15**) to restore it **[Wiki/Community]**.
4. **Intersection blocking** — a vehicle entering a junction it cannot clear, especially on roundabouts **[Community]**.
5. **Parking search** — vehicles circulating for slots add volume that has no destination flow.

Dissolution paths: the adaptive green extends and drains the queue; agents re-path away from the persistent jam once it exceeds their tolerance, sometimes paying the U-turn/unsafe cost to do so **[Dev]**; the accident is cleared. With no despawn, if none of those fire, the jam is terminal until the player edits the network **[Community]**.

Player-facing readouts are two overlays: a **traffic infoview** shading roads green→red by *flow quality*, and a **traffic volume** legend showing vehicle counts over the day, which visibly peaks at rush hours **[Wiki]**.

### 8. Performance: the model is expensive and the game cheats

CS2's simulation speed is widely reported to correlate directly with the number of pending pathfinding queries — pathfinding is the acknowledged bottleneck **[Community]**. Colossal Order's answer was Unity DOTS/ECS with jobs across all cores **[Dev]**, plus a game-level **traffic reduction coefficient**: the vanilla simulation deliberately culls and generalizes vehicles rather than instantiating a car for every traveling cim. The `Traffic Simulation Adjuster` mod exposes this as a 0–10 slider where **4 is the shipped default**, **0** disables all culling/generalization (one real car per traveling cim, at severe performance cost), and **10** removes vehicle traffic almost entirely **[Modder]**.

This is the most important structural fact in this document for our purposes: **even CS2, the game whose headline feature is per-agent traffic, does not simulate every agent's car.** The "every cim is an agent" promise is delivered through a tuned mixture of real vehicles and statistical abstraction. The visible traffic is a *sample*.

---

## What makes it feel like CS2

Strip away the implementation and the feel comes from a handful of properties. These are what Metropolis must reproduce, by whatever means.

1. **Routes are chosen by a cost, and the player can see the cost's terms.** Speed limits, tolls, fares, and parking fees are all levers on the same number. The player's mental model is "I made that route cheaper," not "I raised a slider."
2. **Different people make different choices.** Heterogeneous weights are what turn a fee into a sorting mechanism instead of a volume dial. A city where every agent optimizes identically feels mechanical; the moment two cohorts diverge, the city feels populated.
3. **Traffic responds to edits, but with lag.** You change a road, nothing happens for a beat, then the pattern shifts. That delay is not a bug — it is what makes the network feel like it has momentum.
4. **Jams are legible and local.** Red appears at a specific junction, and the cause is visible when you zoom in. The player's job is diagnosis, and the game must reward looking closely.
5. **Congestion is not self-clearing.** Without a despawn escape valve, a bad design stays bad. Consequence is the whole tension of the genre.
6. **The last hundred meters count.** Parking and walking make a destination's *accessibility* differ from its *reachability*. This is the single most distinctive CS2 traffic idea and the one most worth stealing.
7. **Geometry is the gameplay.** Node spacing, lane counts, junction type. The player builds shapes; the simulation grades them.

---

## Metropolis v1 adoption

Binding constraint from `docs/UNKNOWNS.md`: the v1 traffic model is **statistical flow per road edge plus lightweight visual vehicles**, with per-vehicle agent pathfinding explicitly deferred. Everything below respects that.

**Adopt now:**

- **A generalized-cost edge weight, structured exactly like CS2's four terms.** Even in an aggregate model, weight each directed road edge as `cost = w_time·t(edge) + w_money·m(edge) + w_comfort·c(edge)`, where `t` is length ÷ effective speed, `m` is fuel-proportional distance plus any toll/fee, and `c` is a small constant penalty for unpleasant edges. Keep the four names in the code even if `behavior` is a stub in v1 — the vocabulary is the design.
- **Turn costs at nodes, not just edge costs.** Model the node as a small set of turn movements with per-turn penalties (straight cheapest, turn-across-traffic dearest, U-turn very dear). This is cheap in an aggregate model and is where most of CS2's intersection character actually lives.
- **Cohort weights, minimum two.** Run the assignment once per cohort with different `w_*` vectors (money-sensitive vs. time-sensitive is enough for v1) and sum the flows. This is what makes fees and fares behave interestingly instead of linearly.
- **Iterative equilibrium assignment with a congestion function.** Compute shortest paths on current costs, load trips onto edges, recompute effective speed from a volume/capacity curve, repeat 3–5 iterations with damping (method of successive averages). This reproduces "jams emerge, then traffic reroutes around them" without a single agent. Cap each iteration's flow shift so the network visibly settles over a few seconds of game time rather than snapping — that lag *is* feature 3 above.
- **Parking as an edge-level pressure term, not a search.** Give each zone cell a parking supply (derived from adjacent road type's parking lanes plus any parking building) and a demand from trips ending there. When demand exceeds supply, add a penalty to the destination's arrival cost — representing search circulation and the walk — and add a small phantom flow to the surrounding edges. Player-set parking fees feed the money term. This delivers the "last hundred meters count" feel at a fraction of the cost.
- **Congestion drives the visual vehicle density.** Spawn instanced meshes proportional to edge flow, with speed set by the edge's congested speed. This is exactly CS2's own trick (the traffic reduction coefficient) taken to its logical end. Expose the spawn density as a graphics setting.
- **Two overlays, matching CS2's split:** flow quality (green→red) and raw volume. Cheap to compute from data we already have; enormous for legibility.

**Deliberately simplify or defer:**

- No lane graph. Edges carry a lane *count* that scales capacity; lane selection, lane-change costs, and lane math are out of scope for v1.
- No signal phase simulation. Represent a junction's control type (uncontrolled / yield / signal) as a fixed capacity multiplier and added turn delay per movement. A signal cuts through-capacity and adds delay; a yield does so asymmetrically by priority.
- No accidents, no road wear, no emergency-vehicle behavior.
- No per-agent re-pathing mid-trip — the iterative assignment is the aggregate equivalent.
- No pedestrian agents in the roadway.

**One anti-goal to encode explicitly:** because our flow model can't deadlock, we lose CS2's "gridlock is permanent" consequence for free. Recover it deliberately — the volume/capacity curve must be steep enough that an over-capacity edge becomes genuinely, visibly, punitively slow and stays that way until the player intervenes. A gentle curve will make the whole system feel weightless.

---

## Later path

What full CS2 fidelity would actually require, roughly in the order it would have to be built:

1. **A lane-level graph.** Every road segment expands into directed lanes; nodes expand into lane-to-lane connection edges with per-connection costs. This is the foundation for everything else and is a substantial data-model change from edge-level flow — expect it to touch the road builder, since node spacing and lane-connection generation become gameplay-visible.
2. **Real agents with trip state.** Citizens own trips; trips own a current path and a position along a lane. Requires a scheduling/activity model upstream (who is going where, when) that v1 doesn't have.
3. **A car-following and lane-change model.** Continuous longitudinal control (something in the IDM family) plus a lane-change decision rule with both routing-driven and opportunity-driven changes. This is where "jams emerge from local behavior" comes from, and it is also where all the performance goes.
4. **Lookahead tuning.** CS2's whole launch controversy was a lookahead that was too short. Budget for making lane-selection lookahead a *distance* (multiple nodes ahead, or a fixed metric distance), and expect to spend real time tuning it.
5. **Parking search as a genuine sub-path.** Drive-to-area, then a search phase over candidate slots weighted by price and walking distance, then a walk leg. Needs a pedestrian network to land on.
6. **Signal phases with adaptive green.** Per-node phase groups, per-phase movement permissions, and green extension while a movement is still discharging. Then priority rules (yield, stop, roundabout gap acceptance) as a separate conflict-resolution layer.
7. **Incremental re-pathing under a query budget.** Agents re-path on events and on jam tolerance, but the number of path queries per tick is capped and prioritized — this budget, not the agent count, is the real performance dial.
8. **A deliberate abstraction ladder.** Copy CS2's coefficient idea from the start: a knob from "every trip is a vehicle" to "only sampled vehicles render, the rest is flow," so the same city runs on weak and strong hardware. Given Metropolis is browser-targeted, we would likely ship the ladder's *middle* as default and treat full per-agent as the enthusiast setting.
9. **Web-specific constraint:** all of the above must run inside a single-threaded-by-default JS runtime. Realistically this means moving pathfinding into a worker with a typed-array graph and shipping results back, or accepting that the per-agent tier never leaves the desktop build.

---

## Sources

- [Development Diary #2: Traffic AI — Colossal Order](https://colossalorder.fi/?p=1597) (egress-blocked; content reached via search summaries)
- [Cities: Skylines II Feature Highlight #2: Traffic AI — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai)
- [Development Diary #2: Traffic AI — Paradox Forums thread](https://forum.paradoxplaza.com/forum/developer-diary/development-diary-2-traffic-ai.1591141/page-8)
- [Traffic — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Traffic) (egress-blocked; via search summaries)
- [Roads — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Roads)
- [Transportation — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Transportation)
- [Patch 1.5.X — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Patch_1.5.X)
- [CustomVehiclePathfind mod — GitHub (Jimmyokok)](https://github.com/Jimmyokok/CustomVehiclePathfind) — source of the cost-multiplier field names
- [CustomVehiclePathfind — Thunderstore](https://thunderstore.io/c/cities-skylines-ii/p/Jimmyok/CustomVehiclePathfind/)
- [Traffic Lights Enhancement — GUIDE.md (slyh)](https://github.com/slyh/Cities2-TrafficLightsEnhancement/blob/master/GUIDE.md) — source of vanilla signal phase/adaptive-green details
- [Traffic Lights Enhancement — Thunderstore](https://thunderstore.io/c/cities-skylines-ii/p/slyh/Traffic_Lights_Enhancement_Alpha/)
- [Traffic mod (lane connector) — GitHub (krzychu124)](https://github.com/krzychu124/Traffic)
- [Traffic Simulation Adjuster — Paradox Mods](https://mods.paradoxplaza.com/mods/76836/Windows)
- [Crucial new Cities Skylines 2 mods transform the simulation and the whole traffic system — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/simulation-traffic-mods) — traffic reduction coefficient scale
- [A new Cities Skylines 2 update makes traffic "smoother and less rage-inducing" — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/update-morning-dew) — patch 1.5.9f1 lane/U-turn changes
- [Cities Skylines 2 Patch 1.5.9f1 Improves Traffic — TwistedVoxel](https://twistedvoxel.com/cities-skylines-2-patch-1-5-9f1-adds-traffic-ui-and-shadow-fixes/)
- [Cities Skylines 2 parking lots will really get your traffic flowing — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/traffic-update)
- [Cities: Skylines 2 drivers will use car parks, navigate complex paths and crash everywhere — Stealth Optional](https://stealthoptional.com/article/cities-skylines-2-drivers-will-use-car-parks-navigate-complex-paths-and-crash-everywhere)
- [Lane switching is a nightmare — Steam Community](https://steamcommunity.com/app/949230/discussions/0/4031347296568268778/) — one-node lookahead reports
- [My citizens' addiction to parking on the side of the road — Steam Community](https://steamcommunity.com/app/949230/discussions/0/3951406499783634533/)
- [A Technical Explanation for Low Simulation Speed — Steam Community](https://steamcommunity.com/app/949230/discussions/0/4031347929700006128/)
- [Why Cities: Skylines 2 performs poorly — paavohtl's blog](https://blog.paavo.me/cities-skylines-2-performance/) (egress-blocked; via search summaries)
- [Cities: Skylines 2 ECS Explorer — Captain of Coit](https://captain-of-coit.github.io/cs2-ecs-explorer/) (egress-blocked; useful for a future pass with network access)
- [Better Pedestrian Pathfind — Nexus Mods](https://www.nexusmods.com/citiesskylines2/mods/91)
- [New Cities Skylines 2 mod stops jaywalking pedestrians causing traffic — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/fix-pedestrians-mod)
- [How to manage Cities Skylines 2 traffic — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/traffic)
- [Advanced Traffic Management — Chill Place Gaming](https://chillplacegaming.com/advanced-traffic-management-cities-skylines-ii/)
- [How To Fix Road Conditions In Cities: Skylines 2 — GameRant](https://gamerant.com/cities-skylines-2-how-fix-road-conditions-guide/)
- [How to Prevent Road Accidents in Cities: Skylines 2 — GameRant](https://gamerant.com/cities-skylines-2-how-prevent-fix-road-accidents/)
- [Cities Skylines 2 policies — VideoGamer](https://www.videogamer.com/guides/cities-skylines-2-policies/) — roadside parking fee district policy
