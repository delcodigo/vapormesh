import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { AXIS_INDEX, deformer, extentAlong, magnet, magnetWeight, type DeformAxis, type DeformSpec } from './deform';

const near = (a: Vec3, b: Vec3, digits = 9) => a.forEach((c, i) => expect(c, `component ${i} of ${a} vs ${b}`).toBeCloseTo(b[i]!, digits));
const AXES: DeformAxis[] = ['x', 'y', 'z'];
const apply = (points: Vec3[], spec: DeformSpec, pivot: Vec3 = [0, 0, 0]) => points.map(deformer(points, spec, pivot));
/** Distance of a point from the line through `pivot` along an axis. */
const fromAxis = (p: Vec3, axis: DeformAxis, pivot: Vec3) => Math.hypot(...[0, 1, 2].filter((k) => k !== AXIS_INDEX[axis]).map((k) => p[k]! - pivot[k]!));
/** A point at `along` on the axis, and `out` away from it in the first perpendicular direction. */
const at = (axis: DeformAxis, along: number, out: number, out2 = 0): Vec3 => {
  const a = AXIS_INDEX[axis];
  const p: Vec3 = [0, 0, 0];
  p[a] = along;
  p[(a + 1) % 3] = out;
  p[(a + 2) % 3] = out2;
  return p;
};

describe('extentAlong', () => {
  it('is the range of the points on an axis', () => {
    expect(extentAlong([[1, 5, 0], [-2, 7, 0], [3, 6, 0]], 'x')).toEqual({ lo: -2, hi: 3, length: 5 });
    expect(extentAlong([], 'y')).toEqual({ lo: 0, hi: 0, length: 0 });
  });
});

describe('stretch', () => {
  const pts: Vec3[] = [[1, 2, 3], [-1, 0, 5]];

  it('scales each axis separately about the pivot', () => {
    const out = apply(pts, { kind: 'stretch', factors: [2, 1, 0.5] }, [0, 1, 1]);
    near(out[0]!, [2, 2, 2]);
    near(out[1]!, [-2, 0, 3]);
  });

  it('is the identity for factors of one, and leaves the pivot where it is', () => {
    near(apply(pts, { kind: 'stretch', factors: [1, 1, 1] })[0]!, pts[0]!);
    near(apply([[4, 4, 4]], { kind: 'stretch', factors: [9, 9, 9] }, [4, 4, 4])[0]!, [4, 4, 4]);
  });
});

describe.each(AXES)('taper along %s', (axis) => {
  // a column of three rings, one unit out from the axis, at 0, 1 and 2 along it
  const ring = (s: number): Vec3[] => [at(axis, s, 1), at(axis, s, -1), at(axis, s, 0, 1), at(axis, s, 0, -1)];
  const column = [...ring(0), ...ring(1), ...ring(2)];

  it('shrinks each ring in proportion to how far along it is, keeping the axis coordinate', () => {
    const out = apply(column, { kind: 'taper', axis, amount: 0.5 });
    column.forEach((p, i) => {
      const s = p[AXIS_INDEX[axis]]!;
      expect(out[i]![AXIS_INDEX[axis]]).toBe(s);
      expect(fromAxis(out[i]!, axis, [0, 0, 0])).toBeCloseTo(1 - (0.5 * s) / 2, 9); // factor 1 at the low end, 0.5 at the high end
    });
  });

  it('an amount of one pinches the high end onto the axis, and a negative one flares it', () => {
    const pinched = apply(column, { kind: 'taper', axis, amount: 1 });
    pinched.slice(8).forEach((p) => expect(fromAxis(p, axis, [0, 0, 0])).toBeCloseTo(0, 9));
    const flared = apply(column, { kind: 'taper', axis, amount: -1 });
    flared.slice(8).forEach((p) => expect(fromAxis(p, axis, [0, 0, 0])).toBeCloseTo(2, 9));
  });

  it('works about the pivot\'s axis line, wherever the pivot is', () => {
    const pivot = at(axis, 1, 5, -3);
    const pts = [at(axis, 0, 6, -3), at(axis, 2, 6, -3)];
    const out = apply(pts, { kind: 'taper', axis, amount: 1 }, pivot);
    expect(fromAxis(out[0]!, axis, pivot)).toBeCloseTo(1, 9); // the low end is untouched
    expect(fromAxis(out[1]!, axis, pivot)).toBeCloseTo(0, 9);
  });

  it('does nothing to points with no extent along the axis', () => {
    const flat = [at(axis, 3, 1), at(axis, 3, -1)];
    near(apply(flat, { kind: 'taper', axis, amount: 0.7 })[0]!, flat[0]!);
  });
});

describe.each(AXES)('twist about %s', (axis) => {
  const column: Vec3[] = [at(axis, -1, 1), at(axis, 0, 1), at(axis, 1, 1), at(axis, 1, 0), at(axis, 0, 0, 0)];

  it('keeps every point at its distance from the axis and its place along it', () => {
    const out = apply(column, { kind: 'twist', axis, radians: 2.1 });
    column.forEach((p, i) => {
      expect(out[i]![AXIS_INDEX[axis]]).toBeCloseTo(p[AXIS_INDEX[axis]]!, 12);
      expect(fromAxis(out[i]!, axis, [0, 0, 0])).toBeCloseTo(fromAxis(p, axis, [0, 0, 0]), 12);
    });
  });

  it('turns the two ends opposite ways by half the angle each, and leaves the middle alone', () => {
    const out = apply(column, { kind: 'twist', axis, radians: Math.PI / 2 });
    near(out[1]!, column[1]!); // at the pivot: no turn
    // +45 degrees at the high end, right-handed about +axis: from the first perpendicular towards the second
    const s = Math.SQRT1_2;
    near(out[2]!, at(axis, 1, s, s));
    near(out[0]!, at(axis, -1, s, -s)); // -45 degrees at the low end
  });

  it('turns exactly like a rotation at the high end when the twist is a quarter turn over its length', () => {
    const out = apply([at(axis, 0, 1), at(axis, 2, 1)], { kind: 'twist', axis, radians: Math.PI }, at(axis, 0, 0));
    near(out[1]!, at(axis, 2, -1, 0)); // a half turn at the far end
  });

  it('points on the axis do not move, and a zero angle is the identity', () => {
    const out = apply(column, { kind: 'twist', axis, radians: 1.3 });
    near(out[3]!, column[3]!);
    near(out[4]!, column[4]!);
    near(apply(column, { kind: 'twist', axis, radians: 0 })[0]!, column[0]!);
  });
});

describe('bend', () => {
  /** A bar along y from -1 to 1, with points on its axis and one unit to the side (towards z). */
  const bar: Vec3[] = [[0, -1, 0], [0, 0, 0], [0, 1, 0], [0, 1, 0.5], [0, 0, 0.5]];
  const spec = (radians: number, toward: DeformAxis = 'z'): DeformSpec => ({ kind: 'bend', axis: 'y', toward, radians });

  it('wraps the axis round a circle: points on it land at arc length from the middle', () => {
    const theta = 1.2;
    const R = 2 / theta; // the bar is 2 long
    const out = apply(bar, spec(theta));
    near(out[1]!, [0, 0, 0]); // the middle does not move
    for (const k of [0, 2]) {
      const s = bar[k]![1]!;
      const phi = s / R;
      near(out[k]!, [0, R * Math.sin(phi), R * (1 - Math.cos(phi))]);
    }
  });

  it('bends towards the side it is asked to: the centre of the circle is that way', () => {
    const out = apply(bar, spec(1.2, 'z'));
    expect(out[2]![2]).toBeGreaterThan(0);
    const away = apply(bar, spec(-1.2, 'z'));
    expect(away[2]![2]).toBeLessThan(0);
  });

  it('a point towards the centre stays at its distance from the centre of the circle, one radius less', () => {
    const theta = 0.9;
    const R = 2 / theta;
    const out = apply(bar, spec(theta));
    const centre: Vec3 = [0, 0, R];
    expect(Math.hypot(out[3]![0] - centre[0], out[3]![1] - centre[1], out[3]![2] - centre[2])).toBeCloseTo(R - 0.5, 9);
    expect(Math.hypot(out[2]![0] - centre[0], out[2]![1] - centre[1], out[2]![2] - centre[2])).toBeCloseTo(R, 9);
  });

  it('keeps lengths along the axis: the arc through the bent axis points is as long as the bar', () => {
    const steps = Array.from({ length: 201 }, (_, i): Vec3 => [0, -1 + i / 100, 0]);
    const out = apply(steps.concat([[0, -1, 0], [0, 1, 0]]), spec(2.5)).slice(0, 201);
    const length = out.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - out[i]![0], p[1] - out[i]![1], p[2] - out[i]![2]), 0);
    expect(length).toBeCloseTo(2, 3);
  });

  it('leaves the third axis alone, and a zero or tiny angle is the identity', () => {
    const wide: Vec3[] = [[3, -1, 0], [3, 1, 0], [-2, 0, 0]];
    apply(wide, spec(1)).forEach((p, i) => expect(p[0]).toBe(wide[i]![0]));
    near(apply(bar, spec(0))[2]!, bar[2]!);
    near(apply(bar, spec(1e-12))[2]!, bar[2]!, 6);
  });

  it('stays accurate for a very slight bend, where the radius is enormous', () => {
    const out = apply(bar, spec(1e-6));
    near(out[2]!, [0, 1, 2.5e-7], 9); // R(1 - cos φ) ≈ Rφ²/2 with R = 2e6, φ = 5e-7
  });

  it('bending towards its own axis is nonsense, so it bends towards the next one instead of producing NaN', () => {
    const out = apply(bar, { kind: 'bend', axis: 'y', toward: 'y', radians: 1 });
    expect(out.every((p) => p.every(Number.isFinite))).toBe(true);
    expect(out[2]![2]).toBeGreaterThan(0); // the next axis after y is z
  });

  it('works about any axis, preserving the same arcs', () => {
    for (const axis of AXES) {
      const toward = AXES[(AXIS_INDEX[axis] + 1) % 3]!;
      const pts = [at(axis, -1, 0), at(axis, 1, 0)];
      const out = apply(pts, { kind: 'bend', axis, toward, radians: 1 }, at(axis, 0, 0));
      const R = 2;
      near(out[1]!, at(axis, R * Math.sin(0.5), 0).map((c, i) => (i === (AXIS_INDEX[axis] + 1) % 3 ? R * (1 - Math.cos(0.5)) : c)) as Vec3);
    }
  });
});

describe('magnetWeight', () => {
  it('is 1 at the centre, 0 at the radius and beyond, and falls smoothly in between', () => {
    expect(magnetWeight(0, 2)).toBe(1);
    expect(magnetWeight(2, 2)).toBe(0);
    expect(magnetWeight(5, 2)).toBe(0);
    let last = 1;
    for (let d = 0; d <= 2; d += 0.05) {
      const w = magnetWeight(d, 2);
      expect(w).toBeLessThanOrEqual(last + 1e-12);
      expect(w).toBeGreaterThanOrEqual(0);
      last = w;
    }
    // smooth at both ends: it does not drop off a cliff
    expect(1 - magnetWeight(0.02, 2)).toBeLessThan(1e-3);
    expect(magnetWeight(1.98, 2)).toBeLessThan(1e-3);
  });

  it('pulls nothing when the radius is not positive', () => {
    expect(magnetWeight(0, 0)).toBe(0);
    expect(magnetWeight(0, -1)).toBe(0);
  });
});

describe('magnet', () => {
  const pull = magnet([0, 0, 0], [0, 0, 1], 2, [1, 0, 0]);

  it('moves the point at the centre by the whole offset, and points outside the radius not at all', () => {
    near(pull([0, 0, 0]), [1, 0, 0]);
    near(pull([2, 0, 0]), [2, 0, 0]);
    near(pull([0, 3, 0]), [0, 3, 0]);
  });

  it('moves a point in between by part of it', () => {
    const p = pull([1, 0, 0]);
    expect(p[0]).toBeGreaterThan(1);
    expect(p[0]).toBeLessThan(2);
    expect(p[0] - 1).toBeCloseTo(magnetWeight(1, 2), 12);
  });

  it('measures distance across the view only, so depth makes no difference', () => {
    near(pull([1, 0, 0]), [1 + magnetWeight(1, 2), 0, 0]);
    near(pull([1, 0, 50]), [1 + magnetWeight(1, 2), 0, 50]);
    near(pull([1, 0, -7]), [1 + magnetWeight(1, 2), 0, -7]);
  });

  it('works for any view direction, and for one that is not a unit vector', () => {
    const side = magnet([0, 0, 0], [0, 0, 5], 2, [0, 1, 0]);
    near(side([0.5, 0, 9]), [0.5, magnetWeight(0.5, 2), 9]);
    const alongX = magnet([0, 0, 0], [1, 0, 0], 2, [0, 0, 1]);
    near(alongX([30, 0.5, 0]), [30, 0.5, magnetWeight(0.5, 2)]);
  });
});
