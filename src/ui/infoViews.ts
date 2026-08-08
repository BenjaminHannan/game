/**
 * Info views: a mode over the world, not a separate screen.
 *
 * `docs/research/cs2/ux-conventions.md` §4 and its "what makes it feel like
 * CS2" list rank this fourth: *you do not leave the city to read data about it;
 * the city recolours itself and you keep building*. Each view does three things
 * consistently — highlight the objects it is about, recolour them on a ramp, and
 * open a small panel with the headline metric and its legend.
 *
 * The structural bet the doc asks us to make is that **later systems cost only
 * their data**. That is what this module is: a registry with one lifecycle hook
 * (`apply`) and a declarative legend. Land value, pollution and coverage each
 * arrive as one `InfoViewDefinition` literal plus whatever recolouring their own
 * renderer already knows how to do — no new chrome, no new mode plumbing.
 *
 * Deliberately DOM-free. The manager is the state machine; {@link Hud} renders
 * the opener row and the panel from it, and tests can drive the whole mode
 * system headlessly.
 */

import type { IconId } from './icons.js';

/** One stop of a view's colour ramp, as shown in its legend. */
export interface LegendStop {
  /** CSS colour — the same value the world renderer tints with. */
  color: string;
  /** What that colour means, in two or three words. */
  label: string;
}

/** The headline figure a view's panel leads with. */
export interface InfoViewMetric {
  /** The number, already formatted. */
  value: string;
  /** What the number is. */
  label: string;
  /** One sentence of context, e.g. a target range or the worst offender. */
  note?: string;
}

/** Everything one info view declares. */
export interface InfoViewDefinition {
  /** Stable id, also the `data-view` attribute the DOM carries. */
  id: string;
  /** Player-facing name, shared with any future toolbar category of the same
   * subsystem — the one-taxonomy rule of §2. */
  label: string;
  /** Glyph for the opener button. */
  icon: IconId;
  /** One sentence for the tooltip: what the view shows. */
  description: string;
  /** Ramp stops, low to high. Empty for a view that recolours nothing. */
  legend?: readonly LegendStop[];
  /** Headline metric, read when the panel refreshes. Omit for none. */
  metric?: () => InfoViewMetric | null;
  /**
   * Turn the world recolouring on or off.
   *
   * Called exactly once per transition, never per frame, and never with the
   * value it already has — so an implementation can be a bare setter.
   */
  apply?: (enabled: boolean) => void;
  /**
   * `false` while the view's subsystem does not exist yet. Locked views stay
   * **visible and disabled** rather than hidden (§2: "locked entries stay
   * visible"), which is what makes the row read as a promise.
   */
  available?: boolean;
  /** Shown in a locked view's tooltip in place of its metric. */
  lockedNote?: string;
}

/** Fired whenever the active view changes. */
export type InfoViewListener = (active: string | null, previous: string | null) => void;

/**
 * The registry and the one-of-N state machine over it.
 *
 * Exactly one view is active at a time, or none — info views are a *mode*, and
 * two simultaneous recolourings of the same road would be unreadable. Sub-layers
 * within a view (§4's "sub-overlays are a real pattern") are explicitly out of
 * scope for v1 and would be a property of a definition, not of this class.
 */
export class InfoViewManager {
  private readonly views: InfoViewDefinition[] = [];
  private readonly byId = new Map<string, InfoViewDefinition>();
  private readonly listeners: InfoViewListener[] = [];
  private activeId: string | null = null;

  /** Every registered view, in registration order. */
  get all(): readonly InfoViewDefinition[] {
    return this.views;
  }

  /** Id of the active view, or `null` when the world is drawn plainly. */
  get active(): string | null {
    return this.activeId;
  }

  /** The active view's definition, or `null`. */
  get activeView(): InfoViewDefinition | null {
    return this.activeId === null ? null : (this.byId.get(this.activeId) ?? null);
  }

  /** Register a view. Ids are unique; re-registering one replaces it. */
  register(view: InfoViewDefinition): void {
    const existing = this.byId.get(view.id);
    if (existing) {
      this.views[this.views.indexOf(existing)] = view;
    } else {
      this.views.push(view);
    }
    this.byId.set(view.id, view);
  }

  /** Look up a view by id. */
  get(id: string): InfoViewDefinition | null {
    return this.byId.get(id) ?? null;
  }

  /** True when a view exists and its subsystem is ready. */
  isAvailable(id: string): boolean {
    const view = this.byId.get(id);
    return view !== undefined && view.available !== false;
  }

  /**
   * Activate a view, or `null` for none.
   *
   * A locked view is refused rather than silently ignored, so the caller can
   * report it. Activating the already-active view is a no-op that still returns
   * `true`; use {@link toggle} for the "click the lit button to turn it off"
   * gesture the opener row wants.
   *
   * @returns `true` when the mode is now what was asked for.
   */
  setActive(id: string | null): boolean {
    if (id !== null && !this.isAvailable(id)) return false;
    if (this.activeId === id) return true;

    const previous = this.activeId;
    if (previous !== null) this.byId.get(previous)?.apply?.(false);
    this.activeId = id;
    if (id !== null) this.byId.get(id)?.apply?.(true);

    for (const listener of this.listeners) listener(this.activeId, previous);
    return true;
  }

  /**
   * Turn a view on, or off if it is already on.
   * @returns The id now active, or `null`.
   */
  toggle(id: string): string | null {
    if (this.activeId === id) this.setActive(null);
    else this.setActive(id);
    return this.activeId;
  }

  /** Turn every recolouring off. */
  clear(): void {
    this.setActive(null);
  }

  /** Subscribe to mode changes. Returns an unsubscribe function. */
  onChange(listener: InfoViewListener): () => void {
    this.listeners.push(listener);
    return () => {
      const at = this.listeners.indexOf(listener);
      if (at >= 0) this.listeners.splice(at, 1);
    };
  }
}
