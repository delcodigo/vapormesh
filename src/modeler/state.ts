import { Mesh, type Vec3 } from '@/core';
import { History, type Command } from './history';

export type SelectMode = 'points' | 'polygons';
export type SelectOp = 'replace' | 'toggle';
export type SelectionOp = 'replace' | 'add' | 'remove';
export type ToolName = 'move' | 'rotate' | 'size';

/** Owns the mesh being modeled and the current selection. Tools mutate through this and call `changed()`. */
export class ModelerState {
  mode: SelectMode = 'points';
  /** Tool that owns left-drags in the viewports; null means drags only navigate. */
  activeTool: ToolName | null = null;
  readonly history = new History();
  /** Pivot held fixed by a rotate/size drag in progress, so the marker doesn't follow the points. */
  dragPivot: Vec3 | null = null;
  /** User-placed pivot for rotate/size. Null means "centre of what is being edited". */
  customPivot: Vec3 | null = null;
  /** Which tab the Numeric panel shows, or null when it is closed. */
  numericOp: ToolName | null = null;
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
    this.history.clear();
    this.customPivot = null;
    this.changed();
  }

  setTool(tool: ToolName | null): void {
    if (tool === this.activeTool) return;
    this.activeTool = tool;
    this.changed();
  }

  setPivot(pivot: Vec3 | null): void {
    this.customPivot = pivot;
    this.changed();
  }

  setNumericOp(op: ToolName | null): void {
    if (op === this.numericOp) return;
    this.numericOp = op;
    this.changed();
  }

  /** Apply a command and make it undoable. */
  execute(cmd: Command): void {
    cmd.redo();
    this.record(cmd);
  }

  /** Make an already-applied edit undoable (used by interactive tools that preview live). */
  record(cmd: Command): void {
    this.history.record(cmd);
    this.changed();
  }

  undo(): void {
    if (this.history.undo()) this.changed();
  }

  redo(): void {
    if (this.history.redo()) this.changed();
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

  /** Apply a set of ids (e.g. from a box select) to the current mode's selection. */
  applySelection(ids: Iterable<number>, op: SelectionOp): void {
    const sel = this.selection;
    if (op === 'replace') sel.clear();
    for (const id of ids) {
      if (op === 'remove') sel.delete(id);
      else sel.add(id);
    }
    this.changed();
  }

  private get selectableCount(): number {
    return this.mode === 'points' ? this.mesh.points.length : this.mesh.polygons.length;
  }

  selectAll(): void {
    this.applySelection(Array.from({ length: this.selectableCount }, (_, i) => i), 'replace');
  }

  invertSelection(): void {
    const sel = this.selection;
    const inverted = Array.from({ length: this.selectableCount }, (_, i) => i).filter((i) => !sel.has(i));
    this.applySelection(inverted, 'replace');
  }

  /** Points a transform acts on: the selection (or its polygons' points), or the whole object if empty. */
  affectedPoints(): number[] {
    const { mesh, mode, selection } = this;
    if (selection.size === 0) return mesh.points.map((_, i) => i);
    if (mode === 'points') return [...selection];
    return [...new Set([...selection].flatMap((pi) => mesh.polygons[pi]!.points))];
  }

  /** Centre of the bounding box of the given points. */
  centerOf(ids: number[]): Vec3 | null {
    if (ids.length === 0) return null;
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const id of ids) {
      this.mesh.points[id]!.forEach((c, axis) => {
        lo[axis] = Math.min(lo[axis]!, c);
        hi[axis] = Math.max(hi[axis]!, c);
      });
    }
    return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  }

  /** Pivot for transforming these points: the user's, if placed, otherwise their bounding-box centre. */
  pivotFor(ids: number[]): Vec3 | null {
    return this.customPivot ?? this.centerOf(ids);
  }

  /** Where rotate/size act from right now. */
  pivot(): Vec3 | null {
    return this.dragPivot ?? this.pivotFor(this.affectedPoints());
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.changed();
  }
}
