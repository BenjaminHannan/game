# Cities: Skylines II — Economy, Money Flow, and Production

Research notes on the money system of *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023), compiled to inform an original reimplementation in *Metropolis*. Scope: household budgets, company production chains and resources, imports/exports, tax knobs, service upkeep and fees, loans, and the **Economy 2.0** rework of June 2024 — what changed and why.

**Methodology / confidence convention.** Direct page fetching is blocked in this environment for most domains (including the official wiki `cs2.paradoxwikis.com`), so everything below comes from many targeted web searches whose results are synthesized summaries of one or more sources: the official wiki, Colossal Order dev diaries carried on paradoxinteractive.com / Steam / colossalorder.fi, patch-note coverage, and player/modder discussion. Tags used throughout:

- **[Wiki]** — attributed by search results to the official Paradox wiki. Likely accurate, not independently verified by direct inspection.
- **[Dev]** — stated by Colossal Order in a dev diary or patch notes (as reported by coverage).
- **[Community]** — player forum posts, Steam discussions, third-party guides. May reflect one patch version or one person's testing.
- **[Inferred]** — my own reconstruction of how the pieces must fit; explicitly *not* sourced.

Patch drift matters a lot here: the economy was rebuilt wholesale ten months after launch, and rebalanced repeatedly afterward. Values below should be read as "circa 1.1.5f1–1.3.3f1" unless noted.

---

## How CS2 does it

### 1. The shape of the model: a closed-ish money loop

CS2 does not treat the treasury as the only ledger. Citizens, households, and companies each hold their own balance, and money moves between them on a monthly tick. The intended loop **[Dev/Community]**:

1. Companies pay **wages** to employed citizens.
2. Households pay **rent** to the building they occupy, pay **service fees** (electricity, water/sewage, garbage, healthcare, education, transport fares), and spend the remainder buying **resources** from commercial companies.
3. Commercial companies buy goods from industry (or import them), sell to households at a marked-up price, and keep a margin.
4. Industry buys raw materials, pays wages, pays for electricity/water, and sells to commerce or exports.
5. The city taxes citizens' income and companies' profits, charges service fees, and spends on **construction** and **upkeep**.

Explicitly called out by the developers as *sinks* that destroy money inside the simulation: rents, payments for imports, company profits, and the player's own tax income **[Dev]**. Sources that create money: player spending (construction, upkeep) is redistributed back into the simulation — reported as roughly **half to citizens weighted by education level and half spread evenly across commercial buildings' wealth** **[Dev]**. That redistribution rule is the load-bearing trick: it means player spending is not a pure loss, it is the faucet that refills the private economy.

Consequence **[Inferred]**: the system is a leaky circular flow, not a balanced double-entry ledger. If the player hoards money (high taxes, low spending), the private economy starves and demand collapses; if the player spends, citizens and shops get richer and the tax base grows. This is the single most important structural idea to copy.

### 2. Households

- A household is a group of citizens sharing one dwelling. Household **wealth** derives from combined income — wages of the employed members, or production income **[Wiki]**.
- **Wage is a pure function of education level** — sources are unusually firm that nothing else modifies it (no scarcity premium for a needed specialist) **[Wiki]**. Five education levels: Uneducated, Poorly Educated, Educated, Well Educated, Highly Educated. Education also raises job-level ceiling and work efficiency, and *lowers* per-citizen water/electricity consumption and garbage output **[Wiki]**.
- **Residential tax** is charged only on income above a floor — reported as **₡1400/month of Residential Minimum Earnings**, i.e. a personal allowance below which income is untaxed **[Wiki]**.
- **Spendable money** = income − rent − fees. Post-Economy-2.0, household consumption of goods is computed from spendable money rather than from a fixed appetite, so poor households simply buy less instead of going negative **[Dev]**. The garbage fee is explicitly included in the spendable-money calculation **[Dev]**.
- **High Rent** is evaluated against income, not against the current balance: a household with a temporarily empty wallet but adequate income does not complain and moves away — it just consumes less **[Dev]**.
- **Unemployment benefit** exists but is time-limited. When it lapses, the household flips to a High Rent complaint and emigrates **[Dev/Coverage]**. This was the mechanism behind the post-2.0 homelessness wave.
- **Homelessness** became a first-class state with Economy 2.0 and was buggy for months: players reported large homeless populations coexisting with abundant cheap housing, and homeless households that were nonetheless *wealthy*. Patch **1.1.8f1** fixed homeless citizens failing to seek a way out, fixed homeless households having good wealth, and stopped still-moving-in households from being counted homeless; **1.1.10f1** (Oct 23 2024) continued cleaning up homeless encampments **[Coverage]**.

### 3. Rent and the death of the virtual landlord

Before 2.0 an invisible "virtual landlord" absorbed the gap between what renters paid and what the building cost to run. Economy 2.0 deleted it: **a building's upkeep is now split equally among all its renters** **[Dev]**.

The rent formula reported verbatim across multiple outlets **[Dev]**:

```
Rent = (LandValue + (ZoneType × BuildingLevel)) × LotSize × SpaceMultiplier
```

Where `ZoneType` is a per-zone-type coefficient, `LotSize` is the lot footprint, and `SpaceMultiplier` scales for how much floor area the zone packs per cell. Reported contributing inputs to **land value** and thus rent **[Wiki/Community]**: highest household education level in the building, coverage by police / healthcare / communication / education / garbage / entertainment / welfare services, dwelling unit size, building level, and negative pressure from *urban blight* (nearby crime, abandonment, pollution, homelessness).

Design consequence **[Inferred]**: rent is the main coupling between the services system and the economy system. Good services → land value up → rent up → higher-wealth residents attracted and buildings level up → more tax, but also an affordability squeeze on low-education households. That tension is deliberate and is most of the "city management" texture.

### 4. Companies, production, and profit

- A company occupies a zoned lot, hires citizens up to a workplace count derived from lot size and a **space multiplier**, produces or resells a resource, and books a monthly profit.
- **Production ≈ (employee education/training level) × (work hours)** **[Wiki]** — more educated workers and more staffed hours yield more output. Happy workers give a reported **+15% efficiency** bonus **[Wiki]**.
- Costs: **wages**, **electricity and water** at the player-set fee rates, **land/rent**, **input materials**, and **transport costs** on anything traded with the outside world **[Wiki/Dev]**.
- Industry buildings self-select their output by the workforce available: mass-production lines lean on low-education workers, specialized/high-tech products need highly educated ones **[Dev]**.
- Taxes on commercial/industrial/office are levied **on monthly profit**, not revenue **[Wiki]**.
- **Bankruptcy**: pre-2.0 an unprofitable company would relocate; post-2.0 it simply **goes bankrupt** and the lot empties, so bad locations have consequences **[Dev]**. Exception: **Specialized Industry** buildings cannot go bankrupt — instead they downsize production and shed employees **[Wiki]**.

### 5. Resources and supply chains

- Reported inventory: **36 resources — 10 raw materials, 18 material goods, 8 immaterial goods** **[Wiki]**. Immaterial goods (software, financial services, media, telecom-ish categories) are produced by office companies and move without trucks **[Inferred from category name + office behavior]**.
- Five map-level natural resources: **Groundwater, Fertile Land, Forest, Ore, Oil** **[Wiki]**. Specialized industry areas generally need the matching deposit; **Livestock** and **Stone** are the exceptions that can be placed on ordinary land **[Wiki]**.
- The chain shape is uniform: **extract raw → process into materials → combine materials in a factory into a finished good → sell to commerce or export** **[Wiki/Community]**. Each specialized industry type is described as having one raw material plus two processed materials, which then feed unique factories **[Community]**.
- **Storage** is two-tier: raw materials go to resource-specific storage unlocked with the industry area's level (a grain silo only ever holds crops), while processed goods go to **generic warehouses** that can be retasked from, say, plastics to flour **[Community]**.
- Buffering matters because production and consumption tick at different rates; warehouses smooth the mismatch and reduce import spikes **[Inferred]**.

### 6. Imports and exports

- Every city starts with at least one outside connection (the highway); rail, ship, and air cargo connections are added by building cargo terminals, harbors, and cargo airports **[Wiki]**.
- Trade is **emergent, not player-directed**: a surplus of a resource causes companies to export it, a deficit causes them to import **[Wiki]**. There is no export policy switch.
- **Transport cost scales with volume**: the more of a resource you move across the boundary, the farther the notional destination and the higher the per-unit cost, deducted from the company's margin **[Wiki]**. This is the mechanism that makes autarky economically attractive without hard-coding it — importing a little is cheap, importing everything is ruinous.
- Simultaneous large imports *and* exports of different resources is normal and expected **[Wiki]**.
- Electricity and water also import/export over their own outside connections, priced separately **[Community]**.

### 7. Taxes

- Sliders per zone category: **Residential, Commercial, Industrial, Office**, each expandable into sub-categories — residential broken out by **education level**, commercial/industrial by **resource/product type** **[Wiki/Community]**.
- Range: **−10% to +30%** **[Community]**. Negative rates are a subsidy: the city pays the sector.
- Widely repeated community guidance: sit around **12–15%**, push higher only in emergencies; high taxes suppress zone demand and slow building level-ups, low taxes accelerate them **[Community]**.
- Taxing by education level is a behavioral lever, not just revenue: taxing the uneducated hard nudges citizens toward schooling **[Community]**.
- Taxing by product lets you subsidize a chain you want locally (e.g. a needed input) while taxing a mature export sector **[Inferred]**.

### 8. Service fees, budgets, and upkeep

Two distinct knobs, often confused:

- **Service fee** — what citizens and companies are *charged* for consumption. Fee-charging services reported: roads (tolls), electricity, water & sewage, healthcare, garbage, education, transport. Unlocked at **Milestone 3** **[Wiki]**.
  Documented per-percent effects for electricity/water fees **[Wiki]**: each **1% below 100%** gives **+0.2% consumption, +0.2% company efficiency, +0.05 citizen happiness**; each **1% above 100%** gives **−0.4% consumption, −0.4% company efficiency, −0.1 happiness**. Note the asymmetry — overcharging bites roughly twice as hard as undercharging helps.
  Default education charges: **₡50/month/student elementary, ₡100 high school, ₡200 college/university** **[Wiki]**.
- **Service budget slider** — scales upkeep spend across all buildings of that service equally, trading **cost against building Efficiency** **[Wiki]**. Expenses on the panel are maintenance plus consumables (e.g. power-plant fuel).

Upkeep is a per-building monthly drain that scales with the building and, post-2.0, with road networks too: Economy 2.0 raised road construction and upkeep costs, cut bulldoze refunds, and added a **per-map-tile upkeep fee** **[Coverage; see roads.md]**.

### 9. Loans

- Unlocked at the **Little Hamlet** milestone **[Community]**.
- Borrowing ceiling scales with milestone, reported spanning roughly **₡100,000 up to ₡26,100,000** **[Community]**.
- Interest scales with loan size; repayment is monthly installments; the loan can be topped up or repaid partially/fully at any time via a slider **[Community]**.
- Two buildings reduce the rate: **City Hall −1%**, **Central Bank −2%** **[Community]**.

### 10. Economy 2.0 — what changed and why

Shipped in **1.1.5f1, June 24 2024**; dev diaries June 3 and June 17 2024. The stated goal: make the systems **more straightforward, more responsive, more transparent, and harder**, with "fewer safeguards and automated systems that work invisibly under the surface" **[Dev]**.

Concretely, as reported:

| Change | Rationale given |
|---|---|
| **Government subsidies removed** entirely | They propped up early cities but removed agency and consequence **[Dev]** |
| **Virtual landlord removed**; upkeep split among renters | Made the rent number honest and connected to the building **[Dev]** |
| **New rent formula** (land value + zone×level, × lot × space) | Legible, player-predictable rent **[Dev]** |
| **Companies go bankrupt** instead of relocating | Bad siting should cost something **[Dev]** |
| **Two-part resource pricing**: a lower industrial-processing price and an added commercial service price; households pay both combined | Separated B2B from retail so retail margin exists and tax income is sane **[Dev]** |
| **Industrial manufacturing space multiplier 1 → 5** | More workers per grid cell, so far fewer buildings are needed for the same output **[Dev]** |
| **Work-required-per-product retuned**; workforce-per-unit for processing set to fixed configured values instead of auto-derived at game start | Cut runaway city income; removed a source of nondeterminism **[Dev]** |
| **Higher road build + upkeep costs, smaller demolition refund, per-tile fee** | Infrastructure should be a real ongoing liability **[Coverage]** |
| **Death-wave smoothing** (age variance) | Fixed demographic cliffs — at the cost of a one-time die-off on load **[Coverage]** |

**Reception.** The patch is generally described as the start of the game's comeback, but its first weeks were rough: unemployment benefits expiring pushed citizens straight into High Rent complaints and emigration, and homelessness was both over-triggered and internally inconsistent (rich homeless people). Fixes landed through **1.1.8 / 1.1.8f1** and **1.1.10f1** **[Coverage]**. Existing saves were explicitly warned to expect disruption.

**The lesson for us [Inferred]:** the removal of hidden stabilizers is what made the economy legible *and* what made it fragile. Every invisible safety net you remove needs a visible player-facing lever to replace it, or the player just watches the city die without knowing why.

---

## What makes it feel like CS2

Distilling the above into the properties Metropolis must reproduce:

1. **Money is circulating, not scored.** The treasury is one participant in a loop with households and companies. Spending returns to the private economy; hoarding starves it. This is the difference between CS2's economy and a resource meter.
2. **Every citizen and company is a balance sheet.** Even if aggregated for performance, the player must believe individual households earn, pay rent, and shop, and that individual shops fail.
3. **Legibility over safety.** Post-2.0 the design bet is that a player who can *see* the flow prefers it to a system that quietly rescues them. Panels that decompose income and expense by line item are part of the mechanic, not UI garnish.
4. **Services → land value → rent → tax** is the central feedback loop, and it is a genuine dilemma: improving a neighborhood prices out the people already in it.
5. **Trade is emergent and distance-priced.** The player never picks trade partners; they build capacity and the cost curve on imports makes local production pay off.
6. **Granular knobs with real trade-offs.** Taxes by category *and* subcategory, service fees separate from service budgets, each with a stated numeric effect that goes both ways. Overcharging is punished asymmetrically.
7. **Debt is a tool with a ceiling that grows.** Loans let you build ahead of revenue but the ceiling is tied to city progression, so they can't be an escape hatch.
8. **Failure is local and visible.** A bankrupt shop, an abandoned house, a "High Rent" icon — the economy communicates through the city, not only through a chart.

---

## Metropolis v1 adoption

Consistent with `docs/UNKNOWNS.md` (CS2-like UI structure with the treasury cluster top-right; first five minutes = roads, zones, first buildings; ~1–2k buildings at 60 fps in a browser), v1 should implement the *shape* of the loop at aggregate granularity and skip the deep chain.

**Adopt now:**

- **Monthly tick** driving the whole economy. One economic step per in-game month; UI shows a monthly income/expense breakdown plus a running balance, mirroring CS2's panel structure.
- **Circular flow with redistribution.** Track three pools: treasury, household money, company money. Player construction and upkeep spending returns to the private pools (start with the reported CS2 split: half to households weighted by education, half to commercial). Taxes and import payments drain. Make this visible in a simple flow readout.
- **Per-building economic entities, aggregated math.** Each grown building holds a household or a company record with `income`, `upkeepShare`, `rent`, `balance`. Update them in a flat typed-array pass so 2k buildings is cheap.
- **Rent formula, simplified.** `rent = (landValue + zoneCoefficient × level) × lotCells`. Drop `SpaceMultiplier` in v1 (fold it into `zoneCoefficient`). Land value from a coarse per-cell field driven by service coverage minus pollution/abandonment — reuse whatever field the zoning/land-value work already produces.
- **Upkeep split among occupants**, exactly as 2.0 does. No virtual landlord. It costs nothing extra to implement and it is why rents feel honest.
- **Wages purely by education level**, three tiers in v1 (Uneducated / Educated / Highly Educated) instead of five. A flat table of monthly wage per tier.
- **Household budget:** `spendable = wage − rent − fees`; consumption of goods scales with spendable, never goes negative. High-rent complaint fires on `rent / income` exceeding a threshold, judged on income not balance — CS2's exact rule, and it avoids the false-alarm bug class.
- **Taxes:** four sliders (residential, commercial, industrial, office) in the range −10%…+30%, applied to household income above a **minimum-earnings allowance** and to company **profit**. Skip subcategory breakdowns in v1; leave room in the data model for them.
- **Service upkeep + one budget slider per service**, scaling cost against building efficiency linearly. Skip per-service consumer fees in v1 *except* electricity and water, which are the ones with documented two-sided effects worth feeling.
- **Two resource abstractions, not 36.** v1 tracks **"goods"** (physical, produced by industry, consumed by commerce/households) and **"services"** (immaterial, produced by offices). Everything else is later work.
- **Imports/exports as a price curve, not vehicles.** Per-tick net surplus/deficit of goods is settled with the outside world at a price that degrades with volume: `unitCost = base × (1 + k × volume / capacity)` where capacity comes from the outside connections built. Money leaves on imports, arrives on exports. Statistical, matching the traffic decision in UNKNOWNS.md.
- **Loans:** one slider, ceiling tied to milestone, flat interest that scales mildly with principal, monthly installment, repayable early. Cheap to build, high gameplay value.
- **Bankruptcy and abandonment** as visible outcomes when a company's rolling profit or a household's affordability stays negative for N months.

**Explicitly not in v1:** multi-stage production chains, natural-resource deposits and specialized industry, warehouses and storage buffering, cargo vehicles, per-product taxes, transport fares, healthcare/education/garbage consumer fees, unemployment benefits and homelessness as modeled states.

**Tuning stance:** pick our own numbers. The CS2 figures above are useful as *ratios and signs* (fee asymmetry, tax band, the 1400-ish allowance relative to wages) but our tick rate, building counts, and cost scales differ, so copying absolute values would be both wrong and unnecessary.

---

## Later path

Roughly in order of value-per-effort:

1. **Subcategory tax sliders** — residential by education tier, commercial/industrial by product. Nearly free once the data model has the axis, and adds a lot of perceived depth.
2. **Real resource graph.** Replace "goods" with ~8–12 resources and an authored DAG (raw → processed → finished). Two-part pricing (processing price vs. retail price) from day one, since retrofitting it is what forced CS2's rebalance.
3. **Natural resource fields on the map** (fertile land, forest, ore, oil, groundwater) plus extraction buildings, then specialized industry areas that must sit on the right deposit.
4. **Warehouses and storage** to buffer production/consumption mismatch, with the raw-specific vs. generic split CS2 uses.
5. **Freight as visible flow** — cargo volumes on the road network's statistical model, then cargo terminals/harbors/airports that raise import/export capacity and lower the volume penalty. Instanced trucks later still.
6. **Full household lifecycle economics** — unemployment benefit with a clock, homelessness as a state with a recovery path, welfare services affecting it. CS2's experience says: build the recovery path *before* shipping the failure state.
7. **Five education tiers + schooling pipeline** feeding wages, efficiency, and per-capita consumption/garbage modifiers.
8. **Immaterial goods and office chains** as a genuinely separate economy that needs no freight — a good late differentiator and a natural high-land-value sink.
9. **Land-value simulation depth** — blight from crime/abandonment/pollution/homelessness as a decaying field, so neighborhoods can spiral both ways.
10. **Economic history graphs** per line item, which is what actually made 2.0's transparency claim land.

---

## Sources

- [Dev Diary: Economy 2.0 Part 1 — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-one)
- [Dev Diary: Economy 2.0 Part 2 — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-two)
- [Economy 2.0 — Part 2, Steam announcement](https://store.steampowered.com/news/app/949230/view/4145079671516384052)
- [Economy 2.0 Development Diary #2 — Colossal Order](https://colossalorder.fi/?p=2286)
- [Economy 2.0 Dev Diary #1 — Paradox forums](https://forum.paradoxplaza.com/forum/threads/economy-2-0-dev-diary-1.1682626/)
- [Cities: Skylines II Feature Highlight #9: Economy & Production](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production)
- [Cities: Skylines II Feature Highlight #5: City Services](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies)
- [Economy — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Economy)
- [Citizens — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Citizens)
- [Supply Chains — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Supply_Chains)
- [Natural resources — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Natural_resources)
- [Services — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Services)
- [Patch 1.1.5f1 overhauls the economy — DSOGaming](https://www.dsogaming.com/patches/cities-skylines-2-patch-1-1-5f1-overhauls-the-games-economy-brings-performance-and-modding-improvements-fixes-a-lot-of-bugs-and-issues/)
- [Full Economy 2.0 patch notes — TechRaptor](https://techraptor.net/gaming/news/cities-skylines-2-economy-20-patch)
- [Economy 2.0 with reworked rent and a death-wave fix — GamesRadar+](https://www.gamesradar.com/games/city-builder/cities-skylines-2-finally-unleashes-its-huge-economy-20-patch-with-reworked-rent-and-a-fix-for-death-waves-but-itll-also-kill-a-bunch-of-your-citizens/)
- [The CS2 comeback has started — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/update-economy-2-0)
- [Update fixes one of the game's toughest issues (homelessness) — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/homelessness)
- [Patch addresses homelessness and pollution — PC Gamer](https://www.pcgamer.com/games/city-builder/the-latest-cities-skylines-2-patch-addresses-homelessness-and-pollution-issues-in-an-already-fraught-election-year/)
- [Economy 2.0 overhaul has arrived — Destructoid](https://www.destructoid.com/cities-skylines-2s-massive-economy-2-0-overhaul-has-arrived/)
- [CS2 overhauls economy with massive new patch — Gameranx](https://gameranx.com/updates/id/502137/article/cities-skylines-2-overhauls-economy-with-massive-new-patch/)
- [How to manage Cities Skylines 2 taxes — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/taxes)
- [Cities Skylines 2 taxes guide — VideoGamer](https://www.videogamer.com/guides/cities-skylines-2-taxes/)
- [Tax Rate Guide — ScreenRant](https://screenrant.com/cities-skylines-2-tax-rate/)
- [Mastering Taxes, Subsidies, and Income — Chill Place Gaming](https://chillplacegaming.com/cities-skylines-ii-taxes-income/)
- [Supply Chains: production, storage, transportation — Chill Place Gaming](https://chillplacegaming.com/supply-chain-cities-skylines-ii/)
- [How Industry Areas Work — Chill Place Gaming](https://chillplacegaming.com/industry-areas-cities-skylines-ii/)
- [CS2 industry guide — PCGamesN](https://www.pcgamesn.com/cities-skylines-2/industry)
- [Guide to imports and exports — TheGamer](https://www.thegamer.com/cities-skylines-2-imports-exports-guide/)
- [CS2 export guide — GamesRadar+](https://www.gamesradar.com/cities-skylines-2-export-guide/)
- [How to take loans — Game Rant](https://gamerant.com/how-take-get-loans-cities-skylines-2/)
- [CS2 loans — how to unlock loans — Stealth Optional](https://stealthoptional.com/article/cities-skylines-2-loans)
- [Understanding taxes and loans — Magic Game World](https://www.magicgameworld.com/cities-skylines-2-understanding-taxes-and-loans/)
- [How to deal with high service upkeep costs — Pro Game Guides](https://progameguides.com/cities-skylines-2/cities-skylines-2-how-to-deal-with-high-service-upkeep-costs/)
- [How to fix High Rent issues — Dot Esports](https://dotesports.com/general/news/how-to-fix-high-rent-issues-in-cities-skylines-2)
- [Economy 101, welfare edition — Steam Community](https://steamcommunity.com/app/949230/discussions/0/3937895474112776157/)
- [Economy 2.0 in CS2 is around the corner — Gamepressure](https://www.gamepressure.com/newsroom/economy-20-in-cities-skylines-2-is-around-the-corner-prepare-for/z56f5d)
