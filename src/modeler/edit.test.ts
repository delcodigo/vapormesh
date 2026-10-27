import { describe, expect, it } from 'vitest';
import { assignAutoUvs, type Mesh } from '@/core';
import {
  booleanLayers,
  copySelection,
  cutSelection,
  deleteSelection,
  extrudeSelection,
  flipSelection,
  knifeSelection,
  makePolygon,
  mirrorSelection,
  mergeCoincidentPoints,
  pasteClipboard,
  triangulateSelection,
  weldSelection,
} from './edit';
import { axisPlane } from './knife';
import { meshVolume } from './boolean';
import { box, createBox } from './primitives';
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

describe('extrudeSelection', () => {
  const topFace = (s: ModelerState) => s.mesh.polygons.findIndex((p) => p.points.every((i) => s.mesh.points[i]![1] === 0.5));
  const withTopSelected = () => {
    const s = fresh();
    s.setMode('polygons');
    s.applySelection([topFace(s)], 'replace');
    return s;
  };

  it('extrudes the selected polygon, keeps it selected, and undoes everything including the selection', () => {
    const s = withTopSelected();
    const before = snapshot(s.mesh);
    const top = topFace(s);
    const r = extrudeSelection(s, { distance: 1, inset: 0, direction: 'normal' });
    expect(r).toEqual({ ok: true, message: 'Extruded 1 polygon' });
    expect(counts(s)).toEqual([12, 10]);
    expect([...s.selectedPolygons]).toEqual([top]);
    expect(s.mesh.polygons[top]!.points.every((i) => s.mesh.points[i]![1] === 1.5)).toBe(true);
    expect(s.history.undoLabel).toBe('Extrude');

    s.undo();
    expect(snapshot(s.mesh)).toBe(before);
    expect([...s.selectedPolygons]).toEqual([top]);
    s.redo();
    expect(counts(s)).toEqual([12, 10]);
  });

  it('can be repeated on the extruded polygons, which stay selected', () => {
    const s = withTopSelected();
    extrudeSelection(s, { distance: 1, inset: 0, direction: 'normal' });
    extrudeSelection(s, { distance: 1, inset: 0, direction: 'normal' });
    expect(counts(s)).toEqual([16, 14]);
    const top = [...s.selectedPolygons][0]!;
    expect(s.mesh.polygons[top]!.points.every((i) => s.mesh.points[i]![1] === 2.5)).toBe(true);
  });

  it('works from Point mode: polygons whose points are all selected, and the new points end up selected', () => {
    const s = fresh();
    const topPoints = s.mesh.points.flatMap((p, i) => (p[1] === 0.5 ? [i] : []));
    s.applySelection(topPoints, 'replace');
    extrudeSelection(s, { distance: 0.5, inset: 0, direction: 'normal' });
    expect(s.selectedPoints.size).toBe(4);
    expect([...s.selectedPoints].every((i) => s.mesh.points[i]![1] === 1)).toBe(true);
  });

  it('a bevel is an extrude with an inset, named for what it is', () => {
    const s = withTopSelected();
    expect(extrudeSelection(s, { distance: 0.1, inset: 0.1, direction: 'normal' }, 'Bevel').message).toBe('Beveled 1 polygon');
    expect(s.history.undoLabel).toBe('Bevel');
  });

  it('gives the walls UVs sized for the surface texture', () => {
    const at = (size: number) => {
      const t = withTopSelected();
      assignAutoUvs(t.mesh); // the plain box helper has none, and walls only get UVs when their polygon has them
      t.images.push({ name: 'T', width: size, height: size, pixels: new Uint8Array(size * size) });
      t.mesh.surfaces[0]!.texture = 'T';
      extrudeSelection(t, { distance: 1, inset: 0, direction: 'normal' });
      const wall = t.mesh.polygons.at(-1)!.uvs!;
      return Math.hypot(wall[1]![0] - wall[0]![0], wall[1]![1] - wall[0]![1]);
    };
    expect(at(128)).toBeCloseTo(at(64) / 2, 9);
  });

  it('says why it cannot, and records nothing', () => {
    const s = fresh();
    expect(extrudeSelection(s, { distance: 1, inset: 0, direction: 'normal' })).toEqual({ ok: false, message: 'Select polygons to extrude' });
    expect(extrudeSelection(s, { distance: 1, inset: 0, direction: 'normal' }, 'Bevel').message).toBe('Select polygons to bevel');
    s.setMode('polygons');
    s.applySelection([0], 'replace');
    expect(extrudeSelection(s, { distance: 0, inset: 0, direction: 'normal' }).message).toBe('Set a distance or an inset');
    expect(extrudeSelection(s, { distance: NaN, inset: 0, direction: 'normal' }).message).toBe('Type a number for the distance and the inset');
    expect(s.history.canUndo).toBe(false);
  });
});

describe('mirrorSelection', () => {
  const across = (position: number, merge = true) => ({ axis: 'x' as const, position, merge });

  it('mirrors the whole layer when nothing is selected, welds the seam, selects the copies, and undoes', () => {
    const s = fresh(); // a unit box centred on the origin: its +x face lies in the plane x = 0.5
    const before = snapshot(s.mesh);
    const r = mirrorSelection(s, across(0.5));
    expect(r).toEqual({ ok: true, message: 'Mirrored 5 polygons across X = 0.5 (1 polygon in the plane not copied)' });
    expect(counts(s)).toEqual([12, 11]);
    expect([...s.selectedPolygons].sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10]);
    expect(s.history.undoLabel).toBe('Mirror');

    s.undo();
    expect(snapshot(s.mesh)).toBe(before);
    expect(s.selectedPolygons.size).toBe(0);
    s.redo();
    expect(counts(s)).toEqual([12, 11]);
  });

  it('without merge it copies everything, duplicate seam included', () => {
    const s = fresh();
    expect(mirrorSelection(s, across(0.5, false)).message).toBe('Mirrored 6 polygons across X = 0.5');
    expect(counts(s)).toEqual([16, 12]);
  });

  it('mirrors only the selected polygons', () => {
    const s = fresh();
    s.setMode('polygons');
    s.applySelection([0, 1], 'replace');
    mirrorSelection(s, across(2, false));
    expect(counts(s)).toEqual([8 + 8, 6 + 2]);
  });

  it('selects the new points in Point mode', () => {
    const s = fresh();
    mirrorSelection(s, across(0.5));
    expect(s.selectedPoints.size).toBe(4);
  });

  it('says why it cannot, and records nothing', () => {
    const s = fresh();
    expect(mirrorSelection(s, across(NaN)).message).toBe('Type a number for the position');
    expect(mirrorSelection(new ModelerState(), across(0)).message).toBe('There is nothing to mirror');
    const flat = new ModelerState();
    flat.mesh.addPoint([0, 0, 0]);
    flat.mesh.addPoint([0, 1, 0]);
    flat.mesh.addPoint([0, 1, 1]);
    flat.mesh.addPolygon([0, 1, 2]);
    expect(mirrorSelection(flat, across(0)).message).toBe('Everything lies in the mirror plane, so there is nothing to copy');
    expect(s.history.canUndo).toBe(false);
    expect(flat.history.canUndo).toBe(false);
  });
});

describe('knifeSelection', () => {
  const keep = { separate: false };

  it('cuts every polygon when none are selected, selects the points on the cut, and undoes', () => {
    const s = fresh();
    const before = snapshot(s.mesh);
    const r = knifeSelection(s, axisPlane('x', 0), keep);
    expect(r).toEqual({ ok: true, message: 'Cut 4 polygons' });
    expect(counts(s)).toEqual([12, 10]);
    expect(s.selectedPoints.size).toBe(4);
    expect([...s.selectedPoints].every((i) => s.mesh.points[i]![0] === 0)).toBe(true);
    expect(s.history.undoLabel).toBe('Knife');

    s.undo();
    expect(snapshot(s.mesh)).toBe(before);
    expect(s.selectedPoints.size).toBe(0);
    s.redo();
    expect(counts(s)).toEqual([12, 10]);
  });

  it('cuts only the selected polygons and tells you about the neighbours it had to touch', () => {
    const s = fresh();
    s.setMode('polygons');
    const top = s.mesh.polygons.findIndex((p) => p.points.every((i) => s.mesh.points[i]![1] === 0.5));
    s.applySelection([top], 'replace');
    const r = knifeSelection(s, axisPlane('x', 0), keep);
    expect(r.message).toBe('Cut 1 polygon (2 neighbours got an extra point)');
    expect(counts(s)).toEqual([10, 7]);
  });

  it('keeps both halves of a selected polygon selected', () => {
    const s = fresh();
    s.setMode('polygons');
    const top = s.mesh.polygons.findIndex((p) => p.points.every((i) => s.mesh.points[i]![1] === 0.5));
    s.applySelection([top], 'replace');
    knifeSelection(s, axisPlane('x', 0), keep);
    expect([...s.selectedPolygons].sort((a, b) => a - b)).toEqual([top, 6]);
  });

  it('mentions when the sides are separated', () => {
    const s = fresh();
    expect(knifeSelection(s, axisPlane('x', 0), { separate: true }).message).toBe('Cut 4 polygons, sides separated');
    expect(s.mesh.points).toHaveLength(8 + 4 + 4);
  });

  it('says why it cannot, and records nothing', () => {
    const s = fresh();
    expect(knifeSelection(s, axisPlane('x', 9), keep)).toEqual({ ok: false, message: 'The cut does not pass through any polygon' });
    expect(knifeSelection(s, null, keep).message).toBe('Draw a longer line to cut along');
    expect(knifeSelection(s, { normal: [NaN, 0, 0], offset: 0 }, keep).ok).toBe(false);
    expect(knifeSelection(new ModelerState(), axisPlane('x', 0), keep).message).toBe('There is nothing to cut');
    expect(s.history.canUndo).toBe(false);
  });
});

describe('booleanLayers', () => {
  const solidBox = (min: number, max: number) => createBox({ size: [max - min, 2, 2], center: [(min + max) / 2, 0, 0], segments: [1, 1, 1] });
  /** Layer 1: a box from x = -1 to 1. Layer 2: one from x = 0 to 2. Layer 3 is free. */
  function twoBoxes() {
    const s = new ModelerState();
    s.layers[0]!.append(solidBox(-1, 1));
    s.layers[1]!.append(solidBox(0, 2));
    return s;
  }
  const request = (operation: 'add' | 'subtract' | 'intersect', target = 2) => ({ object: 0, cutter: 1, target, operation });

  it('puts the result on the third layer and switches to it, leaving both originals untouched', () => {
    const s = twoBoxes();
    const originals = [snapshot(s.layers[0]!), snapshot(s.layers[1]!)];
    const r = booleanLayers(s, request('add'));
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^Added layer 1 and layer 2: \d+ polygons on layer 3$/);
    expect(s.activeLayer).toBe(2);
    expect(meshVolume(s.layers[2]!)).toBeCloseTo(12, 6);
    expect([snapshot(s.layers[0]!), snapshot(s.layers[1]!)]).toEqual(originals);
    expect(s.history.undoLabel).toBe('Boolean Add');
  });

  it('undo empties the result layer and goes back to the layer you were on; redo brings it back', () => {
    const s = twoBoxes();
    s.setActiveLayer(1);
    booleanLayers(s, request('subtract'));
    expect(s.activeLayer).toBe(2);
    s.undo();
    expect(s.layers[2]!.polygons).toHaveLength(0);
    expect(s.activeLayer).toBe(1);
    s.redo();
    expect(meshVolume(s.layers[2]!)).toBeCloseTo(4, 6);
  });

  it('subtract and intersect say what they did', () => {
    const s = twoBoxes();
    expect(booleanLayers(s, request('subtract', 2)).message).toMatch(/^Subtracted layer 2 from layer 1/);
    expect(booleanLayers(s, request('intersect', 3)).message).toMatch(/^Intersected layer 1 and layer 2/);
    expect(meshVolume(s.layers[3]!)).toBeCloseTo(4, 6);
  });

  it('adds to a layer that already has geometry instead of replacing it', () => {
    const s = twoBoxes();
    s.layers[2]!.append(solidBox(10, 12));
    const before = s.layers[2]!.polygons.length;
    booleanLayers(s, request('intersect'));
    expect(s.layers[2]!.polygons.length).toBeGreaterThan(before);
    s.undo();
    expect(s.layers[2]!.polygons).toHaveLength(before);
  });

  it('explains what is wrong with the layers, in terms of layers', () => {
    const s = twoBoxes();
    expect(booleanLayers(s, { ...request('add'), cutter: 0 }).message).toBe('Pick two different layers: one for the object and one for the cutter');
    expect(booleanLayers(s, request('add', 1)).message).toBe('Put the result on a third layer, so the originals are kept');
    expect(booleanLayers(s, { ...request('add'), cutter: 5 }).message).toBe('Layer 6 has no polygons');
    expect(booleanLayers(s, { ...request('add'), object: 12 }).message).toBe('Pick layers between 1 and 10');
    expect(booleanLayers(s, { ...request('add'), target: -1 }).ok).toBe(false);
    expect(s.history.canUndo).toBe(false);
  });

  it('refuses a layer that is not a closed solid, and names it', () => {
    const s = twoBoxes();
    s.layers[1]!.polygons.splice(0, 1);
    expect(booleanLayers(s, request('add')).message).toBe('Layer 2 is not a closed solid: 4 edges are open. Merge Points may close it.');
    expect(s.history.canUndo).toBe(false);
  });

  it('reports an empty result instead of adding nothing', () => {
    const s = new ModelerState();
    s.layers[0]!.append(solidBox(-1, 1));
    s.layers[1]!.append(solidBox(5, 7));
    expect(booleanLayers(s, request('intersect')).message).toBe('The result is empty: the two solids do not overlap');
    expect(s.layers[2]!.polygons).toHaveLength(0);
  });
});
