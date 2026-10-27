import { describe, expect, it } from 'vitest';
import type { Mesh, Vec3 } from '@/core';
import { defaultValues, PRIMITIVE_NAMES, PRIMITIVES, type PrimitiveName } from './create';
import { createBall, createBox, createCone, createDisc } from './primitives';

/** Every edge shared by exactly two polygons, running in opposite directions: closed and consistently wound. */
function expectWatertight(m: Mesh) {
  const dirs = new Map<string, number>();
  for (const poly of m.polygons) {
    poly.points.forEach((a, i) => {
      const b = poly.points[(i + 1) % poly.points.length]!;
      const key = `${a}>${b}`;
      dirs.set(key, (dirs.get(key) ?? 0) + 1);
    });
  }
  for (const [key, count] of dirs) {
    expect(count, `edge ${key} used ${count} times`).toBe(1);
    const [a, b] = key.split('>');
    expect(dirs.has(`${b}>${a}`), `edge ${key} has no opposite`).toBe(true);
  }
}

/** For a convex solid, each polygon's Newell normal points away from an interior point. */
function expectOutward(m: Mesh, inside: Vec3) {
  m.polygons.forEach((poly, pi) => {
    const pts = poly.points.map((i) => m.points[i]!);
    const n: Vec3 = [0, 0, 0];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      n[0] += (p[1] - q[1]) * (p[2] + q[2]);
      n[1] += (p[2] - q[2]) * (p[0] + q[0]);
      n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const c = [0, 1, 2].map((a) => pts.reduce((sum, p) => sum + p[a]!, 0) / pts.length);
    const dot = n[0] * (c[0]! - inside[0]) + n[1] * (c[1]! - inside[1]) + n[2] * (c[2]! - inside[2]);
    expect(dot, `polygon ${pi} faces inward`).toBeGreaterThan(0);
    expect(new Set(poly.points).size, `polygon ${pi} repeats a point`).toBe(poly.points.length);
  });
}

describe('primitives', () => {
  it('builds a welded, outward-wound segmented box', () => {
    const m = createBox({ size: [2, 1, 3], center: [1, 2, 3], segments: [2, 3, 1] });
    expect(m.polygons).toHaveLength(2 * (3 * 1 + 2 * 1 + 2 * 3));
    // V - E + F = 2 for a closed genus-0 surface
    const edges = m.polygons.reduce((n, p) => n + p.points.length, 0) / 2;
    expect(m.points.length - edges + m.polygons.length).toBe(2);
    expectWatertight(m);
    expectOutward(m, [1, 2, 3]);
  });

  it('builds a ball with the expected topology, for every axis', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const m = createBall({ radius: [1, 2, 3], center: [0, 0, 0], sides: 8, segments: 4, axis });
      expect(m.points).toHaveLength(2 + 3 * 8);
      expect(m.polygons).toHaveLength(8 + 2 * 8 + 8);
      expectWatertight(m);
      expectOutward(m, [0, 0, 0]);
    }
  });

  it('puts the ball poles on the chosen axis, scaled by the world radius', () => {
    const m = createBall({ radius: [1, 2, 3], center: [0, 0, 0], sides: 6, segments: 3, axis: 'z' });
    // top pole: local +Y -> world +Z, scaled by radius z
    [0, 0, 3].forEach((c, i) => expect(m.points[0]![i]).toBeCloseTo(c, 9));
  });

  it('builds a disc with n-gon caps', () => {
    const m = createDisc({ radius: 1, height: 2, center: [0, 0, 0], sides: 6, segments: 2, axis: 'y' });
    expect(m.points).toHaveLength(6 * 3);
    expect(m.polygons).toHaveLength(6 * 2 + 2);
    expect(m.polygons.filter((p) => p.points.length === 6)).toHaveLength(2);
    expectWatertight(m);
    expectOutward(m, [0, 0, 0]);
  });

  it('builds a cone with an apex fan and an n-gon base', () => {
    const m = createCone({ radius: 1, height: 2, center: [0, 0, 0], sides: 6, segments: 3, axis: 'x' });
    expect(m.points).toHaveLength(1 + 6 * 3);
    expect(m.polygons).toHaveLength(6 + 6 * 2 + 1);
    expectWatertight(m);
    expectOutward(m, [0, 0, 0]);
  });
});

describe('primitive specs', () => {
  it.each(PRIMITIVE_NAMES)('%s builds a closed, outward mesh from its defaults', (name: PrimitiveName) => {
    const m = PRIMITIVES[name].build(defaultValues(name));
    expectWatertight(m);
    const c = m.points.reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((x) => x / m.points.length);
    expectOutward(m, name === 'cone' ? [0, 0, 0] : (c as Vec3));
  });
});
