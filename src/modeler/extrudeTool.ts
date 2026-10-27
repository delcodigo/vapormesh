import type { Vec3 } from '@/core';
import { extrudeDirection, ReplaceGeometryCommand, snapshotSelection, textureSizeOf, type ExtrudeAxis, type Selection } from './edit';
import { averageNormal, extrude, type ExtrudeResult } from './extrude';
import { cloneGeometry, type Geometry } from './geometry';
import type { DragMove, DragTool, ViewInfo } from './pointDrag';
import type { ModelerState } from './state';

/** What the options panel decides; the distance comes from the drag. */
export interface ExtrudeToolSettings {
  inset: number;
  direction: ExtrudeAxis;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Extrude (or bevel) the selected polygons by dragging in an orthographic view. The distance is how far the pointer moved
 * along the direction (the selection's average normal, or the chosen axis), so drag in a view where that direction is
 * visible. Every move rebuilds the extrusion from the original geometry, so it never drifts, and one drag is one undo step.
 */
export class ExtrudeTool implements DragTool {
  private base: Geometry | null = null;
  private selectionBefore: Selection | null = null;
  private ids: number[] = [];
  private basis: Vec3 = [0, 0, 0];
  private result: ExtrudeResult | null = null;

  constructor(
    private state: ModelerState,
    private settings: () => ExtrudeToolSettings,
    private label: 'Extrude' | 'Bevel',
  ) {}

  begin(view: ViewInfo): boolean {
    if (!view.isOrtho) return false;
    const ids = this.state.selectedPolygonIds();
    if (ids.length === 0) return false;
    const base = cloneGeometry(this.state.mesh);
    const direction = extrudeDirection(this.settings().direction);
    const basis = direction.kind === 'vector' ? direction.vector : averageNormal(base, ids);
    if (basis.every((c) => c === 0)) return false; // a closed selection whose normals cancel: no direction to drag along
    Object.assign(this, { base, ids, basis, selectionBefore: snapshotSelection(this.state), result: null });
    return true;
  }

  move({ offset }: DragMove): void {
    const distance = dot(offset, this.basis);
    const { inset, direction } = this.settings();
    if (Math.abs(distance) < 1e-9 && inset === 0) {
      this.result = null; // nothing to show yet: the original geometry
      this.show(this.base!);
      return;
    }
    this.result = extrude(this.base!, new Set(this.ids), { distance, inset, direction: extrudeDirection(direction), textureSize: textureSizeOf(this.state) });
    this.show(this.result.geometry);
  }

  end(): void {
    const { base, result, selectionBefore, ids } = this;
    this.reset();
    if (!base || !result) return void this.state.changed();
    // the mesh already shows the result; executing re-applies it, selects the new polygons and records one undo step
    this.state.execute(
      new ReplaceGeometryCommand(this.label, this.state, result.geometry, { points: result.capPoints, polygons: ids }, { geometry: base, selection: selectionBefore! }),
    );
  }

  /** Abandon the drag and put the original geometry back. */
  cancel(): void {
    if (this.base) this.show(this.base);
    this.reset();
  }

  private show(geo: Geometry): void {
    const copy = cloneGeometry(geo);
    this.state.mesh.points = copy.points;
    this.state.mesh.polygons = copy.polygons;
    this.state.mesh.hidden.clear();
    this.state.changed();
  }

  private reset(): void {
    this.base = null;
    this.result = null;
    this.selectionBefore = null;
    this.ids = [];
  }
}
