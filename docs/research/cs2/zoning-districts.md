# Cities: Skylines II — Zoning, the Cell Grid, and Districts

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) handles zone types, the zoning cell grid along road frontage, demand-driven building spawning, and districts with their per-district policies. Compiled to inform an original implementation in *Metropolis*. Everything below is written in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains in this environment, so the material below comes from many targeted web searches whose results are synthesized summaries of one or more pages (official wiki, Paradox feature pages and forums, Steam guides and discussions, mod repositories, guide sites). Because primary tables could not be read directly, every claim carries a tag:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`). Likely accurate, not independently verified.
- **[Dev]** — from Colossal Order / Paradox marketing or dev-diary material (feature highlight pages, press coverage of them).
- **[Community]** — player guides, Steam discussions, forum analyses, modder writeups. May be patch-specific or personal testing.
- **[Inferred]** — my own reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree; both readings given.

Sister docs: `docs/research/roads.md` (the road network the zone grid hangs off) and `docs/research/zoning-growth.md` (the Metropolis implementation brief this doc feeds).

---

## How CS2 does it

### 1. The zone cell and the grid it lives on

The atomic unit of zoning is a square **cell of 8 m × 8 m** — carried over unchanged from *Cities: Skylines 1* **[Community]**. Every dimension in the zoning system is a whole number of cells, and the road tool snaps segment length to the same 8 m increment, so the road grid and the zone grid are one grid rather than two systems that have to be reconciled **[Community]** (see `roads.md` §2 on snapping).

Cells are not painted freely onto the terrain. They are generated **by roads**, in strips that run along each side of a road segment, oriented perpendicular to that segment. The strip is what community documentation calls the "zone grid" or "zone block" attached to a road. Consequences players report constantly:

- Curved roads produce fan-shaped strips whose cells splay outward, which is why curves waste frontage and produce awkward lots **[Community]**.
- Two roads crossing at a non-right angle produce overlapping or clipped strips; the game resolves the overlap by trimming, leaving unusable slivers **[Community]**.
- The road tool can silently snap to a *neighbouring* road's grid orientation rather than the one you started from, which is the classic cause of a district full of misaligned blocks **[Community]** (documented in `roads.md`).
- Deleting a road removes its strip, and any buildings that grew on it lose their frontage and are demolished. **[Inferred]** from the strip-is-owned-by-the-road model; sources describe zoning appearing and disappearing with roads but do not spell out the demolition rule.

**Depth.** How deep the strip runs from the road edge is the one number sources disagree on. **[Conflict]**: several community sources describe zoning extending **4 cells (32 m)** from each side of a road; others describe **6 cells (48 m)** per side, giving 96 m between two parallel roads before an unzonable "hole" opens in the middle of the block. The 6-cell figure is the one that matches the reported maximum building footprint (below) and the widely-repeated grid-planning advice that ~96 m of road spacing fills a block completely, so **6 cells / 48 m per side is the more likely game value**, with 4 cells possibly being a CS1 memory or a description of a *default* rather than the maximum **[Inferred]**. Blocks laid out wider than twice the depth get a permanently empty strip down the middle, which players fill with parks, parking, or an alley.

Modders can override the strip: the **Zoning Toolkit** mod lets a road carry zoning on both sides, on one chosen side, or on neither — which confirms that "which side(s) get cells" is a per-segment property in the game's data rather than an emergent result **[Community]**.

### 2. Zone types

CS2 ships a substantially wider palette than CS1. Residential alone went from two options to six **[Dev]**.

**Residential (6 types)** **[Dev]/[Wiki]**:

| Type | Character |
| --- | --- |
| Low density | Detached single-family houses, one household per building |
| Medium density row housing | Wall-to-wall terraced homes; the only type that can occupy a **1-cell-wide** lot |
| Medium density housing | Small apartment blocks |
| High density | Residential towers, many households |
| Mixed housing | Shops on the ground floor, apartments above — counts for both residential and commercial |
| Low rent housing | Large buildings subdivided into many small, cheap apartments |

Low rent is explicitly aimed at students and low-wealth young households; medium and high density are described as *less* sensitive to rising land value than low density, because the cost of the lot is split across dozens of households instead of one **[Dev]**.

**Commercial** — low and high density variants; high density produces the downtown retail towers. Mixed housing also generates commercial floor space, which is how CS2 gets walkable main streets without the player having to interleave two zone types cell by cell **[Dev]**.

**Office** — two densities, low and high. Office companies produce *immaterial* goods and services (software, financial services, media) rather than physical goods, so unlike industry they do not need freight logistics and do not pollute; they are the intended high-education, high-land-value employer **[Wiki]**.

**Industry** — a single density and a single theme, unlike the others **[Wiki]**. Industrial companies manufacture physical goods from raw materials that are either imported over outside connections or produced locally by specialized extraction industry. **Specialized industry** (farming, forestry, ore, oil) is *not* a paintable zone in CS2 — it is an **area** drawn over terrain that has the matching natural resource, and it is worked by ploppable extractor buildings rather than by growable zoned lots **[Wiki]**. This is an important structural difference from CS1's specialized industry districts.

**Themes.** Residential and commercial buildings render in either a **North American** or a **European** architectural style. The theme is chosen at the moment cells are painted (defaulting to the map's theme), it is baked into the cells, and it is purely cosmetic — building stats, footprints, and behaviour are identical. A single city can freely mix both **[Dev]/[Community]**.

**Signature buildings** are unique, one-off ploppables that belong to the zone categories rather than growing from them. They unlock on criteria such as a progression milestone, a citywide happiness level, or — most relevantly here — a **count of zoned cells or of grown buildings of a given type**. Reported examples: roughly **1,000 active cells of medium-density row housing** unlocks the first residential signature building; an industrial signature building unlocks at **50 manufacturing buildings**, another at **100** **[Wiki]/[Community]**. Each can be built only once and is free to place.

### 3. Lot sizes and how a building claims cells

Lots are rectangles measured **width × depth**, where width runs *along* the road (frontage) and depth runs *away* from it **[Community]**.

- The practical range is **2×2 up to 6×6 cells** — 16 m to 48 m on a side **[Community]**. The 6-cell maximum depth is exactly the reported zone-strip depth, which is strong circumstantial support for the 6-cell reading above **[Inferred]**.
- **Medium density row housing is the exception**: it can occupy a lot only **1 cell wide**, which is what lets rows of narrow terraced houses pack a street front **[Community]**.
- Industrial manufacturing is reported to use one fixed footprint, **6×5** **[Community]**.
- A pocket of zoned cells too small for any lot in the type's catalogue simply stays empty forever. Players report that the tool tends not to create isolated 1-cell zones at all, precisely because nothing could ever grow there **[Community]**.

The spawn process, as players describe it: the game looks at a contiguous run of empty zoned cells that touch the road, picks a building whose footprint fits the available width and depth, reserves those cells, and instantiates it. Bigger buildings therefore need both a long uninterrupted frontage and enough depth behind it — a 6×6 tower cannot appear on a 4-cell-deep block, and a shallow strip caps a district's maximum density regardless of demand **[Community]/[Inferred]**. The exact selection rule (largest-fitting-first vs. weighted random vs. demand-tier-driven) is not documented publicly **[Inferred]**.

### 4. Demand and what actually drives it

Demand is shown as three bars — residential, commercial, industrial/office — and CS2 exposes a **Demand info view** that itemizes the contributing factors, which is what community analysis has reverse-engineered. Reported factors:

**Residential.** Job availability is the primary driver: as industrial, commercial, and office companies create vacancies, the city needs workers, and workers need homes. Rising unemployment pushes residential demand back down. Shared across all residential densities are **happiness** and **tax rate** terms. Density preference is decided by **household wealth and size** — wealthier and larger families skew toward low density, while students and low-wealth households skew toward high density and low rent; the raw count of students in the city is itself a positive term for medium and high density **[Community]/[Wiki]**.

Two mechanical details worth stealing:

- **Vacancy penalty.** Empty finished buildings crush demand: a large penalty applies past roughly **10 free properties** for one density band and **5** for the other. **[Conflict]** — sources disagree on which threshold belongs to which band (one says >10 low density / 5 high density, another the reverse). Either way the shape is the same: a small vacancy buffer is tolerated, beyond which demand collapses. This is CS2's anti-overzoning brake, and it is why players see the bar drop the instant they paint a big field of cells.
- **Cost of living** appears as a listed factor for high-density residential when there are homeless households, but is reported to contribute **zero** to the actual demand number — a display artifact **[Community]**.

**Commercial, industrial, office.** The dominant term is **local resource balance**: for each tradeable resource the game takes the shortfall between what the city consumes and what it produces, and demand is driven by an aggregate of those shortfalls (described as the squared shortfall averaged over resources — i.e. a convex function that punishes large single-resource gaps much harder than many small ones) **[Community]**. Industry that produces goods then generates commercial demand, because those goods need retail outlets to sell through. Office demand keys off demand for immaterial services and off the supply of educated workers.

The net effect is a genuine economic loop rather than CS1's simpler mood-bar: households ↔ jobs ↔ goods ↔ retail, with imports over outside connections as the escape valve that keeps the loop from deadlocking on day one **[Inferred]**.

### 5. Building levels

Every zoned building has a **level from 1 to 5** **[Wiki]**. Unlike CS1, where levelling was gated on land value plus service coverage checkboxes, CS2 ties it to **disposable income**: when the rent a building collects exceeds its upkeep, the surplus accumulates and eventually buys an upgrade. Higher-level buildings house more households or offer more high-paying jobs, consume slightly more water and power, and **raise the land value around themselves**, which raises neighbours' rents and pulls them up too — producing the observed ripple where a new service building levels the block in front of it, then the block behind **[Community]**.

### 6. Districts and policies

**Districts** are free-form painted areas, drawn with a district tool that unlocks at the fourth progression milestone **[Community]**. They are painted over the map surface independent of the zone grid, they can be named, and they exist to (a) label neighbourhoods, (b) scope statistics, and (c) carry policies.

CS2 has **three policy scopes**: city-wide, district, and per-building. District policies reported to exist (around **7** of them) **[Community]**:

| Policy | Reported effect |
| --- | --- |
| Combustion engine ban | Fuel-burning vehicles may not *pass through*; residents and businesses of the district may still enter/leave. Cuts noise and air pollution |
| Heavy traffic ban | Same through-traffic exclusion for trucks; used to keep freight off residential streets and lower air pollution |
| Speed bumps | Lowers vehicle speed inside the district |
| Recycling | Reduces resource consumption / waste, at the cost of citizens' free time |
| Energy consumption awareness | Cuts district electricity use by ~5% |
| Roadside parking fee | Charges for on-street parking, with a player-adjustable rate |
| District taxation | Raises or lowers tax rates in the district by up to **±2%** relative to the city rate |

Two design points stand out. First, the traffic bans are **through-traffic** bans, not access bans — the pathfinder is told the district is expensive-or-forbidden for transit but destinations inside remain reachable. That is a routing-cost modification, not a hard wall. Second, the tax policy is deliberately a *narrow* ±2% nudge rather than a per-district tax slider, so districts differentiate neighbourhoods without becoming a tax-optimization minigame **[Inferred]**.

Community guidance is consistent: bans only work if the surrounding network actually offers an alternative — banning heavy traffic from a district with no bypass just reroutes the trucks onto a worse street or strands the deliveries.

---

## What makes it feel like CS2

Stripping away the numbers, the zoning experience rests on five things:

1. **Roads are the authoring surface, zoning is the paint.** You never place a building. You draw a street, cells appear alongside it, you drag a colour over them, and the city fills itself in. The whole loop is indirect, and that indirection is the genre's signature pleasure.
2. **The 8 m cell is legible.** Players learn to *see* in cells — "that's a 4-wide lot," "I need 96 m between these roads." A visible, snapping, consistent grid unit is what turns zoning from guesswork into planning. Ambiguity here is the single biggest way to lose the feel.
3. **Geometry has consequences.** Shallow blocks cap density; curves waste frontage; misaligned grids leave slivers. The frustration is *load-bearing* — it is what makes a well-planned block satisfying.
4. **Demand is a conversation, not a faucet.** The bars respond to what you built: overzone and they crash; build industry and commercial demand answers. Growth feels earned rather than dispensed.
5. **Districts turn a map into neighbourhoods.** Naming an area and giving it its own rules is how a grid of buildings becomes a *city with places in it*. The mechanical payload is modest; the identity payload is large.

What is *not* essential to the feel: six residential subtypes, architectural themes, signature buildings, the full resource-chain economy. Those are depth, added later.

---

## Metropolis v1 adoption

Consistent with the binding decisions in `docs/UNKNOWNS.md` — painted cells along road frontage with CS-style drag painting, ~1–2k buildings at 60 fps, first five minutes = roads → zones → buildings — and with the data model already fixed in `docs/research/zoning-growth.md`:

**Adopt directly**

- **8 m cell**, identical to `ROAD_GRID`. One grid, no second alignment system. Already fixed as `ZONE_CELL = 8`.
- **Cells generated along road frontage**, perpendicular to the segment, on both sides. Painting is only legal on cells a road has produced.
- **Cells are owned by their road.** Deleting a segment removes its cells and demolishes anything standing on them.
- **Drag painting with right-click to erase**, plus straight-line drag as the primary gesture.
- **Lot = width × depth in cells**, width along the frontage. Growth picks a footprint that fits the free run of cells touching the road.
- **A vacancy brake on demand.** Some fixed number of empty finished buildings per zone type sharply suppresses that type's demand. This is the mechanic that stops "paint the whole map" from being a winning move, and it costs almost nothing to implement.

**Simplify for v1**

- **Zone depth: 4 cells (32 m)**, already fixed as `ZONE_MAX_DEPTH = 4`. Half the plausible CS2 value, which keeps lots small, keeps the max footprint modest, and keeps the cell count per block low. Revisit to 6 when building levels arrive and towers need the footprint.
- **Four zone types, not fourteen**: low-density residential, high-density residential, commercial, industry. Office folds into commercial for now; mixed-use is deferred (it needs a building that reports to two demand pools).
- **Lot sizes 2×2 through 4×4** (capped by the 4-cell depth). No 1-wide row housing in v1 — it exists mainly to serve a building type we do not have.
- **Demand as three scalar bars** driven by a small explicit model: residential from job vacancies minus unemployment; commercial from population and unmet goods; industrial from commercial demand plus export. No per-resource chain, no wealth tiers, no household simulation. The *shape* to preserve is the loop and the vacancy penalty, not the resource algebra.
- **No building levels.** Already out of scope for the growth milestone; `level` is reserved in the data model and always written as 1.
- **No themes, no signature buildings, no specialized industry areas.**
- **Straight roads only** means the fan-shaped-strip problem does not arise in v1 — a genuine simplification we get for free from the road MVP decision. Design the cell-generation code so that a curved segment can later emit a fanned strip without the growth code caring.

**Districts in v1: paint and name only**

Ship the district tool as a free-form painted area with a name and a colour, plus one statistic readout (population, or job count). **Ship zero policies at first**, then add exactly two once the sim supports them:

- a **residential tax modifier** (±2%, matching CS2's deliberately narrow range), which needs only the budget system; and
- a **heavy traffic ban**, which in the statistical-flow traffic model of `UNKNOWNS.md` is a simple multiplier on the cost of freight flow through the district's edges rather than a pathfinding exclusion — a good fit for the model we chose, and a good demonstration that districts *do* something.

Everything else (recycling, parking fees, engine bans, speed bumps) waits on systems that do not exist yet.

**Explicitly rejected for v1**

Overlapping/clipped strips at oblique intersections; per-side zoning toggles; land-value feedback into level-ups; the demand info view's itemized factor breakdown. All of these are good, none is required for the first five minutes to work.

---

## Later path

Roughly in the order that each stops being a nice-to-have:

1. **Deepen the strip to 6 cells** and raise the lot cap to 6×6. Cheap, and unlocks the visual jump from "suburb" to "downtown".
2. **Building levels 1–5** on the CS2 model: a per-building surplus (rent minus upkeep) that accumulates and buys an upgrade, plus a land-value field that high-level buildings feed back into, producing the ripple effect. This is the single largest gain in city-feels-alive per unit of work.
3. **Split residential into density bands with a wealth model**, so households choose a band. This is what makes low-rent and row housing meaningful, and it is a prerequisite for mixed-use.
4. **Office as its own zone**, distinguished by producing services rather than goods — needs the resource model below to mean anything.
5. **A real resource economy**: per-resource production and consumption, with commercial/industrial demand driven by the convex shortfall function CS2 appears to use, and outside connections importing to break deadlocks. This is where the demand bars stop being hand-authored and start being emergent.
6. **Mixed-use zoning**, once a building can report floor space into two demand pools at once.
7. **Curved-road zone strips** with proper fan geometry, oblique-intersection clipping, and the resulting sliver handling.
8. **The full district policy set**, which requires pollution, waste, parking, and per-vehicle pathing to exist as simulated quantities.
9. **Themes and signature buildings** — pure content, once the art pipeline can absorb it, and the unlock-on-N-cells-zoned criterion is a cheap progression hook.
10. **Specialized extraction areas** painted over resource-bearing terrain, worked by ploppable extractors rather than growable lots — structurally a different system from zoning and best built after the resource economy lands.

---

## Sources

- [Zoning — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Zoning)
- [Signature buildings — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Signature_buildings)
- [Modding — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Modding)
- [Community-Made Guides — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Community-Made_Guides)
- [Paradox: CS II Feature Highlight #4 — Zones & Signature Buildings](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/zones-signature-buildings)
- [Paradox: CS II Feature Highlight #7 — Maps & Themes](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/maps-themes)
- [Paradox forums: Elucidation of every demand factor](https://forum.paradoxplaza.com/forum/threads/elucidation-of-every-demand-factor.1855666/)
- [Paradox forums: Let's talk about the unlock criteria for signature buildings](https://forum.paradoxplaza.com/forum/threads/lets-talk-about-the-unlock-criteria-for-signature-buildings.1925917/)
- [Paradox forums: 1 Cell Zoned Buildings](https://forum.paradoxplaza.com/forum/threads/1-cell-zoned-buildings.1614098/)
- [Paradox forums: How to set and manage district policies?](https://forum.paradoxplaza.com/forum/threads/how-to-set-and-manage-district-policies.1608883/)
- [Steam guide: Practical Engineering — Efficient Grids](https://steamcommunity.com/sharedfiles/filedetails/?id=3062339423)
- [Steam guide: All possible zoning — 1x1 to 6x6](https://steamcommunity.com/sharedfiles/filedetails/?id=3064264264)
- [Steam guide: Building & Zoning Footprint Sizes](https://steamcommunity.com/sharedfiles/filedetails/?id=3062661544)
- [Steam discussion: What is the real world size of a zone cell](https://steamcommunity.com/app/949230/discussions/0/3937895474111313685/)
- [Steam discussion: Can I change which road has zoning?](https://steamcommunity.com/app/949230/discussions/0/4031347532799475669/)
- [Steam discussion: How to remove a zone grid?](https://steamcommunity.com/app/949230/discussions/0/4526764179299364049/)
- [Steam discussion: Do buildings still level up? How does that work?](https://steamcommunity.com/app/949230/discussions/0/3877095833481124129/)
- [Steam discussion: Commercial/Industrial demand](https://steamcommunity.com/app/949230/discussions/0/3877095833476640911/)
- [Steam discussion: Max building size?](https://steamcommunity.com/app/949230/discussions/0/3875967149486533468/)
- [Steam discussion: Industrial Signature Building question](https://steamcommunity.com/app/949230/discussions/0/4526764179303114860/)
- [gameplay.tips: CS II — All Possible Zoning (1x1 to 6x6)](https://gameplay.tips/guides/cities-skylines-ii-all-possible-zoning-1x1-to-6x6.html)
- [GinX: CS2 — All District Policies Listed & Explained](https://www.ginx.tv/en/cities-skylines-2/all-district-policies-listed-explained)
- [VideoGamer: CS2 policies and how to implement them](https://www.videogamer.com/guides/cities-skylines-2-policies/)
- [GameSkinny: How to set district and city policies](https://www.gameskinny.com/tips/cities-skylines-2-how-to-set-district-and-city-policies/)
- [TheGamer: How to set up districts in CS2](https://www.thegamer.com/cities-skylines-2-how-to-set-up-create-districts-policies/)
- [GameRant: How to upgrade buildings](https://gamerant.com/cities-skylines-2-how-to-upgrade-buildings/)
- [GameRant: How to increase high-density demand](https://gamerant.com/cities-skylines-2-how-to-increase-high-density-demand/)
- [GameRant: How to unlock and place signature buildings](https://gamerant.com/cities-skylines-2-how-to-unlock-and-place-signature-buildings/)
- [SegmentNext: CS2 zoning guide](https://segmentnext.com/cities-skylines-2-zoning/)
- [PCGamesN: CS2 mixed zoning confirmed](https://www.pcgamesn.com/cities-skylines-2/mixed-zoning)
- [Neowin: CS2's new zoning options, signature buildings and more revealed](https://www.neowin.net/news/cities-skylines-2s-new-zoning-options-signature-buildings-and-more-revealed/)
- [Twinfinite: All NA and EU city differences in CS2](https://twinfinite.net/guides/all-na-eu-city-differences-cities-skylines-2/)
- [ZoningToolkit mod (GitHub)](https://github.com/zeeshanabid94/ZoningToolkit)
- [Zoning Toolkit — Paradox Mods](https://mods.paradoxplaza.com/mods/75750/Windows)
- [Cities2Modding info dump (GitHub)](https://github.com/optimus-code/Cities2Modding)
