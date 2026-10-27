import { describe, expect, it } from 'vitest';
import { faceNormal, type Vec3 } from '@/core';
import { averageNormal, extrude, type ExtrudeOptions } from './extrude';
import { cloneGeometry, type Geometry } from './geometry';
import { box, createBox } from './primitives';

const NORMAL: ExtrudeOptions['direction'] = { kind: 'normal' };
const opts = (o: Partial<ExtrudeOptions>): ExtrudeOptions => ({ distance: 0, inset: 0, direction: NORMAL, ...o });
const cube = (): Geometry => cloneGeometry(createBox({ size: [1, 1, 1], center: [0, 0, 0], segments: [1, 1, 1] }));
const pointsOf = (g: Geometry, p: number) => g.polygons[p]!.points.map((i) => g.points[i]!);
/** Index of the polygon whose normal points along `axis` (0, 1, 2) in the given direction. */
const faceTowards = (g: Geometry, axis: number, sign: 1 | -1) =>
  g.polygons.findIndex((_, i) => Math.sign(faceNormal(pointsOf(g, i))[axis]!) === sign && Math.abs(faceNormal(pointsOf(g, i))[axis]!) > 0.5);

/** A closed mesh: every edge is used exactly once in each direction. */
function expectWatertight(g: Geometry) {
  const dirs = new Map<string, number>();
  for (const p of g.polygons) p.points.forEach((a, i) => dirs.set(`${a}>${p.points[(i + 1) % p.points.length]}`, (dirs.get(`${a}>${p.points[(i + 1) % p.points.length]}`) ?? 0) + 1));
  for (const [key, n] of dirs) {
    const [a, b] = key.split('>');
    expect(n, `edge ${key} used ${n} times`).toBe(1);
    expect(dirs.has(`${b}>${a}`), `edge ${key} has no opposite`).toBe(true);
  }
}
const consistent = (g: Geometry) => g.polygons.every((p) => p.points.every((i) => i >= 0 && i < g.points.length));
/** For a convex solid every polygon faces away from an inside point. */
function expectOutward(g: Geometry, inside: Vec3) {
  g.polygons.forEach((_, i) => {
    const pts = pointsOf(g, i);
    const n = faceNormal(pts);
    const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k]!, 0) / pts.length);
    expect(n[0] * (c[0]! - inside[0]) + n[1] * (c[1]! - inside[1]) + n[2] * (c[2]! - inside[2]), `polygon ${i} faces inward`).toBeGreaterThan(0);
  });
}

describe('extrude: a face of a cube', () => {
  const top = (g = cube()) => faceTowards(g, 1, 1);

  it('lifts the face along its normal and builds four walls, keeping the solid closed and outward-facing', () => {
    const g = cube();
    const r = extrude(g, new Set([top(g)]), opts({ distance: 1 }));
    expect(r.geometry.points).toHaveLength(8 + 4);
    expect(r.geometry.polygons).toHaveLength(6 + 4);
    expect(r.walls).toEqual([6, 7, 8, 9]);
    expect(consistent(r.geometry)).toBe(true);
    expectWatertight(r.geometry);
    expectOutward(r.geometry, [0, 1, 0]); // the cube is now a tall box from y=-0.5 to y=1.5
    expect(pointsOf(r.geometry, top(g)).every((p) => p[1] === 1.5)).toBe(true);
  });

  it('keeps the selected polygon at its place in the list, with its UVs and surface', () => {
    const g = cube();
    const t = top(g);
    const uvs = g.polygons[t]!.uvs!;
    g.polygons[t]!.surface = 0;
    const r = extrude(g, new Set([t]), opts({ distance: 0.5 }));
    expect(r.geometry.polygons[t]!.uvs).toEqual(uvs);
    expect(r.geometry.polygons[t]!.surface).toBe(0);
    expect(r.capPoints.sort()).toEqual([...new Set(r.geometry.polygons[t]!.points)].sort());
  });

  it('gives the walls UVs and the surface of the polygon they come from', () => {
    const g = cube();
    g.polygons.forEach((p) => (p.surface = 0));
    const t = top(g);
    g.polygons[t]!.surface = 1;
    const r = extrude(g, new Set([t]), opts({ distance: 1, textureSize: () => [64, 64] }));
    for (const w of r.walls) {
      expect(r.geometry.polygons[w]!.surface).toBe(1);
      expect(r.geometry.polygons[w]!.uvs).toHaveLength(4);
    }
  });

  it('puts no UVs on walls when the polygon has none', () => {
    const g = cube();
    g.polygons.forEach((p) => delete p.uvs);
    const r = extrude(g, new Set([top(g)]), opts({ distance: 1 }));
    expect(r.walls.every((w) => r.geometry.polygons[w]!.uvs === undefined)).toBe(true);
  });

  it('pushes inward with a negative distance: still closed, and the walls face into the hole', () => {
    const g = cube();
    const r = extrude(g, new Set([top(g)]), opts({ distance: -0.25 }));
    expectWatertight(r.geometry);
    expect(pointsOf(r.geometry, top(g)).every((p) => p[1] === 0.25)).toBe(true);
    for (const w of r.walls) {
      const pts = pointsOf(r.geometry, w);
      const n = faceNormal(pts);
      const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k]!, 0) / pts.length);
      expect(n[0] * -c[0]! + n[2] * -c[2]!).toBeGreaterThan(0); // towards the hole's axis (x = z = 0)
    }
  });

  it('extrudes along a fixed vector instead of the normal, slanting the walls', () => {
    const g = cube();
    const r = extrude(g, new Set([top(g)]), opts({ distance: 2, direction: { kind: 'vector', vector: [1, 0, 0] } }));
    expect(pointsOf(r.geometry, top(g)).every((p) => p[1] === 0.5)).toBe(true);
    expect(Math.min(...pointsOf(r.geometry, top(g)).map((p) => p[0]))).toBe(1.5); // -0.5 + 2
    expectWatertight(r.geometry);
  });

  it('normalises a vector direction, so only the distance sets how far', () => {
    const g = cube();
    const a = extrude(g, new Set([top(g)]), opts({ distance: 1, direction: { kind: 'vector', vector: [0, 7, 0] } }));
    expect(pointsOf(a.geometry, top(g)).every((p) => p[1] === 1.5)).toBe(true);
  });

  it('does not change what it was given', () => {
    const g = cube();
    const copy = cloneGeometry(g);
    extrude(g, new Set([top(g)]), opts({ distance: 1, inset: 0.1 }));
    expect(g).toEqual(copy);
  });
});

describe('extrude: inset (the bevel)', () => {
  const top = (g: Geometry) => faceTowards(g, 1, 1);

  it('shrinks the outline of the new face evenly, miter-corrected at the corners', () => {
    const g = cube();
    const r = extrude(g, new Set([top(g)]), opts({ inset: 0.1 }));
    const xs = pointsOf(r.geometry, top(g)).map((p) => p[0]);
    const zs = pointsOf(r.geometry, top(g)).map((p) => p[2]);
    expect(Math.max(...xs)).toBeCloseTo(0.4, 9);
    expect(Math.min(...xs)).toBeCloseTo(-0.4, 9);
    expect(Math.max(...zs)).toBeCloseTo(0.4, 9);
    expect(pointsOf(r.geometry, top(g)).every((p) => p[1] === 0.5)).toBe(true); // an inset alone does not lift it
    expectWatertight(r.geometry);
  });

  it('makes flat ring walls that face the same way as the face, when only inset', () => {
    const g = cube();
    const r = extrude(g, new Set([top(g)]), opts({ inset: 0.1 }));
    for (const w of r.walls) expect(faceNormal(pointsOf(r.geometry, w))[1]).toBeGreaterThan(0);
  });

  it('with a distance as well, chamfers: the new face is smaller and higher, the walls slope', () => {
    const g = cube();
    const r = extrude(g, new Set([top(g)]), opts({ distance: 0.2, inset: 0.2 }));
    const cap = pointsOf(r.geometry, top(g));
    expect(cap.every((p) => Math.abs(p[1] - 0.7) < 1e-9)).toBe(true);
    expect(Math.max(...cap.map((p) => p[0]))).toBeCloseTo(0.3, 9);
    for (const w of r.walls) {
      const n = faceNormal(pointsOf(r.geometry, w));
      expect(n[1]).toBeGreaterThan(0); // tilted upwards...
      expect(Math.hypot(n[0], n[2])).toBeGreaterThan(0); // ...and sideways
    }
    expectWatertight(r.geometry);
  });

  it('a negative inset grows the outline', () => {
    const g = cube();
    const r = extrude(g, new Set([top(g)]), opts({ inset: -0.1 }));
    expect(Math.max(...pointsOf(r.geometry, top(g)).map((p) => p[0]))).toBeCloseTo(0.6, 9);
  });
});

describe('extrude: bigger selections', () => {
  it('builds walls only around the outside of two neighbouring faces, none on the edge they share', () => {
    const g = cube();
    const [a, b] = [faceTowards(g, 1, 1), faceTowards(g, 2, 1)];
    const r = extrude(g, new Set([a, b]), opts({ distance: 0.5 }));
    expect(r.walls).toHaveLength(6); // two quads have 8 edges, 2 of them shared
    expectWatertight(r.geometry);
    expect(consistent(r.geometry)).toBe(true);
  });

  it('removes the old interior points of a subdivided face, keeping only what walls and neighbours use', () => {
    const g = cloneGeometry(createBox({ size: [1, 1, 1], center: [0, 0, 0], segments: [2, 2, 2] }));
    const topFaces = g.polygons.map((_, i) => i).filter((i) => pointsOf(g, i).every((p) => p[1] === 0.5));
    expect(topFaces).toHaveLength(4);
    const r = extrude(g, new Set(topFaces), opts({ distance: 1 }));
    // old points: 26 on the cube. The top face has 9; the centre one is only used by the selection, so it goes.
    // new points: 9 copies.
    expect(r.geometry.points).toHaveLength(26 - 1 + 9);
    expect(r.walls).toHaveLength(8); // the outline of the 2x2 patch
    expectWatertight(r.geometry);
  });

  it('with every face selected there is no boundary, so no walls: the shell moves out along its smoothed normals', () => {
    const g = cube();
    const r = extrude(g, new Set(g.polygons.map((_, i) => i)), opts({ distance: 0.1 }));
    expect(r.walls).toEqual([]);
    expect(r.geometry.polygons).toHaveLength(6);
    expect(r.geometry.points).toHaveLength(8); // the old eight are gone
    const corner = r.geometry.points[0]!;
    expect(Math.hypot(...corner)).toBeCloseTo(Math.hypot(0.5, 0.5, 0.5) + 0.1, 9);
    expectWatertight(r.geometry);
  });

  it('leaves unselected polygons and loose points alone', () => {
    const g = cube();
    g.points.push([9, 9, 9]); // a loose point
    const r = extrude(g, new Set([faceTowards(g, 1, 1)]), opts({ distance: 1 }));
    expect(r.geometry.points.some((p) => p[0] === 9 && p[1] === 9 && p[2] === 9)).toBe(true);
    const untouched = faceTowards(g, 1, -1);
    expect(pointsOf(r.geometry, untouched)).toEqual(pointsOf(g, untouched));
  });

  it('ignores ids that are not polygons, and an empty selection changes nothing but copies', () => {
    const g = cube();
    const r = extrude(g, new Set([99]), opts({ distance: 1 }));
    expect(r.geometry).toEqual(g);
    expect(r.walls).toEqual([]);
  });
});

describe('averageNormal', () => {
  it('points the way a selection faces, and is zero when the faces cancel out', () => {
    const g = cube();
    expect(averageNormal(g, [faceTowards(g, 1, 1)])).toEqual([0, 1, 0]);
    expect(averageNormal(g, [faceTowards(g, 1, 1), faceTowards(g, 1, -1)])).toEqual([0, 0, 0]);
    expect(averageNormal(g, [])).toEqual([0, 0, 0]);
  });

  it('works on the unit-box helper too', () => {
    expect(averageNormal(box(), [0])[0]).toBe(-1); // the -x face
  });
});
