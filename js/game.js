// Pure engine: state, economy math, depth, discoveries, persistence.
// No DOM access — ui.js owns rendering. Imports only from ./data.js.

import {
  COST_GROWTH, COLLECTORS, UPGRADES, DISCOVERIES, ZONES,
  DEPTH_COEFF, PRESTIGE, OFFLINE,
  SAVE_KEY, SAVE_VERSION, UPGRADE_REVEAL_FRACTION,
} from './data.js';

const BAK_KEY = SAVE_KEY + '.bak';

const COLLECTOR_BY_ID = new Map(COLLECTORS.map(c => [c.id, c]));
const UPGRADE_BY_ID = new Map(UPGRADES.map(u => [u.id, u]));
const DISCOVERY_BY_ID = new Map(DISCOVERIES.map(d => [d.id, d]));

// ---------------------------------------------------------------- state

export function freshState() {
  const owned = {};
  for (const c of COLLECTORS) owned[c.id] = 0;
  return {
    v: SAVE_VERSION,
    salvage: 0,
    runLifetime: 0,
    artifacts: 0,
    owned,
    upgrades: [],
    discoveries: [],
    lastSeen: Date.now(),
    totalPings: 0,
  };
}

let state = freshState();

export function getState() {
  return state;
}

// ---------------------------------------------------------------- format

const SUFFIXES = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'];

// 3 significant digits, thresholds sit just under the rounding boundary
// so 99.97 formats as "100" rather than "100.0".
function sig3(v) {
  if (v >= 99.95) return String(Math.round(v));
  if (v >= 9.995) return (Math.round(v * 10) / 10).toFixed(1);
  return (Math.round(v * 100) / 100).toFixed(2);
}

export function format(n) {
  if (!Number.isFinite(n)) return '∞';
  const sign = n < 0 ? '-' : '';
  let x = Math.abs(n);

  if (x < 1000) {
    const r = Math.round(x * 10) / 10;
    if (r < 1000) return sign + (Number.isInteger(r) ? String(r) : r.toFixed(1));
    x = r; // rounded up over the line, fall through to suffixes
  }

  let tier = Math.floor(Math.log10(x) / 3);
  if (tier > SUFFIXES.length) return sign + x.toExponential(2);

  let text = sig3(x / Math.pow(1000, tier));
  if (parseFloat(text) >= 1000) {
    tier += 1; // rounding pushed it into the next suffix
    if (tier > SUFFIXES.length) return sign + x.toExponential(2);
    text = sig3(x / Math.pow(1000, tier));
  }
  return sign + text + SUFFIXES[tier - 1];
}

// ---------------------------------------------------------------- multipliers

function purchasedUpgrades() {
  const out = [];
  for (const id of state.upgrades) {
    const u = UPGRADE_BY_ID.get(id);
    if (u) out.push(u);
  }
  return out;
}

function foundDiscoveries() {
  const out = [];
  for (const id of state.discoveries) {
    const d = DISCOVERY_BY_ID.get(id);
    if (d) out.push(d);
  }
  return out;
}

export function collectorMult(id) {
  let m = 1;
  for (const u of purchasedUpgrades()) {
    if (u.type === 'collector' && u.target === id) m *= u.mult;
  }
  for (const d of foundDiscoveries()) {
    if (d.effect.type === 'collector-mult' && d.effect.target === id) m *= d.effect.mult;
  }
  return m;
}

export function globalMult() {
  let m = 1 + state.artifacts * PRESTIGE.bonusPerArtifact;
  for (const u of purchasedUpgrades()) {
    if (u.type === 'global') m *= u.mult;
  }
  for (const d of foundDiscoveries()) {
    if (d.effect.type === 'global-mult') m *= d.effect.mult;
  }
  return m;
}

export function clickPower() {
  let add = 1;
  let mult = 1;
  for (const u of purchasedUpgrades()) {
    if (u.type !== 'click') continue;
    if (typeof u.add === 'number') add += u.add;
    if (typeof u.mult === 'number') mult *= u.mult;
  }
  for (const d of foundDiscoveries()) {
    if (d.effect.type === 'click-add') add += d.effect.add;
    if (d.effect.type === 'click-mult') mult *= d.effect.mult;
  }
  return add * mult * globalMult();
}

export function depthMult() {
  let m = 1;
  for (const u of purchasedUpgrades()) {
    if (u.type === 'depth') m *= u.mult;
  }
  for (const d of foundDiscoveries()) {
    if (d.effect.type === 'depth-mult') m *= d.effect.mult;
  }
  return m;
}

// ---------------------------------------------------------------- production

export function collectorRate(id) {
  const c = COLLECTOR_BY_ID.get(id);
  if (!c) return 0;
  const owned = state.owned[id] || 0;
  return c.rate * owned * collectorMult(id) * globalMult();
}

export function totalRate() {
  let sum = 0;
  for (const c of COLLECTORS) sum += collectorRate(c.id);
  return sum;
}

// ---------------------------------------------------------------- depth

export function depth() {
  const l = Math.log10(state.runLifetime + 1);
  return DEPTH_COEFF * l * l * depthMult();
}

export function zoneFor(depthMeters) {
  let zone = ZONES[0];
  for (const z of ZONES) {
    if (depthMeters >= z.min) zone = z;
  }
  return zone;
}

// ---------------------------------------------------------------- buying

export function collectorCost(id) {
  const c = COLLECTOR_BY_ID.get(id);
  if (!c) return Infinity;
  return Math.ceil(c.baseCost * Math.pow(COST_GROWTH, state.owned[id] || 0));
}

export function buyCollector(id) {
  if (!COLLECTOR_BY_ID.has(id)) return false;
  const cost = collectorCost(id);
  if (state.salvage < cost) return false;
  state.salvage -= cost;
  state.owned[id] = (state.owned[id] || 0) + 1;
  return true;
}

export function visibleUpgrades() {
  return UPGRADES.filter(u =>
    !state.upgrades.includes(u.id) &&
    state.runLifetime >= u.cost * UPGRADE_REVEAL_FRACTION);
}

export function buyUpgrade(id) {
  const u = UPGRADE_BY_ID.get(id);
  if (!u) return false;
  if (state.upgrades.includes(id)) return false;
  if (state.salvage < u.cost) return false;
  state.salvage -= u.cost;
  state.upgrades.push(id);
  return true;
}

// ---------------------------------------------------------------- earning

export function earn(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.salvage += amount;
  state.runLifetime += amount;
}

export function ping() {
  const amount = clickPower();
  earn(amount);
  state.totalPings += 1;
  return amount;
}

// Discoveries are checked after every advance; an instant payout can push
// depth past the next threshold, so this re-reads depth each pass.
function collectDiscoveries() {
  const found = [];
  for (const d of DISCOVERIES) {
    if (state.discoveries.includes(d.id)) continue;
    if (depth() < d.depth) continue;
    state.discoveries.push(d.id);
    found.push(d);
    if (d.effect.type === 'instant') earn(totalRate() * d.effect.minutes * 60);
  }
  return found;
}

export function advance(nowMs) {
  const dt = (nowMs - state.lastSeen) / 1000;
  state.lastSeen = nowMs;

  let offline = null;
  if (dt > 0) {
    if (dt > OFFLINE.minSeconds) {
      const seconds = Math.min(dt, OFFLINE.capHours * 3600);
      const gain = totalRate() * seconds * OFFLINE.rate;
      earn(gain);
      offline = { gain, seconds };
    } else {
      // Closed form: production only changes on purchase, so one multiply
      // is exact for any gap this short — no sub-stepping needed.
      earn(totalRate() * dt);
    }
  }

  return { offline, found: collectDiscoveries() };
}

// ---------------------------------------------------------------- prestige

export function prestigeGain() {
  return Math.floor(depth() / PRESTIGE.metersPerArtifact);
}

export function prestigeAvailable() {
  return depth() >= PRESTIGE.unlockDepth;
}

export function surfaceAndRefit() {
  const gain = prestigeGain();
  const artifacts = state.artifacts + gain;
  const discoveries = state.discoveries.slice();
  state = freshState();
  state.artifacts = artifacts;
  state.discoveries = discoveries;
  save();
  return gain;
}

// ---------------------------------------------------------------- persistence

// Storage is optional: file:// pages, private modes and full quotas all throw.
// Every access goes through here and a throw only downgrades to no-save.
let storageBroken = false;

function storage() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    return localStorage;
  } catch (e) {
    return null;
  }
}

export function storageOk() {
  return !storageBroken && storage() !== null;
}

function num(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function idList(value, known) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const id of value) {
    if (typeof id === 'string' && known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// Returns a full state built on freshState(), or null if the input is not a
// usable save. Newer save versions are refused rather than guessed at.
function hydrate(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.v === 'number' && parsed.v > SAVE_VERSION) return null;

  const next = freshState();
  next.salvage = Math.max(0, num(parsed.salvage, 0));
  next.runLifetime = Math.max(0, num(parsed.runLifetime, 0));
  next.artifacts = Math.max(0, Math.floor(num(parsed.artifacts, 0)));
  next.totalPings = Math.max(0, Math.floor(num(parsed.totalPings, 0)));
  next.lastSeen = num(parsed.lastSeen, Date.now());
  next.upgrades = idList(parsed.upgrades, UPGRADE_BY_ID);
  next.discoveries = idList(parsed.discoveries, DISCOVERY_BY_ID);

  if (parsed.owned && typeof parsed.owned === 'object') {
    for (const c of COLLECTORS) {
      next.owned[c.id] = Math.max(0, Math.floor(num(parsed.owned[c.id], 0)));
    }
  }
  return next;
}

function readSlot(ls, key) {
  try {
    const raw = ls.getItem(key);
    if (!raw) return null;
    return hydrate(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

export function save() {
  state.lastSeen = Date.now();
  const ls = storage();
  if (!ls) {
    storageBroken = true;
    return false;
  }
  try {
    const prev = ls.getItem(SAVE_KEY);
    // Only a save that still parses is worth keeping as the backup.
    if (prev && readSlot(ls, SAVE_KEY)) ls.setItem(BAK_KEY, prev);
    ls.setItem(SAVE_KEY, JSON.stringify(state));
    storageBroken = false;
    return true;
  } catch (e) {
    storageBroken = true;
    return false;
  }
}

export function load() {
  const ls = storage();
  if (!ls) {
    storageBroken = true;
    return false;
  }
  const loaded = readSlot(ls, SAVE_KEY) || readSlot(ls, BAK_KEY);
  if (!loaded) return false;
  state = loaded;
  return true;
}

export function wipe() {
  const ls = storage();
  if (ls) {
    try {
      ls.removeItem(SAVE_KEY);
      ls.removeItem(BAK_KEY);
    } catch (e) {
      storageBroken = true;
    }
  }
  state = freshState();
}

export function exportSave() {
  // State is ASCII-only (numbers plus content ids), so btoa is safe here.
  return btoa(JSON.stringify(state));
}

export function importSave(code) {
  let loaded = null;
  try {
    loaded = hydrate(JSON.parse(atob(String(code).trim())));
  } catch (e) {
    return false;
  }
  if (!loaded) return false;
  state = loaded;
  save();
  return true;
}
