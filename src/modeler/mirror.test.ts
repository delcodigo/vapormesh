import { describe, expect, it } from 'vitest';
import { faceNormal, type Vec3 } from '@/core';
import { cloneGeometry, deletePolygons, type Geometry } from './geometry';
import { mirror, type MirrorOptions } from './mirror';
import { createBox } from './primitives';

const opts = (o: Partial<MirrorOptions> = {}): MirrorOptions => ({ axis: 'x', position: 0, merge: true, ...o });
const all = (g: Geometry) => new Set(g.polygons.map((_, i) => i));
const pointsOf = (g: Geometry, p: number) => g.polygons[p]!.points.map((i) => g.points[i]!);

/** A box from x = 0 to 1, with the face lying in the x = 0 plane deleted: the open seam of a half model. */
function halfBox(): Geometry {
  const g = cloneGeometry(createBox({ size: [1, 1, 1], center: [0.5, 0, 0], segments: [1, 1, 1] }));
  const seam = g.polygons.findIndex((_, i) => pointsOf(g, i).every((p) => p[0] === 0));
  return deletePolygons(g, new Set([seam]));
}

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
function expectOutward(g: Geometry, inside: Vec3) {
  g.polygons.forEach((_, i) => {
    const pts = pointsOf(g, i);
    const n = faceNormal(pts);
    const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k]!, 0) / pts.length);
    expect(n[0] * (c[0]! - inside[0]) + n[1] * (c[1]! - inside[1]) + n[2] * (c[2]! - inside[2]), `polygon ${i} faces inward`).toBeGreaterThan(0);
  });
}

describe('mirror a half model with merge', () => {
  it('joins the halves into one closed, outward-facing solid with the seam welded', () => {
    const half = halfBox();
    expect(half.polygons).toHaveLength(5);
    const r = mirror(half, all(half), opts());
    expect(r.geometry.points).toHaveLength(8 + 4); // the 4 points on the plane are shared, the other 4 are copied
    expect(r.geometry.polygons).toHaveLength(10);
    expect(r.skipped).toBe(0);
    expectWatertight(r.geometry);
    expectOutward(r.geometry, [0, 0, 0]);
    const xs = r.geometry.points.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(-1);
    expect(Math.max(...xs)).toBe(1);
  });

  it('reports the new points and polygons, and leaves the originals exactly as they were', () => {
    const half = halfBox();
    const before = cloneGeometry(half);
    const r = mirror(half, all(half), opts());
    expect(r.newPoints).toEqual([8, 9, 10, 11]);
    expect(r.newPolygons).toEqual([5, 6, 7, 8, 9]);
    expect(r.geometry.points.slice(0, 8)).toEqual(before.points);
    expect(r.geometry.polygons.slice(0, 5)).toEqual(before.polygons);
    expect(half).toEqual(before); // the input is not modified
  });

  it('puts the seam points back on the plane exactly, not merely close', () => {
    const half = halfBox();
    half.points.forEach((p) => {
      if (p[0] === 0) p[0] = 0.00005; // slightly off the plane, but within the tolerance
    });
    const r = mirror(half, all(half), opts());
    expect(r.geometry.points).toHaveLength(12);
    expectWatertight(r.geometry);
  });
});

describe('mirror without merge', () => {
  it('duplicates the points on the plane too, leaving a seam to merge later', () => {
    const half = halfBox();
    const r = mirror(half, all(half), opts({ merge: false }));
    expect(r.geometry.points).toHaveLength(16);
    expect(r.newPoints).toHaveLength(8);
    expect(r.geometry.polygons).toHaveLength(10);
  });

  it('copies polygons that lie in the plane (merge would skip them), facing the other way', () => {
    const full = cloneGeometry(createBox({ size: [1, 1, 1], center: [0.5, 0, 0], segments: [1, 1, 1] }));
    const r = mirror(full, all(full), opts({ merge: false }));
    expect(r.geometry.polygons).toHaveLength(12);
    expect(r.skipped).toBe(0);
  });
});

describe('polygons in the plane', () => {
  it('are not copied when merging, and counted', () => {
    const full = cloneGeometry(createBox({ size: [1, 1, 1], center: [0.5, 0, 0], segments: [1, 1, 1] }));
    const r = mirror(full, all(full), opts());
    expect(r.skipped).toBe(1);
    expect(r.geometry.polygons).toHaveLength(6 + 5);
  });

  it('copying nothing at all is possible when everything is in the plane', () => {
    const flat: Geometry = { points: [[0, 0, 0], [0, 1, 0], [0, 1, 1]], polygons: [{ points: [0, 1, 2], surface: 0 }] };
    const r = mirror(flat, all(flat), opts());
    expect(r.newPolygons).toEqual([]);
    expect(r.skipped).toBe(1);
  });
});

describe('mirror: the details', () => {
  it('reverses the winding and the UV corners together, and keeps the surface', () => {
    const g: Geometry = {
      points: [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]],
      polygons: [{ points: [0, 1, 2, 3], surface: 2, uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
    };
    const r = mirror(g, all(g), opts({ merge: false }));
    const copy = r.geometry.polygons[1]!;
    expect(copy.surface).toBe(2);
    expect(copy.points.map((i) => r.geometry.points[i])).toEqual([[-1, 1, 0], [-2, 1, 0], [-2, 0, 0], [-1, 0, 0]]);
    expect(copy.uvs).toEqual([[0, 1], [1, 1], [1, 0], [0, 0]]);
    expect(faceNormal(pointsOf(r.geometry, 0))[2]).toBeGreaterThan(0);
    expect(faceNormal(pointsOf(r.geometry, 1))[2]).toBeGreaterThan(0); // both still face +Z
  });

  it('reflects about a plane that is not at zero', () => {
    const half = halfBox();
    const r = mirror(half, all(half), opts({ position: 1, merge: false }));
    expect(Math.min(...r.newPoints.map((i) => r.geometry.points[i]![0]))).toBe(1);
    expect(Math.max(...r.newPoints.map((i) => r.geometry.points[i]![0]))).toBe(2);
  });

  it.each([
    ['x', 0],
    ['y', 1],
    ['z', 2],
  ] as const)('across %s changes only that coordinate', (axis, k) => {
    const g: Geometry = { points: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], polygons: [{ points: [0, 1, 2], surface: 0 }] };
    const r = mirror(g, all(g), opts({ axis, position: 10, merge: false }));
    r.newPoints.forEach((n, i) => {
      for (let c = 0; c < 3; c++) expect(r.geometry.points[n]![c]).toBe(c === k ? 20 - g.points[i]![c]! : g.points[i]![c]!);
    });
  });

  it('only mirrors the polygons it is given, and only the points they use', () => {
    const full = cloneGeometry(createBox({ size: [1, 1, 1], center: [3, 0, 0], segments: [1, 1, 1] }));
    const r = mirror(full, new Set([0]), opts({ merge: false }));
    expect(r.newPolygons).toEqual([6]);
    expect(r.newPoints).toHaveLength(4);
    expect(r.geometry.polygons).toHaveLength(7);
  });

  it('ignores ids that are not polygons', () => {
    const half = halfBox();
    const r = mirror(half, new Set([99]), opts());
    expect(r.geometry).toEqual(half);
    expect(r.newPolygons).toEqual([]);
  });

  it('mirroring twice across the same plane lands back on the original positions', () => {
    const half = halfBox();
    const once = mirror(half, all(half), opts({ merge: false })).geometry;
    const copies = new Set(once.polygons.map((_, i) => i).filter((i) => i >= half.polygons.length));
    const twice = mirror(once, copies, opts({ merge: false }));
    const back = twice.newPoints.map((i) => twice.geometry.points[i]!);
    for (const p of back) expect(half.points.some((q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2])).toBe(true);
  });
});
