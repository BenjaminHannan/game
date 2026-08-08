# Simulation core — design notes

Design for the Metropolis city-simulation core: tick cadence, population/jobs, RCI demand, money,
and the failure-soft broke state. Written to be implemented directly against the modules that
already exist (`src/core/engine.ts`, `src/core/time.ts`, `src/sim/state.ts`, `src/sim/roads.ts`,
`src/core/save.ts`, `src/ui/hud.ts`). Everything here is original design work; the CS2 research in
`docs/research/roads.md` informs the shape of the model, not its text.

Scope boundary: this doc owns the *aggregate* city model — counts, money, demand. Zoning cells and
individual building growth are phase 4's job; this doc specifies the interfaces they plug into and
assumes a `Building` record exists with the fields listed in §2. Per-citizen agents (phase 6) are
explicitly out of scope: v1 population is a number derived from housing, not a list of people.

---

## 1. Tick cadence

`Engine` already runs a fixed 20 ticks/s accumulator decoupled from render, and
`time.ts` fixes 40 ticks per in-game day. So at speed 1: 1 day = 2 s real, 1 month = 60 s real,
1 year = 12 min real. That is the budget every rate below is tuned against.

`GameSpeed` in the engine is `0 | 1 | 2 | 4`. The HUD already presents three running buttons
labelled 1x/2x/3x bound to multipliers 1/2/4. Keep it: the third button is a "fastest" button, and
the label is a UI affordance, not a claim about the multiplier. Do not add new speeds in v1 —
above 4x the tick rate (80/s) starts competing with the render loop for frame time.

Running every subsystem at 20 Hz is wasteful and makes the economy feel jittery. Instead the sim
runs **phase buckets** keyed off the absolute tick index, all derived from `TICKS_PER_DAY`:

| Bucket | Period | Ticks @1x | What runs |
|---|---|---|---|
| `tick` | every tick | 1 | cheap counters, spawn/despawn queue drain (≤ N per tick) |
| `daily` | 40 ticks | 1 day | population/jobs recount, demand recompute, growth pass |
| `monthly` | 1200 ticks | 1 month | tax income, road upkeep, treasury settlement |

```ts
export const enum Cadence { Tick, Daily, Monthly }

export interface System {
  readonly id: string;
  readonly cadence?: Cadence;   // defaults to Cadence.Tick
  step(state: GameState, tick: number, ctx: TickContext): void;
}

export interface TickContext {
  /** In-game days represented by this invocation (1 for daily systems, 30 for monthly). */
  readonly days: number;
  /** True on the tick that opens a new in-game month. */
  readonly monthBoundary: boolean;
  readonly date: GameDate;
}
```

`Simulation.step` grows a small dispatcher: run `Cadence.Tick` systems always, `Daily` when
`tick % TICKS_PER_DAY === 0`, `Monthly` when `tick % (TICKS_PER_DAY * DAYS_PER_MONTH) === 0`.
This keeps `System` backward-compatible (existing systems omit `cadence`) and keeps determinism:
the bucket is a pure function of the tick index, so a save/load that restores `tick` resumes on
exactly the same schedule. Nothing may branch on wall-clock time or on `speed` — speed only changes
how many ticks happen per real second, never what a tick does.

Rate quantities are stored **per month** (the unit the player sees in the budget) and multiplied by
`ctx.days / DAYS_PER_MONTH` when a shorter-cadence system needs them, so retuning a cadence never
silently changes the economy's balance.

---

## 2. Population and jobs

Population is *derived*, never authored. Grown buildings are the only source. Phase 4 will own the
building list; the sim core reads it through one narrow interface so the two can be built in
parallel:

```ts
export type ZoneKind = 'residential' | 'commercial' | 'industrial';

export interface Building {
  id: number;
  kind: ZoneKind;
  /** Density level 1..3; drives capacity multipliers. */
  level: number;
  /** Occupied fraction in [0,1], moved toward the target by the growth pass. */
  occupancy: number;
  /** Households (R) or job slots (C/I) at full occupancy. */
  capacity: number;
}

export interface CityTotals {
  households: number;      // sum of R capacity
  residents: number;       // households * HOUSEHOLD_SIZE * occupancy
  workforce: number;       // residents * WORKING_AGE_FRACTION
  jobsCommercial: number;
  jobsIndustrial: number;
  jobsFilled: number;
  unemployment: number;    // [0,1]
  goodsSupply: number;     // I output per month
  goodsDemand: number;     // C throughput need per month
}
```

Tunables (all in one exported `SIM_TUNING` object so a later balance pass is a one-file edit):

| Constant | Value | Rationale |
|---|---|---|
| `HOUSEHOLD_SIZE` | 2.4 | residents per occupied household |
| `WORKING_AGE_FRACTION` | 0.55 | share of residents who want a job |
| `JOBS_PER_COMMERCIAL_L1` | 6 | scaled by level: `× level` |
| `JOBS_PER_INDUSTRIAL_L1` | 10 | industry is job-dense at low level |
| `GOODS_PER_INDUSTRIAL_JOB` | 1.0 | arbitrary unit; only ratios matter |
| `GOODS_PER_RESIDENT` | 0.35 | consumption pulled through commerce |
| `OCCUPANCY_RATE` | 0.15/day | how fast a building fills or empties |

The daily recount is one linear pass over buildings, accumulating into `CityTotals`. Occupancy per
building moves toward a target derived from citywide pressure (housing demand for R, filled-jobs
ratio for C/I) by at most `OCCUPANCY_RATE` per day, so numbers glide instead of snapping.
`state.population = Math.round(totals.residents)` at the end of the pass — the HUD keeps reading
the same field it reads today.

Honest framing for the player-facing docs: this is a statistical model. No citizen exists. A
building with occupancy 0.5 does not have half its flats picked out; it contributes half its
capacity to every aggregate. Phase 6 can replace the occupancy scalar with real households without
touching the demand or money code, because everything downstream consumes `CityTotals`.

---

## 3. RCI demand

Demand answers one question per zone kind: *if the player zoned another cell of this right now,
would something grow there?* It is a scalar in `[-1, 1]`, surfaced to the HUD as three bars, and
consumed by the growth pass as a probability multiplier.

The couplings, deliberately simple and each one a single ratio:

- **Residential** wants housing when jobs outnumber workers and when vacancy is low.
  `rawR = w1 * (jobsTotal - workforce) / max(jobsTotal, 1) + w2 * (1 - vacancyR)`
- **Commercial** wants floor space when residents' goods appetite exceeds current commercial
  throughput. `rawC = (goodsDemand - commercialThroughput) / max(goodsDemand, 1)`
- **Industrial** wants floor space when commerce needs more goods than industry supplies, damped by
  the share of the workforce that is unemployed (idle labour makes industry attractive).
  `rawI = (goodsDemand - goodsSupply) / max(goodsDemand, 1) + w3 * unemployment`

Each raw value is clamped to `[-1,1]` and then **smoothed** into the stored demand with an
exponential filter, `demand += (raw - demand) * DEMAND_SMOOTHING` (≈0.2/day). Smoothing is what
makes the bars feel like a simulation rather than a formula: without it, a single building
completing flips a bar visibly.

Bootstrap case matters more than the steady state. An empty city has zero of everything and every
ratio is 0/0. Seed it: when `residents < SEED_POPULATION` (say 200), demand is floored at
`{ r: 0.8, c: 0.3, i: 0.5 }` so the first zoned cells always grow and the "first five minutes"
decision in `docs/UNKNOWNS.md` holds. Fade the floor out linearly as population approaches the
threshold rather than cutting it off, or the city stalls hard at 200.

```ts
export interface DemandState { r: number; c: number; i: number; }
```

Two guardrails worth writing tests for: demand must never produce NaN from an empty city (every
denominator is `max(x, 1)`), and a city with no roads must sit at whatever demand says while
growing nothing — road frontage is a hard precondition owned by zoning, not a demand input.

---

## 4. Money

Starting treasury is already `STARTING_MONEY = 500_000` in `src/sim/state.ts`. Keep it; it buys
roughly 250 km of two-lane road at the existing `costPerMetre: 2`, which is a comfortable but not
infinite opening.

**Build costs.** Roads already price themselves: `RoadNetwork.planBetween` computes
`cost = round(length * ROAD_CLASSES[cls].costPerMetre)` and `roadTool` already decrements
`budget.money` on commit and refuses a plan it cannot afford. That is the pattern every other tool
copies — *price in the plan, charge on commit*. Zoning charges per painted cell
(`ZONE_COST_PER_CELL`, ~10 for a 8×8 m cell) and refunds nothing on de-zone; bulldozing a road
refunds `BULLDOZE_REFUND_FRACTION` (0.25) of the original cost, matching the post-Economy-2.0 spirit
of a stingy refund. Store the paid cost on the edge so the refund does not have to be re-derived.

All treasury mutations go through one funnel rather than scattered `state.money -=` lines:

```ts
export type LedgerCategory = 'construction' | 'roadUpkeep' | 'tax' | 'refund';

export interface Ledger {
  /** Attempt to spend. Returns false and changes nothing if unaffordable. */
  spend(amount: number, category: LedgerCategory): boolean;
  /** Unconditional credit. */
  earn(amount: number, category: LedgerCategory): void;
  /** Last settled month, for the HUD/budget panel. */
  readonly lastMonth: Readonly<Record<LedgerCategory, number>>;
}
```

`spend` returning a boolean is what makes the broke state failure-soft (§5). The per-category
monthly accumulator costs one object and gives the eventual budget panel its data for free.

**Tax income**, settled monthly:

```
income = Σ over buildings of  base[kind] * level * occupancy * capacityUnits * taxRate[kind]
```

with `taxRate` defaulting to 0.10 for all three kinds and clamped to `[0, 0.30]` when the player
gets sliders (phase 8). Residential is taxed on residents, C/I on filled jobs — that way an empty
building generates nothing, which is the feedback the player needs. Rough target: a healthy
mid-game city runs a small surplus at 10%, so `base` values should be picked so that income
slightly exceeds upkeep at ~5k population.

**Road maintenance**, also monthly: `Σ edge.length * ROAD_CLASSES[edge.roadClass].upkeepPerMetre`.
`RoadClass` needs one new field, `upkeepPerMetre` — 0.16/month/m for `small` and 0.10 for `gravel`
follow the ~16-per-100m figure recorded in the roads research. `RoadNetwork.totalLength` exists but
is class-agnostic; add a cached per-class length map invalidated by `revision` rather than summing
edges every month (see §7).

The v1 budget has exactly two lines, tax in and road upkeep out. Service buildings, loans, and tile
upkeep are phase 8. Do not stub them with zeros in the save — omit them, and let §8's migration
posture add them.

---

## 5. Being broke

**No game-over in v1.** Bankruptcy as a lose condition is punishing in a sandbox builder and
produces exactly the kind of unrecoverable state that makes people stop playing.

The rules:

1. **Construction is blocked, not queued.** `Ledger.spend` returns false; the tool refuses the plan
   and the HUD hint says why. `roadTool` already renders an unaffordable plan as rejected — reuse
   that path, with a distinct rejection reason `'unaffordable'` so the message can be specific.
2. **Upkeep is always paid, even into the negative.** Money may go below zero from the monthly
   settlement. Clamping upkeep instead would let a player build an enormous network and then simply
   never pay for it.
3. **Negative treasury applies a soft brake, not a wall.** While `money < 0`, growth probability is
   multiplied by `BROKE_GROWTH_PENALTY` (0.35) and demand bars are damped. The city visibly stalls,
   and the player's way out is the tax slider and time — both available, neither instant.
4. **Nothing is destroyed.** No forced demolition, no service shutdown cascade in v1.
5. The HUD turns the money readout red at `money < 0` and amber when the last settled month was a
   net loss. That amber warning is the actual anti-frustration feature: it fires while the player
   can still act.

An explicit invariant for tests: no code path outside `Ledger` writes `state.money`, and no code
path may set it to NaN or Infinity (guard `spend`/`earn` against non-finite amounts).

---

## 6. HUD surface

`src/ui/hud.ts` already renders city name, date + time-of-day, money, population, speed buttons,
tool bar, and a debug panel, all from `state` and `engine` every frame. What it gains:

- **Demand bars** — three stacked horizontal bars (R green / C blue / I amber) reading
  `state.demand`, drawn from the centre so negative demand is legible as a leftward bar. Update at
  the same per-frame cadence as the rest of the HUD; the underlying value only changes daily, so
  interpolating the bar width toward the target gives free visual smoothing.
- **Money delta** — the last settled month's net, next to the treasury, with colour coding per §5.
- **Population sub-line** — jobs filled / jobs total, or unemployment percent. This is the single
  most useful number for diagnosing why demand looks the way it does.
- **Date/speed** — unchanged; already correct.

The HUD reads state directly and re-renders per frame, which is fine at this scale. Keep it pull-
based rather than wiring `EventBus` notifications for every counter; the event bus is better spent
on discrete occurrences (`'money:insufficient'`, `'milestone:reached'`) that need a transient toast.
One event worth adding now: `'economy:settled'` with the monthly ledger snapshot, so the future
budget panel and any tutorial hooks have a clean seam.

---

## 7. Performance

Budget: 1–2k buildings at 60 fps, per `docs/UNKNOWNS.md`.

- The daily pass is O(buildings) — 2k iterations 20 times per real second at 4x speed is ~40k
  simple field reads per second. That is nothing. The pass must stay *allocation-free*: accumulate
  into a preallocated `CityTotals` object, never `map`/`filter` over the building list.
- Store buildings in a flat array with a parallel id→index map. Deletion is swap-remove; ids stay
  stable, indices do not, so nothing may cache an index across a tick.
- If profiling ever shows the daily pass in the frame budget (it should not below 5k buildings),
  the fix is striping: process `buildings.length / TICKS_PER_DAY` buildings per tick so a full pass
  completes each day, with totals double-buffered so readers always see a consistent snapshot. Do
  not build this preemptively — it complicates determinism for no measured gain.
- Road upkeep must not re-walk every edge monthly at large network sizes. Maintain
  `lengthByClass: Record<RoadClassId, number>` incrementally in `RoadNetwork.commit`/`removeEdge`,
  or recompute lazily keyed on the existing `revision` counter. Prefer the lazy revision-keyed
  cache: one code path, and it self-heals after a load or a `clear()`.
- The demand recompute is O(1) given `CityTotals` — it never touches the building list.
- Keep all sim work off the render thread's allocation path. The realistic 60fps risk in this
  project is mesh rebuilds and GC pressure from per-frame object churn in the HUD, not arithmetic.

---

## 8. Save and migration

`SaveManager` writes a versioned document; `Simulation` is the `sim` provider and already
round-trips `GameState` with a normalizing `deserialize`. Extending it:

- Add `buildings`, `demand`, `zones`, and `economy` (tax rates + last-month ledger) to `GameState`.
  All are plain JSON — no class instances, no `Map`, no `Set` in persisted shapes.
- `Simulation.serialize` must deep-copy the new arrays the way it already deep-copies roads.
  Returning live references would let a later tick mutate a snapshot mid-write.
- `deserialize` follows the road precedent: **repair, don't trust.** Write
  `normalizeSimState(input: unknown)` that fills every missing field with its default, drops
  buildings referencing unknown zones or non-finite numbers, clamps demand to `[-1,1]`, and forces
  `money` finite. A save from an earlier build simply lacks `buildings`; it must load as an empty
  list, not throw.
- Derived values are **not** saved: `CityTotals` is recomputed on the first daily tick after load.
  Only `demand` is persisted, because its smoothing gives it real history that would otherwise pop.
- Migration posture for v1: additive fields with defaults, no `SAVE_VERSION` bump. Bump only when a
  field changes meaning or is removed, and when that happens write an explicit
  `migrate(doc, fromVersion)` step rather than widening the normalizer — the normalizer's job is
  tolerating garbage, not understanding history. `loadFromString` already refuses future versions,
  which is the right default.
- Determinism check for the round-trip: `tick` is saved, and all cadence buckets derive from it, so
  a save at tick 12 345 resumes mid-month correctly with the partial month's accumulators intact
  (persist those accumulators, or accept a one-month rounding error — persisting is cheaper than
  explaining the discrepancy).

---

## 9. Test plan

Vitest, no DOM required for any of these.

**Cadence**
- Daily systems fire exactly once per 40 ticks and monthly exactly once per 1200, over a 3-year run.
- Bucket membership is independent of speed: stepping 1200 ticks in one burst and in 1200 single
  steps produces identical state.
- `TickContext.days` sums to the elapsed in-game days across a run.

**Population/jobs**
- Empty city: all totals zero, no NaN.
- One R building at capacity 10, occupancy 1 → residents 24, workforce 13 (rounding pinned).
- Occupancy moves monotonically toward its target and never leaves `[0,1]`.

**Demand**
- Seeded empty city reports positive R demand (the first-five-minutes guarantee).
- Housing-only city drives C and I demand positive and R demand negative within N days.
- Demand is clamped and finite under adversarial inputs (zero jobs, zero residents, huge capacity).
- Smoothing: a step change in raw demand takes >1 day to reach 90% of the new value.

**Money**
- `spend` refuses when it would go below zero and leaves `money` untouched; `earn` always credits.
- Road commit debits exactly `plan.cost`; bulldoze refunds exactly the configured fraction.
- Monthly settlement equals `tax - upkeep` computed independently in the test.
- Upkeep drives money negative rather than clamping at zero.
- Non-finite amounts are rejected.

**Broke behaviour**
- With `money < 0`: every build tool's plan is rejected, growth continues at the penalized rate, and
  no building is removed.
- Recovery: raising tax and running N months returns the treasury positive without intervention.

**Save**
- Round-trip equality of the full `GameState` after a 500-tick run (serialize → deserialize →
  serialize, compare JSON).
- A save document missing `buildings`/`demand`/`economy` loads with defaults and no throw.
- A save with corrupted values (NaN money, demand 47, a building with an unknown zone) normalizes
  to something playable.
- Serialize returns a deep copy: mutating the snapshot does not affect live state.
