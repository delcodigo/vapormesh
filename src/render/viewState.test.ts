import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, normalizeView, relevantView, VIEW_LIMITS } from './viewState';

describe('normalizeView', () => {
  it('uses the defaults for an empty view', () => {
    expect(normalizeView({})).toEqual(DEFAULT_VIEW);
  });

  it('keeps valid values, including an unbounded azimuth', () => {
    const v = normalizeView({ target: [1, -2, 3], orthoSize: 10, radius: 20, theta: 12.5, phi: 1.2 });
    expect(v).toEqual({ target: [1, -2, 3], orthoSize: 10, radius: 20, theta: 12.5, phi: 1.2 });
  });

  it('clamps zoom and polar angle to the limits the mouse controls use', () => {
    const v = normalizeView({ orthoSize: 1e12, radius: 0, phi: 99 });
    expect(v.orthoSize).toBe(VIEW_LIMITS.orthoSize[1]);
    expect(v.radius).toBe(VIEW_LIMITS.radius[0]);
    expect(v.phi).toBe(VIEW_LIMITS.phi[1]);
  });

  it('replaces NaN, Infinity and wrong types field by field', () => {
    const v = normalizeView({ target: [NaN, 5, Infinity], orthoSize: NaN, theta: '3' as never });
    expect(v.target).toEqual([0, 5, 0]);
    expect(v.orthoSize).toBe(DEFAULT_VIEW.orthoSize);
    expect(v.theta).toBe(DEFAULT_VIEW.theta);
  });
});

describe('relevantView', () => {
  it('saves orbit for the perspective view and zoom for orthographic ones, without sharing the target array', () => {
    const full = normalizeView({ target: [1, 2, 3], orthoSize: 8 });
    const p = relevantView('perspective', full);
    const t = relevantView('top', full);
    expect(Object.keys(p).sort()).toEqual(['phi', 'radius', 'target', 'theta']);
    expect(Object.keys(t).sort()).toEqual(['orthoSize', 'target']);
    expect(t.target).toEqual([1, 2, 3]);
    expect(t.target).not.toBe(full.target);
  });
});
