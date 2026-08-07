# Fathom

A deep-sea idle game for the browser. Send drones into the abyss, salvage what they find, and see how deep you can go.

**Play it:** open `index.html` in a browser — or serve the folder with any static server (`python3 -m http.server`). No build step, no dependencies.

To host it on GitHub Pages: repo **Settings → Pages → Deploy from a branch**, pick this branch and `/ (root)`.

- Design, feature spec, and build plan: [SCOPE.md](SCOPE.md)
- All content and balance numbers: [`js/data.js`](js/data.js) — tuning the game is editing that file
- Engine (state, economy, saves): [`js/game.js`](js/game.js) · UI: [`js/ui.js`](js/ui.js)

Saves live in your browser (localStorage, autosaved every 15 s), with offline earnings when you come back and an export/import code in settings for moving between browsers.
