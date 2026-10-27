import type { Mesh, Vec3 } from '@/core';

export interface SurfaceBuffers {
  /** Triangle-list positions, 3 floats per vertex. */
  positions: number[];
  normals: number[];
}

/** Newell normal of a polygon: points along the outward direction for counter-clockwise winding, length ∝ area. */
export function faceNormal(pts: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return n;
}

const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const l = length(v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Triangulated geometry for the polygons of one surface, with a normal per corner.
 * Flat surfaces use the face normal. Smooth (Gouraud) surfaces average the area-weighted normals of
 * neighbouring polygons on the same surface that lie within the surface's smoothing angle, so cube edges
 * stay sharp while a sphere reads as round. Polygons with no area are skipped.
 */
export function buildSurfaceBuffers(mesh: Mesh, surfaceIndex: number): SurfaceBuffers {
  const out: SurfaceBuffers = { positions: [], normals: [] };
  const surface = mesh.surfaces[surfaceIndex];
  if (!surface) return out;

  const faces = mesh.polygons.map((poly) => faceNormal(poly.points.map((i) => mesh.points[i]!)));

  // polygons on this surface touching each point
  const around = new Map<number, number[]>();
  if (surface.smoothing) {
    mesh.polygons.forEach((poly, pi) => {
      if (poly.surface !== surfaceIndex) return;
      for (const pt of poly.points) {
        const list = around.get(pt);
        if (list) list.push(pi);
        else around.set(pt, [pi]);
      }
    });
  }
  const minDot = Math.cos((surface.smoothingAngle * Math.PI) / 180);

  mesh.polygons.forEach((poly, pi) => {
    if (poly.surface !== surfaceIndex || poly.points.length < 3 || length(faces[pi]!) === 0) return;
    const own = unit(faces[pi]!);
    const corners = poly.points.map((pt): Vec3 => {
      if (!surface.smoothing) return own;
      const sum: Vec3 = [0, 0, 0];
      for (const other of around.get(pt) ?? []) {
        const f = faces[other]!;
        if (length(f) === 0 || dot(own, unit(f)) < minDot) continue;
        sum[0] += f[0];
        sum[1] += f[1];
        sum[2] += f[2];
      }
      return length(sum) === 0 ? own : unit(sum);
    });
    for (let i = 1; i < poly.points.length - 1; i++) {
      for (const c of [0, i, i + 1]) {
        out.positions.push(...mesh.points[poly.points[c]!]!);
        out.normals.push(...corners[c]!);
      }
    }
  });
  return out;
}
