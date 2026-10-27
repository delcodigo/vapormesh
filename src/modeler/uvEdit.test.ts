import { describe, expect, it } from 'vitest';
import { Mesh, type UV } from '@/core';
import { cornerKey, cornersInRect, pickCorner, snapUv, SNAP_ANGLE, uvCorners, UvDrag, weldGroup, weldIndex, type UvDragOptions } from './uvEdit';
import { createBall } from './primitives';
import { ModelerState } from './state';

/** Two unit quads side by side sharing points 1-2, with continuous UVs across the shared edge, plus one without UVs. */
function strip(): Mesh {
  const m = new Mesh();
  for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1], [2, 0], [2, 1]]) m.addPoint([x!, y!, 0]);
  m.addPolygon([0, 1, 2, 3]);
  m.addPolygon([1, 4, 5, 2]);
  m.addPolygon([0, 1, 4]); // no UVs
  m.polygons[0]!.uvs = [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]];
  m.polygons[1]!.uvs = [[0.5, 0], [1, 0], [1, 0.5], [0.5, 0.5]];
  return m;
}
const OPTIONS: UvDragOptions = { snap: false, texWidth: 64, texHeight: 64, minRadius: 0.01 };
const uvOf = (m: Mesh, polygon: number, corner: number) => m.polygons[polygon]!.uvs![corner]!;
const near = (a: UV, b: UV, digits = 9) => a.forEach((c, i) => expect(c).toBeCloseTo(b[i]!, digits));
const identity = (u: number, v: number): [number, number] => [u * 100, v * 100]; // 100 px per UV unit

describe('corners', () => {
  it('lists the corners of polygons that have UVs and skips the rest', () => {
    const m = strip();
    const corners = uvCorners(m, [0, 1, 2]);
    expect(corners).toHaveLength(8);
    expect(corners[0]).toMatchObject({ key: cornerKey(0, 0), point: 0, u: 0, v: 0 });
    expect(corners.some((c) => c.polygon === 2)).toBe(false);
  });

  it('welds corners that share a point and a UV, so a closed seam moves as one', () => {
    const m = strip();
    const corners = uvCorners(m, [0, 1]);
    const onSeam = corners.find((c) => c.polygon === 0 && c.corner === 1)!; // point 1 at (0.5, 0)
    expect(weldGroup(corners, onSeam).sort()).toEqual([cornerKey(0, 1), cornerKey(1, 0)]);
  });

  it('keeps a split point separate: same point, different UV is a different group', () => {
    const m = strip();
    m.polygons[1]!.uvs![0] = [0.7, 0.1];
    const corners = uvCorners(m, [0, 1]);
    expect(weldGroup(corners, corners.find((c) => c.polygon === 0 && c.corner === 1)!)).toEqual([cornerKey(0, 1)]);
  });

  it('gives the same weld groups with an index as without, for every corner', () => {
    const m = strip();
    m.polygons[1]!.uvs![0] = [0.7, 0.1]; // one split point among the welded ones
    const corners = uvCorners(m, [0, 1]);
    const index = weldIndex(corners);
    for (const c of corners) expect(weldGroup(corners, c, index)).toEqual(weldGroup(corners, c));
  });

  it('box-selecting tens of thousands of corners stays quick (it used to be quadratic: seconds)', () => {
    const big = createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 128, segments: 96, axis: 'y' });
    const corners = uvCorners(big, big.polygons.map((_, i) => i));
    expect(corners.length).toBeGreaterThan(40000);
    const index = weldIndex(corners);
    const started = performance.now();
    const keys = new Set(corners.flatMap((c) => weldGroup(corners, c, index)));
    expect(keys.size).toBe(corners.length);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('picks the nearest corner within the radius, and none beyond it', () => {
    const corners = uvCorners(strip(), [0, 1]);
    expect(pickCorner(corners, identity, 52, 3)?.key).toBe(cornerKey(0, 1)); // near (0.5, 0): first of the welded pair
    expect(pickCorner(corners, identity, 52, 30)).toBeNull();
    expect(pickCorner(corners, identity, 2, 2, 1)).toBeNull(); // radius too small
  });

  it('finds corners in a rectangle given in any corner order', () => {
    const corners = uvCorners(strip(), [0, 1]);
    const inside = cornersInRect(corners, identity, { x0: 60, y0: 60, x1: -10, y1: -10 });
    expect(inside.map((c) => [c.u, c.v]).every(([u, v]) => u! <= 0.5 && v! <= 0.5)).toBe(true);
    expect(inside).toHaveLength(6); // all 4 corners of the first quad, plus the two shared-edge corners of the second
  });
});

describe('snapping', () => {
  it('rounds to the texel grid of the texture', () => {
    near(snapUv([0.4999, 0.26], 64, 64), [0.5, 17 / 64]);
    near(snapUv([0.51, 0.2], 32, 128), [16 / 32, 26 / 128]);
  });
});

describe('UvDrag', () => {
  const drag = (kind: 'move' | 'rotate' | 'size', corners: ReturnType<typeof uvCorners>, state: ModelerState, opts = OPTIONS) => {
    const tool = new UvDrag(state, kind);
    expect(tool.begin(corners, opts)).toBe(true);
    return tool;
  };

  it('moves only the given corners by the pointer offset, and undo/redo restore it', () => {
    const s = new ModelerState(strip());
    const group = uvCorners(s.mesh, [0, 1]).filter((c) => c.point === 1); // the welded seam pair
    const tool = drag('move', group, s);
    tool.move([0.1, 0.1], [0.2, 0.15]);
    tool.move([0.1, 0.1], [0.3, 0.1]); // cumulative from the press, not a delta
    tool.end();
    near(uvOf(s.mesh, 0, 1), [0.7, 0]);
    near(uvOf(s.mesh, 1, 0), [0.7, 0]);
    near(uvOf(s.mesh, 0, 0), [0, 0]); // untouched

    s.undo();
    near(uvOf(s.mesh, 0, 1), [0.5, 0]);
    near(uvOf(s.mesh, 1, 0), [0.5, 0]);
    s.redo();
    near(uvOf(s.mesh, 1, 0), [0.7, 0]);
  });

  it('snaps the results to texels when asked, not the offset', () => {
    const s = new ModelerState(strip());
    const tool = drag('move', uvCorners(s.mesh, [0]).filter((c) => c.corner === 0), s, { ...OPTIONS, snap: true });
    tool.move([0, 0], [0.1, 0.0123]);
    tool.end();
    near(uvOf(s.mesh, 0, 0), [6 / 64, 1 / 64]); // 0.1 * 64 = 6.4 -> 6, 0.0123 * 64 = 0.79 -> 1
  });

  it('rotates about the centre of the corners, following the pointer (v down: positive is clockwise)', () => {
    const s = new ModelerState(strip());
    const tool = drag('rotate', uvCorners(s.mesh, [0]), s); // quad (0..0.5)^2: pivot (0.25, 0.25)
    tool.move([0.5, 0.25], [0.25, 0.5]); // pointer swings from the right of the pivot to below it: +90 degrees
    tool.end();
    near(uvOf(s.mesh, 0, 0), [0.5, 0]); // top-left corner -> top-right
    near(uvOf(s.mesh, 0, 2), [0, 0.5]); // bottom-right -> bottom-left
  });

  it('snaps rotation to 15 degree steps', () => {
    const s = new ModelerState(strip());
    const tool = drag('rotate', uvCorners(s.mesh, [0]), s, { ...OPTIONS, snap: true });
    const a = 20 * (Math.PI / 180); // 20 degrees rounds to 15
    tool.move([0.5, 0.25], [0.25 + 0.25 * Math.cos(a), 0.25 + 0.25 * Math.sin(a)]);
    tool.end();
    const [c, sn] = [Math.cos(SNAP_ANGLE), Math.sin(SNAP_ANGLE)];
    near(uvOf(s.mesh, 0, 0), [0.25 + (-0.25) * c - (-0.25) * sn, 0.25 + (-0.25) * sn + (-0.25) * c]);
  });

  it('sizes about the centre by the ratio of the pointer distances', () => {
    const s = new ModelerState(strip());
    const tool = drag('size', uvCorners(s.mesh, [0]), s);
    tool.move([0.5, 0.25], [0.75, 0.25]); // distance 0.25 -> 0.5: x2
    tool.end();
    near(uvOf(s.mesh, 0, 0), [-0.25, -0.25]);
    near(uvOf(s.mesh, 0, 2), [0.75, 0.75]);
  });

  it('does not blow up when the press is on the pivot', () => {
    const s = new ModelerState(strip());
    const tool = drag('size', uvCorners(s.mesh, [0]), s, { ...OPTIONS, minRadius: 0.1 });
    tool.move([0.25, 0.25], [0.35, 0.25]); // base clamps to 0.1, current is 0.1: factor 1
    tool.end();
    near(uvOf(s.mesh, 0, 0), [0, 0]);
    expect(s.history.canUndo).toBe(false);
  });

  it('records nothing when nothing moved, and cancel puts everything back', () => {
    const s = new ModelerState(strip());
    const none = drag('move', uvCorners(s.mesh, [0]), s);
    none.end();
    expect(s.history.canUndo).toBe(false);

    const tool = drag('move', uvCorners(s.mesh, [0, 1]), s);
    tool.move([0, 0], [0.3, 0.3]);
    tool.cancel();
    near(uvOf(s.mesh, 1, 2), [1, 0.5]);
    expect(s.history.canUndo).toBe(false);
  });

  it('has nothing to drag with no corners', () => {
    expect(new UvDrag(new ModelerState(strip()), 'move').begin([], OPTIONS)).toBe(false);
  });

  it('is one undo step per drag, labelled for the tool', () => {
    const s = new ModelerState(strip());
    const tool = drag('size', uvCorners(s.mesh, [0, 1]), s);
    tool.move([0.5, 0.25], [0.6, 0.25]);
    tool.move([0.5, 0.25], [0.9, 0.25]);
    tool.end();
    expect(s.history.undoLabel).toBe('Size UVs');
    s.undo();
    expect(s.history.canUndo).toBe(false);
    near(uvOf(s.mesh, 0, 2), [0.5, 0.5]);
  });
});
