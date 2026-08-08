# Cities: Skylines II — Citizens, Households, and the Lifepath

Research notes on the citizen-agent systems of *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023), compiled to inform an original implementation in *Metropolis*. Everything below is written in my own words from published dev diaries, wiki summaries, patch-note coverage, community guides, and player/modder analyses.

**Methodology and confidence convention.** Direct page fetches are blocked in this environment (including `cs2.paradoxwikis.com`), so all of this comes from search-result synthesis of one or more sources. Tags:

- **[Dev]** — stated by Colossal Order / Paradox in a dev diary or feature highlight. Highest confidence for intent, but describes launch-era design.
- **[Wiki]** — attributed by search results to the official Paradox wiki. Likely accurate, not independently verified.
- **[Community]** — player guides, forum threads, Steam discussions, or modder code deep-dives. May reflect one patch version or personal testing.
- **[Inferred]** — my own reading of how the pieces must fit together. Not sourced.
- **[Patch]** — behavior explicitly changed by a named update.

Two patches matter most here. **Economy 2.0** (1.1.5f1, June 2024) reworked rent, removed hidden government subsidies, retuned education admission/graduation odds, and rewrote *when* citizens die to break up death waves. Anything about household finances or mortality should be read as "post-Economy 2.0" unless flagged.

---

## How CS2 does it

### 1. The unit of simulation is the household, not the citizen

Individual citizens are simulated agents — they have names, ages, education levels, jobs, health, wellbeing, and a recorded life history — but almost every *decision that touches the city* is made at the household level **[Dev]**. A household is a set of citizens who share a home: a single person, a couple, a multi-generation family with children and grandparents **[Dev/Wiki]**.

Households own the things that create pressure on the city:

- The home (a rented residential unit in a building; rent and upkeep are household-level).
- The money. Income arrives per working member but is pooled; expenses (rent, taxes, water, electricity, garbage fee, medicine, cars) are paid from the pool **[Community, Economy 2.0 coverage]**.
- The shopping. When the household's stock of a resource runs low, the household — not the individual — decides to make a shopping trip, picks a product by weighting the preferences of its members, and then picks a store **[Community/Wiki]**. The maximum single shopping amount was cut from 4000 to 2000 units in a patch **[Patch/Community]**.
- The move-in / move-out / homelessness decision (section 6).

This is the single most important structural fact about the system: citizens are the *texture*, households are the *mechanism*.

### 2. Age stages and lifespan

Four visually distinct life stages: **Child → Teen → Adult → Senior** **[Dev]**. Reported stage durations, in game months **[Wiki]**:

| Stage | Duration | Can work? | Health | Education |
| --- | --- | --- | --- | --- |
| Child | 21 months | No | Boosted | Elementary only; attends if capacity exists |
| Teen | 15 months | Yes (but many keep studying) | Boosted | High school; college also open |
| Adult | 60 months | Yes | Normal | College, university |
| Senior | until death | No | Max health decays over time | Cannot advance further |

So a citizen who lives out the full arc spends roughly 96 game months (8 game years) in the pre-senior stages, and seniors are the terminal, declining state: their *maximum* health drifts down until they die of old age **[Wiki]**. At launch this produced the notorious **death waves** — cohorts that immigrated together aged together and died together, spiking hearse demand and gutting the workforce in one pulse. Economy 2.0 added variance to time-of-death specifically to decorrelate cohorts, at the cost of a one-time elevated death rate when the patch landed **[Patch]**.

Growth comes from two channels: births inside the city, and immigration of whole households from outside **[Dev]**. Community reporting is much thinner on the birth model than on immigration; my reading is that immigration is the dominant growth channel in practice and births mostly maintain multi-generation family structure **[Inferred]**.

### 3. Education is a five-level ladder gated by age

Levels: **Uneducated → Poorly Educated → Educated → Well Educated → Highly Educated** **[Dev/Wiki]**.

The mapping from school to level **[Wiki/Community]**:

| School | Who is eligible | Graduate becomes |
| --- | --- | --- |
| Elementary | Children only (very high admission chance) | Poorly Educated |
| High School | Teens only | Educated |
| College | Teens and Adults | Well Educated |
| University | Adults | Highly Educated |

Hard gates that make the ladder a genuine pipeline rather than a menu:

- Seniors are ineligible for every school **[Wiki]**.
- A teen or adult who never graduated elementary school is ineligible for *anything* — the elementary miss is permanent **[Community]**. This is why the most-cited practical advice from the code deep-dive community is to build elementary schools immediately rather than waiting for the education info-view to complain; one such analysis suggests roughly one elementary school per 7,500–15,000 citizens **[Community, Impossumbear code deep-dive series]**.
- Working and studying compete for the same citizen. Teens *can* work, but many will choose to keep studying; some adults do too **[Wiki]**. Attendance is therefore a per-citizen choice weighted against the alternative, not an automatic enrollment — except for children, who essentially always attend if there is capacity **[Wiki/Community]**.
- Economy 2.0 raised both the admission chance and the graduation chance for elementary and high school **[Patch]**, which is a strong hint that pre-patch the pipeline leaked badly at the bottom.

Schools expose **capacity** and **eligibility** counts in the education info view, and eligibility is far smaller than population — a widely-reported forum finding was that a 90k city needed only one high school, which players read as the eligibility formula being tuned too low **[Community]**.

### 4. Jobs: matching, over-qualification, and the education trap

Every workplace (industry, commercial, office, and city services) publishes a breakdown of how many workers it needs *at each education level*; you can read it off an individual building's panel **[Community]**. Company type and building level shift the profile: industrial manufacturing skews toward less-educated workers at every level, while commercial and especially office demand climbs the ladder as the building levels up **[Community]**.

Matching rules as documented:

- A citizen may take a job at or **below** their education level, never above **[Community]**.
- Work-trip pathfinding scores candidate jobs by travel cost plus a **small bonus for an exact education match** **[Community]**. Job choice is therefore a commute-vs-fit tradeoff, not a pure fit sort.
- An over-qualified worker in a lower-tier slot contributes at the *slot's* tier, not their own — the surplus education is simply wasted **[Community]**.
- Over-qualified citizens fill vacancies more slowly than exactly-matched ones **[Community]**, which is the mechanism behind the game's most infamous emergent failure state.

That failure state: because new arrivals are typically uneducated and level-1 commercial/industrial buildings want exactly uneducated workers, a well-run city that educates everybody drains its own low-tier labor pool and gets a persistent "not enough workers" warning while simultaneously showing high unemployment among the well educated **[Community]**. The standard player counter-play is to *deliberately under-educate* part of the city using per-district school service coverage, which many reviewers and forum critics point to as evidence that the labor model is inverted relative to how real cities work **[Community]**.

### 5. Happiness = Wellbeing + Health

Happiness is not a primitive. It is an aggregate of two underlying tracks **[Wiki]**:

**Wellbeing** — mental state and sense of safety. Driven by whether the basics are actually delivered: electricity, clean water, sewage that doesn't back up, garbage collection, low pollution, and access to **leisure** **[Dev/Wiki]**. A citizen whose wellbeing falls low enough is flagged **Unwell**: happiness drops, their contribution at work drops, and their probability of turning **criminal** rises. Crime probability is normally low and scales up as wellbeing falls **[Wiki]**.

**Health** — physical condition. Children and teens get a health boost; seniors lose maximum health with age **[Wiki]**. A citizen with low health is **Weak** — again, reduced happiness and reduced work contribution — and Weak citizens are much likelier to fall sick. When a Weak citizen gets sick their health collapses to a very low value and they are at real risk of dying without treatment **[Wiki]**. This is the chain that makes healthcare coverage matter mechanically rather than cosmetically.

Happiness feeds back into behavior and work output, and household happiness is inspectable as a tooltip listing every positive and negative contributor **[Dev/Wiki]** — the game deliberately shows its work.

Crucially, **what a citizen values depends on their life stage** **[Wiki]**:

- Seniors have free time and weight proximity to places to spend it.
- Families with children weight proximity to schools.
- Working-age adults weight fast connections to workplaces.

So the same neighborhood scores differently for different households — that stage-dependent weighting is what makes districts develop character.

**Leisure** is its own need with its own decision rule: different venues grant leisure at different *rates*, and a citizen picks a destination by trading off how much leisure is available and how fast it accrues against the pathfinding cost of getting there **[Dev]**.

### 6. Housing suitability, moving, and homelessness

The household evaluates its current home continuously. The suitability score is a sum of **[Community, quoting dev material]**:

1. Pathfinding costs to its members' destinations (work, school, shops, leisure).
2. Free time remaining after work and travel.
3. Money remaining after all expenses.
4. How well nearby services match the household's current needs.

The move ladder, in order **[Community/Dev]**:

- Rent + upkeep exceed what the household can pay → look for a cheaper unit the household *can* afford.
- No affordable unit in the city → try to leave the city entirely.
- Too poor even to fund the move → become **homeless**, and live in city parks until circumstances change **[Community]**.

This produces genuinely emergent pathology: land value inflation can push rents above what even a highly educated, wealthy household can pay, and with no cheaper stock and no exit funds you get *wealthy homeless people* — a widely-discussed forum phenomenon that is a direct consequence of the rules rather than a bug per se **[Community]**.

Homelessness is also wired back into demand. Reported behavior is that residential demand bars stay suppressed while homeless households are numerous and begin recovering once the count drops below a threshold (players commonly cite around 1,000 households) **[Community]** — treat the exact number as a tuning value for one patch, not a spec.

On the way *in*, the households the simulation offers you are shaped by city state, not drawn uniformly: average citizen happiness, current homelessness, residential tax rates, free student places, and open jobs all steer which household archetypes spawn **[Community]**. Density demand follows from archetype rather than being set directly — wealthier and larger families want space and push **low/medium** density demand, while singles and students are happy in apartments and push **high** density demand **[Community/Dev]**.

### 7. Money flow through households

Money is explicitly **not** conserved **[Community, Economy 2.0 coverage]**. Sinks: rent paid to buildings, import payments, and player income (taxes). Sources: company profits and funds injected to citizens scaled by education level. Household surplus after expenses goes into *upgrading the home*, and once enough has been invested the residential building **levels up** — so building level is a slow integral of household prosperity rather than a direct function of services.

### 8. The lifepath as a presentation layer

Any citizen can be followed. Doing so opens a journal recording their name, home address, occupation, happiness, and a running feed of life events — graduating, finding a partner, changing jobs, moving house, leaving the city — plus their posts to the in-game social feed (Chirper) **[Dev]**. Nothing here changes the simulation; it is a window onto state the simulation already tracks. That is the important lesson: the storytelling is *free* if the underlying state is per-citizen and event-driven.

---

## What makes it feel like CS2

Stripping away the implementation, five properties carry the feeling:

1. **Named individuals you can follow.** The ability to click one dot in a crowd, learn their name and job, and watch them graduate and move house is the entire emotional payload. It costs almost nothing once state is per-citizen.
2. **Households as the acting unit.** Families move, not people. A single family that can't make rent generates a visible, traceable chain of consequences: cheaper flat → longer commute → less free time → lower happiness.
3. **Stage-dependent values.** Seniors, families, and workers grade the same neighborhood differently. This is what turns "build parks" into "build parks *where the seniors are*."
4. **Pipelines with permanent gates.** Miss elementary school and that cohort is capped forever. Decisions have latency measured in life stages, and the city you get in twenty minutes is the consequence of schools you built or didn't build earlier.
5. **Legible tradeoffs, visible reasoning.** The happiness tooltip enumerating every contributor is doing enormous work. Players tolerate an opaque simulation only if it will explain any single number on demand.

And one anti-lesson worth naming explicitly: the **education trap** (educating your city into a labor shortage) is emergent, coherent with the rules, and *bad*. It punishes the player for doing the obviously good thing. Metropolis should keep the pipeline and drop the inversion — over-qualified workers should fill low-tier jobs readily, with a modest happiness or productivity penalty, not a hiring-rate penalty.

---

## Metropolis v1 adoption

Constraints from `docs/UNKNOWNS.md` that bind this area: the traffic model is **statistical flow per edge** with per-vehicle agent pathfinding deferred, and the target is **~1–2k buildings at 60 fps in a browser**. Both point the same direction: **do not simulate 50,000 individual agents on individual paths.** Adopt CS2's *structure* at a coarser resolution.

**Adopt now:**

- **Household as the simulated entity.** One record per household holding: member list, home building reference, pooled money, wealth tier, and a suitability score. Target scale is a few thousand households, which is tractable in a typed-array SoA layout.
- **Citizens as lightweight records inside a household.** Fields: age in months, life stage, education level, job reference (building + tier), health, wellbeing. Names generated from an original word list. This is enough for the lifepath panel.
- **The four life stages with CS2's proportions.** Use the reported 21 / 15 / 60 months for child / teen / adult and a randomized senior tail. Randomize the death month per citizen from the start — do not retrofit anti-death-wave variance the way CS2 had to.
- **The five-level education ladder and the four school tiers**, including the hard gates: seniors never study, and missing elementary permanently caps a citizen. Keep the gate — it is the source of long-horizon consequence — but make elementary coverage cheap and early so the gate reads as fair.
- **Happiness = f(wellbeing, health)**, both 0–100, with wellbeing driven by utilities delivered, pollution, garbage, crime, and leisure access, and health driven by life stage plus healthcare coverage. Compute per household from the building's local service/land-value/pollution samples rather than per citizen — one evaluation per household per tick.
- **Stage-weighted needs.** A small weight table per life stage over {school access, job access, leisure access, service access}. Cheap, and it is what creates neighborhood character.
- **The move ladder**, simplified to three rungs: afford-current → seek-cheaper → leave-city. Add homelessness only if it can be given a visible, recoverable presentation; otherwise let the household leave.
- **Job matching by tier with a commute term.** Score = education-fit bonus − travel cost, where travel cost comes from the statistical road-flow model's edge costs rather than a real path. Allow over-qualification freely.
- **The contributor tooltip.** Every happiness number must be able to enumerate its own inputs. Build this as part of the first happiness implementation, not later.
- **Household surplus → building level-up.** Reuse CS2's integral: accumulate surplus into a per-building upgrade meter.

**Simplify or defer in v1:**

- **No per-citizen daily schedule.** No sleep/work/shop/leisure trip loop. Instead, run each household through a **tick-level budget** — money in, money out, needs satisfied or not — and let the statistical traffic model absorb the trip volumes the household implies (commute trips = employed members, shopping trips = a function of household size).
- **No individual leisure destination choice.** Use a leisure-access field sampled at the building, decayed by distance, rather than picking a venue per citizen.
- **No resource-level shopping.** One abstract "goods" need per household, consumed at a rate proportional to size and wealth.
- **No crime-to-criminal-agent conversion.** Wellbeing feeds a district crime rate; the rate feeds back into wellbeing. No criminal entities in v1.
- **No births in v1** (or a very simple rule: a couple household with room may gain a child at a low per-tick probability). Immigration is the growth channel.
- **Household archetypes on immigration**, drawn from a small table (single, couple, family, student, retiree) weighted by happiness, tax rate, open jobs, and free school places — mirroring CS2's inputs but with five archetypes rather than a continuous space. Each archetype has a preferred density, which is how residential demand splits across low/medium/high.

**Explicitly reject:** the over-qualification hiring-rate penalty, and any design where the correct play is to under-educate a district.

---

## Later path

Full fidelity, roughly in order of value per unit of pain:

1. **Per-citizen activity scheduling.** A state machine per citizen (home / work / school / shop / leisure / travel) advanced on a staggered tick. This is what unlocks time-of-day traffic peaks, and it only makes sense *after* per-agent pathfinding exists — so it is downstream of the traffic milestone already deferred in UNKNOWNS.
2. **Real leisure destination choice.** Venue-specific leisure rates and fill levels, chosen by rate-vs-travel-cost. Makes commercial and park placement matter individually rather than as a coverage field.
3. **Resource-level consumption and shopping.** Households holding stocks of distinct goods, with member-weighted product preference — the bridge between citizens and a production/supply-chain economy.
4. **A real rent market.** Rent set by land value and unit supply rather than a formula on the building, so the affordability cascade (and CS2's wealthy-homeless pathology, ideally without the pathology) becomes emergent.
5. **Homelessness as a modeled state** with parks as fallback shelter, plus policy and service levers to resolve it.
6. **Crime and sickness as entities** — a criminal actor with a target, a sick citizen requiring a specific ambulance trip — rather than statistical rates.
7. **Multi-generation family formation**: partnering, children leaving to form new households, inheritance of home tenancy. Households becoming dynamic rather than fixed-membership is the deepest change on this list and the biggest source of narrative.
8. **A full lifepath journal with a social feed.** Cheap once events are already emitted; mostly a content and writing problem.

---

## Sources

- [Development Diary #11: Citizen Simulation & Lifepath — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/development-diary-11-citizen-simulation-lifepath.1596988/)
- [Development Diary #11 — Colossal Order](https://colossalorder.fi/?p=1851)
- [Feature Highlight #11: Citizen Simulation & Lifepath — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/citizen-simulation-lifepath)
- [Feature Highlight #9: Economy & Production — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production)
- [Feature Highlight #5: City Services — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies)
- [Citizens — Cities: Skylines 2 Wiki](https://cs2.paradoxwikis.com/Citizens)
- [Services — Cities: Skylines 2 Wiki](https://cs2.paradoxwikis.com/Services)
- [Info views — Cities: Skylines 2 Wiki](https://cs2.paradoxwikis.com/Info_views)
- [Patch 1.1.X — Cities: Skylines 2 Wiki](https://cs2.paradoxwikis.com/Patch_1.1.X)
- [Patch Notes 1.1.5f1 — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/patch-notes-1-1-5f1.1687527/)
- [Economy 2.0 Part 1 dev diary — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-one)
- [Economy 2.0 is here! — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/economy-patch-is-here)
- [Cities: Skylines 2 finally unleashes its huge "Economy 2.0" patch — GamesRadar+](https://www.gamesradar.com/games/city-builder/cities-skylines-2-finally-unleashes-its-huge-economy-20-patch-with-reworked-rent-and-a-fix-for-death-waves-but-itll-also-kill-a-bunch-of-your-citizens/)
- [Cities: Skylines 2 is so realistic it simulates layoffs and homelessness — GamesRadar+](https://www.gamesradar.com/cities-skylines-2-is-so-realistic-it-simulates-layoffs-and-homelessness/)
- [Patch 1.1.5f1 overhauls the game's Economy — DSOGaming](https://www.dsogaming.com/patches/cities-skylines-2-patch-1-1-5f1-overhauls-the-games-economy-brings-performance-and-modding-improvements-fixes-a-lot-of-bugs-and-issues/)
- [(From Impossumbear) Code Deep Dive (Pt. 5): elementary schools — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/from-impossumbear-code-deep-dive-pt-5-build-your-elementary-schools-as-soon-as-possible-dont-wait.1610864/)
- [High school eligibility is way too low — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/high-school-eligibility-is-way-too-low-90k-population-and-only-1-high-school-needed.1604590/)
- [Education Distribution and Job Distribution — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/education-distribution-and-job-distribution.1606699/)
- [Seniors, Cim Aging and death rate — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/seniors-cim-aging-and-death-rate.1727448/)
- [Wealthy homeless people — Steam Community](https://steamcommunity.com/app/949230/discussions/0/4202489789154881431/)
- [Household Wealth is broken beyond belief — Steam Community](https://steamcommunity.com/app/949230/discussions/0/4751948774785545849/)
- [Education progression and age — Steam Community](https://steamcommunity.com/app/949230/discussions/0/530970118824411295/)
- [Broken Simulation? — Steam Community](https://steamcommunity.com/app/949230/discussions/0/3877096256100127347/)
- [Cities: Skylines 2 — How To Educate Your Citizens — TheGamer](https://www.thegamer.com/cities-skylines-2-education-school-college-univeristy-guide/)
- [How To Increase Citizen Happiness In Cities: Skylines 2 — TheGamer](https://www.thegamer.com/cities-skylines-2-citizen-happiness-boost-increase-guide/)
- [Cities Skylines 2 Lack of Labor: How to Fix Not Enough Workers — GameRevolution](https://www.gamerevolution.com/guides/951813-cities-skylines-2-lack-of-labor-how-fix-not-enough-workers)
- [How Education Works in Cities: Skylines 2 — The Nerd Stash](https://thenerdstash.com/how-education-works-in-cities-skylines-2/)
- [Cities: Skylines 2 — ECS Explorer (Captain of Coit)](https://captain-of-coit.github.io/cs2-ecs-explorer/)
- [ECS — Entity Component System — Cities: Skylines 2 Wiki](https://cs2.paradoxwikis.com/ECS_-_Entity_Component_System)
- [Citizen Simulation and Lifepath Deep Dive Released — MP1st](https://mp1st.com/news/cities-skylines-2-citizen-simulation-and-lifepath-deep-dive-released-game-features-its-own-version-of-twitter)
- [How to Get High Density Residential Demand — UrbanLoon](https://urbanloon.com/pages/cities-skylines-2-high-density-residential-demand)
