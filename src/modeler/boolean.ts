import { Mesh, type Surface, type UV, type Vec3 } from '@/core';
import { csgIntersect, csgSubtract, csgUnion, flipCsgPolygon, planeFromPolygon, type CsgPolygon, type Vertex } from './bsp';
import { healCracks, mergeFragments, removeCollinearPoints, repairTJunctions } from './cleanup';
import { findCoincident, isConvexPolygon, mergePoints, type Geometry } from './geometry';
import { earClip } from './triangulate';

export type BooleanOp = 'add' | 'subtract' | 'intersect';

/** A problem the person can do something about, worded for them. */
export class BooleanError extends Error {}

/** More than this many polygons (after splitting everything into convex, flat pieces) and BSP trees get too slow to wait for. */
export const MAX_BOOLEAN_POLYGONS = 6000;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The volume a mesh encloses: positive when its polygons face outward, negative when it is inside out. */
export function meshVolume(mesh: { points: Vec3[]; polygons: { points: number[] }[] }): number {
  let v = 0;
  for (const p of mesh.polygons) {
    const a = mesh.points[p.points[0]!]!;
    for (let k = 1; k < p.points.length - 1; k++) v += dot(a, cross(mesh.points[p.points[k]!]!, mesh.points[p.points[k + 1]!]!)) / 6;
  }
  return v;
}

/** How often each directed edge is used, once points within `tolerance` are treated as one point. */
function edgeUses(mesh: Mesh, tolerance: number): Map<string, number> {
  const mapping = findCoincident(mesh.points, mesh.points.map((_, i) => i), tolerance);
  const used = new Map<string, number>();
  for (const p of mesh.polygons) {
    p.points.forEach((v, c) => {
      const a = mapping[v]!;
      const b = mapping[p.points[(c + 1) % p.points.length]!]!;
      if (a !== b) used.set(`${a}>${b}`, (used.get(`${a}>${b}`) ?? 0) + 1);
    });
  }
  return used;
}

const canonical = (a: string, b: string) => (Number(a) < Number(b) ? `${a}_${b}` : `${b}_${a}`);

/**
 * Edges of a perfectly manifold surface are used exactly once in each direction. This counts the ones that are not: a hole, a
 * crack, or an edge where more than two polygons meet.
 */
export function countOpenEdges(mesh: Mesh, tolerance: number): number {
  const used = edgeUses(mesh, tolerance);
  const open = new Set<string>();
  for (const [key, n] of used) {
    const [a, b] = key.split('>') as [string, string];
    if (n !== 1 || used.get(`${b}>${a}`) !== 1) open.add(canonical(a, b));
  }
  return open.size;
}

/**
 * Edges used a different number of times in one direction than the other: a hole or a crack. Unlike `countOpenEdges` this lets
 * several polygons meet at one edge, as they do where two solids touch along a line, since that surface still has no gap.
 */
export function countUnbalancedEdges(mesh: Mesh, tolerance: number): number {
  const used = edgeUses(mesh, tolerance);
  const bad = new Set<string>();
  for (const [key, n] of used) {
    const [a, b] = key.split('>') as [string, string];
    if (n !== (used.get(`${b}>${a}`) ?? 0)) bad.add(canonical(a, b));
  }
  return bad.size;
}

/**
 * Convert a mesh to BSP polygons: convex, flat, counter-clockwise from outside. Anything else (a concave polygon, one that is not
 * quite flat) is first cut into triangles. Each carries `parent`, the number of the polygon it came from.
 */
function toCsg(mesh: Mesh, parentBase: number, flip: boolean, eps: number): CsgPolygon[] {
  const out: CsgPolygon[] = [];
  mesh.polygons.forEach((poly, i) => {
    if (poly.points.length < 3) return;
    const pts = poly.points.map((v) => mesh.points[v]!);
    const plane = planeFromPolygon(pts);
    if (!plane) return; // no area: nothing to cut with or against
    const vertexAt = (c: number): Vertex => ({ p: pts[c]!, uv: poly.uvs ? poly.uvs[c]! : null });
    const simple = pts.every((p) => Math.abs(dot(plane.n, p) - plane.w) <= eps) && isConvexPolygon(pts);
    const pieces = simple ? [pts.map((_, c) => c)] : earClip(pts);
    for (const piece of pieces) {
      const vertices = piece.map(vertexAt);
      const piecePlane = simple ? plane : planeFromPolygon(vertices.map((v) => v.p));
      if (!piecePlane) continue;
      const csg: CsgPolygon = { vertices, plane: piecePlane, parent: parentBase + i };
      if (flip) flipCsgPolygon(csg);
      out.push(csg);
    }
  });
  return out;
}

export interface BooleanNames {
  object: string;
  cutter: string;
}

/**
 * Combine two closed solids: `add` is everything in either, `subtract` is the object with the cutter taken out of it,
 * `intersect` is only what they share. The inputs are not changed. Polygons keep the surfaces and UVs they had, new points
 * where the surfaces cross are shared, and the many small pieces the algorithm cuts faces into are put back together where
 * they came from one polygon.
 *
 * Both meshes must be closed (every edge used once each way). A solid facing inward is treated as flipped, so the result
 * is the same either way round. Throws BooleanError, with a message to show, if it cannot proceed.
 */
export function booleanMeshes(a: Mesh, b: Mesh, op: BooleanOp, names: BooleanNames = { object: 'The object', cutter: 'The cutter' }): Mesh {
  for (const [mesh, name] of [[a, names.object], [b, names.cutter]] as const) {
    if (mesh.polygons.length === 0) throw new BooleanError(`${name} has no polygons`);
  }
  const all = [...a.points, ...b.points];
  const lo = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]!)));
  const hi = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k]!)));
  const scale = Math.max(Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!), 1e-9);
  const eps = 1e-5 * scale; // how close to a plane counts as on it
  const tolerance = 5e-5 * scale; // how close points must be to be one point in the result

  const flips: boolean[] = [];
  for (const [mesh, name] of [[a, names.object], [b, names.cutter]] as const) {
    const open = countUnbalancedEdges(mesh, tolerance);
    if (open > 0) {
      throw new BooleanError(`${name} is not a closed solid: ${open} edge${open === 1 ? ' is' : 's are'} open. Merge Points may close it.`);
    }
    const volume = meshVolume(mesh);
    if (Math.abs(volume) < 1e-12 * scale ** 3) throw new BooleanError(`${name} has no volume`);
    flips.push(volume < 0);
  }

  // surfaces: the object's first, then any of the cutter's that it does not already have by name
  const surfaces: Surface[] = a.surfaces.map((s) => ({ ...s }));
  const cutterSurface = b.surfaces.map((s) => {
    const found = surfaces.findIndex((x) => x.name === s.name);
    if (found >= 0) return found;
    surfaces.push({ ...s });
    return surfaces.length - 1;
  });
  const surfaceOf = [...a.polygons.map((p) => p.surface), ...b.polygons.map((p) => cutterSurface[p.surface] ?? 0)];

  const pa = toCsg(a, 0, flips[0]!, eps);
  const pb = toCsg(b, a.polygons.length, flips[1]!, eps);
  if (pa.length + pb.length > MAX_BOOLEAN_POLYGONS) {
    throw new BooleanError(`Too many polygons for a boolean: ${pa.length + pb.length} after splitting into flat pieces, and the limit is ${MAX_BOOLEAN_POLYGONS}`);
  }
  const combined = op === 'add' ? csgUnion(pa, pb, eps) : op === 'subtract' ? csgSubtract(pa, pb, eps) : csgIntersect(pa, pb, eps);
  if (combined.length === 0) {
    throw new BooleanError(op === 'intersect' ? 'The result is empty: the two solids do not overlap' : 'The result is empty: nothing is left');
  }

  // back to a mesh: weld the points, close the cracks, put the fragments of each polygon back together
  const points: Vec3[] = [];
  const polygons: Geometry['polygons'] = combined.map((c) => {
    const base = points.length;
    c.vertices.forEach((v) => points.push([...v.p]));
    const uvs = c.vertices.every((v) => v.uv) ? c.vertices.map((v): UV => [...v.uv!]) : undefined;
    return { points: c.vertices.map((_, k) => base + k), surface: c.parent, ...(uvs && { uvs }) };
  });
  let geo: Geometry = mergePoints({ points, polygons }, findCoincident(points, points.map((_, i) => i), tolerance));
  geo = repairTJunctions(geo, tolerance).geometry;
  geo = healCracks(geo, tolerance).geometry;
  geo = mergeFragments(geo, tolerance);
  geo = removeCollinearPoints(geo, tolerance);
  if (geo.polygons.length === 0) throw new BooleanError('The result is empty: nothing is left');

  const result = new Mesh();
  result.surfaces = surfaces;
  result.points = geo.points;
  result.polygons = geo.polygons.map((p) => ({ ...p, surface: surfaceOf[p.surface] ?? 0 }));
  return result;
}
