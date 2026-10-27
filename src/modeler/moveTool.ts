import type { Mesh, Vec3 } from '@/core';
import type { Command } from './history';
import type { ModelerState } from './state';

export class MovePointsCommand implements Command {
  readonly label = 'Move';

  constructor(
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
 * Drags points by a world-space offset. Like LightWave, with nothing selected it moves the whole object.
 * Works from the positions captured at `begin`, so repeated `move` calls never accumulate drift.
 */
export class MoveTool {
  private ids: number[] = [];
  private before: Vec3[] = [];
  private offset: Vec3 = [0, 0, 0];

  constructor(private state: ModelerState) {}

  /** Returns true if this tool takes over the drag. Only orthographic views define a drag plane. */
  begin(view: { isOrtho: boolean }): boolean {
    if (!view.isOrtho) return false;
    const { mesh, mode, selection } = this.state;
    let ids: number[];
    if (selection.size === 0) ids = mesh.points.map((_, i) => i);
    else if (mode === 'points') ids = [...selection];
    else ids = [...new Set([...selection].flatMap((pi) => mesh.polygons[pi]!.points))];
    if (ids.length === 0) return false;
    this.ids = ids;
    this.before = ids.map((i) => [...mesh.points[i]!] as Vec3);
    this.offset = [0, 0, 0];
    return true;
  }

  move(offset: Vec3): void {
    this.offset = offset;
    const { mesh } = this.state;
    this.ids.forEach((id, i) => {
      const p = this.before[i]!;
      mesh.points[id] = [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
    });
    this.state.changed();
  }

  end(): void {
    const [x, y, z] = this.offset;
    if (this.ids.length > 0 && (x !== 0 || y !== 0 || z !== 0)) {
      const { mesh } = this.state;
      const after = this.ids.map((i) => [...mesh.points[i]!] as Vec3);
      this.state.record(new MovePointsCommand(mesh, this.ids, this.before, after));
    }
    this.ids = [];
    this.before = [];
    this.offset = [0, 0, 0];
  }
}
