import { describe, expect, it } from 'vitest';
import { box } from './primitives';
import { ModelerState } from './state';

describe('ModelerState', () => {
  it('replaces, toggles and clears selection, bumping version', () => {
    const s = new ModelerState(box());
    const v0 = s.version;
    s.applyPick(2, 'replace');
    s.applyPick(3, 'toggle');
    expect([...s.selection]).toEqual([2, 3]);
    s.applyPick(2, 'toggle');
    expect([...s.selection]).toEqual([3]);
    s.applyPick(null, 'replace');
    expect(s.selection.size).toBe(0);
    expect(s.version).toBeGreaterThan(v0);
  });

  it('keeps point and polygon selections separate per mode', () => {
    const s = new ModelerState(box());
    s.applyPick(1, 'replace');
    s.setMode('polygons');
    expect(s.selection.size).toBe(0);
    s.applyPick(4, 'replace');
    s.setMode('points');
    expect([...s.selection]).toEqual([1]);
  });
});

describe('bulk selection', () => {
  it('adds, removes and replaces with applySelection', () => {
    const s = new ModelerState(box());
    s.applySelection([0, 1, 2], 'replace');
    s.applySelection([3], 'add');
    s.applySelection([1, 2], 'remove');
    expect([...s.selection].sort()).toEqual([0, 3]);
    s.applySelection([5], 'replace');
    expect([...s.selection]).toEqual([5]);
  });

  it('selects all and inverts within the current mode', () => {
    const s = new ModelerState(box());
    s.selectAll();
    expect(s.selection.size).toBe(8);
    s.applySelection([0, 1], 'replace');
    s.invertSelection();
    expect([...s.selection].sort()).toEqual([2, 3, 4, 5, 6, 7]);
    s.setMode('polygons');
    s.selectAll();
    expect(s.selection.size).toBe(6);
    expect(s.selectedPoints.size).toBe(6); // untouched by the polygon-mode operations
  });
});
