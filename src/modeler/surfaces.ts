import type { Mesh, Surface } from '@/core';
import type { Command } from './history';

export function cloneSurface(s: Surface): Surface {
  return { ...s, color: [...s.color] };
}

/** Replace a surface's settings. Panels preview edits live, then `record` this once the edit is committed. */
export class EditSurfaceCommand implements Command {
  readonly label = 'Edit Surface';

  private before: Surface;
  private after: Surface;

  constructor(
    private mesh: Mesh,
    private index: number,
    before: Surface,
    after: Surface,
  ) {
    // Own copies: callers keep editing theirs live.
    this.before = cloneSurface(before);
    this.after = cloneSurface(after);
  }

  redo(): void {
    this.mesh.surfaces[this.index] = cloneSurface(this.after);
  }

  undo(): void {
    this.mesh.surfaces[this.index] = cloneSurface(this.before);
  }
}

/** Append a surface. Undo removes it again, which is safe because later commands are undone first. */
export class AddSurfaceCommand implements Command {
  readonly label = 'New Surface';
  private index = -1;

  private surface: Surface;

  constructor(
    private mesh: Mesh,
    surface: Surface,
  ) {
    this.surface = cloneSurface(surface);
  }

  redo(): void {
    this.index = this.mesh.surfaces.push(cloneSurface(this.surface)) - 1;
  }

  undo(): void {
    this.mesh.surfaces.length = this.index;
  }
}

export class AssignSurfaceCommand implements Command {
  readonly label = 'Set Surface';
  private before: number[];

  constructor(
    private mesh: Mesh,
    private polygons: number[],
    private surface: number,
  ) {
    this.before = polygons.map((p) => mesh.polygons[p]!.surface);
  }

  redo(): void {
    for (const p of this.polygons) this.mesh.polygons[p]!.surface = this.surface;
  }

  undo(): void {
    this.polygons.forEach((p, i) => (this.mesh.polygons[p]!.surface = this.before[i]!));
  }
}
