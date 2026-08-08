/**
 * Zone overlay: the coloured cell tint drawn over the zonable strips beside
 * roads.
 *
 * One `InstancedMesh` of flat, grid-aligned 8 m quads carries every cell, so the
 * whole overlay is a single draw call regardless of how many cells the network
 * has produced (zoning-growth.md §6). Per-cell colour goes through
 * `instanceColor`; per-cell height is one `heightAt` sample at the cell centre,
 * which keeps the tint lying on the ground the way the road verge already does.
 *
 * A second, smaller instanced mesh draws the zone tool's live stroke preview on
 * top, so hovering and dragging never touch the main buffer.
 *
 * Rebuilds are revision-driven, matching `RoadRenderer.update()`: when nothing
 * changed, `update()` is two integer comparisons and returns.
 */

import * as THREE from 'three';
import {
  UNZONED_COLOR,
  ZONE_CELL,
  ZONE_COLORS,
  cellCentreX,
  cellCentreZ,
  zoneFromCode,
  DEZONE_COLOR,
  type CellKey,
  type ZonePaint,
  type ZoningState,
} from '../sim/zoning.js';
import type { HeightSampler } from '../sim/roads.js';

/** Height in metres the zone tint floats above the ground. */
export const ZONE_LIFT = 0.3;

/** Height in metres the stroke preview floats above the ground. */
export const ZONE_PREVIEW_LIFT = 0.45;

/** Fraction of a cell the quad fills, leaving a hairline gutter as a grid line. */
export const ZONE_QUAD_FILL = 0.88;

/** Opacity of a painted cell. */
export const ZONE_TINT_OPACITY = 0.5;

/** Opacity of an unpainted-but-zonable cell. */
export const ZONE_EMPTY_OPACITY = 0.22;

/** Instance capacity is grown in blocks of this size. */
export const ZONE_INSTANCE_BLOCK = 4096;

/** Hard ceiling on drawn cells, so a map-spanning network cannot stall a frame. */
export const ZONE_MAX_INSTANCES = 98304;

/** Instance capacity of the stroke-preview mesh. */
export const ZONE_PREVIEW_CAPACITY = 1024;

/**
 * Keeps a three.js representation of a {@link ZoningState} in sync, and owns the
 * zone tool's stroke preview.
 */
export class ZoneOverlay {
  /** Scene node holding the tint and the preview. */
  readonly group = new THREE.Group();

  private readonly zoning: ZoningState;
  private readonly sampler: HeightSampler;

  private readonly tintMaterial: THREE.MeshBasicMaterial;
  private readonly emptyMaterial: THREE.MeshBasicMaterial;
  private readonly previewMaterial: THREE.MeshBasicMaterial;

  /** Painted cells. Always visible so the player can read their zoning layer. */
  private tint: THREE.InstancedMesh;
  /** Zonable but unpainted cells. Only shown while the zone tool is active. */
  private empty: THREE.InstancedMesh;
  private readonly preview: THREE.InstancedMesh;

  private tintCapacity = ZONE_INSTANCE_BLOCK;
  private emptyCapacity = ZONE_INSTANCE_BLOCK;

  private builtZoneRevision = -1;
  private builtFrontageRevision = -1;
  private showEmptyCells = false;
  private previewKey = '';

  /** Scratch objects reused every rebuild; nothing is allocated per cell. */
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchColor = new THREE.Color();

  /**
   * @param zoning Cell grid to visualise.
   * @param sampler Terrain the tint is laid on.
   */
  constructor(zoning: ZoningState, sampler: HeightSampler) {
    this.zoning = zoning;
    this.sampler = sampler;
    this.group.name = 'ZoneOverlay';

    this.tintMaterial = zoneMaterial(ZONE_TINT_OPACITY, -4);
    this.emptyMaterial = zoneMaterial(ZONE_EMPTY_OPACITY, -4);
    this.previewMaterial = zoneMaterial(0.7, -6);

    this.tint = this.makeMesh('ZoneTint', this.tintMaterial, this.tintCapacity, 3);
    this.empty = this.makeMesh('ZoneEmpty', this.emptyMaterial, this.emptyCapacity, 2);
    this.empty.visible = false;
    this.preview = this.makeMesh(
      'ZonePreview',
      this.previewMaterial,
      ZONE_PREVIEW_CAPACITY,
      4,
    );
    this.preview.count = 0;

    this.group.add(this.empty, this.tint, this.preview);
    this.rebuild();
  }

  /**
   * Show or hide the faint tint over zonable-but-unpainted cells. The zone tool
   * turns this on while it is active so the player can see where paint will
   * stick.
   */
  setShowEmptyCells(show: boolean): void {
    if (this.showEmptyCells === show) return;
    this.showEmptyCells = show;
    this.empty.visible = show;
    // Force a rebuild: the empty pass is skipped entirely while hidden.
    if (show) this.builtZoneRevision = -1;
  }

  /** True when the empty-cell tint is being drawn. */
  get showsEmptyCells(): boolean {
    return this.showEmptyCells;
  }

  /** Painted cells currently drawn. */
  get paintedCount(): number {
    return this.tint.count;
  }

  /** Zonable-but-unpainted cells currently drawn. */
  get emptyCount(): number {
    return this.empty.visible ? this.empty.count : 0;
  }

  /** Cells currently drawn as the stroke preview. */
  get previewCount(): number {
    return this.preview.count;
  }

  /** Rebuild the overlay if the zoning layer changed. Call once per frame. */
  update(): void {
    if (
      this.zoning.zoneRevision === this.builtZoneRevision &&
      this.zoning.frontageRevision === this.builtFrontageRevision
    ) {
      return;
    }
    this.rebuild();
  }

  /**
   * Show the zone tool's live brush or stroke.
   * @param cells Cells to outline, or an empty list to hide the preview.
   * @param paint Brush the cells would receive, which sets the highlight colour.
   */
  setZonePreview(cells: readonly CellKey[], paint: ZonePaint): void {
    const key = `${paint}:${cells.length}:${cells[0] ?? -1}:${cells[cells.length - 1] ?? -1}`;
    if (key === this.previewKey) return;
    this.previewKey = key;

    const colour = paint === 'none' ? DEZONE_COLOR : ZONE_COLORS[paint];
    this.scratchColor.setHex(colour);
    const limit = Math.min(cells.length, ZONE_PREVIEW_CAPACITY);
    for (let i = 0; i < limit; i++) {
      this.writeInstance(this.preview, i, cells[i] as CellKey, ZONE_PREVIEW_LIFT);
      this.preview.setColorAt(i, this.scratchColor);
    }
    this.preview.count = limit;
    this.preview.instanceMatrix.needsUpdate = true;
    if (this.preview.instanceColor) this.preview.instanceColor.needsUpdate = true;
    this.preview.visible = limit > 0;
  }

  /** Release every GPU resource this overlay owns. */
  dispose(): void {
    for (const mesh of [this.tint, this.empty, this.preview]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.tintMaterial.dispose();
    this.emptyMaterial.dispose();
    this.previewMaterial.dispose();
  }

  private rebuild(): void {
    const { zone, frontage } = this.zoning;

    // Count first so the instance buffers are sized once rather than grown
    // mid-pass; a whole-grid scan of a Uint8Array is a fraction of a millisecond
    // and only happens on the frame after the player edited something.
    let painted = 0;
    let empty = 0;
    for (let k = 0; k < zone.length; k++) {
      if (zone[k] !== 0) painted++;
      else if ((frontage[k] as number) >= 0) empty++;
    }
    painted = Math.min(painted, ZONE_MAX_INSTANCES);
    empty = Math.min(empty, ZONE_MAX_INSTANCES);

    if (painted > this.tintCapacity) {
      this.tintCapacity = blockSize(painted);
      this.tint = this.replaceMesh(this.tint, 'ZoneTint', this.tintMaterial, this.tintCapacity, 3);
    }
    if (this.showEmptyCells && empty > this.emptyCapacity) {
      this.emptyCapacity = blockSize(empty);
      this.empty = this.replaceMesh(
        this.empty,
        'ZoneEmpty',
        this.emptyMaterial,
        this.emptyCapacity,
        2,
      );
      this.empty.visible = true;
    }

    this.scratchColor.setHex(UNZONED_COLOR);
    let ti = 0;
    let ei = 0;
    for (let k = 0; k < zone.length; k++) {
      const code = zone[k] as number;
      if (code !== 0) {
        if (ti >= painted) continue;
        const type = zoneFromCode(code);
        this.writeInstance(this.tint, ti, k, ZONE_LIFT);
        // A stranded cell — painted but with no road left — reads at half
        // saturation, so losing a road is visible without losing the paint.
        const hex = type === 'none' ? UNZONED_COLOR : ZONE_COLORS[type];
        const c = this.scratchColor.setHex(hex);
        if ((frontage[k] as number) < 0) c.multiplyScalar(0.45);
        this.tint.setColorAt(ti, c);
        ti++;
      } else if (this.showEmptyCells && (frontage[k] as number) >= 0) {
        if (ei >= empty) continue;
        this.writeInstance(this.empty, ei, k, ZONE_LIFT);
        this.empty.setColorAt(ei, this.scratchColor.setHex(UNZONED_COLOR));
        ei++;
      }
    }

    this.tint.count = ti;
    this.tint.instanceMatrix.needsUpdate = true;
    if (this.tint.instanceColor) this.tint.instanceColor.needsUpdate = true;
    this.tint.visible = ti > 0;

    this.empty.count = ei;
    this.empty.instanceMatrix.needsUpdate = true;
    if (this.empty.instanceColor) this.empty.instanceColor.needsUpdate = true;
    this.empty.visible = this.showEmptyCells && ei > 0;

    this.builtZoneRevision = this.zoning.zoneRevision;
    this.builtFrontageRevision = this.zoning.frontageRevision;
  }

  /** Place one unit quad over a cell, draped at the ground height. */
  private writeInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    k: CellKey,
    lift: number,
  ): void {
    const x = cellCentreX(k);
    const z = cellCentreZ(k);
    this.scratchMatrix.makeTranslation(x, this.sampler.heightAt(x, z) + lift, z);
    mesh.setMatrixAt(index, this.scratchMatrix);
  }

  private makeMesh(
    name: string,
    material: THREE.Material,
    capacity: number,
    renderOrder: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(zoneQuadGeometry(), material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    // Seed instanceColor so setColorAt is legal before the first draw.
    mesh.setColorAt(0, this.scratchColor.setHex(UNZONED_COLOR));
    return mesh;
  }

  private replaceMesh(
    old: THREE.InstancedMesh,
    name: string,
    material: THREE.Material,
    capacity: number,
    renderOrder: number,
  ): THREE.InstancedMesh {
    const next = this.makeMesh(name, material, capacity, renderOrder);
    this.group.remove(old);
    old.geometry.dispose();
    old.dispose();
    this.group.add(next);
    return next;
  }
}

/** A flat, grid-aligned quad one cell across, lying in the XZ plane. */
function zoneQuadGeometry(): THREE.PlaneGeometry {
  const side = ZONE_CELL * ZONE_QUAD_FILL;
  const geometry = new THREE.PlaneGeometry(side, side);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function zoneMaterial(opacity: number, offset: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset * 2,
  });
}

function blockSize(needed: number): number {
  return Math.ceil(needed / ZONE_INSTANCE_BLOCK) * ZONE_INSTANCE_BLOCK;
}
