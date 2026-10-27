import { describe, expect, it } from 'vitest';
import type { Mesh, Vec3 } from '@/core';
import { pickPoint, pickPolygon, pointsInLasso, pointsInRect, polygonsInLasso, type Projector } from '@/render/pick';
import { deleteSelection } from './edit';
import { ExtrudeTool } from './extrudeTool';
import { SizeTool } from './pivotTools';
import { MagnetTool, PointDragTool, StretchTool } from './deformTools';
import { MoveTool } from './moveTool';
import type { DragMove, ViewInfo } from './pointDrag';
import { box } from './primitives';
import {
  connectedPoints,
  connectedPolygons,
  growPoints,
  growPolygons,
  growSelection,
  hideSelection,
  selectConnected,
  shrinkPoints,
  shrinkPolygons,
  shrinkSelection,
  snapOffset,
  snapPointInView,
  snapValue,
  unhideAll,
} from './selectTools';
import { ModelerState } from './state';

/** A strip of three unit squares in the XY plane: points 0-3 along the bottom/top, polygons 0, 1, 2 side by side. */
function strip(): Mesh {
  const m = box(1, 1, 1);
  m.points = [];
  m.polygons = [];
  for (let x = 0; x <= 3; x++) {
    m.addPoint([x, 0, 0]);
    m.addPoint([x, 1, 0]);
  }
  for (let q = 0; q < 3; q++) m.addPolygon([2 * q, 2 * q + 2, 2 * q + 3, 2 * q + 1]);
  return m;
}
/** Two boxes far apart in one layer: points 0-7 and 8-15, polygons 0-5 and 6-11. */
function twoBoxes(): Mesh {
  const m = box(1, 1, 1);
  const far = box(1, 1, 1);
  far.points = far.points.map((p): Vec3 => [p[0] + 10, p[1], p[2]]);
  m.append(far);
  return m;
}
const ids = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe('connected', () => {
  it('finds the whole piece a point or polygon belongs to, and only that piece', () => {
    const m = twoBoxes();
    expect(ids(connectedPoints(m, [0]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ids(connectedPoints(m, [9]))).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(ids(connectedPolygons(m, [7]))).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it('keeps points that no polygon uses as they are', () => {
    const m = strip();
    const loose = m.addPoint([9, 9, 9]);
    expect(ids(connectedPoints(m, [loose]))).toEqual([loose]);
  });

  it('never crosses a hidden polygon', () => {
    const m = strip();
    m.hidden.add(1);
    expect(ids(connectedPolygons(m, [0]))).toEqual([0]);
    expect(ids(connectedPolygons(m, [1]))).toEqual([]); // a hidden polygon is not a place to start from either
  });
});

describe('grow and shrink', () => {
  it('grows polygons by those that touch them and shrinks back', () => {
    const m = strip();
    expect(ids(growPolygons(m, new Set([0])))).toEqual([0, 1]);
    expect(ids(growPolygons(m, new Set([1])))).toEqual([0, 1, 2]);
    expect(ids(shrinkPolygons(m, new Set([0, 1, 2])))).toEqual([0, 1, 2]); // nothing unselected touches them, so there is no outer layer
  });

  it('shrinking a selection that touches an unselected neighbour drops the touching polygons', () => {
    const m = strip();
    expect(ids(shrinkPolygons(m, new Set([0, 1])))).toEqual([0]); // 1 touches 2, which is not selected
  });

  it('grows points to every point of the polygons they are in, and shrinks to the ones inside', () => {
    const m = strip();
    expect(ids(growPoints(m, new Set([0])))).toEqual([0, 1, 2, 3]);
    expect(ids(shrinkPoints(m, new Set([0, 1, 2, 3, 4, 5])))).toEqual([0, 1, 2, 3]); // 4 and 5 share polygon 2 with the unselected 6 and 7, and take them with them
  });

  it('on a closed box, grow selects everything next to a corner and shrink undoes it', () => {
    const m = box(1, 1, 1);
    const corner = growPoints(m, new Set([0]));
    expect(corner.size).toBe(7);
    expect(ids(shrinkPoints(m, corner))).toEqual([0]); // only the original corner has all its neighbours selected
    expect(growPolygons(m, new Set([0])).size).toBe(5); // itself and the four faces around it, not the one opposite
  });
});

describe('selection commands', () => {
  it('select connected extends the selection and says what it did', () => {
    const s = new ModelerState(twoBoxes());
    s.applyPick(0, 'replace');
    const r = selectConnected(s);
    expect(r).toEqual({ ok: true, message: 'Selected 8 points' });
    expect(s.selectedPoints.size).toBe(8);
    s.setMode('polygons');
    s.applyPick(6, 'replace');
    expect(selectConnected(s).message).toBe('Selected 6 polygons');
  });

  it('refuses with nothing selected, and when there is nowhere to grow or shrink', () => {
    const s = new ModelerState(strip());
    expect(selectConnected(s).ok).toBe(false);
    expect(growSelection(s).ok).toBe(false);
    expect(shrinkSelection(s).ok).toBe(false);
    s.selectAll();
    expect(growSelection(s)).toEqual({ ok: false, message: 'The selection cannot grow any further' });
    s.clearSelection();
    s.applyPick(0, 'replace');
    expect(shrinkSelection(s).message).toContain('nothing selected'); // the lone point is all edge
  });

  it('grow then shrink round-trips in polygon mode on a strip', () => {
    const s = new ModelerState(strip());
    s.setMode('polygons');
    s.applyPick(0, 'replace');
    expect(growSelection(s).ok).toBe(true);
    expect(ids(s.selectedPolygons)).toEqual([0, 1]);
    expect(shrinkSelection(s).ok).toBe(true);
    expect(ids(s.selectedPolygons)).toEqual([0]);
  });
});

describe('hide and unhide', () => {
  it('hides the selected polygons and takes them out of the selection', () => {
    const s = new ModelerState(strip());
    s.setMode('polygons');
    s.applyPick(0, 'replace');
    s.applyPick(2, 'toggle');
    expect(hideSelection(s)).toEqual({ ok: true, message: 'Hid 2 polygons' });
    expect(ids(s.mesh.hidden)).toEqual([0, 2]);
    expect(s.selectedPolygons.size).toBe(0);
    expect(unhideAll(s)).toEqual({ ok: true, message: 'Showed 2 polygons' });
    expect(s.mesh.hidden.size).toBe(0);
    expect(unhideAll(s).ok).toBe(false);
  });

  it('in Point mode hides the polygons whose points are all selected', () => {
    const s = new ModelerState(strip());
    [0, 1, 2, 3].forEach((p) => s.applyPick(p, 'toggle'));
    hideSelection(s);
    expect(ids(s.mesh.hidden)).toEqual([0]);
    // points 0 and 1 are used only by the hidden polygon, so they are hidden too; 2 and 3 still belong to polygon 1
    expect(ids(s.mesh.hiddenPoints())).toEqual([0, 1]);
    expect(ids(s.selectedPoints)).toEqual([2, 3]);
  });

  it('hides everything else with Hide Others', () => {
    const s = new ModelerState(strip());
    s.setMode('polygons');
    s.applyPick(1, 'replace');
    expect(hideSelection(s, true).message).toBe('Hid 2 polygons');
    expect(ids(s.mesh.hidden)).toEqual([0, 2]);
    expect(ids(s.selectedPolygons)).toEqual([1]);
    expect(hideSelection(s, true).ok).toBe(false); // nothing else left to hide
  });

  it('refuses with nothing to hide', () => {
    const s = new ModelerState(strip());
    expect(hideSelection(s).ok).toBe(false);
    s.applyPick(0, 'replace'); // a single point makes no whole polygon
    expect(hideSelection(s).ok).toBe(false);
  });

  it('hidden things are left out of select all, invert and whole-object moves', () => {
    const s = new ModelerState(strip());
    s.setMode('polygons');
    s.applyPick(0, 'replace');
    hideSelection(s);
    s.selectAll();
    expect(ids(s.selectedPolygons)).toEqual([1, 2]);
    s.invertSelection();
    expect(s.selectedPolygons.size).toBe(0);
    expect(s.affectedPoints()).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('hidden geometry cannot be picked or box-selected', () => {
    const s = new ModelerState(strip());
    const view: Projector = { project: ([x, y]) => ({ x: x * 100, y: -y * 100, z: 0 }) };
    expect(pickPolygon(s.mesh, view, 50, -50)).toBe(0);
    expect(pickPoint(s.mesh, view, 0, 0)).toBe(0);
    s.setMode('polygons');
    s.applyPick(0, 'replace');
    hideSelection(s);
    expect(pickPolygon(s.mesh, view, 50, -50)).toBeNull();
    expect(pickPoint(s.mesh, view, 0, 0)).toBeNull();
    expect(pointsInRect(s.mesh, view, { x0: -10, y0: -110, x1: 110, y1: 10 })).toEqual([2, 3]);
  });

  it('a structural edit unhides, because polygons are renumbered', () => {
    const s = new ModelerState(strip());
    s.setMode('polygons');
    s.applyPick(0, 'replace');
    hideSelection(s);
    s.applyPick(2, 'replace');
    expect(deleteSelection(s).ok).toBe(true);
    expect(s.mesh.hidden.size).toBe(0);
    s.undo();
    expect(s.mesh.hidden.size).toBe(0);
  });

  it('cutting a layer back (undoing a create) forgets hidden polygons that no longer exist', () => {
    const m = strip();
    const size = m.size();
    m.addPolygon([0, 2, 3, 1]);
    m.hidden.add(3);
    m.hidden.add(0);
    m.truncate(size);
    expect(ids(m.hidden)).toEqual([0]);
  });
});

describe('lasso', () => {
  const view: Projector = { project: ([x, y]) => ({ x: x * 100, y: -y * 100, z: 0 }) };
  // a triangle around the points at x = 0 and x = 1 on the bottom row, but not x = 2
  const around = [
    { x: -50, y: 50 },
    { x: 150, y: 50 },
    { x: 150, y: -50 },
    { x: -50, y: -50 },
  ];

  it('selects the points inside a freehand outline, whatever its shape', () => {
    const m = strip();
    expect(pointsInLasso(m, view, around)).toEqual([0, 2]);
    const triangle = [{ x: -10, y: 10 }, { x: 250, y: 10 }, { x: 125, y: -300 }];
    // the triangle narrows towards its apex above: the left-hand points of the top row fall outside it
    expect(pointsInLasso(m, view, triangle)).toEqual([0, 2, 3, 4, 5]);
  });

  it('selects polygons by their centres, and does nothing for an outline too short to enclose anything', () => {
    const m = strip();
    expect(polygonsInLasso(m, view, [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: -120 }, { x: 0, y: -120 }])).toEqual([0]);
    expect(pointsInLasso(m, view, [{ x: 0, y: 0 }, { x: 5, y: 5 }])).toEqual([]);
  });

  it('skips hidden geometry', () => {
    const m = strip();
    m.hidden.add(0);
    expect(pointsInLasso(m, view, around)).toEqual([2]);
    expect(polygonsInLasso(m, view, [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: -120 }, { x: 0, y: -120 }])).toEqual([]);
  });
});

describe('snapping', () => {
  it('rounds to the nearest grid step and never produces negative zero', () => {
    expect(snapValue(0.37, 0.25)).toBeCloseTo(0.25);
    expect(snapValue(0.38, 0.25)).toBeCloseTo(0.5);
    expect(snapValue(-0.37, 0.25)).toBeCloseTo(-0.25);
    expect(snapValue(1.234, 0)).toBe(1.234);
    expect(Object.is(snapOffset([-0.01, 0, 0], 0.25)[0], 0)).toBe(true);
  });

  it('snaps a point on the axes of the view and leaves its depth', () => {
    expect(snapPointInView([0.37, 0.62, 0.91], 0.25, [0, 0, 1])).toEqual([0.25, 0.5, 0.91]);
    expect(snapPointInView([0.37, 0.62, 0.91], 0.25, [1, 0, 0])).toEqual([0.37, 0.5, 1]);
  });

  const ortho: ViewInfo = {
    isOrtho: true,
    viewAxis: [0, 0, 1],
    project: ([x, y]) => ({ x: x * 100, y: -y * 100 }),
  };
  const drag = (offset: Vec3): DragMove => ({ offset, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });

  it('Move moves in whole grid steps when snapping is on, and freely when off', () => {
    const s = new ModelerState(box(1, 1, 1));
    const start = s.mesh.points.map((p) => [...p]);
    s.setSnap(0.25);
    const t = new MoveTool(s);
    t.begin(ortho);
    t.move(drag([0.37, -0.12, 0]));
    t.end();
    s.mesh.points.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(start[i]![0]! + 0.25);
      expect(p[1]).toBeCloseTo(start[i]![1]!);
    });
    s.setSnap(0);
    t.begin(ortho);
    t.move(drag([0.37, 0, 0]));
    t.end();
    expect(s.mesh.points[0]![0]).toBeCloseTo(start[0]![0]! + 0.25 + 0.37);
  });

  it('Drag lands the point on the grid in the view plane, keeping its depth', () => {
    const s = new ModelerState(box(1, 1, 1));
    s.setSnap(0.25);
    const target = s.mesh.points.findIndex((p) => p[0] > 0 && p[1] > 0 && p[2] > 0);
    const t = new PointDragTool(s);
    expect(t.begin(ortho, { x: 50, y: -50 })).toBe(true);
    t.move(drag([0.13, 0.08, 0]));
    t.end();
    expect(s.mesh.points[target]).toEqual([0.75, 0.5, 0.5]); // 0.5 + 0.13 = 0.63 rounds to 0.75; 0.58 to 0.5; depth stays
  });

  it('setSnap ignores nonsense', () => {
    const s = new ModelerState();
    s.setSnap(-1);
    expect(s.snap).toBe(0);
    s.setSnap(NaN);
    expect(s.snap).toBe(0);
    s.setSnap(0.5);
    expect(s.snap).toBe(0.5);
  });
});

describe('snapping everywhere', () => {
  const view: ViewInfo = { isOrtho: true, viewAxis: [0, 0, 1], project: ([x, y]) => ({ x: x * 100, y: -y * 100 }), unproject: (x, y) => [x / 100, -y / 100, 0] };
  const at = (start: { x: number; y: number }, current: { x: number; y: number }, offset: Vec3 = [0, 0, 0]): DragMove => ({ offset, start, current });

  it('snaps to a tenth of a unit unless told otherwise', () => {
    expect(new ModelerState().snap).toBe(0.1);
  });

  it('snaps the extrude distance to the grid, and snapping off gives the exact distance', () => {
    const s = new ModelerState(box());
    s.setMode('polygons');
    const top = s.mesh.polygons.findIndex((p) => p.points.every((i) => s.mesh.points[i]![1] === 0.5));
    s.applySelection([top], 'replace');
    const tool = new ExtrudeTool(s, () => ({ inset: 0, direction: 'normal' }), 'Extrude');
    const height = () => Math.max(...s.mesh.points.map((p) => p[1]));
    tool.begin(view);
    tool.move(at({ x: 0, y: 0 }, { x: 0, y: 0 }, [0, 0.337, 0]));
    tool.end();
    expect(height()).toBeCloseTo(0.8, 9); // 0.5 + 0.3
    s.undo();
    s.applySelection([top], 'replace');
    s.setSnap(0);
    tool.begin(view);
    tool.move(at({ x: 0, y: 0 }, { x: 0, y: 0 }, [0, 0.337, 0]));
    tool.end();
    expect(height()).toBeCloseTo(0.837, 9);
  });

  it('snaps Size and Stretch to steps of the grid, and never lets them collapse', () => {
    const size = new ModelerState(box(2, 2, 2));
    const t = new SizeTool(size);
    t.begin(view);
    t.move(at({ x: 100, y: 0 }, { x: 123, y: 0 })); // ratio 1.23
    t.end();
    expect(Math.max(...size.mesh.points.map((p) => p[0]))).toBeCloseTo(1.2, 9);

    const stretch = new ModelerState(box(2, 2, 2));
    const st = new StretchTool(stretch);
    st.begin(view);
    st.move(at({ x: 100, y: 100 }, { x: 156, y: 100 })); // x ratio 1.56, y unchanged
    st.end();
    expect(Math.max(...stretch.mesh.points.map((p) => p[0]))).toBeCloseTo(1.6, 9);
    expect(Math.max(...stretch.mesh.points.map((p) => p[1]))).toBeCloseTo(1, 9);

    const squash = new ModelerState(box(2, 2, 2));
    const sq = new StretchTool(squash);
    sq.begin(view);
    sq.move(at({ x: 400, y: 100 }, { x: 16, y: 100 })); // ratio 0.04: would snap to zero
    expect(Math.max(...squash.mesh.points.map((p) => p[0]))).toBeCloseTo(0.1, 9); // one step, not zero
    sq.cancel();
  });

  it('snaps the Magnet pull, like Move', () => {
    const s = new ModelerState(box(2, 2, 2));
    const t = new MagnetTool(s, () => ({ radius: 5 }));
    t.begin(view, { x: 100, y: -100 });
    t.move(at({ x: 0, y: 0 }, { x: 0, y: 0 }, [0.26, 0, 0]));
    t.end();
    // the point under the magnet's centre moved by the snapped 0.3, not 0.26
    expect(Math.max(...s.mesh.points.map((p) => p[0]))).toBeCloseTo(1.3, 9);
  });
});
