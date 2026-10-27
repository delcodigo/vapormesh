import { faceNormal, type Vec3 } from './math';
import type { Mesh, UV } from './mesh';

/** Default texel density: a 64-pixel texture spans two world units. */
export const TEXELS_PER_UNIT = 32;
export const DEFAULT_TEXTURE_SIZE = 64;

/**
 * Project one polygon along the axis its normal faces most (Quake's rule), at a fixed texel density, so a bigger
 * face shows more repeats instead of a stretched texture. Each face reads the right way round seen from outside,
 * and neighbouring faces on the same axis line up. UVs are normalised by the texture size (origin top-left, v down).
 */
export function boxProjectPolygon(points: Vec3[], texWidth: number, texHeight: number, texelsPerUnit = TEXELS_PER_UNIT): UV[] {
  const [nx, ny, nz] = faceNormal(points);
  const [ax, ay, az] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
  const project = ([x, y, z]: Vec3): UV => {
    if (ax >= ay && ax >= az && ax > 0) return nx > 0 ? [-z, -y] : [z, -y]; // +X / -X
    if (ay >= az && ay > 0) return ny > 0 ? [x, z] : [x, -z]; // +Y / -Y
    return nz < 0 ? [-x, -y] : [x, -y]; // +Z / -Z (also the fallback for a degenerate polygon)
  };
  return points.map((p) => {
    const [u, v] = project(p);
    return [(u * texelsPerUnit) / texWidth, (v * texelsPerUnit) / texHeight];
  });
}

/** Give every polygon of a mesh box-projected UVs for a texture of the given size. */
export function assignAutoUvs(mesh: Mesh, texWidth = DEFAULT_TEXTURE_SIZE, texHeight = DEFAULT_TEXTURE_SIZE): void {
  for (const poly of mesh.polygons) {
    poly.uvs = boxProjectPolygon(poly.points.map((i) => mesh.points[i]!), texWidth, texHeight);
  }
}

// --- projections -----------------------------------------------------------------------------------------------

export type ProjectionAxis = 'x' | 'y' | 'z';

/**
 * How to generate UVs. Box and planar use a fixed texel density (a bigger face shows more repeats); cylindrical and
 * spherical wrap once around the axis (u 0..1) and stretch pole to pole or end to end (v 0..1), ready to be moved
 * and scaled into place in the UV editor.
 */
export type Projection =
  | { kind: 'box' }
  | { kind: 'planar'; axis: ProjectionAxis }
  | { kind: 'cylindrical'; axis: ProjectionAxis }
  | { kind: 'spherical'; axis: ProjectionAxis };

/** Rotate world coordinates so `axis` becomes +Y. A proper rotation, so handedness and winding are preserved. */
function toAxisFrame([x, y, z]: Vec3, axis: ProjectionAxis): Vec3 {
  if (axis === 'z') return [x, z, -y];
  if (axis === 'x') return [-y, x, z];
  return [x, y, z];
}

/** Project along an axis as seen from its positive side, so +Z reads like the front of a box. */
function planar([x, y, z]: Vec3, axis: ProjectionAxis): [number, number] {
  if (axis === 'x') return [-z, -y];
  if (axis === 'y') return [x, z];
  return [x, -y];
}

const TAU = Math.PI * 2;
const wrapPi = (a: number) => a - TAU * Math.round(a / TAU); // into [-pi, pi]

/**
 * Wrap points around an axis. Returns one UV per point. Angles are unwrapped per polygon so a polygon that crosses
 * the seam stays small (its u may run slightly past 1) instead of stretching across the whole texture, and points
 * on the axis itself (the poles) take the u of their polygon's other corners, since their angle is undefined.
 */
function wrapAround(polys: Vec3[][], axis: ProjectionAxis, spherical: boolean): UV[][] {
  const local = polys.map((poly) => poly.map((p) => toAxisFrame(p, axis)));
  const all = local.flat();
  if (all.length === 0) return polys.map(() => []);
  const lo = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]!)));
  const hi = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k]!)));
  const center = [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2);
  const size = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!, 1e-9);
  const onAxis = size * 1e-6;
  const height = hi[1]! - lo[1]!;

  return local.map((poly) => {
    const dx = poly.map((p) => p[0] - center[0]!);
    const dz = poly.map((p) => p[2] - center[2]!);
    const radial = dx.map((x, i) => Math.hypot(x, dz[i]!));
    const angle = dx.map((x, i) => Math.atan2(x, dz[i]!)); // 0 at +Z, growing towards +X: u grows to the right seen from outside
    const first = radial.findIndex((r) => r > onAxis);
    const us: (number | null)[] = poly.map(() => null);
    if (first >= 0) {
      const u0 = (((angle[first]! / TAU) % 1) + 1) % 1;
      poly.forEach((_, i) => {
        if (radial[i]! > onAxis) us[i] = u0 + wrapPi(angle[i]! - angle[first]!) / TAU;
      });
    }
    const known = us.filter((u): u is number => u !== null);
    const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0.5;
    return poly.map((p, i): UV => {
      let v: number;
      if (spherical) {
        const r = Math.hypot(p[0] - center[0]!, p[1] - center[1]!, p[2] - center[2]!);
        v = 0.5 - Math.asin(Math.min(Math.max(r > 0 ? (p[1] - center[1]!) / r : 0, -1), 1)) / Math.PI;
      } else {
        v = height > 0 ? (hi[1]! - p[1]) / height : 0;
      }
      return [us[i] ?? mean, v];
    });
  });
}

/**
 * UVs for some polygons of a mesh. `textureSize` gives the size of the texture a polygon will use, for the fixed-density
 * projections. The wrapping projections frame themselves on the polygons given, so project a whole object at once.
 */
export function projectPolygons(
  mesh: Mesh,
  polygonIds: number[],
  projection: Projection,
  textureSize: (polygon: number) => [number, number] = () => [DEFAULT_TEXTURE_SIZE, DEFAULT_TEXTURE_SIZE],
): UV[][] {
  const points = polygonIds.map((id) => mesh.polygons[id]!.points.map((i) => mesh.points[i]!));
  if (projection.kind === 'box') return points.map((pts, k) => boxProjectPolygon(pts, ...textureSize(polygonIds[k]!)));
  if (projection.kind === 'planar') {
    return points.map((pts, k) => {
      const [w, h] = textureSize(polygonIds[k]!);
      return pts.map((p): UV => {
        const [u, v] = planar(p, projection.axis);
        return [(u * TEXELS_PER_UNIT) / w, (v * TEXELS_PER_UNIT) / h];
      });
    });
  }
  return wrapAround(points, projection.axis, projection.kind === 'spherical');
}
