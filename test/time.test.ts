import { describe, expect, it } from 'vitest';
import {
  DAYS_PER_YEAR,
  START_YEAR,
  TICKS_PER_DAY,
  dateFromTick,
  daysElapsed,
  formatDate,
  formatTimeOfDay,
  hourOfDay,
  tickFromDate,
} from '../src/core/time.js';

describe('GameTime', () => {
  it('starts at January 1 of the start year', () => {
    const d = dateFromTick(0);
    expect(d).toMatchObject({ year: START_YEAR, month: 0, day: 1, totalDays: 0 });
    expect(formatDate(0)).toBe('Jan 1, 2026');
  });

  it('advances one day every TICKS_PER_DAY ticks', () => {
    expect(dateFromTick(TICKS_PER_DAY).day).toBe(2);
    expect(dateFromTick(TICKS_PER_DAY * 11)).toMatchObject({ month: 0, day: 12 });
    expect(formatDate(TICKS_PER_DAY * 11)).toBe('Jan 12, 2026');
  });

  it('rolls months over after 30 days', () => {
    expect(dateFromTick(TICKS_PER_DAY * 29)).toMatchObject({ month: 0, day: 30 });
    expect(dateFromTick(TICKS_PER_DAY * 30)).toMatchObject({ month: 1, day: 1 });
    expect(formatDate(TICKS_PER_DAY * 30)).toBe('Feb 1, 2026');
  });

  it('rolls years over after 12 months', () => {
    const lastDay = TICKS_PER_DAY * (DAYS_PER_YEAR - 1);
    expect(dateFromTick(lastDay)).toMatchObject({ year: 2026, month: 11, day: 30 });
    expect(dateFromTick(lastDay + TICKS_PER_DAY)).toMatchObject({
      year: 2027,
      month: 0,
      day: 1,
    });
  });

  it('handles multi-year spans', () => {
    expect(formatDate(TICKS_PER_DAY * DAYS_PER_YEAR * 10)).toBe('Jan 1, 2036');
  });

  it('does not skip or repeat a date across a full year of ticks', () => {
    const seen = new Set<string>();
    for (let day = 0; day < DAYS_PER_YEAR; day++) {
      seen.add(formatDate(day * TICKS_PER_DAY));
    }
    expect(seen.size).toBe(DAYS_PER_YEAR);
  });

  describe('hourOfDay', () => {
    it('is midnight at the start of each day', () => {
      expect(hourOfDay(0)).toBe(0);
      expect(hourOfDay(TICKS_PER_DAY)).toBe(0);
      expect(hourOfDay(TICKS_PER_DAY * 365)).toBe(0);
    });

    it('is noon at the half-day mark', () => {
      expect(hourOfDay(TICKS_PER_DAY / 2)).toBeCloseTo(12, 10);
    });

    it('stays within [0,24)', () => {
      for (let t = 0; t < TICKS_PER_DAY * 3; t += 0.25) {
        const h = hourOfDay(t);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(24);
      }
    });

    it('advances linearly within a day', () => {
      // TICKS_PER_DAY is 40, so each tick is 0.6 hours.
      expect(hourOfDay(1)).toBeCloseTo(24 / TICKS_PER_DAY, 10);
      expect(hourOfDay(10)).toBeCloseTo(6, 10);
      expect(hourOfDay(30)).toBeCloseTo(18, 10);
    });
  });

  it('formats time of day as zero-padded 24-hour clock', () => {
    expect(formatTimeOfDay(0)).toBe('00:00');
    expect(formatTimeOfDay(TICKS_PER_DAY / 2)).toBe('12:00');
    expect(formatTimeOfDay(1)).toBe('00:36');
  });

  it('reports fractional elapsed days', () => {
    expect(daysElapsed(TICKS_PER_DAY * 2.5)).toBe(2.5);
  });

  it('tickFromDate inverts dateFromTick', () => {
    for (const [y, m, d] of [
      [2026, 0, 1],
      [2026, 5, 17],
      [2031, 11, 30],
    ] as const) {
      const tick = tickFromDate(y, m, d);
      expect(dateFromTick(tick)).toMatchObject({ year: y, month: m, day: d });
    }
  });
});
