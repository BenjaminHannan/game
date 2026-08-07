/**
 * InputManager: tracks keyboard, pointer and wheel state, and resolves the
 * ground point under the cursor each frame.
 *
 * Per-frame deltas (pointer movement, wheel) accumulate between calls to
 * {@link InputManager.endFrame}, which every consumer must run after reading
 * them — {@link update} does this as part of the normal frame.
 */

import * as THREE from 'three';
import type { Terrain } from '../render/terrain.js';

/** A point on the terrain surface, in world metres. */
export interface TerrainHit {
  x: number;
  y: number;
  z: number;
}

export class InputManager {
  /** Ground point under the cursor, or `null` when the cursor misses terrain. */
  terrainHit: TerrainHit | null = null;

  /** Pointer movement since the previous frame, in CSS pixels. */
  readonly pointerDelta = { x: 0, y: 0 };

  /** Pointer position in CSS pixels relative to the canvas. */
  readonly pointerPosition = { x: 0, y: 0 };

  /** Accumulated wheel delta since the previous frame. */
  wheelDelta = 0;

  private readonly keys = new Set<string>();
  private readonly buttons = new Set<number>();
  private readonly canvas: HTMLCanvasElement;
  private readonly terrain: Terrain;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly listeners: Array<() => void> = [];
  private pointerInside = false;

  /**
   * @param canvas Canvas that receives pointer events.
   * @param terrain Terrain raycast against for {@link terrainHit}.
   */
  constructor(canvas: HTMLCanvasElement, terrain: Terrain) {
    this.canvas = canvas;
    this.terrain = terrain;
    this.attach();
  }

  /** True while the given `KeyboardEvent.code` is held. */
  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True while the given mouse button is held (0 left, 1 middle, 2 right). */
  isPointerDown(button: number): boolean {
    return this.buttons.has(button);
  }

  /**
   * Recompute the terrain hit under the cursor. Call once per frame before
   * consumers read {@link terrainHit}.
   *
   * @param camera Camera to cast from.
   */
  update(camera: THREE.Camera): void {
    if (!this.pointerInside) {
      this.terrainHit = null;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = (this.pointerPosition.x / Math.max(1, rect.width)) * 2 - 1;
    this.ndc.y = -(this.pointerPosition.y / Math.max(1, rect.height)) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, camera);

    const hits = this.raycaster.intersectObjects(this.terrain.chunks, false);
    const first = hits[0];
    if (first) {
      const p = first.point;
      this.terrainHit = { x: p.x, y: p.y, z: p.z };
    } else {
      this.terrainHit = null;
    }
  }

  /** Clear per-frame deltas. Call at the end of every frame. */
  endFrame(): void {
    this.pointerDelta.x = 0;
    this.pointerDelta.y = 0;
    this.wheelDelta = 0;
  }

  /** Detach all DOM listeners. */
  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
  }

  private attach(): void {
    const add = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K | string,
      handler: (event: never) => void,
      options?: AddEventListenerOptions,
    ): void => {
      target.addEventListener(type, handler as EventListener, options);
      this.listeners.push(() =>
        target.removeEventListener(type, handler as EventListener, options),
      );
    };

    add(window, 'keydown', (e: KeyboardEvent) => {
      this.keys.add(e.code);
    });
    add(window, 'keyup', (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    });
    // Held keys would otherwise stick when focus leaves the page.
    add(window, 'blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });

    add(this.canvas, 'pointerenter', () => {
      this.pointerInside = true;
    });
    add(this.canvas, 'pointerleave', () => {
      this.pointerInside = false;
      this.terrainHit = null;
    });

    add(this.canvas, 'pointermove', (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.pointerDelta.x += x - this.pointerPosition.x;
      this.pointerDelta.y += y - this.pointerPosition.y;
      this.pointerPosition.x = x;
      this.pointerPosition.y = y;
      this.pointerInside = true;
    });

    add(this.canvas, 'pointerdown', (e: PointerEvent) => {
      this.buttons.add(e.button);
      this.canvas.setPointerCapture(e.pointerId);
    });

    add(window, 'pointerup', (e: PointerEvent) => {
      this.buttons.delete(e.button);
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    });

    add(
      this.canvas,
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        this.wheelDelta += e.deltaY;
      },
      { passive: false },
    );

    add(this.canvas, 'contextmenu', (e: MouseEvent) => {
      e.preventDefault();
    });
  }
}
