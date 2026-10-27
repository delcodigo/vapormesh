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
