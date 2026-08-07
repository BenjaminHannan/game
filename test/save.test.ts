import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAVE_VERSION,
  SaveManager,
  type KeyValueStore,
  type SaveProvider,
} from '../src/core/save.js';

/** In-memory stand-in for `localStorage`. */
class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

interface CityData {
  name: string;
  money: number;
  districts: string[];
}

/** Fake provider standing in for a real subsystem. */
class FakeProvider implements SaveProvider<CityData> {
  readonly key = 'city';
  state: CityData = { name: 'Riverbend', money: 500000, districts: ['downtown'] };

  serialize(): CityData {
    return structuredClone(this.state);
  }
  deserialize(data: CityData): void {
    this.state = structuredClone(data);
  }
}

describe('SaveManager', () => {
  let store: MemoryStore;
  let saves: SaveManager;
  let provider: FakeProvider;

  beforeEach(() => {
    store = new MemoryStore();
    saves = new SaveManager(store);
    provider = new FakeProvider();
    saves.register(provider);
  });

  it('writes a versioned document', () => {
    const doc = JSON.parse(saves.saveToString());
    expect(doc.version).toBe(SAVE_VERSION);
    expect(typeof doc.savedAt).toBe('number');
    expect(doc.data.city).toEqual({
      name: 'Riverbend',
      money: 500000,
      districts: ['downtown'],
    });
  });

  it('round-trips provider state through a string', () => {
    const json = saves.saveToString();
    provider.state = { name: 'Wrecked', money: -1, districts: [] };
    saves.loadFromString(json);
    expect(provider.state).toEqual({
      name: 'Riverbend',
      money: 500000,
      districts: ['downtown'],
    });
  });

  it('round-trips through a storage slot', () => {
    provider.state.money = 12345;
    provider.state.districts.push('harbour');
    saves.saveToSlot('slot1');

    provider.state = { name: 'x', money: 0, districts: [] };
    expect(saves.loadFromSlot('slot1')).toBe(true);
    expect(provider.state.money).toBe(12345);
    expect(provider.state.districts).toEqual(['downtown', 'harbour']);
  });

  it('reports a missing slot rather than throwing', () => {
    expect(saves.loadFromSlot('nope')).toBe(false);
  });

  it('lists and deletes slots', () => {
    saves.saveToSlot('alpha');
    saves.saveToSlot('beta');
    expect(saves.listSlots().map((s) => s.name).sort()).toEqual(['alpha', 'beta']);

    saves.deleteSlot('alpha');
    expect(saves.listSlots().map((s) => s.name)).toEqual(['beta']);
  });

  it('ignores unrelated keys in the store', () => {
    store.setItem('some-other-app', 'garbage');
    saves.saveToSlot('only');
    expect(saves.listSlots().map((s) => s.name)).toEqual(['only']);
  });

  it('leaves providers untouched when their branch is absent', () => {
    const json = JSON.stringify({ version: SAVE_VERSION, savedAt: 0, data: {} });
    saves.loadFromString(json);
    expect(provider.state.name).toBe('Riverbend');
  });

  it('restores only registered providers', () => {
    const json = saves.saveToString();
    saves.unregister('city');
    provider.state.money = 0;
    saves.loadFromString(json);
    expect(provider.state.money).toBe(0);
  });

  it('rejects malformed input', () => {
    expect(() => saves.loadFromString('not json')).toThrow(/valid JSON/);
    expect(() => saves.loadFromString('{"nope":1}')).toThrow(/save document/);
  });

  it('rejects saves from a newer format version', () => {
    const json = JSON.stringify({ version: SAVE_VERSION + 1, savedAt: 0, data: {} });
    expect(() => saves.loadFromString(json)).toThrow(/newer than this build/);
  });

  it('throws for slot operations when no store is available', () => {
    const noStore = new SaveManager(null);
    expect(() => noStore.saveToSlot('a')).toThrow(/No storage/);
  });
});
