# Cities: Skylines II — Demand and Growth

Research notes on what actually drives RCI demand in *Cities: Skylines II* (Colossal Order / Paradox
Interactive, 2023): households and companies, rent and land value, building levels 1–5, abandonment and
condemnation, signature buildings. Compiled to inform an **original** implementation in *Metropolis* —
written entirely in my own words; no game asset, data file, or text string is reproduced.

**Methodology / confidence convention.** As with `docs/research/roads.md`, most page fetches here are
egress-blocked (including the official wiki), so this is assembled from web-search result summaries plus
the few GitHub READMEs that *were* reachable. Tags: **[Dev]** = Colossal Order/Paradox dev diary or
feature highlight; **[Wiki]** = attributed to the official wiki by search results, not read directly;
**[Modder]** = a mod author describing the vanilla behaviour they patched — the strongest technical
sources here, since they had to read the simulation code, but valid only as of the patch targeted;
**[Community]** = forums and guide sites, directional and often folklore; **[Inferred]** = my own
reading, not sourced. Patch context matters more here than anywhere else in CS2: the economy was
rewritten in **Economy 2.0** (1.1.5f1, June 2024), land value was rebound to service coverage in the
1.1.x line, and homelessness was retuned in 1.1.8 and again around 1.2.0f1.

---

## How CS2 does it

### 1. The big structural difference from CS1

CS1's demand was, in effect, three hand-tuned curves: the game asked "what R:C:I ratio does a city this
size want?" and nudged the bars toward it. CS2 replaced that with an **agent-and-firm economy**, where
the bars are a *readout* of a simulated market rather than the driver of it. Two actors:

- **Households** rent a *property* (a slot in a residential building), earn wages from their members'
  jobs, pay rent, service fees, and taxes, shop at commercial companies, and accumulate or burn wealth.
  **[Dev]**
- **Companies** (commercial, industrial, office) also *rent* a property, hire workers, and buy inputs.
  Colossal Order described the behaviour explicitly: a company picks the employee count that maximises
  income given resource prices, wages, transport costs, and fixed costs (rent plus upkeep), scaling
  production and headcount with product demand. If profit cannot cover rent, upkeep, and resource
  orders, wealth goes negative and the company goes bankrupt, abandoning the building. **[Dev]**

This is why experienced players say the commercial bar is better read as **desirability**: it answers
"would a new company be profitable and staffable here?", not "how many shops does the city want?".
**[Community]**

### 2. What moves each bar

**Residential.** Fundamentally a *jobs-versus-workers* meter: it rises when commercial, industrial, and
office companies have unfilled job slots and falls as unemployment rises or jobs dry up, with ~50%
described as balanced. **[Wiki]** Four things layer on top:

- **Vacancy suppression.** A large stock of built-but-unoccupied dwellings pushes residential demand
  down, sometimes to zero, until those units fill — the single most common cause of the "no residential
  demand" complaint. **[Wiki][Community]**
- **Homelessness suppression.** Post-1.1.8, a high homeless count throttles immigration so existing
  homeless households absorb free housing first, and some eventually emigrate. A
  `MovingInHouseholdCount` tracks households currently hunting for a property, with a cap that stops new
  ones spawning while too many are already searching. Players report demand returning once homeless
  households drop below roughly a thousand. **[Wiki][Community]**
- **Education mismatch.** Each density/level combination attracts a matching wealth and education profile.
  Too few highly educated citizens leaves level-5 low-density houses empty, which feeds vacancy
  suppression and pins that bar at zero. **[Community]**
- **Taxes and household composition.** Residential income tax is set *per education tier* (five tiers,
  uneducated up to highly educated); raising a tier's rate cuts both its demand and its disposable
  income. Community rules of thumb: ~10% neutral-ish, ~13% where demand visibly stalls. Separately,
  households with children skew toward detached low-density housing, part of why the density bars
  diverge. **[Wiki][Community]**

**Commercial.** Rises when residents and tourists have unmet shopping demand relative to existing retail
throughput, and when industry has goods needing a sales channel; falls when existing shops are already
unprofitable or unstaffed. Commercial needs no educated workers, so it is insensitive to the education
mix. **[Wiki][Community]**

**Industrial.** Rises when the city consumes more of a resource than local production supplies — i.e.
when it is importing — so it is coupled to the resource chain rather than to population. Higher levels
and higher-tier production need well- and highly-educated workers. **[Dev][Community]**

**Office.** Split out from industry as its own zone type in CS2, producing *immaterial* resources (software,
telecom, financial services) and always wanting educated workers, so office demand tracks the supply of
educated citizens. **[Dev][Community]**

### 3. Numbers and neutral points that have been documented

The closest thing to a formula anyone has published. All patch-specific.

- **Service-availability neutral point ≈ 70%, sales-capacity neutral point ≈ 100%** — the thresholds
  commercial demand pivots around (below pushes up, above pushes down), scaled by a tax-sensitivity
  term. **[Modder]**
- **Household shopping cap halved from 4000 to 2000** in Economy 2.0 — a hard per-household consumption
  ceiling, and halving it was a direct throttle on runaway commercial demand. **[Wiki]**
- **Consumption per citizen scales superlinearly with city size** — measured at roughly 5–6× higher per
  citizen in a 300k city than a 30k city. The Real Economy author treats this as a bug (real per-capita
  consumption is roughly flat), and it explains much of why late-game commercial and industrial demand
  balloons out of proportion to population. **[Modder]**
- **Commercial and office profitability is very high in vanilla**, far above industrial, so those two
  sectors level fast and drag land value up with them; **government subsidies were removed entirely** in
  Economy 2.0. **[Modder][Wiki]**
- **Building level gives +25% household capacity per level above 1**, so level 5 is about double level 1
  for the same zone type and footprint. Low-density residential is the exception: one household per
  building regardless of size or level, so it gains nothing from levelling. **[Community]**
- **High-density buildings hold roughly 9–26 households** at the larger sizes; separately, a 6×6
  high-density tower is reported at around 300 households. **[Community]** [Conflict] — these probably
  describe different building families or patches; flagging rather than picking.
- **Economy 2.0 progression gates:** Taxes/Services panels moved to milestone 1, Production to
  milestone 2. **[Wiki]**

### 4. Land value and rent

Land value is the hinge between demand, levelling, and abandonment, and the most criticised and most
modded part of CS2.

- **Pre-1.1.0:** land value was *market-derived* — it followed what renters were willing to pay.
  **Post-1.1.0:** it was bound instead to five service-coverage factors — transportation, healthcare,
  education, police, commercial coverage. **[Modder]**
- **Rent** for a property is reported to depend on a wide bundle: land value, building level, dwelling
  size, commute time, travel time to shopping, household happiness/health/wellbeing, tax rate, household
  education, local service coverage, and local blight. **[Modder]**
- **Upkeep rises with level, and rent rises with upkeep** — a levelled-up building is more expensive to
  live in. Vanilla upkeep grows *exponentially* with level (Land Value Overhaul makes it linear), as do
  upgrade costs. **[Wiki][Modder]**
- **Land value spreads spatially** from high-value cells to neighbours, with a vanilla spread distance
  around 2000 and a rate around 0.01 per update (the mod cuts these to 200 and 0.001). That spread
  distance is why value propagated along major roads to remote parts of the map. **[Modder]**

The **death spiral** is the documented pathology, and Metropolis must avoid reproducing it. The Land
Value Overhaul author's diagnosis: the land-value update was driven by the maximum rent renters were
*willing* to pay, not the maximum they could *afford*. Wealthy renters bid land value up, rent followed,
poorer renters were priced out, buildings decayed or emptied, repeat. Launch-era symptoms included
residential land values above $1.2M, city averages over $2M and still climbing, permanent "not enough
customers" warnings, and low-density housing being outcompeted by offices and high-density on the same
road. The 1.1.0 coverage rework did not fully fix it: the same author reports low-density high-rent
persisting, commercial rent rising further, and high-density rent then too *low* to cover upkeep.
**[Modder]**

### 5. Building levels 1–5

Every zoned building has a level from 1 to 5, representing the wealth and quality of its occupants.
**What raises it** is **disposable income** — money left after rent, upkeep, service fees, and taxes;
residents and companies save up, and the accumulated surplus buys the upgrade. **[Wiki][Community]**
Consequences:

- **Education is now indirect.** In CS1 it was a direct level-up gate; in CS2 education raises what jobs
  a citizen can hold, higher-tier jobs pay more, and that wage becomes the upgrade funding. **[Wiki]**
- **Happiness matters, but far less than money.** Players who tested it report residual money after rent
  dominating happiness by a wide margin. **[Community]**
- **Service fees are a lever.** Zeroing electricity and water fees measurably speeds levelling — those
  fees come out of the same pot. Vanilla garbage fees at the default rate could stall industrial
  companies from ever levelling. **[Community][Modder]**
- **Levelling gets slower as it goes.** A level-up adds household slots (+25%); the new households arrive
  poor, dropping the building's *average* wealth, so the next level takes longer. High-density is
  slowest for exactly this reason. **[Community]**

Levelling is **bidirectional**, not a ratchet: buildings level *down* when land value falls, company profit
falls, or resident wealth collapses (Plop the Growables exists partly to freeze levels on hand-placed
buildings). A higher level buys more household slots or more better-paying job slots, at the cost of higher
upkeep and rent, and yields higher property value and tax revenue. **[Wiki][Community][Modder]**

### 6. Abandonment and condemnation

Two distinct paths reach the same visual outcome. **Residential abandonment** happens when rent outruns
what households can pay, usually because local land value has run away; unhappy residents leave the city
entirely and the property is flagged abandoned. The process is slow — a "high rent" notification
persists a long time before abandonment triggers, deliberate hysteresis giving the player time to react.
**[Community]** **Company bankruptcy** happens when profit cannot cover rent, upkeep, and resource
orders long enough that company wealth goes negative. **[Dev]**

**The blight loop.** An abandoned building drags down the land value of its immediate surroundings,
lowering nearby happiness and lowering rent across the neighbourhood — a genuine negative-feedback
stabiliser that *cools* an overheated block, but also a way for one cluster to drag a healthy
neighbourhood down. Blight is itself an input to rent, closing the loop. **[Community][Modder]**

**Player remedies** reveal the model: bulldoze; re-zone the lot (often to commercial, if the
neighbourhood is short of shops); or expand outward, since land value — and therefore rent — is low in
newly developed areas. That last one confirms rent is fundamentally *local*, not citywide. **[Community]**
**Condemnation** appears to be the narrower case of a lot whose conditions became invalid — de-zoned, or
cut off from its road — producing demolition rather than a lingering shell. **[Inferred]**: no source
cleanly separates CS2's condemned and abandoned states and players use the words interchangeably.

### 7. Signature buildings

CS2's answer to CS1's unique buildings, but wired into the *zoning* system rather than sitting apart
from it.

- **Ploppable buildings that belong to a zone category** (residential, commercial, office, industrial) —
  hand-placed landmarks that still read as part of the zoned fabric. **[Dev]**
- Each has **its own unlock criteria**, drawn from progression milestones, a citizen happiness
  threshold, and/or a count of *active zoned cells* of a specific zone type. Once unlocked they are
  **free to place** but **placeable only once each**. **[Wiki]**
- Placing one **grants XP** (feeding milestone progression) and applies one or more positive effects,
  from neighbourhood-scale to city-wide: wellbeing, tourist attractiveness, sector-wide industrial
  bonuses, higher-education effectiveness multipliers. **[Wiki][Dev]**
- Concrete documented example: **1,000 active cells of medium-density row housing** unlocks the first
  one, with which of two buildings you get depending on whether that housing is North American or
  European themed — a *mixed* stock reportedly satisfies neither. Another cited case requires a
  milestone *and* a happiness level *and* a low-density cell count together. **[Community]**

"Active cells" matters: the counter reads *zoned and developed* cells, not painted zone area, so the
condition cannot be cheesed by painting empty zone.

---

## What makes it feel like CS2

Five things are load-bearing:

1. **The bars are a symptom, not a dial.** CS1 taught "bar is high, zone more." CS2 teaches you to ask
   *why* the bar sits where it does — and the answer is always elsewhere in the city: unfilled jobs,
   unfilled homes, unaffordable rent, missing education. Demand as a diagnostic readout of a simulated
   market is the single most CS2 thing about this system.
2. **Growth is gated by people and money, not by time.** A building levels because its occupants got
   richer. The chain schools → jobs → income → levels → land value → tax revenue → services → schools is
   one visible loop the player can push on at several points.
3. **Land value is spatial and it spreads.** A field over the map that diffuses outward from good
   neighbourhoods and is dragged down by blight. This makes *where* matter as much as how much, and is
   why CS2 cities develop legibly good and bad districts.
4. **Prosperity has a cost.** A block that levels up gets more expensive and can price out its own
   residents. Success creating its own failure mode is the *good* version of the death spiral; the
   runaway version that never self-corrects is what to leave behind.
5. **Vacancy is a real brake.** Empty homes suppress residential demand, empty shops suppress
   commercial — CS2's main defence against unbounded growth, and the mechanic players find most opaque,
   so ours must be *legible* in a way CS2's is not.

---

## Metropolis v1 adoption

Consistent with the binding decisions in `docs/UNKNOWNS.md` (first five minutes = lay roads, paint
zones, watch buildings grow; statistical sim, not agent-based; ~1–2k buildings at 60 fps) and with the
existing `simulation.md` §3 demand model and `zoning-growth.md` growth tick — extending those, not
replacing them.

**Adopt now:**

- **Keep the existing three-bar `[-1,1]` smoothed demand model as the skeleton.** The couplings in
  `simulation.md` (R from jobs-minus-workers, C from goods appetite minus throughput, I from goods gap
  plus unemployment) already match CS2's directional logic. Do not rewrite them for v1.
- **Add one CS2 term to residential demand: vacancy suppression.** Compute citywide residential vacancy
  from the existing `occupancy` scalars and taper raw R demand above a floor — e.g.
  `rawR *= clamp01(1 - (vacancyR - VACANCY_FLOOR) / (1 - VACANCY_FLOOR))`, `VACANCY_FLOOR ≈ 0.10`. This
  is the mechanic that most defines CS2's demand feel and it costs one line over aggregates we already
  compute. Apply the `SEED_POPULATION` bootstrap floor *after* this term, or an empty city never starts.
- **Extend levels from 1–3 to 1–5** in `zoning-growth.md`'s `BuildingData`, with the documented capacity
  curve: `capacity = baseCapacity * (1 + 0.25 * (level - 1))`, so level 5 is 2× level 1. Real reported
  number, trivially cheap, makes the level readout mean something.
- **A single scalar land value field over the existing zone grid.** One `Float32Array`, ticked once per
  sim day. Sources: proximity to developed buildings weighted by level, negative contribution from
  abandoned ones. Then one **short-kernel diffusion pass** per tick — the modder's corrected numbers,
  not vanilla's: a radius of a few cells and a rate near 0.001–0.01/day, not a map-wide bleed. Replaces
  the "distance to road-network centroid" proxy in the growth tick at about the same cost.
- **Level-up driven by a per-building `prosperity` accumulator:**
  `prosperity += (localLandValue * levelFactor - upkeep(level)) * dt` per day; cross a threshold, level
  up and reset; go sufficiently negative, level down. Make `upkeep` grow **linearly** with level per the
  Land Value Overhaul fix, not exponentially — a known-good correction, free if chosen now.
- **Abandonment with hysteresis, and blight.** Prosperity negative for N consecutive days (N ≈ 20–30)
  flags `abandoned`: footprint kept, rendered differently, zero contribution to `CityTotals`, negative
  contribution to the land value field. That last part is what keeps a diffusing value field
  self-correcting instead of divergent. **Condemnation** stays what `pendingDemolish` already does for
  stranded or de-zoned lots — just name it that in the UI to separate it from economic abandonment, and
  let the player bulldoze abandoned buildings to clear blight.
- **A land value info-view.** Nearly free once the array exists, and it is what makes every other
  mechanic here legible. Without it, abandonment reads as a bug.

**Explicitly defer:** households, companies, and agents of any kind (the statistical `occupancy` scalar
stays); rent as a quantity distinct from land value (that split is precisely where the death spiral lives);
education, wealth tiers, per-tier taxation; office as a fourth `ZoneKind`; superlinear consumption (keep
`GOODS_PER_RESIDENT` flat — a CS2 defect, not a feature). Signature buildings are out of v1, but keep a
running `developedCellsByKind` in `CityTotals` now: that is exactly the counter their unlocks read.

**Guardrails worth tests:** land value stays bounded and a long-running city does not climb monotonically
into the ceiling; bulldozing an abandoned cluster lets the block regrow; the vacancy term never deadlocks
the bootstrap; the diffusion pass is double-buffered, so it stays order-independent and deterministic.

---

## Later path

Roughly in order of value-per-unit-of-risk:

1. **Split residential into density tiers** (low / medium / high), each with its own demand bar and
   land-value preference. Biggest gain in city variety per unit of simulation complexity; CS2's six
   residential types are mostly variations on this one axis.
2. **A real education axis** — a scalar per building or district, driven by school coverage, gating job
   slots and raising wages. Makes level 4–5 feel earned rather than timed, and is the prerequisite for
   **office as a fourth zone kind** (educated labour in, immaterial goods out).
3. **Rent as a first-class quantity separate from land value**, with an explicit *affordability* check.
   Implement the fix, not the bug: drive land value from what occupants can *afford*, not from what the
   richest is willing to pay. Far easier to build in than to retrofit.
4. **Companies with real balance sheets** — sales minus wages, rent, upkeep, transport; bankruptcy as the
   C/I abandonment trigger. Depends on a goods chain existing.
5. **Homelessness and a moving-in queue.** CS2's `MovingInHouseholdCount` cap is a genuinely good idea:
   throttle immigration by how many households are already searching. Requires households to exist.
6. **Signature buildings** — a data table of unlock conditions (milestone + developed-cell count +
   happiness threshold) and effects (local land value bonus, citywide attractiveness, sector
   multipliers). Purely additive once the counters exist; the effects are the interesting half.
7. **Neighbourhood identity.** Once land value, abandonment, and density tiers coexist, good and bad
   districts emerge on their own; surfacing them is where CS2's mid-game legibility lives.

---

## Sources

- Official wiki (all via search summaries — direct fetch egress-blocked): [Zoning](https://cs2.paradoxwikis.com/Zoning) [Signature buildings](https://cs2.paradoxwikis.com/Signature_buildings) [Patch 1.1.X](https://cs2.paradoxwikis.com/Patch_1.1.X)
- Developer material: [Feature Highlight #4: Zones & Signature Buildings](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/zones-signature-buildings) [Feature Highlight #9: Economy & Production](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production) [Dev Diary #4 — Colossal Order](https://colossalorder.fi/?p=1649)
- Mod sources (read directly): [Jimmyokok/LandValueOverhaul](https://github.com/Jimmyokok/LandValueOverhaul) [Infixo/CS2-RealEco](https://github.com/Infixo/CS2-RealEco) [algernon-A/PlopTheGrowables](https://github.com/algernon-A/PlopTheGrowables) [Wayzware/AbandonedBuildingRemover](https://github.com/Wayzware/AbandonedBuildingRemover)
- Press and patch coverage: [PCGamesN — rent/economy mod](https://www.pcgamesn.com/cities-skylines-2/rent-economy-mod) [PCGamesN — homelessness patch](https://www.pcgamesn.com/cities-skylines-2/homelessness) [GamesRadar+ — Economy 2.0](https://www.gamesradar.com/games/city-builder/cities-skylines-2-finally-unleashes-its-huge-economy-20-patch-with-reworked-rent-and-a-fix-for-death-waves-but-itll-also-kill-a-bunch-of-your-citizens/) [GamesRadar+ — high rent fix](https://www.gamesradar.com/cities-skylines-2-high-rent-fix-solution/) [Dexerto — 1.1.5f1 notes](https://www.dexerto.com/gaming/cities-skylines-2-patch-notes-1-1-5f1-economy-changes-bug-fixes-more-2794481/) [updatecrazy — 1.1.5f1 notes](https://updatecrazy.com/cities-skylines-2-update-1-1-5f1-patch-notes-economy-2-0/) [PC Gamer — homelessness/pollution patch](https://www.pcgamer.com/games/city-builder/the-latest-cities-skylines-2-patch-addresses-homelessness-and-pollution-issues-in-an-already-fraught-election-year/) [Neowin — homeless citizen fixes](https://www.neowin.net/news/cities-skylines-ii-update-has-fixes-for-homeless-citizens-a-decorations-menu-and-more/)
- Guides: [GameRant — upgrading buildings](https://gamerant.com/cities-skylines-2-how-to-upgrade-buildings/) [GameRant — abandoned buildings](https://gamerant.com/cities-skylines-2-how-to-deal-with-abandoned-buildings/) [GameRant — signature buildings](https://gamerant.com/cities-skylines-2-how-to-unlock-and-place-signature-buildings/) [GameRant — tax rates](https://gamerant.com/how-pick-best-tax-rate-cities-skylines-2/) [ScreenRant — tax rate guide](https://screenrant.com/cities-skylines-2-tax-rate/) [PCGamesN — commercial guide](https://www.pcgamesn.com/cities-skylines-2/commercial) [Pro Game Guides — all zones](https://progameguides.com/cities-skylines-2/all-zones-in-cities-skylines-ii-and-what-they-mean/) [SegmentNext — zoning guide](https://segmentnext.com/cities-skylines-2-zoning/)
- Player threads: [Paradox — signature unlock criteria](https://forum.paradoxplaza.com/forum/threads/lets-talk-about-the-unlock-criteria-for-signature-buildings.1925917/) [Paradox — zero residential demand](https://forum.paradoxplaza.com/forum/threads/zero-residential-demand-bug-and-solution.1695907/) [Paradox — homelessness](https://forum.paradoxplaza.com/forum/threads/homelessness-has-destroyed-my-favorite-city-and-my-ability-to-enjoy-the-game.1721400/) [Steam — level 5 high density](https://steamcommunity.com/app/949230/discussions/0/3877096256101853153/) [Steam — high density levelling](https://steamcommunity.com/app/949230/discussions/0/4030223299342296931/) [Steam — low residential demand](https://steamcommunity.com/app/949230/discussions/0/4031347072447744061/) [Steam — commercial demand](https://steamcommunity.com/app/949230/discussions/0/4030224579615767826/) [Steam — signature cell counting](https://steamcommunity.com/app/949230/discussions/0/6679473922618278780/)
