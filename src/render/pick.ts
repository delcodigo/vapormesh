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
  const hiddenPoints = mesh.hiddenPoints();
  mesh.points.forEach((p, i) => {
    if (hiddenPoints.has(i)) return;
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

function inside(poly: { x: number; y: number }[], x: number, y: number): boolean {
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
    if (mesh.hidden.has(i)) return;
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

/** Axis-aligned screen rectangle in CSS pixels; corners may be given in any order. */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const inRect = (r: ScreenRect, x: number, y: number) =>
  x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) && y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1);

/** Every point whose projection falls inside the rectangle. */
export function pointsInRect(mesh: Mesh, proj: Projector, rect: ScreenRect): number[] {
  return pointsWhere(mesh, proj, (x, y) => inRect(rect, x, y));
}

function pointsWhere(mesh: Mesh, proj: Projector, test: (x: number, y: number) => boolean): number[] {
  const ids: number[] = [];
  const hiddenPoints = mesh.hiddenPoints();
  mesh.points.forEach((p, i) => {
    if (hiddenPoints.has(i)) return;
    const s = proj.project(p);
    if (visible(s) && test(s.x, s.y)) ids.push(i);
  });
  return ids;
}

function polygonsWhere(mesh: Mesh, proj: Projector, test: (x: number, y: number) => boolean): number[] {
  const ids: number[] = [];
  mesh.polygons.forEach((poly, i) => {
    if (mesh.hidden.has(i)) return;
    const pts = poly.points.map((idx) => proj.project(mesh.points[idx]!));
    if (pts.length === 0 || !pts.every(visible)) return;
    const cx = pts.reduce((sum, s) => sum + s.x, 0) / pts.length;
    const cy = pts.reduce((sum, s) => sum + s.y, 0) / pts.length;
    if (test(cx, cy)) ids.push(i);
  });
  return ids;
}

/** A freehand outline in screen pixels, for the lasso. */
export type Lasso = { x: number; y: number }[];
const inLasso = (lasso: Lasso) => (x: number, y: number) => lasso.length >= 3 && inside(lasso, x, y);

/** Every point whose projection falls inside the lasso. */
export function pointsInLasso(mesh: Mesh, proj: Projector, lasso: Lasso): number[] {
  return pointsWhere(mesh, proj, inLasso(lasso));
}

/** Every polygon whose projected centre falls inside the lasso. */
export function polygonsInLasso(mesh: Mesh, proj: Projector, lasso: Lasso): number[] {
  return polygonsWhere(mesh, proj, inLasso(lasso));
}

/** Every polygon whose projected centre falls inside the rectangle. */
export function polygonsInRect(mesh: Mesh, proj: Projector, rect: ScreenRect): number[] {
  return polygonsWhere(mesh, proj, (x, y) => inRect(rect, x, y));
}
