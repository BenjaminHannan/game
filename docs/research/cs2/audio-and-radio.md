# Cities: Skylines II — Audio, Radio, and Sound as a Feedback Channel

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) treats audio as a gameplay-adjacent system: the radio networks and their state-aware talk segments, the ambient layer that tracks the camera, per-building and per-vehicle emitters and how they relate (or fail to relate) to the noise-pollution simulation, and the UI sounds that confirm tool actions. Compiled to inform an original implementation in *Metropolis*. Written entirely in the researcher's own words; no game audio, script, lyric, asset, or data file is reproduced, and no in-game voice line is transcribed or paraphrased line-by-line.

**Methodology / confidence convention.** Outbound fetches are blocked for most domains here (`colossalorder.fi`, `cs2.paradoxwikis.com`, `pcgamesn.com`, `modscities2.com` all refused), so most material below comes from targeted web searches whose results are synthesized summaries. Two GitHub pages *did* fetch, and they turned out to be the single most valuable source in this area: the ExtendedRadio mod's wiki documents the game's actual radio data model, because the mod loads user content through the game's own radio types. Tags:

- **[Dev]** — Colossal Order / Paradox dev-diary or feature-highlight material (Dev Diary #12, "Sound & Music"), or press coverage summarizing it.
- **[Modding]** — schema-level facts recovered from modding documentation that mirrors the game's internal types. High confidence about *structure*, lower about *runtime behaviour*.
- **[Community]** — player reports, Steam and Paradox forum threads, guide sites. Patch-specific and sometimes just one person's ears.
- **[Inferred]** — my reasoning, not stated by any source.
- **[Conflict]** — sources disagree.

Sister docs: `docs/research/cs2/ux-conventions.md` (the bottom-right radio mini-player lives in that HUD; the social feed is the other ambient-chatter channel), `docs/research/cs2/environment.md` (the noise-pollution field this doc's emitters feed), and `docs/research/cs2/services-utilities.md` (service buildings are the densest source of state-carrying sounds).

---

## How CS2 does it

### 1. Two networks, stations under them, a host per station

The whole music system is folded into "radio" — there is no separate score. Radio is organized in three tiers **[Dev]**:

1. **Network** — the top-level container. The base game ships two: a *public* network and a *commercial* network. The distinction is not musical, it is editorial: the public network carries public service announcements and no advertising; the commercial network carries advertising and no PSAs **[Dev]**. Both play music.
2. **Station** — a channel under a network, each representing one genre or style. Paid music packs add further stations, and each ships as its own station rather than as loose tracks folded into an existing one **[Dev]/[Community]**.
3. **Host** — each station has a single voiced presenter who anchors it and speaks between songs. A music-only station exists for players who want no talking at all **[Dev]**.

The important structural point for us: the *station is the unit the player selects*, and the *network is the unit that decides which non-music segment types are allowed to play*. Advertising is a network property, not a per-clip one.

### 2. The clip taxonomy — this is the real mechanism

The radio is not a playlist with occasional interruptions. It is a scheduler over typed segments, and the type list is recoverable **[Modding]**. A station contains **programs** (time-bounded shows, with a start time, an end time, a loop flag, and paired intro/outro material), and a program contains **segments**. A segment is declared with a type, a tag list used to filter which clips are eligible, and a cap on how many clips it pulls per airing.

The segment types are: **playlist** (music), **talk show**, **PSA**, **weather**, **news**, **commercial**, and **emergency** **[Modding]**.

Individual audio clips then carry optional metadata that determines *when they are eligible*:

- Music clips carry title / artist / album, and a flag that tells the UI to display those fields. Non-music clips set the flag the other way so the mini-player shows nothing identifying **[Modding]**.
- Commercial clips carry a **brand** identifier, from a fixed roster of in-fiction advertisers **[Modding]**. That is why ads feel like a consistent world rather than random noise: the same fictional companies recur across stations.
- PSA clips carry a **PSA type** drawn from a small set (on the order of seven), and the documented examples are explicitly simulation conditions — a low-electricity situation being one **[Modding]**.
- Emergency clips carry an **alert type** from a set of about four, again keyed to simulation events (a wildfire being a documented example) **[Modding]**.
- News clips carry a **news type**, and this set is much larger — on the order of twenty-three distinct scenarios spanning crime, commerce, industry, and weather **[Modding]**.
- Weather clips carry a **weather type** from roughly eight conditions, from clear through freezing **[Modding]**.

So the mechanism is: **the simulation raises a typed condition; the radio scheduler picks a segment slot of the matching category and draws a clip whose declared type matches; the clip plays as part of the station's normal rotation.** The city state is not narrated procedurally — no text-to-speech, no assembled sentences. It selects from a bank of pre-voiced clips keyed to enumerated conditions **[Inferred, but strongly supported by the metadata shape]**. That is the single most transferable insight in this document.

### 3. Emergency broadcasts are a navigation affordance

When a disaster fires, an emergency segment interrupts whatever is playing, and the interruption also surfaces **in the radio mini-player as a clickable element that jumps the camera to the incident** **[Dev]/[Community]**. The radio is therefore not purely flavour — it is a second, audio-first notification channel parallel to the social feed and the on-map icons documented in `ux-conventions.md`.

### 4. Where the city-state coupling actually falls down

This is the most consistent community complaint in the area, and it matters more for our design than the successes do:

- Players repeatedly report that announcements **do not match what is happening** — a shortage or crisis is described while the city has no such problem **[Community]**. Several threads amount to "it would be great if the announcements were actually driven by my city."
- Emergency-flavoured broadcasts are reported as **disproportionate**: the alarm level of the audio exceeds the actual severity of the triggering event **[Community]**.
- The pool of clips per type is small enough that **repetition sets in quickly** on long sessions, and multiple threads ask how to disable the chatter while keeping the music **[Community]**.

**[Conflict]** on the underlying cause: the marketing framing is that the radio talks about your city, while player experience is that it frequently doesn't. The likeliest reconciliation **[Inferred]**: the hooks exist (the type enumerations prove it) but the trigger thresholds are loose, the cooldowns are short relative to the clip bank size, and some categories fire on weak or stale conditions. It is a tuning failure, not an architecture failure.

### 5. Player controls

- A **radio icon in the bottom-right of the HUD** opens a mini-player: station selection, and a toggle for advertising **[Community]**.
- Radio volume is a **single slider covering both music and speech**, which is exactly why "turn off the banter, keep the music" is such a persistent request — the game doesn't separate them at the mixer **[Community]**.
- The game exposes more audio option sliders overall than its predecessor did **[Dev]**, though the granularity players actually want (speech vs. music) is the one missing.
- Station choice and ad-toggle state are reported as **not persisting between sessions**, another recurring request **[Community]**.
- Custom content is a first-class modding target: mods add whole networks alongside the shipped ones, loading OGG audio on demand and reading tags off the files **[Modding]**.

### 6. The ambient layer

The world ambience is built as **layers that are attached to the camera rather than to the world** — they follow the viewpoint and provide a continuous bed under everything else **[Dev]**. On top of that bed:

- **Context changes the bed.** A residential area and an industrial area sound different when the camera is over them **[Dev]**. Density and land use, not just position, select the ambience.
- **Weather is audible, not just visible.** Rain, snow, and wind each have their own ambient character and mix into the bed as conditions change **[Dev]**. Since climate drives seasonal temperature and precipitation over the year (see `environment.md`), the ambience shifts seasonally as a consequence rather than as its own system **[Inferred]**.
- **Time of day** also colours the mix **[Dev]/[Community]**.
- Close to the ground the layer gains detail — small-scale life (birds, animals, pedestrian activity) becomes audible **[Dev]**.

**[Community] caveat, and it's a big one:** many players report that city sound is essentially **only audible when zoomed far in** — that at normal play distance the city is close to silent, and that you must be nearly on top of a siren to hear it. Several threads are titled some variant of "where is the city noise?" This is the flip side of the culling system described next: it is tuned aggressively enough that the ambient payoff is invisible at the zoom level most players actually use.

### 7. Per-building and per-vehicle emitters, and the culling system

**Buildings.** Nearly every city-service building and its upgrades carry a distinctive sound tied to what the building *does*, and the sound is meant to convey **operational status**, not just presence **[Dev]**. Two implementation details are documented:

- Building audio is not a single looping bed. It is a loop **plus short randomized one-shot spots** layered over it, which is what keeps a long-running building from sounding like a tape splice **[Dev]**.
- Because CS2's buildings are physically large, some carry a **dynamic emitter that repositions itself relative to the camera**, so a sprawling complex is audible from any corner instead of radiating from one arbitrary point **[Dev]**. This is a genuinely clever trick and cheap to imitate.

Asset-authoring guidance treats sound as a **3D positional effect placed at a marker**, attenuating with distance on all three axes, and advises placing the marker at the mesh centre or wherever the sound logically originates **[Modding]**.

**Vehicles.** Vehicle audio is **parameterized by speed** rather than being a fixed loop **[Dev]**. Emergency sirens pick a **style variant automatically from the map/region theme**, so a North American city and a European one sound different without any per-vehicle authoring **[Dev]**.

**Audio grouping.** The system that makes the above survivable at city scale: CS2 tracks both the **distance and the count** of sound sources relative to the camera, and collapses them, specifically so that a hundred cars in view do not produce a hundred simultaneous voices **[Dev]**. Grouping is what a city builder needs instead of naive per-agent emitters, and it is also — **[Inferred]** — the direct cause of the "too quiet unless zoomed in" complaints, since a dense scene gets collapsed hardest exactly where there is most to hear.

**Citizen selection cue.** Selecting a citizen plays a short vocal cue that varies with that citizen's **age, gender, and mood** **[Dev]**. A tiny detail, but it is audio carrying simulation state directly into a UI interaction, which is the pattern this whole doc is about.

### 8. Relationship to the noise-pollution field

Here is the crucial finding, and it is a negative one: **the audible emitters and the noise-pollution simulation are two separate systems that merely share a theme.** Noise pollution is computed as a spreading field with sources and radii **[Community]**:

- Road noise scales with **traffic volume weighted by vehicle type** — heavy trucks contribute more, electric vehicles notably less **[Community]**.
- Buildings contribute a value over a **radius shown as a circle at placement time** **[Community]**.
- Broadly, non-residential zones, wide roads, transit stations, schools, industry, and power plants are the main contributors **[Community]**.
- It is surfaced through its own info view, colour-mapped over the map, with a headphones icon **[Community]**.

No source describes the noise field reading from, or driving, the audio mixer in either direction. A quiet-sounding scene can be a pollution hotspot and vice versa **[Inferred]**. This is a design opportunity rather than a fact to copy.

---

## What makes it feel like CS2

Stripped to the parts that actually produce the feeling:

1. **The radio is the music system.** There is no separate soundtrack layer. Music arrives through an in-world fiction with stations, hosts, and a mini-player, so tuning the radio feels like an act inside the city rather than a settings change.
2. **A consistent commercial fiction.** Recurring fictional brands across ad clips make the city feel like it has an economy of its own. This costs nothing at runtime and is pure worldbuilding.
3. **Typed clips keyed to simulation conditions.** Even executed imperfectly, hearing something about your power grid shortly after browning out is a strong "the world noticed" moment.
4. **The interruption that navigates.** An emergency broadcast that is simultaneously a clickable jump-to-incident makes audio load-bearing rather than decorative.
5. **Layered ambience that follows the camera and changes with what's under it.** Flying from suburb to factory district and hearing the bed change sells density without any UI.
6. **Service buildings that sound like what they are, and like how they're doing.** Status-in-sound is the audio twin of the info-view overlay.
7. **Speed-driven vehicle audio and theme-matched sirens.** Cheap variation that reads as production value.
8. **Grouping instead of per-agent voices** — and the lesson that it must be tuned for the zoom level people actually play at, which CS2 arguably got wrong.

---

## Metropolis v1 adoption

Metropolis is a browser city-builder (see `docs/UNKNOWNS.md`: WebAudio, low-poly, ~1–2k buildings, statistical traffic with visual-only vehicles). That last decision matters here — we have **no per-vehicle agents to attach emitters to**, so vehicle audio must be statistical too.

**Adopt in v1:**

- **A typed-clip radio scheduler, with synthesized or CC0 audio only.** Build the architecture even if v1 ships with a thin content bank. Data model: `Network → Station → Segment[]`, segment has `{type, tags, maxClips}`, clip has `{type, subtype, tags, brand?}`. Types: `music | talk | psa | news | ad | weather | emergency`. This is the highest-value structural borrow in the doc, and it is a data model, not an asset.
- **Condition-keyed selection with an eligibility gate.** Every non-music clip declares a predicate over city state (`power_deficit`, `high_crime`, `traffic_jam`, `budget_deficit`, `population_milestone`, …). At segment time, evaluate predicates against the live sim, filter to satisfied clips, weight by recency (heavily penalize recently-played), pick one. **Fix CS2's bug at the source: if nothing is eligible, play music instead of playing something false.** A radio that stays quiet when nothing is happening beats one that cries wolf.
- **Fictional brand roster for ads.** A dozen named in-world companies, reused across ad clips. Original names, no real-world or CS2 references.
- **Emergency interrupt that is clickable and camera-jumps.** Wire it into the same notification bus as the on-map alert icons.
- **Bottom-right mini-player** matching the HUD position established in `ux-conventions.md`: station list, now-playing (title/artist for music, nothing for speech), skip, and **separate music / speech / ads toggles** — three controls where CS2 has one. Persist the selection to save state, which CS2 doesn't.
- **A camera-attached ambient bed**, crossfading between a small set of beds selected by what's under the camera: rural / low-density residential / dense residential / commercial-retail / industrial / water. Crossfade on a weighted sample of nearby cells, not a hard switch, or the bed will pop while panning.
- **Zoom-driven detail layer.** Close in, enable a sparse one-shot spawner (birds, doors, distant horns) seeded from nearby cell types. Far out, drop it and lean on the bed. Explicitly tune so the mid-zoom — where people actually build — is *not* silent.
- **Per-building emitters as a pooled, culled system.** Maintain a small fixed pool (say 16–24 concurrent voices). Each frame, rank candidate emitters by `importance / distance²`, assign the pool to the top N, fade the rest out. This is our "audio grouping." Building sound = a loop plus randomized one-shots, per CS2's approach.
- **Statistical vehicle audio.** Since traffic is per-edge flow, drive road noise from **flow volume and composition per visible edge**: one traffic-bed voice per nearby high-flow segment, gain and brightness scaling with flow and truck share. No per-vehicle emitters. This is not a compromise — it's the same abstraction our traffic model already uses.
- **Couple audio to the noise field where CS2 didn't.** We already compute road noise from flow-and-vehicle-mix and building noise from radii for the pollution info view. **Feed the same numbers into the mixer.** One field, two consumers: colour on the info view, gain on the ambient bed. It costs nearly nothing given the field exists, it makes the info view legible by ear, and it is a small, honest improvement over the original.
- **UI/tool feedback sounds, deliberately designed as a grammar** rather than one click sound: distinct cues for hover-over-valid, place-confirmed, place-rejected, bulldoze, drag-start/drag-end for zone painting and road dragging, panel open/close, milestone unlocked, and money-spent. Short, quiet, pitch-varied slightly per repeat so drag-painting a hundred cells doesn't machine-gun. **Rate-limit and coalesce**: a drag emits one continuous tick, not one click per cell.
- **Citizen-selection cue** varying with the citizen's simulated state — the cheapest possible "the sim is real" signal.

**Explicitly deferred / not in v1:**

- Voiced hosts. Voice acting is out of scope for an open-source v1; ship stations with music and a text-only "now on air" ticker in the mini-player carrying the same condition-keyed information the voice clips would. The scheduler is identical; only the renderer differs. Voice can drop in later without a rewrite.
- Time-of-day programming (`startTime`/`endTime` on programs). Model the field; ignore it in v1.
- Weather-typed clips — no weather sim in v1.
- Per-region siren theming.

**Licensing note, binding:** every sound in Metropolis must be original, procedurally synthesized in WebAudio, or CC0/CC-BY with attribution recorded in a manifest. Nothing derived from CS2 or any commercial game. Procedural synthesis is genuinely viable for the whole UI grammar and much of the ambient bed, and it costs zero download weight — a real advantage for a browser game.

---

## Later path

- **Voiced hosts** via community contribution or synthesized speech, once the clip bank's shape is proven by the text ticker.
- **Time-of-day programming**: morning show, evening wind-down, overnight automation. Programs already carry the fields.
- **Weather and season ambience** once climate is simulated — rain on the bed, muffled winter, insect texture in summer.
- **A real news bank**: expand from a handful of condition types toward CS2's ~23, and add *positive* news (milestones, a new landmark, record employment) so the radio isn't purely a complaint channel.
- **Player-supplied stations**: point the loader at a local folder or URL list of OGG/MP3 files, mirroring what CS2's modding scene had to build itself. Cheap in a browser, and it is the single most-requested feature in every city builder's audio.
- **Noise as a two-way system**: soundproofing policies, noise-barrier road props, and quiet-hours ordinances that show up simultaneously in the pollution field and in the mixer.
- **HRTF / spatialized panning** for emitters via WebAudio's PannerNode, once the pooled emitter system is stable.
- **Accessibility**: a mode that converts key audio cues into visual pulses, and captions for any spoken content, from day one of adding voice.

---

## Sources

- [Paradox Interactive: Cities: Skylines II Feature Highlight #12 — Sound & Music](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/sound-music)
- [Colossal Order: Development Diary #12 — Sound & Music](https://colossalorder.fi/?p=1852)
- [Paradox forums: Development Diary #12 — Sound & Music](https://forum.paradoxplaza.com/forum/threads/development-diary-12-sound-music.1597000/)
- [Steam News: Cities: Skylines II — Sound & Music](https://store.steampowered.com/news/app/949230/view/3654161945397995331)
- [PCGamesN: Cities Skylines 2's totally overhauled audio system](https://www.pcgamesn.com/cities-skylines-2/sounds)
- [MP1st: Sound and music highlighted in latest deep dive](https://mp1st.com/news/cities-skylines-2-sound-and-music-highlighted-in-latest-deep-dive)
- [GameChronicles: Feature deep dive — Sound & Music](https://gamechronicles.com/cities-skylines-ii-feature-deep-dive-sound-music/)
- [The Ongaku: Sound and music features highlighted](https://www.theongaku.com/posts/cities-skylines-ii)
- [ExtendedRadio wiki: Radio Elements (segment and clip type enumerations)](https://github.com/AlphaGaming7780/ExtendedRadio/wiki/Radio-Elements)
- [ExtendedRadio wiki: Custom Radio (network/channel/program/segment hierarchy)](https://github.com/AlphaGaming7780/ExtendedRadio/wiki/Custom-Radio)
- [ExtendedRadio (GitHub)](https://github.com/AlphaGaming7780/ExtendedRadio)
- [ExtendedRadio on Thunderstore](https://thunderstore.io/c/cities-skylines-ii/p/TritonSupreme/ExtendedRadio/)
- [Paradox forums: ExtendedRadio thread](https://forum.paradoxplaza.com/forum/threads/extendedradio.1644751/)
- [dragonofmercy/cs2-customradio (GitHub) — network/station folder schema](https://github.com/dragonofmercy/cs2-customradio)
- [Paradox Interactive: New Creator Packs & Radio Stations](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/new-creator-packs-and-radio-stations)
- [Cities Skylines 2 Wiki: Assets — Common Asset Principles (3-axis sound effect markers)](https://cs2.paradoxwikis.com/Assets:_Common_Asset_Principles)
- [Cities Skylines 2 Wiki: Soft Rock Radio](https://cs2.paradoxwikis.com/Soft_Rock_Radio)
- [Cities Skylines 2 Wiki: Category — Music Pack](https://cs2.paradoxwikis.com/Category:Music_Pack)
- [Steam discussion: Radio station complaint](https://steamcommunity.com/app/949230/discussions/0/3877095833476265809/)
- [Steam discussion: Radio host](https://steamcommunity.com/app/949230/discussions/0/3877095833479029052/)
- [Steam discussion: Radio hosts](https://steamcommunity.com/app/949230/discussions/0/4031346570751234649/)
- [Steam discussion: Radio talks](https://steamcommunity.com/app/949230/discussions/0/3877095833484906746/)
- [Steam discussion: How do I stop the radio announcements?](https://steamcommunity.com/app/949230/discussions/0/4406291673456798317/)
- [Steam discussion: Radio settings](https://steamcommunity.com/app/949230/discussions/0/4349988380670601731/)
- [Steam discussion: Please separate the radio into two volume sliders](https://steamcommunity.com/app/949230/discussions/0/3877095833473206746/)
- [Paradox forums: Turn off the radio banter, but not the music?](https://forum.paradoxplaza.com/forum/threads/turn-off-the-radio-banter-but-not-the-music.1604163/)
- [Steam discussion: Can't hear any ambient sounds unless at 10m zoom](https://steamcommunity.com/app/949230/discussions/0/3877095833474565167/)
- [Steam discussion: Where is the city noise?](https://steamcommunity.com/app/949230/discussions/0/601911983259820327/)
- [Steam discussion: No siren sounds](https://steamcommunity.com/app/949230/discussions/0/3878221560447348648/)
- [DigiStatement: How to enable/disable radio](https://digistatement.com/cities-skylines-2-ii-how-to-enable-disable-radio/)
- [Paradox Interactive: Climate & Seasons feature highlight](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/climate-seasons)
- [GamesRadar: Cities Skylines 2 pollution guide](https://www.gamesradar.com/cities-skylines-2-pollution-guide/)
- [StealthOptional: Noise pollution — causes and fixes](https://stealthoptional.com/article/cities-skylines-2-noise-pollution)
- [TheGamer: How to deal with noise pollution](https://www.thegamer.com/cities-skylines-2-lower-reduce-noise-pollution-guide/)
- [Magic Game World: Noise pollution guide](https://www.magicgameworld.com/cities-skylines-2-noise-pollution-guide/)
- [Cities: Skylines Wiki: Noise (predecessor's noise model, for lineage)](https://skylines.paradoxwikis.com/Noise)
