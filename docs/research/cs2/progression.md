# Cities: Skylines II — Progression: Milestones, XP, Development Trees, and the First Hours

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) gates content: the milestone ladder driven by an experience currency, the development trees bought with development points, expansion permits and map-tile purchase, map/theme selection and starting conditions, and the pacing players actually experience in their first few hours. Compiled to inform an original implementation in *Metropolis*. Everything below is written in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains here (the official wiki included), so the material below comes from many targeted web searches whose results are synthesized summaries of one or more pages — the official wiki, Paradox/Colossal Order dev diaries and feature pages, forum threads, Steam discussions, and guide sites. Every claim carries a tag:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`). Likely accurate, not independently verified.
- **[Dev]** — from Colossal Order / Paradox dev-diary or marketing material (Feature Highlight #10 "Game Progression", #7 "Maps & Themes", DD#10), or press coverage of them.
- **[Community]** — player guides, Steam/Paradox forum threads, guide-site articles. May be patch-specific or personal testing.
- **[Inferred]** — my own reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree; both readings given.

Sister docs: `docs/research/cs2/zoning-districts.md` (the zoning system whose signature-building unlocks hang off progression) and `docs/research/cs2/ux-conventions.md` (the progression panel's place in the UI).

---

## How CS2 does it

### 1. The shape of the system in one paragraph

CS2 replaced CS1's population-threshold unlocks with a two-currency RPG-flavoured structure **[Dev]**. You earn an experience currency by playing well; crossing a threshold grants a **milestone**; each milestone pays out three things — money, **development points**, and **expansion permits** — and also switches on some services, policies, and management screens outright. Development points are then *spent by the player* in per-service **development trees**, so two cities at the same milestone can have different capabilities. Expansion permits are spent buying map tiles. The stated design goal was to decouple "getting the toys" from "having a huge population", so a player who wants to build a small, careful town is not locked out of content and does not have to reach for the unlock-everything switch **[Dev]**.

### 2. Expansion points (XP) — the progression currency

The currency is called **Expansion Points**, shortened to XP in most community writing **[Dev]/[Wiki]**. It accrues two ways:

**Passive.** Awarded on a tick, from the city's **population** and **happiness**. Sources describe it as **16 grants per in-game day**, i.e. roughly every 1.5 in-game hours **[Dev]/[Wiki]**. A city that is growing and keeping citizens content therefore drifts upward on the ladder with no player input at all — this is the "well-run city progresses" channel.

**Active.** Awarded immediately for construction acts: placing or upgrading a service building, placing a signature building, and extending the road network **[Dev]**. Community reporting gives per-building figures that scale with the building's importance and cost — small utility buildings around 100, basic emergency and elementary-education buildings around 300, a high school around 500, a coal power plant around 300, a college around 1,000 **[Community]**. Treat the exact numbers as indicative rather than exact; they come from player observation, not a published table, and the game has been patched repeatedly.

**[Conflict]/[Unknown]** — I could not find a reliable published table of the XP threshold for each milestone. Community sources describe the thresholds as rising steeply, which is what produces the "first milestones fly by, later ones take an hour each" experience players report, but I have no numbers to quote **[Inferred]**.

**The exploit, and why it matters.** Because active XP is granted on *placement* and milestones pay out cash, players discovered that pausing the game and repeatedly placing and demolishing cheap buildings (parks are the usual example) walks the XP bar upward with essentially no city underneath it, and the milestone cash rewards more than cover the placement costs **[Community]**. This is the single most instructive failure in the whole design: the active-XP channel rewards the *act* of building rather than the *existence* of a functioning building, and nothing decays or refunds on demolition.

### 3. Milestones

There are **20 milestones** **[Dev]/[Community]**, running from a tiny hamlet-scale start to a megalopolis-scale end. Community sources report the twenty are grouped under **five larger named tiers** — village, big town, large city, thriving metropolis, megalopolis **[Community]**; I am deliberately not reproducing the individual milestone names here, since they are game text.

Each milestone grants, simultaneously **[Dev]/[Community]**:

| Reward | Notes |
| --- | --- |
| **Money** | A lump sum. Grows with milestone number. Community consensus is these payouts are *large* — large enough that milestone income, not tax income, is the main funding source for the early city, and large enough that several players called them absurd **[Community]** |
| **Development points** | The tree currency, quantity growing per milestone. Reaching all 20 grants exactly enough points to buy out every tree eventually **[Dev]** |
| **Expansion permits** | Map-tile purchase rights, quantity growing per milestone |
| **Raised loan ceiling** | The maximum you may borrow goes up **[Dev]** |
| **Direct feature unlocks** | New service categories, policies, and management UI switch on outright, without costing points **[Dev]** |

Two structural points. First, milestones are **not** population gates — nothing checks that you have N residents, which is why milestone names that sound demographic ("large town") can be reached by a city that has nothing of the kind **[Community]**. Second, the direct feature unlocks and the point payout are separate channels: a milestone might hand you *access* to a whole service category, whose first tier is then free, while the good buildings inside it still cost points. Reported example: elementary and high schools arrive free with the education category at the second milestone; college and university are purchased tree nodes **[Community]**.

Roads, electricity, and water/sewage are available from the moment the game starts, before any milestone — you cannot build a city at all without them **[Community]**. Their *trees* still exist and still want points; you simply have none until the first milestone lands. The **district tool** is reported to unlock at the fourth milestone **[Community]** (also noted in `zoning-districts.md`).

### 4. Development trees

Each service area has its own tree; sources count **around 11 categories** **[Community]** — roads, electricity, water and sewage, garbage, healthcare and deathcare, fire and rescue, police, education, transportation, communications, parks/land services, with some variance in how sources group them.

The structure **[Dev]/[Wiki]**:

- A tree is divided into **tiers**, each tier holding a varying number of **nodes**.
- **Tier 1 costs 1 point, tier 2 costs 2, tier 3 costs 4, tier 4 costs 8** **[Wiki]** — a clean doubling.
- The **tier-1 node is granted automatically** when you gain access to the service. Unlocking public transport, for instance, immediately gives buses, taxis, stops, and the line tool; you do not spend a point to be able to use the category at all **[Dev]**.
- Trees **branch**. You must own a node's predecessor on its branch, but you do **not** have to clear a whole tier to descend one branch. The published example is that you can buy your way down to an international airport without ever buying water transport, trams, or subway **[Dev]**.

The consequence the developers were reaching for: the tree is a **prioritization** device, not a ladder. Money-losing cities buy the cheap efficient nodes; sprawling cities buy highways and interchanges; the point economy is tight early and irrelevant late, since all 20 milestones together fund the whole thing **[Dev]/[Inferred]**.

Community guidance about *what* to buy first is consistent and worth noting because it reveals what the trees actually gate: transportation first (it is the largest lever on traffic, which is the game's main failure mode), then education's higher tiers (educated citizens unlock office/high-tech demand), then the cheaper power sources **[Community]**.

### 5. Expansion permits and map tiles

Map area is a third currency track. A new city begins with **9 unlocked tiles**, roughly the CS1 starting area **[Dev]**. CS2 tiles are much smaller — about **one third** of a CS1 tile — but there are **441** of them in total, giving roughly **159 km²** of playable area, around five times CS1 **[Dev]**.

Buying a tile costs **one permit plus money** **[Community]**. The money price is not flat: it is derived from the tile's **buildable area and its natural resources**, so a resource-rich flat tile runs several times the price of a tile that is mostly ocean — community figures put the range around 9,000 for open water to about 30,000 for a good land tile **[Community]**. The map-tile UI is a top-down mode with a free, rotatable camera, and selecting a tile displays its buildable area, its resources, and its price **[Dev]**.

Permits are the binding constraint rather than money, in practice: you can be rich and still unable to expand because the next milestone has not paid out **[Inferred]**. Community threads confirm not every tile on a map is purchasable in the base game, which is what motivated the unlock-all-tiles mods **[Community]**.

### 6. Map selection, themes, and starting conditions

**Maps.** The base game shipped **10 starting maps** **[Community]**, drawn from recognisable real-world geographies (Scottish highlands and lochs, Finnish lakes and forests, alpine snow peaks, a flat barrier-island chain). What differentiates them mechanically, per the map-select screen and community ranking guides **[Dev]/[Community]**:

- **Buildable flat area** — the single biggest difficulty factor. Flat island and plains maps are the standard beginner recommendations.
- **Natural resource distribution** — oil, ore, forest, fertile land. Maps are explicitly described as oil-rich or forest-rich, and this steers which specialized industry is viable.
- **Outside connections present** — road, rail, ship, air. A map without a navigable water route simply cannot use water transport, and a map's connection mix shapes early import/export.
- **Climate/seasons** — maps carry a climate, which drives the seasonal cycle, snowfall, and heating demand.

**Themes.** A **theme** is chosen for the city and controls the architectural and road style — North American or European **[Dev]**. Each map has a default theme matching its inspiration. The theme is cosmetic with respect to building statistics (see `zoning-districts.md` §2), and zoning can mix both within one city.

**Game-start options.** Before the first frame, the new-city screen exposes toggles that are **permanent for that save** **[Community]**: **unlimited money**, **unlock all**, and **natural disasters**. The first two cannot be turned off later. "Unlock all" is the explicit escape hatch from the entire progression system — the dev-diary framing is that the progression design exists so that players do not *feel obliged* to tick it **[Dev]/[Inferred]**.

### 7. Pacing of the first hours

Assembling the community accounts into a rough narrative of a first session **[Community]**:

- **Minutes 0–10.** Roads from the outside connection, a first residential block, water pump and sewage outlet, one power plant. Nothing is gated — the three starting services cover it. Money is draining and there is no income, so experienced players **pause aggressively** and unpause only to let growth tick.
- **First milestone.** Arrives quickly; the first points land, and the first choice is made. This is the moment the game's structure becomes visible to the player.
- **Milestones 2–4.** Fast, dense with unlocks: education, emergency services, the district tool, more policies. Repeated community advice is *not* to spend here on public transport even though it is tempting, because a town this size cannot support the upkeep; wait several milestones **[Community]**.
- **Hour 1–3.** The rhythm settles into: extend roads → zone → a milestone fires → cash and points arrive → buy a node → the new node creates a new problem (a landfill fills, traffic knots) → solve it → the solving grants active XP → next milestone. Milestone cash dominates the budget in this window; genuine tax profitability comes later.
- **Later.** XP thresholds climb, passive XP from a large happy population becomes the dominant channel, and progression becomes a background drip rather than a beat **[Inferred]**.

**Reception is split, and the split is informative [Community]/[Conflict].** Forum threads run both ways: one camp finds progression far too fast and too constrained — everything unlocked before the city is interesting, and the ladder dictating *when* you may build a school; the other finds it slow relative to expectations. What both camps agree on is that the milestone **cash** rewards are oversized enough to flatten the early economic challenge, and that the placement-based XP channel is gameable. The thing almost nobody criticises is the development tree itself — the point-spending choice is broadly liked.

---

## What makes it feel like CS2

Strip the numbers away and progression contributes five sensations:

1. **A visible ladder with a bar that moves on its own.** The progression readout sits in the corner and creeps forward while you play. It converts "I built some roads" into measurable advancement, and it means an idle minute is never a wasted minute for a healthy city.
2. **Milestones are *events*.** Three currencies plus feature unlocks plus a name change all land at once, with a panel. It is a punctuation mark in an otherwise continuous activity — the thing that makes a session have chapters.
3. **You choose what you get.** The development tree is the difference between "the game gave me a school" and "I decided my city needed a school more than a bigger road". That authorship is disproportionately large for how cheap the mechanic is.
4. **Content arrives at the moment it becomes a problem.** Garbage tools show up around when garbage becomes visible; the district tool arrives when the city is big enough to have neighbourhoods. Well-tuned gating reads as the game *responding* rather than restricting.
5. **The map is a resource you buy into.** Expansion permits make territory something earned. Standing at the edge of your 9 tiles and looking at the tile you want next is a real motivation loop.

What is **not** essential to the feel: twenty milestones rather than eight, eleven separate trees, four-tier point doubling, resource-priced tiles, 441 tiles, ten maps, two themes. Those are content volume on top of a small mechanic.

What is **actively bad** and should not be copied: milestone cash large enough to make taxation irrelevant; XP for the act of placing rather than for what stands built.

---

## Metropolis v1 adoption

Consistent with the binding decisions in `docs/UNKNOWNS.md` — CS2-mirroring UI structure with an original progression panel, first five minutes = roads → zones → buildings on an empty map, ~1–2k buildings, statistical traffic — progression should be the *thinnest structure that gives the first hour chapters*.

**Adopt directly**

- **One earned currency, thresholds, named tiers.** Call it growth points internally; the ladder is the spine.
- **A dual XP channel: passive from population and happiness, active from construction.** Both matter. Passive makes a running city feel alive; active makes the first two minutes — before any population exists — actually produce progress. Without the active channel a brand-new city's bar sits at zero and the opening feels dead.
- **Milestones pay out multiple things at once, with a panel.** Money, points, and a feature unlock together. The simultaneity is what makes it an event.
- **A player-spent point currency over a small tree.** This is the highest feel-per-line-of-code item in the whole document.
- **Tier-1 of any unlocked category is free.** Access and depth are separate gates. Prevents the sour case of "you unlocked garbage collection but cannot afford a landfill node".
- **Branching without tier-clearing.** You must own a node's parent; you need not own its siblings.
- **Point cost doubling per tier** (1 / 2 / 4 / 8). It is legible, it needs no balancing table, and it naturally makes late nodes feel weighty.

**Fix CS2's mistakes rather than inheriting them**

- **Active XP is granted on a building *existing*, not on placement** — award it when construction completes, and **revoke it on demolition**. This kills the place-and-delete exploit outright and costs one field on the building record.
- **Milestone cash is modest.** Enough to buy the service the milestone just unlocked, not enough to fund the city. Tax revenue must stay the primary income or the economy has nothing to say.
- **No population thresholds anywhere**, matching CS2's stated intent — but *do* pick tier names that describe a rough size, and tune thresholds so the name is usually roughly honest.

**Simplify for v1**

- **8 milestones, not 20.** Enough for a full first session to cross five or six of them. Thresholds on a smooth superlinear curve (each roughly 1.6–1.8× the last) so early ones land in a minute or two and later ones in ten.
- **4 development trees, not 11**, matching the systems that exist: **roads**, **utilities** (power + water + sewage), **civic services** (whatever emergency/education/health we ship first), **land** (parks, districts, tile purchase). Three tiers each, two to four nodes per tier. Roughly 30 nodes total — a panel that fits on one screen.
- **No expansion permits and no tile purchase in v1.** The whole map is buildable from the start. Territory expansion is a strong loop but it presupposes a map big enough to withhold parts of, and our first maps will not be. Reserve the currency name.
- **Map selection: 3–4 handcrafted maps, no themes, no climate.** Differentiate them purely on the two axes that matter and that we can actually simulate: **buildable flat area** and **which outside connections exist** (highway always; rail on one map). Resource distribution waits for the resource economy.
- **Starting conditions: fixed.** One starting cash figure, a highway connection, nine-ish tiles' worth of terrain, no loans. A **sandbox toggle** (unlimited money + everything unlocked) at new-game time, permanent for the save, exactly as CS2 does — it is the cheapest possible answer to "I just want to build".
- **Milestone feature unlocks, ordered to match when the problem appears.** Draft order: (1) basic zoning + one power source + water — free at start; (2) sewage and garbage; (3) education and the first emergency service; (4) **districts and policies**, mirroring CS2's fourth-milestone district unlock; (5) public transport; (6) higher road classes; (7) parks and land value tooling; (8) the remaining service depth.

**Explicitly rejected for v1**

Loan ceilings that scale with milestone; per-tile resource pricing; signature-building unlock criteria (they are noted in `zoning-districts.md` as a later hook); theme selection; seasons and climate; achievement-style one-off goals separate from the ladder.

---

## Later path

Roughly in the order each stops being a nice-to-have:

1. **Expansion permits and tile purchase**, once maps are large enough that withholding two thirds of one is meaningful. Price tiles on buildable area first; add resources when the resource model lands.
2. **Widen the trees** — split utilities into power/water/waste, split civic into health/safety/education, add a communications-equivalent — as each underlying system ships. The tree should always be a mirror of what the sim actually models, never a promise.
3. **Loans and a milestone-scaled credit ceiling**, once the budget system is deep enough that borrowing is a real decision rather than free money.
4. **Map themes** as a purely cosmetic building-catalogue swap, once the art pipeline can absorb a second catalogue. Cheap, high perceived value, zero sim risk.
5. **Climate and seasons** feeding heating demand and a visual cycle — a large feel win, but it touches the whole utility model.
6. **Resource-bearing terrain** and maps that differ by what they are rich in, which is what finally makes map choice a strategic decision rather than an aesthetic one.
7. **Milestone-linked unique buildings** on the signature-building model — unlock on a count of zoned cells or grown buildings, free to place, one per city. Pure content, and the cheapest possible way to make a milestone feel like a reward rather than a menu update.
8. **A second progression axis** (city specialization, or a policy/ordinance track) once the single ladder stops carrying a 20-hour city. CS2 arguably needed this and did not have it.
9. **Difficulty presets** that scale starting cash, milestone payouts, and XP rates together — the honest answer to the "too fast / too slow" split in CS2's reception, which is not a tuning problem with one right answer.

---

## Sources

- [Progression — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Progression)
- [Development Tree — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Development_Tree)
- [Beginner's guide — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Beginner%27s_guide)
- [Cities Skylines II — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Cities_Skylines_II)
- [Paradox: CS II Feature Highlight #10 — Game Progression](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/game-progression)
- [Paradox: CS II Feature Highlight #7 — Maps & Themes](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/maps-themes)
- [Paradox: CS II Feature Highlight #8 — Climate & Seasons](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/climate-seasons)
- [Colossal Order: Development Diary #7 — Maps & Themes](https://colossalorder.fi/news/development-diary-7-maps-themes/)
- [Paradox forums: Development Diary #10 — Game Progression](https://forum.paradoxplaza.com/forum/threads/development-diary-10-game-progression.1596392/)
- [Paradox forums: Progression system is completely, utterly broken](https://forum.paradoxplaza.com/forum/threads/progression-system-is-completely-utterly-broken.1604508/)
- [Paradox forums: Skylines 2 suggestion — map editor, city start, progression, demand & zoning](https://forum.paradoxplaza.com/forum/threads/skylines-2-suggestion-map-editor-city-start-progression-demand-zoning.1628343/)
- [Paradox forums: Why can't I buy ALL tiles?](https://forum.paradoxplaza.com/forum/threads/why-cant-i-buy-all-tiles.1610255/)
- [Steam discussion: My thoughts after 10 hours and 20k pop](https://steamcommunity.com/app/949230/discussions/0/3877095833475965133/)
- [Steam discussion: Cannot purchase every land square?](https://steamcommunity.com/app/949230/discussions/0/5540052310305673569/)
- [Steam discussion: Unable to change starting tiles in the map editor](https://steamcommunity.com/app/949230/discussions/0/4691154443773756167/)
- [Steam guide: The Achievements Guide for Mayors](https://steamcommunity.com/sharedfiles/filedetails/?id=3062023021)
- [PCGamesN: CS2 massively overhauls how your metropolis progresses](https://www.pcgamesn.com/cities-skylines-2/game-progression)
- [PCGamesN: The best Cities Skylines 2 maps](https://www.pcgamesn.com/cities-skylines-2/maps)
- [Dexerto: CS2 Milestones explained — all rewards & unlocks](https://www.dexerto.com/gaming/cities-skylines-2-milestones-explained-all-rewards-2348210/)
- [Dexerto: CS2 Development Trees guide — all unlockables and costs](https://www.dexerto.com/gaming/cities-skylines-2-development-trees-unlockables-and-costs-2349659/)
- [GamesRadar: CS2 development nodes progression guide](https://www.gamesradar.com/cities-skylines-2-development-nodes/)
- [GameRant: Every development tree (and what to buy first)](https://gamerant.com/cities-skylines-2-every-development-tree-and-what-to-buy-first/)
- [GameRant: How to buy more land](https://gamerant.com/cities-skylines-2-how-to-buy-more-land/)
- [GameRant: The best starting maps](https://gamerant.com/cities-skylines-2-best-starting-maps-initial-layout/)
- [GameRant: Easiest maps for beginners, ranked](https://gamerant.com/cities-skylines-2-easiest-beginner-maps/)
- [GameRant: 8 beginner tips](https://gamerant.com/cities-skylines-2-beginner-tips/)
- [TheGamer: Best development tree unlocks first](https://www.thegamer.com/cities-skylines-2-best-development-tree-unlocks-first/)
- [TheGamer: Best starting maps ranked](https://www.thegamer.com/cities-skylines-2-starting-maps-ranked/)
- [TheGamer: Beginner tips and tricks](https://www.thegamer.com/cities-skylines-2-beginner-tips-tricks/)
- [eXputer: The best development tree unlocks](https://exputer.com/guides/cities-skylines-2-development-tree-unlocks/)
- [Prima Games: Best development tree unlocks](https://primagames.com/tips/best-development-tree-unlocks-cities-skylines-2)
- [TheReviewGeek: CS2 progression system and XP explained](https://www.thereviewgeek.com/citiesskylines2-guide-progressionsystem/)
- [Neowin: CS2 doesn't solely rely on population numbers for progression](https://www.neowin.net/news/cities-skylines-2-doesnt-solely-rely-on-population-numbers-for-progression/)
- [GamerMatters: CS II has what's essentially XP and skill trees](https://gamermatters.com/cities-skylines-ii-has-whats-essentially-xp-and-skill-trees/)
- [TryHardGuides: CS II teases milestones, XP and more](https://tryhardguides.com/cities-skylines-ii-teases-milestones-xp-and-more-in-new-game-progression-trailer/)
- [VideoGamer: CS2 beginners guide — six steps](https://www.videogamer.com/guides/cities-skylines-2-beginners/)
- [VideoGamer: How to buy more land](https://www.videogamer.com/guides/cities-skylines-2-buy-more-land-how-to/)
- [Shacknews: How to buy extra land plots](https://www.shacknews.com/article/137705/how-to-buy-land-cities-skyline-2)
- [GGRecon: How to use cheats, including infinite money & unlock all](https://www.ggrecon.com/guides/cities-skylines-2-cheats/)
- [Digital Trends: CS II beginner's guide](https://www.digitaltrends.com/gaming/cities-skylines-2-beginner-guide/)
- [Xbox Wire: The road from village to metropolis](https://news.xbox.com/en-us/2023/10/24/cities-skylines-2-helpful-tips/)
- [The Nerd Stash: All starting maps ranked](https://thenerdstash.com/cities-skylines-2-all-starting-maps-ranked/)
- [UnlockAllTilesMod (GitHub)](https://github.com/Wayzware/UnlockAllTilesMod)
