# Cities: Skylines II — UI/UX Conventions

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) structures its in-game interface: screen layout, the build toolbar, info views, tooltips, notifications and the social-feed gimmick, camera controls, photo mode, and onboarding. Compiled to inform an original implementation in *Metropolis*.

**This doc describes structure, not skin.** Per `docs/UNKNOWNS.md`, Metropolis mirrors CS2's *layout, information architecture, and interaction patterns* so the game feels immediately familiar to genre players, while every icon, glyph, typeface, colour ramp, panel chrome, sound, and piece of copy is original. Nothing below reproduces game text, art, or data. Everything is written in the researcher's own words.

**Methodology / confidence convention.** Same as the sister docs: outbound page fetches are blocked for most domains here (including the official wiki), so this is synthesized from many targeted web searches whose results summarize one or more pages. Tags:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`).
- **[Dev]** — Colossal Order / Paradox feature highlights and dev diaries, or press coverage of them.
- **[Community]** — player guides, Steam discussions, forums, mod repositories.
- **[Inferred]** — my reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree.

Sister docs: `docs/research/cs2/zoning-districts.md` (the zoning system the toolbar fronts), `docs/research/roads.md`.

---

## How CS2 does it

### 1. Screen layout: four corners and a bottom bar

The HUD is a **corner-anchored overlay** over a full-screen 3D view. There is no window chrome, no persistent side panel, and no reserved letterbox — the city fills the frame and the UI floats on top of it. The game's own UI-modding surface names anchor regions such as *top-left*, *top-right*, and *bottom-right* floating navigation areas, which confirms the corner-cluster model is structural rather than incidental **[Wiki]**.

Reading the screen clockwise from top-left:

- **Top-left — city identity and time.** City name, and the simulation clock/date with the play-pause and speed controls **[Community]**. This is also where the info-view opener lives; search results describe the info-view set as reached "by clicking on the icon in the top-left corner" **[Community]**.
- **Top-right — the vital-signs cluster.** Money (treasury) and population with their current trend direction, plus the demand indicator for the zone families **[Community]**. These are the numbers a player checks constantly; putting them opposite the clock keeps the whole "state of the city" readable in one eye sweep. **[Inferred]** — the exact membership of the cluster varies by patch and by which panels are open.
- **Bottom-left — progression.** A milestone/XP progress bar sits in the bottom-left; clicking it opens the full progression panel showing milestone requirements and what each unlocks **[Dev]/[Community]**.
- **Bottom-centre — the build toolbar** (below).
- **Bottom-right — utility buttons**, including the photo-mode entry point; the wiki-derived instructions for photo mode say to find the camera button "at the bottom right of the toolbar" **[Wiki]**.

Panels that open (economy, progression, statistics, info views, selected-object inspector) appear as **floating cards anchored near the control that spawned them**, not as modal full-screen takeovers. The world keeps simulating and stays clickable behind them **[Inferred, strongly implied by gameplay footage descriptions]**.

The entire HUD can be hidden with a single toggle key (the tilde/backtick key by default), for screenshots **[Community]**.

### 2. The build toolbar: two-level category → asset

The bottom bar is a **two-level menu**. The top level is a row of **category buttons**; selecting one expands a **secondary row (or grid) of the individual assets and tools** in that category. Selecting an asset arms a placement tool; the cursor becomes a ghost preview in the world.

The category list, per the wiki's toolbar-icon index and service pages, is roughly **[Wiki]/[Community]**:

- **Roads** (with sub-groups: small roads, medium/large roads, highways, intersections, paths/pedestrian)
- **Zones** (the residential/commercial/office/industrial paint types)
- **Areas** (districts, map-tile purchase, specialized-industry areas)
- **Electricity**, **Water & Sewage**, **Garbage management**
- **Healthcare**, **Deathcare**, **Fire & rescue**, **Police & administration**, **Education & research**
- **Transportation** (bus, taxi, tram, subway, train, ship, air) and **Communications**
- **Parks & recreation** (small parks, large parks), **Landmarks / signature buildings**
- **Landscaping / terraforming**, **Decorations**
- **Bulldozer** (a persistent destructive tool, kept visually separate from the constructive categories)

Two structural notes worth stealing:

1. **Categories map 1:1 to simulation subsystems.** "Electricity" is both a toolbar category and an info view and a budget line. The player learns one taxonomy and it holds everywhere in the UI. This is the single most valuable structural idea in the whole interface **[Inferred]**.
2. **Locked entries stay visible.** Because progression gates most categories and most assets within them, the toolbar shows unavailable items in a disabled state rather than hiding them, so the player can see what is coming **[Community]**. The volume of categories is enough that the community built search mods (e.g. FindStuff) to query assets by name, type, tag, or category — a real signal that pure category browsing does not scale past a certain asset count **[Community]**.

### 3. Tool option panels

When a tool is armed, a **contextual options panel appears at the bottom-left**, separate from the asset list. For roads it carries **[Wiki]/[Community]**:

- **Tool mode** — the drawing geometry: straight, simple curve, complex curve, continuous, grid, and replace/upgrade.
- **Elevation** — raise/lower, with a selectable **elevation step** (reported increments of 1.25 / 2.5 / 5 / 10 m).
- **Parallel mode** — draw a second network offset alongside the first.
- **Snapping toggles** — a master on/off plus individual toggles including snap to existing geometry, snap to zoning-cell length (the 8 m increment from `zoning-districts.md`), and snap to 90° angles.

The pattern generalizes: **the asset row says *what*, the options panel says *how*, and the two are independent.** Changing the road type does not reset your elevation or snapping choices.

### 4. Info views

Info views are the game's **overlay layer**: a mode that recolours the world to visualize one simulated quantity. Search results put the count around **33** distinct views **[Community]**. Each view, per the wiki, does three things consistently **[Wiki]**:

1. **Highlights the relevant objects and buildings** on the map (e.g. the electricity view foregrounds power plants, transformers, and batteries).
2. **Colour-codes buildings and networks** by their value for that quantity — typically a low-to-high ramp, and for capacity-like quantities a good-to-bad ramp.
3. **Opens a side panel with the headline metric**, often with a target range and a graph, plus view-specific sub-toggles.

Reported specifics:

- **Electricity** — cables and lines are drawn with flow direction; hovering a line reports its current load against its capacity. Buildings shade by consumption intensity. Panel shows total availability, current import/export trade, and battery charge **[Wiki]/[Community]**.
- **Water & sewage** — water flow, groundwater deposits, water pollution; includes a **surface water flow overlay** showing direction and strength **[Wiki]/[Dev]**.
- **Traffic** — panel graph that can be switched between traffic *flow* and traffic *volume* **[Wiki]**.
- Other views named across sources: land value, happiness, education, health, fire hazard, crime, pollution (air / noise / ground / water as separate readouts), natural resources, parks, garbage, public transport **[Wiki]/[Community]**.

**Sub-overlays are a real pattern**, not a one-off: a single view can carry several togglable data layers (the water view's flow overlay being the documented example) **[Wiki]**.

Info views are also **contextual**: arming a service tool can auto-switch the world into the matching view so you can see coverage while you place. **[Inferred]** — widely described player behaviour, but I did not find an explicit statement that the switch is automatic in all cases **[Conflict-ish]**.

### 5. Tooltips

CS2's tooltip convention is **hover-anything, get a structured card** — not a one-line label. Documented behaviours:

- **Toolbar assets** show name, construction cost, and ongoing **upkeep** before you commit; upkeep tooltips were prominent enough that a wrong wages line in one was a reported bug thread **[Community]**.
- **Selected-building panels** carry a row of status icons, and **hovering an icon expands it into a full explanation of the issue** — including, for an abandoned building, *why* it was abandoned **[Community]**. This is the key move: the icon is the index, the tooltip is the article.
- **Budget panel segments** show a breakdown of where that revenue or expense comes from, rendered in a side region of the same panel rather than a floating box **[Community]**.
- **World objects under an info view** report their own value for the active quantity (the electricity-line load readout).

The through-line: **every number in the UI is hoverable and decomposes into its inputs**. **[Inferred]** as a design rule, but consistent with every specific instance sources describe.

### 6. Notifications and the social feed

Two separate channels, and the separation matters.

**Channel 1 — diegetic problem markers.** Notifications are icons that appear **on the offending object in the world**, floating above the building, indicating problems or noteworthy state — collapsed buildings, rent too high, missing utility, abandonment **[Wiki]**. They are spatial by construction: the notification *is* the location. Clicking through opens the object's inspector; hovering the corresponding icon in that inspector gives the explanation (above). The wiki maintains a whole icon category for them, implying a large fixed vocabulary **[Wiki]**.

**Channel 2 — the social feed.** The game runs a **parody microblog feed** as its ambient-narration layer: short in-character posts, attributed to individual simulated citizens, scrolling in a panel; posts double as an **early-warning system**, complaining about problems before they become critical **[Community]/[Dev]**. Structural features worth noting generically:

- You can **select a citizen and follow them**, after which their posts are pinned into your feed — turning the feed into a sampling instrument for a demographic **[Community]**.
- Posts can be **liked** by the player. This was reportedly an accident that shipped because the developers liked it **[Community]** — a nice illustration of how much of the feature's value is texture rather than mechanics.
- Feed items can pop up over the HUD, and **the pop-ups are separately toggleable** from the settings' interface tab, independent of the feed panel itself **[Community]**. Players who find them noisy turn them off; the panel remains.

The pattern to generalize: **a low-stakes, in-world voice channel that editorializes on the simulation**, with a hard opt-out, distinct from the authoritative problem markers. Mixing the two would be a mistake — the markers must be trustworthy and complete; the feed is allowed to be flavour.

### 7. Camera controls

Default PC bindings, as reported across control guides (~35 bindings in 5 categories) **[Community]**:

| Action | Default |
| --- | --- |
| Pan | WASD, screen-edge push, and mouse drag |
| Rotate (yaw) | Q / E |
| Tilt (pitch) | T / G |
| Zoom | R / F, and mouse wheel |
| Free/detached camera | separate toggle |
| Pause / resume | Space |
| Simulation speed | 1 / 2 / 3 |
| Hide HUD | tilde |
| Back / close | Esc |

**[Conflict]** on the mouse modifier for rotate — sources describe both middle-mouse-drag and a held modifier plus drag, and it appears to have changed across patches. Everything is rebindable in the options **[Community]**.

The important properties, not the letters: **the camera is an orbiting/panning tripod over a ground plane, always keyboard-and-mouse-redundant** (every camera axis has both a key pair and a mouse gesture), and **zoom is coupled to pitch** in the classic city-builder way — zooming out drifts the camera toward top-down, zooming in toward street level, so a single wheel gesture takes you from planning view to sightseeing view. **[Inferred]** from the genre convention and from how footage behaves; not stated in a source I could read.

### 8. Photo mode and cinematic camera

Entered from a camera button in the bottom-right of the toolbar **[Wiki]**. It is a **full DSLR-metaphor panel**, organized in tabs **[Wiki]/[Dev]**:

- **Camera** — camera body, lens, aperture shape, focal length, camera collision on/off.
- **Lens** — depth of field, motion blur, bloom, vignette, film grain, panini projection.
- **Color** — colour grading, contrast, post-exposure, brightness.
- **Weather** — cloud amount/size/opacity, fog, atmosphere.

The **cinematic camera** is an expansion of the same panel: open a **timeline**, press an "add capture key" button to record the camera's current position and rotation as a keyframe, and drag keyframes along the timeline to shape the shot. All photo-mode settings apply to cinematic playback, and captured transforms remain editable afterwards **[Wiki]/[Dev]**.

### 9. Onboarding and progression as tutorial

CS2 has **no separate tutorial campaign**. Onboarding is carried by three things:

1. **Contextual tutorial pop-ups** that fire the first time you touch a system, toggleable from the interface options like the other pop-up channels **[Community]**.
2. **Progression as a drip-feed curriculum.** Milestones unlock features rather than merely rewarding them: you begin with roads and zoning and essentially nothing else, and each milestone hands you a new toolbar category. The result is that the toolbar's complexity is revealed at the pace the player earns it, so the tutorial *is* the unlock schedule **[Dev]/[Wiki]**. There are ~20 milestones grouped into 5 named tiers, driven by an XP-like currency earned both passively (population and happiness ticks, reported ~16 times per in-game day) and actively (placing or upgrading buildings) **[Dev]/[Wiki]**.
3. **A second, spendable layer** — development points spent in per-service trees — so that unlocking a service gives you its basics and you choose which of its advanced buildings to open **[Dev]/[Wiki]**.

Milestone rewards bundle money, development points, expansion permits (map tiles), a higher loan ceiling, and feature unlocks **[Wiki]**.

---

## What makes it feel like CS2

Strip the art away and six things carry the feel:

1. **Corner-anchored HUD over an unobstructed world.** The city is never boxed in. Every panel is dismissable and the whole HUD hides with one key. The interface reads as instruments layered on a model, not as an application window.
2. **One taxonomy everywhere.** The same dozen-ish service categories name the toolbar buttons, the info views, and the budget lines. Learning the toolbar teaches you the whole game's vocabulary.
3. **Category → asset → tool options, three stable levels.** *What kind of thing*, *which thing*, *how to place it* never collapse into each other, and the third level persists across changes to the second.
4. **Info views as a mode over the world, not a separate screen.** You do not leave the city to read data about it; the city recolours itself and you keep building.
5. **Icons index, tooltips explain.** Nothing in the UI is a bare number. Hovering any figure, icon, or budget bar decomposes it into causes. Problems are announced spatially, on the building, and diagnosed on hover.
6. **Progression as onboarding.** Complexity arrives on a schedule tied to your own success, so the toolbar is never overwhelming at minute five and never thin at hour fifty.

Explicitly *not* essential to the feel: 33 info views, the DSLR photo panel, the cinematic timeline, the development trees, the social feed's follow/like affordances.

---

## Metropolis v1 adoption

Consistent with the binding decision in `docs/UNKNOWNS.md` — mirror structure and interaction patterns, all visuals original.

**Adopt directly (skeleton)**

- **Corner-anchored HUD**: top-left city name + clock + play/pause + three speed buttons; top-right treasury + population + demand bars; bottom-centre build toolbar; bottom-left progression bar; bottom-right utility buttons. Panels open as floating cards anchored to their opener, never modal.
- **Two-level toolbar**: category row → asset row. Selecting an asset arms a tool with a ghost preview in the world. Bulldozer sits apart from the constructive categories.
- **v1 categories** (four, matching the systems that exist): **Roads**, **Zones**, **Areas** (districts only), **Bulldoze**. Reserve slots, shown disabled, for Electricity, Water, and Services so the taxonomy is visibly extensible from day one.
- **Tool options panel, bottom-left, independent of the asset row.** v1 contents: snapping master toggle, snap-to-cell-length toggle, snap-to-90° toggle. Elevation and curve modes are stubbed out (roads MVP is straight-only) but the panel exists so adding them later does not move any furniture.
- **Info views as a world mode** with a top-left opener. v1 set of four: **Zones** (paint colours over the terrain), **Traffic** (edge flow from the statistical model, low-to-high ramp), **Land value**, **Demand**. Each opens a small panel with its headline metric.
- **Tooltip discipline**: every toolbar asset shows name + cost + upkeep; every number in a panel hovers into a breakdown; every status icon hovers into a sentence explaining the cause. Build this as one tooltip component with a structured payload, not ad-hoc title attributes.
- **Diegetic notification markers**: a floating icon above any building with a problem, click-to-inspect, hover-to-explain. v1 vocabulary is small — no road access, no power (once power exists), abandoned, high rent.
- **Camera**: pan on WASD + drag + edge push; yaw on Q/E; pitch on T/G; zoom on wheel + R/F, with **zoom coupled to pitch**. Space to pause, 1/2/3 for speed, tilde to hide the HUD, Esc to back out. All rebindable eventually; hardcode v1.
- **Selection inspector**: click any building or road segment → floating card with name, type, status icon row, and the relevant stats.

**Simplify for v1**

- **No social feed.** It is texture, not mechanism, and it needs a writing budget. Reserve the panel region.
- **No photo mode.** The tilde HUD toggle covers 90% of the screenshot need for free.
- **No development trees.** Milestones unlock toolbar categories directly.
- **Progression bar with ~5 milestones**, driven by population alone rather than a dual passive/active XP currency. It exists mainly to reveal the toolbar on a schedule.
- **No contextual tutorial pop-ups in v1.** Rely on the fact that the only three things available at start are roads, zones, and bulldoze; the first five minutes are self-teaching by construction (per the UNKNOWNS decision).
- **Locked items shown disabled, not hidden**, from the first build — cheap, and it is what makes the toolbar feel like a promise.

**Explicitly rejected for v1**

Sub-overlays inside an info view; graphs in info-view panels; asset search; parallel/grid road modes; free-flying camera; cinematic timeline; per-panel docking or resizing.

---

## Later path

Roughly in the order each stops being a nice-to-have:

1. **Info-view panel graphs and target ranges** — turns overlays from pretty into diagnostic. Needs a time-series store, which the budget system will want anyway.
2. **The full service taxonomy** as toolbar categories, info views, and budget lines land together, one subsystem at a time. Never ship a category without its matching info view and budget line — that alignment is the whole point.
3. **Contextual tutorial pop-ups**, once there are enough systems that discovery order matters, with a global toggle from day one.
4. **Auto-switch to the matching info view when a service tool is armed.** Small, high-payoff.
5. **Photo mode**, staged: HUD hide (done) → free camera → depth of field and colour grading → weather → cinematic keyframe timeline last.
6. **The social feed**, once the sim can generate honest complaints. Build it as a subscriber to the same event stream that raises notification markers, but with a separate, editorial voice and a hard opt-out for pop-ups. Follow-a-citizen only after the sim has individual citizens worth following.
7. **Development-point trees** per service, splitting "unlocked the category" from "unlocked this building".
8. **Full rebindable input map** with a settings UI, and gamepad support behind it.
9. **Asset search** across the toolbar, once the catalogue passes the browsing threshold — the CS2 community's mods say that threshold is real and arrives sooner than expected.
10. **Sub-overlays within info views** (flow direction layers, coverage-radius layers) once the underlying fields are simulated as fields rather than per-building scalars.

---

## Sources

- [Info views — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Info_views)
- [Notifications — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Notifications)
- [Category:Notification icons — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Category:Notification_icons)
- [Category:Toolbar icons — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Category:Toolbar_icons)
- [Photo Mode — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Photo_Mode)
- [Progression — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Progression)
- [Roads — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Roads)
- [Services — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Services)
- [Beginner's guide — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Beginner%27s_guide)
- [Options UI — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Options_UI)
- [UI Modding — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/UI_Modding)
- [Editor: Interface — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Editor:_Interface)
- [Editor: Snapping and Tool Modes — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Editor:_Snapping_and_Tool_Modes)
- [Paradox: Feature Highlight #1 — Road Tools](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools)
- [Paradox: Feature Highlight #5 — City Services, Districts & Policies](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies)
- [Paradox: Feature Highlight #6 — Electricity & Water](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/electricity-water)
- [Paradox: Feature Highlight #9 — Economy & Production](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production)
- [Paradox: Feature Highlight #10 — Game Progression](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/game-progression)
- [Paradox: Feature Highlight #13 — Cinematic Camera & Photo Mode](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/cinematic-camera-photo-mode)
- [Paradox forums: Development Diary #13 — Cinematic Camera & Photo Mode](https://forum.paradoxplaza.com/forum/developer-diary/development-diary-13-cinematic-camera-photo-mode.1597590/)
- [Paradox forums: Icons](https://forum.paradoxplaza.com/forum/threads/icons.1555637/)
- [Paradox forums: Are the upkeep tooltips wrong or am I missing something?](https://forum.paradoxplaza.com/forum/threads/are-the-upkeep-tooltips-wrong-or-am-i-missing-something.1691719/)
- [Steam discussion: Abandoned buildings?](https://steamcommunity.com/app/949230/discussions/0/628941283089889546/)
- [Steam discussion: Rotate camera modifier?](https://steamcommunity.com/app/949230/discussions/0/3878221560446647510/)
- [Steam discussion: How to show the UI](https://steamcommunity.com/app/949230/discussions/0/3878221560446819376/)
- [Steam guide: Shortcut Layout for Windows Players](https://steamcommunity.com/sharedfiles/filedetails/?id=3024230416)
- [Steam guide: Budget monthly balance and per hour](https://steamcommunity.com/sharedfiles/filedetails/?id=3071767131)
- [ShortcutPosters: Cities: Skylines II keyboard controls & default keybinds](https://shortcutposters.com/games/cities-skylines-2/)
- [DefKey: Cities Skylines 2 keyboard controls](https://defkey.com/cities-skylines-2-shortcuts)
- [Shacknews: PC keybindings & controls](https://www.shacknews.com/article/137454/pc-buttons-controls-cities-skylines-2)
- [Magic Game World: Complete PC controls & hotkeys guide](https://www.magicgameworld.com/cities-skylines-ii-complete-pc-controls-hotkeys-guide/)
- [Magic Game World: How to enable/disable the social-feed popups](https://www.magicgameworld.com/cities-skylines-2-how-to-enable-disable-chirper-popups-notifications/)
- [GameSkinny: How to turn the social feed off](https://www.gameskinny.com/tips/cities-skylines-2-how-to-turn-chirper-off/)
- [PC Gamer: Colossal Order on the social feed returning](https://www.pcgamer.com/there-will-be-a-chirper-for-sure-in-cities-skylines-2-says-colossal-order-ceo/)
- [PCGamesN: Devs found a bug and turned it into a feature (feed likes)](https://www.pcgamesn.com/cities-skylines-2/bugs)
- [PCGamesN: UI and menu overhaul mod](https://www.pcgamesn.com/cities-skylines-2/ui-menu-mod)
- [Neowin: Social feed returns as citizens get more complex lives](https://www.neowin.net/news/chirper-social-media-returns-in-cities-skylines-2-as-citizens-get-more-complex-lives/)
- [Neowin: Update adds a Decorations menu and homeless fixes](https://www.neowin.net/news/cities-skylines-ii-update-has-fixes-for-homeless-citizens-a-decorations-menu-and-more/)
- [Neowin: Dev diary on the in-game camera and Photo Mode](https://www.neowin.net/news/the-latest-cities-skylines-ii-dev-diary-takes-a-look-at-its-in-game-camera-and-photo-mode/)
- [modscities2: Economy panel breakdown](https://www.modscities2.com/cities-skylines-2-economy-panel/)
- [modscities2: Electricity info view breakdown](https://www.modscities2.com/cities-skylines-2-electricity-info-view/)
- [Sims Society: Cinematic Camera & Photo Mode notes](https://simssociety.wordpress.com/2023/09/11/cities-skylines-2-cinematic-camera-photo-mode/)
- [Sims Society: Electricity & Water notes](https://simssociety.wordpress.com/2023/07/24/cities-skylines-2-electricity-water/)
- [ProdigyGamers: All road tools explained](https://prodigygamers.com/2023/10/31/cities-skylines-2-all-road-tools-explained-and-uses/)
- [TheReviewGeek: Progression system and XP explained](https://www.thereviewgeek.com/citiesskylines2-guide-progressionsystem/)
- [LadiesGamers: Cities: Skylines II guide](https://ladiesgamers.com/cities-skylines-ii-guide/)
- [VideoGamer: Beginners guide](https://www.videogamer.com/guides/cities-skylines-2-beginners/)
- [PCGamesN: How to manage taxes](https://www.pcgamesn.com/cities-skylines-2/taxes)
- [Infixo/CS2-InfoLoom (GitHub) — UI panel mod](https://github.com/Infixo/CS2-InfoLoom)
