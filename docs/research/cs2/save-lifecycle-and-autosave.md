# Cities: Skylines II — Save Lifecycle, Autosave, and Failure Modes

Research notes on how *Cities: Skylines II* (Colossal Order / Paradox Interactive, 2023) persists a city: what a save file actually contains, how saves survive (or fail to survive) patches, the autosave cadence and its relationship to pause, the naming/thumbnail/continue conventions around the load screen, and the save-bloat and corruption failures the game has publicly shipped. Compiled to inform an original implementation in *Metropolis*, which stores its saves in a browser rather than on a filesystem. Everything below is in the researcher's own words; no game text, asset, or data file is reproduced.

**Methodology / confidence convention.** Outbound page fetches are blocked for most domains here, so the material below comes from targeted web searches whose results are synthesized summaries of one or more pages (official wiki, Paradox forums, Steam discussions, patch-note aggregators, guide sites, modding writeups). Primary files could not be opened, so every claim carries a tag:

- **[Wiki]** — attributed by search results to the official Paradox wiki (`cs2.paradoxwikis.com`) or to published patch notes.
- **[Dev]** — Colossal Order / Paradox statements: patch notes, word-of-developer posts relayed by community sources.
- **[Community]** — player guides, Steam and Paradox forum threads, modder observations. Often patch-specific.
- **[Inferred]** — my reasoning from the above, not stated by any source.
- **[Conflict]** — sources disagree; both readings given.

Sister docs: `docs/research/cs2/ux-conventions.md` (the menu and panel patterns the load/continue flow lives inside), `docs/research/cs2/progression.md` (milestone state that must be persisted), `docs/research/simulation.md` (what the tick actually owns, i.e. what has to go into a save).

---

## How CS2 does it

### 1. The file: one compressed archive per city

A CS2 save is a single file with a game-specific extension (`.cok`). Modders report that it is a zip-family container: renaming it to `.zip` lets you open it and see the internal files, and a hand-repacked archive renamed back will be picked up by the game — though editing values inside frequently produces a save the game refuses to list at all **[Community]**. So the shape is: **container format = generic archive, contents = engine-specific binary blobs plus a small metadata file.**

Inside, search results describe a metadata entry (a "savegame meta" record) separate from the bulk simulation payload **[Community]**. That split is the important architectural fact and it is worth stating plainly, because it is the thing Metropolis should copy: **the load screen must be renderable without deserializing the city.** Listing twenty saves cannot mean parsing twenty cities. The metadata blob carries the display fields (name, timestamp, city identity, presumably population and playtime, and a preview image), and the heavy payload is only touched when the player actually commits to loading **[Inferred, strongly implied by the file layout]**.

Related config lives beside the saves rather than inside them: CS2's settings files use a JSON-ish text format with section grouping **[Wiki]**, and the launcher/main menu consults a small separate JSON file to decide what "continue" points at (see §5) **[Community]**.

Save location on Windows is under the user's local app data, in a Colossal Order / Cities Skylines II folder, with a `Saves` subfolder; several sources report a per-platform-user-id subfolder under it, which is how Steam and Game Pass installs keep separate save sets **[Community]**. The precise path is reported inconsistently across guide sites (`AppData\Local` vs. `AppData\LocalLow`) **[Conflict]** — irrelevant to us, but a reminder that even the basics get garbled in secondary sources.

### 2. What a save contains

No public schema exists, but the community's size analysis is revealing. Players report that the file has to hold "every building and prop, its coordinates, its rotation, and its contents," plus the goods in transit, the vehicles, the citizens, and the map itself **[Community]**. One player's back-of-envelope from a very large city put it near **1 KB of compressed save per ~2.5 citizens** **[Community]** — i.e. the dominant cost is not the geometry the player authored but the *agent population the simulation spawned on its own*.

That ratio is the single most useful number in this document. It says CS2 saves the **full simulation state**, not a seed plus the player's edit history. Every household, every worker's employment record, every vehicle mid-route, every warehouse's inventory is serialized. The player's actual authored content — the road graph and the painted zone cells — is a rounding error next to it **[Inferred]**.

Reported size points, all **[Community]**:

- A tutorial-scale starter town: tens of megabytes, ~20 MB and up.
- A mid-size test city: on the order of 100 MB.
- A 500k-population city: 200 MB or more.
- A 1.3M-population city: roughly 320 MB.

So the growth is roughly linear in population and the *floor* is already high — a nearly empty city costs 20 MB, which implies a large fixed component (terrain heightmap, map resources, water state) that exists before the player does anything **[Inferred]**.

### 3. Versioning across patches

CS2 has not published a save-format version policy that search surfaced. What the record shows instead:

- **Forward compatibility is generally maintained by the base game.** Threads about "the patch broke my saves" overwhelmingly resolve to *mod* breakage rather than format breakage: a save made with mods acquires a dependency on those mods, and after a patch the mods are stale, the mod loader fails, and the city will not open **[Community]/[Wiki]**. The game surfaces this as a warning that subscribed mods were not built for the current version, with the content manager listing the offenders **[Community]**. A single failing mod can prevent the rest from loading at all **[Community]**.
- The community's standard recovery for a post-patch unloadable city is instructive: **load it with mods disabled (safe mode), save it again from safe mode, then return to normal mode** — after which it opens **[Community]**. That works because re-saving strips the mod-owned entities/references out of the payload. It is a de facto "migrate by round-tripping through a smaller schema" pattern **[Inferred]**.
- **The base game has nevertheless shipped genuine save bugs.** Patch notes and dev communication in the 1.5.x line reference a crash when loading a save game (fixed in a 1.5.8/1.5.9 hotfix pair) and a separate saving bug whose root cause was traced back to a change introduced with the Asset Editor a year earlier and only became visible after a later change; the shipped hotfix was explicitly described as addressing the *symptoms* to keep games playable while a full fix landed in the next patch. That hotfix also covered failures saving *old* save games and custom maps **[Wiki]/[Dev]**.

The pattern to take away: format drift is real, it arrives from features the save team did not think were save features (an editor!), and it can lie dormant across many patches before a second change detonates it **[Inferred]**.

### 4. Autosave: cadence, count, and pause

CS2's autosave is **off by default** — a decision that generated a lot of public irritation and a genre of "PSA: turn this on" articles **[Community]**. The reported reason is performance: in prerelease builds autosaving caused framerate collapse and crashes, so it shipped disabled **[Community]**. That is itself the headline finding — the studio judged a *snapshot of a large city* too expensive to take on a timer without the player opting in.

Settings, all in the general options under a performance-preference grouping **[Community]**:

- **Autosave enable** — a checkbox, default off.
- **Autosave interval** — a discrete list rather than a free number: roughly 1, 2, 5, 10, 30, and 60 minutes **[Community]**. Note these are **wall-clock** minutes, not simulated days.
- **Autosave count** — the number of autosaves retained, with reported choices of 1, 3, 10, 50, 100, or unlimited, defaulting to **3** **[Community]**. When the cap is hit the oldest autosave is deleted to make room, i.e. a plain FIFO ring **[Community]**.

Three is a conservative default and the reason is obvious from §2: at 200–320 MB apiece, ten autosaves of a big city is multiple gigabytes **[Inferred]**. Players have reported save directories that grew into the tens of gigabytes and beyond from accumulated saves **[Community]**.

There is also a reported bug where the autosave setting does not persist across restarts, so players had to re-enable it every session **[Community]** — a small thing that turns an opt-in safety feature into an opt-in-every-time safety feature.

**Interaction with pause.** This is the murkiest area and worth flagging as such.

- Community reports assert that autosave fires on a wall-clock timer, and specifically that **leaving the game paused for a long stretch could corrupt the save — including previously written saves and autosaves** — described as a known bug around mid-2024 **[Community]**. Whether this is really "pause causes corruption" or "long sessions cause corruption and long sessions correlate with being AFK on pause" is not established by any source I found **[Conflict]/[Inferred]**.
- No source confirms that CS2 *suppresses* autosave while paused. The safest reading is that the timer runs regardless of simulation speed **[Inferred]**.

Either way, the design lesson is loud: **a snapshot taken while the world is mutating is a correctness hazard, and the fix is to make the snapshot atomic with respect to the tick, not to hope the timer lands in a quiet moment.**

### 5. Quicksave, named saves, and the continue flow

- **Quicksave/quickload exist as keybinds** — reported as Ctrl+S / Ctrl+O for CS2 **[Community]**. (CS1 used F1/F4; secondary sources mix the two games freely, so treat the exact keys as soft **[Conflict]**.)
- **Named saves** are the primary mechanism. The community's universally repeated advice, in response to corruption reports, is to **save under rotating incrementing names** (`City1`, `City2`, …) rather than overwriting one slot, precisely because a corrupt write otherwise destroys the only copy **[Community]**. That players had to invent manual versioning is a straightforward indictment of the built-in scheme.
- **Thumbnails.** Save entries carry a preview image. Notably, CS2 shipped without thumbnails in some listing contexts and a community mod exists specifically to *add* thumbnails **[Community]**; for maps, the documented workflow for getting a preview attached involves photo mode **[Community]**. So: previews are part of the metadata story but were incompletely implemented at launch **[Inferred]**.
- **Continue.** The main menu's continue entry is driven by a small separate JSON pointer file recording the most recent session, not by scanning the save directory **[Community]**. Hovering it reveals the city name and some summary detail **[Community]**. Its documented failure mode is the direct consequence of that design: the pointer file goes stale or wrong and **continue greys out or does nothing even though the save files are perfectly intact** — a bug reported from launch onward, with the workaround being to load manually from the load list **[Community]**. Corrupt-save reports also show continue *and* load both greyed **[Community]**, which is the more serious variant.

### 6. Failure modes, catalogued

Worth listing explicitly, because these are the design targets:

1. **The pointer-file failure** — the save is fine, the "resume" affordance is broken. Cheap to prevent, embarrassing to ship.
2. **The torn write** — a save interrupted (crash, quit, timer firing mid-mutation) that leaves a file which lists but crashes on load. Reported as the game crashing instantly on *every* save and autosave in the worst cases **[Community]**, i.e. the corruption propagated through the whole rotation because each autosave inherited the poisoned state.
3. **Dependency rot** — the save references content (mods, assets) that no longer exists or no longer matches. Recoverable only by re-saving from a reduced environment **[Community]**.
4. **Latent format bugs** — a change in an adjacent system silently invalidates serialization, detonating patches later **[Wiki]/[Dev]**.
5. **Bloat** — files large enough that cloud sync becomes impractical (players describe uploads taking up to half an hour) and that a handful of retained autosaves consumes gigabytes **[Community]**.
6. **Silent disappearance** — a long tail of "my save is gone" threads, some traced to local-vs-cloud save confusion **[Community]**.

The through-line is that **every one of these is a lifecycle bug, not a simulation bug.** CS2's simulation is far harder than its save system, and the save system is what lost people their cities.

---

## What makes it feel like CS2

The save layer is invisible when it works, so "feel" here is mostly about the two seconds around the main menu and the moment of committing to a save:

1. **Continue is the front door.** You launch the game and the top button is your city, by name, waiting. You do not browse. That one button is what makes a city feel like an ongoing place rather than a document you open.
2. **The load screen is a shelf of cities, not a list of files.** Thumbnail, name, population, when you last touched it. Choosing a save is choosing a *place*, and the preview image is what does that work — which is exactly why the community modded one in when the base game's was thin.
3. **Saving is a deliberate act with a visible cost.** The game pauses to do it, it takes a moment, and you feel it. That weight is part of why players developed the discipline of rotating names.
4. **Autosave as a safety net you configure, not a system that just happens.** Interval and retention count are both exposed. Players who care tune them; players who do not, do not get them at all — which is the wrong default, and the loudest single lesson in this document.
5. **Losing a city is a real, feared outcome.** This is not a positive feel, but it is unmistakably part of the CS2 experience, and it is the thing Metropolis should refuse to inherit.

---

## Metropolis v1 adoption

Metropolis runs in a browser, so the physics are different in ways that cut both directions. Storage is **IndexedDB** (structured-clone-able values, async, tens-of-MB to a large fraction of free disk depending on browser), not a filesystem. There is no `localStorage` path — its ~5 MB cap is not in the running for a city. Two browser-specific hazards have no CS2 analogue: **eviction** (a browser under storage pressure may discard a site's data outright unless it has been marked persistent) and **quota exhaustion** raising on write. Two CS2 hazards get *worse*: there is no user-visible directory to back up by hand, and there is no "copy the file before the patch" instinct available to a player who does not know their city lives in a browser database.

Given `UNKNOWNS.md`'s binding decisions (~1–2k buildings, statistical traffic rather than per-vehicle agents, no household simulation in v1), the state we must serialize is dramatically smaller than CS2's — which is the leverage that makes the following affordable.

**Adopt directly**

- **Metadata separated from payload.** Two IndexedDB object stores: a small `saves_meta` store (id, display name, city name, created/modified timestamps, population, in-game elapsed time, thumbnail, schema version, payload size) and a `saves_payload` store keyed by the same id. The load screen reads only `saves_meta`. Never deserialize a city to render a list entry.
- **A continue pointer** — a single key recording the most recently played save id, so the main menu's primary action is "Continue: <city name>". Copy CS2's flow, and *avoid its bug*: if the pointer resolves to a missing or unreadable save, silently fall back to the newest entry in `saves_meta` and, failing that, hide the button. Never show a dead button, never grey it out with the save sitting right there.
- **Named saves with a visible list, plus autosave as a separate reserved class** of entries so an autosave can never silently clobber a named one.
- **FIFO rotation on the autosave class**, exactly CS2's model.
- **Thumbnail per save.** A downscaled canvas capture of the current viewport at save time, stored as a `Blob` (JPEG/WebP, target ≲40 KB). Cheap here — we already have the framebuffer — and it is most of what makes the load screen feel like a place rather than a file picker.
- **Autosave interval as a discrete pick list**, not a free-entry number.

**Change deliberately**

- **Autosave defaults to ON**, at 5 minutes, retaining 3. CS2's off-by-default was a performance concession we do not need to make at our state size, and it cost its players real cities. This is the clearest case in the document of learning from CS2 by not copying it.
- **Snapshot is atomic with respect to the tick.** Serialization runs between ticks, never during one — the save routine takes the world as a frozen input. The simplest correct version: at the top of the frame, if a save is due, run it to completion before advancing the sim. If that stalls visibly, the next step is a structural-clone-and-hand-off (snapshot synchronously between ticks, serialize/compress on a worker), not "save while it mutates."
- **Autosave suspends while paused and while a tool drag is in progress.** Nothing has changed while paused, so a timer-driven write is pure cost and pure risk; the timer resumes with the sim. This sidesteps CS2's murky pause/corruption story entirely rather than reasoning about it.
- **Write-then-swap, never overwrite in place.** Write the new payload under a temporary id, verify it reads back, then atomically update the metadata record to point at it and delete the old payload — all inside one IndexedDB transaction where possible. A crash mid-save leaves the previous save untouched. CS2's failure mode #2 (torn write poisoning the whole rotation) becomes structurally impossible.
- **`navigator.storage.persist()` on first save**, with the outcome recorded. If persistence is denied, say so plainly once in the UI — "your browser may clear this city if disk space runs low" — and lean harder on export.
- **Export / import to a file** from day one, and prompt for an export the first time a city crosses a size or age threshold. This is the browser answer to "copy your save folder before the patch," and it is also the only migration escape hatch that survives us shipping a bad schema change. Format: the serialized payload plus its metadata, gzip-compressed (`CompressionStream`), one downloadable file.
- **Quota handling is a first-class code path.** A `QuotaExceededError` on save must produce a real dialog offering to delete old autosaves, not a swallowed exception and a lost hour.

**Schema versioning from the first commit**

- Every save carries an integer `schemaVersion`. The loader has an explicit chain of migration functions from version *n* to *n+1*; loading runs the chain. This is trivial to add now and effectively impossible to retrofit once saves exist in the wild.
- If a save's version is **newer** than the build, refuse to load with a clear message rather than partially deserializing.
- Saves are **never** silently upgraded in place on load. Migration produces a new save; the original stays until the player has played on and saved.

**Explicitly out of v1**

- Quicksave/quickload keybinds (the named-save list plus autosave covers the need; add the keybind when players ask).
- Cloud sync of any kind.
- Multiple thumbnails, save-file comments, per-save screenshots beyond the one preview.
- Delta/incremental saves. At our state size a full snapshot is fine, and incremental saving is where corruption bugs live.

---

## Later path

Roughly in the order each stops being a nice-to-have:

1. **Serialization off the main thread** — structured-clone the snapshot between ticks, hand it to a worker for encoding and compression, write from there. Becomes necessary the moment a save costs a visible hitch, which will happen as soon as citizen-level state exists.
2. **A compact binary payload format** (typed arrays / columnar per-entity-type buffers) replacing whatever JSON-ish shape v1 ships. CS2's ~1 KB per 2.5 citizens is compressed binary; a JSON city will be many times that. Do this *after* the migration chain exists, so it is just another schema version.
3. **A corruption tripwire** — a checksum over the payload, written into the metadata and verified on load, so a bad save is detected at the list level and marked rather than crashing the loader. Pairs with keeping the previous known-good payload for one generation.
4. **Save-size telemetry surfaced to the player** — show payload size per save in the list, and warn against the browser's reported quota (`navigator.storage.estimate()`). CS2's bloat problem was invisible to players until the disk filled.
5. **Auto-export nudges / File System Access API handle** so a returning player's saves also land in a real folder they control, on browsers that support it.
6. **Named autosave promotion** — "keep this autosave" converts a rotating entry into a permanent named one, so a player who notices a disaster ten minutes late can rescue the snapshot before FIFO eats it.
7. **A city-history/timeline view** built on retained snapshots, once snapshots are cheap enough to keep many of. This is the point where the save system stops being plumbing and becomes a feature.
8. **Content/mod dependency recording** — only relevant if Metropolis ever gains user content. If it does, record the dependency set in the *metadata* (so the load screen can warn before loading, not crash after) and support CS2's safe-mode round-trip as an explicit "strip and re-save" action.

---

## Sources

- [Patch 1.5.X — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Patch_1.5.X)
- [Patch 1.3.X — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Patch_1.3.X)
- [Creating a Settings File — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Creating_a_Settings_File)
- [Photo Mode — Cities Skylines 2 Wiki](https://cs2.paradoxwikis.com/Photo_Mode)
- [Patch Notes for Cities: Skylines II (PatchBot)](https://patchbot.io/games/cities-skylines-ii)
- [Cities: Skylines II — PCGamingWiki](https://www.pcgamingwiki.com/wiki/Cities:_Skylines_II)
- [Paradox forums: Savegame Location (PC, Steam)](https://forum.paradoxplaza.com/forum/threads/savegame-location-pc-steam.1604558/)
- [Paradox forums: Editing savegame data & freedom to change anything](https://forum.paradoxplaza.com/forum/threads/editing-savegame-data-freedom-to-change-anything.1607111/)
- [Paradox forums: Save Files Too Big](https://forum.paradoxplaza.com/forum/threads/save-files-too-big.1622674/)
- [Paradox forums: Size of a save files](https://forum.paradoxplaza.com/forum/threads/size-of-a-save-files.1621584/)
- [Paradox forums: Corrupted save file](https://forum.paradoxplaza.com/forum/threads/corrupted-save-file.1624440/)
- [Paradox forums: Continue game button not functioning](https://forum.paradoxplaza.com/forum/threads/continue-game-button-not-functioning.1603873/)
- [Paradox forums: How to add preview/thumbnail to Editor Map?](https://forum.paradoxplaza.com/forum/threads/how-to-add-preview-thumbnail-to-editor-map.1648996/)
- [Paradox forums: Mods not working](https://forum.paradoxplaza.com/forum/threads/mods-not-working.1652115/)
- [Paradox Helpdesk: Save doesn't load / Mods cause error](https://support.paradoxplaza.com/hc/en-us/articles/235704207-Save-doesn-t-load-Mods-cause-error)
- [Steam discussion: Game save cannot be loaded / Game is constantly reset](https://steamcommunity.com/app/949230/discussions/0/6679490060452245673/)
- [Steam discussion: I lost 3 Cities to save data bug/corruption](https://steamcommunity.com/app/949230/discussions/0/3951406749575260572/)
- [Steam discussion: Does pausing the game still corrupt the save](https://steamcommunity.com/app/949230/discussions/0/4333106094378363775/)
- [Steam discussion: TURN ON AUTOSAVE](https://steamcommunity.com/app/949230/discussions/0/3877096256101796607/)
- [Steam discussion: No Auto save WTF](https://steamcommunity.com/app/949230/discussions/0/4031347296568271515/)
- [Steam discussion: Why is autosave not enabled by default!?](https://steamcommunity.com/app/949230/discussions/0/694249110938831534/)
- [Steam discussion: Where are My Autosaves](https://steamcommunity.com/app/949230/discussions/0/3877095833480453656/)
- [Steam discussion: check your saves files mine was over 100gb](https://steamcommunity.com/app/949230/discussions/0/6741411926478137460/)
- [Steam discussion: Save File Missing](https://steamcommunity.com/app/949230/discussions/0/3877095833475371093/)
- [Steam discussion: My CS2 save file is gone, how do I recover it?](https://steamcommunity.com/app/949230/discussions/0/4751948939816851463/)
- [Steam discussion: wheres my city???](https://steamcommunity.com/app/949230/discussions/0/3877095833476594430/)
- [Steam discussion: This patch just borked my saved games](https://steamcommunity.com/app/949230/discussions/0/666114913574397396/)
- [Steam discussion: 47gb file](https://steamcommunity.com/app/949230/discussions/0/3877096256101745919/)
- [Steam discussion: Mods doesnt LOAD](https://steamcommunity.com/app/949230/discussions/0/4362372998096392452/)
- [Escapist: PSA — CS2 has autosave off by default](https://www.escapistmagazine.com/how-turn-autosave-on-cities-skylines-2/)
- [Pro Game Guides: CS2 — How to turn on autosave](https://progameguides.com/cities-skylines-2/cities-skylines-2-how-to-turn-on-autosave/)
- [eXputer: CS2 — How to turn on autosave](https://exputer.com/guides/cities-skylines-2-autosave/)
- [GameSkinny: CS2 — How to enable auto saves](https://www.gameskinny.com/tips/cities-skylines-2-how-to-enable-auto-saves/)
- [Twinfinite: How to save in Cities Skylines 2](https://twinfinite.net/guides/how-to-save-cities-skylines-2/)
- [MiniTool: CS2 save file location](https://www.minitool.com/news/cities-skylines-2-save-file-location.html)
- [EaseUS: CS2 save disappeared — how to recover save files](https://www.easeus.com/file-recovery/cities-skylines-2-save-disappeared.html)
- [DefKey: Cities Skylines 2 keyboard controls](https://defkey.com/cities-skylines-2-shortcuts)
- [Shacknews: CS2 PC keybindings & controls](https://www.shacknews.com/article/137454/pc-buttons-controls-cities-skylines-2)
- [GameRant: CS2 photo mode & screenshot save location](https://gamerant.com/cities-skylines-2-how-use-photo-mode-screenshot-save-location/)
- [ReSHax: Cities Skylines II file format thread](https://reshax.com/topic/688-cities-skylines-ii/)
- [Pinter Computing: Creating a new mod for Cities: Skylines II](https://pinter.org/archives/15652)
