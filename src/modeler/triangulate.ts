import { faceNormal, type Vec3 } from '@/core';

/**
 * Triangulate a simple planar polygon, convex or not, by ear clipping. Returns index triples into `pts` that wind the same way
 * as the polygon does, so a polygon facing outward gives triangles facing outward. Points that lie on the line between their
 * neighbours produce no triangle (it would have no area).
 *
 * If the polygon is not simple (it crosses itself) or not planar enough for any ear to be found, the rest is split as a fan
 * rather than failing, so the caller always gets n - 2 or fewer triangles covering the polygon's points.
 */
export function earClip(pts: Vec3[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  // flatten onto the plane the polygon mostly lies in, by dropping the axis its normal points along most
  const normal = faceNormal(pts);
  const drop = [0, 1, 2].reduce((best, k) => (Math.abs(normal[k]!) > Math.abs(normal[best]!) ? k : best), 0);
  const [a, b] = [(drop + 1) % 3, (drop + 2) % 3];
  const flat = pts.map((p) => [p[a]!, p[b]!] as const);
  const cross = (i: number, j: number, k: number) =>
    (flat[j]![0] - flat[i]![0]) * (flat[k]![1] - flat[i]![1]) - (flat[j]![1] - flat[i]![1]) * (flat[k]![0] - flat[i]![0]);
  const signed = flat.reduce((s, p, i) => s + (p[0] * flat[(i + 1) % n]![1] - flat[(i + 1) % n]![0] * p[1]), 0);
  const turn = signed >= 0 ? 1 : -1; // which sign of `cross` means a convex corner
  const scale = Math.max(...flat.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))), 1e-12);
  const eps = 1e-12 * scale * scale;

  const same = (p: number, q: number) => Math.abs(flat[p]![0] - flat[q]![0]) <= 1e-12 * scale && Math.abs(flat[p]![1] - flat[q]![1]) <= 1e-12 * scale;
  // Inside or on the boundary: a point sitting exactly on the ear's diagonal still blocks it, because that diagonal would then
  // run outside the polygon (the corner of an L, for example). Points at the ear's own corners are not counted.
  const blocks = (p: number, i: number, j: number, k: number) => {
    if (same(p, i) || same(p, j) || same(p, k)) return false;
    const d1 = cross(i, j, p) * turn;
    const d2 = cross(j, k, p) * turn;
    const d3 = cross(k, i, p) * turn;
    return d1 >= -eps && d2 >= -eps && d3 >= -eps;
  };

  const ring = pts.map((_, i) => i);
  const out: [number, number, number][] = [];
  let guard = 0;
  while (ring.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let r = 0; r < ring.length; r++) {
      const prev = ring[(r + ring.length - 1) % ring.length]!;
      const cur = ring[r]!;
      const next = ring[(r + 1) % ring.length]!;
      const c = cross(prev, cur, next) * turn;
      if (Math.abs(c) <= eps) {
        ring.splice(r, 1); // collinear: drop the point, there is no triangle to make
        clipped = true;
        break;
      }
      if (c < 0) continue; // a reflex corner is never an ear
      if (ring.some((p) => p !== prev && p !== cur && p !== next && blocks(p, prev, cur, next))) continue;
      out.push([prev, cur, next]);
      ring.splice(r, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // nothing can be clipped: fall back to a fan for what is left
  }
  for (let k = 1; k < ring.length - 1; k++) out.push([ring[0]!, ring[k]!, ring[k + 1]!]);
  return out;
}
