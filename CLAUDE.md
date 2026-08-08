# Metropolis

Original open-source 3D city-building game for the browser — TypeScript + three.js + vite, simulation-first, inspired by Cities: Skylines II.

Commands: `npm ci` · `npm run dev` · `npm test` · `npm run typecheck` · `npm run build`

Layout: `src/core` (engine loop, events, rng, noise, save, time) · `src/render` (renderer, terrain, sky, camera rig, road meshes) · `src/sim` (state, road graph) · `src/input` (pointer, tools) · `src/ui` (HUD). Build plan: `docs/ORCHESTRATION.md`. Before implementing a major system, write a research doc in `docs/research/` and implement against it (see `roads.md`). Open design questions live in `docs/UNKNOWNS.md` — resolve a milestone's entries with the owner before building that milestone.

Project rules:

- Heavy implementation and research run on Opus subagents at low/medium reasoning effort (owner's standing preference).
- Never brand the game "Cities: Skylines" — that's Colossal Order/Paradox's trademark. Original name (working title Metropolis), original code and assets; describing it as "inspired by Cities: Skylines II" is fine.
- Keep this file lean: pointers over payloads.
