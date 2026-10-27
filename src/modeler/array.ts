import { rotateAround, type Vec3 } from '@/core';
import { clonePolygon, type Geometry } from './geometry';

export interface ArrayOptions {
  /** How many copies to add (1 makes a single clone). */
  count: number;
  /** Where each copy sits relative to the one before it. */
  offset: Vec3;
  /** Degrees each copy turns relative to the one before it, about the world X, then Y, then Z axis through `pivot`. */
  rotate: Vec3;
  /** Factor each copy scales by relative to the one before it, about `pivot`. All must be above zero. */
  scale: Vec3;
  pivot: Vec3;
}

export interface ArrayResult {
  geometry: Geometry;
  /** The points and polygons of all the copies, in the new numbering. */
  newPoints: number[];
  newPolygons: number[];
}

/** The most polygons an array may add. Each copy is real geometry, so a typo like 10000 copies must not freeze the editor. */
export const MAX_ARRAY_POLYGONS = 20000;
export const MAX_ARRAY_COUNT = 500;

const AXES: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * Copy polygons again and again. Copy `i` is the original scaled by `scale^i`, turned by `rotate * i` and moved by
 * `offset * i`, so a step of (1, 0, 0) makes a row, and a step of rotation about a pivot makes a ring. Only the points the
 * polygons use are copied, and each copy has its own points: the copies are not joined to anything. Winding, surfaces and
 * UVs come along unchanged. The originals are untouched.
 */
export function array(geo: Geometry, ids: ReadonlySet<number>, o: ArrayOptions): ArrayResult {
  const sources = [...ids].filter((id) => geo.polygons[id]).sort((a, b) => a - b);
  const used = [...new Set(sources.flatMap((id) => geo.polygons[id]!.points))].sort((a, b) => a - b);

  const points: Vec3[] = geo.points.map((p): Vec3 => [...p]);
  const polygons = geo.polygons.map(clonePolygon);
  const newPoints: number[] = [];
  const newPolygons: number[] = [];

  for (let i = 1; i <= o.count; i++) {
    const place = (p: Vec3): Vec3 => {
      let q: Vec3 = [0, 1, 2].map((k) => o.pivot[k]! + (p[k]! - o.pivot[k]!) * Math.pow(o.scale[k]!, i)) as Vec3;
      AXES.forEach((axis, k) => (q = rotateAround(q, o.pivot, axis, (o.rotate[k]! * i * Math.PI) / 180)));
      return [q[0] + o.offset[0] * i, q[1] + o.offset[1] * i, q[2] + o.offset[2] * i];
    };
    const copyOf = new Map<number, number>();
    for (const v of used) {
      copyOf.set(v, points.length);
      newPoints.push(points.length);
      points.push(place(geo.points[v]!));
    }
    for (const id of sources) {
      const copy = clonePolygon(geo.polygons[id]!);
      copy.points = geo.polygons[id]!.points.map((v) => copyOf.get(v)!);
      newPolygons.push(polygons.length);
      polygons.push(copy);
    }
  }
  return { geometry: { points, polygons }, newPoints, newPolygons };
}
