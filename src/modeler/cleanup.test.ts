import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { dropUnusedPoints, healCracks, mergeFragments, removeCollinearPoints, repairTJunctions, unbalancedEdges } from './cleanup';
import type { Geometry } from './geometry';

const quad = (...i: [number, number, number, number]) => ({ points: [...i], surface: 0 });

describe('dropUnusedPoints', () => {
  it('removes points nothing uses and renumbers, leaving the rest in order', () => {
    const g: Geometry = { points: [[9, 9, 9], [0, 0, 0], [1, 0, 0], [0, 1, 0], [8, 8, 8]], polygons: [{ points: [1, 2, 3], surface: 0 }] };
    const out = dropUnusedPoints(g);
    expect(out.points).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    expect(out.polygons[0]!.points).toEqual([0, 1, 2]);
  });
});

describe('repairTJunctions', () => {
  // a 2x1 plate on top, and two 1x1 plates below it that meet at x = 1: the plate on top has no point at (1, 0, 0)
  const crack = (): Geometry => ({
    points: [[0, 1, 0], [2, 1, 0], [2, 0, 0], [0, 0, 0], [1, 0, 0], [2, -1, 0], [1, -1, 0], [0, -1, 0]] as Vec3[],
    polygons: [
      { points: [0, 1, 2, 3], surface: 0, uvs: [[0, 0], [2, 0], [2, 1], [0, 1]] },
      quad(3, 4, 6, 7),
      quad(4, 2, 5, 6),
    ],
  });

  it('inserts the point into the edge that lacks it, between that edge\'s ends, with an interpolated UV', () => {
    const { geometry, inserted } = repairTJunctions(crack(), 1e-6);
    expect(inserted).toBe(1);
    expect(geometry.polygons[0]!.points).toEqual([0, 1, 2, 4, 3]); // (1,0,0) went between (2,0,0) and (0,0,0)
    expect(geometry.polygons[0]!.uvs![3]).toEqual([1, 1]);
    expect(geometry.polygons[0]!.uvs).toHaveLength(5);
    expect(geometry.polygons[1]).toEqual(crack().polygons[1]); // the others were fine
  });

  it('closes the crack: the mesh becomes watertight along that edge', () => {
    const before = crack();
    const edgeUses = (g: Geometry) => g.polygons.flatMap((p) => p.points.map((a, i) => `${a}>${p.points[(i + 1) % p.points.length]}`));
    const opposite = (g: Geometry, key: string) => { const [a, b] = key.split('>'); return edgeUses(g).includes(`${b}>${a}`); };
    expect(edgeUses(before).filter((k) => k.startsWith('4>') || k.endsWith('>4')).every((k) => opposite(before, k))).toBe(false);
    const { geometry } = repairTJunctions(before, 1e-6);
    expect(edgeUses(geometry).filter((k) => k.startsWith('4>') || k.endsWith('>4')).every((k) => opposite(geometry, k))).toBe(true);
  });

  it('puts several points on one edge in order, whichever way each polygon runs along it', () => {
    // points 4, 6, 5 sit at x = 1, 2, 3 on the segment from point 0 (x = 0) to point 1 (x = 4)
    const g: Geometry = {
      points: [[0, 0, 0], [4, 0, 0], [4, 1, 0], [0, 1, 0], [1, 0, 0], [3, 0, 0], [2, 0, 0], [0, -1, 0], [4, -1, 0], [2, -0.5, 0]] as Vec3[],
      polygons: [quad(0, 1, 2, 3), quad(1, 0, 7, 8), { points: [4, 9, 6], surface: 0 }, { points: [6, 9, 5], surface: 0 }],
    };
    const { geometry, inserted } = repairTJunctions(g, 1e-6);
    expect(inserted).toBe(6); // three points into each of the two polygons that use the edge
    expect(geometry.polygons[0]!.points).toEqual([0, 4, 6, 5, 1, 2, 3]); // running 0 -> 1: increasing x
    expect(geometry.polygons[1]!.points).toEqual([1, 5, 6, 4, 0, 7, 8]); // running 1 -> 0: decreasing x
  });

  it('does nothing when there are no T-junctions, and ignores points that merely sit at an end', () => {
    const g: Geometry = { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as Vec3[], polygons: [quad(0, 1, 2, 3)] };
    const { geometry, inserted } = repairTJunctions(g, 1e-6);
    expect(inserted).toBe(0);
    expect(geometry).toEqual(g);
  });

  it('ignores a loose point lying on an edge: it is not a crack', () => {
    const g: Geometry = { points: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0], [1, 0, 0]] as Vec3[], polygons: [quad(0, 1, 2, 3)] };
    expect(repairTJunctions(g, 1e-6).inserted).toBe(0);
  });

  it('ignores a point that is near the edge but outside the tolerance', () => {
    const g: Geometry = { points: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0], [1, 0.01, 0]] as Vec3[], polygons: [quad(0, 1, 2, 3), { points: [0, 4, 1], surface: 0 }] };
    expect(repairTJunctions(g, 1e-4).inserted).toBe(0);
    expect(repairTJunctions(g, 0.1).inserted).toBeGreaterThan(0);
  });

  it('copes with a mesh that has no edges', () => {
    expect(repairTJunctions({ points: [], polygons: [] }, 1e-6).inserted).toBe(0);
  });
});

describe('mergeFragments', () => {
  const unit: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];

  it('puts two fragments of one polygon back together when the union is convex', () => {
    const g: Geometry = { points: unit, polygons: [{ points: [0, 1, 2], surface: 7 }, { points: [0, 2, 3], surface: 7 }] };
    const out = mergeFragments(g, 1e-6);
    expect(out.polygons).toHaveLength(1);
    expect(out.polygons[0]!.points).toHaveLength(4);
    expect(out.polygons[0]!.surface).toBe(7);
  });

  it('keeps the winding of the fragments', () => {
    const g: Geometry = { points: unit, polygons: [{ points: [0, 1, 2], surface: 1 }, { points: [0, 2, 3], surface: 1 }] };
    const p = mergeFragments(g, 1e-6).polygons[0]!.points.map((i) => unit[i]!);
    const area = p.reduce((s, q, i) => s + (q[0] * p[(i + 1) % 4]![1] - p[(i + 1) % 4]![0] * q[1]), 0);
    expect(area).toBeGreaterThan(0); // still counter-clockwise
  });

  it('leaves polygons of different origins alone, so a deliberately subdivided face stays subdivided', () => {
    const g: Geometry = { points: unit, polygons: [{ points: [0, 1, 2], surface: 1 }, { points: [0, 2, 3], surface: 2 }] };
    expect(mergeFragments(g, 1e-6).polygons).toHaveLength(2);
  });

  it('does not merge when the union would not be convex', () => {
    const L: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]];
    const g: Geometry = { points: L, polygons: [{ points: [0, 1, 2, 3], surface: 5 }, { points: [0, 3, 4, 5], surface: 5 }] };
    expect(mergeFragments(g, 1e-6).polygons).toHaveLength(2);
  });

  it('does not merge across a fold, even from the same origin', () => {
    const g: Geometry = { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 1]] as Vec3[], polygons: [{ points: [0, 1, 2], surface: 5 }, { points: [0, 2, 3], surface: 5 }] };
    expect(mergeFragments(g, 1e-6).polygons).toHaveLength(2);
  });

  it('does not merge across a texture seam, where the UVs on the shared edge differ', () => {
    const g: Geometry = {
      points: unit,
      polygons: [
        { points: [0, 1, 2], surface: 3, uvs: [[0, 0], [1, 0], [1, 1]] },
        { points: [0, 2, 3], surface: 3, uvs: [[0.5, 0.5], [1, 1], [0, 1]] },
      ],
    };
    expect(mergeFragments(g, 1e-6).polygons).toHaveLength(2);
  });

  it('merges UVs along with the points when they agree', () => {
    const g: Geometry = {
      points: unit,
      polygons: [
        { points: [0, 1, 2], surface: 3, uvs: [[0, 0], [1, 0], [1, 1]] },
        { points: [0, 2, 3], surface: 3, uvs: [[0, 0], [1, 1], [0, 1]] },
      ],
    };
    const m = mergeFragments(g, 1e-6).polygons[0]!;
    expect(m.uvs).toHaveLength(4);
    m.points.forEach((v, k) => expect(m.uvs![k]).toEqual([unit[v]![0], unit[v]![1]])); // the UV equals the position here
  });

  it('puts a whole row of fragments back together, whichever order they come in', () => {
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [3, 1, 0], [2, 1, 0], [1, 1, 0], [0, 1, 0]];
    const g: Geometry = { points: pts, polygons: [quad(1, 2, 5, 6), quad(0, 1, 6, 7), quad(2, 3, 4, 5)].map((p) => ({ ...p, surface: 9 })) };
    const out = mergeFragments(g, 1e-6);
    expect(out.polygons).toHaveLength(1);
    expect(out.polygons[0]!.points).toHaveLength(8); // the three collinear points on each long edge are still there
  });

  it('merges a big polygon with two small ones whose joint edge was cut by a T-junction point (brick layout)', () => {
    // 2x1 below; above it two 1x1 cells, so the big one's top edge has an extra point at (1, 1)
    const pts: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [0, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]];
    const g: Geometry = {
      points: pts,
      polygons: [
        { points: [0, 1, 2, 3, 4], surface: 6 }, // the big one: along its top edge 2 -> 3 -> 4
        { points: [4, 3, 6, 5], surface: 6 },
        { points: [3, 2, 7, 6], surface: 6 },
      ],
    };
    const out = mergeFragments(g, 1e-6);
    expect(out.polygons).toHaveLength(1);
    const p = out.polygons[0]!.points.map((i) => out.points[i]!);
    expect(Math.abs(p.reduce((s, q, i) => s + (q[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * q[1]), 0)) / 2).toBeCloseTo(4, 9);
  });

  it('does not merge through a point that another polygon also uses', () => {
    // as above, but a fourth polygon (a triangle hanging off the middle point) shares (1,1): it must stay
    const pts: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [0, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0], [1, 3, 0]];
    const g: Geometry = {
      points: pts,
      polygons: [
        { points: [0, 1, 2, 3, 4], surface: 6 },
        { points: [4, 3, 6, 5], surface: 6 },
        { points: [3, 2, 7, 6], surface: 6 },
        { points: [3, 8, 6], surface: 99 },
      ],
    };
    const out = mergeFragments(g, 1e-6);
    expect(out.polygons.length).toBeGreaterThan(1);
    expect(out.polygons.some((p) => p.surface === 99)).toBe(true);
  });

  it('does not merge two polygons that meet along two edges', () => {
    const g: Geometry = { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as Vec3[], polygons: [{ points: [0, 1, 2, 3], surface: 1 }, { points: [3, 2, 1, 0], surface: 1 }] };
    expect(mergeFragments(g, 1e-6).polygons).toHaveLength(2);
  });
});

describe('removeCollinearPoints', () => {
  it('removes a point on a straight edge that only one polygon uses', () => {
    const g: Geometry = { points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]] as Vec3[], polygons: [{ points: [0, 1, 2, 3, 4], surface: 0 }] };
    const out = removeCollinearPoints(g, 1e-6);
    expect(out.polygons[0]!.points).toHaveLength(4);
    expect(out.points).toHaveLength(4);
  });

  it('removes a point shared by two polygons when it is straight in both, and keeps the two consistent', () => {
    // two squares side by side; point 2 = (1,1,0) sits in the middle of their shared edge from (1,0,0) to (1,2,0)
    const g: Geometry = {
      points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0], [0, 1, 0], [2, 0, 0], [2, 2, 0], [5, 5, 5]] as Vec3[],
      polygons: [{ points: [0, 1, 2, 3, 4, 5], surface: 0 }, { points: [1, 6, 7, 3, 2], surface: 0 }],
    };
    const out = removeCollinearPoints(g, 1e-6);
    const coords = (p: number) => out.polygons[p]!.points.map((i) => out.points[i]!.slice(0, 2));
    expect(coords(0)).toEqual([[0, 0], [1, 0], [1, 2], [0, 2]]); // (1,1) and (0,1) are both gone from the left square
    expect(coords(1)).toEqual([[1, 0], [2, 0], [2, 2], [1, 2]]); // and (1,1) from the right one
    // the shared edge is still one edge, run in opposite directions by the two polygons
    const [lo, hi] = [out.points.findIndex((p) => p[0] === 1 && p[1] === 0), out.points.findIndex((p) => p[0] === 1 && p[1] === 2)];
    expect(out.polygons[0]!.points.some((v, k, a) => v === lo && a[(k + 1) % a.length] === hi)).toBe(true);
    expect(out.polygons[1]!.points.some((v, k, a) => v === hi && a[(k + 1) % a.length] === lo)).toBe(true);
    expect(out.points.find((p) => p[0] === 5)).toBeUndefined(); // the unused point went too
  });

  it('keeps a point a third polygon also uses, so no crack opens', () => {
    const g: Geometry = {
      points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0], [1, -1, 0], [1.5, -1, 0]] as Vec3[],
      polygons: [{ points: [0, 1, 2, 3, 4], surface: 0 }, { points: [1, 0, 5], surface: 0 }, { points: [2, 1, 6], surface: 0 }, { points: [1, 5, 6], surface: 0 }],
    };
    const out = removeCollinearPoints(g, 1e-6);
    expect(out.polygons[0]!.points).toHaveLength(5);
  });

  it('keeps corners, and never takes a point out of a triangle', () => {
    const tri: Geometry = { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as Vec3[], polygons: [{ points: [0, 1, 2], surface: 0 }] };
    expect(removeCollinearPoints(tri, 1e-6).polygons[0]!.points).toEqual([0, 1, 2]);
    const sq: Geometry = { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as Vec3[], polygons: [quad(0, 1, 2, 3)] };
    expect(removeCollinearPoints(sq, 1e-6).polygons[0]!.points).toHaveLength(4);
  });

  it('removes a whole chain of collinear points, and keeps the matching UV corners', () => {
    const g: Geometry = {
      points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [3, 3, 0], [0, 3, 0]] as Vec3[],
      polygons: [{ points: [0, 1, 2, 3, 4, 5], surface: 0, uvs: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 3]] }],
    };
    const out = removeCollinearPoints(g, 1e-6);
    expect(out.polygons[0]!.points).toHaveLength(4);
    expect(out.polygons[0]!.uvs).toEqual([[0, 0], [3, 0], [3, 3], [0, 3]]);
  });

  it('does not remove a point that is folded back rather than straight', () => {
    const g: Geometry = { points: [[0, 0, 0], [2, 0, 0], [1, 0, 0], [1, 2, 0], [0, 2, 0]] as Vec3[], polygons: [{ points: [0, 1, 2, 3, 4], surface: 0 }] };
    expect(removeCollinearPoints(g, 1e-6).polygons[0]!.points.length).toBeGreaterThanOrEqual(4);
  });
});

describe('healCracks', () => {
  const tol = 1e-4;
  /** A cube, except that one face uses a copy of a corner a little way off (just beyond the welding tolerance). */
  function crackedCube(gap: number): Geometry {
    const pts: Vec3[] = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) pts.push([x, y, z]);
    const q = (a: number, b: number, c: number, d: number) => ({ points: [a, b, c, d], surface: 0 });
    const g: Geometry = { points: pts, polygons: [q(0, 1, 3, 2), q(4, 6, 7, 5), q(0, 4, 5, 1), q(2, 3, 7, 6), q(0, 2, 6, 4), q(1, 5, 7, 3)] };
    g.points.push([pts[7]![0] + gap, pts[7]![1], pts[7]![2]]); // a second corner 7, a hair away
    g.polygons[1] = q(4, 6, 8, 5); // one face now uses the copy
    return g;
  }

  it('welds points that sit just beyond the tolerance when they are what keeps a crack open', () => {
    const g = crackedCube(1.2 * tol);
    expect(unbalancedEdges(g).length).toBeGreaterThan(0);
    const { geometry, welded } = healCracks(g, tol);
    expect(welded).toBe(1);
    expect(unbalancedEdges(geometry)).toEqual([]);
  });

  it('leaves a healthy mesh exactly as it was', () => {
    const g = crackedCube(0);
    g.points.pop(); // no copy: put the face back on corner 7
    g.polygons[1] = { points: [4, 6, 7, 5], surface: 0 };
    const { geometry, welded } = healCracks(g, tol);
    expect(welded).toBe(0);
    expect(geometry).toEqual(g);
  });

  it('does not weld points that are far apart, even when there is a crack', () => {
    const g = crackedCube(0.5); // half a unit away: a real gap, not a rounding problem
    const { geometry, welded } = healCracks(g, tol);
    expect(welded).toBe(0);
    expect(unbalancedEdges(geometry).length).toBeGreaterThan(0);
  });

  it('does not touch healthy points that merely happen to be close to the crack', () => {
    const g = crackedCube(1.2 * tol);
    g.points.push([0.5, 0.5, 1 + 3 * tol]); // a loose point near the top, unrelated to the crack
    const { geometry } = healCracks(g, tol);
    expect(geometry.points.some((p) => p[0] === 0.5 && p[1] === 0.5)).toBe(true);
  });
});
