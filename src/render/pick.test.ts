import { describe, expect, it } from 'vitest';
import { Mesh } from '@/core';
import { pickPoint, pickPolygon, pointsInRect, polygonsInRect, type Projector } from './pick';

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

describe('box queries', () => {
  it('finds points inside a rectangle regardless of corner order', () => {
    const m = new Mesh();
    m.addPoint([1, 1, 0]);
    m.addPoint([9, 9, 0]);
    m.addPoint([5, 5, 5]); // behind the far plane: never selectable
    expect(pointsInRect(m, proj, { x0: 6, y0: 6, x1: 0, y1: 0 })).toEqual([0]);
  });

  it('selects polygons by their projected centre', () => {
    const m = new Mesh();
    const q = quadAt(m, 0); // centre (5, 5)
    expect(polygonsInRect(m, proj, { x0: 4, y0: 4, x1: 6, y1: 6 })).toEqual([q]);
    expect(polygonsInRect(m, proj, { x0: 0, y0: 0, x1: 4, y1: 4 })).toEqual([]);
  });
});
