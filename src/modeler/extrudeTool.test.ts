import { describe, expect, it } from 'vitest';
import { cloneGeometry } from './geometry';
import type { DragMove, ViewInfo } from './pointDrag';
import { ExtrudeTool, type ExtrudeToolSettings } from './extrudeTool';
import { box } from './primitives';
import { ModelerState } from './state';

// A Face-like view: +X right, +Y up, seen from +Z.
const view: ViewInfo = { isOrtho: true, viewAxis: [0, 0, 1], project: ([x, y]) => ({ x: x * 100, y: -y * 100 }) };
const drag = (x: number, y: number, z = 0): DragMove => ({ offset: [x, y, z], start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });
const NORMAL: ExtrudeToolSettings = { inset: 0, direction: 'normal' };
const snapshot = (s: ModelerState) => JSON.stringify({ p: s.mesh.points, q: s.mesh.polygons });

function setup(settings: ExtrudeToolSettings = NORMAL, label: 'Extrude' | 'Bevel' = 'Extrude') {
  const s = new ModelerState(box());
  s.setMode('polygons');
  const top = s.mesh.polygons.findIndex((p) => p.points.every((i) => s.mesh.points[i]![1] === 0.5));
  s.applySelection([top], 'replace');
  const tool = new ExtrudeTool(s, () => settings, label);
  return { s, tool, top };
}
const topHeight = (s: ModelerState, top: number) => Math.max(...s.mesh.polygons[top]!.points.map((i) => s.mesh.points[i]![1]));

describe('ExtrudeTool', () => {
  it('only works in orthographic views, and needs polygons to extrude', () => {
    const { tool } = setup();
    expect(tool.begin({ ...view, isOrtho: false })).toBe(false);
    const empty = new ModelerState(box());
    expect(new ExtrudeTool(empty, () => NORMAL, 'Extrude').begin(view)).toBe(false);
  });

  it('declines a selection whose normals cancel out, since there is no direction to drag along', () => {
    const s = new ModelerState(box());
    s.setMode('polygons');
    s.selectAll();
    expect(new ExtrudeTool(s, () => NORMAL, 'Extrude').begin(view)).toBe(false);
    // but along a chosen axis there is one
    expect(new ExtrudeTool(s, () => ({ inset: 0, direction: 'y' }), 'Extrude').begin(view)).toBe(true);
  });

  it('takes the distance from how far the pointer moved along the normal, live, and records one undo step', () => {
    const { s, tool, top } = setup();
    const before = snapshot(s);
    expect(tool.begin(view)).toBe(true);
    tool.move(drag(0, 0.5));
    expect(s.mesh.polygons).toHaveLength(10); // already showing the extrusion
    expect(topHeight(s, top)).toBe(1);
    tool.move(drag(0.7, 1.0, 0.2)); // cumulative from the press; only the part along the normal counts
    expect(topHeight(s, top)).toBe(1.5);
    tool.end();

    expect(s.history.undoLabel).toBe('Extrude');
    expect([...s.selectedPolygons]).toEqual([top]);
    s.undo();
    expect(snapshot(s)).toBe(before);
    expect(s.history.canUndo).toBe(false);
    s.redo();
    expect(topHeight(s, top)).toBe(1.5);
  });

  it('never drifts: coming back to the start shows the original again', () => {
    const { s, tool } = setup();
    const before = snapshot(s);
    tool.begin(view);
    tool.move(drag(0, 2));
    tool.move(drag(0, 0));
    expect(snapshot(s)).toBe(before);
    tool.end();
    expect(s.history.canUndo).toBe(false); // nothing happened, so nothing to undo
  });

  it('a drag across the normal gives a distance of zero and records nothing', () => {
    const { s, tool } = setup();
    tool.begin(view);
    tool.move(drag(1, 0, 1));
    tool.end();
    expect(s.history.canUndo).toBe(false);
    expect(s.mesh.polygons).toHaveLength(6);
  });

  it('pushes inwards when dragged against the normal', () => {
    const { s, tool, top } = setup();
    tool.begin(view);
    tool.move(drag(0, -0.25));
    tool.end();
    expect(topHeight(s, top)).toBe(0.25);
  });

  it('follows the chosen axis instead of the normal', () => {
    const { s, tool, top } = setup({ inset: 0, direction: 'x' });
    tool.begin(view);
    tool.move(drag(0.4, 5)); // only the X part counts
    tool.end();
    expect(Math.min(...s.mesh.polygons[top]!.points.map((i) => s.mesh.points[i]![0]))).toBeCloseTo(-0.1, 9);
    expect(topHeight(s, top)).toBe(0.5); // it did not lift
  });

  it('applies the inset from the options, which is how a bevel works, even at distance zero', () => {
    const { s, tool, top } = setup({ inset: 0.1, direction: 'normal' }, 'Bevel');
    tool.begin(view);
    tool.move(drag(0, 0));
    expect(Math.max(...s.mesh.polygons[top]!.points.map((i) => s.mesh.points[i]![0]))).toBeCloseTo(0.4, 9);
    tool.end();
    expect(s.history.undoLabel).toBe('Bevel');
  });

  it('cancel puts the original geometry back and records nothing', () => {
    const { s, tool } = setup();
    const before = snapshot(s);
    tool.begin(view);
    tool.move(drag(0, 1));
    tool.cancel();
    expect(snapshot(s)).toBe(before);
    expect(s.history.canUndo).toBe(false);
  });

  it('is unaffected by edits made to the geometry it started from', () => {
    const { s, tool } = setup();
    const copy = cloneGeometry(s.mesh);
    tool.begin(view);
    tool.move(drag(0, 1));
    tool.cancel();
    expect(s.mesh.points).toEqual(copy.points);
  });
});
