/**
 * Building rendering: every grown structure in a handful of instanced draw
 * calls.
 *
 * `docs/research/zoning-growth.md` §5-§6 fixes the strategy: one
 * `InstancedMesh` per box role with per-instance colour through
 * `instanceColor`, a unit geometry anchored at its own base so the per-box
 * matrix is a pure scale + Y-rotation + translate, and a revision comparison
 * that makes `update()` free on a frame where nothing grew.
 *
 * Massing comes from {@link buildingShape}, a pure function of the building's
 * saved seed, so nothing about appearance is persisted beyond that one integer
 * and a reloaded city is pixel-identical.
 *
 * Y placement samples the terrain once per building, at the lot centre, and
 * caches it: a building sits on a single flat pad rather than following the
 * ground, which is cheaper and matches how the road verge already behaves.
 */

import * as THREE from 'three';
import {
  footprintCentre,
  type BuildingData,
  type BuildingStore,
} from '../sim/buildings.js';
import type { HeightSampler } from '../sim/roads.js';
import {
  BOX_ROLES,
  MAX_BOXES_PER_BUILDING,
  buildingShape,
  type BoxRole,
} from './buildingShape.js';

/** Height in metres a building's pad sits above the sampled ground. */
export const BUILDING_LIFT = 0.25;

/** Instance capacity is grown in blocks of this size. */
export const BUILDING_INSTANCE_BLOCK = 512;

/** Hard ceiling on drawn buildings, matching the 1-2k perf budget with headroom. */
export const BUILDING_MAX_INSTANCES = 4096;

/** Ticks a building takes to rise from nothing to full height. */
export const GROW_IN_TICKS = 8;

/** Vertical scale a building starts its grow-in at. */
export const GROW_IN_START = 0.05;

/** Rotation about Y that points a building's local -z at its road, per facing. */
export const FACING_ROTATION: readonly number[] = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];

/**
 * Keeps a three.js representation of a {@link BuildingStore} in sync.
 *
 * One mesh per box role rather than per (zone x role): per-instance colour
 * already separates the zones, so four draw calls carry the whole city instead
 * of the ten the design doc budgeted for.
 */
export class BuildingRenderer {
  /** Scene node holding every building mesh. */
  readonly group = new THREE.Group();

  private readonly store: BuildingStore;
  private readonly sampler: HeightSampler;
  private readonly material: THREE.MeshLambertMaterial;

  /** One instanced mesh per {@link BOX_ROLES} entry, in that order. */
  private meshes: THREE.InstancedMesh[] = [];
  private readonly used: number[] = [];
  private capacity = BUILDING_INSTANCE_BLOCK;

  /**
   * Where each building's boxes landed, so a grow-in frame can rewrite exactly
   * those instances. Flat typed arrays rather than per-building objects.
   */
  private slotMesh = new Int32Array(BUILDING_INSTANCE_BLOCK * MAX_BOXES_PER_BUILDING);
  private slotIndex = new Int32Array(BUILDING_INSTANCE_BLOCK * MAX_BOXES_PER_BUILDING);
  private slotCount = new Uint8Array(BUILDING_INSTANCE_BLOCK);
  private padY = new Float32Array(BUILDING_INSTANCE_BLOCK);

  /** Store indices still playing their grow-in animation. */
  private growing: number[] = [];

  private builtRevision = -1;
  private builtStructureRevision = -1;
  private builtCount = 0;

  /** Scratch reused every write; the frame path allocates nothing per box. */
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchColor = new THREE.Color();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  /**
   * @param store Building list to visualise.
   * @param sampler Terrain the pads are laid on.
   */
  constructor(store: BuildingStore, sampler: HeightSampler) {
    this.store = store;
    this.sampler = sampler;
    this.group.name = 'Buildings';
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.allocate(BUILDING_INSTANCE_BLOCK);
    this.rebuild(0);
  }

  /** Buildings currently drawn. */
  get drawnBuildings(): number {
    return this.builtCount;
  }

  /** Draw calls the buildings cost: one per non-empty role mesh. */
  get drawCalls(): number {
    let calls = 0;
    for (const mesh of this.meshes) if (mesh.count > 0) calls++;
    return calls;
  }

  /** Total box instances across every mesh. */
  get instanceCount(): number {
    let total = 0;
    for (const mesh of this.meshes) total += mesh.count;
    return total;
  }

  /** Buildings mid grow-in. */
  get growingCount(): number {
    return this.growing.length;
  }

  /**
   * Sync with the store and advance the grow-in animation. Call once per frame.
   *
   * On a frame where nothing grew and nothing is rising this is one integer
   * comparison and a length check.
   *
   * @param tick Current simulation tick, used for the grow-in animation.
   */
  update(tick: number): void {
    if (this.store.revision !== this.builtRevision) {
      if (this.store.structureRevision !== this.builtStructureRevision) this.rebuild(tick);
      else this.appendNew(tick);
    }
    if (this.growing.length > 0) this.animateGrowth(tick);
  }

  /** Release every GPU resource this renderer owns. */
  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
  }

  /** Rebuild every instance from scratch. */
  private rebuild(tick: number): void {
    const count = Math.min(this.store.count, BUILDING_MAX_INSTANCES);
    this.ensureCapacity(count);
    for (let i = 0; i < this.meshes.length; i++) this.used[i] = 0;
    this.growing.length = 0;
    this.padY.fill(Number.NaN);

    for (let i = 0; i < count; i++) {
      const building = this.store.items[i] as BuildingData;
      const scale = growScale(tick, building.bornTick);
      this.writeBuilding(i, building, scale, true);
      if (scale < 1) this.growing.push(i);
    }

    this.flush();
    this.builtCount = count;
    this.builtRevision = this.store.revision;
    this.builtStructureRevision = this.store.structureRevision;
  }

  /** Append only the buildings added since the last sync. */
  private appendNew(tick: number): void {
    const count = Math.min(this.store.count, BUILDING_MAX_INSTANCES);
    if (count > this.capacity) {
      // Growing the buffers reallocates the meshes, so there is nothing to
      // append onto — start over.
      this.rebuild(tick);
      return;
    }
    for (let i = this.builtCount; i < count; i++) {
      const building = this.store.items[i] as BuildingData;
      const scale = growScale(tick, building.bornTick);
      this.writeBuilding(i, building, scale, true);
      if (scale < 1) this.growing.push(i);
    }
    this.flush();
    this.builtCount = count;
    this.builtRevision = this.store.revision;
    this.builtStructureRevision = this.store.structureRevision;
  }

  /** Rewrite the instances of every building still rising. */
  private animateGrowth(tick: number): void {
    let write = 0;
    for (let n = 0; n < this.growing.length; n++) {
      const i = this.growing[n] as number;
      if (i >= this.builtCount) continue;
      const building = this.store.items[i] as BuildingData | undefined;
      if (!building) continue;
      const scale = growScale(tick, building.bornTick);
      this.writeBuilding(i, building, scale, false);
      if (scale < 1) this.growing[write++] = i;
    }
    this.growing.length = write;
    this.flush();
  }

  /**
   * Write one building's boxes.
   *
   * @param i Store index, which is also the slot-table index.
   * @param scale Vertical grow-in factor in `(0, 1]`.
   * @param claim `true` to take fresh instance slots, `false` to rewrite the
   *   slots this building already holds.
   */
  private writeBuilding(
    i: number,
    building: BuildingData,
    scale: number,
    claim: boolean,
  ): void {
    if (Number.isNaN(this.padY[i] as number)) {
      const centre = footprintCentre(building);
      this.padY[i] = this.sampler.heightAt(centre.x, centre.z) + BUILDING_LIFT;
    }
    const centre = footprintCentre(building);
    const pad = this.padY[i] as number;
    const angle = FACING_ROTATION[building.facing] as number;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.scratchQuaternion.setFromAxisAngle(BuildingRenderer.UP, angle);

    const shape = buildingShape(building.zone, building.seed, building.w, building.d);
    const limit = Math.min(shape.boxes.length, MAX_BOXES_PER_BUILDING);
    if (claim) this.slotCount[i] = 0;

    for (let b = 0; b < limit; b++) {
      const box = shape.boxes[b] as (typeof shape.boxes)[number];
      const roleIndex = BOX_ROLES.indexOf(box.role as BoxRole);
      const mesh = this.meshes[roleIndex] as THREE.InstancedMesh;

      let slot: number;
      if (claim) {
        slot = this.used[roleIndex] as number;
        if (slot >= this.capacity) continue;
        this.used[roleIndex] = slot + 1;
        const at = i * MAX_BOXES_PER_BUILDING + (this.slotCount[i] as number);
        this.slotMesh[at] = roleIndex;
        this.slotIndex[at] = slot;
        this.slotCount[i] = (this.slotCount[i] as number) + 1;
      } else {
        const at = i * MAX_BOXES_PER_BUILDING + b;
        if (b >= (this.slotCount[i] as number)) break;
        if (this.slotMesh[at] !== roleIndex) break;
        slot = this.slotIndex[at] as number;
      }

      // Local offset rotated into world: rotY(a) maps (x, z) to
      // (x cos a + z sin a, -x sin a + z cos a).
      const lx = box.x;
      const lz = box.z;
      this.scratchPosition.set(
        centre.x + lx * cos + lz * sin,
        pad + box.y * scale,
        centre.z + -lx * sin + lz * cos,
      );
      this.scratchScale.set(box.width, Math.max(box.height * scale, 0.01), box.depth);
      this.scratchMatrix.compose(
        this.scratchPosition,
        this.scratchQuaternion,
        this.scratchScale,
      );
      mesh.setMatrixAt(slot, this.scratchMatrix);
      mesh.setColorAt(slot, this.scratchColor.setHex(box.color));
    }
  }

  /** Publish instance counts and buffer updates to the GPU. */
  private flush(): void {
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i] as THREE.InstancedMesh;
      mesh.count = this.used[i] as number;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Grow the instance buffers and the slot tables to hold `needed` buildings. */
  private ensureCapacity(needed: number): void {
    if (needed <= this.capacity) return;
    const next = Math.min(
      BUILDING_MAX_INSTANCES,
      Math.ceil(needed / BUILDING_INSTANCE_BLOCK) * BUILDING_INSTANCE_BLOCK,
    );
    this.allocate(next);
  }

  private allocate(capacity: number): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.capacity = capacity;
    this.meshes = [];
    this.used.length = 0;
    for (let i = 0; i < BOX_ROLES.length; i++) {
      const role = BOX_ROLES[i] as BoxRole;
      const geometry = role === 'roof' ? prismGeometry() : boxGeometry();
      const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
      mesh.name = `Buildings:${role}`;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Buildings span the whole map; culling the group as one sphere would
      // pop the city in and out, so culling is left to the per-frame camera.
      mesh.frustumCulled = false;
      mesh.setColorAt(0, this.scratchColor.setHex(0xffffff));
      this.meshes.push(mesh);
      this.used.push(0);
      this.group.add(mesh);
    }
    this.slotMesh = new Int32Array(capacity * MAX_BOXES_PER_BUILDING);
    this.slotIndex = new Int32Array(capacity * MAX_BOXES_PER_BUILDING);
    this.slotCount = new Uint8Array(capacity);
    this.padY = new Float32Array(capacity);
    this.padY.fill(Number.NaN);
  }
}

/** Vertical scale of a building `tick - bornTick` ticks into its grow-in. */
export function growScale(tick: number, bornTick: number): number {
  const age = tick - bornTick;
  if (!Number.isFinite(age) || age >= GROW_IN_TICKS) return 1;
  if (age <= 0) return GROW_IN_START;
  const t = age / GROW_IN_TICKS;
  return GROW_IN_START + (1 - GROW_IN_START) * t;
}

/** A unit box anchored at its own base, so scale.y is the box's height. */
function boxGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

/** A unit square-based pyramid anchored at its base: the four-triangle roof cap. */
function prismGeometry(): THREE.BufferGeometry {
  const h = 0.5;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const positions: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i] as readonly [number, number];
    const b = corners[(i + 1) % 4] as readonly [number, number];
    positions.push(a[0], 0, a[1], b[0], 0, b[1], 0, 1, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
