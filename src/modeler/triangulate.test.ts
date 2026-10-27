import { describe, expect, it } from 'vitest';
import { faceNormal, type Vec3 } from '@/core';
import { earClip } from './triangulate';

const area = (pts: Vec3[], tris: [number, number, number][]) => tris.reduce((s, t) => s + Math.hypot(...faceNormal(t.map((i) => pts[i]!))) / 2, 0);
/** Signed area along +Z: positive for counter-clockwise seen from +Z. */
const signedZ = (pts: Vec3[], t: [number, number, number]) => faceNormal(t.map((i) => pts[i]!))[2];

describe('earClip', () => {
  it('leaves a triangle alone and splits a convex polygon into n - 2 triangles', () => {
    expect(earClip([[0, 0, 0], [1, 0, 0], [0, 1, 0]])).toEqual([[0, 1, 2]]);
    const pentagon: Vec3[] = Array.from({ length: 5 }, (_, i): Vec3 => [Math.cos((i * 2 * Math.PI) / 5), Math.sin((i * 2 * Math.PI) / 5), 0]);
    expect(earClip(pentagon)).toHaveLength(3);
    expect(area(pentagon, earClip(pentagon))).toBeCloseTo((5 / 2) * Math.sin((2 * Math.PI) / 5), 9);
  });

  it('triangulates an L-shape without covering the notch', () => {
    const L: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]];
    const tris = earClip(L);
    expect(tris).toHaveLength(4);
    expect(area(L, tris)).toBeCloseTo(3, 9); // 2x1 plus 1x1; a bad fan would also cover part of the notch
    for (const t of tris) expect(signedZ(L, t)).toBeGreaterThan(0);
  });

  it('handles a polygon wound the other way, keeping that winding', () => {
    const L: Vec3[] = [[0, 2, 0], [1, 2, 0], [1, 1, 0], [2, 1, 0], [2, 0, 0], [0, 0, 0]];
    const tris = earClip(L);
    expect(area(L, tris)).toBeCloseTo(3, 9);
    for (const t of tris) expect(signedZ(L, t)).toBeLessThan(0);
  });

  it('triangulates a comb (several reflex corners) exactly', () => {
    const comb: Vec3[] = [[0, 0, 0], [5, 0, 0], [5, 2, 0], [4, 2, 0], [4, 1, 0], [3, 1, 0], [3, 2, 0], [2, 2, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]];
    const tris = earClip(comb);
    expect(area(comb, tris)).toBeCloseTo(5 + 3 * 1 /* the three teeth */ + 0, 9);
    expect(tris.length).toBeLessThanOrEqual(10);
  });

  it('works for polygons in any plane, not just z = 0', () => {
    const wall: Vec3[] = [[0, 0, 0], [0, 0, 2], [0, 1, 2], [0, 1, 1], [0, 2, 1], [0, 2, 0]];
    expect(area(wall, earClip(wall))).toBeCloseTo(3, 9);
    const tilted: Vec3[] = [[0, 0, 0], [3, 0, 3], [3, 3, 3], [0, 3, 0]];
    expect(earClip(tilted)).toHaveLength(2);
    expect(area(tilted, earClip(tilted))).toBeCloseTo(3 * 3 * Math.SQRT2, 9);
  });

  it('skips points that lie on the line between their neighbours', () => {
    const square: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]; // (1,0) is on the bottom edge
    const tris = earClip(square);
    expect(area(square, tris)).toBeCloseTo(4, 9);
    expect(tris.every((t) => Math.abs(signedZ(square, t)) > 1e-9)).toBe(true);
  });

  it('copes with fewer than three points and with a degenerate polygon', () => {
    expect(earClip([])).toEqual([]);
    expect(earClip([[0, 0, 0], [1, 0, 0]])).toEqual([]);
    expect(() => earClip([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])).not.toThrow();
  });
});
