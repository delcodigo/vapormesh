import type { Vec3 } from '@/core';
import { clonePolygon, MERGE_TOLERANCE, type Geometry } from './geometry';

export type MirrorAxis = 'x' | 'y' | 'z';
const AXIS_INDEX: Record<MirrorAxis, number> = { x: 0, y: 1, z: 2 };

export interface MirrorOptions {
  /** The plane is perpendicular to this axis: X mirrors left to right. */
  axis: MirrorAxis;
  /** Where the plane cuts the axis. */
  position: number;
  /**
   * Join the two halves along the seam: points of the copy that lie on the plane reuse the original points instead of
   * making duplicates. Polygons that lie flat in the plane are not copied then, since their copy would sit exactly on top
   * of them, facing the other way.
   */
  merge: boolean;
  tolerance?: number;
}

export interface MirrorResult {
  geometry: Geometry;
  /** The new points (not the ones reused from the seam), in the new numbering. */
  newPoints: number[];
  /** The mirrored polygons, appended after the existing ones. */
  newPolygons: number[];
  /** Polygons lying flat in the plane that were left uncopied (only when merging). */
  skipped: number;
}

/**
 * Reflect polygons across a plane. The copies are appended: reflected points, polygons with their winding reversed (a
 * reflection turns a surface inside out, so the order of the points must flip to keep facing outward), the same surface,
 * and UV corners that follow their points. The originals are untouched.
 */
export function mirror(geo: Geometry, ids: ReadonlySet<number>, o: MirrorOptions): MirrorResult {
  const k = AXIS_INDEX[o.axis];
  const tolerance = o.tolerance ?? MERGE_TOLERANCE;
  const onPlane = (v: number) => Math.abs(geo.points[v]![k]! - o.position) <= tolerance;

  const points: Vec3[] = geo.points.map((p): Vec3 => [...p]);
  const polygons = geo.polygons.map(clonePolygon);
  const copyOf = new Map<number, number>();
  const newPoints: number[] = [];
  const newPolygons: number[] = [];
  let skipped = 0;

  const mirrored = (v: number): number => {
    if (o.merge && onPlane(v)) return v; // the seam: the copy of this point is the point itself
    let index = copyOf.get(v);
    if (index === undefined) {
      const p: Vec3 = [...geo.points[v]!];
      p[k] = 2 * o.position - p[k]!;
      index = points.length;
      points.push(p);
      copyOf.set(v, index);
      newPoints.push(index);
    }
    return index;
  };

  for (const id of [...ids].sort((a, b) => a - b)) {
    const source = geo.polygons[id];
    if (!source) continue;
    if (o.merge && source.points.every(onPlane)) {
      skipped++;
      continue;
    }
    const copy = clonePolygon(source);
    copy.points = source.points.map(mirrored).reverse();
    copy.uvs?.reverse();
    newPolygons.push(polygons.length);
    polygons.push(copy);
  }
  return { geometry: { points, polygons }, newPoints, newPolygons, skipped };
}
