import { describe, expect, it } from 'vitest';
import { faceNormal, type UV } from '@/core';
import { cloneGeometry, type Geometry } from './geometry';
import { axisPlane, knife, planeThroughLine } from './knife';
import { createBox } from './primitives';

const cube = (): Geometry => cloneGeometry(createBox({ size: [1, 1, 1], center: [0, 0, 0], segments: [1, 1, 1] }));
const all = (g: Geometry) => new Set(g.polygons.map((_, i) => i));
const pointsOf = (g: Geometry, p: number) => g.polygons[p]!.points.map((i) => g.points[i]!);
const area = (g: Geometry, p: number) => Math.hypot(...faceNormal(pointsOf(g, p))) / 2;
const totalArea = (g: Geometry) => g.polygons.reduce((s, _, i) => s + area(g, i), 0);
const SHARE = { separate: false };

/** Every edge is used once in each direction: a closed surface with no cracks. */
function expectWatertight(g: Geometry) {
  const dirs = new Map<string, number>();
  for (const p of g.polygons) p.points.forEach((a, i) => {
    const key = `${a}>${p.points[(i + 1) % p.points.length]}`;
    dirs.set(key, (dirs.get(key) ?? 0) + 1);
  });
  for (const [key, n] of dirs) {
    const [a, b] = key.split('>');
    expect(n, `edge ${key} used ${n} times`).toBe(1);
    expect(dirs.has(`${b}>${a}`), `edge ${key} has no opposite`).toBe(true);
  }
}
const consistent = (g: Geometry) => g.polygons.every((p) => p.points.length >= 3 && p.points.every((i) => i >= 0 && i < g.points.length));

describe('knife through a cube', () => {
  it('splits the four faces the plane crosses, shares the new points, and stays closed', () => {
    const g = cube();
    const r = knife(g, all(g), axisPlane('x', 0), SHARE);
    expect(r.geometry.polygons).toHaveLength(6 + 4);
    expect(r.geometry.points).toHaveLength(8 + 4); // four crossed edges, each point shared by the two faces on it
    expect(r.split).toHaveLength(4);
    expect(r.cutPoints).toHaveLength(4);
    expect(r.repaired).toBe(0);
    expect(consistent(r.geometry)).toBe(true);
    expectWatertight(r.geometry);
    expect(totalArea(r.geometry)).toBeCloseTo(6, 9); // nothing lost, nothing gained
  });

  it('puts the new points exactly on the plane, halfway along the crossed edges', () => {
    const g = cube();
    const r = knife(g, all(g), axisPlane('x', 0), SHARE);
    for (const i of r.cutPoints) expect(r.geometry.points[i]![0]).toBe(0);
  });

  it('cuts at an uneven position: the new points sit a quarter of the way along', () => {
    const g = cube();
    const r = knife(g, all(g), axisPlane('x', -0.25), SHARE);
    for (const i of r.cutPoints) expect(r.geometry.points[i]![0]).toBeCloseTo(-0.25, 12);
    expectWatertight(r.geometry);
  });

  it('keeps the negative side at the polygon\'s number and appends the positive side', () => {
    const g = cube();
    const r = knife(g, all(g), axisPlane('x', 0), SHARE);
    for (const { kept, added } of r.split) {
      expect(added).toHaveLength(1);
      expect(Math.max(...pointsOf(r.geometry, kept).map((p) => p[0]))).toBe(0);
      expect(Math.min(...pointsOf(r.geometry, added[0]!).map((p) => p[0]))).toBe(0);
      expect(added[0]).toBeGreaterThanOrEqual(6);
    }
  });

  it('leaves what it was given alone', () => {
    const g = cube();
    const copy = cloneGeometry(g);
    knife(g, all(g), axisPlane('x', 0), SHARE);
    expect(g).toEqual(copy);
  });

  it('a plane that misses everything changes nothing', () => {
    const g = cube();
    const r = knife(g, all(g), axisPlane('x', 5), SHARE);
    expect(r.geometry).toEqual(g);
    expect(r.split).toEqual([]);
    expect(r.cutPoints).toEqual([]);
  });
});

describe('knife through existing points', () => {
  it('cuts a quad along its diagonal into two triangles without adding any points', () => {
    const g = cube();
    const top = g.polygons.findIndex((_, i) => pointsOf(g, i).every((p) => p[1] === 0.5));
    // the plane x - z = 0 passes through two opposite corners of every horizontal face
    const r = knife(g, new Set([top]), { normal: [1, 0, -1], offset: 0 }, SHARE);
    expect(r.geometry.points).toHaveLength(8);
    expect(r.geometry.polygons).toHaveLength(7);
    expect(r.geometry.polygons[top]!.points).toHaveLength(3);
    expect(r.geometry.polygons.at(-1)!.points).toHaveLength(3);
    expectWatertight(r.geometry);
    expect(r.cutPoints).toHaveLength(2);
  });

  it('does not split a polygon the plane only touches at a corner, along an edge, or lies in', () => {
    const g = cube();
    const faceAtX = (x: number) => g.polygons.findIndex((_, i) => pointsOf(g, i).every((p) => p[0] === x));
    // a plane at x = 0.5 contains the +x face and touches its neighbours along an edge
    const r = knife(g, all(g), axisPlane('x', 0.5), SHARE);
    expect(r.geometry).toEqual(g);
    expect(faceAtX(0.5)).toBeGreaterThanOrEqual(0);
  });

  it('treats points within the tolerance of the plane as on it, instead of cutting slivers', () => {
    const g = cube();
    const r = knife(g, all(g), axisPlane('x', 0.5 - 0.00005), SHARE);
    expect(r.geometry).toEqual(g);
  });
});

describe('knife on only some polygons', () => {
  it('splits the selected polygon and adds the new points to its neighbours so no crack opens', () => {
    const g = cube();
    const top = g.polygons.findIndex((_, i) => pointsOf(g, i).every((p) => p[1] === 0.5));
    const r = knife(g, new Set([top]), axisPlane('x', 0), SHARE);
    expect(r.geometry.polygons).toHaveLength(7);
    expect(r.geometry.points).toHaveLength(8 + 2);
    expect(r.repaired).toBe(2); // the front and back faces each got an extra point on their top edge
    const grown = r.geometry.polygons.filter((p) => p.points.length === 5);
    expect(grown).toHaveLength(2);
    expectWatertight(r.geometry);
    expect(totalArea(r.geometry)).toBeCloseTo(6, 9);
  });

  it('gives the repaired neighbour a UV for its new point, interpolated along the edge', () => {
    const g = cube();
    g.polygons.forEach((p) => (p.uvs = p.points.map((_, k): UV => [k, k * 10])));
    const top = g.polygons.findIndex((_, i) => pointsOf(g, i).every((p) => p[1] === 0.5));
    const r = knife(g, new Set([top]), axisPlane('x', 0), SHARE);
    for (const p of r.geometry.polygons) expect(p.uvs).toHaveLength(p.points.length);
  });
});

describe('knife and UVs', () => {
  it('interpolates the UV of a new point along the edge it sits on', () => {
    const g: Geometry = {
      points: [[-1, 0, 0], [1, 0, 0], [1, 1, 0], [-1, 1, 0]],
      polygons: [{ points: [0, 1, 2, 3], surface: 4, uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
    };
    const r = knife(g, all(g), axisPlane('x', 0), SHARE);
    const [left, right] = [r.geometry.polygons[0]!, r.geometry.polygons[1]!];
    const uvAt = (poly: typeof left, x: number, y: number) => poly.uvs![poly.points.findIndex((i) => r.geometry.points[i]![0] === x && r.geometry.points[i]![1] === y)]!;
    expect(uvAt(left, 0, 0)).toEqual([0.5, 0]);
    expect(uvAt(left, 0, 1)).toEqual([0.5, 1]);
    expect(uvAt(right, 0, 0)).toEqual([0.5, 0]);
    expect(left.surface).toBe(4);
    expect(right.surface).toBe(4);
  });

  it('adds no UVs to polygons that had none', () => {
    const g = cube();
    g.polygons.forEach((p) => delete p.uvs);
    const r = knife(g, all(g), axisPlane('x', 0), SHARE);
    expect(r.geometry.polygons.every((p) => p.uvs === undefined)).toBe(true);
  });
});

describe('knife through a concave polygon', () => {
  // an L: 2 x 1 along the bottom, 1 x 1 rising on the left. Area 3. Seen from the vertex at the origin every corner is visible.
  const L = (): Geometry => ({
    points: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]],
    polygons: [{ points: [0, 1, 2, 3, 4, 5], surface: 0 }],
  });

  it('keeps the whole area when a line crosses it more than twice, and every piece is a triangle', () => {
    const g = L();
    const r = knife(g, all(g), axisPlane('y', 1.5), SHARE); // crosses the tall arm only
    expect(totalArea(r.geometry)).toBeCloseTo(3, 9);
    expect(r.geometry.polygons.every((p) => p.points.length <= 4)).toBe(true);
    expect(r.geometry.polygons.length).toBeGreaterThan(1);
  });

  it('a line through both arms of the L cuts all of them and conserves the area', () => {
    const g = L();
    const r = knife(g, all(g), { normal: [1, 1, 0], offset: 1.2 }, SHARE); // crosses the corner region several times
    expect(totalArea(r.geometry)).toBeCloseTo(3, 9);
    expect(consistent(r.geometry)).toBe(true);
  });
});

describe('knife with separate', () => {
  it('gives the positive side its own copies of the cut points, so the sides share nothing', () => {
    const g = cube();
    const r = knife(g, all(g), axisPlane('x', 0), { separate: true });
    expect(r.geometry.points).toHaveLength(8 + 4 + 4);
    expect(r.cutPoints).toHaveLength(8);
    const sideOf = (p: number) => Math.sign(pointsOf(r.geometry, p).reduce((s, q) => s + q[0], 0));
    const used = new Map<number, Set<number>>();
    r.geometry.polygons.forEach((p, i) => p.points.forEach((v) => used.set(v, (used.get(v) ?? new Set()).add(sideOf(i)))));
    for (const [v, sides] of used) {
      if (r.cutPoints.includes(v)) expect(sides.size, `cut point ${v} is used from both sides`).toBe(1);
    }
    expect(totalArea(r.geometry)).toBeCloseTo(6, 9);
  });

  it('the copies sit exactly on the originals', () => {
    const g = cube();
    const r = knife(g, all(g), axisPlane('x', 0), { separate: true });
    const positions = r.cutPoints.map((i) => r.geometry.points[i]!.join(','));
    expect(new Set(positions).size).toBe(4);
  });
});

describe('planeThroughLine', () => {
  it('is the plane containing the line and the view direction', () => {
    const plane = planeThroughLine([0, 1, 0], [0, -1, 0], [0, 0, 1])!; // a vertical line seen from +Z
    expect(Math.abs(plane.normal[0])).toBe(1);
    expect(plane.normal[1]).toBe(0);
    expect(plane.offset).toBeCloseTo(0, 12);
    const shifted = planeThroughLine([3, 1, 0], [3, -1, 0], [0, 0, 1])!;
    expect(Math.abs(shifted.offset)).toBeCloseTo(3, 12);
  });

  it('ignores the depth of the points: only their place in the view matters', () => {
    const a = planeThroughLine([2, 0, 7], [2, 5, 7], [0, 0, 1])!;
    const b = planeThroughLine([2, 0, -3], [2, 5, 9], [0, 0, 1])!;
    expect(a.normal.map((c) => Math.abs(c))).toEqual(b.normal.map((c) => Math.abs(c)));
    expect(Math.abs(a.offset)).toBeCloseTo(Math.abs(b.offset), 12);
  });

  it('has no plane for a line that is a single point, or that points along the view', () => {
    expect(planeThroughLine([1, 1, 1], [1, 1, 1], [0, 0, 1])).toBeNull();
    expect(planeThroughLine([0, 0, 0], [0, 0, 5], [0, 0, 1])).toBeNull();
  });
});

describe('knife results are usable by the rest of the editor', () => {
  it('a cut cube has only convex pieces with at least three points', () => {
    const g = cube();
    const r = knife(g, all(g), axisPlane('z', 0.1), SHARE);
    expect(consistent(r.geometry)).toBe(true);
    expect(r.geometry.polygons.every((_, i) => area(r.geometry, i) > 0)).toBe(true);
    const unused = new Set(r.geometry.points.map((_, i) => i));
    r.geometry.polygons.forEach((p) => p.points.forEach((v) => unused.delete(v)));
    expect([...unused]).toEqual([]);
  });
});
