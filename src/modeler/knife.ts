import { faceNormal, type Polygon, type UV, type Vec3 } from '@/core';
import { clonePolygon, isConvexPolygon, MERGE_TOLERANCE, type Geometry } from './geometry';

/** The points p with dot(normal, p) = offset. `normal` need not be a unit vector. */
export interface CutPlane {
  normal: Vec3;
  offset: number;
}

export interface KnifeOptions {
  /**
   * Do not share the points on the cut between the two sides: the part on the plane's positive side gets copies of them,
   * so the halves come apart there (the copies sit exactly on the originals until you move one side).
   */
  separate: boolean;
  tolerance?: number;
}

export interface KnifeResult {
  geometry: Geometry;
  /** Points on the cut: the ones created, any existing points that lay on the plane, and the copies when separating. */
  cutPoints: number[];
  /** For each polygon that was split: the part that kept its number, and the numbers of the parts added at the end. */
  split: { kept: number; added: number[] }[];
  /** Unselected polygons that got an extra point on an edge, so no crack opens where they meet a cut polygon. */
  repaired: number;
}

/** The cut plane through a line drawn in a view: it contains the line and the direction the view looks along. */
export function planeThroughLine(a: Vec3, b: Vec3, viewAxis: Vec3): CutPlane | null {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n: Vec3 = [d[1] * viewAxis[2] - d[2] * viewAxis[1], d[2] * viewAxis[0] - d[0] * viewAxis[2], d[0] * viewAxis[1] - d[1] * viewAxis[0]];
  const len = Math.hypot(...n);
  if (len < 1e-12) return null;
  const unit: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
  return { normal: unit, offset: unit[0] * a[0] + unit[1] * a[1] + unit[2] * a[2] };
}

export const axisPlane = (axis: 'x' | 'y' | 'z', position: number): CutPlane => ({
  normal: axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1],
  offset: position,
});

const lerp = (a: UV, b: UV, t: number): UV => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

interface Piece {
  points: number[];
  uvs?: UV[];
}

/**
 * Cut polygons along a plane. Every selected polygon with points strictly on both sides is split in two, with a new point on
 * each edge it crosses (shared with whatever else uses that edge, and with UVs interpolated along it). Polygons that only
 * touch the plane, or lie in it, are left alone. A polygon that is not convex is first split into a triangle fan, so a line can
 * cross it any number of times. The part of a split polygon on the plane's negative side keeps its number, the other is
 * appended. Neighbours that were not selected get the new points on their shared edges, so the mesh stays watertight.
 */
export function knife(geo: Geometry, ids: ReadonlySet<number>, plane: CutPlane, o: KnifeOptions): KnifeResult {
  const eps = (o.tolerance ?? MERGE_TOLERANCE) * Math.hypot(...plane.normal);
  const dist = geo.points.map((p) => plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.offset);
  const side = dist.map((d) => (d > eps ? 1 : d < -eps ? -1 : 0));

  const points: Vec3[] = geo.points.map((p): Vec3 => [...p]);
  // a new point per crossed edge, shared by every polygon that uses the edge. a < b; the point is a + t (b - a)
  const crossings = new Map<string, { m: number; a: number; b: number; t: number }>();
  const keyOf = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const crossingOf = (u: number, v: number) => {
    const key = keyOf(u, v);
    let c = crossings.get(key);
    if (!c) {
      const [a, b] = u < v ? [u, v] : [v, u];
      const t = dist[a]! / (dist[a]! - dist[b]!);
      const pa = geo.points[a]!;
      const pb = geo.points[b]!;
      c = { m: points.length, a, b, t };
      points.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t]);
      crossings.set(key, c);
    }
    return c;
  };
  /** t along the way from `from` to `to`, whichever way round the edge was recorded */
  const along = (c: { a: number; t: number }, from: number) => (from === c.a ? c.t : 1 - c.t);

  const onPlane = new Set<number>();
  /** The polygons (as placed in the result) that lie on the positive side of a cut. */
  const frontPolygons: Polygon[] = [];

  /** Split a convex piece in two, or null if it does not have points strictly on both sides. */
  const splitPiece = (pts: number[], uvs?: UV[]): { front: Piece; back: Piece } | null => {
    const s = pts.map((v) => side[v]!);
    if (!s.some((x) => x > 0) || !s.some((x) => x < 0)) return null;
    const front: Piece = { points: [], uvs: uvs && [] };
    const back: Piece = { points: [], uvs: uvs && [] };
    const add = (piece: Piece, v: number, uv?: UV) => {
      piece.points.push(v);
      if (uv) piece.uvs!.push(uv);
    };
    pts.forEach((a, c) => {
      const n = (c + 1) % pts.length;
      const b = pts[n]!;
      if (s[c]! >= 0) add(front, a, uvs?.[c]);
      if (s[c]! <= 0) add(back, a, uvs?.[c]);
      if (s[c]! === 0) onPlane.add(a);
      if (s[c]! * s[n]! < 0) {
        const cross = crossingOf(a, b);
        const uv = uvs ? lerp(uvs[c]!, uvs[n]!, along(cross, a)) : undefined;
        add(front, cross.m, uv);
        add(back, cross.m, uv);
        onPlane.add(cross.m);
      }
    });
    return { front, back };
  };

  const polygons = geo.polygons.map(clonePolygon);
  const split: KnifeResult['split'] = [];
  const cutIds = [...ids].filter((i) => geo.polygons[i]).sort((a, b) => a - b);
  for (const id of cutIds) {
    const source = geo.polygons[id]!;
    if (!source.points.some((v) => side[v]! > 0) || !source.points.some((v) => side[v]! < 0)) continue;
    const pts = source.points.map((v) => geo.points[v]!);
    if (faceNormal(pts).every((c) => c === 0)) continue; // no area, nothing to cut
    // pieces to cut: the polygon itself, or a fan of triangles if it is concave
    const parts: Piece[] = isConvexPolygon(pts)
      ? [{ points: source.points, uvs: source.uvs }]
      : source.points.slice(1, -1).map((_, k) => ({
          points: [source.points[0]!, source.points[k + 1]!, source.points[k + 2]!],
          uvs: source.uvs && [source.uvs[0]!, source.uvs[k + 1]!, source.uvs[k + 2]!],
        }));
    const out: { piece: Piece; front: boolean }[] = [];
    for (const part of parts) {
      const halves = splitPiece(part.points, part.uvs);
      if (halves) out.push({ piece: halves.back, front: false }, { piece: halves.front, front: true });
      else out.push({ piece: part, front: false });
    }
    const made = out.map(({ piece, front }) => {
      const poly: Polygon = { points: piece.points, surface: source.surface, ...(piece.uvs && { uvs: piece.uvs }) };
      if (front) frontPolygons.push(poly);
      return poly;
    });
    polygons[id] = made[0]!;
    const added: number[] = [];
    for (const poly of made.slice(1)) {
      added.push(polygons.length);
      polygons.push(poly);
    }
    split.push({ kept: id, added });
  }

  // neighbours that were not cut get the new points on their shared edges
  let repaired = 0;
  geo.polygons.forEach((p, i) => {
    if (ids.has(i)) return;
    const next: number[] = [];
    const uvs: UV[] = [];
    let inserted = false;
    p.points.forEach((a, c) => {
      const n = (c + 1) % p.points.length;
      next.push(a);
      if (p.uvs) uvs.push(p.uvs[c]!);
      const cross = crossings.get(keyOf(a, p.points[n]!));
      if (cross) {
        inserted = true;
        next.push(cross.m);
        if (p.uvs) uvs.push(lerp(p.uvs[c]!, p.uvs[n]!, along(cross, a)));
      }
    });
    if (!inserted) return;
    polygons[i] = { points: next, surface: p.surface, ...(p.uvs && { uvs }) };
    repaired++;
  });

  const cutPoints = [...onPlane];
  if (o.separate) {
    // the positive side gets copies of every point on the cut, so the two sides no longer share them
    const copyOf = new Map<number, number>();
    for (const poly of frontPolygons) {
      poly.points = poly.points.map((v) => {
        if (!onPlane.has(v)) return v;
        let copy = copyOf.get(v);
        if (copy === undefined) {
          copy = points.length;
          points.push([...points[v]!]);
          copyOf.set(v, copy);
          cutPoints.push(copy);
        }
        return copy;
      });
    }
  }
  return { geometry: { points, polygons }, cutPoints, split, repaired };
}
