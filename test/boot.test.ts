/**
 * @vitest-environment jsdom
 *
 * Boot smoke test: constructs every subsystem that does not require a real
 * WebGL context and runs a simulated frame through them. This catches
 * construction-order and wiring faults that typechecking cannot.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core/engine.js';
import { hourOfDay } from '../src/core/time.js';
import { SaveManager } from '../src/core/save.js';
import { Terrain, WORLD_HALF } from '../src/render/terrain.js';
import { Sky } from '../src/render/sky.js';
import { CameraRig } from '../src/render/cameraRig.js';
import { InputManager } from '../src/input/input.js';
import { SelectTool, ToolManager } from '../src/input/tools.js';
import { RoadTool } from '../src/input/roadTool.js';
import { Simulation } from '../src/sim/state.js';
import { RoadRenderer, SURFACE_LIFT } from '../src/render/roadMesh.js';
import { Hud } from '../src/ui/hud.js';

describe('boot', () => {
  let terrain: Terrain;

  beforeAll(() => {
    terrain = new Terrain(20260101);
  });

  it('builds a chunked terrain mesh with a water plane', () => {
    expect(terrain.chunks).toHaveLength(64);
    for (const chunk of terrain.chunks) {
      expect(chunk.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(chunk.geometry.getAttribute('color')).toBeDefined();
      expect(chunk.receiveShadow).toBe(true);
    }
    expect(terrain.water.position.y).toBe(0);
  });

  it('samples heights consistently between the mesh and heightAt', () => {
    // heightAt must agree with the raw field at exact grid points.
    for (const [x, z] of [
      [0, 0],
      [-1000, 500],
      [800, -1600],
    ] as const) {
      expect(terrain.heightAt(x, z)).toBeCloseTo(terrain.heightAt(x, z), 6);
      expect(Number.isFinite(terrain.heightAt(x, z))).toBe(true);
    }
    // Out-of-bounds coordinates clamp rather than returning NaN.
    expect(Number.isFinite(terrain.heightAt(99999, -99999))).toBe(true);
    expect(terrain.heightAt(WORLD_HALF * 4, 0)).toBe(terrain.heightAt(WORLD_HALF, 0));
  });

  it('produces upward-facing normals', () => {
    const n = terrain.normalAt(120, -340);
    expect(n.y).toBeGreaterThan(0);
    expect(n.length()).toBeCloseTo(1, 5);
  });

  it('runs a full frame across every subsystem', () => {
    document.body.innerHTML = '<canvas id="game-canvas"></canvas><div id="ui-root"></div>';
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const uiRoot = document.getElementById('ui-root') as HTMLElement;

    const engine = new Engine();
    const saves = new SaveManager(null);
    const simulation = new Simulation(20260101);
    simulation.registerWith(saves);

    const scene = new THREE.Scene();
    scene.add(terrain.group);
    const sky = new Sky(scene);
    const rig = new CameraRig(terrain, 16 / 9);
    const input = new InputManager(canvas, terrain);
    const tools = new ToolManager();
    tools.register(new SelectTool());
    const hud = new Hud(uiRoot, engine, simulation.state, tools);

    // One simulated frame, mirroring main.ts.
    expect(() => {
      simulation.step(1);
      input.update(rig.camera);
      rig.update(input, 1 / 60);
      tools.pointerMove(input.terrainHit);
      terrain.update(1 / 60);
      sky.update(hourOfDay(simulation.state.tick), rig.target);
      hud.update(rig.getHeight());
      input.endFrame();
    }).not.toThrow();

    // The HUD rendered its panels and picked up state.
    expect(uiRoot.querySelector('.hud-city__name')?.textContent).toBe('Riverbend');
    expect(uiRoot.querySelector('.hud-stat__value--money')?.textContent).toBe('¤ 500,000');
    expect(uiRoot.querySelectorAll('.hud-tool')).toHaveLength(7);

    // The camera sits above its ground target and looks at the world.
    expect(rig.camera.position.y).toBeGreaterThan(rig.target.y);
    expect(rig.getDistance()).toBeGreaterThan(0);

    // The sun casts shadows and the scene has a sky colour.
    expect(sky.sun.castShadow).toBe(true);
    expect(sky.alwaysDay).toBe(true);
    expect(scene.background).toBeInstanceOf(THREE.Color);

    hud.dispose();
    input.dispose();
  });

  it('drives the road tool through the tool manager and drapes the meshes', () => {
    const sim = new Simulation(20260101, { sampler: terrain, bounds: WORLD_HALF });
    const roads = new RoadRenderer(sim.roads, terrain);
    const tools = new ToolManager();
    tools.register(new SelectTool());
    tools.register(new RoadTool({ network: sim.roads, preview: roads, budget: sim.state }));
    expect(tools.setActive('roads')).toBe(true);

    const surface = roads.group.getObjectByName('RoadSurfaces') as THREE.Mesh;
    expect(surface.geometry.getAttribute('position').count).toBe(0);

    // Find a buildable 200m run somewhere on the central plains.
    let start: [number, number] | null = null;
    for (let x = -600; x <= 600 && !start; x += 64) {
      for (let z = -600; z <= 600 && !start; z += 64) {
        if (sim.roads.plan(x, z, x + 200, z).ok) start = [x, z];
      }
    }
    expect(start).not.toBeNull();
    const [sx, sz] = start as [number, number];

    const hit = (x: number, z: number) => ({ x, y: terrain.heightAt(x, z), z });
    tools.pointerMove(hit(sx, sz));
    tools.pointerDown(hit(sx, sz), 0);
    tools.pointerMove(hit(sx + 200, sz));
    tools.pointerDown(hit(sx + 200, sz), 0);
    // Chained: the second click both commits and re-arms from the endpoint.
    tools.pointerDown(hit(sx + 400, sz), 0);

    expect(sim.roads.edges.length).toBeGreaterThanOrEqual(1);
    expect(sim.state.money).toBeLessThan(500000);

    roads.update();
    const positions = surface.geometry.getAttribute('position');
    expect(positions.count).toBeGreaterThan(0);
    // Every road vertex sits just above the ground beneath it.
    for (let i = 0; i < positions.count; i += 7) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      expect(positions.getY(i)).toBeCloseTo(terrain.heightAt(x, z) + SURFACE_LIFT, 4);
    }

    tools.key('Escape');
    tools.setActive('select');
    roads.dispose();
  });

  it('keeps the camera target inside the world when panning hard', () => {
    const rig = new CameraRig(terrain, 16 / 9);
    rig.jumpTo(WORLD_HALF * 2, WORLD_HALF * 2);
    expect(Math.abs(rig.target.x)).toBeLessThanOrEqual(WORLD_HALF);
    expect(Math.abs(rig.target.z)).toBeLessThanOrEqual(WORLD_HALF);
  });

  it('round-trips simulation state through the save manager', () => {
    const saves = new SaveManager(null);
    const sim = new Simulation(777);
    sim.registerWith(saves);
    sim.state.money = 1234;
    sim.state.population = 56;
    sim.step(9);

    const json = saves.saveToString();
    sim.state.money = 0;
    sim.state.population = 0;
    saves.loadFromString(json);

    expect(sim.state.money).toBe(1234);
    expect(sim.state.population).toBe(56);
    expect(sim.state.tick).toBe(9);
    expect(sim.state.cityName).toBe('Riverbend');
  });

  it('runs registered systems in order every tick', () => {
    const sim = new Simulation(1);
    const order: string[] = [];
    sim.addSystem({ id: 'a', step: () => order.push('a') });
    sim.addSystem({ id: 'b', step: () => order.push('b') });
    sim.step(1);
    sim.step(2);
    expect(order).toEqual(['a', 'b', 'a', 'b']);
    expect(sim.systemIds()).toEqual(['a', 'b']);
    expect(sim.state.tick).toBe(2);
    expect(() => sim.addSystem({ id: 'a', step: () => {} })).toThrow(/already has a system/);
  });
});
