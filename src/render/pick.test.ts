import { describe, expect, it } from 'vitest';
import { Mesh } from '@/core';
import { pickPoint, pickPolygon, type Projector } from './pick';

// Orthographic-ish: x,y map straight to pixels, z is depth.
const proj: Projector = { project: ([x, y, z]) => ({ x, y, z }) };

function quadAt(mesh: Mesh, z: number): number {
  const ids = [[0, 0], [10, 0], [10, 10], [0, 10]].map(([x, y]) => mesh.addPoint([x!, y!, z]));
  return mesh.addPolygon(ids);
}

describe('picking', () => {
  it('picks the nearest point within the radius, or none', () => {
    const m = new Mesh();
    m.addPoint([0, 0, 0]);
    m.addPoint([5, 0, 0]);
    expect(pickPoint(m, proj, 4, 1)).toBe(1);
    expect(pickPoint(m, proj, 50, 50)).toBeNull();
  });

  it('picks the polygon containing the cursor, closest wins on overlap', () => {
    const m = new Mesh();
    const far = quadAt(m, 0.5);
    const near = quadAt(m, -0.5);
    expect(pickPolygon(m, proj, 5, 5)).toBe(near);
    expect(far).toBe(0);
    expect(pickPolygon(m, proj, 20, 5)).toBeNull();
  });
});
