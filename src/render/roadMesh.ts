/**
 * Road rendering: flat ribbon meshes draped over the terrain.
 *
 * Each edge of the {@link RoadNetwork} becomes a quad strip sampled along its
 * centreline, with every vertex pinned to the ground height plus a small lift so
 * the surface reads as a road lying on the landscape rather than a floating
 * plane. Two ribbons are stacked per road: a wider verge/sidewalk strip at the
 * class's full right-of-way width, and the darker carriageway on top at its
 * paved width (roads.md §Road/lane geometry: a two-lane road is 16 m of
 * right-of-way carrying 10 m of asphalt).
 *
 * Node caps — small discs at each node — fill the wedge-shaped gaps left where
 * two segments meet at an angle, which stands in for the auto-generated junction
 * geometry described in roads.md §6.
 */

import * as THREE from 'three';
import {
  ROAD_CLASSES,
  type HeightSampler,
  type RoadNetwork,
  type RoadPlan,
} from '../sim/roads.js';

/** Height in metres the verge ribbon sits above the ground. */
export const VERGE_LIFT = 0.22;

/** Height in metres the carriageway sits above the ground. */
export const SURFACE_LIFT = 0.32;

/** Height in metres the placement ghost floats above the ground. */
export const PREVIEW_LIFT = 0.55;

/** Spacing in metres between centreline samples when draping a ribbon. */
export const DRAPE_SPACING = 4;

/** Colour of the paved carriageway. */
export const ASPHALT_COLOR = 0x3b3d44;

/** Colour of the verge / sidewalk strip flanking the carriageway. */
export const VERGE_COLOR = 0x9d9c93;

/** Ghost colour for a buildable segment. */
export const PREVIEW_VALID_COLOR = 0x53d67f;

/** Ghost colour for a rejected segment. */
export const PREVIEW_INVALID_COLOR = 0xe1544a;

/**
 * Accumulates draped triangles into a single indexed geometry.
 *
 * Exported so tests and future networks (rails, paths) can reuse the draping
 * maths without going through the renderer.
 */
export class RibbonBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];
  private readonly sampler: HeightSampler;

  /** @param sampler Terrain the ribbon is draped over. */
  constructor(sampler: HeightSampler) {
    this.sampler = sampler;
  }

  /** True when nothing has been added yet. */
  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  /**
   * Add a straight ribbon between two world positions.
   *
   * @param ax Start x in metres.
   * @param az Start z in metres.
   * @param bx End x in metres.
   * @param bz End z in metres.
   * @param width Full ribbon width in metres.
   * @param lift Height above the ground, in metres.
   */
  addSegment(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    width: number,
    lift: number,
  ): void {
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6 || width <= 0) return;

    const ux = dx / length;
    const uz = dz / length;
    // Perpendicular in the ground plane.
    const px = -uz * (width / 2);
    const pz = ux * (width / 2);

    const steps = Math.max(1, Math.ceil(length / DRAPE_SPACING));
    const base = this.positions.length / 3;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = ax + dx * t;
      const cz = az + dz * t;
      this.pushVertex(cx + px, cz + pz, lift);
      this.pushVertex(cx - px, cz - pz, lift);
    }

    for (let i = 0; i < steps; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      this.indices.push(a, c, b, b, c, d);
    }
  }

  /**
   * Add a horizontal disc, used to cap the join where segments meet.
   *
   * @param x Centre x in metres.
   * @param z Centre z in metres.
   * @param radius Disc radius in metres.
   * @param lift Height above the ground, in metres.
   * @param segments Number of triangles around the rim.
   */
  addDisc(x: number, z: number, radius: number, lift: number, segments = 12): void {
    if (radius <= 0) return;
    const centre = this.positions.length / 3;
    this.pushVertex(x, z, lift);
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      this.pushVertex(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, lift);
    }
    for (let i = 0; i < segments; i++) {
      const a = centre + 1 + i;
      const b = centre + 1 + ((i + 1) % segments);
      // Wound so the disc faces +Y like the ribbons: rim angles advance
      // clockwise when viewed from above, so the later vertex comes first.
      this.indices.push(centre, b, a);
    }
  }

  /** Produce the finished geometry. */
  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private pushVertex(x: number, z: number, lift: number): void {
    this.positions.push(x, this.sampler.heightAt(x, z) + lift, z);
    // Terrain normal by central difference, so lighting matches the ground.
    const d = 2;
    const nx = this.sampler.heightAt(x - d, z) - this.sampler.heightAt(x + d, z);
    const nz = this.sampler.heightAt(x, z - d) - this.sampler.heightAt(x, z + d);
    const ny = 2 * d;
    const len = Math.hypot(nx, ny, nz) || 1;
    this.normals.push(nx / len, ny / len, nz / len);
  }
}

/**
 * Keeps a three.js representation of a {@link RoadNetwork} in sync, and owns the
 * placement ghost drawn by the road tool.
 */
export class RoadRenderer {
  /** Scene node holding every road mesh and the ghost. */
  readonly group = new THREE.Group();

  private readonly network: RoadNetwork;
  private readonly sampler: HeightSampler;

  private readonly vergeMaterial: THREE.MeshLambertMaterial;
  private readonly surfaceMaterial: THREE.MeshLambertMaterial;
  private readonly previewMaterial: THREE.MeshBasicMaterial;

  private readonly verge: THREE.Mesh;
  private readonly surface: THREE.Mesh;
  private readonly preview: THREE.Mesh;

  private builtRevision = -1;
  private previewKey = '';

  /**
   * @param network Graph to visualise.
   * @param sampler Terrain the roads are draped over.
   */
  constructor(network: RoadNetwork, sampler: HeightSampler) {
    this.network = network;
    this.sampler = sampler;
    this.group.name = 'Roads';

    this.vergeMaterial = new THREE.MeshLambertMaterial({
      color: VERGE_COLOR,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.surfaceMaterial = new THREE.MeshLambertMaterial({
      color: ASPHALT_COLOR,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    });
    this.previewMaterial = new THREE.MeshBasicMaterial({
      color: PREVIEW_VALID_COLOR,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });

    this.verge = new THREE.Mesh(new THREE.BufferGeometry(), this.vergeMaterial);
    this.verge.name = 'RoadVerges';
    this.verge.receiveShadow = true;
    this.surface = new THREE.Mesh(new THREE.BufferGeometry(), this.surfaceMaterial);
    this.surface.name = 'RoadSurfaces';
    this.surface.receiveShadow = true;
    this.preview = new THREE.Mesh(new THREE.BufferGeometry(), this.previewMaterial);
    this.preview.name = 'RoadPreview';
    this.preview.visible = false;
    this.preview.renderOrder = 2;

    this.group.add(this.verge, this.surface, this.preview);
    this.rebuild();
  }

  /** Rebuild the road meshes if the network changed. Call once per frame. */
  update(): void {
    if (this.network.revision !== this.builtRevision) this.rebuild();
  }

  /**
   * Show or hide the placement ghost.
   *
   * @param plan Candidate segment to draw, or `null` to hide the ghost.
   */
  setPreview(plan: RoadPlan | null): void {
    if (!plan) {
      if (this.preview.visible) {
        this.preview.visible = false;
        this.previewKey = '';
      }
      return;
    }

    const key =
      `${plan.start.x},${plan.start.z},${plan.end.x},${plan.end.z},` +
      `${plan.roadClass},${plan.ok ? 1 : 0}`;
    if (key === this.previewKey && this.preview.visible) return;
    this.previewKey = key;

    const cls = ROAD_CLASSES[plan.roadClass];
    const builder = new RibbonBuilder(this.sampler);
    builder.addSegment(
      plan.start.x,
      plan.start.z,
      plan.end.x,
      plan.end.z,
      cls.totalWidth,
      PREVIEW_LIFT,
    );
    builder.addDisc(plan.start.x, plan.start.z, cls.totalWidth / 2, PREVIEW_LIFT);
    builder.addDisc(plan.end.x, plan.end.z, cls.totalWidth / 2, PREVIEW_LIFT);

    this.preview.geometry.dispose();
    this.preview.geometry = builder.build();
    this.previewMaterial.color.setHex(plan.ok ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR);
    this.preview.visible = true;
  }

  /** Release every GPU resource this renderer owns. */
  dispose(): void {
    this.verge.geometry.dispose();
    this.surface.geometry.dispose();
    this.preview.geometry.dispose();
    this.vergeMaterial.dispose();
    this.surfaceMaterial.dispose();
    this.previewMaterial.dispose();
  }

  private rebuild(): void {
    const verge = new RibbonBuilder(this.sampler);
    const surface = new RibbonBuilder(this.sampler);

    for (const edge of this.network.edges) {
      const a = this.network.node(edge.from);
      const b = this.network.node(edge.to);
      if (!a || !b) continue;
      const cls = ROAD_CLASSES[edge.roadClass] ?? ROAD_CLASSES.small;
      verge.addSegment(a.x, a.z, b.x, b.z, cls.totalWidth, VERGE_LIFT);
      surface.addSegment(a.x, a.z, b.x, b.z, cls.pavedWidth, SURFACE_LIFT);
    }

    // Cap each node with the widest class meeting there, so joins stay solid.
    for (const node of this.network.nodes) {
      let total = 0;
      let paved = 0;
      for (const edge of this.network.edgesAt(node.id)) {
        const cls = ROAD_CLASSES[edge.roadClass] ?? ROAD_CLASSES.small;
        total = Math.max(total, cls.totalWidth);
        paved = Math.max(paved, cls.pavedWidth);
      }
      if (total === 0) continue;
      verge.addDisc(node.x, node.z, total / 2, VERGE_LIFT);
      surface.addDisc(node.x, node.z, paved / 2, SURFACE_LIFT);
    }

    this.verge.geometry.dispose();
    this.verge.geometry = verge.build();
    this.surface.geometry.dispose();
    this.surface.geometry = surface.build();
    this.builtRevision = this.network.revision;
  }
}
