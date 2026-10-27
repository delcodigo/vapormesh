import { Mesh, type Polygon, type UV, type Vec3 } from '@/core';

/** Points within this distance are the same point to Merge Points and to Mirror's seam. */
export const MERGE_TOLERANCE = 0.0001;

/** The part of a mesh that structural edits rewrite. Surfaces are left alone. */
export interface Geometry {
  points: Vec3[];
  polygons: Polygon[];
}

export const clonePolygon = (p: Polygon): Polygon => ({
  points: [...p.points],
  surface: p.surface,
  ...(p.uvs && { uvs: p.uvs.map((uv): UV => [...uv]) }),
});

export const cloneGeometry = (g: Geometry): Geometry => ({
  points: g.points.map((p): Vec3 => [...p]),
  polygons: g.polygons.map(clonePolygon),
});

/** Keep only the points flagged in `keep` and renumber the polygons. The polygons must not use dropped points. */
function compact(points: Vec3[], polygons: Polygon[], keep: boolean[]): Geometry {
  const renumber = new Array<number>(points.length).fill(-1);
  const kept: Vec3[] = [];
  points.forEach((p, i) => {
    if (keep[i]) {
      renumber[i] = kept.length;
      kept.push([...p]);
    }
  });
  return {
    points: kept,
    polygons: polygons.map((p) => ({ ...clonePolygon(p), points: p.points.map((i) => renumber[i]!) })),
  };
}

/** Remove points, and every polygon that uses one of them. */
export function deletePoints(geo: Geometry, doomed: ReadonlySet<number>): Geometry {
  const polygons = geo.polygons.filter((p) => !p.points.some((i) => doomed.has(i)));
  return compact(geo.points, polygons, geo.points.map((_, i) => !doomed.has(i)));
}

/**
 * Remove polygons, and the points that only they used. A point that was already loose (used by no polygon)
 * is left alone, since someone put it there on purpose.
 */
export function deletePolygons(geo: Geometry, doomed: ReadonlySet<number>): Geometry {
  const remaining = geo.polygons.filter((_, i) => !doomed.has(i));
  const stillUsed = new Set(remaining.flatMap((p) => p.points));
  const wasUsedByDoomed = new Set(geo.polygons.filter((_, i) => doomed.has(i)).flatMap((p) => p.points));
  return compact(geo.points, remaining, geo.points.map((_, i) => stillUsed.has(i) || !wasUsedByDoomed.has(i)));
}

/**
 * For every point, the point it should become: itself, or the lowest-numbered point within `tolerance` of it.
 * Only the points in `ids` take part. Uses a grid so it stays fast on large meshes.
 */
export function findCoincident(points: Vec3[], ids: number[], tolerance: number): number[] {
  const mapping = points.map((_, i) => i);
  const cell = Math.max(tolerance, 1e-12);
  const cellOf = (p: Vec3) => p.map((c) => Math.floor(c / cell));
  const grid = new Map<string, number[]>();
  for (const i of [...ids].sort((a, b) => a - b)) {
    const p = points[i]!;
    const [cx, cy, cz] = cellOf(p) as [number, number, number];
    let target = -1;
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const q = points[j]!;
            if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tolerance) {
              target = j;
              break search;
            }
          }
        }
      }
    }
    if (target >= 0) mapping[i] = target;
    else {
      const key = `${cx},${cy},${cz}`;
      grid.set(key, [...(grid.get(key) ?? []), i]);
    }
  }
  return mapping;
}

/**
 * Apply a point mapping (`mapping[i]` is the point i becomes). Points that map elsewhere disappear, polygons are
 * rewritten (UV corners follow their points), repeated neighbours are dropped, and a polygon left with fewer than
 * three distinct points is removed.
 */
export function mergePoints(geo: Geometry, mapping: number[]): Geometry {
  const polygons: Polygon[] = [];
  for (const p of geo.polygons) {
    const points: number[] = [];
    const uvs: UV[] = [];
    p.points.forEach((i, c) => {
      const m = mapping[i]!;
      if (points.at(-1) === m) return; // two neighbours became the same point
      points.push(m);
      if (p.uvs) uvs.push([...p.uvs[c]!]);
    });
    while (points.length > 1 && points[0] === points.at(-1)) {
      points.pop();
      uvs.pop();
    }
    if (p.points.length >= 3 && new Set(points).size < 3) continue;
    polygons.push({ points, surface: p.surface, ...(p.uvs && { uvs }) });
  }
  return compact(geo.points, polygons, geo.points.map((_, i) => mapping[i] === i));
}

/** Reverse the winding of polygons (and their UV corners), turning them inside out. */
export function flipPolygons(geo: Geometry, ids: ReadonlySet<number>): Geometry {
  return {
    points: geo.points.map((p): Vec3 => [...p]),
    polygons: geo.polygons.map((p, i) => {
      const c = clonePolygon(p);
      if (!ids.has(i)) return c;
      c.points.reverse();
      c.uvs?.reverse();
      return c;
    }),
  };
}

/** Split polygons with more than three points into triangle fans. Returns the new numbers of everything that was selected. */
export function triangulate(geo: Geometry, ids: ReadonlySet<number>): { geometry: Geometry; selected: number[] } {
  const polygons: Polygon[] = [];
  const selected: number[] = [];
  geo.polygons.forEach((p, i) => {
    const mark = ids.has(i);
    if (!mark || p.points.length <= 3) {
      if (mark) selected.push(polygons.length);
      polygons.push(clonePolygon(p));
      return;
    }
    for (let k = 1; k < p.points.length - 1; k++) {
      const corners = [0, k, k + 1];
      if (mark) selected.push(polygons.length);
      polygons.push({
        points: corners.map((c) => p.points[c]!),
        surface: p.surface,
        ...(p.uvs && { uvs: corners.map((c): UV => [...p.uvs![c]!]) }),
      });
    }
  });
  return { geometry: { points: geo.points.map((p): Vec3 => [...p]), polygons }, selected };
}

/**
 * Copy polygons into a mesh of their own: only the points they use, renumbered in order of first use, and only the
 * surfaces they use. This is what the clipboard holds.
 */
export function extractPolygons(mesh: Mesh, ids: number[]): Mesh {
  const out = new Mesh();
  out.surfaces = [];
  const pointMap = new Map<number, number>();
  const surfaceMap = new Map<number, number>();
  for (const id of ids) {
    const p = mesh.polygons[id]!;
    for (const i of p.points) if (!pointMap.has(i)) pointMap.set(i, out.addPoint([...mesh.points[i]!]));
    if (!surfaceMap.has(p.surface)) {
      surfaceMap.set(p.surface, out.surfaces.length);
      out.surfaces.push({ ...mesh.surfaces[p.surface]! });
    }
    out.polygons.push({ ...clonePolygon(p), points: p.points.map((i) => pointMap.get(i)!), surface: surfaceMap.get(p.surface)! });
  }
  return out;
}
