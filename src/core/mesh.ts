import type { Vec3 } from './math';

/** A named material, LightWave-style "surface" (assigned per polygon). */
export interface Surface {
  name: string;
  color: Vec3; // 0..1
  diffuse: number;
  luminosity: number;
  specular: number;
  glossiness: number;
  smoothing: boolean; // Gouraud vs flat
  doubleSided: boolean;
}

export function defaultSurface(name = 'Default'): Surface {
  return {
    name,
    color: [0.8, 0.8, 0.8],
    diffuse: 1,
    luminosity: 0,
    specular: 0,
    glossiness: 0.2,
    smoothing: false,
    doubleSided: false,
  };
}

/** N-gon, indices into Mesh.points. LightWave polygons are not limited to triangles. */
export interface Polygon {
  points: number[];
  surface: number; // index into Mesh.surfaces
}

/** Points + polygons + surfaces: the LightWave object model. */
export class Mesh {
  points: Vec3[] = [];
  polygons: Polygon[] = [];
  surfaces: Surface[] = [defaultSurface()];

  addPoint(p: Vec3): number {
    return this.points.push(p) - 1;
  }

  addPolygon(points: number[], surface = 0): number {
    return this.polygons.push({ points, surface }) - 1;
  }
}
