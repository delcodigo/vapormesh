import { describe, expect, it } from 'vitest';
import { Mesh, type Vec3 } from '@/core';
import { box, createBall } from '@/modeler';
import { buildSurfaceBuffers } from './shading';

const normalsOf = (b: { normals: number[] }): Vec3[] =>
  Array.from({ length: b.normals.length / 3 }, (_, i) => [b.normals[i * 3]!, b.normals[i * 3 + 1]!, b.normals[i * 3 + 2]!]);

describe('buildSurfaceBuffers UVs', () => {
  it('emits two UV floats per vertex, taken from the polygon corners that make each triangle', () => {
    const m = box();
    m.polygons[0]!.uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const b = buildSurfaceBuffers(m, 0);
    expect(b.uvs).toHaveLength((b.positions.length / 3) * 2);
    // first quad -> triangles (0,1,2) and (0,2,3)
    expect(b.uvs.slice(0, 12)).toEqual([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
  });

  it('uses (0, 0) for polygons without UVs', () => {
    const b = buildSurfaceBuffers(box(), 0);
    expect(b.uvs.every((v) => v === 0)).toBe(true);
  });
});

describe('buildSurfaceBuffers', () => {
  it('triangulates n-gons as fans and gives flat surfaces one normal per face', () => {
    const m = box();
    const b = buildSurfaceBuffers(m, 0);
    expect(b.positions.length / 9).toBe(12); // 6 quads -> 12 triangles
    const distinct = new Set(normalsOf(b).map((n) => n.map((c) => c.toFixed(6)).join()));
    expect(distinct.size).toBe(6);
  });

  it('keeps cube edges hard under the default 89 degree threshold, even when smoothed', () => {
    const m = box();
    m.surfaces[0]!.smoothing = true;
    const distinct = new Set(normalsOf(buildSurfaceBuffers(m, 0)).map((n) => n.map((c) => c.toFixed(6)).join()));
    expect(distinct.size).toBe(6);
  });

  it('rounds the cube corners once the threshold allows it', () => {
    const m = box();
    m.surfaces[0]!.smoothing = true;
    m.surfaces[0]!.smoothingAngle = 91;
    const ns = normalsOf(buildSurfaceBuffers(m, 0));
    const s = 1 / Math.sqrt(3);
    for (const n of ns) expect(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2])).toBeCloseTo(3 * s, 6);
  });

  it('makes a smooth ball shade as a sphere: normals point away from the centre', () => {
    const m = createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 24, segments: 12, axis: 'y' });
    const b = buildSurfaceBuffers(m, 0);
    const ns = normalsOf(b);
    ns.forEach((n, i) => {
      const p: Vec3 = [b.positions[i * 3]!, b.positions[i * 3 + 1]!, b.positions[i * 3 + 2]!];
      expect(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]).toBeGreaterThan(0.97);
    });
  });

  it('only smooths within one surface and only includes that surface\'s polygons', () => {
    const m = createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 8, segments: 4, axis: 'y' });
    m.surfaces.push({ ...m.surfaces[0]!, name: 'Other' });
    m.polygons.forEach((p, i) => (p.surface = i % 2));
    const a = buildSurfaceBuffers(m, 0);
    const b = buildSurfaceBuffers(m, 1);
    expect(a.positions.length).toBeGreaterThan(0);
    expect(a.positions.length + b.positions.length).toBe(buildSurfaceBuffers(m, 0).positions.length * 2 - (a.positions.length - b.positions.length));
    expect(buildSurfaceBuffers(m, 5).positions).toEqual([]); // no such surface
  });

  it('skips polygons with no area', () => {
    const m = new Mesh();
    const [a, b, c] = [m.addPoint([0, 0, 0]), m.addPoint([1, 0, 0]), m.addPoint([2, 0, 0])];
    m.addPolygon([a, b, c]); // collinear
    expect(buildSurfaceBuffers(m, 0).positions).toEqual([]);
  });
});
