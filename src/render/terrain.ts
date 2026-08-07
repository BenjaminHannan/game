/**
 * Terrain: a seeded 4096m x 4096m heightfield world with a chunked, vertex-
 * coloured mesh and an animated water plane.
 *
 * The height function is deliberately composed rather than raw noise, so the
 * map is pleasant to build on:
 *
 *  - a broad, gently undulating central plain (the buildable core),
 *  - rolling hills that rise toward the map edges,
 *  - one meandering river ~80-140m wide cutting diagonally across the map,
 *  - a sea inlet where the river reaches the south-east edge, at water level 0.
 */

import * as THREE from 'three';
import { Noise2D, clamp, mix, smoothstep } from '../core/noise.js';

/** World extent in metres along both horizontal axes. */
export const WORLD_SIZE = 4096;

/** Half the world extent; world coordinates span [-HALF, +HALF]. */
export const WORLD_HALF = WORLD_SIZE / 2;

/** Heightfield resolution (vertices per side). */
export const GRID_SIZE = 513;

/** Metres between adjacent heightfield samples. */
export const CELL_SIZE = WORLD_SIZE / (GRID_SIZE - 1);

/** Number of mesh chunks per side. */
export const CHUNKS_PER_SIDE = 8;

/** Sea level, in metres. Terrain dips below this in the river and inlet. */
export const WATER_LEVEL = 0;

/** Tunable parameters controlling terrain shape. */
export interface TerrainParams {
  /** Baseline height of the central plains, in metres. */
  plainsHeight: number;
  /** Amplitude of the gentle undulation across the plains, in metres. */
  plainsAmplitude: number;
  /** Spatial frequency of the plains undulation, in cycles per metre. */
  plainsFrequency: number;
  /** Peak additional height of the edge hills, in metres. */
  hillAmplitude: number;
  /** Spatial frequency of the hills, in cycles per metre. */
  hillFrequency: number;
  /** Octaves used for the hill layer. */
  hillOctaves: number;
  /** Amplitude of fine surface detail, in metres. */
  detailAmplitude: number;
  /** Spatial frequency of fine surface detail. */
  detailFrequency: number;
  /** Domain-warp distance applied to the hill layer, in metres. */
  warpAmplitude: number;
  /** Normalized radius at which hills begin to rise (0 = centre, 1 = edge). */
  hillStartRadius: number;
  /** Half-width of the river at its narrowest, in metres. */
  riverHalfWidthMin: number;
  /** Half-width of the river at its widest, in metres. */
  riverHalfWidthMax: number;
  /** River bed depth below sea level, in metres. */
  riverDepth: number;
  /** Width of the graded bank flanking the river channel, in metres. */
  riverBankWidth: number;
  /** Lateral meander amplitude of the river centreline, in metres. */
  riverMeander: number;
  /** Width of the gentle floodplain flanking the river channel, in metres. */
  riverValleyWidth: number;
  /** Elevation the floodplain settles toward, in metres above sea level. */
  riverValleyHeight: number;
  /**
   * How strongly the floodplain overrides the underlying terrain, 0-1. Below 1
   * so hills retain some character where the river cuts through them.
   */
  riverValleyStrength: number;
  /** Depth of the sea inlet floor below sea level, in metres. */
  seaDepth: number;
  /** Width of the graded beach along the sea inlet shoreline, in metres. */
  shoreWidth: number;
  /** Distance along the river axis at which the estuary begins to widen. */
  seaFlareStart: number;
  /** Distance along the river axis at which the estuary reaches full width. */
  seaFlareEnd: number;
  /** Extra half-width the estuary gains at its mouth, in metres. */
  estuaryWidening: number;
  /** Distance along the river axis at which the open sea floor begins. */
  seaFloorStart: number;
  /** Distance along the river axis at which the terrain is fully sea floor. */
  seaFloorEnd: number;
  /** How strongly hills are flattened approaching the coast, 0-1. */
  coastFlattening: number;
}

/** Default terrain parameters, tuned for a pleasant, buildable map. */
export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
  plainsHeight: 14,
  plainsAmplitude: 7,
  plainsFrequency: 0.00035,
  hillAmplitude: 135,
  hillFrequency: 0.0011,
  hillOctaves: 5,
  detailAmplitude: 1.6,
  detailFrequency: 0.006,
  warpAmplitude: 70,
  hillStartRadius: 0.42,
  // The graded bank pushes the waterline out roughly 20m beyond the channel
  // core on each side, so these produce a visible river ~85-135m wide.
  riverHalfWidthMin: 20,
  riverHalfWidthMax: 46,
  riverDepth: 7,
  riverBankWidth: 55,
  riverMeander: 210,
  riverValleyWidth: 300,
  riverValleyHeight: 7,
  riverValleyStrength: 0.9,
  seaDepth: 26,
  shoreWidth: 260,
  seaFlareStart: 1500,
  seaFlareEnd: 2700,
  estuaryWidening: 260,
  seaFloorStart: 1750,
  seaFloorEnd: 2800,
  coastFlattening: 0.9,
};

const SQRT1_2 = Math.SQRT1_2;

/** Palette used for vertex colouring, in linear-ish sRGB hex. */
const COLORS = {
  sand: new THREE.Color(0xd8c8a0),
  grass: new THREE.Color(0x6d8f4c),
  grassDark: new THREE.Color(0x577a41),
  dirt: new THREE.Color(0x8a7254),
  rock: new THREE.Color(0x7c7a73),
  riverbed: new THREE.Color(0x6d6449),
};

export class Terrain {
  /** Group containing every terrain chunk mesh and the water plane. */
  readonly group = new THREE.Group();

  /** Chunk meshes, for raycasting against the ground. */
  readonly chunks: THREE.Mesh[] = [];

  /** The translucent water surface at {@link WATER_LEVEL}. */
  readonly water: THREE.Mesh;

  /** Raw heightfield, row-major, `GRID_SIZE * GRID_SIZE` samples in metres. */
  readonly heights: Float32Array;

  private readonly params: TerrainParams;
  private readonly waterBaseY: Float32Array;
  private waterTime = 0;

  /**
   * @param seed Seed controlling terrain generation.
   * @param params Optional overrides for {@link DEFAULT_TERRAIN_PARAMS}.
   */
  constructor(seed: number | string, params: Partial<TerrainParams> = {}) {
    this.params = { ...DEFAULT_TERRAIN_PARAMS, ...params };
    this.group.name = 'Terrain';

    this.heights = generateHeightfield(seed, this.params);
    this.buildChunks();

    const { mesh, baseY } = buildWater();
    this.water = mesh;
    this.waterBaseY = baseY;
    this.group.add(this.water);
  }

  /**
   * Sample terrain height at a world position using bilinear interpolation.
   * Coordinates outside the world are clamped to the edge.
   *
   * @param x World x in metres.
   * @param z World z in metres.
   * @returns Ground height in metres.
   */
  heightAt(x: number, z: number): number {
    const fx = clamp((x + WORLD_HALF) / CELL_SIZE, 0, GRID_SIZE - 1.0001);
    const fz = clamp((z + WORLD_HALF) / CELL_SIZE, 0, GRID_SIZE - 1.0001);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const h = this.heights;
    const i00 = z0 * GRID_SIZE + x0;
    const h00 = h[i00] as number;
    const h10 = h[i00 + 1] as number;
    const h01 = h[i00 + GRID_SIZE] as number;
    const h11 = h[i00 + GRID_SIZE + 1] as number;
    return mix(mix(h00, h10, tx), mix(h01, h11, tx), tz);
  }

  /**
   * Surface normal at a world position, from central differences on the
   * heightfield.
   */
  normalAt(x: number, z: number): THREE.Vector3 {
    const d = CELL_SIZE;
    const hx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const hz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return new THREE.Vector3(-hx, 2 * d, -hz).normalize();
  }

  /** True when the given world position is at or below sea level. */
  isUnderwater(x: number, z: number): boolean {
    return this.heightAt(x, z) <= WATER_LEVEL;
  }

  /**
   * Advance the water surface animation.
   * @param dt Real seconds since the previous frame.
   */
  update(dt: number): void {
    this.waterTime += dt;
    const geom = this.water.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const t = this.waterTime;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const wave =
        Math.sin(x * 0.012 + t * 0.6) * 0.22 + Math.sin(z * 0.017 - t * 0.45) * 0.18;
      pos.setY(i, (this.waterBaseY[i] as number) + wave);
    }
    pos.needsUpdate = true;
  }

  /** Dispose all GPU resources held by the terrain. */
  dispose(): void {
    for (const chunk of this.chunks) {
      chunk.geometry.dispose();
      (chunk.material as THREE.Material).dispose();
    }
    this.water.geometry.dispose();
    (this.water.material as THREE.Material).dispose();
  }

  private buildChunks(): void {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const quadsPerChunk = (GRID_SIZE - 1) / CHUNKS_PER_SIDE;

    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        const geometry = this.buildChunkGeometry(
          cx * quadsPerChunk,
          cz * quadsPerChunk,
          quadsPerChunk,
        );
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `TerrainChunk_${cx}_${cz}`;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.userData.isTerrain = true;
        this.chunks.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  /**
   * Build one chunk's geometry. Normals are computed from the global
   * heightfield rather than per-chunk, so lighting is continuous across chunk
   * boundaries with no visible seams.
   */
  private buildChunkGeometry(originX: number, originZ: number, quads: number): THREE.BufferGeometry {
    const verts = quads + 1;
    const count = verts * verts;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const indices = new Uint32Array(quads * quads * 6);

    const color = new THREE.Color();

    for (let j = 0; j < verts; j++) {
      for (let i = 0; i < verts; i++) {
        const gi = originX + i;
        const gj = originZ + j;
        const x = gi * CELL_SIZE - WORLD_HALF;
        const z = gj * CELL_SIZE - WORLD_HALF;
        const h = this.heights[gj * GRID_SIZE + gi] as number;
        const vi = (j * verts + i) * 3;

        positions[vi] = x;
        positions[vi + 1] = h;
        positions[vi + 2] = z;

        // Central differences on the global field, clamped at world edges.
        const hL = this.gridHeight(gi - 1, gj);
        const hR = this.gridHeight(gi + 1, gj);
        const hD = this.gridHeight(gi, gj - 1);
        const hU = this.gridHeight(gi, gj + 1);
        let nx = hL - hR;
        let ny = 2 * CELL_SIZE;
        let nz = hD - hU;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        normals[vi] = nx;
        normals[vi + 1] = ny;
        normals[vi + 2] = nz;

        // Slope as 0 (flat) to 1 (vertical), from the normal's up component.
        const slope = 1 - ny;
        surfaceColor(h, slope, x, z, color);
        colors[vi] = color.r;
        colors[vi + 1] = color.g;
        colors[vi + 2] = color.b;
      }
    }

    let k = 0;
    for (let j = 0; j < quads; j++) {
      for (let i = 0; i < quads; i++) {
        const a = j * verts + i;
        const b = a + 1;
        const c = a + verts;
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Heightfield lookup with edge clamping, by grid index. */
  private gridHeight(i: number, j: number): number {
    const ci = clamp(i, 0, GRID_SIZE - 1);
    const cj = clamp(j, 0, GRID_SIZE - 1);
    return this.heights[cj * GRID_SIZE + ci] as number;
  }
}

/**
 * Evaluate the composed terrain height function across the whole grid.
 *
 * Exported so tests and tools can regenerate a field without building meshes.
 */
export function generateHeightfield(
  seed: number | string,
  params: TerrainParams = DEFAULT_TERRAIN_PARAMS,
): Float32Array {
  const baseNoise = new Noise2D(`${seed}:base`);
  const hillNoise = new Noise2D(`${seed}:hills`);
  const warpNoiseA = new Noise2D(`${seed}:warpA`);
  const warpNoiseB = new Noise2D(`${seed}:warpB`);
  const detailNoise = new Noise2D(`${seed}:detail`);
  const riverNoise = new Noise2D(`${seed}:river`);

  const field = new Float32Array(GRID_SIZE * GRID_SIZE);

  for (let j = 0; j < GRID_SIZE; j++) {
    const z = j * CELL_SIZE - WORLD_HALF;
    for (let i = 0; i < GRID_SIZE; i++) {
      const x = i * CELL_SIZE - WORLD_HALF;
      field[j * GRID_SIZE + i] = sampleHeight(x, z, params, {
        baseNoise,
        hillNoise,
        warpNoiseA,
        warpNoiseB,
        detailNoise,
        riverNoise,
      });
    }
  }
  return field;
}

interface NoiseSet {
  baseNoise: Noise2D;
  hillNoise: Noise2D;
  warpNoiseA: Noise2D;
  warpNoiseB: Noise2D;
  detailNoise: Noise2D;
  riverNoise: Noise2D;
}

/**
 * The terrain height function at a single world position.
 *
 * Layers, in order: gentle plains undulation, domain-warped ridged hills masked
 * to the map edges, fine detail, then the river and sea inlet carved on top.
 */
function sampleHeight(x: number, z: number, p: TerrainParams, n: NoiseSet): number {
  // --- Radial mask: flat core, hills toward the edges. ---
  const radius = Math.hypot(x, z) / WORLD_HALF;
  const edgeMask = smoothstep(p.hillStartRadius, 1.15, radius);

  // --- Broad plains undulation. ---
  const plains =
    p.plainsHeight +
    n.baseNoise.fbm(x * p.plainsFrequency, z * p.plainsFrequency, 4, 2.0, 0.5) *
      p.plainsAmplitude;

  // --- Domain-warped ridged hills, only meaningful near the edges. ---
  const warpX =
    n.warpNoiseA.fbm(x * 0.0006, z * 0.0006, 3, 2.0, 0.5) * p.warpAmplitude;
  const warpZ =
    n.warpNoiseB.fbm(x * 0.0006, z * 0.0006, 3, 2.0, 0.5) * p.warpAmplitude;
  const hx = (x + warpX) * p.hillFrequency;
  const hz = (z + warpZ) * p.hillFrequency;
  const ridge = n.hillNoise.ridged(hx, hz, p.hillOctaves, 2.05, 0.48);

  // `along` runs north-west to south-east along the river; `across` is the
  // perpendicular offset. Both are needed before the hills, because the coast
  // suppresses them.
  const along = (x + z) * SQRT1_2;
  const across = (z - x) * SQRT1_2;

  // Flatten the hills into a coastal plain as the land approaches the bay, so
  // no ridge ever runs straight into the sea floor.
  const coastal = smoothstep(p.seaFlareStart, p.seaFloorEnd, along);
  // Bias the ridges so low areas stay genuinely low instead of hovering.
  const hills =
    Math.pow(ridge, 1.6) * p.hillAmplitude * edgeMask * (1 - coastal * p.coastFlattening);

  // --- Fine detail, damped on the plains so building sites stay flat. ---
  const detail =
    n.detailNoise.fbm(x * p.detailFrequency, z * p.detailFrequency, 3, 2.0, 0.5) *
    p.detailAmplitude *
    (0.35 + 0.65 * edgeMask);

  let height = plains + hills + detail;

  // --- River, in a coordinate frame rotated 45 degrees. ---
  const meander =
    n.riverNoise.fbm(along * 0.00055, 0.37, 3, 2.0, 0.5) * p.riverMeander +
    n.riverNoise.fbm(along * 0.0018, 11.7, 2, 2.0, 0.5) * (p.riverMeander * 0.25);
  const widthWobble = n.riverNoise.fbm(along * 0.0012, 31.3, 2, 2.0, 0.5);
  const baseHalfWidth = mix(p.riverHalfWidthMin, p.riverHalfWidthMax, widthWobble * 0.5 + 0.5);

  // --- Sea inlet: an estuary widening into a bay at the south-east edge. ---
  // `along` spans roughly [-2896, 2896]. The estuary widening is kept modest;
  // the open bay is produced by the separate sea-floor blend below rather than
  // by an ever-wider channel, whose boundary would sweep sideways faster than
  // it travels downstream and leave a stepped shoreline.
  const seaMask = smoothstep(p.seaFlareStart, p.seaFlareEnd, along);
  const halfWidth = baseHalfWidth + seaMask * p.estuaryWidening;

  const distToCentre = Math.abs(across - meander);

  // Floodplain: settle the land toward a low, gentle corridor well before the
  // channel itself. Without this the channel would carve a near-vertical gorge
  // wherever it crosses the edge hills.
  const valley = 1 - smoothstep(halfWidth, halfWidth + p.riverValleyWidth, distToCentre);
  const valleyFloor = mix(p.riverValleyHeight, -p.seaDepth * 0.5, seaMask);
  height = mix(height, valleyFloor, valley * p.riverValleyStrength);

  // Channel: carve the water course itself out of the floodplain. The bank
  // widens into a beach as the mouth flares open — the flare grows the channel
  // by ~1.8m for every metre travelled downstream, so a narrow river bank would
  // read as an abrupt step along the shoreline.
  const bankWidth = mix(p.riverBankWidth, p.shoreWidth, seaMask);
  const channel = 1 - smoothstep(halfWidth, halfWidth + bankWidth, distToCentre);
  const bedDepth = mix(-p.riverDepth, -p.seaDepth, seaMask);
  height = mix(height, bedDepth, channel);

  // The open bay: a wide, gentle blend to the sea floor across the whole
  // south-east corner.
  const openSea = smoothstep(p.seaFloorStart, p.seaFloorEnd, along);
  height = mix(height, -p.seaDepth, openSea);

  return height;
}

/**
 * Choose a vertex colour from height and slope: sand near the waterline, grass
 * across the plains, dirt and rock on steep or high ground.
 */
function surfaceColor(
  height: number,
  slope: number,
  x: number,
  z: number,
  out: THREE.Color,
): void {
  // Subtle large-scale variation so the grass does not read as a flat fill.
  const variation = (Math.sin(x * 0.004) + Math.cos(z * 0.0033)) * 0.5;
  const grass = COLORS.grass.clone().lerp(COLORS.grassDark, variation * 0.35 + 0.35);

  if (height < WATER_LEVEL - 1) {
    out.copy(COLORS.riverbed);
    return;
  }

  // Sand band hugging the waterline.
  const sandiness = 1 - smoothstep(1.0, 4.5, height);
  out.copy(grass).lerp(COLORS.sand, sandiness);

  // Dirt on moderate slopes, rock on steep ones.
  const dirtiness = smoothstep(0.06, 0.2, slope);
  out.lerp(COLORS.dirt, dirtiness * 0.85);
  const rockiness = smoothstep(0.22, 0.42, slope);
  out.lerp(COLORS.rock, rockiness * 0.9);

  // High ground trends rocky regardless of slope.
  const altitude = smoothstep(70, 130, height);
  out.lerp(COLORS.rock, altitude * 0.55);
}

/** Build the animated translucent water plane and its rest-height buffer. */
function buildWater(): { mesh: THREE.Mesh; baseY: Float32Array } {
  const segments = 64;
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshPhongMaterial({
    color: 0x2e6f9e,
    transparent: true,
    opacity: 0.78,
    shininess: 90,
    specular: 0x9fd8ff,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Water';
  mesh.position.y = WATER_LEVEL;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;

  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const baseY = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) baseY[i] = pos.getY(i);

  return { mesh, baseY };
}
