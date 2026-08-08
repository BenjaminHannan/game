# Metropolis

An original open-source 3D city-building game for the browser, inspired by Cities: Skylines II. TypeScript + three.js, simulation-first.

**Status: early development.** Engine loop, procedural terrain, orbit camera, input tooling, and the save system are in place; road drawing is the next milestone, then zoning and the growth simulation.

## Develop

```
npm install
npm run dev        # vite dev server
npm test           # vitest suite
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

## Layout

- `src/core/` — engine loop, events, RNG, noise, save system, sim clock
- `src/render/` — renderer, terrain, sky, camera rig
- `src/sim/` — simulation state
- `src/input/`, `src/ui/` — pointer/tool handling, HUD
- `docs/ORCHESTRATION.md` — build plan · `docs/research/roads.md` — road-network research
