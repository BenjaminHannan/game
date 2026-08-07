// All game content and balance lives in this file.
// Tuning the game = editing these tables. No logic here.
//
// Base costs/rates for tiers 1-3 mirror Cookie Clicker's proven early curve;
// tiers 4-6 rates are flattened (research: bare CC rates stall around tier 4
// without CC's full upgrade web, so we pay ~8x per tier instead of ~5.5x).

export const COST_GROWTH = 1.15; // each unit owned raises the next one's cost by 15%

export const COLLECTORS = [
  { id: 'diver',     name: 'Diver',           emoji: '🤿', baseCost: 15,        rate: 0.1,  blurb: 'A brave soul with a net.' },
  { id: 'rov',       name: 'ROV Drone',       emoji: '🤖', baseCost: 100,       rate: 1,    blurb: 'Remote-operated and tireless.' },
  { id: 'sub',       name: 'Submersible',     emoji: '🛸', baseCost: 1100,      rate: 8,    blurb: 'Three crew, no windows to speak of.' },
  { id: 'station',   name: 'Deep Station',    emoji: '🏗️', baseCost: 12000,     rate: 60,   blurb: 'A permanent outpost on the shelf.' },
  { id: 'trawler',   name: 'Abyssal Trawler', emoji: '🚢', baseCost: 130000,    rate: 400,  blurb: 'Drags the dark for treasure.' },
  { id: 'leviathan', name: 'Leviathan Tamer', emoji: '🐙', baseCost: 1400000,   rate: 2600, blurb: 'It works for fish now.' },
];

// type: 'collector' (mult one collector) | 'click' (add or mult ping power)
//       | 'global' (mult all production) | 'depth' (mult displayed depth)
export const UPGRADES = [
  { id: 'nets',    name: 'Reinforced Nets',      emoji: '🕸️', cost: 500,     type: 'collector', target: 'diver',   mult: 2,    blurb: 'Divers are twice as effective.' },
  { id: 'sonar',   name: 'Sonar Array',          emoji: '📡', cost: 2000,    type: 'click',     add: 9,            blurb: '+9 salvage per ping.' },
  { id: 'tethers', name: 'Fiber-Optic Tethers',  emoji: '🧵', cost: 5000,    type: 'collector', target: 'rov',     mult: 2,    blurb: 'ROV Drones are twice as effective.' },
  { id: 'lures',   name: 'LED Lures',            emoji: '💡', cost: 20000,   type: 'global',    mult: 1.10,        blurb: 'All production +10%.' },
  { id: 'hulls',   name: 'Titanium Hulls',       emoji: '🛡️', cost: 60000,   type: 'collector', target: 'sub',     mult: 2,    blurb: 'Submersibles are twice as effective.' },
  { id: 'ballast', name: 'Ballast Optimization', emoji: '⚖️', cost: 250000,  type: 'depth',     mult: 1.25,        blurb: 'Your fleet dives 25% deeper.' },
  { id: 'thermal', name: 'Geothermal Taps',      emoji: '🌋', cost: 600000,  type: 'collector', target: 'station', mult: 2,    blurb: 'Deep Stations are twice as effective.' },
  { id: 'routing', name: 'Autonomous Routing',   emoji: '🧭', cost: 3500000, type: 'collector', target: 'trawler', mult: 2,    blurb: 'Abyssal Trawlers are twice as effective.' },
];

// Discoveries trigger the first time your depth crosses `depth`.
// They persist through Surface & Refit, log entry and bonus both.
// effect types: click-add, click-mult, collector-mult, global-mult, depth-mult, instant (minutes of production)
export const DISCOVERIES = [
  { id: 'kelp',       depth: 50,    name: 'Kelp Forest',            emoji: '🌿', effect: { type: 'click-add', add: 1 },                       bonusText: '+1 salvage per ping',
    flavor: 'The sunlight zone sways green and alive.' },
  { id: 'boat',       depth: 150,   name: 'Sunken Fishing Boat',    emoji: '🎣', effect: { type: 'collector-mult', target: 'diver', mult: 1.25 }, bonusText: 'Divers +25%',
    flavor: 'Someone’s grandfather lost this in 1974. Finders keepers.' },
  { id: 'twilight',   depth: 300,   name: 'Edge of the Twilight',   emoji: '🌘', effect: { type: 'global-mult', mult: 1.03 },                 bonusText: 'All production +3%',
    flavor: 'Light gives up here. Your instruments don’t.' },
  { id: 'squid',      depth: 500,   name: 'Giant Squid (glimpsed)', emoji: '🦑', effect: { type: 'click-mult', mult: 1.25 },                  bonusText: 'Pings +25%',
    flavor: 'Something enormous watched you work today. It let you keep the salvage.' },
  { id: 'brine',      depth: 800,   name: 'Brine Pool',             emoji: '🫧', effect: { type: 'collector-mult', target: 'rov', mult: 1.25 },   bonusText: 'ROV Drones +25%',
    flavor: 'A lake at the bottom of the sea. The drones refuse to land in it twice.' },
  { id: 'angler',     depth: 1000,  name: 'Anglerfish',             emoji: '🎇', effect: { type: 'global-mult', mult: 1.05 },                 bonusText: 'All production +5%',
    flavor: 'It brought its own lamp to the photoshoot.' },
  { id: 'vents',      depth: 2000,  name: 'Hydrothermal Vents',     emoji: '🌋', effect: { type: 'collector-mult', target: 'station', mult: 1.25 }, bonusText: 'Deep Stations +25%',
    flavor: 'Free heat, black smoke, and the strangest neighbors on Earth.' },
  { id: 'whalefall',  depth: 2800,  name: 'Whale Fall',             emoji: '🐋', effect: { type: 'global-mult', mult: 1.05 },                 bonusText: 'All production +5%',
    flavor: 'A whole ecosystem holding a funeral banquet.' },
  { id: 'wreck',      depth: 3800,  name: 'Wreck of the SS Prosperity', emoji: '🚢', effect: { type: 'instant', minutes: 15 },                bonusText: '15 minutes of production, instantly',
    flavor: 'Lost with all cargo, 1911. The cargo is fine.' },
  { id: 'ghostshark', depth: 4800,  name: 'Ghost Shark',            emoji: '🦈', effect: { type: 'click-mult', mult: 2 },                     bonusText: 'Pings ×2',
    flavor: 'It has a venomous spine on its forehead and your full respect.' },
  { id: 'snailfish',  depth: 6000,  name: 'Hadal Snailfish',        emoji: '🐟', effect: { type: 'global-mult', mult: 1.10 },                 bonusText: 'All production +10%',
    flavor: 'Soft, translucent, thriving under pressure that folds steel.' },
  { id: 'signal',     depth: 8200,  name: 'Unknown Signal',         emoji: '📻', effect: { type: 'depth-mult', mult: 1.10 },                  bonusText: 'Depth +10%',
    flavor: 'A rhythmic tapping from below. Probably geology. Probably.' },
  { id: 'bottom',     depth: 10935, name: 'The Bottom',             emoji: '🏆', effect: { type: 'global-mult', mult: 2 },                    bonusText: 'All production ×2',
    flavor: 'Challenger Deep. There is nowhere deeper. You checked.' },
];

export const ZONES = [
  { id: 'sunlight', name: 'Sunlight Zone', min: 0 },
  { id: 'twilight', name: 'Twilight Zone', min: 200 },
  { id: 'midnight', name: 'Midnight Zone', min: 1000 },
  { id: 'abyss',    name: 'Abyssal Zone',  min: 4000 },
  { id: 'hadal',    name: 'Hadal Zone',    min: 6000 },
];

// depth (m) = DEPTH_COEFF * log10(lifetime salvage this run + 1)^2 * depth multipliers
export const DEPTH_COEFF = 25;

export const PRESTIGE = {
  unlockDepth: 800,       // Surface & Refit becomes available at this depth
  metersPerArtifact: 400, // artifacts gained on surfacing = floor(depth / this)
  bonusPerArtifact: 0.25, // each artifact multiplies all production by (1 + this)
};

// Research notes: 50% rate / ~10h cap is the browser-idle genre default;
// the 120s threshold keeps Chrome's once-per-minute background throttling
// from popping false "welcome back" cards.
export const OFFLINE = {
  rate: 0.5,        // fraction of full production earned while away
  capHours: 10,     // offline earnings stop accruing past this
  minSeconds: 120,  // gaps shorter than this accrue silently at full rate
};

export const SAVE_KEY = 'fathom-save';
export const SAVE_VERSION = 1;

// Upgrades appear on the workbench once you've earned this fraction of their cost (this run).
export const UPGRADE_REVEAL_FRACTION = 0.25;
