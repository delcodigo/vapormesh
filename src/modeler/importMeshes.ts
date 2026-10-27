import type { Mesh, MeshSize, Surface } from '@/core';
import { clonePolygon } from './geometry';
import type { Command } from './history';
import { LAYER_COUNT, type ModelerState } from './state';

/**
 * Adds meshes to layers in one step: undo cuts them all back out and returns to the layer that was active. An empty layer takes
 * the mesh's surfaces as they are; merging by name, as for a primitive added to a model, would fold an imported "Default" into the
 * layer's own and lose its settings.
 */
export class AddMeshesCommand implements Command {
  readonly projectWide = true;
  /** What each entry did, to undo it: a size to cut back to, or the surfaces an empty layer had before. */
  private undoers: ({ size: MeshSize } | { surfaces: Surface[] })[] = [];
  private previousLayer = 0;

  constructor(
    private state: ModelerState,
    private entries: { mesh: Mesh; layer: number }[],
    readonly label: string,
  ) {}

  redo(): void {
    this.previousLayer = this.state.activeLayer;
    this.undoers = this.entries.map(({ mesh, layer }) => {
      const target = this.state.layers[layer]!;
      if (target.points.length > 0 || target.polygons.length > 0) return { size: target.append(mesh) };
      const surfaces = target.surfaces;
      target.points = mesh.points.map((p) => [...p]);
      target.polygons = mesh.polygons.map(clonePolygon);
      target.surfaces = mesh.surfaces.map((s) => ({ ...s }));
      return { surfaces };
    });
    this.state.setActiveLayer(this.entries[0]!.layer);
  }

  undo(): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const target = this.state.layers[this.entries[i]!.layer]!;
      const undo = this.undoers[i]!;
      if ('size' in undo) target.truncate(undo.size);
      else {
        target.points = [];
        target.polygons = [];
        target.surfaces = undo.surfaces;
        target.hidden.clear();
      }
    }
    this.state.setActiveLayer(this.previousLayer);
  }
}

export interface ImportPlacement {
  /** The layers that received something, in order. */
  layers: number[];
  /** Groups that did not get a layer of their own and were merged into the last one. */
  merged: number;
}

/**
 * Put imported groups into empty layers, one each, in order. When there are more groups than empty layers the rest are merged
 * into the last layer used (or the active layer, if there was no empty one). The imported geometry is added next to what is
 * already there and nothing is replaced.
 */
export function addMeshesToLayers(state: ModelerState, groups: readonly { name: string; mesh: Mesh }[]): ImportPlacement {
  const empty = Array.from({ length: LAYER_COUNT }, (_, i) => i).filter((i) => state.layers[i]!.points.length === 0);
  const entries: { mesh: Mesh; layer: number }[] = [];
  let merged = 0;
  groups.forEach((group, i) => {
    const layer = empty[i] ?? entries[entries.length - 1]?.layer ?? state.activeLayer;
    if (empty[i] === undefined) merged++;
    entries.push({ mesh: group.mesh, layer });
  });
  if (entries.length === 0) return { layers: [], merged: 0 };
  state.execute(new AddMeshesCommand(state, entries, groups.length === 1 ? 'Import OBJ' : `Import OBJ (${groups.length} objects)`));
  return { layers: [...new Set(entries.map((e) => e.layer))], merged };
}
