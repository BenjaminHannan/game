/**
 * Metropolis entry point: constructs every subsystem, wires them together and
 * starts the engine.
 */

import { Engine } from './core/engine.js';
import { hourOfDay } from './core/time.js';
import { SaveManager } from './core/save.js';
import { EventBus } from './core/events.js';
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
import { BuildingRenderer } from './render/buildingMesh.js';
import { VehicleRenderer } from './render/vehicles.js';
import { TrafficSystem } from './sim/traffic.js';
import { Simulation, ZoningSystem } from './sim/state.js';
import { DemandSystem, type CityTotals, type DemandState } from './sim/demand.js';
import { GrowthSystem } from './sim/growth.js';
import {
  EconomySystem,
  roadRefund,
  type CityLedger,
  type EconomySettledEvent,
  type LedgerTotals,
} from './sim/economy.js';
import type { BuildingData, BuildingStore } from './sim/buildings.js';
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
  buildings: BuildingStore;
  buildingRenderer: BuildingRenderer;
  demandSystem: DemandSystem;
  growthSystem: GrowthSystem;
  economySystem: EconomySystem;
  ledger: CityLedger;
  trafficSystem: TrafficSystem;
  vehicleRenderer: VehicleRenderer;
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
  /**
   * Run growth passes immediately rather than waiting for the tick schedule.
   * @param passes How many growth passes to run.
   * @returns How many buildings were created in total.
   */
  growBuildings(passes?: number): number;
  /**
   * Override the RCI demand the growth tick reads, for scripted tests. Values
   * are clamped to `[-1, 1]`. Omit to hand control back to the demand system.
   */
  setDemand(demand: Partial<DemandState> | null): void;
  /** The live demand scalars. */
  demand(): Readonly<DemandState>;
  /** Summary of the grown city: counts, capacity and occupancy. */
  buildingStats(): {
    total: number;
    residential: number;
    commercial: number;
    industrial: number;
    capacity: number;
    occupancy: number;
    population: number;
    pendingDemolitions: number;
    drawCalls: number;
    instances: number;
  };
  /** The building standing on the cell at a world position, or `null`. */
  buildingAt(x: number, z: number): BuildingData | null;

  // --- Economy ---------------------------------------------------------
  /** Citywide aggregates from the last daily recount. */
  cityTotals(): Readonly<CityTotals>;
  /** Treasury, tax rates, the running month and the last settled one. */
  economy(): {
    money: number;
    broke: boolean;
    taxRates: Readonly<Record<ZoneType, number>>;
    month: Readonly<LedgerTotals>;
    lastMonth: Readonly<LedgerTotals>;
    lastNet: number;
    monthsSettled: number;
    projectedTax: number;
    projectedUpkeep: number;
    roadLength: number;
  };
  /** Set one zone's tax rate, clamped to `[0, 0.30]`. */
  setTaxRate(zone: ZoneType, rate: number): void;
  /**
   * Settle a month immediately rather than waiting for the month boundary.
   * @returns The month that was closed.
   */
  settleMonth(): EconomySettledEvent;
  /**
   * Overwrite the treasury directly. Test-only: it is the one call that bypasses
   * the ledger, and it exists so a scripted run can reach the broke state
   * without laying 250 km of road first.
   */
  setMoney(amount: number): void;
  /** Bulldoze one road segment, crediting the configured refund fraction. */
  demolishRoad(edgeId: number): boolean;
  /** Advance the simulation by N ticks without waiting on real time. */
  runTicks(count: number): number;
  /** The most recent `'economy:settled'` payload, or `null`. */
  lastSettlement(): EconomySettledEvent | null;

  // --- Traffic ---------------------------------------------------------
  /**
   * Run one traffic assignment immediately rather than waiting for the next
   * in-game day, then report the citywide figures.
   */
  assignTraffic(): {
    edges: number;
    totalFlow: number;
    maxFlow: number;
    maxCongestion: number;
    worstEdgeId: number;
    revision: number;
  };
  /** Citywide traffic figures without forcing a pass. */
  traffic(): {
    edges: number;
    totalFlow: number;
    maxFlow: number;
    maxCongestion: number;
    worstEdgeId: number;
    revision: number;
    trafficView: boolean;
  };
  /**
   * Everything the info view needs about one road segment: the assigned volume,
   * the capacity it is measured against, and the flow ratio driving the tint.
   */
  edgeTraffic(edgeId: number): {
    edgeId: number;
    flow: number;
    capacity: number;
    congestion: number;
    speed: number;
    freeSpeed: number;
    travelTime: number;
  } | null;
  /** Per-edge flow ratios, in edge-id order — the info view's whole payload. */
  congestionMap(): Array<{ edgeId: number; flow: number; congestion: number }>;
  /** Turn the congestion overlay on or off. Returns the new state. */
  setTrafficView(enabled: boolean): boolean;
  /** Live vehicle pool figures. */
  vehicleStats(): {
    count: number;
    target: number;
    capacity: number;
    drawCalls: number;
    visible: boolean;
  };
  /** Show or hide the decorative vehicles. Returns the new state. */
  setVehiclesVisible(visible: boolean): boolean;
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

  // Growth reads demand through the DemandSource seam and nothing else, so the
  // economy milestone can replace the model underneath it. `demandOverride`
  // exists purely so a scripted test can pin the bars.
  const demandSystem = new DemandSystem(
    simulation.buildings,
    simulation.state,
    undefined,
    simulation.state,
  );
  let demandOverride: DemandState | null = null;
  const growthSystem = new GrowthSystem({
    zoning,
    buildings: simulation.buildings,
    demand: {
      get demand(): Readonly<DemandState> {
        return demandOverride ?? demandSystem.demand;
      },
    },
    roads: simulation.roads,
    treasury: simulation.state,
    seed: WORLD_SEED,
  });

  // The economy announces its monthly settlement on the bus rather than being
  // polled: simulation.md §6 reserves the event stream for discrete occurrences
  // (a settled month, a rejected payment) and leaves per-frame counters pull-
  // based. The future budget panel and any tutorial hook subscribe here.
  const bus = new EventBus<{ 'economy:settled': EconomySettledEvent }>();
  let lastSettlement: EconomySettledEvent | null = null;
  bus.on('economy:settled', (payload) => {
    lastSettlement = payload;
  });
  const economySystem = new EconomySystem({
    ledger: simulation.ledger,
    buildings: simulation.buildings,
    roads: simulation.roads,
    events: bus,
  });

  // Order matters and is explicit (guardrail 6): zoning derives cells, demand
  // recounts the city, growth spends the result, and the economy settles what
  // that city earned and owes. Each declares its own cadence, so the dispatcher
  // calls demand once a day and the economy once a month.
  // Traffic assigns flow from settled building occupancy, so it is registered
  // after demand and growth. It is a daily system and owns no persistent state:
  // flow is derived from the buildings and the graph, so a save carries no
  // traffic branch at all (traffic.md §2).
  const trafficSystem = new TrafficSystem({
    roads: simulation.roads,
    buildings: simulation.buildings,
    zoning,
    worldHalf: WORLD_HALF,
  });

  simulation.addSystem(demandSystem);
  simulation.addSystem(growthSystem);
  simulation.addSystem(economySystem);
  simulation.addSystem(trafficSystem);

  const buildingRenderer = new BuildingRenderer(simulation.buildings, terrain);
  renderer.scene.add(buildingRenderer.group);

  // Vehicles are decoration: they read the flow field and write nothing back,
  // and they run on the frame callback rather than the tick.
  const vehicleRenderer = new VehicleRenderer({ traffic: trafficSystem });
  renderer.scene.add(vehicleRenderer.group);

  /** Citywide traffic figures, shared by the two debug entry points. */
  const trafficSummary = (): {
    edges: number;
    totalFlow: number;
    maxFlow: number;
    maxCongestion: number;
    worstEdgeId: number;
    revision: number;
  } => {
    const worst = trafficSystem.worstEdge();
    return {
      edges: trafficSystem.topology.slotCount,
      totalFlow: trafficSystem.totalFlow,
      maxFlow: worst ? worst.flow : 0,
      maxCongestion: worst ? worst.congestion : 0,
      worstEdgeId: worst ? worst.edgeId : -1,
      revision: trafficSystem.revision,
    };
  };

  // --- View and input ---
  const rig = new CameraRig(terrain, renderer.aspect);
  rig.jumpTo(-260, -160, 520);
  const input = new InputManager(canvas, terrain);

  const tools = new ToolManager();
  tools.register(new SelectTool());

  // --- UI ---
  const hud = new Hud(uiRoot, engine, simulation.state, tools, {
    totals: () => demandSystem.totals,
  });

  const roadTool = new RoadTool({
    network: simulation.roads,
    preview: roadRenderer,
    budget: simulation.ledger,
    onStatus: (status) => {
      hud.setHint(status.message || null, status.plan !== null && !status.plan.ok);
    },
  });
  tools.register(roadTool);

  const zoneTool = new ZoneTool({
    zoning,
    preview: zoneOverlay,
    budget: simulation.ledger,
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
    buildingRenderer.update(simulation.state.tick);
    // One integer compare on all but the one frame per in-game day where the
    // assignment moved.
    roadRenderer.updateCongestion(trafficSystem);
    vehicleRenderer.update(
      dt * engine.getSpeed(),
      rig.target.x,
      rig.target.z,
      rig.getHeight(),
    );
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
    buildings: simulation.buildings,
    buildingRenderer,
    demandSystem,
    growthSystem,
    growBuildings: (passes = 1) => {
      let grown = 0;
      for (let i = 0; i < Math.max(0, Math.floor(passes)); i++) {
        grown += growthSystem.growthTick(simulation.state.tick);
      }
      return grown;
    },
    setDemand: (demand) => {
      demandOverride = demand
        ? { r: demand.r ?? 0, c: demand.c ?? 0, i: demand.i ?? 0 }
        : null;
    },
    demand: () => demandOverride ?? demandSystem.demand,
    buildingStats: () => {
      const totals = demandSystem.totals;
      let capacity = 0;
      let filled = 0;
      for (const b of simulation.buildings.items) {
        capacity += b.capacity;
        filled += b.capacity * b.occupancy;
      }
      return {
        total: simulation.buildings.count,
        residential: totals.buildingsResidential,
        commercial: totals.buildingsCommercial,
        industrial: totals.buildingsIndustrial,
        capacity,
        occupancy: capacity > 0 ? filled / capacity : 0,
        population: simulation.state.population,
        pendingDemolitions: growthSystem.pendingDemolitions,
        drawCalls: buildingRenderer.drawCalls,
        instances: buildingRenderer.instanceCount,
      };
    },
    buildingAt: (x, z) => {
      const id = zoning.occupantAt(cellAt(x, z));
      return id < 0 ? null : simulation.buildings.get(id);
    },

    economySystem,
    ledger: simulation.ledger,
    cityTotals: () => demandSystem.totals,
    economy: () => {
      const economy = simulation.state.economy;
      return {
        money: simulation.state.money,
        broke: simulation.ledger.broke,
        taxRates: economy.taxRates,
        month: economy.month,
        lastMonth: economy.lastMonth,
        lastNet: economy.lastNet,
        monthsSettled: economy.monthsSettled,
        projectedTax: economySystem.projectedTax(),
        projectedUpkeep: economySystem.projectedUpkeep(),
        roadLength: simulation.roads.totalLength,
      };
    },
    setTaxRate: (zone, rate) => simulation.ledger.setTaxRate(zone, rate),
    settleMonth: () => economySystem.settle(simulation.state, simulation.state.tick),
    setMoney: (amount) => {
      simulation.state.money = Number.isFinite(amount) ? amount : 0;
    },
    demolishRoad: (edgeId) => {
      const edge = simulation.roads.edge(edgeId);
      if (!edge) return false;
      const refund = roadRefund(edge);
      if (!simulation.roads.removeEdge(edgeId)) return false;
      simulation.ledger.earn(refund, 'refund');
      return true;
    },
    runTicks: (count) => engine.advanceTicks(count),
    lastSettlement: () => lastSettlement,

    trafficSystem,
    vehicleRenderer,
    assignTraffic: () => {
      // Frontage must be current: a road placed in the same frame has not been
      // through a tick yet, so its buildings would have no edge to load onto.
      zoning.rebuildIfStale();
      trafficSystem.assign();
      return trafficSummary();
    },
    traffic: () => ({ ...trafficSummary(), trafficView: roadRenderer.trafficViewEnabled }),
    edgeTraffic: (edgeId) => {
      const topology = trafficSystem.topology;
      const slot = topology.slotOf.get(edgeId);
      if (slot === undefined) return null;
      return {
        edgeId,
        flow: trafficSystem.flowOf(edgeId),
        capacity: trafficSystem.capacityOf(edgeId),
        congestion: trafficSystem.congestionOf(edgeId),
        speed: trafficSystem.speedOf(edgeId),
        freeSpeed: topology.freeSpeed[slot] as number,
        travelTime: trafficSystem.travelTimeOf(edgeId),
      };
    },
    congestionMap: () => {
      const topology = trafficSystem.topology;
      const out: Array<{ edgeId: number; flow: number; congestion: number }> = [];
      for (let e = 0; e < topology.slotCount; e++) {
        out.push({
          edgeId: topology.edgeId[e] as number,
          flow: trafficSystem.state.flow[e] as number,
          congestion: trafficSystem.state.congestion[e] as number,
        });
      }
      return out;
    },
    setTrafficView: (enabled) => {
      roadRenderer.setTrafficView(enabled);
      return roadRenderer.trafficViewEnabled;
    },
    vehicleStats: () => ({
      count: vehicleRenderer.count,
      target: vehicleRenderer.target,
      capacity: vehicleRenderer.pool.capacity,
      drawCalls: vehicleRenderer.drawCalls,
      visible: vehicleRenderer.visible,
    }),
    setVehiclesVisible: (visible) => {
      vehicleRenderer.setVisible(visible);
      return vehicleRenderer.visible;
    },
  };

  console.log(
    '%cMetropolis%c — roads, zoning, growth, economy and traffic online.\n' +
      'WASD / middle-drag pan · right-drag rotate · wheel zoom · Space pause · 1/2/3 speed\n' +
      'Roads tool: click to start, click to chain segments, Esc or right-click to cancel\n' +
      'Zones tool: drag to paint, pick De-zone to erase, [ and ] resize the brush',
    'font-weight:bold;color:#4da3ff',
    'color:inherit',
  );
}

boot();
