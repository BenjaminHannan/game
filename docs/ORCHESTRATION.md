# Project Civitopia — Orchestration Plan

**Goal:** An original, open-source 3D city-building game that replicates the *mechanics* of
Cities: Skylines II as faithfully as practical in a browser engine. All code, art, names, and
text are original — no assets, code, or copy from the real game are used. Mechanics and numeric
parameters (which are not copyrightable) are recreated from public documentation.

**Working title:** Civitopia
**Stack:** TypeScript (strict) + Vite + Three.js + vitest. No backend; saves in localStorage/JSON.
**Coding:** all implementation delegated to Opus agents at medium effort; this session orchestrates.

## Phases

| Phase | Content | Status |
|---|---|---|
| 0 | Repo intake; archive prior Fathom scope docs | done |
| 1 | Research (7 parallel agents → docs/research/*.md), engine scaffold, DESIGN.md synthesis | running |
| 2 | Architecture + contracts (types, system interfaces), commit + push | pending |
| 3 | Roads: graph, placement tool, meshes, pathfinding | pending |
| 4 | Zoning, buildings, RCI demand, leveling | pending |
| 5 | Utilities (power/water/sewage), garbage, service coverage | pending |
| 6 | Citizens, households, jobs, education, lifecycle | pending |
| 7 | Traffic agents + vehicles; transit if budget allows | pending |
| 8 | Economy: taxes, budgets, upkeep, imports/exports, land value | pending |
| 9 | Progression: milestones, XP, dev points, map tile purchase; policies | pending |
| 10 | Integration QA, playtest via Playwright, bugfix, polish | pending |
| 11 | README, final commit, push, PR | pending |

## Conventions for coding agents

- Model: opus, effort medium. Agents do NOT run `git commit` — the orchestrator commits per phase.
- Original code only; paraphrase research, never copy source text verbatim.
- Every phase must end with `npm run typecheck`, `npm run build`, `npm test` passing.
- Units: meters. Sim: fixed timestep, deterministic (seeded RNG), decoupled from render.
- File ownership per agent is listed in each phase prompt to avoid conflicts; shared contracts
  live in `src/core/types.ts` + `src/sim/` interfaces and are frozen during parallel phases.
