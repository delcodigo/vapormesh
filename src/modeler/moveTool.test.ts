import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { box } from './primitives';
import { MoveTool } from './moveTool';
import type { DragMove, ViewInfo } from './pointDrag';
import { ModelerState } from './state';

// A Face-like view: +X right, +Y up, scene seen from +Z, 100px per world unit.
const ortho: ViewInfo = { isOrtho: true, viewAxis: [0, 0, 1], project: ([x, y]) => ({ x: x * 100, y: -y * 100 }) };
const at = (offset: Vec3): DragMove => ({ offset, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });
const snapshot = (s: ModelerState): Vec3[] => s.mesh.points.map((p) => [...p] as Vec3);

describe('MoveTool', () => {
  it('does not claim drags in perspective views', () => {
    expect(new MoveTool(new ModelerState(box())).begin({ ...ortho, isOrtho: false })).toBe(false);
  });

  it('moves only selected points, then undo/redo restores and reapplies', () => {
    const s = new ModelerState(box());
    const start = snapshot(s);
    const tool = new MoveTool(s);
    s.applyPick(0, 'replace');

    expect(tool.begin(ortho)).toBe(true);
    tool.move(at([1, 0, 0]));
    tool.move(at([2, 3, 0])); // cumulative offset, not a delta
    tool.end();

    expect(s.mesh.points[0]).toEqual([start[0]![0] + 2, start[0]![1] + 3, start[0]![2]]);
    expect(s.mesh.points[1]).toEqual(start[1]);

    s.undo();
    expect(snapshot(s)).toEqual(start);
    s.redo();
    expect(s.mesh.points[0]).toEqual([start[0]![0] + 2, start[0]![1] + 3, start[0]![2]]);
  });

  it('moves the points of selected polygons, once each', () => {
    const s = new ModelerState(box());
    const start = snapshot(s);
    s.setMode('polygons');
    s.applyPick(0, 'replace'); // a quad: 4 of the 8 points
    const tool = new MoveTool(s);
    tool.begin(ortho);
    tool.move(at([0, 5, 0]));
    tool.end();
    const movedIds = s.mesh.points.flatMap((p, i) => (p[1] !== start[i]![1] ? [i] : []));
    expect(movedIds).toHaveLength(4);
    expect(movedIds.every((i) => s.mesh.points[i]![1] === start[i]![1] + 5)).toBe(true);
  });

  it('moves the whole object when nothing is selected', () => {
    const s = new ModelerState(box());
    const tool = new MoveTool(s);
    tool.begin(ortho);
    tool.move(at([0, 0, 7]));
    tool.end();
    expect(s.mesh.points.every((p, i) => p[2] === box().points[i]![2] + 7)).toBe(true);
  });

  it('records nothing for a zero-length drag, and a new edit clears redo', () => {
    const s = new ModelerState(box());
    const tool = new MoveTool(s);
    tool.begin(ortho);
    tool.end();
    expect(s.history.canUndo).toBe(false);

    tool.begin(ortho);
    tool.move(at([1, 0, 0]));
    tool.end();
    s.undo();
    expect(s.history.canRedo).toBe(true);
    tool.begin(ortho);
    tool.move(at([0, 1, 0]));
    tool.end();
    expect(s.history.canRedo).toBe(false);
  });
});
