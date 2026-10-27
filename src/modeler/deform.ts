import type { Vec3 } from '@/core';

export type DeformAxis = 'x' | 'y' | 'z';
export const AXIS_INDEX: Record<DeformAxis, number> = { x: 0, y: 1, z: 2 };

/**
 * A deformation of a set of points. Taper, twist and bend work along an axis, over the extent the points have along it; stretch
 * scales each world axis separately about the pivot.
 */
export type DeformSpec =
  | { kind: 'stretch'; factors: Vec3 }
  /** Scale the cross-section about the axis by `1 - amount * t`, with t from 0 at the low end to 1 at the high end. 1 pinches the high end to a point; negative flares it. */
  | { kind: 'taper'; axis: DeformAxis; amount: number }
  /** Turn each cross-section about the axis by `radians` per axis length, so the pivot stays put and the two ends turn opposite ways. */
  | { kind: 'twist'; axis: DeformAxis; radians: number }
  /** Curve the axis through `radians` in total, towards the `toward` axis, as if wrapped round a circle: lengths along the axis are kept. */
  | { kind: 'bend'; axis: DeformAxis; toward: DeformAxis; radians: number };

/** The extent of some points along an axis. */
export function extentAlong(points: Vec3[], axis: DeformAxis): { lo: number; hi: number; length: number } {
  const k = AXIS_INDEX[axis];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    lo = Math.min(lo, p[k]!);
    hi = Math.max(hi, p[k]!);
  }
  return points.length ? { lo, hi, length: hi - lo } : { lo: 0, hi: 0, length: 0 };
}

const EMPTY = 1e-12;

/**
 * The function that moves one point for this deformation. `points` are all the points being deformed, which fix the extent along the
 * axis; `pivot` is the point everything is about. A deformation with nothing to act on (no extent along the axis, zero angle) is the
 * identity.
 */
export function deformer(points: Vec3[], spec: DeformSpec, pivot: Vec3): (p: Vec3) => Vec3 {
  if (spec.kind === 'stretch') {
    const f = spec.factors;
    return (p) => [pivot[0] + (p[0] - pivot[0]) * f[0], pivot[1] + (p[1] - pivot[1]) * f[1], pivot[2] + (p[2] - pivot[2]) * f[2]];
  }
  const { lo, length } = extentAlong(points, spec.axis);
  if (length < EMPTY) return (p) => [...p];
  const a = AXIS_INDEX[spec.axis];
  const b = (a + 1) % 3; // the other two axes, in the order that makes a right-handed turn about `a` go from b to c
  const c = (a + 2) % 3;

  if (spec.kind === 'taper') {
    return (p) => {
      const f = 1 - (spec.amount * (p[a]! - lo)) / length;
      const out: Vec3 = [...p];
      out[b] = pivot[b]! + (p[b]! - pivot[b]!) * f;
      out[c] = pivot[c]! + (p[c]! - pivot[c]!) * f;
      return out;
    };
  }

  if (spec.kind === 'twist') {
    return (p) => {
      const phi = (spec.radians * (p[a]! - pivot[a]!)) / length;
      const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
      const [pb, pc] = [p[b]! - pivot[b]!, p[c]! - pivot[c]!];
      const out: Vec3 = [...p];
      out[b] = pivot[b]! + pb * cos - pc * sin;
      out[c] = pivot[c]! + pb * sin + pc * cos;
      return out;
    };
  }

  // bend: the axis becomes an arc of radius R = length / angle, curving towards `toward`
  if (Math.abs(spec.radians) < 1e-9) return (p) => [...p];
  const t = AXIS_INDEX[spec.toward === spec.axis ? (['x', 'y', 'z'] as const)[b]! : spec.toward];
  const radius = length / spec.radians;
  return (p) => {
    const s = p[a]! - pivot[a]!;
    const r = p[t]! - pivot[t]!;
    const phi = s / radius;
    const out: Vec3 = [...p];
    out[a] = pivot[a]! + (radius - r) * Math.sin(phi);
    // radius - (radius - r) cos(phi), written so it does not lose its digits when the bend is slight
    out[t] = pivot[t]! + r * Math.cos(phi) + 2 * radius * Math.sin(phi / 2) ** 2;
    return out;
  };
}

/** How strongly the magnet pulls a point `distance` from its centre: 1 at the centre, easing smoothly to 0 at `radius` and beyond. */
export function magnetWeight(distance: number, radius: number): number {
  if (!(radius > 0) || distance >= radius) return 0;
  const t = 1 - (distance / radius) ** 2;
  return t * t;
}

/**
 * Move points by `offset`, scaled by how close they are to `center` measured across the view (their distance along the way the view
 * looks does not count, so the magnet reaches straight through the model).
 */
export function magnet(center: Vec3, viewAxis: Vec3, radius: number, offset: Vec3): (p: Vec3) => Vec3 {
  const len = Math.hypot(...viewAxis) || 1;
  const n: Vec3 = [viewAxis[0] / len, viewAxis[1] / len, viewAxis[2] / len];
  return (p) => {
    const d: Vec3 = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    const w = magnetWeight(Math.hypot(d[0] - along * n[0], d[1] - along * n[1], d[2] - along * n[2]), radius);
    return [p[0] + offset[0] * w, p[1] + offset[1] * w, p[2] + offset[2] * w];
  };
}
