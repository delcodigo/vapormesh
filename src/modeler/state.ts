import { defaultImages, defaultPalette, Mesh, type IndexedImage, type Palette, type Vec3 } from '@/core';
import { History, type Command } from './history';
import type { PrimitiveName } from './create';

export type SelectMode = 'points' | 'polygons';
export type SelectOp = 'replace' | 'toggle';
export type SelectionOp = 'replace' | 'add' | 'remove';
/** Tools whose values the Numeric panel can type in. */
export type TransformToolName = 'move' | 'rotate' | 'size';
/** Every tool that owns drags in the viewports. */
export type ToolName = TransformToolName | 'extrude' | 'bevel' | 'knife';

/** LightWave 4 Modeler has ten layers; the active one is edited, the others show as background. */
export const LAYER_COUNT = 10;

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
  numericOp: TransformToolName | null = null;
  /** Which primitive's create dialog is open, or null. */
  createOp: PrimitiveName | null = null;
  readonly layers: Mesh[];
  activeLayer = 0;
  /** Copied polygons, with their own points and surfaces. Survives layer changes, so you can paste into another layer. */
  clipboard: Mesh | null = null;
  /** Project-wide: one palette shared by every tool, and the images surfaces refer to by name. Replace, don't mutate. */
  palette: Palette = defaultPalette();
  images: IndexedImage[] = defaultImages();
  readonly selectedPoints = new Set<number>();
  readonly selectedPolygons = new Set<number>();
  /** Bumped on every change so views know when to rebuild. */
  version = 0;

  private listeners = new Set<() => void>();

  constructor(mesh: Mesh = new Mesh()) {
    this.layers = Array.from({ length: LAYER_COUNT }, (_, i) => (i === 0 ? mesh : new Mesh()));
  }

  /** The mesh of the active layer: what tools edit and clicks pick. */
  get mesh(): Mesh {
    return this.layers[this.activeLayer]!;
  }

  /** First layer other than the active one that holds no geometry, or null if all are used. */
  firstEmptyLayer(): number | null {
    const i = this.layers.findIndex((m, idx) => idx !== this.activeLayer && m.points.length === 0);
    return i < 0 ? null : i;
  }

  /** Replace the whole model (e.g. when opening a file). Missing layers become empty; history is cleared. */
  loadLayers(
    layers: Mesh[],
    activeLayer: number,
    assets: { palette: Palette; images: IndexedImage[] } = { palette: defaultPalette(), images: defaultImages() },
  ): void {
    this.palette = assets.palette;
    this.images = assets.images;
    for (let i = 0; i < LAYER_COUNT; i++) this.layers[i] = layers[i] ?? new Mesh();
    this.activeLayer = Math.min(Math.max(activeLayer, 0), LAYER_COUNT - 1);
    this.selectedPoints.clear();
    this.selectedPolygons.clear();
    this.customPivot = null;
    this.dragPivot = null;
    this.history.clear();
    this.changed();
  }

  setActiveLayer(layer: number): void {
    if (layer === this.activeLayer || layer < 0 || layer >= LAYER_COUNT) return;
    this.activeLayer = layer;
    this.selectedPoints.clear();
    this.selectedPolygons.clear();
    this.dragPivot = null;
    this.changed();
  }

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
    this.layers[this.activeLayer] = mesh;
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

  setCreateOp(op: PrimitiveName | null): void {
    if (op === this.createOp) return;
    this.createOp = op;
    this.changed();
  }

  setClipboard(clip: Mesh | null): void {
    this.clipboard = clip;
    this.changed();
  }

  setNumericOp(op: TransformToolName | null): void {
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
    if (this.history.undo()) {
      this.pruneSelection();
      this.changed();
    }
  }

  redo(): void {
    if (this.history.redo()) {
      this.pruneSelection();
      this.changed();
    }
  }

  /** Drop selected ids that no longer exist (e.g. after undoing a create). */
  private pruneSelection(): void {
    for (const id of this.selectedPoints) if (id >= this.mesh.points.length) this.selectedPoints.delete(id);
    for (const id of this.selectedPolygons) if (id >= this.mesh.polygons.length) this.selectedPolygons.delete(id);
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

  /** Polygons a surface assignment applies to: selected polygons, or those whose points are all selected. */
  selectedPolygonIds(): number[] {
    if (this.mode === 'polygons') return [...this.selectedPolygons];
    if (this.selectedPoints.size === 0) return [];
    return this.mesh.polygons.flatMap((poly, i) => (poly.points.every((p) => this.selectedPoints.has(p)) ? [i] : []));
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.changed();
  }
}
