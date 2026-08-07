// All DOM ownership lives here. No economy math: every number comes from game.js.
// The DOM is built exactly once at boot; render() only toggles classes/hidden
// and pushes text through setText, which skips untouched nodes so the 200 ms
// heartbeat never dirties layout for free.

import * as game from './game.js';
import { COLLECTORS, UPGRADES, DISCOVERIES, OFFLINE } from './data.js';

const TICK_MS = 200;
const AUTOSAVE_MS = 15000;
const SAVE_DEBOUNCE_MS = 1000;
const MYSTERY_REVEAL_FRACTION = 0.35;

// ---------------------------------------------------------------- helpers

const $ = id => document.getElementById(id);

// Caches the last string per node; touching textContent is the expensive part.
function setText(node, text) {
  if (!node) return;
  const s = String(text);
  if (node.__fathomText === s) return;
  node.__fathomText = s;
  node.textContent = s;
}

function setHidden(node, hidden) {
  if (!node) return;
  if (node.hidden !== hidden) node.hidden = hidden;
}

function setClass(node, name, on) {
  if (!node) return;
  if (node.classList.contains(name) !== !!on) node.classList.toggle(name, !!on);
}

function setDisabled(node, disabled) {
  if (!node) return;
  if (node.disabled !== disabled) node.disabled = disabled;
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) setText(n, text);
  return n;
}

// "3 h 12 m" / "45 m" / "50 s" — coarse on purpose, this is prose not a clock.
function humanizeDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' m';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? h + ' h ' + rem + ' m' : h + ' h';
}

// ---------------------------------------------------------------- element refs

const dom = {
  salvage: $('stat-salvage'),
  rate: $('stat-rate'),
  depth: $('stat-depth'),
  zone: $('stat-zone'),
  artifactBox: $('stat-artifact-box'),
  artifacts: $('stat-artifacts'),
  click: $('stat-click'),
  ping: $('ping'),
  collectors: $('collectors'),
  upgrades: $('upgrades'),
  upgradesEmpty: $('upgrades-empty'),
  log: $('log'),
  discCount: $('disc-count'),
  prestigeBox: $('prestige-box'),
  prestigeBtn: $('prestige-btn'),
  prestigeGain: $('prestige-gain'),
  saveBtn: $('save-btn'),
  exportBtn: $('export-btn'),
  importBtn: $('import-btn'),
  wipeBtn: $('wipe-btn'),
  saveNote: $('save-note'),
  overlay: $('overlay'),
  overlayCard: $('overlay-card'),
};

const rows = { collectors: [], upgrades: [], log: [] };

// ---------------------------------------------------------------- static DOM

function buildCollectors() {
  const frag = document.createDocumentFragment();
  for (const c of COLLECTORS) {
    const btn = el('button', 'collector');
    btn.type = 'button';

    const emoji = el('span', 'collector-emoji', c.emoji);
    const mid = el('div');
    const name = el('div', 'collector-name');
    const nameText = document.createElement('span');
    const count = el('span', 'count');
    name.append(nameText, count);
    const sub = el('div', 'collector-sub');
    mid.append(name, sub);

    const cost = el('div', 'collector-cost');
    const costMain = document.createElement('span');
    const costSmall = el('small', null, 'salvage');
    cost.append(costMain, costSmall);

    btn.append(emoji, mid, cost);
    btn.addEventListener('click', () => {
      if (game.buyCollector(c.id)) render();
    });

    rows.collectors.push({ def: c, btn, emoji, nameText, count, sub, costMain });
    frag.appendChild(btn);
  }
  dom.collectors.appendChild(frag);
}

function buildUpgrades() {
  const frag = document.createDocumentFragment();
  for (const u of UPGRADES) {
    const btn = el('button', 'upgrade');
    btn.type = 'button';
    btn.title = u.blurb;

    const emoji = el('span', 'upgrade-emoji', u.emoji);
    const mid = document.createElement('span');
    const name = el('span', 'upgrade-name', u.name);
    const sub = el('span', 'upgrade-sub', u.blurb);
    mid.append(name, sub);
    const cost = el('span', 'upgrade-cost');

    btn.append(emoji, mid, cost);
    btn.addEventListener('click', () => {
      if (game.buyUpgrade(u.id)) render();
    });

    rows.upgrades.push({ def: u, btn, cost });
    frag.appendChild(btn);
  }
  dom.upgrades.appendChild(frag);
}

function buildLog() {
  const frag = document.createDocumentFragment();
  for (const d of DISCOVERIES) {
    const row = el('div', 'log-entry');
    const emoji = el('span', 'log-emoji', d.emoji);
    const body = document.createElement('div');
    const name = el('div', 'log-name');
    const nameText = document.createElement('span');
    const depth = el('span', 'log-depth');
    name.append(nameText, depth);
    const bonus = el('div', 'log-bonus');
    const flavor = el('div', 'log-flavor');
    body.append(name, bonus, flavor);
    row.append(emoji, body);

    rows.log.push({ def: d, row, emoji, nameText, depth, bonus, flavor });
    frag.appendChild(row);
  }
  dom.log.appendChild(frag);
}

// ---------------------------------------------------------------- render

function renderHeader(state) {
  const d = game.depth();
  const zone = game.zoneFor(d);
  setText(dom.salvage, game.format(Math.floor(state.salvage)));
  setText(dom.rate, game.format(game.totalRate()));
  setText(dom.depth, game.format(Math.floor(d)));
  setText(dom.zone, zone.name);
  if (document.body.dataset.zone !== zone.id) document.body.dataset.zone = zone.id;
  setText(dom.click, game.format(game.clickPower()));
  setHidden(dom.artifactBox, !(state.artifacts > 0));
  setText(dom.artifacts, game.format(state.artifacts));
}

function renderCollectors(state) {
  let mysteryUsed = false;
  let hideRest = false;

  for (const r of rows.collectors) {
    const owned = state.owned[r.def.id] || 0;
    const revealed = owned > 0 ||
      state.runLifetime >= MYSTERY_REVEAL_FRACTION * r.def.baseCost;
    const cost = game.collectorCost(r.def.id);

    if (hideRest) {
      setHidden(r.btn, true);
      continue;
    }
    setHidden(r.btn, false);

    if (!revealed) {
      // Exactly one teaser row, then the fleet list stops.
      mysteryUsed = true;
      hideRest = true;
      setClass(r.btn, 'mystery', true);
      setClass(r.btn, 'affordable', false);
      setDisabled(r.btn, true);
      setText(r.nameText, '???');
      setText(r.count, '');
      setText(r.sub, 'Unidentified');
      setText(r.costMain, game.format(cost));
      continue;
    }

    setClass(r.btn, 'mystery', false);
    setText(r.nameText, r.def.name);
    setText(r.count, owned > 0 ? String(owned) : '');
    setText(r.sub,
      game.format(r.def.rate * game.collectorMult(r.def.id) * game.globalMult()) +
      '/s each · ' + game.format(game.collectorRate(r.def.id)) + '/s total');
    setText(r.costMain, game.format(cost));

    const canBuy = state.salvage >= cost;
    setClass(r.btn, 'affordable', canBuy);
    setDisabled(r.btn, !canBuy);
  }
  return mysteryUsed;
}

function renderUpgrades(state) {
  const visible = new Set(game.visibleUpgrades().map(u => u.id));
  let shown = 0;

  for (const r of rows.upgrades) {
    const show = visible.has(r.def.id) && !state.upgrades.includes(r.def.id);
    setHidden(r.btn, !show);
    if (!show) continue;
    shown += 1;
    setText(r.cost, game.format(r.def.cost));
    const canBuy = state.salvage >= r.def.cost;
    setClass(r.btn, 'affordable', canBuy);
    setDisabled(r.btn, !canBuy);
  }
  setHidden(dom.upgradesEmpty, shown > 0);
}

function renderLog(state) {
  let pendingUsed = false;
  let found = 0;

  for (const r of rows.log) {
    const isFound = state.discoveries.includes(r.def.id);
    if (isFound) {
      found += 1;
      setHidden(r.row, false);
      setClass(r.row, 'pending', false);
      setText(r.emoji, r.def.emoji);
      setText(r.nameText, r.def.name);
      setText(r.depth, r.def.depth + ' m');
      setText(r.bonus, r.def.bonusText);
      setText(r.flavor, r.def.flavor);
    } else if (!pendingUsed) {
      pendingUsed = true;
      setHidden(r.row, false);
      setClass(r.row, 'pending', true);
      setText(r.emoji, r.def.emoji);
      setText(r.nameText, '???');
      setText(r.depth, '');
      setText(r.bonus, '');
      setText(r.flavor, 'Something at ' + r.def.depth + ' m…');
    } else {
      setHidden(r.row, true);
    }
  }
  setText(dom.discCount, found + ' / ' + DISCOVERIES.length);
}

function renderPrestige(state) {
  const available = game.prestigeAvailable();
  const gain = game.prestigeGain();
  setHidden(dom.prestigeBox, !(available || state.artifacts > 0));
  setText(dom.prestigeGain, game.format(gain));
  setDisabled(dom.prestigeBtn, !available || gain < 2);
}

function render() {
  const state = game.getState();
  renderHeader(state);
  renderCollectors(state);
  renderUpgrades(state);
  renderLog(state);
  renderPrestige(state);
}

// ---------------------------------------------------------------- card queue

const cardQueue = [];
let cardShowing = false;

function enqueueCard(card) {
  cardQueue.push(card);
  if (!cardShowing) showNextCard();
}

function showNextCard() {
  const card = cardQueue.shift();
  if (!card) {
    cardShowing = false;
    setHidden(dom.overlay, true);
    dom.overlayCard.replaceChildren();
    return;
  }
  cardShowing = true;

  const kicker = el('div', 'card-kicker', card.kicker || '');
  const emoji = el('span', 'card-emoji', card.emoji || '✨');
  const title = el('h3', null, card.title || '');
  const flavor = el('p', 'card-flavor', card.flavor || '');
  const bonus = el('p', 'card-bonus', card.bonus || '');
  const dismiss = el('button', 'card-dismiss', 'Continue');
  dismiss.type = 'button';
  dismiss.addEventListener('click', showNextCard);

  dom.overlayCard.replaceChildren(emoji, kicker, title, flavor, bonus, dismiss);
  setHidden(dom.overlay, false);
  dismiss.focus();
}

function queueResult(res) {
  if (!res) return;
  if (res.offline) {
    enqueueCard({
      kicker: 'WELCOME BACK',
      emoji: '🌅',
      title: 'While you were away…',
      flavor: 'Away for ' + humanizeDuration(res.offline.seconds) + '. Your fleet ran at ' +
        Math.round(OFFLINE.rate * 100) + '% rate without you aboard.',
      bonus: '+' + game.format(res.offline.gain) + ' salvage',
    });
  }
  for (const d of res.found || []) {
    enqueueCard({
      kicker: 'DISCOVERY — ' + d.depth + ' m',
      emoji: d.emoji,
      title: d.name,
      flavor: d.flavor,
      bonus: d.bonusText,
    });
  }
}

// ---------------------------------------------------------------- ping feedback

function spawnPingFloat(amount, x, y) {
  const span = el('span', 'ping-float', '+' + game.format(amount));
  span.style.left = x + 'px';
  span.style.top = y + 'px';
  span.addEventListener('animationend', () => span.remove());
  document.body.appendChild(span);
}

function onPing(event) {
  const amount = game.ping();
  render();
  // Keyboard activation reports 0,0 — fall back to the button's own centre.
  let x = event && event.clientX;
  let y = event && event.clientY;
  if (!x && !y) {
    const box = dom.ping.getBoundingClientRect();
    x = box.left + box.width / 2;
    y = box.top + box.height / 2;
  }
  spawnPingFloat(amount, x, y);
}

// ---------------------------------------------------------------- persistence

let lastSaveAt = 0;
let saveNoteTimer = 0;

function idleSaveNote() {
  if (!game.storageOk()) {
    setText(dom.saveNote, '⚠️ Saving unavailable in this browser.');
  } else {
    setText(dom.saveNote, 'Autosaves every 15 s');
  }
}

function doSave(force) {
  const now = Date.now();
  if (!force && now - lastSaveAt < SAVE_DEBOUNCE_MS) return false;
  lastSaveAt = now;
  const ok = game.save();
  if (!ok) idleSaveNote();
  return ok;
}

function flashSaveNote(text) {
  setText(dom.saveNote, text);
  clearTimeout(saveNoteTimer);
  saveNoteTimer = setTimeout(idleSaveNote, 1600);
}

function catchUp() {
  queueResult(game.advance(Date.now()));
  render();
}

// ---------------------------------------------------------------- events

function wireEvents() {
  dom.ping.addEventListener('click', onPing);

  dom.prestigeBtn.addEventListener('click', () => {
    const gain = game.prestigeGain();
    if (!game.prestigeAvailable() || gain < 2) return;
    const msg = 'Surface & Refit for ' + gain + ' artifacts?\n\n' +
      'Your fleet, salvage and upgrades reset. Discoveries and artifacts are kept.';
    if (!confirm(msg)) return;
    const gained = game.surfaceAndRefit();
    lastSaveAt = Date.now();
    render();
    enqueueCard({
      kicker: 'SURFACE & REFIT',
      emoji: '⚓',
      title: 'Refit complete',
      flavor: 'You break the surface with the hold full of abyssal alloy.',
      bonus: '+' + gained + ' 🏺 artifacts — +25% production each, forever',
    });
  });

  dom.saveBtn.addEventListener('click', () => {
    const ok = doSave(true);
    flashSaveNote(ok ? '💾 Saved.' : '⚠️ Could not save.');
  });

  dom.wipeBtn.addEventListener('click', () => {
    if (!confirm('Wipe your save? This erases everything, including artifacts.')) return;
    if (!confirm('Really wipe? There is no undo.')) return;
    game.wipe();
    location.reload();
  });

  dom.exportBtn.addEventListener('click', () => {
    prompt('Copy your save code:', game.exportSave());
  });

  dom.importBtn.addEventListener('click', () => {
    const code = prompt('Paste a save code to import. This replaces your current save.');
    if (code === null || !code.trim()) return;
    if (game.importSave(code)) {
      location.reload();
    } else {
      alert('That save code could not be read.');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') doSave(false);
    else catchUp();
  });

  window.addEventListener('pagehide', () => doSave(false));

  window.addEventListener('pageshow', event => {
    if (event.persisted) catchUp();
  });

  setInterval(() => {
    queueResult(game.advance(Date.now()));
    render();
  }, TICK_MS);

  setInterval(() => doSave(false), AUTOSAVE_MS);
}

// ---------------------------------------------------------------- boot

function boot() {
  game.load();

  buildCollectors();
  buildUpgrades();
  buildLog();

  queueResult(game.advance(Date.now()));
  render();
  idleSaveNote();
  wireEvents();

  window.FATHOM = {
    game,
    get state() { return game.getState(); },
    render,
    format: game.format,
    earn: game.earn,
    ping: game.ping,
    advance: game.advance,
    save: game.save,
    load: game.load,
    wipe: game.wipe,
    exportSave: game.exportSave,
    importSave: game.importSave,
    buyCollector: game.buyCollector,
    buyUpgrade: game.buyUpgrade,
    surfaceAndRefit: game.surfaceAndRefit,
    prestigeGain: game.prestigeGain,
    prestigeAvailable: game.prestigeAvailable,
    totalRate: game.totalRate,
    depth: game.depth,
    clickPower: game.clickPower,
    dom,
    rows,
    cardQueue,
  };
}

boot();
