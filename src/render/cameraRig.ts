/**
 * City-builder camera rig: an orbit camera about a target point that slides
 * along the ground.
 *
 * Controls:
 *  - WASD / arrow keys, or middle-mouse drag, pan the target (screen-relative).
 *  - Right-mouse drag orbits (yaw freely, pitch clamped).
 *  - Wheel zooms toward the point under the cursor.
 *
 * All motion is critically damped toward a desired state so input feels smooth
 * without lagging behind the player.
 */

import * as THREE from 'three';
import { clamp } from '../core/noise.js';
import { WORLD_HALF } from './terrain.js';
import type { Terrain } from './terrain.js';
import type { InputManager } from '../input/input.js';

/** Closest the camera may sit to its target, in metres. */
export const MIN_DISTANCE = 20;

/** Furthest the camera may sit from its target, in metres. */
export const MAX_DISTANCE = 2500;

const MIN_PITCH = THREE.MathUtils.degToRad(10);
const MAX_PITCH = THREE.MathUtils.degToRad(80);

/** Keyboard pan speed in metres per second, at a 100m camera distance. */
const BASE_PAN_SPEED = 60;

const ROTATE_SPEED = 0.005;
const ZOOM_STEP = 0.0016;
const DAMPING = 12;

export class CameraRig {
  /** The perspective camera driven by this rig. */
  readonly camera: THREE.PerspectiveCamera;

  /** Ground point the camera looks at. */
  readonly target = new THREE.Vector3(0, 0, 0);

  private readonly desiredTarget = new THREE.Vector3(0, 0, 0);
  private desiredDistance = 420;
  private distance = 420;
  private desiredYaw = Math.PI * 0.25;
  private yaw = Math.PI * 0.25;
  private desiredPitch = THREE.MathUtils.degToRad(45);
  private pitch = THREE.MathUtils.degToRad(45);

  private readonly terrain: Terrain;
  private readonly projectScratch = new THREE.Vector3();

  /**
   * @param terrain Terrain used to keep the target on the ground.
   * @param aspect Initial viewport aspect ratio.
   */
  constructor(terrain: Terrain, aspect: number) {
    this.terrain = terrain;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 1, 12000);
    this.desiredTarget.y = terrain.heightAt(0, 0);
    this.target.copy(this.desiredTarget);
    this.applyTransform();
  }

  /** Current camera distance from the target, in metres. */
  getDistance(): number {
    return this.distance;
  }

  /** Camera altitude above sea level, in metres. */
  getHeight(): number {
    return this.camera.position.y;
  }

  /** Move the target to a world position immediately (no damping). */
  jumpTo(x: number, z: number, distance = this.desiredDistance): void {
    this.desiredTarget.set(x, 0, z);
    this.clampTarget();
    this.target.copy(this.desiredTarget);
    this.desiredDistance = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    this.distance = this.desiredDistance;
    this.applyTransform();
  }

  /**
   * Project a ground position to CSS pixel coordinates inside a viewport.
   *
   * The inverse of the raycast {@link InputManager} does every frame, and the
   * only way an automated driver can aim a real pointer event at a world
   * position.
   *
   * @param x World X.
   * @param z World Z.
   * @param width Viewport width in CSS pixels.
   * @param height Viewport height in CSS pixels.
   * @param y World Y. Defaults to the terrain height under `(x, z)`.
   * @returns Pixel coordinates, or `null` when the point is behind the camera.
   */
  project(
    x: number,
    z: number,
    width: number,
    height: number,
    y: number = this.terrain.heightAt(x, z),
  ): { x: number; y: number } | null {
    this.projectScratch.set(x, y, z).project(this.camera);
    if (this.projectScratch.z > 1) return null;
    return {
      x: ((this.projectScratch.x + 1) / 2) * width,
      y: ((1 - this.projectScratch.y) / 2) * height,
    };
  }

  /** Update the projection matrix after a viewport resize. */
  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Consume input and advance the rig.
   * @param input Input manager supplying keys, pointer and wheel state.
   * @param dt Real seconds since the previous frame.
   */
  update(input: InputManager, dt: number): void {
    this.handleRotate(input);
    this.handleZoom(input);
    this.handlePan(input, dt);
    this.damp(dt);
    this.applyTransform();
  }

  private handleRotate(input: InputManager): void {
    if (input.isPointerDown(2)) {
      const d = input.pointerDelta;
      this.desiredYaw -= d.x * ROTATE_SPEED;
      this.desiredPitch = clamp(this.desiredPitch + d.y * ROTATE_SPEED, MIN_PITCH, MAX_PITCH);
    }
  }

  private handleZoom(input: InputManager): void {
    const wheel = input.wheelDelta;
    if (wheel === 0) return;

    const previous = this.desiredDistance;
    // Exponential zoom keeps the feel consistent across the whole range.
    this.desiredDistance = clamp(
      this.desiredDistance * Math.exp(wheel * ZOOM_STEP),
      MIN_DISTANCE,
      MAX_DISTANCE,
    );

    // Zoom toward the ground point under the cursor: shift the target by the
    // same fraction the distance shrank, so that point stays put on screen.
    const hit = input.terrainHit;
    if (hit && previous > 0) {
      const factor = 1 - this.desiredDistance / previous;
      this.desiredTarget.x += (hit.x - this.desiredTarget.x) * factor;
      this.desiredTarget.z += (hit.z - this.desiredTarget.z) * factor;
      this.clampTarget();
    }
  }

  private handlePan(input: InputManager, dt: number): void {
    // Screen-relative basis: forward is the camera's heading flattened to the
    // ground plane, right is perpendicular to it.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const forwardX = -sin;
    const forwardZ = -cos;
    const rightX = cos;
    const rightZ = -sin;

    // Pan speed scales with zoom so the map moves at a consistent screen rate.
    const speedScale = this.distance / 100;

    let moveX = 0;
    let moveZ = 0;
    if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) moveZ += 1;
    if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) moveZ -= 1;
    if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) moveX += 1;
    if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) moveX -= 1;

    if (moveX !== 0 || moveZ !== 0) {
      const len = Math.hypot(moveX, moveZ);
      moveX /= len;
      moveZ /= len;
      const step = BASE_PAN_SPEED * speedScale * dt;
      this.desiredTarget.x += (forwardX * moveZ + rightX * moveX) * step;
      this.desiredTarget.z += (forwardZ * moveZ + rightZ * moveX) * step;
    }

    if (input.isPointerDown(1)) {
      const d = input.pointerDelta;
      // Drag the world with the cursor, so pan direction is inverted.
      const dragScale = 0.0022 * this.distance;
      this.desiredTarget.x -= (rightX * d.x - forwardX * d.y) * dragScale;
      this.desiredTarget.z -= (rightZ * d.x - forwardZ * d.y) * dragScale;
    }

    this.clampTarget();
  }

  private clampTarget(): void {
    this.desiredTarget.x = clamp(this.desiredTarget.x, -WORLD_HALF, WORLD_HALF);
    this.desiredTarget.z = clamp(this.desiredTarget.z, -WORLD_HALF, WORLD_HALF);
    this.desiredTarget.y = this.terrain.heightAt(this.desiredTarget.x, this.desiredTarget.z);
  }

  private damp(dt: number): void {
    // Frame-rate independent exponential smoothing.
    const t = 1 - Math.exp(-DAMPING * dt);
    this.target.lerp(this.desiredTarget, t);
    this.distance += (this.desiredDistance - this.distance) * t;
    this.yaw += (this.desiredYaw - this.yaw) * t;
    this.pitch += (this.desiredPitch - this.pitch) * t;
  }

  private applyTransform(): void {
    const horizontal = Math.cos(this.pitch) * this.distance;
    const vertical = Math.sin(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + vertical,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
  }
}
