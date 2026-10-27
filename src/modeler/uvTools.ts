import { DEFAULT_TEXTURE_SIZE, projectPolygons, type Projection, type UV } from '@/core';
import type { Command } from './history';
import type { ModelerState } from './state';
import type { Mesh } from '@/core';

const copy = (uvs: UV[] | undefined) => uvs?.map((uv): UV => [...uv]);

/** Replace the UVs of some polygons. Undo restores them, including "had none". */
export class SetUvsCommand implements Command {
  private before: (UV[] | undefined)[];
  private after: (UV[] | undefined)[];

  /** `before` defaults to the mesh as it is now; pass it when an interactive edit has already changed the mesh. */
  constructor(
    readonly label: string,
    private mesh: Mesh,
    private polygons: number[],
    after: (UV[] | undefined)[],
    before?: (UV[] | undefined)[],
  ) {
    this.before = (before ?? polygons.map((p) => mesh.polygons[p]!.uvs)).map(copy);
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
 * Generate UVs for the selected polygons, or the whole layer if none are selected. Fixed-density projections size
 * themselves for each polygon's surface texture (64x64 if it has none). One undo step. Returns false if nothing changed.
 */
export function applyProjection(state: ModelerState, projection: Projection): boolean {
  const { mesh } = state;
  const selected = state.selectedPolygonIds();
  const ids = selected.length ? selected : mesh.polygons.map((_, i) => i);
  const sizeOf = (polygon: number): [number, number] => {
    const surface = mesh.surfaces[mesh.polygons[polygon]!.surface];
    const texture = state.images.find((im) => im.name === surface?.texture);
    return [texture?.width ?? DEFAULT_TEXTURE_SIZE, texture?.height ?? DEFAULT_TEXTURE_SIZE];
  };
  const after = projectPolygons(mesh, ids, projection, sizeOf);
  const unchanged = ids.every((id, k) => JSON.stringify(mesh.polygons[id]!.uvs) === JSON.stringify(after[k]));
  if (ids.length === 0 || unchanged) return false;
  state.execute(new SetUvsCommand(projection.kind === 'box' ? 'Auto UV' : `${projection.kind[0]!.toUpperCase()}${projection.kind.slice(1)} UV`, mesh, ids, after));
  return true;
}

/** Box-project UVs (fixed texel density): the Auto UV button. */
export const applyAutoUv = (state: ModelerState): boolean => applyProjection(state, { kind: 'box' });
