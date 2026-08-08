# Cities: Skylines II — Social Services (Education, Health, Death, Safety, Garbage, Parks)

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) models the "social" city services: education tiers, healthcare, deathcare, police and fire, garbage handling, and parks/recreation — specifically their coverage mechanics, capacity, the service vehicles that act as real agents, and how all of it feeds back into land value and individual citizens. Compiled to inform an original implementation in *Metropolis*. Written entirely in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains here, so the material below is synthesized from many targeted web searches whose results summarize one or more pages (official wiki, Paradox feature highlights, guide sites, Steam and Paradox forum threads, mod repositories). Primary tables could not be read directly, so every claim carries a tag:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`).
- **[Dev]** — Colossal Order / Paradox feature-highlight or dev-diary material.
- **[Community]** — player guides, Steam/Paradox discussions, modder writeups. May be patch-specific.
- **[Inferred]** — my reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree; both readings given.

Sister docs: `docs/research/cs2/zoning-districts.md` (zone grid, demand, building levels, districts), `docs/research/cs2/ux-conventions.md` (info views and panels).

---

## How CS2 does it

### 1. The two-channel coverage model

The single most important structural idea, and the one CS2 explicitly changed from CS1: every service building acts through **two channels at once** **[Dev]**.

1. **A passive local effect.** The building radiates a benefit into the area around it — but not as a circle stamped on the terrain. The effect **propagates along the road network** outward from the building, decaying with network distance rather than straight-line distance **[Dev]/[Community]**.
2. **A simulated effect.** Something actually travels: a patrol car driving its beat, an ambulance answering a call, a garbage truck on a route, or a citizen making a trip to the building. This channel reaches much further than the passive one and is the part that can fail — because it depends on the road network being traversable in time **[Dev]**.

The two are designed to work in tandem: passive coverage is the baseline quality-of-life effect of "there is a police station in my neighbourhood", while the simulated channel is what handles specific events (a crime, a fire, a corpse, a bin) anywhere in the city.

**Capacity and magnitude.** Community documentation of the in-game tooltips describes passive coverage with two numbers **[Community]**:

- **Capacity** — roughly, how many people the passive effect can reach as it spreads along the roads. It is *consumed* by the population it passes through. A school in a sparse suburb projects a long way; the same school dropped into a wall of high-density towers is exhausted within a couple of blocks. Coverage range is therefore **not a fixed radius — it is a budget spent against population density along the network** **[Community]**. This is the single most distinctive mechanic in the whole system.
- **Magnitude** — the strength of the effect where it lands. Reported as flat across most of the reach with a fast falloff at the edge, rather than a smooth linear ramp **[Community]**.

Players read all of this through **info views**: selecting the healthcare, education, police, fire, or garbage overlay recolours the road network from green (well served) through orange to red (not served) **[Community]**. The overlay colours *roads*, not tiles, which is a direct visual consequence of network-propagated coverage.

### 2. Efficiency and the budget slider

Each service building shows an **Efficiency** percentage that scales its capacity, its throughput, and — reportedly — the reach of its passive effect **[Wiki]/[Community]**. Efficiency is degraded by things like understaffing, missing electricity or water, and lack of workers with the required education level **[Inferred]** from how the panel is described.

On top of per-building efficiency there is a **per-service budget slider** in the economy panel, reported to run from about **50% to 150%** of the baseline **[Community]**. Moving it changes upkeep cost and, in lockstep, the efficiency of every building in that service category — including how many vehicles they run. Lowering the police budget literally means fewer patrol cars on the street. Several services additionally support **service fees** charged to citizens, though the UI exposure of these has been patchy across patches **[Community]/[Conflict]**.

**Extensions and sub-buildings.** Service buildings are modular. *Extensions* fit inside the existing lot (a school wing, a clinic wing, extra storage); *sub-buildings* are separate structures placed on the same plot (a vehicle garage, an ambulance depot, a helipad) **[Community]**. Each has its own construction cost, its own added upkeep, and a stated effect — usually "+N capacity" or "+N vehicles". Reported examples: a police garage adding roughly **six** more patrol cars on top of a station's default **six**; a garbage depot adding about **ten** trucks to an incineration plant; a storage extension adding a few hundred tonnes of waste storage **[Community]**. Exact numbers vary by patch.

This modularity is a real design lever: it lets one building type serve a village and a metropolis, and it turns "my service is failing" into a decision with three distinct answers (upgrade this one, build another one, or raise the budget).

### 3. Education — four buildings, five citizen levels

Citizens carry an education level; five are reported: uneducated, poorly educated, educated, well educated, highly educated **[Community]**. Four building tiers move them up, gated by the citizen's **age band** rather than purely by choice **[Community]**:

| Building | Who attends | Result on graduation |
| --- | --- | --- |
| Elementary school | Children | Poorly educated |
| High school | Teens | Educated |
| College | Teens and adults | Well educated |
| University | Adults | Highly educated |

Some sources present this as "four tiers of education" and some as five citizen levels; both are consistent — the fifth level (uneducated) is simply the state of having attended nothing **[Inferred]**.

Reported capacity anchor: an elementary school starts around **1,000 student places**, and once eligible children exceed that you must add a wing or build a second school **[Community]**. Capacities for the higher tiers were not consistently reported **[Conflict]**; that they exist and are extendable is well attested. A community mod exists purely to raise these capacities, which suggests the shipped numbers feel tight to some players **[Community]**.

**Why education matters downstream.** Jobs carry education requirements. Low-requirement jobs accept anyone; high-paying office and specialized jobs need the matching level, so an undereducated city sees unfilled high-tier vacancies alongside unemployed low-tier citizens **[Community]**. Education also feeds other services indirectly: hospitals and research facilities need educated staff, which is why guides recommend colleges as a *healthcare* fix **[Community]**. And an elementary school within reach gives a wellbeing bonus specifically to households with young children **[Community]** — a nice example of a service effect that is targeted at a household type rather than applied uniformly.

### 4. Healthcare — clinics, hospitals, and health as a citizen stat

Two main growable-city healthcare buildings are reported: the **medical clinic** (cheap, small patient capacity, small staff, unlocked early) and the **hospital** (much larger patient capacity and staff, much higher upkeep, longer reach) **[Community]**. Both provide two things: treatment capacity for sick citizens, and **ambulances** for citizens too ill to travel themselves. Extensions add patient capacity; an ambulance depot sub-building adds vehicles **[Community]**.

Citizens carry a **health** value, and the city reports an **average health** figure **[Community]**. Healthcare coverage lowers the probability of a citizen becoming sick in the first place, on top of treating those who do **[Community]**. Pollution (air, ground, noise) pushes the other way **[Inferred]** — universally repeated in guides but not something I could pin to a primary source in these results.

Guides converge on one piece of layout advice that is really a statement about the mechanic: **several small clinics spread out beat one big hospital**, because ambulance response time depends on network distance and traffic, and because passive coverage is consumed by density as it spreads **[Community]**.

### 5. Deathcare — the clearest example of a capacity chain

When a citizen dies the body must be collected by a **hearse** and taken to a deathcare building **[Community]**:

- **Cemetery** — accepts bodies but has a finite capacity and eventually fills. A filled cemetery can be told to **empty out**, at which point it ships its stored bodies to other cemeteries or to a crematorium **[Community]**.
- **Crematorium** — processes bodies rather than storing them, so it has no accumulation limit in practice **[Community]**.

The failure mode is instructive and is shared with garbage: **when the destination facility is full, hearses stop being dispatched**, so bodies pile up at buildings and citizens complain, even though the vehicles are sitting idle and available **[Community]**. The bottleneck is storage, not fleet. This "collection blocked by downstream capacity" pattern is the same shape as landfill saturation, and CS2 uses it deliberately across several services.

### 6. Police and crime — probability, patrols, and success rate

Crime in CS2 is reported as two separate numbers, which is a meaningful design decision **[Community]**:

- **Crime probability** — the chance that a given building generates a crime, driven by things like the number of visitors a commercial building receives and by how well policed the area is. Guides describe it as a per-building percentage that police coverage suppresses.
- **Crime success rate** — given that a crime happens, whether the criminal gets away. This depends on **police actually arriving**, so it degrades with traffic congestion and bad network layout.

The consequence players report is that you can drive average crime probability down near zero and *still* get complaints, because congested roads keep the success rate high **[Community]**. Deterrence is passive coverage; interception is the simulated vehicle channel; both must work.

Police stations are reported to run about **six patrol cars** by default with a garage extension roughly doubling that; police headquarters offer a much larger fleet, longer reach, more holding cells, and a helipad upgrade for air patrol **[Community]**. Arrested criminals occupy jail space at the station, and convicted ones are moved on to a separate **prison** building — so there is a capacity chain here too **[Community]**. Patrol cars driving a beat are what deliver the simulated portion of police coverage; there is **no manual dispatch** in the base game, only mods **[Community]**.

### 7. Fire — hazard suppression plus response

Fire stations do the same two jobs. Passively they perform "safety supervision" in their coverage area, which **lowers the fire hazard** of buildings there; actively they send fire engines to fires anywhere they can reach **[Community]**. Response time is the critical variable and is degraded by congestion; specialized buildings (helicopter depots, watchtowers for wildfire) extend reach into places engines cannot serve quickly **[Community]**.

A reported quirk worth knowing: a station built *after* a fire has already started may not respond to that fire, which points at fires being dispatch-assigned at ignition time rather than continuously re-evaluated **[Community]/[Inferred]**.

### 8. Garbage — generation, collection, processing

Buildings accumulate garbage over time; trucks collect it and haul it to a processing facility **[Community]**. Three destinations are reported:

- **Landfill** — stores garbage and processes it very slowly. Community reporting describes processing throughput far below what its own truck fleet can collect, so a landfill-only city fills its landfills and stalls **[Community]**.
- **Incineration plant** — burns waste and produces electricity, at the cost of significant air and ground pollution **[Community]**.
- **Recycling centre** — converts waste into a material input that manufacturing industry can consume, tying garbage back into the resource economy **[Community]**.

Two emergent behaviours players document, both worth understanding before copying anything:

- Facilities **ship garbage to each other** to level out load across the network, which is why a landfill can fill up without any local cause **[Community]**.
- Because importing waste in bulk can be cheaper than driving around collecting it, facilities have been observed **preferring imports and stopping local collection** — a genuine emergent economic bug rather than a designed rule **[Community]**. Instructive as a cautionary tale about letting service dispatch be driven purely by cost minimization.

### 9. Parks and recreation — needs, not a land-value stamp

This is where CS2 most sharply diverges from CS1, and the divergence is explicit in dev material **[Dev]**: **parks, plazas, landmarks, and tourist attractions do not directly add land value**. Instead they satisfy a citizen **leisure** need. Satisfied needs raise **wellbeing**; citizens who are happy and can afford it are willing to keep living somewhere and pay the rent; *that* willingness is what raises land value **[Dev]/[Community]**.

Parks and attractions also feed a separate city-level **attractiveness** value that governs tourist inflow **[Community]**.

The generalization is the important part: **in CS2 essentially no service directly sets land value.** Services meet needs; met needs raise wellbeing and willingness to pay; land value follows. Guides state the corollary bluntly — carpeting a neighbourhood with service buildings does nothing by itself unless residents and businesses actually have unmet needs those buildings resolve **[Community]**. Building levels (see `zoning-districts.md` §5) then ride on the resulting rent surplus, and levelled-up buildings raise land value around themselves, closing the loop.

### 10. Service vehicles as real agents

Unlike Metropolis's chosen statistical traffic model, CS2's service vehicles are genuine agents on the network, and the dispatch logic is documented at some length **[Wiki]**:

- Orders are assigned by **lowest total pathfinding cost**, not nearest-by-distance.
- The assignment considers not just where every eligible vehicle **is now** but where it **will be** once it finishes its current order. A vehicle currently closer may lose the job to one that will finish nearby momentarily.
- Vehicles re-route dynamically in response to events on the road — lane changes around accidents or stopped vehicles, and yielding to emergency vehicles.

The result is that services are *routing problems*, not radius checks. Every complaint about service failure in CS2 ultimately traces back to either capacity (not enough places/storage/fleet) or the network (vehicles cannot get there in time). That is the intended tension, and it is why the road network stays interesting long after the zoning is finished.

---

## What makes it feel like CS2

Strip away the numbers and six things carry the feel:

1. **Coverage flows down streets, not across circles.** Seeing the road network light up green from a building, and seeing the green *run out* three blocks in because the towers are dense, is a specific and legible pleasure. A radius circle communicates almost nothing by comparison.
2. **Coverage is a budget consumed by population.** The same building serves a suburb generously and a downtown barely. This one rule turns "where do I put the school" into a real decision that changes as the city grows.
3. **Two channels, two failure modes.** Passive coverage failing looks like a red neighbourhood; the vehicle channel failing looks like a specific unanswered event. Players learn to diagnose which one broke, and the fixes differ (build another / fix the roads).
4. **Downstream capacity blocks upstream collection.** Full cemetery means hearses stop; full landfill means trucks stop. It is counterintuitive the first time and completely logical the second time, and it makes service networks feel like plumbing rather than paint.
5. **Services do not buy land value — they buy satisfied needs.** The indirection is slower and less satisfying at first, and much better afterwards, because it stops "spam every service building" from being a strategy and makes wellbeing the real currency.
6. **The budget slider is a live dial with visible consequences.** Cutting police funding takes cars off the street. The abstraction is thin enough that the player can see it.

What is *not* essential to the feel: four education tiers, prisons, recycling chains, helicopter depots, tourist attractiveness, extension/sub-building modularity. All depth for later.

---

## Metropolis v1 adoption

Constrained by the binding decisions in `docs/UNKNOWNS.md` — statistical flow traffic with lightweight visual vehicles (no per-vehicle pathfinding in v1), ~1–2k buildings at 60 fps in a browser, first five minutes = roads → zones → buildings — and by the zoning model already fixed in `zoning-districts.md`.

**Adopt directly**

- **Network-propagated coverage.** Coverage spreads from a service building outward along road edges (BFS/Dijkstra over the road graph by edge length), never as a Euclidean circle. This is cheap, it is the signature mechanic, and it is what makes the info view look right.
- **Coverage as a consumable budget.** Each building emits a capacity number. As the flood traverses each edge, subtract the population served on that edge's frontage. When the budget hits zero, the flood stops. Store the resulting per-edge coverage level 0–1 on the road graph. Recompute lazily (dirty-flag on build/demolish/growth, amortized over frames), not every tick.
- **Magnitude with a hard core and a fast edge falloff**, matching the reported shape: full effect for most of the reach, quick decay in the last stretch.
- **Info views that recolour roads** green→orange→red per service, one overlay per service. This falls out of the data model for free and is most of the perceived depth.
- **Downstream capacity gating collection.** For garbage (and later deathcare), when the processing facility is full, collection stops. One rule, high payoff.
- **Services raise wellbeing, wellbeing raises land value.** No service writes land value directly. Keep the indirection from day one — retrofitting it later means rebalancing everything.
- **A per-service budget slider**, roughly 50–150%, scaling both upkeep and effective capacity/magnitude. Trivial to implement against the coverage model and it makes the economy panel meaningful immediately.

**Simplify for v1**

- **Five services, one building each**: school, clinic, police station, fire station, garbage depot. Plus **parks** as a separate small ploppable. No tiering, no extensions, no sub-buildings.
- **No education levels on citizens.** School coverage contributes an "education" term to wellbeing and nothing else. Citizen education levels require a household/citizen model we do not have, and they only pay off once jobs have requirements.
- **No health/crime/fire as per-building stochastic events.** Instead, each service is a **coverage scalar per building** that feeds wellbeing. Uncovered buildings decay toward unhappy. This is the CS1-ish simplification, and it is honest: without agent vehicles we cannot simulate response time, and simulating events we cannot respond to would just be noise.
- **Garbage is the one exception**, because it works well statistically: buildings accumulate garbage at a per-building rate; a depot drains it at a rate scaled by coverage, budget, and remaining storage; a full depot stops draining. That gives one service with real dynamics without needing agents.
- **Service vehicles are decoration in v1.** Reuse the lightweight instanced-mesh vehicles already planned for traffic, tinted per service, spawned along edges inside a building's coverage area at a rate proportional to its activity. They convey life; they do not carry simulation state. This is explicitly a *look*, and the doc should say so, so nobody later assumes coverage depends on them.
- **Parks satisfy a leisure term in wellbeing** using the same network-coverage machinery with a small capacity. No attractiveness, no tourism.
- **No deathcare, no prisons, no recycling, no service fees, no pollution.** Deathcare needs a death model; pollution is its own system.

**Data model sketch (v1)**

- `ServiceKind = school | health | police | fire | garbage | leisure`
- Per service building: `{ kind, capacity, magnitude, budgetScale, upkeep }`
- Per road edge: `coverage: Record<ServiceKind, number /*0–1*/>` — the output of the flood, the input to everything else and to the overlays.
- Per zoned building: coverage sampled from its frontage edge; wellbeing = weighted sum of covered services minus penalties (garbage backlog); land value = local function of wellbeing + neighbours' building levels.

**Explicitly rejected for v1**

Agent-based dispatch and the will-be-there-soon assignment heuristic; crime probability vs. success rate as separate numbers; response-time simulation; facility-to-facility load balancing; extensions and modular sub-buildings; education tiers and job requirements; attractiveness/tourism. Every one of these is good, none is needed for the first five minutes.

---

## Later path

Roughly in the order each stops being a nice-to-have:

1. **Building-level service events** — sickness, fires, crimes as discrete stochastic events on buildings, with coverage lowering probability. Cheap once coverage exists, and it makes services feel reactive rather than ambient.
2. **Real service vehicles**, once per-vehicle pathfinding lands from the traffic milestone. Then response time becomes a real quantity and the second coverage channel exists properly. This is the largest single jump toward the CS2 feel and is correctly gated behind traffic.
3. **Crime success rate** as a distinct number from crime probability, which only becomes meaningful once vehicles must physically arrive.
4. **Extensions and sub-buildings** — the modular upgrade pattern. High gameplay value per unit of work; it's mostly UI plus a stat delta, and it gives players a third answer to "my service is failing".
5. **Deathcare**, once citizens age and die: hearses, cemetery storage, crematorium processing, and the empty-out order. The storage-blocks-collection rule is already in place from garbage.
6. **Education tiers with citizen education levels and job requirements** — needs a household/citizen model, and pays off only alongside office zoning and a wealth model (see `zoning-districts.md` later path §3–4).
7. **Pollution** (air, ground, noise) as fields feeding health, land value, and park effectiveness, plus incineration as a polluting garbage option and recycling as an input to industry.
8. **Prisons and the jail→prison chain**; specialized emergency buildings (helicopter depots, watchtowers).
9. **Attractiveness and tourism** driven by parks and landmarks.
10. **Facility-to-facility load balancing** for garbage and deathcare — but with an explicit guard against the reported CS2 failure where import cost beats collection cost and trucks stop working. Cost-minimizing dispatch needs a floor on serving your own city.

---

## Sources

- [Services — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Services)
- [Traffic — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Traffic)
- [Zoning — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Zoning)
- [Beginner's guide — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Beginner%27s_guide)
- [Paradox: CS II Feature Highlight #5 — City Services, Districts & Policies](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies)
- [Paradox: CS II Feature Highlight #11 — Citizen Simulation & Lifepath](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/citizen-simulation-lifepath)
- [Paradox forums: Education distribution and job distribution](https://forum.paradoxplaza.com/forum/threads/education-distribution-and-job-distribution.1606699/)
- [Paradox forums: Cemeteries not picking up dead](https://forum.paradoxplaza.com/forum/threads/cemeteries-not-picking-up-dead.1594927/)
- [Paradox forums: Fire station will not send out trucks when placed after a fire has started](https://forum.paradoxplaza.com/forum/threads/fire-station-will-not-send-out-trucks-when-station-is-placed-after-a-fire-has-already-started.1605738/)
- [Paradox forums: High crime bug](https://forum.paradoxplaza.com/forum/threads/high-crime-bug.1610173/)
- [Paradox forums: Missing service fees option for several services](https://forum.paradoxplaza.com/forum/threads/missing-service-fees-option-for-healthcare-and-deathcare-garbage-management-education-and-research-transportation-while-the-options-exist-in-the-de.1605247/)
- [Chill Place Gaming: Understanding city services and coverage areas](https://chillplacegaming.com/city-services-cities-skylines-ii/)
- [Chill Place Gaming: Essential services ranking](https://chillplacegaming.com/essential-services-ranking-cities-skylines-ii/)
- [Chill Place Gaming: Campus expansion & education building guide](https://chillplacegaming.com/cities-skylines-ii-education-building-guide/)
- [Chill Place Gaming: Modular building mechanics](https://chillplacegaming.com/modular-buildings-cities-skylines-ii/)
- [modscities2: Service coverage](https://www.modscities2.com/cities-skylines-2-service-coverage/)
- [modscities2: Service efficiency](https://www.modscities2.com/cities-skylines-2-service-efficiency/)
- [modscities2: Land value and building levels](https://www.modscities2.com/cities-skylines-2-land-value-and-building-levels/)
- [TheGamer: How to manage healthcare](https://www.thegamer.com/cities-skylines-2-manage-healthcare-hospital-clinic/)
- [TheGamer: How to handle the dead — deathcare guide](https://www.thegamer.com/cities-skylines-2-how-to-handle-the-dead-deathcare-guide/)
- [TheGamer: How to lower crime](https://www.thegamer.com/cities-skylines-2-reduce-lower-crime-rate-police/)
- [TheGamer: How to educate your citizens](https://www.thegamer.com/cities-skylines-2-education-school-college-univeristy-guide/)
- [TheGamer: How to make and handle parks](https://www.thegamer.com/cities-skylines-2-making-parks-tips-tricks-guide/)
- [TheGamer: How to increase and manage land value](https://www.thegamer.com/cities-skylines-2-increase-manage-land-value-explained-guide/)
- [TheGamer: How to solve high rent problems](https://www.thegamer.com/cities-skylines-2-fix-lower-high-rent-problems-land-value/)
- [TheGamer: How to deal with disasters](https://www.thegamer.com/cities-skylines-2-how-to-deal-with-disasters-guide-emergency/)
- [GameRant: How to boost healthcare](https://gamerant.com/cities-skylines-2-how-to-boost-healthcare/)
- [GameRant: How to boost education](https://gamerant.com/cities-skylines-2-how-to-boost-education/)
- [GameRant: How to reduce crime](https://gamerant.com/cities-skylines-2-how-to-reduce-crime/)
- [GameRant: How to set up garbage disposal](https://gamerant.com/cities-skylines-2-how-set-up-garbage-disposal/)
- [GameRant: 10 important service buildings to get as soon as possible](https://gamerant.com/cities-skylines-2-best-service-buildings/)
- [GameRant: How to increase entertainment](https://gamerant.com/ccities-skylines-2-how-to-increase-entertainment/)
- [PCGamesN: CS2 garbage guide](https://www.pcgamesn.com/cities-skylines-2/garbage)
- [Twinfinite: CS2 garbage guide](https://twinfinite.net/guides/cities-skylines-2-garbage-guide/)
- [VideoGamer: CS2 garbage guide](https://www.videogamer.com/guides/cities-skylines-2-garbage/)
- [GameSkinny: How to fix lack of entertainment](https://www.gameskinny.com/tips/cities-skylines-2-how-to-fix-lack-of-entertainment/)
- [GameRevolution: Healthcare not working — coverage and Chirper complaints](https://www.gamerevolution.com/guides/952025-cities-skylines-2-healthcare-not-working-lack-coverage-hospital-clinic-chirper-complaints)
- [Gamepur: How to get more educated workers](https://www.gamepur.com/guides/how-to-get-more-educated-workers-in-cities-skylines-2)
- [The Nerd Stash: How education works](https://thenerdstash.com/how-education-works-in-cities-skylines-2/)
- [gamepressure: CS2 services with significant changes](https://www.gamepressure.com/newsroom/cities-skylines-2-services-with-significant-changes-new-gameplay/za5b21)
- [GameFAQs: CS II general tips and walkthrough](https://gamefaqs.gamespot.com/pc/398681-cities-skylines-ii/faqs/82369)
- [Steam discussion: Garbage collection](https://steamcommunity.com/app/949230/discussions/0/4041481833167197605/)
- [Steam discussion: Healthcare?](https://steamcommunity.com/app/949230/discussions/0/3878221560447070213/)
- [Steam discussion: No police patrols after 1.2.3f1](https://steamcommunity.com/app/949230/discussions/0/595138951841365460/)
- [Steam discussion: Securing crime scene](https://steamcommunity.com/app/949230/discussions/0/628941617404935674/)
- [Steam discussion: Emergency services have no priority](https://steamcommunity.com/app/949230/discussions/0/3937895062995560520/)
- [EducationBalancer mod (GitHub)](https://github.com/Wayzware/EducationBalancer)
- [Cities2Mods ServiceVehicleAI (Thunderstore)](https://thunderstore.io/c/cities-skylines-ii/p/CityPlayer/Cities2Mods_ServiceVehicleAI/)
