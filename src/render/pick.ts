import type { Mesh, Vec3 } from '@/core';

/** Screen-space position in CSS pixels plus NDC depth (smaller = closer). */
export interface ScreenPoint {
  x: number;
  y: number;
  z: number;
}

export interface Projector {
  project(p: Vec3): ScreenPoint;
}

const visible = (s: ScreenPoint) => s.z >= -1 && s.z <= 1;

/** Nearest point within `radius` pixels of (x, y); ties go to the closest to the camera. */
export function pickPoint(mesh: Mesh, proj: Projector, x: number, y: number, radius = 8): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  let bestZ = Infinity;
  mesh.points.forEach((p, i) => {
    const s = proj.project(p);
    if (!visible(s)) return;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d > radius) return;
    if (d < bestDist - 0.5 || (Math.abs(d - bestDist) <= 0.5 && s.z < bestZ)) {
      best = i;
      bestDist = d;
      bestZ = s.z;
    }
  });
  return best;
}

function inside(poly: ScreenPoint[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Polygon whose projected outline contains (x, y); overlapping polygons resolve to the closest one. */
export function pickPolygon(mesh: Mesh, proj: Projector, x: number, y: number): number | null {
  let best: number | null = null;
  let bestZ = Infinity;
  mesh.polygons.forEach((poly, i) => {
    const pts = poly.points.map((idx) => proj.project(mesh.points[idx]!));
    if (pts.length < 3 || !pts.every(visible) || !inside(pts, x, y)) return;
    const z = pts.reduce((sum, s) => sum + s.z, 0) / pts.length;
    if (z < bestZ) {
      best = i;
      bestZ = z;
    }
  });
  return best;
}
