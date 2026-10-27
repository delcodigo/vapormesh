import { boxProjectPolygon, DEFAULT_TEXTURE_SIZE, faceNormal, type Vec3 } from '@/core';
import { clonePolygon, type Geometry } from './geometry';

/** Where extruded points go: along the (average) normals of the polygons around them, or along one fixed vector. */
export type ExtrudeDirection = { kind: 'normal' } | { kind: 'vector'; vector: Vec3 };

export interface ExtrudeOptions {
  /** How far the new polygons move. Negative pushes them into the object. */
  distance: number;
  /** How far the outline of the new polygons moves inwards (negative: outwards). Zero is a plain extrude; with a distance too, it is a bevel. */
  inset: number;
  direction: ExtrudeDirection;
  /** Texture size of a surface, to project UVs onto the new walls at the same texel density as everything else. */
  textureSize?: (surface: number) => [number, number];
}

export interface ExtrudeResult {
  geometry: Geometry;
  /** The new points the selected polygons now use, in the new numbering. */
  capPoints: number[];
  /** The new side polygons, appended after the existing ones. */
  walls: number[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0];
};
const ZERO: Vec3 = [0, 0, 0];

/** The direction a selection of polygons faces: the area-weighted sum of their normals, normalised. Zero if they cancel out. */
export function averageNormal(geo: Geometry, ids: Iterable<number>): Vec3 {
  let sum: Vec3 = ZERO;
  for (const id of ids) {
    const p = geo.polygons[id];
    if (p) sum = add(sum, faceNormal(p.points.map((i) => geo.points[i]!)));
  }
  return unit(sum);
}

/**
 * Extrude (and optionally inset) polygons. Each selected polygon gets its own copy of its points, moved; the polygons
 * are re-pointed at the copies, so they stay where they are in the list and keep their surface and UVs. A side wall is
 * built along every edge that has a selected polygon on one side only, so edges inside the selection get no wall. Points
 * that nothing uses any more (the old interior of the selection) are removed. With a negative distance the walls turn
 * to face the hole they now line.
 */
export function extrude(geo: Geometry, ids: ReadonlySet<number>, o: ExtrudeOptions): ExtrudeResult {
  const selected = [...ids].filter((i) => geo.polygons[i]).sort((a, b) => a - b);
  const isSelected = new Set(selected);
  const pos = geo.points;

  const rawNormal = new Map<number, Vec3>();
  const pointNormal = new Map<number, Vec3>();
  let total: Vec3 = ZERO;
  for (const id of selected) {
    const n = faceNormal(geo.polygons[id]!.points.map((i) => pos[i]!));
    rawNormal.set(id, n);
    total = add(total, n);
    for (const pt of geo.polygons[id]!.points) pointNormal.set(pt, add(pointNormal.get(pt) ?? ZERO, n));
  }

  // edges of selected polygons; those used once are on the boundary of the selection and get a wall
  type Edge = { a: number; b: number; polygon: number };
  const edges: Edge[] = [];
  const uses = new Map<string, number>();
  const keyOf = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (const id of selected) {
    const pts = geo.polygons[id]!.points;
    pts.forEach((a, c) => {
      const b = pts[(c + 1) % pts.length]!;
      if (a === b) return;
      edges.push({ a, b, polygon: id });
      uses.set(keyOf(a, b), (uses.get(keyOf(a, b)) ?? 0) + 1);
    });
  }
  const boundary = edges.filter((e) => uses.get(keyOf(e.a, e.b)) === 1);

  // inset: each boundary point moves along the miter of its two boundary edges, so both edges end up `inset` away
  const inward = new Map<number, Vec3[]>();
  for (const e of boundary) {
    const i = unit(cross(unit(rawNormal.get(e.polygon)!), unit(sub(pos[e.b]!, pos[e.a]!)))); // left of the edge, seen from outside
    for (const v of [e.a, e.b]) inward.set(v, [...(inward.get(v) ?? []), i]);
  }
  const insetOf = (v: number): Vec3 => {
    const list = inward.get(v) ?? [];
    if (list.length === 1) return mul(list[0]!, o.inset);
    if (list.length !== 2) return ZERO;
    const [i1, i2] = list as [Vec3, Vec3];
    return mul(add(i1, i2), o.inset / Math.max(1 + dot(i1, i2), 0.1));
  };
  const directionOf = (v: number): Vec3 => {
    if (o.direction.kind === 'vector') return unit(o.direction.vector);
    const n = unit(pointNormal.get(v) ?? ZERO);
    return n[0] === 0 && n[1] === 0 && n[2] === 0 ? unit(total) : n; // normals that cancel out fall back to the whole selection's
  };

  const usedBySelected: number[] = [];
  const seen = new Set<number>();
  for (const id of selected) {
    for (const pt of geo.polygons[id]!.points) {
      if (!seen.has(pt)) {
        seen.add(pt);
        usedBySelected.push(pt);
      }
    }
  }
  const usedByOthers = new Set(geo.polygons.flatMap((p, i) => (isSelected.has(i) ? [] : p.points)));
  const onBoundary = new Set(boundary.flatMap((e) => [e.a, e.b]));

  // old points stay if anything else needs them; the rest of the selection's old points are dropped
  const renumber = new Array<number>(pos.length).fill(-1);
  const points: Vec3[] = [];
  pos.forEach((p, v) => {
    if (!seen.has(v) || usedByOthers.has(v) || onBoundary.has(v)) {
      renumber[v] = points.length;
      points.push([...p]);
    }
  });
  const cap = new Map<number, number>();
  const moved = new Map<number, Vec3>();
  for (const v of usedBySelected) {
    const at = add(add(pos[v]!, insetOf(v)), mul(directionOf(v), o.distance));
    moved.set(v, at);
    cap.set(v, points.length);
    points.push(at);
  }

  const polygons = geo.polygons.map((p, i) => ({ ...clonePolygon(p), points: p.points.map((v) => (isSelected.has(i) ? cap.get(v)! : renumber[v]!)) }));
  const walls: number[] = [];
  for (const e of boundary) {
    const owner = geo.polygons[e.polygon]!;
    const corners = [e.a, e.b, e.b, e.a].map((v, k) => (k < 2 ? renumber[v]! : cap.get(v)!));
    const wall = { points: corners, surface: owner.surface } as Geometry['polygons'][number];
    if (owner.uvs) {
      const [w, h] = o.textureSize?.(owner.surface) ?? [DEFAULT_TEXTURE_SIZE, DEFAULT_TEXTURE_SIZE];
      wall.uvs = boxProjectPolygon([pos[e.a]!, pos[e.b]!, moved.get(e.b)!, moved.get(e.a)!], w, h);
    }
    walls.push(polygons.length);
    polygons.push(wall);
  }
  return { geometry: { points, polygons }, capPoints: usedBySelected.map((v) => cap.get(v)!), walls };
}
