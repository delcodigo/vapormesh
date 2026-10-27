import { describe, expect, it } from 'vitest';
import { box } from './primitives';
import { selectionPosition, setSelectionPosition } from './position';
import { ModelerState } from './state';

const corner = (s: ModelerState) => s.mesh.points.findIndex((p) => p[0] > 0 && p[1] > 0 && p[2] > 0);

describe('selectionPosition', () => {
  it('is null with nothing selected, whatever the mode', () => {
    const s = new ModelerState(box(2, 2, 2));
    expect(selectionPosition(s)).toBeNull();
    s.setMode('polygons');
    expect(selectionPosition(s)).toBeNull();
  });

  it('is the point itself for one point', () => {
    const s = new ModelerState(box(2, 4, 6));
    s.applyPick(corner(s), 'replace');
    expect(selectionPosition(s)).toEqual({ points: 1, position: [1, 2, 3], size: [0, 0, 0] });
  });

  it('is the centre and size of the box round several points, and of the points of selected polygons', () => {
    const s = new ModelerState(box(2, 4, 6));
    s.applySelection(s.mesh.points.map((_, i) => i), 'replace');
    expect(selectionPosition(s)).toEqual({ points: 8, position: [0, 0, 0], size: [2, 4, 6] });
    s.clearSelection();
    s.setMode('polygons');
    const top = s.mesh.polygons.findIndex((p) => p.points.every((i) => s.mesh.points[i]![1] === 2));
    s.applyPick(top, 'replace');
    expect(selectionPosition(s)).toEqual({ points: 4, position: [0, 2, 0], size: [2, 0, 6] });
  });
});

describe('setSelectionPosition', () => {
  it('puts one point exactly at the typed value on that axis only, as one undo step', () => {
    const s = new ModelerState(box(2, 2, 2));
    const id = corner(s);
    const others = s.mesh.points.map((p) => [...p]);
    s.applyPick(id, 'replace');
    expect(setSelectionPosition(s, 1, 0.3)).toEqual({ ok: true, message: 'Moved 1 point' });
    expect(s.mesh.points[id]).toEqual([1, 0.3, 1]);
    s.mesh.points.forEach((p, i) => i !== id && expect(p).toEqual(others[i]));
    s.undo();
    expect(s.mesh.points[id]).toEqual([1, 1, 1]);
    expect(s.history.canUndo).toBe(false);
    s.redo();
    expect(s.mesh.points[id]![1]).toBe(0.3);
  });

  it('moves several points together until the centre of their box is at the value', () => {
    const s = new ModelerState(box(2, 2, 2));
    const before = s.mesh.points.map((p) => [...p]);
    s.applySelection(s.mesh.points.map((_, i) => i), 'replace');
    expect(setSelectionPosition(s, 0, 5).ok).toBe(true);
    s.mesh.points.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(before[i]![0]! + 5, 12);
      expect(p[1]).toBe(before[i]![1]); // other axes untouched
    });
    expect(selectionPosition(s)!.position[0]).toBeCloseTo(5, 12);
  });

  it('moves only the selection, never the whole object, and refuses with nothing selected', () => {
    const s = new ModelerState(box());
    expect(setSelectionPosition(s, 0, 3)).toEqual({ ok: false, message: 'Select points to position' });
    expect(s.history.canUndo).toBe(false);
  });

  it('refuses a value that is not a number, and says nothing happened when it is already there', () => {
    const s = new ModelerState(box(2, 2, 2));
    s.applyPick(corner(s), 'replace');
    expect(setSelectionPosition(s, 0, NaN).ok).toBe(false);
    expect(setSelectionPosition(s, 0, Infinity).ok).toBe(false);
    expect(setSelectionPosition(s, 0, 1)).toEqual({ ok: false, message: 'That is where it already is' });
    expect(s.history.canUndo).toBe(false);
  });
});
