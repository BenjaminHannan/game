/**
 * Metropolis icon set — original geometric glyphs, drawn as inline SVG.
 *
 * Every glyph here is authored for this project: a 24 x 24 grid, a single
 * 1.7-unit stroke weight, square-ish geometry with 2-unit corner radii, and
 * `currentColor` throughout so a button's state colour flows straight into its
 * icon. Nothing is traced from, or derived from, any other game's artwork — the
 * binding constraint in `docs/research/cs2/OVERVIEW.md` is that we mirror
 * interface *structure* and author all expression ourselves.
 *
 * Icons are markup strings rather than components because the HUD is plain DOM:
 * one `innerHTML` assignment per button at construction time, then never again.
 */

/** Every icon this build ships, keyed by the id the HUD asks for. */
export type IconId =
  | 'select'
  | 'roads'
  | 'zones'
  | 'bulldoze'
  | 'info'
  | 'power'
  | 'water'
  | 'services'
  | 'traffic'
  | 'demand'
  | 'landvalue'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'dezone'
  | 'close'
  | 'play'
  | 'pause';

/** Inner markup of each glyph, sitting inside a shared 24 x 24 `<svg>`. */
const PATHS: Readonly<Record<IconId, string>> = {
  // A pointer: one closed arrow head with a tail, drawn as a single path.
  select: '<path d="M6 3.5 18.5 12 12.3 13.2 15 20 12.4 21 9.6 14.2 6 18Z"/>',

  // A carriageway running to the horizon: two verges plus a dashed centreline.
  roads:
    '<path d="M8.5 3 4 21"/><path d="M15.5 3 20 21"/>' +
    '<path d="M12 4.5v3"/><path d="M12 10.5v3"/><path d="M12 16.5v3"/>',

  // Four painted cells with one left blank — the zoning grid mid-stroke.
  zones:
    '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6"/>' +
    '<rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6"/>' +
    '<rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6"/>' +
    '<path d="M13 20.5v-7.5h7.5"/>',

  // A blade: an angled cutting edge with a spoil line under it.
  bulldoze:
    '<path d="M4 4.5h3.2v9.5H4Z"/><path d="M7.2 9.2h7.4l4 4.8"/>' +
    '<path d="M3 19.5h18"/>',

  // The classic "i", built from a disc and two strokes so it reads at 16 px.
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6v.9"/>',

  // A bolt, as a hard-edged polygon rather than a lightning cliché.
  power: '<path d="M13.6 2.5 6 13.2h5.1L10.4 21.5 18 10.8h-5.1Z"/>',

  // A droplet: a point over a semicircle.
  water: '<path d="M12 3.2 6.6 11.4a6.4 6.4 0 1 0 10.8 0Z"/>',

  // Service coverage: a cross inside its catchment ring.
  services:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8"/><path d="M8 12h8"/>',

  // Congestion: three lanes at three different fill levels.
  traffic:
    '<path d="M4.5 6.5h15"/><path d="M4.5 12h9.5"/><path d="M4.5 17.5h4.5"/>' +
    '<circle cx="19.5" cy="17.5" r="1.6"/>',

  // The demand readout: three bars of unequal height on a baseline.
  demand:
    '<path d="M3 20.5h18"/><path d="M6.5 20.5V9"/><path d="M12 20.5V4.5"/>' +
    '<path d="M17.5 20.5v-7"/>',

  // Land value: a faceted stone.
  landvalue: '<path d="M12 3 21 10.5 12 21 3 10.5Z"/><path d="M3 10.5h18"/>',

  // Zone brushes: a house, a shopfront awning, a works roofline.
  residential: '<path d="M4 11 12 4l8 7"/><path d="M6.5 9.8V20h11V9.8"/>',
  commercial:
    '<path d="M4 9.5 6 4h12l2 5.5Z"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-5.5h5V20"/>',
  industrial:
    '<path d="M3.5 20.5V11l5.5 3.2V11l5.5 3.2V6h6v14.5Z"/>',
  dezone:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M8.5 8.5l7 7"/>' +
    '<path d="M15.5 8.5l-7 7"/>',

  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  play: '<path d="M7.5 4.5 19 12 7.5 19.5Z"/>',
  pause: '<path d="M8.5 4.8v14.4"/><path d="M15.5 4.8v14.4"/>',
};

/** Glyphs drawn as filled silhouettes rather than outlines. */
const FILLED: ReadonlySet<IconId> = new Set<IconId>([
  'select',
  'power',
  'water',
  'landvalue',
  'industrial',
  'play',
]);

/**
 * Inline SVG markup for one icon.
 *
 * @param id Which glyph to draw.
 * @param size Edge length in CSS pixels.
 * @returns A self-contained `<svg>` element as markup, safe to assign to
 *   `innerHTML` — every value in it is from this module, never from player input.
 */
export function icon(id: IconId, size = 18): string {
  const body = PATHS[id] ?? PATHS.info;
  const filled = FILLED.has(id);
  return (
    `<svg class="hud-icon" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `aria-hidden="true" focusable="false" ` +
    `fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  );
}

/** True when an id names a glyph this build ships. */
export function hasIcon(id: string): id is IconId {
  return Object.prototype.hasOwnProperty.call(PATHS, id);
}
