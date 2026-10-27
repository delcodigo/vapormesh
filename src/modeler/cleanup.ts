import { faceNormal, type Polygon, type UV, type Vec3 } from '@/core';
import { clonePolygon, findCoincident, isConvexPolygon, mergePoints, type Geometry } from './geometry';

// Tidying a mesh after an operation that leaves it technically correct but untidy (a boolean, mostly). Each function returns a
// new geometry and leaves its input alone.

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: UV, b: UV, t: number): UV => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const keyOf = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Remove points no polygon uses, and renumber. */
export function dropUnusedPoints(geo: Geometry): Geometry {
  const used = new Set(geo.polygons.flatMap((p) => p.points));
  const renumber = new Array<number>(geo.points.length).fill(-1);
  const points: Vec3[] = [];
  geo.points.forEach((p, i) => {
    if (used.has(i)) {
      renumber[i] = points.length;
      points.push([...p]);
    }
  });
  return { points, polygons: geo.polygons.map((p) => ({ ...clonePolygon(p), points: p.points.map((i) => renumber[i]!) })) };
}

/**
 * Where a point lies on the edge of a polygon that does not list it (a T-junction), the neighbouring surface has a crack there:
 * its edge is one long segment while the other side is cut in two. Insert the point into the edge, with its UV interpolated,
 * so both sides agree.
 */
export function repairTJunctions(geo: Geometry, tolerance: number): { geometry: Geometry; inserted: number } {
  const edges = new Map<string, [number, number]>();
  for (const p of geo.polygons) {
    p.points.forEach((a, c) => {
      const b = p.points[(c + 1) % p.points.length]!;
      if (a !== b) edges.set(keyOf(a, b), a < b ? [a, b] : [b, a]);
    });
  }
  const copy = { points: geo.points.map((p): Vec3 => [...p]), polygons: geo.polygons.map(clonePolygon) };
  if (edges.size === 0) return { geometry: copy, inserted: 0 };

  const lo = [0, 1, 2].map((k) => Math.min(...geo.points.map((p) => p[k]!)));
  const hi = [0, 1, 2].map((k) => Math.max(...geo.points.map((p) => p[k]!)));
  const diagonal = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  const cell = Math.max(tolerance * 8, diagonal / 48, 1e-9);
  const cellOf = (x: number) => Math.floor(x / cell);

  // every edge goes into every grid cell its (slightly grown) bounding box touches
  const grid = new Map<string, [number, number][]>();
  for (const e of edges.values()) {
    const [pa, pb] = [geo.points[e[0]]!, geo.points[e[1]]!];
    const range = [0, 1, 2].map((k) => [cellOf(Math.min(pa[k]!, pb[k]!) - tolerance), cellOf(Math.max(pa[k]!, pb[k]!) + tolerance)] as const);
    for (let x = range[0]![0]; x <= range[0]![1]; x++)
      for (let y = range[1]![0]; y <= range[1]![1]; y++)
        for (let z = range[2]![0]; z <= range[2]![1]; z++) {
          const key = `${x},${y},${z}`;
          const list = grid.get(key);
          if (list) list.push(e);
          else grid.set(key, [e]);
        }
  }

  const onEdge = new Map<string, { t: number; v: number }[]>();
  const used = new Set(geo.polygons.flatMap((p) => p.points)); // a loose point touching an edge is not a crack
  geo.points.forEach((p, v) => {
    if (!used.has(v)) return;
    for (const [a, b] of grid.get(`${cellOf(p[0])},${cellOf(p[1])},${cellOf(p[2])}`) ?? []) {
      if (a === v || b === v) continue;
      const pa = geo.points[a]!;
      const d = sub(geo.points[b]!, pa);
      const len2 = dot(d, d);
      if (len2 === 0) continue;
      const t = dot(sub(p, pa), d) / len2;
      const margin = tolerance / Math.sqrt(len2);
      if (t <= margin || t >= 1 - margin) continue; // at an end: that is a weld, not a T-junction
      const off = sub(p, [pa[0] + d[0] * t, pa[1] + d[1] * t, pa[2] + d[2] * t]);
      if (Math.hypot(...off) > tolerance) continue;
      const key = keyOf(a, b);
      const list = onEdge.get(key);
      if (list) list.push({ t, v });
      else onEdge.set(key, [{ t, v }]);
    }
  });

  let inserted = 0;
  copy.polygons = geo.polygons.map((poly) => {
    const points: number[] = [];
    const uvs: UV[] = [];
    let changed = false;
    poly.points.forEach((a, c) => {
      const n = (c + 1) % poly.points.length;
      const b = poly.points[n]!;
      points.push(a);
      if (poly.uvs) uvs.push(poly.uvs[c]!);
      const found = onEdge.get(keyOf(a, b));
      if (!found) return;
      // t was measured from the lower-numbered end; along this polygon's a -> b it may run the other way
      const forward = a < b;
      const ordered = [...found].sort((x, y) => (forward ? x.t - y.t : y.t - x.t));
      for (const { t, v } of ordered) {
        points.push(v);
        if (poly.uvs) uvs.push(lerp(poly.uvs[c]!, poly.uvs[n]!, forward ? t : 1 - t));
        inserted++;
        changed = true;
      }
    });
    return changed ? { points, surface: poly.surface, ...(poly.uvs && { uvs }) } : clonePolygon(poly);
  });
  return { geometry: copy, inserted };
}

/**
 * Put back together polygons that were one polygon before an operation chopped it up: neighbours with the same `surface`
 * (the caller makes that a stand-in for "came from the same polygon"), the same plane, matching UVs along the shared edge, and
 * a union that is still convex. Polygons that were separate to begin with are never merged, so a deliberately subdivided face stays
 * subdivided.
 */
export function mergeFragments(geo: Geometry, tolerance: number): Geometry {
  type Item = { points: number[]; uvs?: UV[]; surface: number; alive: boolean };
  const items: Item[] = geo.polygons.map((p) => ({ points: [...p.points], ...(p.uvs && { uvs: p.uvs.map((uv): UV => [...uv]) }), surface: p.surface, alive: true }));
  const pos = (i: number) => geo.points[i]!;
  const sameUv = (a: UV, b: UV) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  /** `count` consecutive items starting at `start`, wrapping round */
  const take = <T>(list: T[], start: number, count: number) => Array.from({ length: count }, (_, k) => list[(start + k) % list.length]!);

  /**
   * Join p and q along the run of edges they share. The run must be one unbroken stretch in both (consecutive edges, which
   * happens when one polygon's edge was cut by a T-junction point), and the points strictly inside it must belong to nobody
   * else, since they disappear from the result.
   */
  const tryMerge = (p: Item, q: Item, usage: Map<number, number>): Item | null => {
    const n = p.points.length;
    const m = q.points.length;
    if (!!p.uvs !== !!q.uvs) return null;
    const qEdges = new Set(q.points.map((a, k) => `${a}>${q.points[(k + 1) % m]}`));
    const shared = p.points.map((a, c) => qEdges.has(`${p.points[(c + 1) % n]}>${a}`)); // p's edge c->c+1 is q's edge run backwards
    const k = shared.filter(Boolean).length;
    if (k === 0 || k === n) return null;
    const starts = shared.flatMap((on, c) => (on && !shared[(c + n - 1) % n] ? [c] : []));
    if (starts.length !== 1) return null; // the shared edges are in more than one stretch: merging would pinch the result
    const c0 = starts[0]!;
    const run = take(p.points, c0, k + 1); // v0 ... vk along p
    const d = q.points.findIndex((v, i) => v === run[k] && q.points[(i + 1) % m] === run[k - 1]);
    if (d < 0 || !run.every((v, i) => q.points[(d + k - i + m) % m] === v)) return null; // q must run along the same points backwards
    if (run.slice(1, -1).some((v) => (usage.get(v) ?? 0) !== 2)) return null;

    const pStart = (c0 + k) % n; // vk ... v0 round the outside of p
    const qStart = (d + k) % m; // v0 ... vk round the outside of q
    const points = [...take(p.points, pStart, n - k + 1), ...take(q.points, qStart, m - k + 1).slice(1, -1)];
    if (new Set(points).size !== points.length) return null;
    let uvs: UV[] | undefined;
    if (p.uvs && q.uvs) {
      const pu = take(p.uvs, pStart, n - k + 1);
      const qu = take(q.uvs, qStart, m - k + 1);
      if (!sameUv(pu[0]!, qu.at(-1)!) || !sameUv(pu.at(-1)!, qu[0]!)) return null; // a texture seam: keep both
      uvs = [...pu, ...qu.slice(1, -1)];
    }
    const [np, nq] = [faceNormal(p.points.map(pos)), faceNormal(q.points.map(pos))];
    const [lp, lq] = [Math.hypot(...np), Math.hypot(...nq)];
    if (lp === 0 || lq === 0 || dot(np, nq) / (lp * lq) < 1 - 1e-6) return null; // not coplanar
    const pts = points.map(pos);
    const plane = np.map((v) => v / lp) as Vec3;
    if (pts.some((x) => Math.abs(dot(plane, sub(x, pos(p.points[0]!)))) > tolerance)) return null;
    if (!isConvexPolygon(pts)) return null;
    if (Math.abs(Math.hypot(...faceNormal(pts)) - (lp + lq)) > 1e-6 * (lp + lq)) return null; // the area must add up
    return { points, ...(uvs && { uvs }), surface: p.surface, alive: true };
  };

  let merged = true;
  while (merged) {
    merged = false;
    const owner = new Map<string, number>();
    const usage = new Map<number, number>();
    items.forEach((p, i) => {
      if (!p.alive) return;
      p.points.forEach((a, c) => {
        const key = `${a}>${p.points[(c + 1) % p.points.length]}`;
        owner.set(key, owner.has(key) ? -1 : i); // -1: used twice, so it is not safe to merge across
        usage.set(a, (usage.get(a) ?? 0) + 1);
      });
    });
    const touched = new Set<number>();
    for (let i = 0; i < items.length; i++) {
      const p = items[i]!;
      if (!p.alive || touched.has(i)) continue;
      for (let c = 0; c < p.points.length; c++) {
        const j = owner.get(`${p.points[(c + 1) % p.points.length]}>${p.points[c]}`);
        if (j === undefined || j < 0 || j === i || !items[j]!.alive || touched.has(j) || items[j]!.surface !== p.surface) continue;
        const m = tryMerge(p, items[j]!, usage);
        if (!m) continue;
        items[i] = m;
        items[j]!.alive = false;
        touched.add(i).add(j);
        merged = true;
        break;
      }
    }
  }
  const polygons: Polygon[] = items.filter((p) => p.alive).map((p) => ({ points: p.points, surface: p.surface, ...(p.uvs && { uvs: p.uvs }) }));
  return dropUnusedPoints({ points: geo.points, polygons });
}

/**
 * Remove points that sit on a straight run in every polygon that uses them (and are used by at most two), since they only add
 * an edge that is not there. A point a third polygon uses is kept: dropping it from the others would open a crack.
 */
export function removeCollinearPoints(geo: Geometry, tolerance: number): Geometry {
  let polygons = geo.polygons.map(clonePolygon);
  const pos = (i: number) => geo.points[i]!;
  for (let pass = 0; pass < 64; pass++) {
    const uses = new Map<number, { poly: number; corner: number }[]>();
    polygons.forEach((p, poly) => p.points.forEach((v, corner) => (uses.get(v) ?? uses.set(v, []).get(v)!).push({ poly, corner })));
    const straight = ({ poly, corner }: { poly: number; corner: number }) => {
      const pts = polygons[poly]!.points;
      if (pts.length <= 3) return false;
      const u = pos(pts[(corner + pts.length - 1) % pts.length]!);
      const m = pos(pts[corner]!);
      const w = pos(pts[(corner + 1) % pts.length]!);
      const d = sub(w, u);
      const len2 = dot(d, d);
      if (len2 === 0) return false;
      const t = dot(sub(m, u), d) / len2;
      return t > 0 && t < 1 && Math.hypot(...cross(sub(m, u), d)) / Math.sqrt(len2) <= tolerance;
    };
    const length = polygons.map((p) => p.points.length);
    const doomed = new Set<number>();
    for (const [v, list] of uses) {
      if (list.length > 2 || !list.every(straight)) continue;
      if (list.some(({ poly }) => length[poly]! - 1 < 3)) continue; // a polygon must keep three points
      list.forEach(({ poly }) => length[poly]!--);
      doomed.add(v);
    }
    if (doomed.size === 0) break;
    polygons = polygons.map((p) => {
      const keep = p.points.map((v) => !doomed.has(v));
      return { points: p.points.filter((_, i) => keep[i]), surface: p.surface, ...(p.uvs && { uvs: p.uvs.filter((_, i) => keep[i]) }) };
    });
  }
  return dropUnusedPoints({ points: geo.points, polygons });
}

/** Undirected edges used a different number of times one way than the other: a hole or a crack. */
export function unbalancedEdges(geo: Geometry): [number, number][] {
  const used = new Map<string, number>();
  for (const p of geo.polygons) p.points.forEach((a, c) => used.set(`${a}>${p.points[(c + 1) % p.points.length]}`, (used.get(`${a}>${p.points[(c + 1) % p.points.length]}`) ?? 0) + 1));
  const bad = new Map<string, [number, number]>();
  for (const [key, n] of used) {
    const [a, b] = key.split('>').map(Number) as [number, number];
    if (n !== (used.get(`${b}>${a}`) ?? 0)) bad.set(keyOf(a, b), a < b ? [a, b] : [b, a]);
  }
  return [...bad.values()];
}

/**
 * Cracks that survive welding and T-junction repair come from points that landed just beyond the welding tolerance of each
 * other, so one polygon sees two points where its neighbour sees one. Weld the points on the edges that do not balance when they
 * are within a few tolerances of each other, repair again, and repeat while that helps. Only points around a crack are
 * touched, so a healthy mesh comes out exactly as it went in.
 */
export function healCracks(geo: Geometry, tolerance: number, reach = 4): { geometry: Geometry; welded: number } {
  let current = geo;
  let welded = 0;
  for (let round = 0; round < 6; round++) {
    const bad = unbalancedEdges(current);
    if (bad.length === 0) break;
    const involved = [...new Set(bad.flat())];
    const mapping = findCoincident(current.points, involved, tolerance * reach);
    const merges = mapping.filter((m, i) => m !== i).length;
    if (merges === 0) break;
    welded += merges;
    current = repairTJunctions(mergePoints(current, mapping), tolerance).geometry;
  }
  return { geometry: current, welded };
}
