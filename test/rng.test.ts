import { describe, expect, it } from 'vitest';
import { Rng, hashString, mulberry32 } from '../src/core/rng.js';

/** Draw `n` floats from a generator. */
function draw(rng: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.float());
  return out;
}

describe('mulberry32', () => {
  it('produces values in [0,1)', () => {
    const next = mulberry32(12345);
    for (let i = 0; i < 1000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });
});

describe('Rng', () => {
  it('replays an identical sequence from the same seed', () => {
    expect(draw(new Rng(4242), 100)).toEqual(draw(new Rng(4242), 100));
  });

  it('produces different sequences for different seeds', () => {
    expect(draw(new Rng(1), 20)).not.toEqual(draw(new Rng(2), 20));
  });

  it('accepts string seeds and hashes them stably', () => {
    expect(new Rng('riverbend').seed).toBe(new Rng('riverbend').seed);
    expect(new Rng('riverbend').seed).not.toBe(new Rng('other').seed);
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('keeps int() within bounds', () => {
    const r = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('shuffle keeps every element exactly once and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = new Rng(11).shuffle(input);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  describe('fork', () => {
    it('is deterministic for the same parent seed and stream name', () => {
      expect(draw(new Rng(1000).fork('terrain'), 20)).toEqual(
        draw(new Rng(1000).fork('terrain'), 20),
      );
    });

    it('gives independent streams for different names', () => {
      const parent = new Rng(1000);
      expect(draw(parent.fork('terrain'), 20)).not.toEqual(draw(parent.fork('economy'), 20));
    });

    it('is unaffected by draws from the parent', () => {
      const fresh = new Rng(555);
      const beforeAny = draw(fresh.fork('sim'), 10);

      const used = new Rng(555);
      for (let i = 0; i < 100; i++) used.float();
      const afterDraws = draw(used.fork('sim'), 10);

      expect(afterDraws).toEqual(beforeAny);
    });
  });
});
