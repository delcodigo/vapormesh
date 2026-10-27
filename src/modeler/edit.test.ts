import { describe, expect, it } from 'vitest';
import type { Mesh } from '@/core';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  flipSelection,
  makePolygon,
  mergeCoincidentPoints,
  pasteClipboard,
  triangulateSelection,
  weldSelection,
} from './edit';
import { box } from './primitives';
import { ModelerState } from './state';

const snapshot = (m: Mesh) => JSON.stringify({ points: m.points, polygons: m.polygons });
const fresh = () => new ModelerState(box());
const counts = (s: ModelerState) => [s.mesh.points.length, s.mesh.polygons.length];

describe('deleteSelection', () => {
  it('deletes selected points together with the polygons that used them, and undo restores geometry and selection', () => {
    const s = fresh();
    const before = snapshot(s.mesh);
    s.applySelection([0, 5], 'replace');
    const r = deleteSelection(s);
    expect(r.ok).toBe(true);
    expect(r.message).toBe('Deleted 5 polygons and 2 points');
    expect(counts(s)).toEqual([6, 1]);
    expect(s.selection.size).toBe(0);

    s.undo();
    expect(snapshot(s.mesh)).toBe(before);
    expect([...s.selectedPoints]).toEqual([0, 5]);
    s.redo();
    expect(counts(s)).toEqual([6, 1]);
    expect(s.selection.size).toBe(0);
  });

  it('deletes selected polygons in Polygon mode', () => {
    const s = fresh();
    s.setMode('polygons');
    s.applySelection([0, 1], 'replace');
    expect(deleteSelection(s).message).toBe('Deleted 2 polygons and 0 points');
    expect(counts(s)).toEqual([8, 4]);
  });

  it('refuses with nothing selected, and records nothing', () => {
    const s = fresh();
    const r = deleteSelection(s);
    expect(r).toEqual({ ok: false, message: 'Select points to delete' });
    s.setMode('polygons');
    expect(deleteSelection(s).message).toBe('Select polygons to delete');
    expect(s.history.canUndo).toBe(false);
  });

  it('is one undo step, named Delete', () => {
    const s = fresh();
    s.applySelection([0], 'replace');
    deleteSelection(s);
    expect(s.history.undoLabel).toBe('Delete');
    s.undo();
    expect(s.history.canUndo).toBe(false);
  });
});

describe('merge and weld', () => {
  const twoBoxes = () => {
    const s = fresh();
    s.mesh.append(box());
    return s;
  };

  it('merges coincident points of the whole layer when nothing is selected', () => {
    const s = twoBoxes();
    expect(counts(s)).toEqual([16, 12]);
    const r = mergeCoincidentPoints(s);
    expect(r.message).toBe('Merged 8 points');
    expect(counts(s)).toEqual([8, 12]);
    s.undo();
    expect(counts(s)).toEqual([16, 12]);
  });

  it('merges only the selected points when some are selected', () => {
    const s = twoBoxes();
    s.applySelection([0, 8], 'replace'); // point 0 and its twin
    mergeCoincidentPoints(s);
    expect(counts(s)).toEqual([15, 12]);
  });

  it('says so when there is nothing to merge', () => {
    expect(mergeCoincidentPoints(fresh())).toEqual({ ok: false, message: 'No points are close enough to merge' });
  });

  it('welds selected points into one at their average, and selects it', () => {
    const s = fresh();
    s.applySelection([0, 1], 'replace'); // (-.5,-.5,-.5) and (-.5,-.5,.5)
    const r = weldSelection(s);
    expect(r.message).toBe('Welded 2 points into one');
    expect(s.mesh.points).toHaveLength(7);
    expect(s.mesh.points[0]).toEqual([-0.5, -0.5, 0]);
    expect([...s.selectedPoints]).toEqual([0]);
    expect(s.mesh.polygons.every((p) => p.points.every((i) => i < 7))).toBe(true);
  });

  it('keeps the welded point at the number of the lowest selected point', () => {
    const s = fresh();
    s.applySelection([5, 3], 'replace'); // (0.5, -0.5, 0.5) and (-0.5, 0.5, 0.5): the average is (0, 0, 0.5)
    weldSelection(s);
    expect(s.mesh.points).toHaveLength(7);
    expect([...s.selectedPoints]).toEqual([3]);
    expect(s.mesh.points[3]).toEqual([0, 0, 0.5]);
    s.undo();
    expect([...s.selectedPoints].sort()).toEqual([3, 5]);
  });

  it('needs two points to weld', () => {
    const s = fresh();
    expect(weldSelection(s).ok).toBe(false);
    s.applySelection([0], 'replace');
    expect(weldSelection(s).message).toBe('Select at least two points to weld');
  });
});

describe('flipSelection', () => {
  it('flips the selected polygons, or all of them if none are selected', () => {
    const s = fresh();
    const first = [...s.mesh.polygons[0]!.points];
    s.setMode('polygons');
    s.applySelection([0], 'replace');
    expect(flipSelection(s).message).toBe('Flipped 1 polygon');
    expect(s.mesh.polygons[0]!.points).toEqual([...first].reverse());
    expect(s.mesh.polygons[1]!.points).toEqual(box().polygons[1]!.points);
    expect([...s.selectedPolygons]).toEqual([0]); // still selected

    s.clearSelection();
    expect(flipSelection(s).message).toBe('Flipped 6 polygons');
  });

  it('undoes', () => {
    const s = fresh();
    const before = snapshot(s.mesh);
    flipSelection(s);
    s.undo();
    expect(snapshot(s.mesh)).toBe(before);
  });
});

describe('makePolygon', () => {
  it('joins the selected points in the order they were selected, with UVs, and selects the new polygon', () => {
    const s = fresh();
    s.applySelection([5, 0, 3], 'replace');
    const r = makePolygon(s);
    expect(r.message).toBe('Made a polygon from 3 points');
    const made = s.mesh.polygons.at(-1)!;
    expect(made.points).toEqual([5, 0, 3]);
    expect(made.uvs).toHaveLength(3);
    expect(made.surface).toBe(0);
    expect([...s.selectedPolygons]).toEqual([6]);
    expect([...s.selectedPoints]).toEqual([5, 0, 3]);
  });

  it('needs three points, and undoes', () => {
    const s = fresh();
    s.applySelection([0, 1], 'replace');
    expect(makePolygon(s)).toEqual({ ok: false, message: 'Select at least three points, in order, to make a polygon' });
    s.applySelection([2], 'add');
    makePolygon(s);
    s.undo();
    expect(s.mesh.polygons).toHaveLength(6);
    expect([...s.selectedPoints]).toEqual([0, 1, 2]);
  });

  it('keeps the order of a Shift-click sequence, not the order of the point numbers', () => {
    const s = fresh();
    for (const id of [7, 2, 4]) s.applyPick(id, 'toggle');
    makePolygon(s);
    expect(s.mesh.polygons.at(-1)!.points).toEqual([7, 2, 4]);
  });
});

describe('triangulateSelection', () => {
  it('splits all quads, selects the triangles, and undoes', () => {
    const s = fresh();
    const r = triangulateSelection(s);
    expect(r.message).toBe('Split 6 polygons into triangles');
    expect(s.mesh.polygons).toHaveLength(12);
    expect(s.mesh.polygons.every((p) => p.points.length === 3)).toBe(true);
    expect(s.selectedPolygons.size).toBe(12);
    expect(triangulateSelection(s)).toEqual({ ok: false, message: 'Every polygon is already a triangle' });
    s.undo();
    expect(s.mesh.polygons).toHaveLength(6);
    expect(s.selectedPolygons.size).toBe(0);
  });

  it('only splits the selected polygons', () => {
    const s = fresh();
    s.setMode('polygons');
    s.applySelection([2], 'replace');
    triangulateSelection(s);
    expect(s.mesh.polygons).toHaveLength(7);
    expect([...s.selectedPolygons].sort()).toEqual([2, 3]);
  });
});

describe('clipboard', () => {
  it('copies, pastes in place into the same layer, and selects the pasted polygons', () => {
    const s = fresh();
    s.setMode('polygons');
    s.applySelection([0], 'replace');
    expect(copySelection(s).message).toBe('Copied 1 polygon');
    expect(counts(s)).toEqual([8, 6]); // copy changes nothing
    expect(s.history.canUndo).toBe(false);

    expect(pasteClipboard(s).message).toBe('Pasted 1 polygon');
    expect(counts(s)).toEqual([12, 7]);
    expect([...s.selectedPolygons]).toEqual([6]);
    s.undo();
    expect(counts(s)).toEqual([8, 6]);
    s.redo();
    expect(counts(s)).toEqual([12, 7]);
  });

  it('selects the pasted points in Point mode', () => {
    const s = fresh();
    s.applySelection([0, 1, 2, 3], 'replace'); // the whole -x face
    copySelection(s);
    pasteClipboard(s);
    expect([...s.selectedPoints]).toEqual([8, 9, 10, 11]);
  });

  it('pastes into another layer', () => {
    const s = fresh();
    s.setMode('polygons');
    s.applySelection([0, 1], 'replace');
    copySelection(s);
    s.setActiveLayer(2);
    expect(s.mesh.polygons).toHaveLength(0);
    pasteClipboard(s);
    expect(s.mesh.polygons).toHaveLength(2);
    expect(s.layers[0]!.polygons).toHaveLength(6);
  });

  it('cut removes the polygons and keeps them on the clipboard; undo brings the geometry back', () => {
    const s = fresh();
    const before = snapshot(s.mesh);
    s.setMode('polygons');
    s.applySelection([0, 1], 'replace');
    expect(cutSelection(s).message).toBe('Cut 2 polygons');
    expect(s.mesh.polygons).toHaveLength(4);
    expect(s.clipboard!.polygons).toHaveLength(2);
    expect(s.history.undoLabel).toBe('Cut');
    s.undo();
    expect(snapshot(s.mesh)).toBe(before);
    expect(s.clipboard!.polygons).toHaveLength(2); // the clipboard is not part of the undo history
  });

  it('cuts polygons chosen through their points', () => {
    const s = fresh();
    s.applySelection([0, 1, 2, 3], 'replace');
    cutSelection(s);
    expect(s.mesh.polygons).toHaveLength(5);
  });

  it('copying later replaces the clipboard, and an empty clipboard cannot be pasted', () => {
    const s = fresh();
    expect(pasteClipboard(s)).toEqual({ ok: false, message: 'The clipboard is empty' });
    expect(copySelection(s)).toEqual({ ok: false, message: 'Select polygons to copy' });
    s.setMode('polygons');
    s.applySelection([0], 'replace');
    copySelection(s);
    s.applySelection([1, 2], 'replace');
    copySelection(s);
    expect(s.clipboard!.polygons).toHaveLength(2);
  });

  it('keeps pasted surfaces and UVs', () => {
    const s = fresh();
    s.mesh.polygons[0]!.uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    s.mesh.surfaces.push({ ...s.mesh.surfaces[0]!, name: 'Glass' });
    s.mesh.polygons[0]!.surface = 1;
    s.setMode('polygons');
    s.applySelection([0], 'replace');
    copySelection(s);
    pasteClipboard(s);
    const pasted = s.mesh.polygons.at(-1)!;
    expect(s.mesh.surfaces[pasted.surface]!.name).toBe('Glass');
    expect(pasted.uvs).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
  });
});

describe('history interplay', () => {
  it('undoing through several structural edits returns every step exactly', () => {
    const s = fresh();
    const states = [snapshot(s.mesh)];
    s.applySelection([0], 'replace');
    deleteSelection(s);
    states.push(snapshot(s.mesh));
    flipSelection(s);
    states.push(snapshot(s.mesh));
    triangulateSelection(s);
    states.push(snapshot(s.mesh));
    for (let i = states.length - 1; i > 0; i--) {
      expect(snapshot(s.mesh)).toBe(states[i]);
      s.undo();
    }
    expect(snapshot(s.mesh)).toBe(states[0]);
    for (let i = 1; i < states.length; i++) {
      s.redo();
      expect(snapshot(s.mesh)).toBe(states[i]);
    }
  });

  it('a later move does not corrupt the stored snapshots', () => {
    const s = fresh();
    s.applySelection([0], 'replace');
    deleteSelection(s);
    s.mesh.points[0] = [99, 99, 99]; // something edits the live points afterwards (like a drag does)
    s.mesh.points = s.mesh.points.map((p) => [...p] as [number, number, number]);
    s.undo(); // undoing the delete, while the "later edit" was never recorded
    s.redo();
    expect(s.mesh.points[0]).toEqual(box().points[1]); // redo rebuilt from the snapshot, not from the mutated array
  });
});
