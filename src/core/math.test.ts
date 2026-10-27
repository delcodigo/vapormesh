import { describe, expect, it } from 'vitest';
import { rotateAround } from './math';

describe('rotateAround', () => {
  it('rotates +X to +Y for +90 degrees about +Z', () => {
    const p = rotateAround([1, 0, 0], [0, 0, 0], [0, 0, 1], Math.PI / 2);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(1);
    expect(p[2]).toBeCloseTo(0);
  });

  it('rotates about an offset pivot and normalises the axis', () => {
    const p = rotateAround([3, 1, 5], [1, 1, 0], [0, 0, 10], Math.PI);
    expect(p[0]).toBeCloseTo(-1);
    expect(p[1]).toBeCloseTo(1);
    expect(p[2]).toBeCloseTo(5);
  });
});
