import { describe, expect, it } from 'vitest';
import { AddSurfaceCommand, AssignSurfaceCommand, cloneSurface, EditSurfaceCommand, MAX_SURFACE_NAME, renameSurface } from './surfaces';
import { box } from './primitives';
import { ModelerState } from './state';

describe('surface commands', () => {
  it('edits a surface and undoes it without sharing references', () => {
    const s = new ModelerState(box());
    const before = cloneSurface(s.mesh.surfaces[0]!);
    const after = { ...cloneSurface(before), colorIndex: 25, smoothing: true };
    s.mesh.surfaces[0] = after; // live preview already applied
    s.record(new EditSurfaceCommand(s.mesh, 0, before, after));
    after.colorIndex = 99; // the panel keeps editing its copy: history must not see it
    s.undo();
    expect(s.mesh.surfaces[0]).toEqual(before);
    s.redo();
    expect(s.mesh.surfaces[0]!.colorIndex).toBe(25);
    expect(s.mesh.surfaces[0]!.smoothing).toBe(true);
  });

  it('adds a surface, assigns polygons to it, and undoes both in order', () => {
    const s = new ModelerState(box());
    const glass = { ...cloneSurface(s.mesh.surfaces[0]!), name: 'Glass' };
    s.execute(new AddSurfaceCommand(s.mesh, glass));
    s.execute(new AssignSurfaceCommand(s.mesh, [0, 3], 1));
    expect(s.mesh.polygons.map((p) => p.surface)).toEqual([1, 0, 0, 1, 0, 0]);
    s.undo();
    expect(s.mesh.polygons.every((p) => p.surface === 0)).toBe(true);
    s.undo();
    expect(s.mesh.surfaces).toHaveLength(1);
    s.redo();
    s.redo();
    expect(s.mesh.surfaces.map((x) => x.name)).toEqual(['Default', 'Glass']);
    expect(s.mesh.polygons[3]!.surface).toBe(1);
  });

  it('resolves polygons to assign from either selection mode', () => {
    const s = new ModelerState(box());
    s.applySelection([0, 1, 2, 3], 'replace'); // box points 0-3 are the whole -x face
    expect(s.selectedPolygonIds()).toEqual([0]);
    s.setMode('polygons');
    s.applySelection([4, 5], 'replace');
    expect(s.selectedPolygonIds()).toEqual([4, 5]);
  });
});

describe('renameSurface', () => {
  const setup = () => {
    const s = new ModelerState(box(1, 1, 1));
    s.mesh.surfaces.push({ ...s.mesh.surfaces[0]!, name: 'Glass' });
    return s;
  };

  it('renames the surface as one undo step, keeping its other settings and the polygons that use it', () => {
    const s = setup();
    s.mesh.surfaces[0]!.colorIndex = 77;
    expect(renameSurface(s, 0, 'Marble')).toEqual({ ok: true, message: 'Renamed to Marble' });
    expect(s.mesh.surfaces[0]).toMatchObject({ name: 'Marble', colorIndex: 77 });
    expect(s.history.undoLabel).toBe('Rename Surface');
    expect(s.mesh.polygons.every((p) => p.surface === 0)).toBe(true);
    s.undo();
    expect(s.mesh.surfaces[0]!.name).toBe('Default');
    expect(s.history.canUndo).toBe(false);
    s.redo();
    expect(s.mesh.surfaces[0]!.name).toBe('Marble');
  });

  it('trims the name, and does nothing for the name it already has', () => {
    const s = setup();
    expect(renameSurface(s, 1, '  Lens  ').message).toBe('Renamed to Lens');
    expect(s.mesh.surfaces[1]!.name).toBe('Lens');
    expect(renameSurface(s, 1, 'Lens ')).toEqual({ ok: false, message: 'That is already its name' });
    expect(s.history.canUndo).toBe(true);
    s.undo();
    expect(s.history.canUndo).toBe(false);
  });

  it('keeps edits and renames in step through undo and redo', () => {
    const s = setup();
    const before = { ...s.mesh.surfaces[1]! };
    s.execute(new EditSurfaceCommand(s.mesh, 1, before, { ...before, colorIndex: 9 }));
    renameSurface(s, 1, 'Lens');
    s.undo();
    expect(s.mesh.surfaces[1]).toMatchObject({ name: 'Glass', colorIndex: 9 });
    s.undo();
    expect(s.mesh.surfaces[1]).toMatchObject({ name: 'Glass', colorIndex: before.colorIndex });
    s.redo();
    s.redo();
    expect(s.mesh.surfaces[1]).toMatchObject({ name: 'Lens', colorIndex: 9 });
  });

  it.each([
    ['empty', '', 'Type a name'],
    ['only spaces', '   ', 'Type a name'],
    ['a name that is already taken', 'Glass', 'already a surface called "Glass"'],
    ['a taken name in other case', 'GLASS', 'already a surface called "Glass"'],
    ['control characters', 'a\nb', 'control characters'],
    ['a tab', 'a\tb', 'control characters'],
    ['too long', 'x'.repeat(MAX_SURFACE_NAME + 1), `At most ${MAX_SURFACE_NAME}`],
  ])('refuses %s, leaving the surface alone', (_what, name, text) => {
    const s = setup();
    const r = renameSurface(s, 0, name);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(text);
    expect(s.mesh.surfaces[0]!.name).toBe('Default');
    expect(s.history.canUndo).toBe(false);
  });

  it('allows the longest name, other scripts and symbols, and a surface may take a name only its own case differed in', () => {
    const s = setup();
    expect(renameSurface(s, 0, 'x'.repeat(MAX_SURFACE_NAME)).ok).toBe(true);
    expect(renameSurface(s, 0, 'Mármol 大理石 #1').ok).toBe(true);
    expect(renameSurface(s, 1, 'glass').ok).toBe(true); // its own name in a different case is not a clash
  });

  it('refuses a surface that does not exist', () => {
    const s = setup();
    expect(renameSurface(s, 5, 'X')).toEqual({ ok: false, message: 'There is no such surface' });
    expect(renameSurface(s, -1, 'X').ok).toBe(false);
  });
});
