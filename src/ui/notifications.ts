/**
 * Notification toasts: the transient half of the notification story.
 *
 * `docs/research/cs2/ux-conventions.md` §6 separates two channels and insists
 * the separation matters: **diegetic problem markers** anchored to the offending
 * building (authoritative, complete, persistent) and an **ambient voice channel**
 * (flavour, opt-out). This module is neither of those. It is the third thing the
 * v1 shell actually needs — a *confirmation* channel for events that have no
 * location, or whose location the player is already looking at: a month settled,
 * a plan refused, a road refunded.
 *
 * Keeping it separate is the point. When building markers arrive they must stay
 * trustworthy and complete, so nothing here should ever be the only place a
 * problem is reported. Toasts expire; problems must not.
 *
 * Rate limiting is built in rather than bolted on: an identical message arriving
 * inside {@link COALESCE_WINDOW_MS} increments a count on the live toast instead
 * of stacking a duplicate, which is what stops "not enough funds" from filling
 * the screen while a player holds the mouse down on an unaffordable road.
 */

import { icon, hasIcon, type IconId } from './icons.js';

/** Severity of a toast, which picks its accent colour and its default life. */
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/** How long each severity stays on screen, in milliseconds. */
export const TOAST_TTL_MS: Readonly<Record<ToastKind, number>> = {
  info: 5000,
  success: 5000,
  warning: 7000,
  error: 8000,
};

/** Identical messages arriving inside this window coalesce into one toast. */
export const COALESCE_WINDOW_MS = 2500;

/** Most toasts shown at once; the oldest is dropped past this. */
export const MAX_TOASTS = 4;

/** One notification request. */
export interface ToastOptions {
  /** Headline. Kept to a few words — the body carries the detail. */
  title: string;
  /** Optional sentence of detail. */
  body?: string;
  /** Severity. Defaults to `'info'`. */
  kind?: ToastKind;
  /** Glyph shown beside the text. Defaults to one chosen from the severity. */
  icon?: IconId;
  /** Lifetime override in milliseconds. `0` pins the toast until dismissed. */
  ttl?: number;
}

/** A toast currently on screen. */
export interface ActiveToast {
  /** Monotonic id, unique within one session. */
  id: number;
  kind: ToastKind;
  title: string;
  body: string;
  /** How many identical notifications this one stands for. */
  count: number;
}

/** Default glyph per severity, so a caller never has to pick one. */
const KIND_ICONS: Readonly<Record<ToastKind, IconId>> = {
  info: 'info',
  success: 'info',
  warning: 'info',
  error: 'close',
};

/** Anything that can measure elapsed milliseconds. `Date.now` satisfies it. */
export type Clock = () => number;

interface ToastEntry extends ActiveToast {
  root: HTMLElement;
  countEl: HTMLElement;
  bodyEl: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  raisedAt: number;
  ttl: number;
}

/**
 * The toast area, mounted once by {@link Hud}.
 *
 * Deliberately dumb: it owns no simulation state and subscribes to nothing.
 * Callers push; a later milestone can subscribe an adapter to the event bus and
 * push from there without this class changing.
 */
export class NotificationCenter {
  private readonly root: HTMLElement;
  private readonly entries: ToastEntry[] = [];
  private readonly clock: Clock;
  private nextId = 1;

  /**
   * @param mount Element the toast column is appended to, typically the HUD root.
   * @param clock Time source, injectable so tests can drive coalescing.
   */
  constructor(mount: HTMLElement, clock: Clock = Date.now) {
    this.clock = clock;
    this.root = document.createElement('div');
    this.root.className = 'hud-toasts';
    // Polite rather than assertive: these are confirmations, and a screen reader
    // interrupting mid-sentence for "month settled" would be worse than useless.
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    mount.append(this.root);
  }

  /** The toast column element, for tests. */
  get element(): HTMLElement {
    return this.root;
  }

  /** Toasts currently on screen, oldest first. */
  get active(): readonly ActiveToast[] {
    return this.entries;
  }

  /** How many toasts are on screen. */
  get count(): number {
    return this.entries.length;
  }

  /**
   * Raise a notification.
   *
   * @returns The id of the toast that carries this message — an existing one
   *   when it coalesced, a fresh one otherwise.
   */
  push(options: ToastOptions): number {
    const kind = options.kind ?? 'info';
    const title = options.title;
    const body = options.body ?? '';
    const now = this.clock();

    const existing = this.entries.find(
      (e) =>
        e.title === title &&
        e.body === body &&
        e.kind === kind &&
        now - e.raisedAt <= COALESCE_WINDOW_MS,
    );
    if (existing) {
      existing.count++;
      existing.raisedAt = now;
      existing.countEl.textContent = `x${existing.count}`;
      existing.countEl.hidden = false;
      this.arm(existing);
      return existing.id;
    }

    const entry = this.build(kind, title, body, options.icon);
    entry.ttl = options.ttl ?? TOAST_TTL_MS[kind];
    entry.raisedAt = now;
    this.entries.push(entry);
    this.root.append(entry.root);
    this.arm(entry);

    while (this.entries.length > MAX_TOASTS) {
      this.dismiss((this.entries[0] as ToastEntry).id);
    }
    return entry.id;
  }

  /**
   * Remove one toast.
   * @returns `true` if it was on screen.
   */
  dismiss(id: number): boolean {
    const at = this.entries.findIndex((e) => e.id === id);
    if (at < 0) return false;
    const entry = this.entries[at] as ToastEntry;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.root.remove();
    this.entries.splice(at, 1);
    return true;
  }

  /** Remove every toast. */
  clear(): void {
    while (this.entries.length > 0) this.dismiss((this.entries[0] as ToastEntry).id);
  }

  /** Remove the toast column and cancel every pending timer. */
  dispose(): void {
    this.clear();
    this.root.remove();
  }

  private build(
    kind: ToastKind,
    title: string,
    body: string,
    glyph: IconId | undefined,
  ): ToastEntry {
    const root = document.createElement('div');
    root.className = 'hud-toast';
    root.dataset.kind = kind;

    const iconEl = document.createElement('span');
    iconEl.className = 'hud-toast__icon';
    const chosen = glyph && hasIcon(glyph) ? glyph : KIND_ICONS[kind];
    iconEl.innerHTML = icon(chosen, 16);

    const text = document.createElement('div');
    text.className = 'hud-toast__text';

    const head = document.createElement('div');
    head.className = 'hud-toast__title';
    head.textContent = title;

    const countEl = document.createElement('span');
    countEl.className = 'hud-toast__count';
    countEl.hidden = true;
    head.append(countEl);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'hud-toast__body';
    bodyEl.textContent = body;
    bodyEl.hidden = body.length === 0;

    text.append(head, bodyEl);

    const close = document.createElement('button');
    close.className = 'hud-toast__close';
    close.type = 'button';
    close.setAttribute('aria-label', `Dismiss: ${title}`);
    close.innerHTML = icon('close', 12);

    const entry: ToastEntry = {
      id: this.nextId++,
      kind,
      title,
      body,
      count: 1,
      root,
      countEl,
      bodyEl,
      timer: null,
      raisedAt: 0,
      ttl: TOAST_TTL_MS[kind],
    };
    close.addEventListener('click', () => this.dismiss(entry.id));

    root.append(iconEl, text, close);
    root.dataset.toastId = String(entry.id);
    return entry;
  }

  /** (Re)start a toast's expiry timer. A `ttl` of 0 pins it. */
  private arm(entry: ToastEntry): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    if (entry.ttl <= 0) return;
    entry.timer = setTimeout(() => this.dismiss(entry.id), entry.ttl);
  }
}
