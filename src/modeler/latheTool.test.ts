import { describe, expect, it } from 'vitest';
import { Mesh, type Vec3 } from '@/core';
import type { EditResult, LatheSettings } from './edit';
import { LatheTool } from './latheTool';
import type { DragMove, ViewInfo } from './pointDrag';
import { ModelerState } from './state';

// Face view: +X right, +Y up, looking along -Z; 100 px per unit, canvas origin at the world origin.
const face: ViewInfo = { isOrtho: true, viewAxis: [0, 0, 1], project: ([x, y]) => ({ x: x * 100, y: -y * 100 }), unproject: (x, y) => [x / 100, -y / 100, 0] };
// Top view: looking down -Y, so the screen shows X (right) and Z (down).
const top: ViewInfo = { isOrtho: true, viewAxis: [0, 1, 0], project: ([x, , z]) => ({ x: x * 100, y: z * 100 }), unproject: (x, y) => [x / 100, 0, y / 100] };
const at = (x: number, y: number): DragMove => ({ offset: [0, 0, 0], start: { x, y }, current: { x, y } });

function setup(patch: Partial<LatheSettings> = {}) {
  const m = new Mesh();
  [[1, 0, 0], [1, 1, 0]].forEach((p) => m.addPoint(p as Vec3)); // a profile one unit from the Y axis
  const s = new ModelerState(m);
  s.setSnap(0);
  [0, 1].forEach((i) => s.applyPick(i, 'toggle'));
  const settings: LatheSettings = { axis: 'y', center: [0, 0, 0], sides: 8, degrees: 360, closed: false, ...patch };
  const centers: Vec3[] = [];
  const results: EditResult[] = [];
  const tool = new LatheTool(s, () => settings, (c) => centers.push(c), (r) => results.push(r));
  return { s, tool, centers, results };
}
const maxRadius = (s: ModelerState, about: Vec3) => Math.max(...s.mesh.points.map((p) => Math.hypot(p[0] - about[0], p[2] - about[2])));

describe('LatheTool', () => {
  it('shows the lathe from the first press, with the axis where the pointer is', () => {
    const { s, tool, centers } = setup();
    expect(tool.begin(face, { x: 300, y: 0 })).toBe(true); // axis through x = 3
    expect(s.mesh.polygons).toHaveLength(8);
    expect(centers.at(-1)).toEqual([3, 0, 0]);
    // the profile is 2 units from that axis
    expect(maxRadius(s, [3, 0, 0])).toBeCloseTo(2, 9);
    tool.cancel();
  });

  it('follows the pointer, rebuilding from the original each time, and commits one undo step', () => {
    const { s, tool } = setup();
    tool.begin(face, { x: 300, y: 0 });
    tool.move(at(500, 0));
    tool.move(at(-100, 0)); // axis through x = -1
    expect(s.mesh.points).toHaveLength(2 + 2 * 7); // never accumulates: always the original profile plus one lathe
    expect(maxRadius(s, [-1, 0, 0])).toBeCloseTo(2, 9);
    tool.end();
    expect(s.mesh.polygons).toHaveLength(8);
    expect(s.selectedPolygons.size).toBe(8);
    s.undo();
    expect(s.mesh.polygons).toHaveLength(0);
    expect(s.mesh.points).toHaveLength(2);
    expect([...s.selectedPoints]).toEqual([0, 1]); // the profile is selected again
    expect(s.history.canUndo).toBe(false);
    s.redo();
    expect(s.mesh.polygons).toHaveLength(8);
  });

  it('only sets the directions the view shows: the front view moves a Y axis in X, the top view in X and Z', () => {
    const f = setup({ center: [0, 0, 5] });
    f.tool.begin(face, { x: 200, y: 400 }); // y on screen is world Y, which is along the axis: ignored
    expect(f.centers.at(-1)).toEqual([2, 0, 5]);
    f.tool.cancel();
    const t = setup({ center: [0, 0, 5] });
    t.tool.begin(top, { x: 200, y: 300 });
    expect(t.centers.at(-1)).toEqual([2, 0, 3]);
    t.tool.cancel();
  });

  it('snaps the axis to the grid', () => {
    const { s, tool, centers } = setup();
    s.setSnap(0.5);
    tool.begin(face, { x: 137, y: 0 });
    expect(centers.at(-1)).toEqual([1.5, 0, 0]);
    tool.cancel();
  });

  it('cancel puts the original geometry back', () => {
    const { s, tool } = setup();
    tool.begin(face, { x: 300, y: 0 });
    expect(s.mesh.polygons).toHaveLength(8);
    tool.cancel();
    expect(s.mesh.polygons).toHaveLength(0);
    expect(s.mesh.points).toHaveLength(2);
    expect(s.history.canUndo).toBe(false);
  });

  it('declines, with the reason, when there is no profile or the options are wrong', () => {
    const none = setup();
    none.s.clearSelection();
    expect(none.tool.begin(face, { x: 0, y: 0 })).toBe(false);
    expect(none.results[0]).toEqual({ ok: false, message: 'Select at least two points, in order along the profile' });
    const bad = setup({ sides: 2 });
    expect(bad.tool.begin(face, { x: 0, y: 0 })).toBe(false);
    expect(bad.results[0]!.message).toContain('at least 3');
    expect(bad.s.mesh.polygons).toHaveLength(0);
    expect(setup().tool.begin({ ...face, isOrtho: false }, { x: 0, y: 0 })).toBe(false);
    expect(setup().tool.begin({ ...face, unproject: undefined }, { x: 0, y: 0 })).toBe(false);
  });

  it('a drag that leaves the profile on the axis changes nothing and says why', () => {
    const { s, tool, results } = setup({ axis: 'y' });
    tool.begin(face, { x: 0, y: 0 });
    tool.move(at(100, 0)); // the axis is under the profile (x = 1)
    expect(s.mesh.polygons).toHaveLength(0);
    tool.end();
    expect(results.at(-1)!.ok).toBe(false);
    expect(s.history.canUndo).toBe(false);
  });
});
