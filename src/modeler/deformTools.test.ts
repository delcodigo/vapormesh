import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { AxisDeformTool, MagnetTool, PointDragTool, StretchTool, TAPER_PER_PIXEL } from './deformTools';
import { deformSelection, magnetWeight, type DeformSpec } from './index';
import { box } from './primitives';
import type { DragMove, ViewInfo } from './pointDrag';
import { ModelerState } from './state';

// Face-like view: +X right, +Y up, seen from +Z, 100 px per world unit, canvas origin at the world origin.
const view: ViewInfo = {
  isOrtho: true,
  viewAxis: [0, 0, 1],
  project: ([x, y]) => ({ x: x * 100, y: -y * 100 }),
  unproject: (x, y) => [x / 100, -y / 100, 0],
};
const drag = (dx: number, dy = 0, start = { x: 0, y: 0 }): DragMove => ({
  offset: [dx / 100, -dy / 100, 0],
  start,
  current: { x: start.x + dx, y: start.y + dy },
});
const snapshot = (s: ModelerState): Vec3[] => s.mesh.points.map((p) => [...p] as Vec3);
const near = (a: Vec3, b: Vec3) => a.forEach((c, i) => expect(c).toBeCloseTo(b[i]!, 9));
const top = (s: ModelerState) => s.mesh.points.filter((p) => p[1] > 0);

describe('AxisDeformTool', () => {
  const tool = (s: ModelerState, kind: 'taper' | 'twist' | 'bend') => new AxisDeformTool(s, kind, () => ({ axis: 'y', toward: 'x' }), kind);

  it('tapers by the horizontal drag, in one undo step', () => {
    const s = new ModelerState(box(2, 2, 2));
    const start = snapshot(s);
    const t = tool(s, 'taper');
    expect(t.begin(view)).toBe(true);
    t.move(drag(100)); // amount 0.5
    t.end();
    // the high end (y = +1) is shrunk to a factor 1 - 0.5 = 0.5, the low end is untouched
    top(s).forEach((p) => expect(Math.abs(p[0])).toBeCloseTo(1 - 100 * TAPER_PER_PIXEL, 9));
    s.mesh.points.filter((p) => p[1] < 0).forEach((p) => expect(Math.abs(p[0])).toBeCloseTo(1, 9));
    s.undo();
    expect(snapshot(s)).toEqual(start);
    expect(s.history.canUndo).toBe(false);
  });

  it('twists and bends, and a drag back to the press puts everything back and records nothing', () => {
    for (const kind of ['twist', 'bend'] as const) {
      const s = new ModelerState(box(2, 2, 2));
      const start = snapshot(s);
      const t = tool(s, kind);
      t.begin(view);
      t.move(drag(60));
      expect(snapshot(s)).not.toEqual(start);
      t.move(drag(0));
      t.end();
      expect(snapshot(s)).toEqual(start);
      expect(s.history.canUndo).toBe(false);
    }
  });

  it('acts on the selection only, and cancel restores', () => {
    const s = new ModelerState(box(2, 2, 2));
    const start = snapshot(s);
    s.applyPick(0, 'replace');
    s.applyPick(1, 'toggle');
    const t = tool(s, 'twist');
    t.begin(view);
    t.move(drag(30));
    t.cancel();
    expect(snapshot(s)).toEqual(start);
  });

  it('declines in perspective views', () => {
    expect(tool(new ModelerState(box()), 'bend').begin({ ...view, isOrtho: false })).toBe(false);
  });
});

describe('StretchTool', () => {
  it('scales each screen axis by how far the cursor has moved from the pivot along it', () => {
    const s = new ModelerState(box(2, 2, 2));
    const t = new StretchTool(s);
    expect(t.begin(view)).toBe(true);
    // pressing 100px right of the pivot (the centre) and moving to 200px: x doubles; y unchanged
    t.move(drag(100, 0, { x: 100, y: 100 }));
    t.end();
    s.mesh.points.forEach((p) => {
      expect(Math.abs(p[0])).toBeCloseTo(2, 9);
      expect(Math.abs(p[1])).toBeCloseTo(1, 9);
      expect(Math.abs(p[2])).toBeCloseTo(1, 9);
    });
  });

  it('never flips or collapses the object', () => {
    const s = new ModelerState(box(2, 2, 2));
    const t = new StretchTool(s);
    t.begin(view);
    t.move(drag(-5000, -5000, { x: 100, y: 100 }));
    s.mesh.points.forEach((p) => p.forEach((c) => expect(Number.isFinite(c)).toBe(true)));
    expect(Math.abs(s.mesh.points[0]![0])).toBeGreaterThan(0);
    t.cancel();
  });

  it('maps the axes of a side view: world z runs along the screen x', () => {
    const side: ViewInfo = { ...view, viewAxis: [1, 0, 0], project: ([, y, z]) => ({ x: z * 100, y: -y * 100 }) };
    const s = new ModelerState(box(2, 2, 2));
    const t = new StretchTool(s);
    t.begin(side);
    t.move(drag(100, 0, { x: 100, y: 100 }));
    t.end();
    s.mesh.points.forEach((p) => {
      expect(Math.abs(p[0])).toBeCloseTo(1, 9);
      expect(Math.abs(p[2])).toBeCloseTo(2, 9);
    });
  });
});

describe('PointDragTool', () => {
  it('moves only the point under the press, selected or not', () => {
    const s = new ModelerState(box(2, 2, 2));
    const start = snapshot(s);
    s.applyPick(3, 'replace'); // a different point is selected
    const target = start.findIndex((p) => p[0] > 0 && p[1] > 0 && p[2] > 0);
    const t = new PointDragTool(s);
    // the corner (1,1,*) is at pixel (100,-100); a press within a few pixels grabs it
    expect(t.begin(view, { x: 103, y: -98 })).toBe(true);
    t.move(drag(50));
    t.end();
    const moved = s.mesh.points.flatMap((p, i) => (p.some((c, k) => c !== start[i]![k]) ? [i] : []));
    expect(moved).toHaveLength(1);
    expect(s.mesh.points[moved[0]!]![0]).toBeCloseTo(1.5, 9);
    // of the two corners overlapping on screen it takes the nearer one (+z, towards the viewer)
    expect(s.mesh.points[moved[0]!]![2]).toBeGreaterThan(0);
    expect(moved[0]).toBe(target);
  });

  it('declines when the press is not near a point', () => {
    const s = new ModelerState(box(2, 2, 2));
    expect(new PointDragTool(s).begin(view, { x: 0, y: 0 })).toBe(false);
  });
});

describe('MagnetTool', () => {
  it('pulls the points near the press by the falloff, ignoring depth and the selection', () => {
    const s = new ModelerState(box(2, 2, 2));
    const start = snapshot(s);
    s.applyPick(0, 'replace');
    const t = new MagnetTool(s, () => ({ radius: 1.5 }));
    expect(t.begin(view, { x: 100, y: -100 })).toBe(true); // on the (1,1) corner
    t.move(drag(0, -40)); // up by 0.4
    t.end();
    start.forEach((p, i) => {
      const d = Math.hypot(p[0] - 1, p[1] - 1);
      near(s.mesh.points[i]!, [p[0], p[1] + 0.4 * magnetWeight(d, 1.5), p[2]]);
    });
    // both z layers of that corner moved the same
    expect(s.mesh.points.filter((p) => p[0] === 1 && p[1] > 1)).toHaveLength(2);
  });

  it('declines with no radius or no way to find the press', () => {
    const s = new ModelerState(box());
    expect(new MagnetTool(s, () => ({ radius: 0 })).begin(view, { x: 0, y: 0 })).toBe(false);
    expect(new MagnetTool(s, () => ({ radius: 1 })).begin({ ...view, unproject: undefined }, { x: 0, y: 0 })).toBe(false);
  });
});

describe('deformSelection', () => {
  it('applies typed values as one undoable step and reports it', () => {
    const s = new ModelerState(box(2, 2, 2));
    const start = snapshot(s);
    const r = deformSelection(s, { kind: 'stretch', factors: [2, 1, 1] });
    expect(r).toEqual({ ok: true, message: 'Stretched 8 points' });
    expect(Math.max(...s.mesh.points.map((p) => p[0]))).toBeCloseTo(2, 9);
    s.undo();
    expect(snapshot(s)).toEqual(start);
    s.redo();
    expect(Math.max(...s.mesh.points.map((p) => p[0]))).toBeCloseTo(2, 9);
  });

  it.each<[string, DeformSpec, string]>([
    ['not a number', { kind: 'taper', axis: 'y', amount: NaN }, 'Type a number'],
    ['bend towards its own axis', { kind: 'bend', axis: 'y', toward: 'y', radians: 1 }, 'different axis'],
    ['nothing to change', { kind: 'twist', axis: 'y', radians: 0 }, 'changes nothing'],
    ['stretch by one', { kind: 'stretch', factors: [1, 1, 1] }, 'changes nothing'],
  ])('refuses %s without touching the model', (_name, spec, text) => {
    const s = new ModelerState(box());
    const start = snapshot(s);
    const r = deformSelection(s, spec);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(text);
    expect(snapshot(s)).toEqual(start);
    expect(s.history.canUndo).toBe(false);
  });

  it('refuses when the points have no length along the axis', () => {
    const s = new ModelerState(box(2, 2, 2));
    s.setMode('points');
    s.applyPick(s.mesh.points.findIndex((p) => p[1] > 0), 'replace');
    expect(deformSelection(s, { kind: 'taper', axis: 'y', amount: 0.5 }).message).toContain('no length along Y');
  });
});
