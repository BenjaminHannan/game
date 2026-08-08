/**
 * RoadTool: the click-chain road drawing mode.
 *
 * Interaction follows the "Continuous" straight-segment flow from
 * docs/research/roads.md §1: the first click plants a start point, moving the
 * cursor previews the segment (green when buildable, red when not), the second
 * click commits it *and* immediately becomes the start of the next segment, so a
 * long run of road is laid without re-arming the tool. Escape or a right-click
 * drops the pending start.
 *
 * Endpoints snap to nearby existing nodes first and to the 8 m zoning grid
 * otherwise (roads.md §2), which is what makes chained and crossing runs share
 * junction nodes.
 *
 * The tool holds no three.js references: it talks to a {@link RoadPreviewTarget}
 * so it can be driven headlessly in tests.
 */

import { BaseTool } from './tools.js';
import type { TerrainHit } from './input.js';
import {
  DEFAULT_ROAD_CLASS,
  ROAD_CLASSES,
  ROAD_REJECTION_TEXT,
  type RoadClassId,
  type RoadEdgeData,
  type RoadNetwork,
  type RoadPlan,
  type RoadPoint,
  type RoadRejection,
} from '../sim/roads.js';
import type { LedgerCategory } from '../sim/economy.js';

/** Anything that can display (or ignore) the placement ghost. */
export interface RoadPreviewTarget {
  setPreview(plan: RoadPlan | null): void;
}

/**
 * Treasury the tool charges construction to.
 *
 * A bare `{ money }` still works — that is what the headless tests pass — but
 * when the object also offers {@link Ledger.spend} the tool uses it, so the
 * "nothing outside the ledger writes `state.money`" invariant of
 * `docs/research/simulation.md` §4 holds for every real game session.
 */
export interface RoadBudget {
  money: number;
  spend?(amount: number, category: LedgerCategory): boolean;
}

/** What the tool is currently doing, for HUD hints. */
export interface RoadToolStatus {
  /** True once a start point is planted. */
  drawing: boolean;
  /** Candidate segment under the cursor, or `null`. */
  plan: RoadPlan | null;
  /** Short player-facing description of the current state. */
  message: string;
}

/** Construction options for {@link RoadTool}. */
export interface RoadToolOptions {
  /** Graph the tool edits. */
  network: RoadNetwork;
  /** Ghost renderer. Omit to run headless. */
  preview?: RoadPreviewTarget | null;
  /** Treasury charged per segment. Omit to build for free. */
  budget?: RoadBudget | null;
  /** Road class placed by this tool. */
  roadClass?: RoadClassId;
  /** Called whenever the status text changes. */
  onStatus?: ((status: RoadToolStatus) => void) | null;
  /** Called after each committed segment. */
  onPlaced?: ((edge: RoadEdgeData, plan: RoadPlan) => void) | null;
}

export class RoadTool extends BaseTool {
  override readonly id = 'roads';

  /** Road class this tool places. */
  roadClass: RoadClassId;

  private readonly network: RoadNetwork;
  private readonly previewTarget: RoadPreviewTarget | null;
  private readonly budget: RoadBudget | null;
  private readonly onStatus: ((status: RoadToolStatus) => void) | null;
  private readonly onPlaced: ((edge: RoadEdgeData, plan: RoadPlan) => void) | null;

  private start: RoadPoint | null = null;
  private currentPlan: RoadPlan | null = null;

  constructor(options: RoadToolOptions) {
    super();
    this.network = options.network;
    this.previewTarget = options.preview ?? null;
    this.budget = options.budget ?? null;
    this.roadClass = options.roadClass ?? DEFAULT_ROAD_CLASS;
    this.onStatus = options.onStatus ?? null;
    this.onPlaced = options.onPlaced ?? null;
  }

  /** True while a start point is planted and awaiting its end click. */
  get isDrawing(): boolean {
    return this.start !== null;
  }

  /** The pending start point, or `null`. */
  get startPoint(): RoadPoint | null {
    return this.start;
  }

  /** The candidate segment under the cursor, or `null`. */
  get plan(): RoadPlan | null {
    return this.currentPlan;
  }

  /** Current status, suitable for a HUD hint. */
  get status(): RoadToolStatus {
    return { drawing: this.isDrawing, plan: this.currentPlan, message: this.message() };
  }

  override activate(): void {
    this.reset();
  }

  override deactivate(): void {
    this.start = null;
    this.currentPlan = null;
    this.previewTarget?.setPreview(null);
    // An empty message tells the HUD to drop the hint entirely; a plain reset
    // would instead advertise the road tool while another tool is taking over.
    this.onStatus?.({ drawing: false, plan: null, message: '' });
  }

  override onPointerMove(hit: TerrainHit | null): void {
    this.hover(hit ? hit.x : null, hit ? hit.z : null);
  }

  override onPointerDown(hit: TerrainHit | null, button: number): void {
    // Right-click abandons the run, matching the cancel gesture players expect.
    if (button === 2) {
      this.cancel();
      return;
    }
    if (button !== 0 || !hit) return;
    this.click(hit.x, hit.z);
  }

  override onKey(code: string): void {
    if (code === 'Escape') this.cancel();
  }

  /**
   * Update the hovered position.
   *
   * @param x Raw world x in metres, or `null` when the cursor left the terrain.
   * @param z Raw world z in metres.
   * @returns The candidate segment, or `null` when there is nothing to preview.
   */
  hover(x: number | null, z: number | null): RoadPlan | null {
    if (x === null || z === null) {
      this.currentPlan = null;
      this.previewTarget?.setPreview(null);
      this.emitStatus();
      return null;
    }

    const point = this.network.snap(x, z);
    const plan = this.start
      ? this.affordable(this.network.planBetween(this.start, point, this.roadClass))
      : anchorPlan(point, this.roadClass);

    this.currentPlan = plan;
    this.previewTarget?.setPreview(plan);
    this.emitStatus();
    return plan;
  }

  /**
   * Handle a left click at a raw world position: plant the start, or commit the
   * pending segment and chain onward from its end.
   *
   * @returns The edge just built, or `null` when the click only planted a start
   *   or the segment was rejected.
   */
  click(x: number, z: number): RoadEdgeData | null {
    if (!this.start) {
      this.begin(x, z);
      return null;
    }
    return this.commitTo(x, z);
  }

  /**
   * Plant the start point at a raw world position.
   * @returns The snapped start point.
   */
  begin(x: number, z: number): RoadPoint {
    this.start = this.network.snap(x, z);
    this.hover(x, z);
    return this.start;
  }

  /**
   * Commit the segment running from the pending start to a raw world position.
   *
   * On success the end node becomes the new start, so the next click chains
   * another segment. On rejection nothing changes and the ghost stays red.
   *
   * @returns The new edge, or `null` if there was no start or it was rejected.
   */
  commitTo(x: number, z: number): RoadEdgeData | null {
    if (!this.start) return null;
    const plan = this.affordable(
      this.network.planBetween(this.start, this.network.snap(x, z), this.roadClass),
    );
    this.currentPlan = plan;

    if (!plan.ok) {
      this.previewTarget?.setPreview(plan);
      this.emitStatus();
      return null;
    }

    const edge = this.network.commit(plan);
    if (!edge) {
      this.emitStatus();
      return null;
    }
    // Price in the plan, charge on commit (simulation.md §4). `affordable`
    // already rejected anything the treasury cannot cover, so a refusal here
    // means the balance moved between preview and click — roll the segment back
    // rather than build one the city has not paid for.
    if (!this.charge(plan.cost)) {
      this.network.removeEdge(edge.id);
      plan.ok = false;
      plan.reason = 'unaffordable';
      this.previewTarget?.setPreview(plan);
      this.emitStatus();
      return null;
    }

    const endNode = this.network.node(edge.to);
    this.start = endNode
      ? { x: endNode.x, y: endNode.y, z: endNode.z, nodeId: endNode.id }
      : { ...plan.end };

    this.currentPlan = anchorPlan(this.start, this.roadClass);
    this.previewTarget?.setPreview(this.currentPlan);
    this.onPlaced?.(edge, plan);
    this.emitStatus();
    return edge;
  }

  /** Drop the pending start point and hide the ghost. */
  cancel(): void {
    if (!this.start && !this.currentPlan) return;
    this.reset();
  }

  private reset(): void {
    this.start = null;
    this.currentPlan = null;
    this.previewTarget?.setPreview(null);
    this.emitStatus();
  }

  /**
   * Debit the treasury for a committed segment.
   * @returns `false` when the treasury could not cover it and nothing was taken.
   */
  private charge(amount: number): boolean {
    if (!this.budget || amount <= 0) return true;
    if (this.budget.spend) return this.budget.spend(amount, 'construction');
    if (this.budget.money < amount) return false;
    this.budget.money -= amount;
    return true;
  }

  /** Downgrade an otherwise-valid plan the treasury cannot cover. */
  private affordable(plan: RoadPlan): RoadPlan {
    if (plan.ok && this.budget && this.budget.money < plan.cost) {
      plan.ok = false;
      plan.reason = 'unaffordable';
    }
    return plan;
  }

  private message(): string {
    const plan = this.currentPlan;
    if (!this.start) return 'Click to start a road';
    if (!plan) return 'Click to place the next point';
    if (plan.length === 0) return 'Click to place the next point · Esc to finish';
    if (!plan.ok) {
      const reason: RoadRejection = plan.reason ?? 'degenerate';
      return ROAD_REJECTION_TEXT[reason];
    }
    return `${ROAD_CLASSES[plan.roadClass].name} · ${plan.length.toFixed(0)} m · ¤${plan.cost}`;
  }

  private emitStatus(): void {
    this.onStatus?.(this.status);
  }
}

/** A zero-length "plan" used to draw the snap marker before a start is planted. */
function anchorPlan(point: RoadPoint, roadClass: RoadClassId): RoadPlan {
  return {
    ok: true,
    reason: null,
    roadClass,
    start: point,
    end: point,
    length: 0,
    grade: 0,
    cost: 0,
  };
}
