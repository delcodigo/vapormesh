import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { latheSelection } from './edit';
import type { Geometry } from './geometry';
import { lathe, type LatheOptions } from './lathe';
import { ModelerState } from './state';
import { Mesh } from '@/core';

const opts = (o: Partial<LatheOptions> = {}): LatheOptions => ({ axis: 'y', center: [0, 0, 0], sides: 8, degrees: 360, closed: false, ...o });
const geoOf = (points: Vec3[]): Geometry => ({ points, polygons: [] });
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Newell normal of a polygon and its centre. */
function normalAndCentre(g: Geometry, pi: number): { n: Vec3; c: Vec3 } {
  const pts = g.polygons[pi]!.points.map((i) => g.points[i]!);
  let n: Vec3 = [0, 0, 0];
  const c: Vec3 = [0, 0, 0];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    const x = cross(sub(p, pts[0]!), sub(q, pts[0]!));
    n = [n[0] + x[0], n[1] + x[1], n[2] + x[2]];
    [0, 1, 2].forEach((k) => (c[k]! += p[k]! / pts.length));
  });
  return { n, c };
}
const radial = (c: Vec3, axis: 'x' | 'y' | 'z'): Vec3 => (axis === 'x' ? [0, c[1], c[2]] : axis === 'y' ? [c[0], 0, c[2]] : [c[0], c[1], 0]);

/** A profile climbing the Y axis at radius 1, then 2: a cone-ish side. */
const side = geoOf([[1, 0, 0], [1, 1, 0], [2, 2, 0]]);

describe('lathe', () => {
  it('makes a ring of quads per profile segment, with the profile as the first ring and a closed seam', () => {
    const r = lathe(side, [0, 1, 2], opts({ sides: 8 }));
    expect(r.newPolygons).toHaveLength(2 * 8);
    expect(r.newPoints).toHaveLength(3 * 7); // rings 1..7 only: the last step lands back on ring 0
    expect(r.geometry.polygons.every((p) => p.points.length === 4)).toBe(true);
    // every profile point is used by polygons of both the first and last step: the seam is shared, not duplicated
    expect(r.geometry.polygons.filter((p) => p.points.includes(0)).length).toBe(2);
    // all new points sit at their profile point's radius and height
    for (const id of r.newPoints) {
      const p = r.geometry.points[id]!;
      expect([1, 2]).toContain(Math.round(Math.hypot(p[0], p[2]) * 1e9) / 1e9);
    }
  });

  it('spins by equal steps, in the right-handed direction about the axis', () => {
    const r = lathe(geoOf([[1, 0, 0], [1, 1, 0]]), [0, 1], opts({ sides: 4 }));
    const firstRingStep = r.geometry.points[r.newPoints[0]!]!;
    // a quarter turn about +Y takes +X to -Z
    expect(firstRingStep[0]).toBeCloseTo(0, 12);
    expect(firstRingStep[2]).toBeCloseTo(-1, 12);
  });

  it('faces outward for a profile that climbs the axis, whatever the axis, sweep direction or number of steps', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const degrees of [360, -360, 180, -90]) {
        const k = { x: 0, y: 1, z: 2 }[axis];
        const up = (along: number, out: number): Vec3 => {
          const p: Vec3 = [0, 0, 0];
          p[k] = along;
          p[(k + 1) % 3] = out;
          return p;
        };
        const g = geoOf([up(0, 1), up(1, 1), up(2, 2)]);
        const r = lathe(g, [0, 1, 2], opts({ axis, degrees, sides: 6 }));
        for (const pi of r.newPolygons) {
          const { n, c } = normalAndCentre(r.geometry, pi);
          expect(dot(n, radial(c, axis)), `${axis} ${degrees}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('a partial sweep is open: one more ring of points and a different last step, with no wrap', () => {
    const r = lathe(geoOf([[1, 0, 0], [1, 1, 0]]), [0, 1], opts({ sides: 4, degrees: 180 }));
    expect(r.newPolygons).toHaveLength(4);
    expect(r.newPoints).toHaveLength(2 * 4); // rings 1..4
    const last = r.geometry.points[r.newPoints[r.newPoints.length - 2]!]!;
    expect(last[0]).toBeCloseTo(-1, 12); // half a turn
  });

  it('keeps a profile point on the axis as one point, and the quads next to it become triangles', () => {
    const g = geoOf([[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    const r = lathe(g, [0, 1, 2], opts({ sides: 6 }));
    // the segment from the axis point to (1,0,0) is a fan of triangles; the next segment is quads
    const sizes = r.newPolygons.map((pi) => r.geometry.polygons[pi]!.points.length);
    expect(sizes.filter((s) => s === 3)).toHaveLength(6);
    expect(sizes.filter((s) => s === 4)).toHaveLength(6);
    expect(r.newPoints).toHaveLength(2 * 5); // only the two off-axis profile points, 5 new rings each
    // no new point is on the axis
    r.newPoints.forEach((id) => expect(Math.hypot(r.geometry.points[id]![0], r.geometry.points[id]![2])).toBeGreaterThan(0.5));
  });

  it('skips a segment that lies entirely on the axis', () => {
    const g = geoOf([[0, 0, 0], [0, 1, 0], [1, 1, 0]]);
    const r = lathe(g, [0, 1, 2], opts({ sides: 5 }));
    expect(r.newPolygons).toHaveLength(5); // only the flat disc segment, as triangles
    expect(r.newPolygons.every((pi) => r.geometry.polygons[pi]!.points.length === 3)).toBe(true);
  });

  it('closed profiles join the last point to the first: a torus', () => {
    const square = geoOf([[2, -0.5, 0], [3, -0.5, 0], [3, 0.5, 0], [2, 0.5, 0]]);
    const r = lathe(square, [0, 1, 2, 3], opts({ sides: 12, closed: true }));
    expect(r.newPolygons).toHaveLength(4 * 12);
    // every edge is shared by exactly two polygons: a closed surface
    const edges = new Map<string, number>();
    for (const pi of r.newPolygons) {
      const pts = r.geometry.polygons[pi]!.points;
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length]!;
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      });
    }
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
  });

  it('turns about an axis that is not through the origin', () => {
    const g = geoOf([[5, 0, 0], [5, 1, 0]]);
    const r = lathe(g, [0, 1], opts({ sides: 4, center: [4, 0, 0] }));
    // a radius of 1 about x = 4: a quarter turn lands at (4, y, -1)
    near(r.geometry.points[r.newPoints[0]!]!, [4, 0, -1]);
  });

  it('gives cylindrical UVs: u runs 0..1 round the sweep, v follows the profile from the bottom', () => {
    const g = geoOf([[1, 0, 0], [1, 1, 0], [1, 3, 0]]);
    const r = lathe(g, [0, 1, 2], opts({ sides: 4 }));
    const first = r.geometry.polygons[r.newPolygons[0]!]!;
    // the first quad: bottom-left, bottom-right, top-right, top-left of the label
    expect(first.uvs).toEqual([[0, 1], [0.25, 1], [0.25, 1 - 1 / 3], [0, 1 - 1 / 3]]);
    const lastStep = r.geometry.polygons[r.newPolygons[r.newPolygons.length - 1]!]!;
    expect(Math.max(...lastStep.uvs!.map((uv) => uv[0]))).toBe(1);
    expect(lastStep.uvs!.every((uv) => uv[1] >= 0 && uv[1] <= 1)).toBe(true);
    expect(first.uvs).toHaveLength(first.points.length);
  });

  it('leaves the original geometry alone', () => {
    const before = JSON.stringify(side);
    lathe(side, [0, 1, 2], opts());
    expect(JSON.stringify(side)).toBe(before);
  });
});

function near(a: Vec3, b: Vec3) {
  a.forEach((c, i) => expect(c).toBeCloseTo(b[i]!, 9));
}

describe('latheSelection', () => {
  const profileState = () => {
    const m = new Mesh();
    [[1, 0, 0], [1, 1, 0], [2, 2, 0]].forEach((p) => m.addPoint(p as Vec3));
    const s = new ModelerState(m);
    [0, 1, 2].forEach((i) => s.applyPick(i, 'toggle'));
    return s;
  };
  const settings = { axis: 'y' as const, center: [0, 0, 0] as Vec3, sides: 8, degrees: 360, closed: false };

  it('spins the selected points in selection order, selects the result, and undoes as one step', () => {
    const s = profileState();
    expect(latheSelection(s, settings)).toEqual({ ok: true, message: 'Made 16 polygons by spinning 3 points 8 steps about Y' });
    expect(s.mesh.polygons).toHaveLength(16);
    expect(s.selectedPolygons.size).toBe(16);
    expect(s.selectedPoints.size).toBe(3 * 7);
    s.undo();
    expect(s.mesh.polygons).toHaveLength(0);
    expect(s.mesh.points).toHaveLength(3);
    expect(s.history.canUndo).toBe(false);
  });

  it('follows the order the points were picked, not their numbering', () => {
    const s = profileState();
    s.clearSelection();
    [2, 1, 0].forEach((i) => s.applyPick(i, 'toggle')); // from the top down
    latheSelection(s, settings);
    // top-down faces inward: the normals point at the axis
    const { n, c } = normalAndCentre(s.mesh, 0);
    expect(dot(n, radial(c, 'y'))).toBeLessThan(0);
  });

  it.each<[string, Partial<typeof settings>, string]>([
    ['too few sides', { sides: 2 }, 'at least 3'],
    ['fractional sides', { sides: 4.5 }, 'whole number'],
    ['too many sides', { sides: 300 }, 'At most 256'],
    ['no angle', { degrees: 0 }, 'between -360 and 360'],
    ['more than a full turn', { degrees: 400 }, 'between -360 and 360'],
    ['a field that is not a number', { center: [NaN, 0, 0] }, 'every field'],
  ])('refuses %s without touching the model', (_name, patch, text) => {
    const s = profileState();
    const r = latheSelection(s, { ...settings, ...patch });
    expect(r.ok).toBe(false);
    expect(r.message).toContain(text);
    expect(s.mesh.polygons).toHaveLength(0);
    expect(s.history.canUndo).toBe(false);
  });

  it('needs Point mode and at least two points, three if closed, and something off the axis', () => {
    const s = profileState();
    s.setMode('polygons');
    expect(latheSelection(s, settings).message).toContain('Point mode');
    s.setMode('points');
    s.clearSelection();
    s.applyPick(0, 'toggle');
    expect(latheSelection(s, settings).message).toContain('at least two points');
    s.applyPick(1, 'toggle');
    expect(latheSelection(s, { ...settings, closed: true }).message).toContain('at least three');
    // a profile that lies on the axis
    const m = new Mesh();
    m.addPoint([0, 0, 0]);
    m.addPoint([0, 1, 0]);
    const t = new ModelerState(m);
    t.applyPick(0, 'toggle');
    t.applyPick(1, 'toggle');
    expect(latheSelection(t, settings).message).toContain('lies on the axis');
  });

  it('refuses a lathe that would add too many polygons', () => {
    const m = new Mesh();
    for (let i = 0; i < 100; i++) m.addPoint([1 + i, i, 0]);
    const s = new ModelerState(m);
    m.points.forEach((_, i) => s.applyPick(i, 'toggle'));
    expect(latheSelection(s, { ...settings, sides: 256 }).message).toBe('That would add 25344 polygons; the limit is 20000');
  });
});
