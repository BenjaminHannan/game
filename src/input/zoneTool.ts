/**
 * ZoneTool: the drag-paint zoning mode.
 *
 * Interaction follows the "drag painting" gesture fixed in
 * docs/research/zoning-growth.md §3 and adopted in
 * docs/research/cs2/zoning-districts.md: press to start a stroke, drag to
 * accumulate cells under a square brush, release to commit the whole stroke as
 * one batch. Right-click or `Escape` abandons a stroke without applying it, and
 * `[` / `]` resize the brush. Erasing is the `'none'` brush rather than a
 * right-drag, because right-drag already rotates the camera.
 *
 * Between two consecutive pointer samples the stroke is interpolated at
 * half-cell spacing: a fast drag at 60 fps crosses many cells per frame and
 * without interpolation the stroke comes out dotted.
 *
 * Like {@link RoadTool} the tool holds no three.js references — it talks to a
 * {@link ZonePreviewTarget} so it can be driven headlessly by tests and by the
 * `window.metropolis` debug hooks.
 */

import { BaseTool } from './tools.js';
import type { TerrainHit } from './input.js';
import {
  FRONTAGE_STEP,
  ZONE_COST_PER_CELL,
  ZONE_LABELS,
  cellAt,
  cellKey,
  cellX,
  cellZ,
  ZONE_GRID_SIZE,
  type CellKey,
  type ZoneType,
  type ZonePaint,
  type ZoningState,
} from '../sim/zoning.js';

/** Largest brush radius, in cells either side of the centre (9 x 9). */
export const MAX_BRUSH_RADIUS = 4;

/** Anything that can display (or ignore) the stroke preview. */
export interface ZonePreviewTarget {
  setZonePreview(cells: readonly CellKey[], paint: ZonePaint): void;
}

/** Treasury the tool charges zoning to. */
export interface ZoneBudget {
  money: number;
}

/** What the tool is currently doing, for HUD hints. */
export interface ZoneToolStatus {
  /** True while a stroke is being dragged. */
  painting: boolean;
  /** The active brush. */
  paint: ZonePaint;
  /** Brush radius in cells. */
  brushRadius: number;
  /** Cells the current stroke or hover would change. */
  cells: number;
  /** Fee the current stroke would charge. */
  cost: number;
  /** Short player-facing description of the current state. */
  message: string;
}

/** Construction options for {@link ZoneTool}. */
export interface ZoneToolOptions {
  /** Cell grid the tool paints. */
  zoning: ZoningState;
  /** Preview renderer. Omit to run headless. */
  preview?: ZonePreviewTarget | null;
  /** Treasury charged per cell. Omit to zone for free. */
  budget?: ZoneBudget | null;
  /** Brush active when the tool is first selected. */
  paint?: ZonePaint;
  /** Called whenever the status changes. */
  onStatus?: ((status: ZoneToolStatus) => void) | null;
  /** Called after each committed stroke, with the number of cells changed. */
  onPainted?: ((changed: number, paint: ZonePaint) => void) | null;
}

export class ZoneTool extends BaseTool {
  override readonly id = 'zones';

  private readonly zoning: ZoningState;
  private readonly previewTarget: ZonePreviewTarget | null;
  private readonly budget: ZoneBudget | null;
  private readonly onStatus: ((status: ZoneToolStatus) => void) | null;
  private readonly onPainted: ((changed: number, paint: ZonePaint) => void) | null;

  private activePaint: ZonePaint;
  private radius = 1;

  /**
   * Cells accumulated by the live stroke, in visit order. A `Set` makes
   * repainting the same cell during one drag free, and truncating an
   * unaffordable stroke deterministic (insertion order is stroke order).
   */
  private readonly stroke = new Set<CellKey>();

  /** Cells shown under the cursor while no stroke is live. */
  private hoverCells: CellKey[] = [];

  private painting = false;
  private lastX = 0;
  private lastZ = 0;

  constructor(options: ZoneToolOptions) {
    super();
    this.zoning = options.zoning;
    this.previewTarget = options.preview ?? null;
    this.budget = options.budget ?? null;
    this.activePaint = options.paint ?? 'residential';
    this.onStatus = options.onStatus ?? null;
    this.onPainted = options.onPainted ?? null;
  }

  /** The active brush. */
  get paint(): ZonePaint {
    return this.activePaint;
  }

  /** True while a stroke is being dragged. */
  get isPainting(): boolean {
    return this.painting;
  }

  /** Brush radius in cells either side of the centre. */
  get brushRadius(): number {
    return this.radius;
  }

  /** Cells the live stroke has accumulated, in visit order. */
  get strokeCells(): readonly CellKey[] {
    return [...this.stroke];
  }

  /** Cells the preview is currently showing. */
  get previewCells(): readonly CellKey[] {
    return this.painting ? [...this.stroke] : this.hoverCells;
  }

  /** Current status, suitable for a HUD hint. */
  get status(): ZoneToolStatus {
    const cells = this.painting ? this.stroke.size : this.hoverCells.length;
    return {
      painting: this.painting,
      paint: this.activePaint,
      brushRadius: this.radius,
      cells,
      cost: this.feeFor(cells),
      message: this.message(cells),
    };
  }

  /** Switch the active brush. Cancels any live stroke. */
  setPaint(paint: ZonePaint): void {
    if (this.activePaint === paint) return;
    this.cancel();
    this.activePaint = paint;
    this.emitStatus();
  }

  /** Set the brush radius, clamped to `[0, MAX_BRUSH_RADIUS]`. */
  setBrushRadius(radius: number): void {
    const next = Math.max(0, Math.min(MAX_BRUSH_RADIUS, Math.round(radius)));
    if (next === this.radius) return;
    this.radius = next;
    if (!this.painting) this.hover(this.lastX, this.lastZ);
    this.emitStatus();
  }

  override activate(): void {
    this.reset();
  }

  override deactivate(): void {
    this.painting = false;
    this.stroke.clear();
    this.hoverCells = [];
    this.previewTarget?.setZonePreview([], this.activePaint);
    // An empty message tells the HUD to drop the hint entirely rather than
    // advertising the zone tool while another tool takes over.
    this.onStatus?.({ ...this.status, message: '' });
  }

  override onPointerMove(hit: TerrainHit | null): void {
    if (!hit) {
      if (!this.painting) {
        this.hoverCells = [];
        this.pushPreview();
        this.emitStatus();
      }
      return;
    }
    if (this.painting) this.extendStroke(hit.x, hit.z);
    else this.hover(hit.x, hit.z);
  }

  override onPointerDown(hit: TerrainHit | null, button: number): void {
    if (button === 2) {
      // Right-click abandons the stroke, matching the road tool's cancel
      // gesture. It deliberately does *not* double as the erase brush the
      // reference game puts there: right-drag is already the camera's rotate
      // gesture (see CameraRig), and the De-zone brush in the tool options row
      // covers erasing without fighting the camera for the same button.
      this.cancel();
      return;
    }
    if (button !== 0 || !hit) return;
    this.beginStroke(hit.x, hit.z);
  }

  override onPointerUp(_hit: TerrainHit | null, button: number): void {
    if (!this.painting || button !== 0) return;
    this.commitStroke();
  }

  override onKey(code: string): void {
    switch (code) {
      case 'Escape':
        this.cancel();
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
   * Update the hovered position without painting.
   * @returns The cells the brush is over.
   */
  hover(x: number, z: number): readonly CellKey[] {
    this.lastX = x;
    this.lastZ = z;
    this.hoverCells = [];
    this.collectBrush(x, z, this.hoverCells);
    this.pushPreview();
    this.emitStatus();
    return this.hoverCells;
  }

  /**
   * Start a stroke at a world position.
   * @param paint Brush to use for this stroke; defaults to the active brush.
   */
  beginStroke(x: number, z: number, paint: ZonePaint = this.activePaint): void {
    this.activePaint = paint;
    this.painting = true;
    this.stroke.clear();
    this.hoverCells = [];
    this.lastX = x;
    this.lastZ = z;
    this.collectBrush(x, z, null);
    this.pushPreview();
    this.emitStatus();
  }

  /**
   * Extend the live stroke to a world position, interpolating at half-cell
   * spacing so a fast drag paints a contiguous run rather than a dotted one.
   */
  extendStroke(x: number, z: number): void {
    if (!this.painting) return;
    const dx = x - this.lastX;
    const dz = z - this.lastZ;
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / FRONTAGE_STEP));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.collectBrush(this.lastX + dx * t, this.lastZ + dz * t, null);
    }
    this.lastX = x;
    this.lastZ = z;
    this.pushPreview();
    this.emitStatus();
  }

  /**
   * Apply the live stroke.
   *
   * The fee is checked against the treasury for the whole stroke at commit
   * time; a stroke the treasury cannot cover is **truncated to what is
   * affordable** in stroke order rather than rejected outright, so a long drag
   * near the end of the budget still does something useful.
   *
   * @returns How many cells changed.
   */
  commitStroke(): number {
    if (!this.painting) return 0;
    const paint = this.activePaint;
    let cells = [...this.stroke];

    const perCell = this.costPerCell();
    if (perCell > 0 && this.budget) {
      const affordable = Math.max(0, Math.floor(this.budget.money / perCell));
      if (cells.length > affordable) cells = cells.slice(0, affordable);
    }

    const changed = this.zoning.paintCells(cells, paint);
    if (this.budget) this.budget.money -= changed * perCell;

    this.painting = false;
    this.stroke.clear();
    this.hoverCells = [];
    this.collectBrush(this.lastX, this.lastZ, this.hoverCells);
    this.pushPreview();
    if (changed > 0) this.onPainted?.(changed, paint);
    this.emitStatus();
    return changed;
  }

  /** Abandon the live stroke without applying it. */
  cancel(): void {
    if (!this.painting) return;
    this.painting = false;
    this.stroke.clear();
    this.hoverCells = [];
    this.pushPreview();
    this.emitStatus();
  }

  /**
   * Paint a straight drag between two world positions in one call — the
   * scripted form used by tests and the `window.metropolis` debug hook.
   * @returns How many cells changed.
   */
  paintStroke(x1: number, z1: number, x2: number, z2: number, paint?: ZonePaint): number {
    this.beginStroke(x1, z1, paint ?? this.activePaint);
    this.extendStroke(x2, z2);
    return this.commitStroke();
  }

  /** Fee per cell for the active brush. De-zoning is free. */
  private costPerCell(): number {
    return this.activePaint === 'none' ? 0 : ZONE_COST_PER_CELL;
  }

  private feeFor(cells: number): number {
    return cells * this.costPerCell();
  }

  /**
   * Gather the eligible cells under the brush.
   * @param out Array to append to, or `null` to add directly to the stroke.
   */
  private collectBrush(x: number, z: number, out: CellKey[] | null): void {
    const centre = cellAt(x, z);
    if (centre < 0) return;
    const cx0 = cellX(centre);
    const cz0 = cellZ(centre);
    for (let oz = -this.radius; oz <= this.radius; oz++) {
      const cz = cz0 + oz;
      if (cz < 0 || cz >= ZONE_GRID_SIZE) continue;
      for (let ox = -this.radius; ox <= this.radius; ox++) {
        const cx = cx0 + ox;
        if (cx < 0 || cx >= ZONE_GRID_SIZE) continue;
        const k = cellKey(cx, cz);
        // Cells that are not paintable are silently skipped, so dragging across
        // a road or an occupied lot is harmless rather than an error.
        if (!this.zoning.canPaint(k, this.activePaint)) continue;
        if (out) {
          if (!out.includes(k)) out.push(k);
        } else {
          this.stroke.add(k);
        }
      }
    }
  }

  private pushPreview(): void {
    this.previewTarget?.setZonePreview(
      this.painting ? [...this.stroke] : this.hoverCells,
      this.activePaint,
    );
  }

  private reset(): void {
    this.painting = false;
    this.stroke.clear();
    this.hoverCells = [];
    this.pushPreview();
    this.emitStatus();
  }

  private message(cells: number): string {
    const label = ZONE_LABELS[this.activePaint];
    if (cells === 0) {
      if (this.zoning.zonableCells === 0) return 'Build a road first — zoning follows frontage';
      return this.painting ? `${label} · nothing zonable here` : `${label} · drag to paint`;
    }
    const fee = this.feeFor(cells);
    const cost = fee > 0 ? ` · ¤${fee}` : '';
    return `${label} · ${cells} cell${cells === 1 ? '' : 's'}${cost}`;
  }

  private emitStatus(): void {
    this.onStatus?.(this.status);
  }
}

/** Brushes offered by the zone tool's HUD sub-palette, in display order. */
export const ZONE_TOOL_MODES: ReadonlyArray<{ paint: ZonePaint; label: string }> = [
  { paint: 'residential', label: ZONE_LABELS.residential },
  { paint: 'commercial', label: ZONE_LABELS.commercial },
  { paint: 'industrial', label: ZONE_LABELS.industrial },
  { paint: 'none', label: ZONE_LABELS.none },
];

/** Narrowing helper: true when a paint names one of the RCI types. */
export function isZoneType(paint: ZonePaint): paint is ZoneType {
  return paint !== 'none';
}
