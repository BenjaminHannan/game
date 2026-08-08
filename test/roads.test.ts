/**
 * Road graph, placement rules and the road tool's click-chain flow.
 */
import { describe, expect, it } from 'vitest';
import { SaveManager } from '../src/core/save.js';
import { Simulation } from '../src/sim/state.js';
import {
  MAX_SEGMENT_LENGTH,
  MIN_SEGMENT_LENGTH,
  NODE_SNAP_RADIUS,
  ROAD_CLASSES,
  ROAD_GRID,
  RoadNetwork,
  createRoadNetworkData,
  normalizeRoadNetworkData,
  snapToGrid,
  type HeightSampler,
  type RoadNetworkData,
} from '../src/sim/roads.js';
import { RoadTool } from '../src/input/roadTool.js';

/** Ground at a constant elevation. */
function flat(height = 10): HeightSampler {
  return { heightAt: () => height };
}

/** Ground rising steadily along +x, starting well above sea level. */
function ramp(slope: number): HeightSampler {
  return { heightAt: (x: number) => 40 + x * slope };
}

/** A network over a throwaway host object. */
function makeNetwork(sampler: HeightSampler = flat()): RoadNetwork {
  const host: { roads: RoadNetworkData } = { roads: createRoadNetworkData() };
  return new RoadNetwork(host, { sampler });
}

describe('RoadNetwork placement', () => {
  it('starts empty', () => {
    const net = makeNetwork();
    expect(net.nodes).toHaveLength(0);
    expect(net.edges).toHaveLength(0);
    expect(net.totalLength).toBe(0);
  });

  it('places a segment as two nodes and one edge', () => {
    const net = makeNetwork();
    const edge = net.placeSegment(0, 0, 200, 0);

    expect(edge).not.toBeNull();
    expect(net.nodes).toHaveLength(2);
    expect(net.edges).toHaveLength(1);
    expect(edge?.length).toBeCloseTo(200, 6);
    expect(edge?.roadClass).toBe('small');
    expect(net.totalLength).toBeCloseTo(200, 6);

    const from = net.node(edge!.from);
    const to = net.node(edge!.to);
    expect(from).toMatchObject({ x: 0, z: 0, y: 10 });
    expect(to).toMatchObject({ x: 200, z: 0, y: 10 });
    expect(net.edgesAt(edge!.from)).toHaveLength(1);
  });

  it('hands out unique, never-reused ids', () => {
    const net = makeNetwork();
    net.placeSegment(0, 0, 200, 0);
    net.placeSegment(0, 200, 200, 200);
    const ids = [...net.nodes.map((n) => n.id), ...net.edges.map((e) => e.id)];
    expect(new Set(ids).size).toBe(ids.length);

    const removed = net.edges[0]!.id;
    net.removeEdge(removed);
    const next = net.placeSegment(400, 400, 600, 400);
    expect(next!.id).toBeGreaterThan(removed);
  });

  it('snaps loose endpoints to the zoning-cell grid', () => {
    const net = makeNetwork();
    expect(snapToGrid(3)).toBe(0);
    expect(snapToGrid(5)).toBe(ROAD_GRID);

    const edge = net.placeSegment(1.7, -2.9, 203.4, 3.1)!;
    const from = net.node(edge.from)!;
    const to = net.node(edge.to)!;
    for (const value of [from.x, from.z, to.x, to.z]) {
      expect(value % ROAD_GRID).toBe(0);
    }
    expect(from).toMatchObject({ x: 0, z: 0 });
    expect(to).toMatchObject({ x: 200, z: 0 });
  });

  it('reuses an existing node when a new endpoint lands near it', () => {
    const net = makeNetwork();
    const first = net.placeSegment(0, 0, 200, 0)!;
    const endNode = net.node(first.to)!;

    // Start the next segment a few metres off the previous endpoint.
    const second = net.placeSegment(203, 2, 200, 200)!;
    expect(second.from).toBe(endNode.id);
    expect(net.nodes).toHaveLength(3);
    expect(net.edgesAt(endNode.id)).toHaveLength(2);
  });

  it('only reuses nodes inside the snap radius', () => {
    const net = makeNetwork();
    net.placeSegment(0, 0, 200, 0);
    expect(net.nearestNode(200 + NODE_SNAP_RADIUS - 1, 0)).not.toBeNull();
    expect(net.nearestNode(200 + NODE_SNAP_RADIUS + 4, 0)).toBeNull();

    const detached = net.placeSegment(400, 0, 600, 0)!;
    expect(net.nodes).toHaveLength(4);
    expect(net.node(detached.from)!.x).toBe(400);
  });

  it('shares one junction node between crossing runs that meet at a point', () => {
    const net = makeNetwork();
    net.placeSegment(-200, 0, 0, 0);
    net.placeSegment(0, 0, 200, 0);
    net.placeSegment(0, -200, 0, 0);
    net.placeSegment(0, 0, 0, 200);

    const junction = net.nodes.find((n) => n.x === 0 && n.z === 0)!;
    expect(junction).toBeDefined();
    expect(net.edgesAt(junction.id)).toHaveLength(4);
    expect(net.nodes).toHaveLength(5);
    expect(net.edges).toHaveLength(4);
  });

  it('rejects a duplicate segment between the same pair of nodes', () => {
    const net = makeNetwork();
    net.placeSegment(0, 0, 200, 0);
    const plan = net.plan(0, 0, 200, 0);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('duplicate');
    expect(net.placeSegment(0, 0, 200, 0)).toBeNull();
    expect(net.edges).toHaveLength(1);
  });

  it('rejects segments that are too short, too long or degenerate', () => {
    const net = makeNetwork();
    expect(net.plan(0, 0, MIN_SEGMENT_LENGTH - ROAD_GRID, 0).reason).toBe('too-short');
    expect(net.plan(0, 0, 1, 1).reason).toBe('degenerate');
    expect(net.plan(0, 0, MAX_SEGMENT_LENGTH + ROAD_GRID * 2, 0).reason).toBe('too-long');
    expect(net.plan(0, 0, MIN_SEGMENT_LENGTH, 0).ok).toBe(true);
    expect(net.edges).toHaveLength(0);
  });

  it('rejects ground that is too steep and accepts gentle grades', () => {
    const steep = makeNetwork(ramp(0.5));
    const steepPlan = steep.plan(0, 0, 200, 0);
    expect(steepPlan.ok).toBe(false);
    expect(steepPlan.reason).toBe('too-steep');
    expect(steepPlan.grade).toBeCloseTo(0.5, 3);

    // The same run across the slope's contour is flat, so it builds.
    expect(steep.plan(0, 0, 0, 200).ok).toBe(true);

    const gentle = makeNetwork(ramp(0.05));
    expect(gentle.plan(0, 0, 200, 0).ok).toBe(true);
  });

  it('rejects submerged ground anywhere along the segment', () => {
    const net = makeNetwork();
    expect(makeNetwork(flat(-3)).plan(0, 0, 200, 0).reason).toBe('underwater');

    // A dry-ended segment crossing a channel in the middle is still rejected.
    const channel: HeightSampler = { heightAt: (x) => (Math.abs(x - 100) < 20 ? -2 : 12) };
    const crossing = new RoadNetwork({ roads: createRoadNetworkData() }, { sampler: channel });
    expect(crossing.plan(0, 0, 200, 0).reason).toBe('underwater');
    expect(net.plan(0, 0, 200, 0).ok).toBe(true);
  });

  it('rejects endpoints outside the buildable world', () => {
    const net = makeNetwork();
    net.setBounds(2048);
    expect(net.plan(2040, 0, 2440, 0).reason).toBe('out-of-bounds');
    expect(net.plan(1640, 0, 2040, 0).ok).toBe(true);
  });

  it('prices segments from the road class cost per metre', () => {
    const net = makeNetwork();
    const plan = net.plan(0, 0, 200, 0, 'small');
    expect(plan.cost).toBe(200 * ROAD_CLASSES.small.costPerMetre);
    expect(net.plan(0, 0, 200, 0, 'gravel').cost).toBe(
      200 * ROAD_CLASSES.gravel.costPerMetre,
    );
  });

  it('bumps its revision on every mutation', () => {
    const net = makeNetwork();
    const start = net.revision;
    net.placeSegment(0, 0, 200, 0);
    expect(net.revision).toBeGreaterThan(start);

    const afterPlace = net.revision;
    net.plan(0, 200, 200, 200);
    expect(net.revision).toBe(afterPlace);

    net.removeEdge(net.edges[0]!.id);
    expect(net.revision).toBeGreaterThan(afterPlace);
  });

  it('removes an edge and prunes the nodes it orphaned', () => {
    const net = makeNetwork();
    const a = net.placeSegment(0, 0, 200, 0)!;
    net.placeSegment(200, 0, 400, 0);
    expect(net.nodes).toHaveLength(3);

    expect(net.removeEdge(a.id)).toBe(true);
    // The shared junction survives because the second segment still uses it.
    expect(net.nodes.map((n) => n.x).sort((p, q) => p - q)).toEqual([200, 400]);
    expect(net.removeEdge(a.id)).toBe(false);
  });

  it('re-samples node heights when the terrain sampler is attached', () => {
    const net = makeNetwork(flat(10));
    const edge = net.placeSegment(0, 0, 200, 0)!;
    expect(net.node(edge.from)!.y).toBe(10);
    net.setSampler(flat(42));
    expect(net.node(edge.from)!.y).toBe(42);
  });
});

describe('road network serialization', () => {
  it('round-trips through the save manager inside game state', () => {
    const saves = new SaveManager(null);
    const sim = new Simulation(4242, { sampler: flat(12) });
    sim.registerWith(saves);

    sim.roads.placeSegment(0, 0, 200, 0);
    sim.roads.placeSegment(200, 0, 200, 200);
    const before = JSON.parse(JSON.stringify(sim.state.roads)) as RoadNetworkData;
    const json = saves.saveToString();

    sim.roads.clear();
    expect(sim.roads.edges).toHaveLength(0);

    const revision = sim.roads.revision;
    saves.loadFromString(json);

    expect(sim.state.roads).toEqual(before);
    expect(sim.roads.edges).toHaveLength(2);
    expect(sim.roads.nodes).toHaveLength(3);
    expect(sim.roads.totalLength).toBeCloseTo(400, 6);
    // Renderers watch the revision, so a load must invalidate their meshes.
    expect(sim.roads.revision).toBeGreaterThan(revision);

    // Ids continue past the restored ones rather than colliding with them.
    const edge = sim.roads.placeSegment(200, 200, 400, 200)!;
    expect(before.edges.some((e) => e.id === edge.id)).toBe(false);
  });

  it('does not alias the live graph into its snapshot', () => {
    const sim = new Simulation(1, { sampler: flat() });
    sim.roads.placeSegment(0, 0, 200, 0);
    const snapshot = sim.serialize();
    sim.roads.placeSegment(200, 0, 400, 0);
    expect(snapshot.roads.edges).toHaveLength(1);
  });

  it('repairs malformed or legacy save data instead of throwing', () => {
    const empty = normalizeRoadNetworkData(undefined);
    expect(empty).toEqual(createRoadNetworkData());

    const repaired = normalizeRoadNetworkData({
      nextId: 2,
      nodes: [
        { id: 1, x: 0, z: 0, y: 5 },
        { id: 2, x: 100, z: 0, y: 5 },
        { id: 2, x: 999, z: 0, y: 5 }, // duplicate id, dropped
        { id: 3, x: Number.NaN, z: 0, y: 0 }, // not a position, dropped
      ],
      edges: [
        { id: 7, from: 1, to: 2, roadClass: 'small', length: 100 },
        { id: 8, from: 1, to: 99, roadClass: 'small', length: 10 }, // missing node
        { id: 9, from: 1, to: 1, roadClass: 'small', length: 10 }, // self loop
        { id: 10, from: 1, to: 2, roadClass: 'sky-road', length: Number.NaN },
      ],
    });

    expect(repaired.nodes.map((n) => n.id)).toEqual([1, 2]);
    expect(repaired.edges.map((e) => e.id)).toEqual([7, 10]);
    expect(repaired.edges[1]!.roadClass).toBe('small');
    expect(repaired.edges[1]!.length).toBeCloseTo(100, 6);
    // nextId must clear every restored id.
    expect(repaired.nextId).toBe(11);
  });

  it('gives a save written before roads existed an empty network', () => {
    const saves = new SaveManager(null);
    const sim = new Simulation(1, { sampler: flat() });
    sim.registerWith(saves);
    const legacy = JSON.stringify({
      version: 1,
      savedAt: 0,
      data: { sim: { seed: 1, cityName: 'Old Town', money: 10, population: 3, tick: 5 } },
    });

    expect(() => saves.loadFromString(legacy)).not.toThrow();
    expect(sim.state.cityName).toBe('Old Town');
    expect(sim.roads.edges).toHaveLength(0);
    expect(sim.roads.placeSegment(0, 0, 200, 0)).not.toBeNull();
  });
});

describe('RoadTool', () => {
  function makeTool(sampler: HeightSampler = flat(), money = 500000) {
    const net = makeNetwork(sampler);
    const previews: Array<string> = [];
    const budget = { money };
    const tool = new RoadTool({
      network: net,
      budget,
      preview: {
        setPreview: (plan) =>
          previews.push(plan ? `${plan.ok ? 'ok' : plan.reason}` : 'none'),
      },
    });
    tool.activate();
    return { net, tool, previews, budget };
  }

  it('chains segments from each committed endpoint', () => {
    const { net, tool } = makeTool();
    expect(tool.isDrawing).toBe(false);

    tool.click(0, 0);
    expect(tool.isDrawing).toBe(true);
    expect(net.edges).toHaveLength(0);

    const first = tool.click(200, 0);
    expect(first).not.toBeNull();
    expect(tool.isDrawing).toBe(true);
    expect(tool.startPoint).toMatchObject({ x: 200, z: 0, nodeId: first!.to });

    const second = tool.click(200, 200);
    expect(second!.from).toBe(first!.to);
    expect(net.edges).toHaveLength(2);
    expect(net.nodes).toHaveLength(3);
  });

  it('previews the hovered segment and reports why it is rejected', () => {
    const { tool, previews } = makeTool();
    tool.click(0, 0);

    const good = tool.hover(200, 0);
    expect(good?.ok).toBe(true);
    expect(good?.length).toBeCloseTo(200, 6);

    const bad = tool.hover(4, 0);
    expect(bad?.ok).toBe(false);
    expect(bad?.reason).toBe('too-short');
    expect(tool.status.message).toBe('Segment too short');

    tool.hover(null, null);
    expect(tool.plan).toBeNull();
    expect(previews.at(-1)).toBe('none');
  });

  it('leaves the graph untouched when the hovered segment is invalid', () => {
    const { net, tool } = makeTool(ramp(0.5));
    tool.click(0, 0);
    expect(tool.click(200, 0)).toBeNull();
    expect(net.edges).toHaveLength(0);
    // The start point survives so the player can aim somewhere buildable.
    expect(tool.isDrawing).toBe(true);
    expect(tool.click(0, 200)).not.toBeNull();
  });

  it('cancels on Escape and on right-click', () => {
    const { tool } = makeTool();
    tool.click(0, 0);
    tool.onKey('Escape');
    expect(tool.isDrawing).toBe(false);

    tool.onPointerDown({ x: 0, y: 10, z: 0 }, 0);
    expect(tool.isDrawing).toBe(true);
    tool.onPointerDown({ x: 200, y: 10, z: 0 }, 2);
    expect(tool.isDrawing).toBe(false);

    // Cancelling then clicking again starts a fresh run, not a chained one.
    tool.click(400, 400);
    expect(tool.startPoint).toMatchObject({ x: 400, z: 400 });
  });

  it('charges the treasury and refuses segments it cannot afford', () => {
    const { tool, budget, net } = makeTool(flat(), 500);
    tool.click(0, 0);
    tool.click(200, 0);
    expect(budget.money).toBe(500 - 200 * ROAD_CLASSES.small.costPerMetre);

    // 200 m of two-lane road costs 400; only 100 is left.
    const plan = tool.hover(200, 200);
    expect(plan?.ok).toBe(false);
    expect(plan?.reason).toBe('unaffordable');
    expect(tool.click(200, 200)).toBeNull();
    expect(net.edges).toHaveLength(1);
  });

  it('publishes a hint on activation and clears it on deactivation', () => {
    const net = makeNetwork();
    const messages: string[] = [];
    const tool = new RoadTool({ network: net, onStatus: (s) => messages.push(s.message) });

    tool.activate();
    expect(messages.at(-1)).toBe('Click to start a road');
    tool.click(0, 0);
    tool.hover(200, 0);
    expect(messages.at(-1)).toContain('200 m');
    tool.deactivate();
    expect(messages.at(-1)).toBe('');

    // Re-activating republishes, so a HUD that cleared its hint gets it back.
    tool.activate();
    expect(messages.at(-1)).toBe('Click to start a road');
  });

  it('routes pointer events through the Tool interface', () => {
    const { net, tool } = makeTool();
    tool.onPointerDown({ x: 0, y: 10, z: 0 }, 0);
    tool.onPointerMove({ x: 200, y: 10, z: 0 });
    expect(tool.plan?.ok).toBe(true);
    tool.onPointerDown({ x: 200, y: 10, z: 0 }, 0);
    expect(net.edges).toHaveLength(1);

    // Middle-button drags belong to the camera, not the road tool.
    tool.onPointerDown({ x: 400, y: 10, z: 0 }, 1);
    expect(net.edges).toHaveLength(1);

    tool.deactivate();
    expect(tool.isDrawing).toBe(false);
    expect(tool.plan).toBeNull();
  });
});
