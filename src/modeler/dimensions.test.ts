import { describe, expect, it } from 'vitest';
import { box } from './primitives';
import { measure, setDimension } from './dimensions';
import { ModelerState } from './state';

const size = (s: ModelerState) => measure(s)!.size;

describe('measure', () => {
  it('is the box round the whole layer when nothing is selected, with its counts', () => {
    const m = measure(new ModelerState(box(2, 4, 6)))!;
    expect(m).toMatchObject({ ofSelection: false, points: 8, polygons: 6, size: [2, 4, 6] });
  });

  it('is the box round the selection when there is one', () => {
    const s = new ModelerState(box(2, 4, 6));
    s.setMode('polygons');
    s.applyPick(s.mesh.polygons.findIndex((p) => p.points.every((i) => s.mesh.points[i]![1] === 2)), 'replace');
    expect(measure(s)).toMatchObject({ ofSelection: true, points: 4, polygons: 1, size: [2, 0, 6] });
  });
});

describe('setDimension', () => {
  it('scales one axis about the centre and leaves the others, as one undo step', () => {
    const s = new ModelerState(box(2, 4, 6));
    expect(setDimension(s, 1, 8).ok).toBe(true);
    expect(size(s)).toEqual([2, 8, 6]);
    expect(measure(s)!.min).toEqual([-1, -4, -3]);
    s.undo();
    expect(size(s)).toEqual([2, 4, 6]);
  });

  it('scales every axis by the same factor when proportions are kept', () => {
    const s = new ModelerState(box(2, 4, 6));
    setDimension(s, 0, 1, true);
    expect(size(s)).toEqual([1, 2, 3]);
  });

  it('only scales the selection', () => {
    const s = new ModelerState(box(2, 2, 2));
    s.setMode('polygons');
    s.applyPick(s.mesh.polygons.findIndex((p) => p.points.every((i) => s.mesh.points[i]![1] === 1)), 'replace');
    setDimension(s, 0, 4);
    expect(s.mesh.points.filter((p) => p[1] === -1).every((p) => Math.abs(p[0]) === 1)).toBe(true);
    expect(s.mesh.points.filter((p) => p[1] === 1).every((p) => Math.abs(p[0]) === 2)).toBe(true);
  });

  it('refuses zero, negative, non-numbers, flat axes and no-ops, recording nothing', () => {
    const s = new ModelerState(box(2, 4, 6));
    for (const v of [0, -1, NaN]) expect(setDimension(s, 0, v).ok).toBe(false);
    expect(setDimension(s, 0, 2).ok).toBe(false);
    expect(s.history.canUndo).toBe(false);
    s.setMode('polygons');
    s.applyPick(s.mesh.polygons.findIndex((p) => p.points.every((i) => s.mesh.points[i]![1] === 2)), 'replace');
    expect(setDimension(s, 1, 3).message).toContain('flat');
  });
});
