import { describe, expect, it } from 'vitest';
import type { UV, Vec3 } from '@/core';
import { box } from './primitives';
import { cloneGeometry, deletePoints, deletePolygons, extractPolygons, findCoincident, flipPolygons, mergePoints, triangulate, type Geometry } from './geometry';

const unitBox = (): Geometry => cloneGeometry(box());
const uses = (g: Geometry) => new Set(g.polygons.flatMap((p) => p.points));
/** Every polygon refers only to points that exist. */
const consistent = (g: Geometry) => g.polygons.every((p) => p.points.every((i) => i >= 0 && i < g.points.length));

describe('deletePolygons', () => {
  it('removes polygons but keeps points other polygons still use', () => {
    const g = deletePolygons(unitBox(), new Set([0]));
    expect(g.polygons).toHaveLength(5);
    expect(g.points).toHaveLength(8);
    expect(consistent(g)).toBe(true);
  });

  it('removes points that only the deleted polygons used', () => {
    const quad: Geometry = { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], polygons: [{ points: [0, 1, 2, 3], surface: 0 }] };
    expect(deletePolygons(quad, new Set([0]))).toEqual({ points: [], polygons: [] });
  });

  it('leaves a point that was already loose, and renumbers the rest', () => {
    const g = unitBox();
    g.points.unshift([9, 9, 9]); // a loose point at index 0
    g.polygons.forEach((p) => (p.points = p.points.map((i) => i + 1)));
    const out = deletePolygons(g, new Set([0, 1, 2, 3, 4, 5]));
    expect(out.points).toEqual([[9, 9, 9]]);
  });

  it('does not change the geometry it was given', () => {
    const g = unitBox();
    const copy = cloneGeometry(g);
    deletePolygons(g, new Set([0, 1]));
    expect(g).toEqual(copy);
  });
});

describe('deletePoints', () => {
  it('removes the point and every polygon that used it, then renumbers', () => {
    const g = deletePoints(unitBox(), new Set([0]));
    expect(g.points).toHaveLength(7);
    expect(g.polygons).toHaveLength(3); // each box point sits on three faces
    expect(consistent(g)).toBe(true);
    expect(uses(g).size).toBe(7);
  });

  it('keeps the position of every surviving point', () => {
    const original = unitBox();
    const g = deletePoints(original, new Set([3]));
    expect(g.points).toEqual(original.points.filter((_, i) => i !== 3));
  });
});

describe('findCoincident', () => {
  it('maps points onto the lowest numbered point within the tolerance', () => {
    const pts: Vec3[] = [[0, 0, 0], [5, 5, 5], [0.00005, 0, 0], [0, 0.00005, 0], [5, 5, 5.5]];
    expect(findCoincident(pts, [0, 1, 2, 3, 4], 0.0001)).toEqual([0, 1, 0, 0, 4]);
  });

  it('finds neighbours across a grid cell boundary', () => {
    const pts: Vec3[] = [[0.999, 0, 0], [1.001, 0, 0]];
    expect(findCoincident(pts, [0, 1], 1)).toEqual([0, 0]);
  });

  it('only considers the points it is given', () => {
    const pts: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    expect(findCoincident(pts, [1, 2], 0.001)).toEqual([0, 1, 1]);
  });

  it('does not chain: a point beyond the tolerance of the representative stays separate', () => {
    const pts: Vec3[] = [[0, 0, 0], [0.8, 0, 0], [1.6, 0, 0]];
    expect(findCoincident(pts, [0, 1, 2], 1)).toEqual([0, 0, 2]);
  });
});

describe('mergePoints', () => {
  it('welds two coincident boxes into one set of points', () => {
    const a = unitBox();
    const b = unitBox();
    const both: Geometry = { points: [...a.points, ...b.points], polygons: [...a.polygons, ...b.polygons.map((p) => ({ ...p, points: p.points.map((i) => i + 8) }))] };
    const merged = mergePoints(both, findCoincident(both.points, both.points.map((_, i) => i), 0.0001));
    expect(merged.points).toHaveLength(8);
    expect(merged.polygons).toHaveLength(12);
    expect(consistent(merged)).toBe(true);
  });

  it('turns a quad with two merged neighbours into a triangle and drops the matching UV corner', () => {
    const uvs: UV[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const g: Geometry = { points: [[0, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], polygons: [{ points: [0, 1, 2, 3], surface: 0, uvs }] };
    const m = mergePoints(g, [0, 0, 2, 3]);
    expect(m.polygons[0]!.points).toEqual([0, 1, 2]);
    expect(m.polygons[0]!.uvs).toEqual([[0, 0], [1, 1], [0, 1]]);
    expect(m.points).toHaveLength(3);
  });

  it('drops the repeat that wraps around the end of a polygon', () => {
    const g: Geometry = { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]], polygons: [{ points: [3, 1, 2, 0], surface: 0 }] };
    expect(mergePoints(g, [0, 1, 2, 0]).polygons[0]!.points).toEqual([0, 1, 2]);
  });

  it('removes a triangle that collapses to a line', () => {
    const g: Geometry = { points: [[0, 0, 0], [0, 0, 0], [1, 0, 0]], polygons: [{ points: [0, 1, 2], surface: 0 }] };
    expect(mergePoints(g, [0, 0, 2]).polygons).toEqual([]);
  });

  it('is the identity when nothing maps elsewhere', () => {
    const g = unitBox();
    expect(mergePoints(g, g.points.map((_, i) => i))).toEqual(g);
  });
});

describe('flipPolygons', () => {
  it('reverses the winding and the UV corners of the chosen polygons only', () => {
    const g = unitBox();
    g.polygons[0]!.uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const flipped = flipPolygons(g, new Set([0]));
    expect(flipped.polygons[0]!.points).toEqual([...g.polygons[0]!.points].reverse());
    expect(flipped.polygons[0]!.uvs).toEqual([[0, 1], [1, 1], [1, 0], [0, 0]]);
    expect(flipped.polygons[1]).toEqual(g.polygons[1]);
  });

  it('flipping twice gives back the original', () => {
    const g = unitBox();
    const ids = new Set([0, 1, 2]);
    expect(flipPolygons(flipPolygons(g, ids), ids)).toEqual(g);
  });
});

describe('triangulate', () => {
  it('splits quads into fans that keep the UVs of their corners, and reports the new numbering', () => {
    const g = unitBox();
    g.polygons[1]!.uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const { geometry, selected } = triangulate(g, new Set([1, 3]));
    expect(geometry.polygons).toHaveLength(6 + 2);
    expect(selected).toEqual([1, 2, 4, 5]);
    expect(geometry.polygons[1]!.points).toEqual([g.polygons[1]!.points[0], g.polygons[1]!.points[1], g.polygons[1]!.points[2]]);
    expect(geometry.polygons[2]!.uvs).toEqual([[0, 0], [1, 1], [0, 1]]);
    expect(geometry.polygons[0]).toEqual(g.polygons[0]); // untouched
  });

  it('leaves triangles alone but still lists them as selected', () => {
    const tri: Geometry = { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], polygons: [{ points: [0, 1, 2], surface: 0 }] };
    const { geometry, selected } = triangulate(tri, new Set([0]));
    expect(geometry).toEqual(tri);
    expect(selected).toEqual([0]);
  });

  it('handles a pentagon (three triangles)', () => {
    const pent: Geometry = { points: Array.from({ length: 5 }, (_, i): Vec3 => [i, i * i, 0]), polygons: [{ points: [0, 1, 2, 3, 4], surface: 0 }] };
    expect(triangulate(pent, new Set([0])).geometry.polygons.map((p) => p.points)).toEqual([[0, 1, 2], [0, 2, 3], [0, 3, 4]]);
  });
});

describe('extractPolygons', () => {
  it('copies polygons with only their own points and surfaces, renumbered', () => {
    const m = box();
    m.surfaces.push({ ...m.surfaces[0]!, name: 'Other' });
    m.polygons[3]!.surface = 1;
    const clip = extractPolygons(m, [3, 0]);
    expect(clip.polygons).toHaveLength(2);
    expect(clip.points).toHaveLength(6); // the -x and +y faces share an edge: 4 + 4 - 2 points
    expect(clip.surfaces.map((s) => s.name)).toEqual(['Other', 'Default']);
    expect(clip.polygons[0]!.surface).toBe(0);
    expect(clip.polygons[1]!.surface).toBe(1);
    expect(clip.polygons.every((p) => p.points.every((i) => i < clip.points.length))).toBe(true);
  });

  it('copies rather than shares', () => {
    const m = box();
    m.polygons[0]!.uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const clip = extractPolygons(m, [0]);
    clip.points[0]![0] = 99;
    clip.polygons[0]!.uvs![0]![0] = 99;
    expect(m.points[m.polygons[0]!.points[0]!]![0]).not.toBe(99);
    expect(m.polygons[0]!.uvs![0]![0]).not.toBe(99);
  });
});

describe('Mesh used by the clipboard', () => {
  it('append reuses surfaces by name, which paste relies on', () => {
    const target = box();
    const clip = extractPolygons(box(), [0]);
    target.append(clip);
    expect(target.surfaces).toHaveLength(1);
    expect(target.polygons).toHaveLength(7);
  });
});
