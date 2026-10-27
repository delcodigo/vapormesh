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
