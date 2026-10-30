import type { Vec3 } from './math';

/** A named material, LightWave-style "surface" (assigned per polygon). */
export interface Surface {
  name: string;
  /** Base colour: an index into the project palette, so editing the palette recolours every surface that uses it. */
  colorIndex: number;
  diffuse: number;
  luminosity: number;
  specular: number;
  glossiness: number;
  smoothing: boolean; // Gouraud vs flat
  /** Neighbouring polygons within this angle (degrees) share a smoothed normal; sharper edges stay hard. */
  smoothingAngle: number;
  doubleSided: boolean;
  /** Name of an image in the project, or null for a plain colour. */
  texture: string | null;
  /** What UVs outside 0..1 do: tile (walls) or hold the edge pixel (atlas regions). */
  wrap: 'repeat' | 'clamp';
  /** Colour-key transparency: texels of the texture that use palette entry 0 are see-through. */
  transparent: boolean;
}

export function defaultSurface(name = 'Default'): Surface {
  return {
    name,
    colorIndex: 12, // a light grey in the default palette
    diffuse: 1,
    luminosity: 0,
    specular: 0,
    glossiness: 0.2,
    smoothing: false,
    smoothingAngle: 89,
    doubleSided: false,
    texture: null,
    wrap: 'repeat',
    transparent: false,
  };
}

/** N-gon, indices into Mesh.points. LightWave polygons are not limited to triangles. */
export interface Polygon {
  points: number[];
  surface: number; // index into Mesh.surfaces
  /**
   * Texture coordinates, one per corner and parallel to `points`. Per corner (not per point) so a face can
   * sit anywhere in a shared atlas. Origin top-left, v grows downward, like the image itself. Optional.
   */
  uvs?: UV[];
}

export type UV = [number, number];

/** Array lengths of a mesh at a moment in time, used to undo an `append`. */
export interface MeshSize {
  points: number;
  polygons: number;
  surfaces: number;
}

/** Points + polygons + surfaces: the LightWave object model. */
export class Mesh {
  points: Vec3[] = [];
  polygons: Polygon[] = [];
  surfaces: Surface[] = [defaultSurface()];
  /**
   * Polygons hidden in the editor (display state: not saved, not undoable). Structural edits renumber polygons, so they
   * clear it. Hidden polygons are not drawn, picked or selected.
   */
  readonly hidden = new Set<number>();

  /** Points that belong to polygons, all of which are hidden. Points no polygon uses are never hidden. */
  hiddenPoints(): Set<number> {
    const out = new Set<number>();
    if (this.hidden.size === 0) return out;
    const seenVisible = new Set<number>();
    this.polygons.forEach((poly, i) => {
      if (this.hidden.has(i)) poly.points.forEach((p) => out.add(p));
      else poly.points.forEach((p) => seenVisible.add(p));
    });
    for (const p of seenVisible) out.delete(p);
    return out;
  }

  addPoint(p: Vec3): number {
    return this.points.push(p) - 1;
  }

  addPolygon(points: number[], surface = 0): number {
    return this.polygons.push({ points, surface }) - 1;
  }

  size(): MeshSize {
    return { points: this.points.length, polygons: this.polygons.length, surfaces: this.surfaces.length };
  }

  /** Copy another mesh's geometry into this one, reusing surfaces with the same name. Returns the prior size. */
  append(other: Mesh): MeshSize {
    const before = this.size();
    const surfaceMap = other.surfaces.map((surface) => {
      const existing = this.surfaces.findIndex((s) => s.name === surface.name);
      if (existing >= 0) return existing;
      this.surfaces.push({ ...surface });
      return this.surfaces.length - 1;
    });
    const base = this.points.length;
    for (const p of other.points) this.points.push([...p]);
    for (const poly of other.polygons) {
      this.polygons.push({
        points: poly.points.map((i) => i + base),
        surface: surfaceMap[poly.surface]!,
        ...(poly.uvs && { uvs: poly.uvs.map((uv): UV => [...uv]) }),
      });
    }
    return before;
  }

  /** Undo an `append` by cutting the arrays back to `size`. */
  truncate(size: MeshSize): void {
    this.points.length = size.points;
    this.polygons.length = size.polygons;
    this.surfaces.length = size.surfaces;
    for (const id of this.hidden) if (id >= size.polygons) this.hidden.delete(id);
  }
}
