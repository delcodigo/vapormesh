import { describe, expect, it } from 'vitest';
import { AddSurfaceCommand, AssignSurfaceCommand, cloneSurface, EditSurfaceCommand } from './surfaces';
import { box } from './primitives';
import { ModelerState } from './state';

describe('surface commands', () => {
  it('edits a surface and undoes it without sharing references', () => {
    const s = new ModelerState(box());
    const before = cloneSurface(s.mesh.surfaces[0]!);
    const after = { ...cloneSurface(before), color: [1, 0, 0] as [number, number, number], smoothing: true };
    s.mesh.surfaces[0] = after; // live preview already applied
    s.record(new EditSurfaceCommand(s.mesh, 0, before, after));
    after.color[0] = 0.5; // the panel keeps editing its copy: history must not see it
    s.undo();
    expect(s.mesh.surfaces[0]).toEqual(before);
    s.redo();
    expect(s.mesh.surfaces[0]!.color).toEqual([1, 0, 0]);
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
