import { rotateAround, type UV, type Vec3 } from '@/core';
import { clonePolygon, MERGE_TOLERANCE, type Geometry } from './geometry';

export type LatheAxis = 'x' | 'y' | 'z';
const AXIS: Record<LatheAxis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

export interface LatheOptions {
  /** The line the profile is spun about: this direction, through `center`. */
  axis: LatheAxis;
  center: Vec3;
  /** How many steps the sweep is cut into. */
  sides: number;
  /** Degrees to sweep, in -360..360 but not 0. 360 closes the shape; anything less leaves it open. Negative sweeps the other way. */
  degrees: number;
  /** Join the last profile point back to the first, for shapes like a ring or a torus. */
  closed: boolean;
  tolerance?: number;
}

export interface LatheResult {
  geometry: Geometry;
  /** The points and polygons the lathe added, in the new numbering. Points of the profile itself are not in the first list. */
  newPoints: number[];
  newPolygons: number[];
}

/** The most steps a lathe may take, and the most polygons it may add. */
export const MAX_LATHE_SIDES = 256;
export const MAX_LATHE_POLYGONS = 20000;

/**
 * Spin a profile (points in order along an outline) about an axis to make a surface of revolution. The profile itself is the
 * first ring, so the new surface is attached to it; later rings are new points. A profile point on the axis stays one point
 * and its quads collapse to triangles. A full turn reuses the first ring as the last, so there is no seam to close. The
 * polygons face outward when the profile runs in the direction of the axis (bottom to top for Y) on the positive side; a
 * negative angle reverses both the sweep and the winding so the faces stay outward.
 *
 * UVs wrap around the shape: u follows the sweep (0 to 1) and v follows the profile's length, from the bottom of the
 * texture up, so a texture wraps like a label on a can.
 */
export function lathe(geo: Geometry, profile: readonly number[], o: LatheOptions): LatheResult {
  const tolerance = o.tolerance ?? MERGE_TOLERANCE;
  const axis = AXIS[o.axis];
  const n = profile.length;
  const full = Math.abs(Math.abs(o.degrees) - 360) < 1e-9;
  const steps = o.sides;
  const rings = full ? steps : steps + 1; // the rings that need points of their own
  const radiusOf = (p: Vec3): number => {
    const d = [p[0] - o.center[0], p[1] - o.center[1], p[2] - o.center[2]];
    const along = d[0]! * axis[0] + d[1]! * axis[1] + d[2]! * axis[2];
    return Math.hypot(d[0]! - along * axis[0], d[1]! - along * axis[1], d[2]! - along * axis[2]);
  };

  const points: Vec3[] = geo.points.map((p): Vec3 => [...p]);
  const polygons = geo.polygons.map(clonePolygon);
  const newPoints: number[] = [];
  const newPolygons: number[] = [];

  const onAxis = profile.map((id) => radiusOf(geo.points[id]!) <= tolerance);
  // ring[r][j]: the point index of profile point j after r steps
  const ring: number[][] = [[...profile]];
  for (let r = 1; r < rings; r++) {
    const angle = (o.degrees * Math.PI) / 180 * (r / steps);
    ring.push(
      profile.map((id, j) => {
        if (onAxis[j]) return id;
        points.push(rotateAround(geo.points[id]!, o.center, axis, angle));
        newPoints.push(points.length - 1);
        return points.length - 1;
      }),
    );
  }
  // after a full turn the last step lands back on the first ring
  const ringAt = (r: number) => (full && r === steps ? ring[0]! : ring[r]!);

  // v along the profile by length
  const length: number[] = [0];
  const segments = o.closed ? n : n - 1;
  for (let j = 0; j < segments; j++) {
    const a = geo.points[profile[j]!]!;
    const b = geo.points[profile[(j + 1) % n]!]!;
    length.push(length[j]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = length[segments] || 1;
  const v = (j: number) => 1 - length[j]! / total; // the first profile point is at the bottom of the image

  const flip = o.degrees < 0;
  for (let r = 0; r < steps; r++) {
    for (let j = 0; j < segments; j++) {
      const j2 = (j + 1) % n;
      const a = ringAt(r)[j]!;
      const b = ringAt(r)[j2]!;
      const c = ringAt(r + 1)[j2]!;
      const d = ringAt(r + 1)[j]!;
      const u0 = r / steps;
      const u1 = (r + 1) / steps;
      // outward when the profile climbs the axis and the sweep is positive: a, d, c, b
      let corners: { p: number; uv: UV }[] = [
        { p: a, uv: [u0, v(j)] },
        { p: d, uv: [u1, v(j)] },
        { p: c, uv: [u1, v(j + 1)] },
        { p: b, uv: [u0, v(j + 1)] },
      ];
      if (flip) corners = corners.reverse();
      // where two corners are the same point (a profile point on the axis) the quad becomes a triangle
      corners = corners.filter((corner, i) => corner.p !== corners[(i + corners.length - 1) % corners.length]!.p);
      if (corners.length < 3 || new Set(corners.map((corner) => corner.p)).size < 3) continue;
      newPolygons.push(polygons.length);
      polygons.push({ points: corners.map((corner) => corner.p), surface: 0, uvs: corners.map((corner) => corner.uv) });
    }
  }
  return { geometry: { points, polygons }, newPoints, newPolygons };
}
