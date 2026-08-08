import { describe, expect, it } from 'vitest';
import {
  FixedStepAccumulator,
  MAX_FRAME_TIME,
  SECONDS_PER_TICK,
  TICKS_PER_SECOND,
} from '../src/core/engine.js';

describe('FixedStepAccumulator', () => {
  it('takes no steps for a partial tick', () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(0.01, 1)).toBe(0);
    expect(acc.currentTick).toBe(0);
  });

  it('takes exactly one step per tick interval at speed 1', () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(SECONDS_PER_TICK, 1)).toBe(1);
    expect(acc.currentTick).toBe(1);
  });

  it('runs 20 ticks per real second at speed 1', () => {
    const acc = new FixedStepAccumulator();
    let steps = 0;
    // 60 frames of ~16.67ms is one real second.
    for (let i = 0; i < 60; i++) steps += acc.advance(1 / 60, 1);
    expect(steps).toBe(TICKS_PER_SECOND);
  });

  it('runs 80 ticks per real second at speed 4', () => {
    const acc = new FixedStepAccumulator();
    let steps = 0;
    for (let i = 0; i < 60; i++) steps += acc.advance(1 / 60, 4);
    expect(steps).toBe(TICKS_PER_SECOND * 4);
  });

  it('scales linearly with the speed multiplier', () => {
    for (const speed of [1, 2, 4]) {
      const acc = new FixedStepAccumulator();
      let steps = 0;
      for (let i = 0; i < 120; i++) steps += acc.advance(1 / 120, speed);
      expect(steps).toBe(TICKS_PER_SECOND * speed);
    }
  });

  it('takes no steps and accumulates nothing while paused', () => {
    const acc = new FixedStepAccumulator();
    for (let i = 0; i < 100; i++) expect(acc.advance(1 / 60, 0)).toBe(0);
    expect(acc.currentTick).toBe(0);
    expect(acc.pending).toBe(0);
  });

  it('resumes from where it paused rather than replaying lost time', () => {
    const acc = new FixedStepAccumulator();
    const second = (): void => {
      for (let i = 0; i < 60; i++) acc.advance(1 / 60, 1);
    };
    second();
    expect(acc.currentTick).toBe(TICKS_PER_SECOND);
    // Ten seconds paused.
    for (let i = 0; i < 600; i++) acc.advance(1 / 60, 0);
    expect(acc.currentTick).toBe(TICKS_PER_SECOND);
    second();
    expect(acc.currentTick).toBe(TICKS_PER_SECOND * 2);
  });

  it('clamps a long stall to avoid a spiral of death', () => {
    const acc = new FixedStepAccumulator();
    // A 30 second stall must not produce 600 steps.
    const steps = acc.advance(30, 1);
    expect(steps).toBe(MAX_FRAME_TIME * TICKS_PER_SECOND);
    expect(steps).toBe(5);
  });

  it('clamps before applying the speed multiplier', () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(30, 4)).toBe(MAX_FRAME_TIME * TICKS_PER_SECOND * 4);
  });

  it('carries leftover time into the next frame without drift', () => {
    const acc = new FixedStepAccumulator();
    const frames = 600;
    const dt = 1 / 60;
    let steps = 0;
    for (let i = 0; i < frames; i++) steps += acc.advance(dt, 1);
    // 10 real seconds of frames must yield exactly 200 ticks.
    expect(steps).toBe(200);
    expect(acc.currentTick).toBe(200);
    expect(acc.pending).toBeLessThan(SECONDS_PER_TICK);
  });

  it('reports an interpolation alpha in [0,1)', () => {
    const acc = new FixedStepAccumulator();
    acc.advance(SECONDS_PER_TICK * 0.5, 1);
    expect(acc.alpha).toBeCloseTo(0.5, 10);
    acc.advance(SECONDS_PER_TICK * 0.25, 1);
    expect(acc.alpha).toBeCloseTo(0.75, 10);
    acc.advance(SECONDS_PER_TICK * 0.5, 1);
    expect(acc.alpha).toBeGreaterThanOrEqual(0);
    expect(acc.alpha).toBeLessThan(1);
  });

  it('ignores non-positive and non-finite deltas', () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(0, 1)).toBe(0);
    expect(acc.advance(-5, 1)).toBe(0);
    expect(acc.advance(Number.NaN, 1)).toBe(0);
    expect(acc.advance(Number.POSITIVE_INFINITY, 1)).toBe(0);
    expect(acc.currentTick).toBe(0);
  });

  it('reset clears the tick counter and pending time', () => {
    const acc = new FixedStepAccumulator();
    acc.advance(0.9, 1);
    acc.reset();
    expect(acc.currentTick).toBe(0);
    expect(acc.pending).toBe(0);
    acc.reset(500);
    expect(acc.currentTick).toBe(500);
  });
});
