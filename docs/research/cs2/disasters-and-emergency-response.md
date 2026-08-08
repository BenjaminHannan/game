# Cities: Skylines II — Disasters and Emergency Response

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) handles natural hazards, the fire and rescue service, early warning and evacuation, damaged/destroyed building states, and the way a citywide shock ripples through services, the economy and demand before the city recovers. Compiled to inform an original implementation in *Metropolis*. Written entirely in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains here (the official CS2 wiki included — a direct fetch was refused), so the material below comes from targeted web searches whose results are synthesized summaries of one or more pages: the official wiki, Paradox feature-highlight pages and bug-report forums, Steam discussions, and guide sites. Every claim carries a tag:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`). Likely accurate, not independently verified.
- **[Dev]** — Colossal Order / Paradox marketing or dev material (feature highlight pages, press coverage of them), or a developer response in a bug thread.
- **[Guide]** — guide-site coverage (PCGamesN, TheGamer, GameRant, VideoGamer, and similar). Usually correct on the broad strokes, patch-specific on details.
- **[Community]** — Steam discussions, forum threads, player testing. May be patch-specific or personal.
- **[CS1]** — a mechanic from *Cities: Skylines 1* (mostly its Natural Disasters expansion), included as contrast. **Do not assume it holds in CS2** — several of these were deliberately changed.
- **[Inferred]** — my reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree.

Sister docs: `services-social.md` (the fire station as a coverage service, and the coverage flood this doc leans on), `services-utilities.md`, `environment.md` (weather/seasons, which gate hazard spawn, and which explicitly rejects disasters for v1), `progression.md` (development trees), `economy.md`, `demand-growth.md`, `ux-conventions.md` (notification and info-view conventions).

---

## How CS2 does it

### 1. Disasters are base-game, small in number, and optional

CS1 sold disasters as a paid expansion. CS2 ships them in the base game but with a deliberately short list: **forest fire, hail storm, tornado** **[Guide]/[Community]**. The pre-release framing was that the sequel would be "deadlier" than the original at launch **[Dev]**, but community expectation-setting threads make the ceiling clear: no tsunami, no earthquake, no meteor, no flood, no sinkhole, and no man-made incidents (derailments, plane crashes, riots) — all of which players repeatedly request **[Community]**.

Distinct from those three, and present regardless of the disaster setting, is the ordinary **building fire** — a per-building hazard rather than a weather event, handled by the same Fire & Rescue service **[Wiki]/[Guide]**.

**The whole layer is a toggle.** Natural disasters are a checkbox in the map/game options, set when starting a new game — and, importantly, editable from the load-game screen *before* loading an existing save. Once a session is running there is no in-game options entry to change it **[Community]**. There is no reported severity or frequency slider: it is on or off **[Community]**, which tells you Colossal Order treats disasters as a flavour layer some players will simply not want, not as a difficulty axis **[Inferred]**.

### 2. Hazard types, spawn conditions, severity

**Forest fire.** Can trigger any time, but likelihood rises in the warm, dry part of the year when vegetation is driest **[Guide]** — i.e. spawn probability is modulated by the season/weather model documented in `environment.md`. It starts in vegetation and **spreads**: from tree to tree, then from the treeline into whatever buildings adjoin it, with a smoke plume drifting off the front **[Guide]**. Left alone it is the one hazard that grows without bound, so its danger is a function of how much unbroken forest sits against the city edge **[Inferred]**. Notably, forest fire is the one event that does **not** trigger citizen evacuation **[Community]** — treated as a property-damage event rather than a life-safety one.

**Hail storm.** Conditioned on temperature — reported as occurring when the temperature sits just above freezing **[Guide]**. Effects are diffuse rather than a moving point of destruction: buildings across the affected area take damage, and roads become chaotic, with a spike in traffic accidents **[Guide]**.

**Tornado.** A moving vortex that damages or outright destroys what it passes over, kills or injures citizens caught in the open, and leaves a trail of traffic accidents **[Guide]**. Consensus across guides is that it is the deadliest and most expensive event in the game **[Guide]**. Its damage geometry is a swept path rather than a radius, which is why shelter placement matters more than for the other two **[Inferred]**.

**Building fire.** Ordinary structure fires arise per building from a **fire hazard** value. Sources are explicit that fire hazard is *reduced* by having a fire station whose service area covers the building — framed as safety supervision, i.e. prevention rather than response **[Wiki]/[Guide]**. Conversely, absence of fire coverage raises it **[Guide]**. What else feeds hazard (building age, type, density, wealth) is not documented in anything reachable **[Inferred: unknown]**. Fires spread building-to-building if not suppressed **[Community]**.

**No sub-events.** CS2 has nothing like CS1's structure-collapse-from-neglect, sinkhole, or thunderstorm-lightning-strike **[CS1]**.

### 3. Detection, warning phases, and the buildings that provide them

CS2's warning layer has three tiers, all unlocked through the **Fire & Rescue development tree** (see `progression.md`); the tree itself opens at roughly the "large village" city-size milestone, and the basic fire house is its free root node **[Guide]**.

| Building | Development points | Role |
| --- | --- | --- |
| Fire house | free (tree root) | Response only; suppresses fires once started |
| Firewatch Tower | 1 | Forest-fire *prevention* + early detection |
| Fire Station | 2 | Response plus hazard reduction; upgradeable |
| Firefighting Helicopter Depot | 2 | Aerial suppression, reaches roadless terrain |
| Small Emergency Shelter | 1 | Shelter capacity |
| Large Emergency Shelter | 4 | Shelter capacity |
| Early Disaster Warning System | 8 | Citywide advance detection of incoming disasters |

(Point costs **[Guide]**; the tree membership is consistent across several guide sources.)

**Firewatch Tower** is the most interesting design object here. Reported behaviour: it *lowers the chance* of a forest fire starting within roughly a kilometre of itself, and alerts firefighters immediately if one starts anyway. It needs no water, no electricity and no road connection, and it cannot itself catch fire **[Wiki]/[Guide]**. So it is a pure field emitter with no infrastructure dependencies — a building you scatter across wilderness without dragging a network out to it. That constraint-free placement is what makes it usable at all, since the terrain it must cover is by definition the terrain the city has not developed **[Inferred]**.

**Firefighting Helicopter Depot** exists specifically to reach places fire trucks cannot: it dispatches aerial units against both wildfires and structure fires where road access is missing or blocked **[Wiki]/[Guide]**. This is the game acknowledging that its whole response model is road-dependent and providing one escape hatch.

**Early Disaster Warning System** is the top of the tree at 8 points and is priced as a landmark commitment: reported around **2.4 million** to build with upkeep reported as high as **216,000** per month **[Guide]** — extraordinary numbers by CS2 service standards, and clearly intended as a late-city purchase. What it buys is **lead time**: it spots an approaching disaster earlier, and that earlier notice is what lets citizens actually reach shelters before impact and lets buildings be prepared **[Wiki]/[Guide]**.

The warning itself surfaces two ways: as a player-facing **notification** (guides describe radio-style alerts of an incoming disaster), and as an implicit signal to the citizen simulation to start moving toward shelter **[Guide]**.

### 4. Evacuation: automatic, not commanded

This is the sharpest CS1 → CS2 change, and the one most worth understanding.

In CS1, evacuation was a **player action**: you placed shelters, wired up dedicated evacuation bus routes, made sure radio towers existed to broadcast, kept the shelters stocked with water, power and food, and then *pressed the evacuate button*, which sounded sirens and sent everyone running **[CS1]**.

In CS2 there is **no evacuation button**, and a Paradox forum report asking for one was closed as **"As Designed"** **[Dev]/[Community]**. Citizens head to shelters on their own when the warning goes out; if they do not make it, they are exposed **[Community]**. The player's whole influence on evacuation is therefore *pre-disaster*: how much shelter capacity exists, where it sits relative to population, and how much warning lead time was bought.

Reported CS2 evacuation details:

- **Two shelter sizes**, small and large, meant to be scattered so that every citizen has one within reach **[Guide]**. (Capacity figures circulating as "1,000 / 10,000 people, 5 / 10 evacuation buses" come from CS1 sources and should be treated as **[CS1]**, not confirmed CS2 numbers **[Conflict]**.)
- **Evacuation buses** exist in CS2 and route by **population density, prioritising schools, medical clinics and hospitals** **[Guide]** — i.e. the game preferentially collects the people least able to self-evacuate.
- **Shelters need water and power to operate during the event** **[Community]** — so a shelter is only as good as the utility network feeding it, and a shelter that loses its supply mid-disaster is dead weight.
- **Forest fires do not evacuate** at all **[Community]**.
- Community sentiment is that shelters are marginal in practice — there are threads openly asking whether they have any use — which suggests either the hazard is not lethal enough to justify the spend or the automatic behaviour is too opaque to read **[Community]**.

### 5. Damaged, destroyed, and rebuilt: the building state machine

The observable states, assembled across sources **[Guide]/[Community]**:

1. **Intact.**
2. **Damaged** — hit but standing. The building is non-functional or degraded and must be **repaired for money**. Repair is an explicit paid action, not free time-based healing **[Guide]**.
3. **Destroyed / collapsed** — reduced to rubble. Rubble occupies the lot and blocks anything new until cleared.
4. **Cleared lot** — either the player bulldozes, or the Disaster Response Unit clears it.
5. **Rebuilt** — some buildings offer a direct **rebuild** action (select the building, rebuild, confirm); where the option is absent the only path is demolition and starting over **[Community]**.

**The Disaster Response Unit** is a **fire station upgrade**, unlocked through the Fire & Rescue tree. With it active, fire engines search collapsed buildings for survivors and then make the lots ready for rebuilding **[Wiki]/[Guide]/[Community]**. There is a **Fast Recovery** option that skips the survivor search entirely and only prepares the lots, trading lives for recovery speed **[Guide]** — a genuinely good bit of design: an explicit, legible moral/economic dial rather than a stat buff.

**Known rough edges** worth knowing before copying the model: specialised-industry buildings with sub-buildings were confirmed by Paradox not to rebuild their sub-buildings after a disaster **[Dev]**, and players report no way to repair a single damaged component inside an industry area — the whole plant must go **[Community]**. Some farm objects show a weather-destroyed state whose only remedy is relocation **[Community]**. The lesson: a composite building needs its damage state defined at the *component* level from the start, or the repair affordance has nowhere to attach **[Inferred]**.

Fire response has its own reported weaknesses: fires spreading to neighbours despite nearby stations, and trucks dispatching slowly — the latter apparently intentional, since watchtower descriptions frame themselves as compensating for it **[Community]**.

### 6. How the shock propagates

CS2's disasters are not scored as a one-off money hit; the damage transmits through the existing systems. Reported and inferred chains:

- **Direct → services.** Damage to buildings and citizens "burdens healthcare, deathcare and rescue services" and disrupts whatever company or service occupied the damaged building **[Guide]**. So a destroyed clinic subtracts healthcare capacity at the exact moment healthcare demand spikes — the shock is correlated with the loss of the means to absorb it **[Inferred]**.
- **Roads → response.** Disasters cause traffic accidents and jams; jams delay emergency vehicles; delayed vehicles mean more damage **[Guide]**. Damaged roads directly impede aid workers, containing less damage and slowing economic recovery **[Guide]**. This is the game's main positive feedback loop, and it is entirely mediated by the road network rather than by a "disaster severity" number.
- **Utilities → shelters and everything else.** Shelters need power and water to function **[Community]**; by extension a destroyed substation or pump cascades into whichever districts it fed **[Inferred]**.
- **Services → happiness → demand.** Guides connect disaster preparation to citizen happiness explicitly **[Guide]**. Since happiness drives residential demand and land value in CS2's normal loop (see `demand-growth.md`), a disaster degrades demand indirectly, through wellbeing, rather than via a bespoke penalty **[Inferred]**.
- **Economy → recovery capacity.** Repair costs are per-building and stack; guides warn cities can be pushed to bankruptcy simply restoring what they had, and the standard advice is to hold a cash reserve *specifically* so recovery can start immediately **[Guide]**. Players who cannot afford repairs bulldoze instead and let the zones regrow from nothing, which is cheaper up front but loses the buildings' accumulated level and occupancy **[Community]/[Inferred]**.

The design intent this adds up to: a disaster is a **capacity shock plus a liquidity test**, not a damage number. The interesting decisions are all made months earlier — shelter siting, cash buffer, redundant utilities, road slack for emergency vehicles.

### 7. Presentation

- A **fire hazard info view** tints both buildings and trees on a green→red ramp showing current hazard **[Wiki]** — the same overlay grammar as every other CS2 service (see `ux-conventions.md`), and notably it covers *vegetation*, not just buildings.
- Warnings arrive as notifications/alerts; guides describe radio-style announcements of an approaching disaster **[Guide]**.
- Destroyed and damaged buildings carry state icons that expose the available action (repair, rebuild, relocate) **[Community]**.

---

## What makes it feel like CS2

Stripping the specifics, the flavour comes from a handful of choices:

1. **Prevention is a placed building with a field, not a stat.** Firewatch Tower and Fire Station both *lower the probability* of the bad thing, spatially. You buy safety by covering ground, in the same idiom as every other service.
2. **Warning time is a purchasable resource.** The Early Disaster Warning System does not stop anything; it buys minutes. Pricing lead time as a very expensive late building is what makes the disaster layer feel like infrastructure rather than a slot machine.
3. **The player never presses the panic button.** CS2 deliberately removed the manual evacuation order. Your agency is entirely in the preparation, which is thematically strong and mechanically much simpler.
4. **The road network is the transmission medium.** Damage hurts because it degrades access, and degraded access amplifies damage. Nothing about the disaster bypasses the systems the city already runs on.
5. **Recovery costs real money and real time, per building.** The disaster's teeth are in the repair bill, not the destruction animation.
6. **An explicit ugly trade-off exists** — Fast Recovery: skip the search for survivors, get the city back faster.
7. **The whole layer is optional**, and the toggle lives at map-selection time. Disasters are framed as texture, not as the difficulty curve.
8. **Hazard is visible as an overlay before anything happens**, including on trees, so the player can read risk on the map.

---

## Metropolis v1 adoption

**Position: no disaster events in v1.** `environment.md` already rejects hailstorms and natural disasters for the first milestone, and that stands — v1 has no citizen agents, no per-vehicle dispatch, and no building-level economy deep enough for a shock to propagate through. Simulating a tornado we cannot respond to would be a screensaver with a bill attached.

What v1 *should* do is leave the layer attachable, at near-zero cost.

**Adopt directly (v1)**

- **A `damage: number` field (0 = intact, 1 = destroyed) on every building**, plus a derived state enum `intact | damaged | destroyed | cleared`. Nothing writes it in v1 except the bulldozer. Adding the field now is free; retrofitting it into the building record, the renderer, and the economy later is not.
- **Damaged buildings do not produce.** One rule, wired in v1 even though nothing triggers it: a building with `damage > 0` contributes proportionally less to jobs, output, tax and service capacity. This is the single hook that makes every future hazard propagate correctly without touching those systems again.
- **Fire hazard as a per-building scalar derived from fire coverage** — `hazard = f(1 - fireCoverage)`. `services-social.md` already computes a fire coverage value per road edge; deriving a hazard number from it costs one line and immediately earns a **fire hazard info view** on the existing overlay machinery (green→red on buildings). Prevention-as-coverage is the signature feel and we get it for free.
- **Tint vegetation in that overlay too**, if trees exist as instanced props by then. It is the detail that makes the view read as CS2's.

**Deliberately deferred, but designed for**

- Reserve a `HazardEvent` shape in the design now — `{ kind, epicenter, path|radius, startTick, duration, severity }` — so the eventual implementation has an agreed vocabulary. Do not build the system.
- Keep the Fire & Rescue progression tree's later nodes (watchtower, helicopter depot, shelters, warning system) as **named placeholders** in `progression.md`'s tree, greyed out. A visible locked branch communicates ambition and costs nothing.

**Explicitly rejected for v1**

Any hazard spawn logic; forest-fire spread over vegetation; evacuation, shelters, or citizen movement under threat (we have no citizen agents to move); evacuation buses; the Early Disaster Warning System; the Disaster Response Unit and survivor search; per-building repair economics and the repair UI; rubble meshes and destroyed-building art; traffic accidents; disaster notifications; the disasters on/off toggle (nothing to toggle).

---

## Later path

Roughly in the order each becomes affordable:

1. **Building fires, statistically.** The first real hazard, and the cheapest: per building per tick, ignition probability proportional to `hazard`. A burning building's damage climbs; fire coverage on its frontage edge sets the suppression rate. No trucks required — this works entirely in the statistical-flow world v1 already lives in. Spread to adjacent buildings once the visual sells it.
2. **Damage, repair, and the repair bill.** Expose a repair action with a cost proportional to remaining damage; destroyed buildings leave a blocked lot until bulldozed. This is where the disaster layer starts to have teeth, and it requires only money and UI.
3. **Forest fire.** Needs vegetation to exist as a simulated field rather than decoration: a per-cell fuel/burning raster on the same coarse grid `environment.md` already specifies for pollution, seasonal ignition probability from the temperature scalar, spread by cellular automaton, and ignition of buildings whose lots touch a burning cell. Firewatch Tower and Helicopter Depot land here as multipliers on ignition and suppression.
4. **Hail storm.** An area event applying a damage impulse across a footprint, gated on the temperature scalar. Trivial once damage exists; mostly a VFX and notification job.
5. **Tornado.** A swept path with a damage kernel along it. Cheap to simulate, expensive to present convincingly — it is the one that needs real art.
6. **Warning phases and shelters.** Only meaningful once citizens are agents (deferred well past v1 per `UNKNOWNS.md`). Then: a warning phase with lead time as the purchasable quantity, automatic movement toward the nearest shelter with capacity, and shelters that require power and water to count. Follow CS2 in having **no manual evacuation button**.
7. **Recovery mechanics.** The Disaster Response Unit as a fire-station upgrade, plus a Fast Recovery toggle. Keep the trade-off explicit and visible; it is the best single idea in CS2's version of this layer.
8. **The on/off toggle at new-game time**, once there is anything to switch off.

One structural warning to carry forward, drawn from CS2's own bugs: define damage at the **component** level for any building made of sub-buildings, before shipping composite buildings at all. CS2 shipped composites whose parts could be destroyed but not individually repaired, and it is still visible in bug reports.

---

## Sources

- [Cities: Skylines II Feature Highlight #8: Climate & Seasons — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/climate-seasons)
- [Cities: Skylines II Feature Highlight #5: City Services — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies)
- [Info views — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Info_views)
- [Service buildings — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Service_buildings)
- [All Cities Skylines 2 natural disasters and how to prepare for them — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/natural-disasters)
- [Cities Skylines 2 natural disasters list and how to deal with them — VideoGamer](https://www.videogamer.com/guides/cities-skylines-2-natural-disasters/)
- [How To Deal With Disasters In Cities: Skylines 2 — TheGamer](https://www.thegamer.com/cities-skylines-2-how-to-deal-with-disasters-guide-emergency/)
- [Cities: Skylines 2 — 6 Essential Tips For Recovering From Natural Disasters — GameRant](https://gamerant.com/cities-skylines-2-how-recover-city-natural-disasters/)
- [All Natural Disasters in Cities: Skylines 2 (& How To Manage Them) — The Nerd Stash](https://thenerdstash.com/all-natural-disasters-in-cities-skylines-2-how-to-manage-them/)
- [Cities Skylines 2: All Natural Disasters and how to prepare for them — Sportskeeda](https://www.sportskeeda.com/esports/city-skylines-2-all-natural-disasters-prepare)
- [Cities: Skylines 2 is turning deadly and will launch with new natural disasters — TechRadar](https://www.techradar.com/gaming/consoles-pc/cities-skylines-2-is-turning-deadly-and-will-launch-with-new-natural-disasters)
- [Cities Skylines 2 Development Trees guide: All unlockables and costs — Dexerto](https://www.dexerto.com/gaming/cities-skylines-2-development-trees-unlockables-and-costs-2349659/)
- [Cities: Skylines 2 — Every Development Tree (And What to Buy First) — GameRant](https://gamerant.com/cities-skylines-2-every-development-tree-and-what-to-buy-first/)
- [As Designed — No Evacuation Option During Disasters — Paradox forums](https://forum.paradoxplaza.com/forum/threads/no-evacuation-option-during-disasters.1610713/)
- [Confirmed — Specialized industry does not rebuild sub-buildings after a disaster — Paradox forums](https://forum.paradoxplaza.com/forum/threads/specialized-industry-does-not-rebuild-sub-buildings-after-a-disaster.1606310/)
- [How do I fix buildings instead of destroying them — Paradox forums](https://forum.paradoxplaza.com/forum/threads/how-do-i-fix-buildings-instead-of-destroying-them.1618812/)
- [How we fix Damage Repair on the building? — Steam discussions](https://steamcommunity.com/app/949230/discussions/0/4349988380669841274/)
- [How do we evacuate a city? Did I miss the button? — Steam discussions](https://steamcommunity.com/app/949230/discussions/0/3877096256094131867/)
- [Is there even a use for Emergency Shelters? — Steam discussions](https://steamcommunity.com/app/949230/discussions/0/4030223998575333724/)
- [Disable natural disasters after starting a map? — Steam discussions](https://steamcommunity.com/app/949230/discussions/0/727997144358799444/)
- [Fire House Broken? — Steam discussions](https://steamcommunity.com/app/949230/discussions/0/3877095833488143079/)
- [Natural Disasters — Steam discussions (CS2)](https://steamcommunity.com/app/949230/discussions/0/807974496347695150/)
- [Natural Disasters — Cities: Skylines Wiki (CS1, for contrast)](https://skylines.paradoxwikis.com/Natural_Disasters)
- [Emergency Shelters — Skylines Wikia (CS1, for contrast)](https://skylines.fandom.com/wiki/Emergency_Shelters)
