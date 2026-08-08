/**
 * BulldozeTool: the destructive mode.
 *
 * `docs/research/cs2/ux-conventions.md` §2 keeps the bulldozer "a persistent
 * destructive tool, kept visually separate from the constructive categories".
 * The gesture is deliberately the simplest one in the toolset — hover to see
 * what would go and what it pays back, left-click to do it — because every other
 * tool in the game has a two-step commit and the one that destroys things should
 * not be the one you can half-perform.
 *
 * The tool's options row carries the {@link BulldozeFilter} set, which is what
 * makes "clear this paint without losing the road under it" expressible. `[` and
 * `]` resize the zoning brush exactly as they do in the zone tool, so the two
 * paint-shaped tools share one muscle memory.
 *
 * Like the other tools it holds no three.js references: highlighting goes
 * through the same {@link ZonePreviewTarget} the zone tool draws its stroke on,
 * so it can be driven headlessly by tests and by `window.metropolis`.
 */

import { BaseTool } from './tools.js';
import type { TerrainHit } from './input.js';
import type { ZonePreviewTarget } from './zoneTool.js';
import {
  applyBulldoze,
  resolveBulldozeTarget,
  type BulldozeBudget,
  type BulldozeFilter,
  type BulldozeTarget,
  type BulldozeWorld,
} from '../sim/bulldoze.js';
import type { CellKey } from '../sim/zoning.js';

/** Largest zoning-brush radius, matching the zone tool's own cap. */
export const MAX_BULLDOZE_RADIUS = 4;

/** What the tool is currently pointing at, for HUD hints. */
export interface BulldozeToolStatus {
  /** The active layer filter. */
  filter: BulldozeFilter;
  /** Zoning brush radius in cells. */
  brushRadius: number;
  /** Resolved target under the cursor, or `null` over empty ground. */
  target: BulldozeTarget | null;
  /** Short player-facing description of the current state. */
  message: string;
}

/** Construction options for {@link BulldozeTool}. */
export interface BulldozeToolOptions {
  /** The three stores the tool edits. */
  world: BulldozeWorld;
  /** Highlight renderer. Omit to run headless. */
  preview?: ZonePreviewTarget | null;
  /** Treasury credited with refunds. Omit to demolish for nothing. */
  budget?: BulldozeBudget | null;
  /** Filter active when the tool is first selected. */
  filter?: BulldozeFilter;
  /** Called whenever the status changes. */
  onStatus?: ((status: BulldozeToolStatus) => void) | null;
  /** Called after each successful demolition. */
  onDemolished?: ((target: BulldozeTarget) => void) | null;
}

export class BulldozeTool extends BaseTool {
  override readonly id = 'bulldoze';

  private readonly world: BulldozeWorld;
  private readonly previewTarget: ZonePreviewTarget | null;
  private readonly budget: BulldozeBudget | null;
  private readonly onStatus: ((status: BulldozeToolStatus) => void) | null;
  private readonly onDemolished: ((target: BulldozeTarget) => void) | null;

  private activeFilter: BulldozeFilter;
  private radius = 1;

  private current: BulldozeTarget | null = null;
  private lastX = 0;
  private lastZ = 0;
  private hasPosition = false;

  constructor(options: BulldozeToolOptions) {
    super();
    this.world = options.world;
    this.previewTarget = options.preview ?? null;
    this.budget = options.budget ?? null;
    this.activeFilter = options.filter ?? 'all';
    this.onStatus = options.onStatus ?? null;
    this.onDemolished = options.onDemolished ?? null;
  }

  /** The active layer filter. */
  get filter(): BulldozeFilter {
    return this.activeFilter;
  }

  /** Zoning brush radius in cells either side of the centre. */
  get brushRadius(): number {
    return this.radius;
  }

  /** The resolved target under the cursor, or `null`. */
  get target(): BulldozeTarget | null {
    return this.current;
  }

  /** Cells the highlight is currently showing. */
  get previewCells(): readonly CellKey[] {
    return this.current ? this.current.cells : [];
  }

  /** Current status, suitable for a HUD hint. */
  get status(): BulldozeToolStatus {
    return {
      filter: this.activeFilter,
      brushRadius: this.radius,
      target: this.current,
      message: this.message(),
    };
  }

  /** Switch the layer filter and re-resolve under the cursor. */
  setFilter(filter: BulldozeFilter): void {
    if (this.activeFilter === filter) return;
    this.activeFilter = filter;
    this.refresh();
  }

  /** Set the zoning brush radius, clamped to `[0, MAX_BULLDOZE_RADIUS]`. */
  setBrushRadius(radius: number): void {
    const next = Math.max(0, Math.min(MAX_BULLDOZE_RADIUS, Math.round(radius)));
    if (next === this.radius) return;
    this.radius = next;
    this.refresh();
  }

  override activate(): void {
    this.refresh();
  }

  override deactivate(): void {
    this.current = null;
    this.hasPosition = false;
    this.pushPreview();
    // An empty message tells the HUD to drop the hint rather than advertising
    // the bulldozer while another tool takes over.
    this.onStatus?.({ ...this.status, message: '' });
  }

  override onPointerMove(hit: TerrainHit | null): void {
    if (!hit) {
      this.hasPosition = false;
      this.current = null;
      this.pushPreview();
      this.emitStatus();
      return;
    }
    this.hover(hit.x, hit.z);
  }

  override onPointerDown(hit: TerrainHit | null, button: number): void {
    // Right-click clears the highlight, matching the other tools' cancel
    // gesture. It never destroys anything: right-drag is the camera's rotate.
    if (button === 2) {
      this.current = null;
      this.pushPreview();
      this.emitStatus();
      return;
    }
    if (button !== 0 || !hit) return;
    this.demolishAt(hit.x, hit.z);
  }

  override onKey(code: string): void {
    switch (code) {
      case 'Escape':
        this.current = null;
        this.pushPreview();
        this.emitStatus();
        break;
      case 'BracketLeft':
        this.setBrushRadius(this.radius - 1);
        break;
      case 'BracketRight':
        this.setBrushRadius(this.radius + 1);
        break;
      default:
        break;
    }
  }

  /**
   * Resolve what sits at a world position without removing it.
   * @returns The target, or `null` over empty ground.
   */
  hover(x: number, z: number): BulldozeTarget | null {
    this.lastX = x;
    this.lastZ = z;
    this.hasPosition = true;
    this.current = resolveBulldozeTarget(
      this.world,
      x,
      z,
      this.activeFilter,
      this.radius,
    );
    this.pushPreview();
    this.emitStatus();
    return this.current;
  }

  /**
   * Remove whatever the filter admits at a world position and credit the refund.
   *
   * The scripted form used by tests and the `window.metropolis` hook.
   *
   * @returns The target that was removed, or `null` when there was nothing to
   *   remove there.
   */
  demolishAt(x: number, z: number): BulldozeTarget | null {
    const target = resolveBulldozeTarget(
      this.world,
      x,
      z,
      this.activeFilter,
      this.radius,
    );
    if (!target) {
      this.hover(x, z);
      return null;
    }
    if (!applyBulldoze(this.world, target, this.budget)) {
      this.hover(x, z);
      return null;
    }
    this.onDemolished?.(target);
    // Re-resolve: the grid moved under the cursor, so the highlight must too.
    this.hover(x, z);
    return target;
  }

  /** Re-resolve at the last known cursor position. */
  private refresh(): void {
    if (this.hasPosition) this.hover(this.lastX, this.lastZ);
    else this.emitStatus();
  }

  private pushPreview(): void {
    // `'none'` is the de-zone brush, which the overlay draws in its rejection
    // red — exactly the right colour for "this is about to be removed".
    this.previewTarget?.setZonePreview(this.current ? this.current.cells : [], 'none');
  }

  private message(): string {
    const target = this.current;
    if (!target) {
      return this.activeFilter === 'all'
        ? 'Bulldoze · click a road, building or zoned cell'
        : `Bulldoze ${this.activeFilter} · nothing here`;
    }
    const refund = target.refund > 0 ? ` · +¤${target.refund} refund` : ' · no refund';
    return `${target.label} · ${target.detail}${refund}`;
  }

  private emitStatus(): void {
    this.onStatus?.(this.status);
  }
}
