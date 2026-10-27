import { describe, expect, it } from 'vitest';
import type { Vec3 } from './math';
import { assignAutoUvs, boxProjectPolygon, TEXELS_PER_UNIT } from './uv';
import { Mesh } from './mesh';

/** Signed area in (u, v). With v pointing down, a polygon seen counter-clockwise from outside comes out negative. */
const area = (uvs: [number, number][]) =>
  uvs.reduce((s, [u, v], i) => {
    const [u2, v2] = uvs[(i + 1) % uvs.length]!;
    return s + (u * v2 - u2 * v);
  }, 0) / 2;

// the six faces of a 2x2x2 cube, each counter-clockwise seen from outside
const FACES: Record<string, Vec3[]> = {
  '+X': [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
  '-X': [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
  '+Y': [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
  '-Y': [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
  '+Z': [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
  '-Z': [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
};

describe('boxProjectPolygon', () => {
  it.each(Object.keys(FACES))('reads the right way round on the %s face (never mirrored)', (name) => {
    expect(area(boxProjectPolygon(FACES[name]!, 64, 64))).toBeLessThan(0);
  });

  it('keeps world-up as image-up on side faces', () => {
    const [bottomLeft, , topRight] = boxProjectPolygon(FACES['+Z']!, 64, 64);
    expect(topRight![1]).toBeLessThan(bottomLeft![1]); // higher in the world = smaller v
    expect(topRight![0]).toBeGreaterThan(bottomLeft![0]);
  });

  it('uses a fixed texel density: twice the size shows twice the repeats', () => {
    const quad = (s: number): Vec3[] => [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0]];
    const span = (s: number) => {
      const uvs = boxProjectPolygon(quad(s), 64, 64);
      return Math.max(...uvs.map((t) => t[0])) - Math.min(...uvs.map((t) => t[0]));
    };
    expect(span(2)).toBeCloseTo(2 * span(1), 9);
    expect(span(2)).toBeCloseTo((2 * TEXELS_PER_UNIT) / 64, 9); // 2 units * 32 texels / 64
  });

  it('scales with the texture size, so a 128px texture repeats half as often as a 64px one', () => {
    const small = boxProjectPolygon(FACES['+Z']!, 64, 64);
    const large = boxProjectPolygon(FACES['+Z']!, 128, 128);
    expect(large[2]![0] - large[0]![0]).toBeCloseTo((small[2]![0] - small[0]![0]) / 2, 9);
  });

  it('gives points shared by faces on the same axis the same UV, so seams line up', () => {
    const a = boxProjectPolygon([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], 64, 64);
    const b = boxProjectPolygon([[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]], 64, 64);
    expect(a[1]).toEqual(b[0]);
    expect(a[2]).toEqual(b[3]);
  });

  it('does not fail on a polygon with no area', () => {
    const uvs = boxProjectPolygon([[0, 0, 0], [1, 0, 0], [2, 0, 0]], 64, 64);
    expect(uvs.every((t) => t.every(Number.isFinite))).toBe(true);
  });
});

describe('assignAutoUvs and Mesh.append', () => {
  it('gives every polygon a UV per corner', () => {
    const m = new Mesh();
    FACES['+Z']!.forEach((p) => m.addPoint(p));
    m.addPolygon([0, 1, 2, 3]);
    assignAutoUvs(m);
    expect(m.polygons[0]!.uvs).toHaveLength(4);
  });

  it('copies UVs when merging meshes, without sharing arrays', () => {
    const a = new Mesh();
    const b = new Mesh();
    FACES['+Z']!.forEach((p) => b.addPoint(p));
    b.addPolygon([0, 1, 2, 3]);
    assignAutoUvs(b);
    a.append(b);
    expect(a.polygons[0]!.uvs).toEqual(b.polygons[0]!.uvs);
    a.polygons[0]!.uvs![0]![0] = 99;
    expect(b.polygons[0]!.uvs![0]![0]).not.toBe(99);
  });
});
