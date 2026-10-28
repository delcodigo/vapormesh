import type { Mesh, Surface } from '@/core';
import type { EditResult } from './edit';
import type { Command } from './history';
import type { ModelerState } from './state';

export function cloneSurface(s: Surface): Surface {
  return { ...s };
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

/** The longest a surface name may be: it ends up in .obj/.mtl files and in lists, where a paragraph is no use. */
export const MAX_SURFACE_NAME = 64;

/** Change a surface's name. Undo puts the old one back. */
export class RenameSurfaceCommand implements Command {
  readonly label = 'Rename Surface';

  constructor(
    private mesh: Mesh,
    private index: number,
    private before: string,
    private after: string,
  ) {}

  redo(): void {
    this.mesh.surfaces[this.index]!.name = this.after;
  }

  undo(): void {
    this.mesh.surfaces[this.index]!.name = this.before;
  }
}

/**
 * Rename a surface of the active layer, as one undo step. The name is trimmed; it must not be empty, longer than
 * MAX_SURFACE_NAME, contain control characters, or match another surface of the layer (ignoring case, since names become
 * material names in other tools and two that differ only in case are asking for trouble). Renaming to the same name does nothing.
 */
export function renameSurface(state: ModelerState, index: number, name: string): EditResult {
  const surfaces = state.mesh.surfaces;
  const surface = surfaces[index];
  if (!surface) return { ok: false, message: 'There is no such surface' };
  const next = name.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return { ok: false, message: 'A name cannot contain control characters' };
  if (!next) return { ok: false, message: 'Type a name' };
  if (next.length > MAX_SURFACE_NAME) return { ok: false, message: `At most ${MAX_SURFACE_NAME} characters` };
  if (next === surface.name) return { ok: false, message: 'That is already its name' };
  const clash = surfaces.findIndex((s, i) => i !== index && s.name.toLowerCase() === next.toLowerCase());
  if (clash >= 0) return { ok: false, message: `There is already a surface called "${surfaces[clash]!.name}"` };
  state.execute(new RenameSurfaceCommand(state.mesh, index, surface.name, next));
  return { ok: true, message: `Renamed to ${next}` };
}
