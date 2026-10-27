import { describe, expect, it } from 'vitest';
import { boundsOf, DEFAULT_VIEW, fitView, FRAME_MARGIN, normalizeView, relevantView, VIEW_LIMITS } from './viewState';

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

describe('boundsOf', () => {
  it('is the box round the points, skipping any that are not finite', () => {
    expect(boundsOf([[1, 2, 3], [-1, 5, 0], [NaN, 100, 0], [0, 0, Infinity]])).toEqual({ min: [-1, 2, 0], max: [1, 5, 3] });
  });

  it('is null for no points', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([[NaN, 0, 0]])).toBeNull();
  });
});

describe('fitView', () => {
  const box = { min: [-1, 0, -2] as [number, number, number], max: [3, 6, 2] as [number, number, number] }; // 4 wide, 6 tall, 4 deep, centre (1, 3, 0)
  const wide = 2;

  it('centres every view on the middle of the box', () => {
    for (const kind of ['top', 'face', 'left', 'perspective'] as const) {
      expect(fitView(kind, box, wide, 50, DEFAULT_VIEW).target).toEqual([1, 3, 0]);
    }
  });

  it('zooms an orthographic view to the box height when that is the tighter fit', () => {
    // the front view shows X across and Y up: 4 wide needs 2 units of height at aspect 2, 6 tall needs 6
    expect(fitView('face', box, wide, 50, DEFAULT_VIEW).orthoSize).toBeCloseTo(6 * FRAME_MARGIN, 12);
  });

  it('zooms to the box width when the view is narrow', () => {
    // at aspect 0.5 the 4 units of width need 8 units of height, more than the 6 of the model
    expect(fitView('face', box, 0.5, 50, DEFAULT_VIEW).orthoSize).toBeCloseTo(8 * FRAME_MARGIN, 12);
  });

  it('uses the axes each view really shows: the top view is X across and Z up the screen, the left view Z across and Y up', () => {
    const flat = { min: [0, 0, 0] as [number, number, number], max: [10, 1, 2] as [number, number, number] };
    expect(fitView('top', flat, 1, 50, DEFAULT_VIEW).orthoSize).toBeCloseTo(10 * FRAME_MARGIN, 12); // width 10 (X) over height 2 (Z)
    expect(fitView('left', flat, 1, 50, DEFAULT_VIEW).orthoSize).toBeCloseTo(2 * FRAME_MARGIN, 12); // width 2 (Z), height 1 (Y)
  });

  it('moves the perspective camera back until the whole box fits, keeping its angle', () => {
    const view = { ...DEFAULT_VIEW, theta: 0.7, phi: 1.1 };
    const v = fitView('perspective', box, wide, 50, view);
    expect(v.theta).toBe(0.7);
    expect(v.phi).toBe(1.1);
    const sphere = Math.hypot(4, 6, 4) / 2;
    // the vertical field of view is the tighter one at this aspect
    expect(v.radius).toBeCloseTo((sphere / Math.sin((50 * Math.PI) / 180 / 2)) * FRAME_MARGIN, 9);
    // a bigger model needs a bigger distance; a narrow view needs more than a wide one
    const big = { min: [0, 0, 0] as [number, number, number], max: [40, 60, 40] as [number, number, number] };
    expect(fitView('perspective', big, wide, 50, view).radius).toBeGreaterThan(v.radius);
    expect(fitView('perspective', box, 0.5, 50, view).radius).toBeGreaterThan(v.radius);
  });

  it('keeps the current zoom for a box with no size, and survives a bad aspect', () => {
    const point = { min: [2, 2, 2] as [number, number, number], max: [2, 2, 2] as [number, number, number] };
    const here = { ...DEFAULT_VIEW, orthoSize: 7, radius: 9 };
    expect(fitView('face', point, wide, 50, here)).toMatchObject({ target: [2, 2, 2], orthoSize: 7 });
    expect(fitView('perspective', point, wide, 50, here)).toMatchObject({ target: [2, 2, 2], radius: 9 });
    expect(Number.isFinite(fitView('face', box, 0, 50, DEFAULT_VIEW).orthoSize)).toBe(true);
    expect(Number.isFinite(fitView('perspective', box, NaN, 50, DEFAULT_VIEW).radius)).toBe(true);
  });

  it('stays within the zoom limits', () => {
    const huge = { min: [0, 0, 0] as [number, number, number], max: [1e9, 1e9, 1e9] as [number, number, number] };
    expect(fitView('face', huge, wide, 50, DEFAULT_VIEW).orthoSize).toBe(VIEW_LIMITS.orthoSize[1]);
    expect(fitView('perspective', huge, wide, 50, DEFAULT_VIEW).radius).toBe(VIEW_LIMITS.radius[1]);
  });
});
