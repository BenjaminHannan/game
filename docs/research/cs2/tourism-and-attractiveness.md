# Cities: Skylines II — Tourism and City Attractiveness

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) models city attractiveness, tourist inflow across outside connections, tourist behaviour inside the city, hotels and lodging, and the way tourist spending feeds commercial demand and company revenue. Compiled to inform an original implementation in *Metropolis*. Everything below is written in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most of the relevant domains in this environment (the Paradox wiki included — a direct fetch of the Tourism page returned an egress block), so the material below comes from many targeted web searches whose results are synthesized summaries of one or more pages. Because primary tables could not be read directly, every claim carries a tag:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`). Likely accurate, not independently verified.
- **[Dev]** — from Colossal Order / Paradox marketing or dev-diary material (feature highlight pages, press coverage of them).
- **[Community]** — player guides, Steam discussions, Paradox forum analyses, modder writeups. May be patch-specific or personal testing.
- **[Inferred]** — my own reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree, or the game's own behaviour was reported as buggy; both readings given.

Sister docs: `docs/research/cs2/services-social.md` (parks, landmarks, and the leisure need — attractiveness is explicitly *not* land value there), `docs/research/cs2/demand-growth.md` (commercial demand, which tourists feed), `docs/research/cs2/economy.md` (company revenue and the immaterial-goods model that lodging belongs to), `docs/research/cs2/transit.md` (outside connections as line endpoints), `docs/research/cs2/environment.md` (seasons and the indoor-behaviour shift), `docs/research/cs2/citizens.md` (the leisure decision rule tourists reuse).

---

## How CS2 does it

### 1. What a tourist actually is

A tourist in CS2 is an agent of the same underlying kind as a citizen, but with no home in the city. The wiki's framing, as reported: tourists are non-resident citizens who arrive over an outside connection and — if they stay longer than a day — sleep at a hotel **[Wiki]**. They are explicitly described as part of the city's total economic activity: they bring outside money in, spend it at businesses, and pay fares on public transport **[Wiki]**.

That framing matters more than it looks. It means CS2 did *not* build a separate abstract "tourism income" subsystem the way many builders do. Tourists are simulated bodies moving through the same pathfinding, the same transit lines, and the same shop-and-leisure decision machinery as residents. Every krona of tourism revenue arrives as an actual purchase at an actual company at an actual address. **[Inferred, but strongly implied by the wiki's description of tourists making "similar calculations" to citizens.]**

Tourists carry a **wealth tier** — low, medium, high — that shapes what they seek. Community summaries describe low-wealth tourists as budget travellers who gravitate to parks and small free attractions, medium-wealth tourists as the ones who spend on shopping, dining, and entertainment, and high-wealth tourists as preferring premium lodging and the marquee attractions **[Community]**. Whether the wealth tier is assigned at spawn from a distribution influenced by city attractiveness, or is uniform, is not documented **[Inferred: assigned at spawn; a higher-attractiveness city plausibly draws a richer mix, but no source states this]**.

### 2. City attractiveness: the single global number

**Attractiveness is a city-wide scalar**, and search results consistently describe it as *the* primary determinant of how many tourists visit **[Wiki]/[Community]**. It is not a per-district number and not a per-tourist utility function — one value for the whole city, which the arrival rate reads.

**What contributes.** Individual buildings carry their own attractiveness value, and those values sum into the global total **[Wiki]**:

- **Parks and recreation buildings** are the bread-and-butter contributors — the wiki describes attractiveness as primarily a parks-and-recreation building property **[Wiki]**.
- **Sports venues and other dedicated city attractions** contribute more heavily **[Wiki]**.
- **Landmarks** are the top of the scale. They cost no development points to unlock but are gated behind punishing purchase price and upkeep, so they are late-game purchases **[Community]**. A widely-cited example figure: a large cathedral landmark contributing on the order of **+175 attractiveness** alongside **+125 indoor recreation** **[Community]** — two separate channels from one building, which is the design pattern worth noting.
- **Signature buildings** — the one-off unique ploppables that belong to zone categories (see `zoning-districts.md` §2) — frequently carry an attractiveness effect. Reported example: a small diner-style signature building giving a **+1% citywide attractiveness multiplier** while itself having an attraction value of **6** **[Community]**. So signature buildings mix *flat* contributions and *percentage* multipliers on the global total, which is a meaningfully different lever from a park's flat number.
- **Policies.** A **City Promotion** policy raises attractiveness through advertising, explicitly to draw more tourists and more revenue, at the cost of raised crime around attractions **[Community]**. A **Recreational Use** policy is described as boosting tourism and tax income while lowering crime, at zero cost **[Community]**. So attractiveness is also a policy dial, not only a build-things dial.
- **Weather and season** modulate the tourist count on top of attractiveness — the number of visitors varies through the year, with summer the peak and winter the trough unless the city has winter-appropriate attractions **[Wiki]/[Dev]**. The tourism info panel reportedly shows a weather effect line explicitly **[Community]**. **[Conflict/unclear]**: sources describe seasonality as acting on *tourist numbers*; whether it modifies the global attractiveness value itself or is a separate multiplier at the arrival step is not stated. The observable behaviour is identical.

**What is not clearly established.** No source I found states a subtraction term — pollution, noise, crime, or traffic reducing attractiveness directly. Given that CS2 routes park/landmark effects into *wellbeing* rather than land value (see `services-social.md`), and that crime is described as a *side effect* of the promotion policy rather than a feedback into attractiveness, my read is that **attractiveness in CS2 is additive-only from attraction buildings, with no environmental penalty term** **[Inferred]**. That is a simplification a player would notice: an ugly, smog-choked city with a big cathedral still pulls tourists.

**Presentation.** Attractiveness has its own **info view**, sitting under a tourism tab. It shows the global total, paints the terrain on a green-to-blue attractiveness gradient (so the player can see each attraction's radius of influence), highlights hotels, tourists, parks and attractions on the map, and reports the total tourist count, the weather effect, and the average nightly hotel cost **[Community]/[Wiki]**. The radius rendering confirms that individual attractiveness is also a **spatial field**, not just a summand.

### 3. Two roles for one number

This is the key structural point, and it is stated fairly clearly across sources: a building's attractiveness value does **double duty** **[Wiki]**.

1. **Globally**, it sums into city attractiveness, which sets how many tourists arrive.
2. **Locally**, it is the weight a tourist already in the city uses to pick where to go.

So building a landmark both increases inflow *and* redirects the tourists already present. The two effects are naturally coupled without any extra system, which is elegant and worth copying.

### 4. Arrival: how tourists enter

Tourists enter over **outside connections** — the same map-edge endpoints described in `transit.md` §"outside connections are just the far end of a line" **[Wiki]/[Dev]**.

- At game start only the **highway** connection exists, so early tourists arrive by car **[Community]**.
- Building **passenger rail** to the map edge, an **airport**, and a **passenger harbour** each opens an additional inbound channel — regional trains, planes, cruise ships **[Dev]/[Community]**. The Bridges & Ports content's passenger terminal is described as giving both citizens and tourists a new way in and out **[Dev]**.
- Multiple sources agree the practical ceiling on tourist numbers is **outside-connection capacity**, not attractiveness — a highly attractive city with one highway simply cannot ingest the tourists it has earned **[Community]**. Players routinely give the advice "max your connections" alongside "build attractions".
- A **Boost Connections** policy raises outside-connection traffic capacity by a reported **20%**, applying across boats, planes, trains, and private cars **[Community]**.
- Players deliberately restrict outside traffic to a single station so they know where arrivals materialize and can plan onward transit from one point **[Community]** — a per-station "accepts outside traffic" toggle, which is a nice UI affordance in its own right.

**[Inferred]** The arrival model is therefore roughly: a target tourist population derived from `attractiveness × seasonal modifier`, throttled by aggregate connection capacity, with arrivals distributed across whichever connections exist. No source gives a formula.

### 5. Behaviour in the city: hotels, leisure, spending

**Lodging.** Hotels are ordinary **commercial companies** that sell an **immaterial good: lodging** **[Wiki]**. This is the same economic category as the office sector's software and financial services (see `economy.md`) — there is no freight chain behind a hotel room. Hotels grow in **both low-density and high-density commercial zones**, and additionally exist as a set of **signature commercial buildings** that provide lodging **[Wiki]**. Community descriptions list the variety as hostels, motels, lodgings, and full hotels **[Community]**; a progression unlock (a tourist-destinations node) gates them, after which they appear in ordinary commercial zoning rather than being ploppable **[Community]**.

The critical consequence: **you do not place hotels, you create the conditions for them.** A hotel appears when lodging demand exists and a commercial lot is available — the player's lever is tourist demand plus zoned commercial capacity, not a build button. That is consistent with CS2's whole growable-company model, and it is also the single most complained-about part of the system (§7).

**Length of stay.** Tourists staying more than a day need a hotel room **[Wiki]**. The implication is that tourists who arrive with no lodging available make a **day trip** and leave the same evening **[Inferred]** — which is exactly what players describe seeing when hotels fail to spawn **[Community]**.

**Leisure choice.** Tourists run essentially the same leisure decision as residents (see `citizens.md` §leisure): compare candidate destinations' leisure value against travel distance and pick the best trade-off — but anchored on the **hotel** rather than the home **[Wiki]**. Layered on top is an attractiveness preference: destinations flagged as **attractions** (the high-attractiveness ones) are sought out *even when a closer ordinary leisure venue exists* **[Wiki]**. So the rule is not pure distance-discounted utility; attractions get a thumb on the scale. Tourists find leisure in shops, parks, sports venues, and landmarks **[Wiki]** — note that *shops* count, which is how retail spending and leisure satisfaction end up as the same trip.

**Spending.** Tourists spend at businesses and pay transit fares **[Wiki]**. Their consumption feeds the **commercial demand** signal: guides state plainly that tourists drive commercial demand by shopping and by buying lodging **[Community]**, and the standard fix advised for a commercial zone showing a not-enough-customers complaint is, among other things, more tourists **[Community]**. Compare `demand-growth.md` §commercial, which already records "residents and tourists" as the demand numerator. Hotels are reported to be a substantial net contributor to the treasury, via the ordinary company-tax path rather than a special tourism income line **[Community]**.

**Placement advice that reveals the model.** Community guidance is to site attractions in or adjacent to main commercial districts and to connect them well by transit **[Community]**. That advice only pays off if tourist spending is *spatially local to where tourists physically are* — further evidence the money flows through real trips to real companies **[Inferred]**.

### 6. Weather and season, concretely

Beyond the seasonal tourist-count swing already noted: CS2's climate system makes citizens (and by extension tourists) prefer **indoor** venues when it is cold or raining, shifting patronage from parks toward restaurants, cinemas, and other indoor leisure **[Dev]** (recorded in `environment.md` §weather). So winter does not merely reduce tourists — it *reallocates* the ones present from outdoor attractions to indoor ones. A city whose entire attractiveness portfolio is open-air parks has a much worse winter than one with museums and arenas **[Inferred from the two mechanics combined]**.

### 7. Where it does not work well

Honest accounting, because it tells us what to avoid:

- **Hotels frequently fail to spawn.** Across Steam and Paradox forum threads, players with high attractiveness and plenty of zoned commercial report getting no lodging companies at all, and consequently masses of tourists who never stay a night **[Community]/[Conflict — this is reported as a bug, not intended behaviour]**. Patch 1.1.10f1 is described as including fixes for tourism and specifically for hotels not appearing in commercial zones **[Community]**.
- The root of the frustration is structural, not just a bug: because lodging demand is buried inside the general commercial demand signal, the player has **no direct lever and no clear readout** on why hotels are or are not appearing. A demand bar labelled "commercial" cannot tell you that what the city needs is specifically rooms.
- Tourism arrived feeling like a **late-game bolt-on**: landmark price tags and upkeep put the strongest attractiveness sources far out of reach, so for most of a playthrough tourism is a trickle that does not repay attention **[Community]/[Inferred]**.

---

## What makes it feel like CS2

Stripping out the implementation, the experience is built from a small number of load-bearing ideas:

1. **One legible number the player can chase.** City attractiveness is a single headline figure with its own info view and its own suitcase-icon tab. Players optimize it the way they optimize happiness. Legibility is the feature.
2. **Buildings you place *cause* that number, visibly.** Each park and landmark shows its attractiveness contribution on its tooltip before purchase, and paints a coloured radius on the map after. Cause and effect are never mysterious.
3. **The same number does two jobs**, so investing in one landmark both brings more tourists to the city and pulls the existing crowd across town to see it. The player watches the pedestrian flow change.
4. **Tourists are visibly *foreign*.** They come in through a specific gate — that airport, that station — and you can watch them fan out from it. Building the airport and seeing arrivals begin is a distinct, memorable moment.
5. **Tourism is an economy, not a score.** The payoff is not a points counter; it is hotels growing in your commercial zone, transit farebox revenue rising, and the not-enough-customers complaints going quiet. Tourism is a *supply of customers*.
6. **Seasonality makes the city breathe.** A summer peak and a winter dip give the calendar meaning and reward a diversified portfolio of attractions.
7. **Landmarks as aspiration.** Expensive, prestigious, one-per-city buildings that a player saves up for. This is the emotional core of the whole system and it barely depends on the simulation at all.

---

## Metropolis v1 adoption

Consistent with `services-social.md`, which puts attractiveness and tourism in the *later* bucket for the services milestone, and `transit.md`, which defers outside connections — **v1 ships no tourism.** But the v1 data model should not make tourism expensive to add later. Concretely:

**Adopt in v1 (cheap, forward-compatible):**

- **An `attractiveness` field on the building definition**, alongside the existing leisure/service fields, defaulting to 0. Parks and any decorative buildings get a small non-zero value. Nothing reads it in v1. This costs one number in a table and saves a data migration later.
- **A city-level `attractiveness` aggregate** computed as the plain sum of placed buildings' values, displayed nowhere in v1 but present in the city stats struct. Sum-on-change, not per-tick.
- **Keep the leisure field and the attractiveness field separate** from the start. CS2's cathedral example (+recreation *and* +attractiveness as two distinct numbers) is the right shape: a building can be pleasant for residents, impressive to outsiders, or both, in different proportions. Collapsing them into one number is the mistake that would be painful to undo.
- **No penalty term.** Attractiveness is additive-only, matching CS2. Pollution and crime already hurt via wellbeing; a second coupling adds no new player decision.

**Explicitly deferred in v1:**

- No tourist agents of any kind. v1 has no per-citizen agents either (see `citizens.md` §"no per-citizen daily schedule"), so tourists as agents are doubly out of scope.
- No hotels, no lodging good, no outside connections, no seasons.
- No tourism info view, no tourism tab, no attractiveness readout in the UI. Showing a number the player cannot influence in a meaningful loop is worse than showing nothing.

**One decision to lock now.** When tourism does arrive, it should be **statistical, not agent-based**, matching the traffic decision already taken in `UNKNOWNS.md`. A tourist population number, distributed over attractions by a distance-and-attractiveness weighting, is the analogue of the statistical flow model — and it produces the same visible outcomes (busy attractions, transit ridership, commercial customers) at a fraction of the cost. Metropolis should not ship per-tourist pathfinding before it ships per-citizen pathfinding.

---

## Later path

Ordered so that each step is playable and each depends only on the previous ones:

1. **Attractiveness surfaced.** Turn on the city attractiveness total and a tooltip line on each building showing its contribution. No tourists yet — but the player begins building a portfolio. Depends on: nothing beyond v1.
2. **Outside connections.** A highway edge connection first, then a rail endpoint. Required prerequisite for everything below; also delivers inbound population growth, which is valuable on its own. Depends on: the transit milestone (`transit.md` step 4).
3. **A statistical tourist population.** `tourists = f(attractiveness) × seasonal_modifier`, hard-capped by summed outside-connection capacity. One number, updated per game-month. Show it in a tourism panel with the three inputs itemized — attractiveness, season, capacity — so the player can see which one is binding. That itemized readout is the fix for CS2's biggest legibility failure.
4. **Tourists as commercial customers.** The tourist population adds to the commercial demand numerator and to per-company revenue, weighted by each company's distance to the nearest attraction and to the arrival gates. This is where tourism starts paying, and it reuses the existing demand machinery entirely.
5. **Lodging as a distinct demand channel.** A `lodging` company type growing on commercial cells, with **its own visible demand sub-bar** rather than being folded into general commercial. Tourists beyond a day-trip threshold need rooms; unmet room demand shows as an explicit shortfall, not as a mystery. This is the deliberate divergence from CS2 — same simulation, far better instrumentation.
6. **Attractiveness as a spatial field.** Per-building radius, an info-view gradient, and tourist distribution weighted by local field strength rather than city totals. Makes *where* you put the museum matter.
7. **Landmarks.** Expensive, unique, high-attractiveness ploppables with real upkeep, unlocked by progression. Deliberately last: they are the aspirational payoff and land best when the systems beneath them already reward the investment.
8. **Seasons and weather coupling.** A summer/winter tourist swing plus an indoor/outdoor reallocation, so an all-parks portfolio underperforms in winter. Depends on a climate system existing at all.
9. **Tourist agents.** Only after per-citizen agents and per-agent pathfinding exist. At that point tourists are a citizen variant with a hotel instead of a home and an attraction-biased leisure rule — a small amount of new code on top of a large amount of existing code, which is the right time to do it.

Two things to consciously *not* copy: burying lodging demand inside commercial demand (step 5 fixes this), and gating the entire payoff behind landmark price tags so tourism is invisible for the first several hours (steps 3–4 must be rewarding on their own, with only cheap parks built).

---

## Sources

- [Tourism — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/index.php?title=Tourism) (via search summaries; direct fetch egress-blocked)
- [Info views — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Info_views)
- [Landmarks — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/index.php?title=Landmarks)
- [Signature buildings — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Signature_buildings)
- [Services — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Services)
- [Transportation — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Transportation)
- [Patch 1.1.X — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Patch_1.1.X)
- [Findings: Tourism — Paradox Interactive Forums](https://forum.paradoxplaza.com/forum/threads/findings-tourism.1616618/)
- [Is tourism still bugged? How do I increase tourists visiting my city? — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/is-tourism-still-bugged-how-do-i-increase-tourists-visiting-my-city.1713891/)
- [Cannot get "lodging" commercial demand (aka hotels) — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/cannot-get-lodging-commercial-demand-aka-hotels.1612383/)
- [Does Tourism work correctly? — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/does-tourism-work-correctly.1606093/)
- [Patch Notes 1.1.10f1 — Paradox Forums](https://forum.paradoxplaza.com/forum/threads/patch-notes-1-1-10f1.1711048/)
- [Cities: Skylines II Feature Highlight #8: Climate & Seasons — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/climate-seasons)
- [Cities: Skylines II Feature Highlight #5: City Services — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies)
- [Cities: Skylines II Feature Highlight #4: Zones & Signature Buildings — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/zones-signature-buildings)
- [Cities: Skylines II Feature Highlight #3: Public & Cargo Transportation — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation)
- [Bridges & Ports Dev Diary #2 — Paradox Interactive](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/bridges-and-ports-dev-diary-ports)
- [How To Get More Tourists In Cities: Skylines 2 — TheGamer](https://www.thegamer.com/cities-skylines-2-how-to-increase-attract-tourism/)
- [How To Deal With Not Enough Customers In Commercial Zones — TheGamer](https://www.thegamer.com/cities-skylines-2-fix-not-enough-customers-commercial-zone/)
- [Cities Skylines 2 hotels and how to build them for tourists — VideoGamer](https://www.videogamer.com/guides/cities-skylines-2-hotels/)
- [Cities Skylines 2 policies and how to implement them — VideoGamer](https://www.videogamer.com/guides/cities-skylines-2-policies/)
- [10 Best Signature Buildings To Get As Soon As Possible — GameRant](https://gamerant.com/cities-skylines-2-best-signature-buildings-get-early-first/)
- [How to Unlock and Place Signature Buildings — GameRant](https://gamerant.com/cities-skylines-2-how-to-unlock-and-place-signature-buildings/)
- [How to Increase Entertainment — GameRant](https://gamerant.com/ccities-skylines-2-how-to-increase-entertainment/)
- [Cities Skylines 2: Best Policies to Use — GameSkinny](https://www.gameskinny.com/tips/cities-skylines-2-best-policies-to-use/)
- [Cities Skylines 2 Climate And Seasons Guide — SegmentNext](https://segmentnext.com/cities-skylines-2-climate-and-seasons/)
- [Update 1.1.5f1 Patch Notes (Economy 2.0) — UpdateCrazy](https://updatecrazy.com/cities-skylines-2-update-1-1-5f1-patch-notes-economy-2-0/)
- [Patch notes 1.1.5f1: Economy changes — Dexerto](https://www.dexerto.com/gaming/cities-skylines-2-patch-notes-1-1-5f1-economy-changes-bug-fixes-more-2794481/)
- [Tourists in 2.0 — Steam Community discussion](https://steamcommunity.com/app/949230/discussions/0/4406291470270950430/)
- [Hotels for tourists — Steam Community discussion](https://steamcommunity.com/app/949230/discussions/0/3877095833488719038/)
- [Hotels are broken? — Steam Community discussion](https://steamcommunity.com/app/949230/discussions/0/3877096256096957072/)
- [Not enough customers = Need tourists? — Steam Community discussion](https://steamcommunity.com/app/949230/discussions/0/3951406749568434087/)
- [About Outside Connections — Steam Community discussion](https://steamcommunity.com/app/949230/discussions/0/3877095833482632634/)
- [Maximizing Tourism in City Skylines II — My Gaming Tutorials](https://mygamingtutorials.com/2025/06/06/maximizing-tourism-in-city-skylines-ii-the-ultimate-guide/)
- [Cities Skylines 2: Leisure and Tourists — modscities2](https://www.modscities2.com/cities-skylines-2-leisure-and-tourists/)
