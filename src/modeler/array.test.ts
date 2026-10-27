import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { array, type ArrayOptions } from './array';
import { arraySelection } from './edit';
import type { Geometry } from './geometry';
import { box } from './primitives';
import { ModelerState } from './state';

const near = (a: Vec3, b: Vec3, digits = 9) => a.forEach((c, i) => expect(c, `${a} vs ${b}`).toBeCloseTo(b[i]!, digits));
const opts = (o: Partial<ArrayOptions> = {}): ArrayOptions => ({ count: 1, offset: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0], ...o });
/** One textured triangle, so winding and UVs can be checked. */
const triangle = (): Geometry => ({
  points: [[1, 0, 0], [2, 0, 0], [1, 1, 0], [9, 9, 9]],
  polygons: [{ points: [0, 1, 2], surface: 0, uvs: [[0, 0], [1, 0], [0, 1]] }],
});

describe('array', () => {
  it('makes a row: copy i is the original moved by i steps, with its own points', () => {
    const g = triangle();
    const r = array(g, new Set([0]), opts({ count: 3, offset: [0, 0, 2] }));
    expect(r.geometry.points).toHaveLength(4 + 3 * 3); // only the three used points are copied
    expect(r.geometry.polygons).toHaveLength(4);
    r.newPolygons.forEach((pi, i) => {
      const poly = r.geometry.polygons[pi]!;
      poly.points.forEach((v, k) => near(r.geometry.points[v]!, [g.points[k]![0], g.points[k]![1], g.points[k]![2] + 2 * (i + 1)]));
    });
    // no copy shares a point with the original or another copy
    const all = r.newPolygons.flatMap((pi) => r.geometry.polygons[pi]!.points);
    expect(new Set(all).size).toBe(9);
    expect(all.every((v) => v >= 4)).toBe(true);
  });

  it('leaves the originals alone, and keeps winding, surface and UVs', () => {
    const g = triangle();
    const r = array(g, new Set([0]), opts({ count: 2, offset: [1, 0, 0] }));
    expect(r.geometry.points.slice(0, 4)).toEqual(g.points);
    expect(r.geometry.polygons[0]).toEqual(g.polygons[0]);
    for (const pi of r.newPolygons) {
      const p = r.geometry.polygons[pi]!;
      expect(p.uvs).toEqual([[0, 0], [1, 0], [0, 1]]);
      expect(p.uvs).not.toBe(g.polygons[0]!.uvs); // a copy, not shared
      expect(p.surface).toBe(0);
      // same order: the first corner of the copy is the copy of the first corner
      near(r.geometry.points[p.points[1]!]!, [r.geometry.points[p.points[0]!]![0] + 1, 0, 0]);
    }
  });

  it('turns about the pivot: four quarter turns make a ring', () => {
    const g: Geometry = { points: [[1, 0, 0], [2, 0, 0], [1, 1, 0]], polygons: [{ points: [0, 1, 2], surface: 0 }] };
    const r = array(g, new Set([0]), opts({ count: 3, rotate: [0, 0, 90] }));
    const first = (i: number) => r.geometry.points[r.geometry.polygons[r.newPolygons[i]!]!.points[0]!]!;
    near(first(0), [0, 1, 0]);
    near(first(1), [-1, 0, 0]);
    near(first(2), [0, -1, 0]);
    // and every copy keeps its shape: distances between its points are the original's
    for (const pi of r.newPolygons) {
      const [a, b] = r.geometry.polygons[pi]!.points.map((v) => r.geometry.points[v]!);
      expect(Math.hypot(b![0] - a![0], b![1] - a![1], b![2] - a![2])).toBeCloseTo(1, 12);
    }
  });

  it('turns about a pivot that is not the origin', () => {
    const g: Geometry = { points: [[3, 1, 0], [4, 1, 0], [3, 2, 0]], polygons: [{ points: [0, 1, 2], surface: 0 }] };
    const r = array(g, new Set([0]), opts({ count: 1, rotate: [0, 0, 180], pivot: [2, 1, 0] }));
    near(r.geometry.points[r.geometry.polygons[1]!.points[0]!]!, [1, 1, 0]);
  });

  it('scales by the factor to the power of the copy number, about the pivot', () => {
    const g: Geometry = { points: [[1, 1, 1], [2, 1, 1], [1, 2, 1]], polygons: [{ points: [0, 1, 2], surface: 0 }] };
    const r = array(g, new Set([0]), opts({ count: 3, scale: [2, 1, 0.5], pivot: [0, 0, 0] }));
    const first = (i: number) => r.geometry.points[r.geometry.polygons[r.newPolygons[i]!]!.points[0]!]!;
    near(first(0), [2, 1, 0.5]);
    near(first(1), [4, 1, 0.25]);
    near(first(2), [8, 1, 0.125]);
  });

  it('applies scale, then turn, then offset, each copy built from the original rather than the one before', () => {
    const g: Geometry = { points: [[1, 0, 0], [2, 0, 0], [1, 1, 0]], polygons: [{ points: [0, 1, 2], surface: 0 }] };
    const r = array(g, new Set([0]), opts({ count: 2, scale: [2, 2, 2], rotate: [0, 0, 90], offset: [0, 0, 5] }));
    const first = (i: number) => r.geometry.points[r.geometry.polygons[r.newPolygons[i]!]!.points[0]!]!;
    near(first(0), [0, 2, 5]); // (1,0,0) -> scaled (2,0,0) -> turned (0,2,0) -> moved
    near(first(1), [-4, 0, 10]); // scaled by 4, turned 180 degrees
  });

  it('copies just the polygons asked for, and ignores ids that do not exist', () => {
    const g = box(1, 1, 1);
    const r = array(g, new Set([0, 99]), opts({ count: 2, offset: [3, 0, 0] }));
    expect(r.newPolygons).toHaveLength(2);
    expect(r.geometry.polygons).toHaveLength(6 + 2);
    expect(r.geometry.points).toHaveLength(8 + 2 * 4);
  });
});

describe('arraySelection', () => {
  const fresh = () => {
    const s = new ModelerState(box(1, 1, 1));
    s.setSnap(0);
    return s;
  };
  const settings = { count: 3, offset: [2, 0, 0] as Vec3, rotate: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 };

  it('copies the whole layer when nothing is selected, selects the copies, and undoes as one step', () => {
    const s = fresh();
    expect(arraySelection(s, settings)).toEqual({ ok: true, message: 'Added 3 copies of 6 polygons' });
    expect(s.mesh.points).toHaveLength(32);
    expect(s.mesh.polygons).toHaveLength(24);
    expect(s.selectedPoints.size).toBe(24);
    expect(s.selectedPolygons.size).toBe(18);
    expect(Math.max(...s.mesh.points.map((p) => p[0]))).toBeCloseTo(6.5, 12);
    s.undo();
    expect(s.mesh.points).toHaveLength(8);
    expect(s.mesh.polygons).toHaveLength(6);
    expect(s.history.canUndo).toBe(false);
    s.redo();
    expect(s.mesh.polygons).toHaveLength(24);
  });

  it('copies only the selected polygons', () => {
    const s = fresh();
    s.setMode('polygons');
    s.applyPick(0, 'replace');
    expect(arraySelection(s, { ...settings, count: 1 }).message).toBe('Added 1 copy of 1 polygon');
    expect(s.mesh.polygons).toHaveLength(7);
  });

  it('turns about the placed pivot when there is one', () => {
    const s = fresh();
    s.setPivot([10, 0, 0]);
    arraySelection(s, { ...settings, count: 1, offset: [0, 0, 0], rotate: [0, 0, 180] });
    // the box centred on the origin, turned half a way about (10,0,0), ends up centred on (20,0,0)
    const xs = s.mesh.points.slice(8).map((p) => p[0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(20, 9);
  });

  it.each<[string, Partial<typeof settings>, string]>([
    ['no copies', { count: 0 }, 'whole number'],
    ['half a copy', { count: 1.5 }, 'whole number'],
    ['too many copies', { count: 501 }, 'At most 500'],
    ['a field that is not a number', { offset: [NaN, 0, 0] }, 'every field'],
    ['a size of zero', { scale: [1, 0, 1] }, 'above zero'],
    ['a negative size', { scale: [-1, 1, 1] }, 'above zero'],
  ])('refuses %s without touching the model', (_name, patch, text) => {
    const s = fresh();
    const r = arraySelection(s, { ...settings, ...patch });
    expect(r.ok).toBe(false);
    expect(r.message).toContain(text);
    expect(s.mesh.polygons).toHaveLength(6);
    expect(s.history.canUndo).toBe(false);
  });

  it('refuses an array that would add too many polygons, and an empty layer', () => {
    const s = fresh();
    expect(arraySelection(s, { ...settings, count: 10 }).ok).toBe(true); // 66 polygons now, the 60 new ones selected
    const before = s.mesh.polygons.length;
    expect(arraySelection(s, { ...settings, count: 400 }).message).toBe('That would add 24000 polygons; the limit is 20000');
    expect(s.mesh.polygons).toHaveLength(before);
    expect(arraySelection(new ModelerState(), settings).message).toBe('There is nothing to copy');
  });
});
