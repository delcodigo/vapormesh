import { boxProjectPolygon, DEFAULT_TEXTURE_SIZE, type UV } from '@/core';
import type { Command } from './history';
import type { ModelerState } from './state';
import type { Mesh } from '@/core';

const copy = (uvs: UV[] | undefined) => uvs?.map((uv): UV => [...uv]);

/** Replace the UVs of some polygons. Undo restores them, including "had none". */
export class SetUvsCommand implements Command {
  private before: (UV[] | undefined)[];
  private after: (UV[] | undefined)[];

  constructor(
    readonly label: string,
    private mesh: Mesh,
    private polygons: number[],
    after: (UV[] | undefined)[],
  ) {
    this.before = polygons.map((p) => copy(mesh.polygons[p]!.uvs));
    this.after = after.map(copy);
  }

  redo(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }

  private apply(uvs: (UV[] | undefined)[]): void {
    this.polygons.forEach((p, i) => {
      const poly = this.mesh.polygons[p]!;
      const value = copy(uvs[i]);
      if (value) poly.uvs = value;
      else delete poly.uvs;
    });
  }
}

/**
 * Box-project UVs (fixed texel density) for the selected polygons, or the whole layer if none are selected,
 * sized for each polygon's surface texture (64x64 if it has none). One undo step. Returns false if nothing changed.
 */
export function applyAutoUv(state: ModelerState): boolean {
  const { mesh } = state;
  const selected = state.selectedPolygonIds();
  const ids = selected.length ? selected : mesh.polygons.map((_, i) => i);
  const after = ids.map((i) => {
    const poly = mesh.polygons[i]!;
    const texture = state.images.find((im) => im.name === mesh.surfaces[poly.surface]?.texture);
    const pts = poly.points.map((p) => mesh.points[p]!);
    return boxProjectPolygon(pts, texture?.width ?? DEFAULT_TEXTURE_SIZE, texture?.height ?? DEFAULT_TEXTURE_SIZE);
  });
  const unchanged = ids.every((id, k) => JSON.stringify(mesh.polygons[id]!.uvs) === JSON.stringify(after[k]));
  if (ids.length === 0 || unchanged) return false;
  state.execute(new SetUvsCommand('Auto UV', mesh, ids, after));
  return true;
}
