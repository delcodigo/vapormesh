import { assignAutoUvs, defaultSurface, Mesh, type Vec3 } from '@/core';

export function box(w = 1, h = 1, d = 1): Mesh {
  const m = new Mesh();
  const [x, y, z] = [w / 2, h / 2, d / 2];
  for (const sx of [-x, x]) for (const sy of [-y, y]) for (const sz of [-z, z]) m.addPoint([sx, sy, sz]);
  // point index = (sx?4:0)+(sy?2:0)+(sz?1:0); counter-clockwise outward
  const quads = [
    [0, 1, 3, 2], [4, 6, 7, 5], // -x, +x
    [0, 4, 5, 1], [2, 3, 7, 6], // -y, +y
    [0, 2, 6, 4], [1, 5, 7, 3], // -z, +z
  ];
  for (const q of quads) m.addPolygon(q);
  return m;
}

// --- parametric primitives -------------------------------------------------------------------------
// Everything below is built so that polygons wind counter-clockwise seen from outside, and shapes are
// watertight (shared points are welded), which the tests check.

export type Axis = 'x' | 'y' | 'z';

/** Rotate geometry built around +Y so its axis points along `axis` (proper rotations: winding survives). */
function toAxis([a, b, c]: Vec3, axis: Axis): Vec3 {
  if (axis === 'z') return [a, -c, b];
  if (axis === 'x') return [b, -a, c];
  return [a, b, c];
}

/** Curved shapes default to a Gouraud surface; the 89 degree threshold keeps cap edges hard. */
function smoothSurface() {
  return { ...defaultSurface('Smooth'), smoothing: true };
}

/** Scale locally, orient to `axis`, scale in world axes, then translate. */
function place(m: Mesh, axis: Axis, local: Vec3, world: Vec3, center: Vec3): Mesh {
  m.surfaces = [smoothSurface()];
  m.points = m.points.map((p) => {
    const q = toAxis([p[0] * local[0], p[1] * local[1], p[2] * local[2]], axis);
    return [q[0] * world[0] + center[0], q[1] * world[1] + center[1], q[2] * world[2] + center[2]];
  });
  assignAutoUvs(m);
  return m;
}

/** A ring of `sides` points at height y. Angle increases clockwise seen from +Y. */
function addRing(m: Mesh, sides: number, y: number, radius: number): number[] {
  return Array.from({ length: sides }, (_, k) => {
    const t = (2 * Math.PI * k) / sides;
    return m.addPoint([radius * Math.cos(t), y, radius * Math.sin(t)]);
  });
}

/** Quads between two rings (upper then lower), outward-facing. */
function bandBetween(m: Mesh, upper: number[], lower: number[]): void {
  const n = upper.length;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    m.addPolygon([upper[k]!, upper[k1]!, lower[k1]!, lower[k]!]);
  }
}

export interface BoxParams {
  size: Vec3;
  center: Vec3;
  segments: Vec3;
}

/** Box subdivided into segments, with points shared along edges. */
export function createBox({ size, center, segments }: BoxParams): Mesh {
  const m = new Mesh();
  const welded = new Map<string, number>();
  const point = (p: Vec3) => {
    const key = p.map((c) => c.toFixed(9)).join(',');
    let id = welded.get(key);
    if (id === undefined) welded.set(key, (id = m.addPoint(p)));
    return id;
  };
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const sign of [1, -1]) {
      const at = (i: number, j: number): number => {
        const p: Vec3 = [0, 0, 0];
        p[a] = (sign * size[a]!) / 2 + center[a]!;
        p[u] = center[u]! - size[u]! / 2 + (size[u]! * i) / segments[u]!;
        p[v] = center[v]! - size[v]! / 2 + (size[v]! * j) / segments[v]!;
        return point(p);
      };
      for (let i = 0; i < segments[u]!; i++) {
        for (let j = 0; j < segments[v]!; j++) {
          const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]; // normal +e_a
          m.addPolygon(sign > 0 ? quad : quad.reverse());
        }
      }
    }
  }
  assignAutoUvs(m);
  return m;
}

export interface BallParams {
  radius: Vec3;
  center: Vec3;
  sides: number; // around the axis
  segments: number; // pole to pole
  axis: Axis;
}

/** UV sphere / ellipsoid: triangle fans at the poles, quads between. */
export function createBall({ radius, center, sides, segments, axis }: BallParams): Mesh {
  const m = new Mesh();
  const top = m.addPoint([0, 1, 0]);
  const rings = Array.from({ length: segments - 1 }, (_, i) => {
    const phi = (Math.PI * (i + 1)) / segments;
    return addRing(m, sides, Math.cos(phi), Math.sin(phi));
  });
  const bottom = m.addPoint([0, -1, 0]);
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  for (let k = 0; k < sides; k++) m.addPolygon([top, first[(k + 1) % sides]!, first[k]!]);
  for (let i = 0; i < rings.length - 1; i++) bandBetween(m, rings[i]!, rings[i + 1]!);
  for (let k = 0; k < sides; k++) m.addPolygon([bottom, last[k]!, last[(k + 1) % sides]!]);
  return place(m, axis, [1, 1, 1], radius, center);
}

export interface RoundParams {
  radius: number;
  height: number;
  center: Vec3;
  sides: number;
  segments: number; // along the height
  axis: Axis;
}

/** Cylinder with n-gon caps ("Disc" in LightWave). */
export function createDisc({ radius, height, center, sides, segments, axis }: RoundParams): Mesh {
  const m = new Mesh();
  const rings = Array.from({ length: segments + 1 }, (_, j) => addRing(m, sides, 0.5 - j / segments, 1));
  for (let j = 0; j < segments; j++) bandBetween(m, rings[j]!, rings[j + 1]!);
  m.addPolygon([...rings[0]!].reverse());
  m.addPolygon([...rings[segments]!]);
  return place(m, axis, [radius, height, radius], [1, 1, 1], center);
}

/** Cone with its apex on +axis and an n-gon base. */
export function createCone({ radius, height, center, sides, segments, axis }: RoundParams): Mesh {
  const m = new Mesh();
  const apex = m.addPoint([0, 0.5, 0]);
  const rings = Array.from({ length: segments }, (_, i) => addRing(m, sides, 0.5 - (i + 1) / segments, (i + 1) / segments));
  for (let k = 0; k < sides; k++) m.addPolygon([apex, rings[0]![(k + 1) % sides]!, rings[0]![k]!]);
  for (let i = 0; i < segments - 1; i++) bandBetween(m, rings[i]!, rings[i + 1]!);
  m.addPolygon([...rings[segments - 1]!]);
  return place(m, axis, [radius, height, radius], [1, 1, 1], center);
}
