/**
 * Tool framework: exactly one tool is active at a time and receives the
 * player's pointer and keyboard interactions with the world.
 *
 * Later phases add real tools (roads, zoning, utilities); this module defines
 * the contract and ships a no-op selection tool.
 */

import type { TerrainHit } from './input.js';

/** A player-facing world interaction mode. */
export interface Tool {
  /** Stable identifier, also used by the HUD to mark the active button. */
  readonly id: string;
  /** Called when the tool becomes active. */
  activate(): void;
  /** Called when the tool is replaced by another. */
  deactivate(): void;
  /** Called each frame with the ground point under the cursor, if any. */
  onPointerMove(hit: TerrainHit | null): void;
  /** Called on pointer press over the world. */
  onPointerDown(hit: TerrainHit | null, button: number): void;
  /** Called on pointer release over the world. */
  onPointerUp(hit: TerrainHit | null, button: number): void;
  /** Called on key press while the tool is active. */
  onKey(code: string): void;
}

/**
 * Convenience base class: implements every {@link Tool} hook as a no-op so
 * concrete tools only override what they use.
 */
export abstract class BaseTool implements Tool {
  abstract readonly id: string;

  activate(): void {}
  deactivate(): void {}
  onPointerMove(_hit: TerrainHit | null): void {}
  onPointerDown(_hit: TerrainHit | null, _button: number): void {}
  onPointerUp(_hit: TerrainHit | null, _button: number): void {}
  onKey(_code: string): void {}
}

/**
 * Default tool. Currently a stub: it reports the hovered ground cell on click
 * and does nothing else. Replaced by real selection logic in a later phase.
 */
export class SelectTool extends BaseTool {
  override readonly id = 'select';

  override onPointerDown(hit: TerrainHit | null, button: number): void {
    if (button !== 0 || !hit) return;
    console.log(
      `[select] ${hit.x.toFixed(1)}m, ${hit.z.toFixed(1)}m (ground ${hit.y.toFixed(1)}m)`,
    );
  }
}

/** Owns the set of available tools and which one is active. */
export class ToolManager {
  private readonly tools = new Map<string, Tool>();
  private active: Tool | null = null;

  /** Register a tool. The first registered tool becomes active. */
  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
    if (!this.active) this.setActive(tool.id);
  }

  /** The currently active tool, or `null` before any is registered. */
  get current(): Tool | null {
    return this.active;
  }

  /**
   * Activate a registered tool by id.
   * @returns `true` if the tool existed and is now active.
   */
  setActive(id: string): boolean {
    const next = this.tools.get(id);
    if (!next) return false;
    if (this.active === next) return true;
    this.active?.deactivate();
    this.active = next;
    next.activate();
    return true;
  }

  /** Ids of every registered tool, in registration order. */
  ids(): string[] {
    return [...this.tools.keys()];
  }

  /** Forward a hover to the active tool. */
  pointerMove(hit: TerrainHit | null): void {
    this.active?.onPointerMove(hit);
  }

  /** Forward a press to the active tool. */
  pointerDown(hit: TerrainHit | null, button: number): void {
    this.active?.onPointerDown(hit, button);
  }

  /** Forward a release to the active tool. */
  pointerUp(hit: TerrainHit | null, button: number): void {
    this.active?.onPointerUp(hit, button);
  }

  /** Forward a key press to the active tool. */
  key(code: string): void {
    this.active?.onKey(code);
  }
}
