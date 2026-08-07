/**
 * SaveManager: collects serializable state from registered providers into a
 * single versioned JSON document, and restores it again.
 *
 * Providers are registered by key; each contributes one branch of the save
 * document. Saves can be kept in localStorage slots or exported to / imported
 * from a file.
 */

/** Current save format version. Bump when the document shape changes. */
export const SAVE_VERSION = 1;

/** Prefix for localStorage keys holding save slots. */
export const SLOT_PREFIX = 'civitopia:save:';

/** A subsystem that contributes state to the save document. */
export interface SaveProvider<T = unknown> {
  /** Unique key naming this provider's branch of the document. */
  readonly key: string;
  /** Produce a JSON-serializable snapshot of current state. */
  serialize(): T;
  /** Restore state from a previously serialized snapshot. */
  deserialize(data: T): void;
}

/** The on-disk save document. */
export interface SaveDocument {
  /** Format version, see {@link SAVE_VERSION}. */
  version: number;
  /** Unix milliseconds when the save was written. */
  savedAt: number;
  /** Per-provider state, keyed by provider key. */
  data: Record<string, unknown>;
}

/** Metadata describing a stored save slot. */
export interface SlotInfo {
  /** Slot name as passed to {@link SaveManager.saveToSlot}. */
  name: string;
  /** Unix milliseconds the slot was written. */
  savedAt: number;
  /** Save format version stored in the slot. */
  version: number;
}

/**
 * Minimal storage surface used by {@link SaveManager}. `localStorage` satisfies
 * it; tests can pass an in-memory stand-in.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export class SaveManager {
  private readonly providers = new Map<string, SaveProvider<never>>();
  private readonly store: KeyValueStore | null;

  /**
   * @param store Backing key-value store. Defaults to `localStorage` when
   *   available; slot operations throw without one.
   */
  constructor(store: KeyValueStore | null = defaultStore()) {
    this.store = store;
  }

  /** Register a save provider. Re-registering a key replaces the previous one. */
  register<T>(provider: SaveProvider<T>): void {
    this.providers.set(provider.key, provider as SaveProvider<never>);
  }

  /** Remove a provider by key. */
  unregister(key: string): void {
    this.providers.delete(key);
  }

  /** Serialize all registered providers into a versioned JSON string. */
  saveToString(): string {
    const data: Record<string, unknown> = {};
    for (const [key, provider] of this.providers) data[key] = provider.serialize();
    const doc: SaveDocument = { version: SAVE_VERSION, savedAt: Date.now(), data };
    return JSON.stringify(doc);
  }

  /**
   * Restore all registered providers from a JSON string produced by
   * {@link saveToString}. Providers with no matching branch are left untouched.
   *
   * @throws If the string is not valid JSON or is not a recognized save document.
   */
  loadFromString(json: string): SaveDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Save data is not valid JSON.');
    }
    const doc = parsed as Partial<SaveDocument>;
    if (!doc || typeof doc !== 'object' || typeof doc.version !== 'number' || !doc.data) {
      throw new Error('Save data is not a Civitopia save document.');
    }
    if (doc.version > SAVE_VERSION) {
      throw new Error(
        `Save version ${doc.version} is newer than this build supports (${SAVE_VERSION}).`,
      );
    }
    for (const [key, provider] of this.providers) {
      if (key in doc.data) provider.deserialize(doc.data[key] as never);
    }
    return doc as SaveDocument;
  }

  /** Write the current state into a named localStorage slot. */
  saveToSlot(name: string): void {
    this.requireStore().setItem(SLOT_PREFIX + name, this.saveToString());
  }

  /**
   * Load a named slot into the registered providers.
   * @returns `true` if the slot existed and was loaded.
   */
  loadFromSlot(name: string): boolean {
    const raw = this.requireStore().getItem(SLOT_PREFIX + name);
    if (raw === null) return false;
    this.loadFromString(raw);
    return true;
  }

  /** Delete a named slot. */
  deleteSlot(name: string): void {
    this.requireStore().removeItem(SLOT_PREFIX + name);
  }

  /** List all stored slots, newest first. */
  listSlots(): SlotInfo[] {
    const store = this.requireStore();
    const out: SlotInfo[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key === null || !key.startsWith(SLOT_PREFIX)) continue;
      const raw = store.getItem(key);
      if (raw === null) continue;
      try {
        const doc = JSON.parse(raw) as SaveDocument;
        out.push({
          name: key.slice(SLOT_PREFIX.length),
          savedAt: typeof doc.savedAt === 'number' ? doc.savedAt : 0,
          version: typeof doc.version === 'number' ? doc.version : 0,
        });
      } catch {
        // Skip unreadable slots rather than failing the whole listing.
      }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** Trigger a browser download of the current save. */
  exportToFile(filename = 'civitopia-save.json'): void {
    const blob = new Blob([this.saveToString()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Prompt the user for a save file and load it.
   * @returns Resolves `true` once a file was chosen and loaded, `false` if the
   *   picker was dismissed without a selection.
   */
  importFromFile(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(false);
          return;
        }
        file
          .text()
          .then((text) => {
            this.loadFromString(text);
            resolve(true);
          })
          .catch(reject);
      });
      input.addEventListener('cancel', () => resolve(false));
      input.click();
    });
  }

  private requireStore(): KeyValueStore {
    if (!this.store) throw new Error('No storage available for save slots.');
    return this.store;
  }
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
