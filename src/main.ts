/**
 * Metropolis entry point: constructs every subsystem, wires them together and
 * starts the engine.
 */

import { Engine } from './core/engine.js';
import { hourOfDay } from './core/time.js';
import { SaveManager } from './core/save.js';
import { Renderer } from './render/renderer.js';
import { Terrain, WORLD_HALF } from './render/terrain.js';
import { Sky } from './render/sky.js';
import { CameraRig } from './render/cameraRig.js';
import { RoadRenderer } from './render/roadMesh.js';
import { ZoneOverlay } from './render/zoneOverlay.js';
import { InputManager } from './input/input.js';
import { SelectTool, ToolManager } from './input/tools.js';
import { RoadTool } from './input/roadTool.js';
import { ZONE_TOOL_MODES, ZoneTool } from './input/zoneTool.js';
import { Simulation, ZoningSystem } from './sim/state.js';
import type { RoadEdgeData, RoadNetwork } from './sim/roads.js';
import {
  ZONE_COLORS,
  cellAt,
  type CellKey,
  type ZonePaint,
  type ZoneType,
  type ZoningState,
} from './sim/zoning.js';
import { Hud } from './ui/hud.js';

/** Seed for this session's world. Fixed for now; later chosen at new-game time. */
const WORLD_SEED = 20260101;

/**
 * Handles hung off `window.metropolis` so automated tests (and the console) can
 * drive the game without synthesising pointer events.
 */
export interface MetropolisDebugApi {
  engine: Engine;
  simulation: Simulation;
  terrain: Terrain;
  saves: SaveManager;
  tools: ToolManager;
  roads: RoadNetwork;
  roadTool: RoadTool;
  zoning: ZoningState;
  zoneTool: ZoneTool;
  zoneOverlay: ZoneOverlay;
  /** Switch the active tool by id, e.g. `'roads'`. */
  selectTool(id: string): boolean;
  /** Place one segment between two raw world positions, snapping both ends. */
  placeRoad(ax: number, az: number, bx: number, bz: number): RoadEdgeData | null;
  /** Place a chain of segments through a list of `[x, z]` world positions. */
  placeRoadPath(points: ReadonlyArray<readonly [number, number]>): RoadEdgeData[];
  /** Choose the zone brush without going through the HUD. */
  setZonePaint(paint: ZonePaint): void;
  /**
   * Drag-paint a straight stroke between two raw world positions, exactly as a
   * pointer drag would (brush, interpolation, fee and truncation all apply).
   * @returns How many cells changed.
   */
  paintZone(x1: number, z1: number, x2: number, z2: number, paint?: ZonePaint): number;
  /** Recompute frontage immediately rather than waiting for the next tick. */
  rebuildZoneCells(): void;
  /** Everything known about the cell under a world position. */
  zoneCellAt(
    x: number,
    z: number,
  ): {
    key: CellKey;
    zone: ZonePaint;
    zonable: boolean;
    road: boolean;
    stranded: boolean;
    frontage: number;
    depth: number;
    facing: number;
  } | null;
  /** Painted cell counts per zone, plus the zonable and zoned totals. */
  zoneCounts(): Record<ZoneType, number> & { zonable: number; zoned: number };
}

declare global {
  interface Window {
    metropolis?: MetropolisDebugApi;
  }
}

function boot(): void {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error('Metropolis: #game-canvas or #ui-root is missing from the page.');
  }

  // --- Core ---
  const engine = new Engine();
  const saves = new SaveManager();
  const simulation = new Simulation(WORLD_SEED, { bounds: WORLD_HALF });
  simulation.registerWith(saves);

  // --- World ---
  const renderer = new Renderer(canvas);
  const terrain = new Terrain(WORLD_SEED);
  renderer.scene.add(terrain.group);
  const sky = new Sky(renderer.scene);

  // Roads validate against, and are draped over, the generated terrain.
  simulation.roads.setSampler(terrain);
  const roadRenderer = new RoadRenderer(simulation.roads, terrain);
  renderer.scene.add(roadRenderer.group);

  // Zone cells are derived from the road graph, so they rebuild on the tick
  // after any road edit rather than on the frame the player clicked.
  const zoning = simulation.zoning;
  simulation.addSystem(new ZoningSystem(zoning));
  const zoneOverlay = new ZoneOverlay(zoning, terrain);
  renderer.scene.add(zoneOverlay.group);

  // --- View and input ---
  const rig = new CameraRig(terrain, renderer.aspect);
  rig.jumpTo(-260, -160, 520);
  const input = new InputManager(canvas, terrain);

  const tools = new ToolManager();
  tools.register(new SelectTool());

  // --- UI ---
  const hud = new Hud(uiRoot, engine, simulation.state, tools);

  const roadTool = new RoadTool({
    network: simulation.roads,
    preview: roadRenderer,
    budget: simulation.state,
    onStatus: (status) => {
      hud.setHint(status.message || null, status.plan !== null && !status.plan.ok);
    },
  });
  tools.register(roadTool);

  const zoneTool = new ZoneTool({
    zoning,
    preview: zoneOverlay,
    budget: simulation.state,
    onStatus: (status) => {
      hud.setHint(status.message || null, status.cells === 0 && status.painting);
    },
  });
  tools.register(zoneTool);

  // The zone tool's four brushes ride in the HUD's tool-options row, shown only
  // while the "Zones" toolbar entry is active.
  hud.registerToolModes(
    'zones',
    ZONE_TOOL_MODES.map((mode) => ({
      id: mode.paint,
      label: mode.label,
      color: mode.paint === 'none' ? undefined : ZONE_COLORS[mode.paint],
      onSelect: () => {
        tools.setActive('zones');
        zoneTool.setPaint(mode.paint);
      },
    })),
    zoneTool.paint,
  );

  // The faint tint over unpainted-but-zonable cells is a zone-tool affordance,
  // so it follows the tool rather than being always on.
  const syncOverlayMode = (): void => {
    zoneOverlay.setShowEmptyCells(tools.current?.id === 'zones');
  };

  // Route world pointer events to the active tool. The HUD sits in its own
  // overlay, so anything reaching the canvas is a world interaction.
  canvas.addEventListener('pointerdown', (e) => {
    tools.pointerDown(input.terrainHit, e.button);
  });
  canvas.addEventListener('pointerup', (e) => {
    tools.pointerUp(input.terrainHit, e.button);
  });
  window.addEventListener('keydown', (e) => {
    tools.key(e.code);
  });

  window.addEventListener('resize', () => {
    rig.setAspect(renderer.aspect);
  });

  // --- Simulation: one fixed step per tick ---
  engine.onTick((tick) => {
    simulation.step(tick);
  });

  // --- Rendering: once per display frame ---
  engine.onFrame((_alpha, dt) => {
    input.update(rig.camera);
    rig.update(input, dt);
    tools.pointerMove(input.terrainHit);

    terrain.update(dt);
    roadRenderer.update();
    syncOverlayMode();
    zoneOverlay.update();
    sky.update(hourOfDay(simulation.state.tick), rig.target);

    renderer.render(rig.camera);
    hud.update(rig.getHeight());
    input.endFrame();
  });

  engine.start();

  window.metropolis = {
    engine,
    simulation,
    terrain,
    saves,
    tools,
    roads: simulation.roads,
    roadTool,
    zoning,
    zoneTool,
    zoneOverlay,
    selectTool: (id) => tools.setActive(id),
    placeRoad: (ax, az, bx, bz) => simulation.roads.placeSegment(ax, az, bx, bz),
    placeRoadPath: (points) => {
      const built: RoadEdgeData[] = [];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1] as readonly [number, number];
        const b = points[i] as readonly [number, number];
        const edge = simulation.roads.placeSegment(a[0], a[1], b[0], b[1]);
        if (edge) built.push(edge);
      }
      return built;
    },
    setZonePaint: (paint) => {
      zoneTool.setPaint(paint);
      hud.setToolMode('zones', paint);
    },
    paintZone: (x1, z1, x2, z2, paint) => {
      // Frontage must be current before the stroke: a road placed in the same
      // frame has not been through a tick yet.
      zoning.rebuildIfStale();
      const changed = zoneTool.paintStroke(x1, z1, x2, z2, paint);
      hud.setToolMode('zones', zoneTool.paint);
      return changed;
    },
    rebuildZoneCells: () => {
      zoning.rebuildFrontage();
    },
    zoneCellAt: (x, z) => {
      const key = cellAt(x, z);
      if (key < 0) return null;
      return {
        key,
        zone: zoning.zoneAt(key),
        zonable: zoning.isZonable(key),
        road: zoning.isRoadCell(key),
        stranded: zoning.isStranded(key),
        frontage: zoning.frontage[key] as number,
        depth: zoning.depth[key] as number,
        facing: zoning.facing[key] as number,
      };
    },
    zoneCounts: () => zoning.counts(),
  };

  console.log(
    '%cMetropolis%c — roads and zoning online.\n' +
      'WASD / middle-drag pan · right-drag rotate · wheel zoom · Space pause · 1/2/3 speed\n' +
      'Roads tool: click to start, click to chain segments, Esc or right-click to cancel\n' +
      'Zones tool: drag to paint, pick De-zone to erase, [ and ] resize the brush',
    'font-weight:bold;color:#4da3ff',
    'color:inherit',
  );
}

boot();
