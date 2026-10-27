import { Mesh } from '@/core';

export type SelectMode = 'points' | 'polygons';
export type SelectOp = 'replace' | 'toggle';

/** Owns the mesh being modeled and the current selection. Tools mutate through this and call `changed()`. */
export class ModelerState {
  mode: SelectMode = 'points';
  readonly selectedPoints = new Set<number>();
  readonly selectedPolygons = new Set<number>();
  /** Bumped on every change so views know when to rebuild. */
  version = 0;

  private listeners = new Set<() => void>();

  constructor(public mesh: Mesh = new Mesh()) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call after mutating mesh or selection. */
  changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  setMesh(mesh: Mesh): void {
    this.mesh = mesh;
    this.selectedPoints.clear();
    this.selectedPolygons.clear();
    this.changed();
  }

  setMode(mode: SelectMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.changed();
  }

  get selection(): Set<number> {
    return this.mode === 'points' ? this.selectedPoints : this.selectedPolygons;
  }

  /** Apply a pick result to the current mode's selection. `null` means the click hit nothing. */
  applyPick(id: number | null, op: SelectOp): void {
    const sel = this.selection;
    if (op === 'replace') {
      sel.clear();
      if (id !== null) sel.add(id);
    } else if (id !== null) {
      if (!sel.delete(id)) sel.add(id);
    }
    this.changed();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.changed();
  }
}
