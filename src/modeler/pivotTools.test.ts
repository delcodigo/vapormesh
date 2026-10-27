import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { box } from './primitives';
import type { DragMove, ViewInfo } from './pointDrag';
import { RotateTool, SizeTool } from './pivotTools';
import { ModelerState } from './state';

// Face-like view: +X right, +Y up, seen from +Z, 100px per world unit, origin at screen (0, 0).
const view: ViewInfo = { isOrtho: true, viewAxis: [0, 0, 1], project: ([x, y]) => ({ x: x * 100, y: -y * 100 }) };
const drag = (sx: number, sy: number, cx: number, cy: number): DragMove => ({
  offset: [0, 0, 0],
  start: { x: sx, y: sy },
  current: { x: cx, y: cy },
});
const near = (a: Vec3, b: Vec3) => a.forEach((c, i) => expect(c).toBeCloseTo(b[i]!, 9));

describe('RotateTool', () => {
  it('rotates counter-clockwise on screen about the view axis, around the bbox centre', () => {
    const s = new ModelerState(box()); // centred on the origin
    const tool = new RotateTool(s);
    expect(tool.begin(view)).toBe(true);
    // Sweep from screen-right to screen-up: +90 degrees CCW, i.e. +X -> +Y.
    tool.move(drag(100, 0, 0, -100));
    near(s.mesh.points[0]!, [0.5, -0.5, -0.5]); // was (-0.5, -0.5, -0.5)
    tool.end();
    s.undo();
    near(s.mesh.points[0]!, [-0.5, -0.5, -0.5]);
  });

  it('keeps the marker pivot fixed during the drag and releases it afterwards', () => {
    const s = new ModelerState(box());
    s.applySelection([0], 'replace');
    const tool = new RotateTool(s);
    tool.begin(view);
    tool.move(drag(100, 0, 0, -100));
    expect(s.dragPivot).toEqual([-0.5, -0.5, -0.5]);
    tool.end();
    expect(s.dragPivot).toBeNull();
  });

  it('cancel puts the points back and records nothing', () => {
    const s = new ModelerState(box());
    const tool = new RotateTool(s);
    tool.begin(view);
    tool.move(drag(100, 0, 0, -100));
    tool.cancel();
    near(s.mesh.points[0]!, [-0.5, -0.5, -0.5]);
    expect(s.history.canUndo).toBe(false);
  });
});

describe('SizeTool', () => {
  it('scales by the ratio of cursor distances from the pivot', () => {
    const s = new ModelerState(box());
    const tool = new SizeTool(s);
    tool.begin(view);
    tool.move(drag(100, 0, 200, 0));
    near(s.mesh.points[0]!, [-1, -1, -1]);
    tool.end();
    s.undo();
    near(s.mesh.points[0]!, [-0.5, -0.5, -0.5]);
  });

  it('does not blow up when the press is on the pivot', () => {
    const s = new ModelerState(box());
    const tool = new SizeTool(s);
    tool.begin(view);
    tool.move(drag(0, 0, 16, 0)); // radius clamps to 16px on both ends -> factor 1
    near(s.mesh.points[0]!, [-0.5, -0.5, -0.5]);
  });

  it('scales only the selection, about the selection centre', () => {
    const s = new ModelerState(box());
    s.applySelection([0, 4], 'replace'); // two points sharing y,z; centre is (0, -0.5, -0.5)
    const tool = new SizeTool(s);
    tool.begin(view);
    tool.move(drag(100, 50, 300, 50)); // the pivot projects to screen (0, 50): radii 100 -> 300
    near(s.mesh.points[0]!, [-1.5, -0.5, -0.5]);
    near(s.mesh.points[1]!, [-0.5, -0.5, 0.5]); // untouched
  });
});
