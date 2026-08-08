/**
 * Metropolis entry point: constructs every subsystem, wires them together and
 * starts the engine.
 */

import { Engine } from './core/engine.js';
import { hourOfDay } from './core/time.js';
import { SaveManager } from './core/save.js';
import { Renderer } from './render/renderer.js';
import { Terrain } from './render/terrain.js';
import { Sky } from './render/sky.js';
import { CameraRig } from './render/cameraRig.js';
import { InputManager } from './input/input.js';
import { SelectTool, ToolManager } from './input/tools.js';
import { Simulation } from './sim/state.js';
import { Hud } from './ui/hud.js';

/** Seed for this session's world. Fixed for now; later chosen at new-game time. */
const WORLD_SEED = 20260101;

function boot(): void {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error('Metropolis: #game-canvas or #ui-root is missing from the page.');
  }

  // --- Core ---
  const engine = new Engine();
  const saves = new SaveManager();
  const simulation = new Simulation(WORLD_SEED);
  simulation.registerWith(saves);

  // --- World ---
  const renderer = new Renderer(canvas);
  const terrain = new Terrain(WORLD_SEED);
  renderer.scene.add(terrain.group);
  const sky = new Sky(renderer.scene);

  // --- View and input ---
  const rig = new CameraRig(terrain, renderer.aspect);
  rig.jumpTo(-260, -160, 520);
  const input = new InputManager(canvas, terrain);

  const tools = new ToolManager();
  tools.register(new SelectTool());

  // --- UI ---
  const hud = new Hud(uiRoot, engine, simulation.state, tools);

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
    sky.update(hourOfDay(simulation.state.tick), rig.target);

    renderer.render(rig.camera);
    hud.update(rig.getHeight());
    input.endFrame();
  });

  engine.start();

  console.log(
    '%cMetropolis%c — engine foundation online.\n' +
      'WASD / middle-drag pan · right-drag rotate · wheel zoom · Space pause · 1/2/3 speed',
    'font-weight:bold;color:#4da3ff',
    'color:inherit',
  );
}

boot();
