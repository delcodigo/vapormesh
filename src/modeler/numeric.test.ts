import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { applyNumeric } from './numeric';
import type { DragMove, ViewInfo } from './pointDrag';
import { RotateTool } from './pivotTools';
import { box } from './primitives';
import { ModelerState } from './state';

const near = (a: Vec3, b: Vec3) => a.forEach((c, i) => expect(c).toBeCloseTo(b[i]!, 9));

describe('applyNumeric', () => {
  it('moves the selection by an exact offset as one undo step', () => {
    const s = new ModelerState(box());
    s.applySelection([0], 'replace');
    expect(applyNumeric(s, { kind: 'move', offset: [1, 2, 3] })).toBe(true);
    near(s.mesh.points[0]!, [0.5, 1.5, 2.5]);
    near(s.mesh.points[1]!, [-0.5, -0.5, 0.5]); // untouched
    s.undo();
    near(s.mesh.points[0]!, [-0.5, -0.5, -0.5]);
    expect(s.history.canUndo).toBe(false);
  });

  it('rotates about the world axes through the pivot, X then Y then Z', () => {
    const s = new ModelerState(box());
    applyNumeric(s, { kind: 'rotate', pivot: [0, 0, 0], degrees: [0, 0, 90] });
    near(s.mesh.points[0]!, [0.5, -0.5, -0.5]); // +90 about Z: (-.5,-.5) -> (.5,-.5)
    s.undo();
    // Order matters: point 4 (.5,-.5,-.5) -> X+90 -> (.5,.5,-.5) -> Z+90 -> (-.5,.5,-.5). Z-then-X would give (.5,.5,.5).
    applyNumeric(s, { kind: 'rotate', pivot: [0, 0, 0], degrees: [90, 0, 90] });
    near(s.mesh.points[4]!, [-0.5, 0.5, -0.5]);
  });

  it('scales per axis about a manual pivot', () => {
    const s = new ModelerState(box());
    applyNumeric(s, { kind: 'size', pivot: [-0.5, -0.5, -0.5], factors: [2, 1, 0.5] });
    near(s.mesh.points[0]!, [-0.5, -0.5, -0.5]); // the pivot itself stays put
    near(s.mesh.points[7]!, [1.5, 0.5, 0]); // (.5,.5,.5): +1 -> 2*1, +1 -> 1, +1 -> 0.5
  });

  it('records nothing when the transform changes nothing', () => {
    const s = new ModelerState(box());
    expect(applyNumeric(s, { kind: 'move', offset: [0, 0, 0] })).toBe(false);
    expect(applyNumeric(s, { kind: 'size', pivot: [0, 0, 0], factors: [1, 1, 1] })).toBe(false);
    expect(s.history.canUndo).toBe(false);
  });
});

describe('manual pivot', () => {
  const view: ViewInfo = { isOrtho: true, viewAxis: [0, 0, 1], project: ([x, y]) => ({ x: x * 100, y: -y * 100 }) };
  const drag = (sx: number, sy: number, cx: number, cy: number): DragMove => ({
    offset: [0, 0, 0],
    start: { x: sx, y: sy },
    current: { x: cx, y: cy },
  });

  it('takes precedence over the centre and is cleared by Center / a new mesh', () => {
    const s = new ModelerState(box());
    expect(s.pivot()).toEqual([0, 0, 0]);
    s.setPivot([5, 0, 0]);
    expect(s.pivot()).toEqual([5, 0, 0]);
    s.setPivot(null);
    expect(s.pivot()).toEqual([0, 0, 0]);
    s.setPivot([1, 1, 1]);
    s.setMesh(box());
    expect(s.customPivot).toBeNull();
  });

  it('is used by the mouse Rotate tool too', () => {
    const s = new ModelerState(box());
    s.setPivot([1, 0, 0]); // screen (100, 0)
    const tool = new RotateTool(s);
    tool.begin(view);
    tool.move(drag(200, 0, 100, -100)); // +90 CCW about the pivot
    // (-.5,-.5,-.5) relative to pivot is (-1.5,-.5): +90 -> (.5,-1.5) -> world (1.5, -1.5)
    near(s.mesh.points[0]!, [1.5, -1.5, -0.5]);
    tool.end();
  });
});
