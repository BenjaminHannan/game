/**
 * GameTime: converts simulation tick counts into an in-game calendar.
 *
 * The calendar is deliberately simplified: every month has 30 days and every
 * year has 12 of them, so a year is always 360 days. Time starts at
 * January 1, 2026, 00:00.
 */

/** Simulation ticks in one in-game day (2 real seconds at speed 1). */
export const TICKS_PER_DAY = 40;

/** Days in every in-game month. */
export const DAYS_PER_MONTH = 30;

/** Months in an in-game year. */
export const MONTHS_PER_YEAR = 12;

/** Days in an in-game year. */
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

/** Calendar year at tick 0. */
export const START_YEAR = 2026;

/** Short month names, indexed 0-11. */
export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A decoded in-game calendar date. */
export interface GameDate {
  /** Full calendar year, e.g. 2026. */
  year: number;
  /** Month index, 0-11. */
  month: number;
  /** Day of month, 1-30. */
  day: number;
  /** Absolute day index since tick 0. */
  totalDays: number;
  /** Time of day as a float in [0,24). */
  hourOfDay: number;
}

/** Total elapsed in-game days (fractional) at a tick. */
export function daysElapsed(tick: number): number {
  return tick / TICKS_PER_DAY;
}

/**
 * Time of day at a tick, as a float in [0,24).
 * Tick 0 is midnight; the day advances linearly across TICKS_PER_DAY ticks.
 */
export function hourOfDay(tick: number): number {
  const frac = (tick % TICKS_PER_DAY) / TICKS_PER_DAY;
  const normalized = (((frac % 1) + 1) % 1);
  return normalized * 24;
}

/** Decode a tick count into a full in-game calendar date. */
export function dateFromTick(tick: number): GameDate {
  const totalDays = Math.floor(tick / TICKS_PER_DAY);
  const year = START_YEAR + Math.floor(totalDays / DAYS_PER_YEAR);
  const dayOfYear = ((totalDays % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const month = Math.floor(dayOfYear / DAYS_PER_MONTH);
  const day = (dayOfYear % DAYS_PER_MONTH) + 1;
  return { year, month, day, totalDays, hourOfDay: hourOfDay(tick) };
}

/** Format a tick as a short date string, e.g. `"Jan 12, 2026"`. */
export function formatDate(tick: number): string {
  const d = dateFromTick(tick);
  return `${MONTH_NAMES[d.month]} ${d.day}, ${d.year}`;
}

/** Format a tick's time of day as 24-hour `HH:MM`. */
export function formatTimeOfDay(tick: number): string {
  // Round to the nearest minute rather than truncating: tick fractions such as
  // 1/40 of a day are not exactly representable, and truncation would render
  // 00:36 as 00:35.
  const totalMinutes = Math.min(Math.round(hourOfDay(tick) * 60), 24 * 60 - 1);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The tick at which a given calendar date begins. Inverse of {@link dateFromTick}. */
export function tickFromDate(year: number, month: number, day: number): number {
  const totalDays =
    (year - START_YEAR) * DAYS_PER_YEAR + month * DAYS_PER_MONTH + (day - 1);
  return totalDays * TICKS_PER_DAY;
}
