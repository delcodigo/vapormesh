import type { Mesh, Vec3 } from '@/core';
import type { Command } from './history';
import type { ModelerState } from './state';

/** What a tool needs to know about the viewport it is dragging in. */
export interface ViewInfo {
  isOrtho: boolean;
  /** Unit vector from the scene towards the viewer. */
  viewAxis: Vec3;
  project(p: Vec3): { x: number; y: number };
}

/** One step of a drag: world-space offset plus canvas-pixel positions. */
export interface DragMove {
  offset: Vec3;
  start: { x: number; y: number };
  current: { x: number; y: number };
}

/** An interactive tool driven by a viewport drag. */
export interface DragTool {
  begin(view: ViewInfo): boolean;
  move(info: DragMove): void;
  end(): void;
  cancel(): void;
}

export class TransformPointsCommand implements Command {
  constructor(
    readonly label: string,
    private mesh: Mesh,
    private ids: number[],
    private before: Vec3[],
    private after: Vec3[],
  ) {}

  redo(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }

  private apply(positions: Vec3[]): void {
    this.ids.forEach((id, i) => (this.mesh.points[id] = [...positions[i]!]));
  }
}

/**
 * Base for tools that transform points during a drag. Every `move` recomputes from the positions captured
 * at `begin`, so repeated moves never accumulate drift, and `end` records one undo step.
 */
export abstract class PointDrag implements DragTool {
  protected ids: number[] = [];
  protected before: Vec3[] = [];

  protected constructor(
    protected state: ModelerState,
    private label: string,
  ) {}

  /** Returns true if this tool takes over the drag. Only orthographic views define a drag plane. */
  begin(view: ViewInfo): boolean {
    if (!view.isOrtho) return false;
    const ids = this.state.affectedPoints();
    if (ids.length === 0) return false;
    this.ids = ids;
    this.before = ids.map((i) => [...this.state.mesh.points[i]!] as Vec3);
    if (!this.start(view)) {
      this.reset();
      return false;
    }
    return true;
  }

  /** Hook for subclasses to capture pivot, axis, etc. Return false to decline the drag. */
  protected start(_view: ViewInfo): boolean {
    return true;
  }

  abstract move(info: DragMove): void;

  /** Set each captured point to `fn(original position)` and redraw. */
  protected transform(fn: (p: Vec3) => Vec3): void {
    const { points } = this.state.mesh;
    this.ids.forEach((id, i) => (points[id] = fn(this.before[i]!)));
    this.state.changed();
  }

  end(): void {
    const { mesh } = this.state;
    const after = this.ids.map((i) => [...mesh.points[i]!] as Vec3);
    const changed = after.some((p, i) => p.some((c, axis) => c !== this.before[i]![axis]));
    const cmd = changed && new TransformPointsCommand(this.label, mesh, this.ids, this.before, after);
    this.reset();
    if (cmd) this.state.record(cmd);
    else this.state.changed();
  }

  /** Abandon the drag and put the points back. */
  cancel(): void {
    this.ids.forEach((id, i) => (this.state.mesh.points[id] = [...this.before[i]!]));
    this.reset();
    this.state.changed();
  }

  private reset(): void {
    this.ids = [];
    this.before = [];
    this.state.dragPivot = null;
  }
}
