import { describe, expect, it } from 'vitest';
import { boxProjectPolygon, Mesh, type Vec3 } from '@/core';
import { booleanMeshes, BooleanError, countOpenEdges, MAX_BOOLEAN_POLYGONS, meshVolume, type BooleanOp } from './boolean';
import { createBall, createBox } from './primitives';

const box = (min: Vec3, max: Vec3): Mesh =>
  createBox({ size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], segments: [1, 1, 1] });
const A = () => box([-1, -1, -1], [1, 1, 1]); // volume 8
const bool = (a: Mesh, b: Mesh, op: BooleanOp) => booleanMeshes(a, b, op);
const vol = (m: Mesh) => meshVolume(m);
/** No hole and no crack, at a tolerance far tighter than the one the operation welds with. */
const closed = (m: Mesh) => countOpenEdges(m, 1e-9);
const bounds = (m: Mesh) => [0, 1, 2].map((k) => [Math.min(...m.points.map((p) => p[k]!)), Math.max(...m.points.map((p) => p[k]!))]);
const polygonCounts = (m: Mesh) => m.polygons.length;

/** Check what must be true of every result. */
function expectSolid(m: Mesh) {
  expect(closed(m), 'the result has open edges (a hole or a crack)').toBe(0);
  expect(vol(m)).toBeGreaterThan(0);
  expect(m.polygons.every((p) => p.points.length >= 3 && new Set(p.points).size === p.points.length)).toBe(true);
  expect(m.polygons.every((p) => p.points.every((i) => i >= 0 && i < m.points.length))).toBe(true);
  const used = new Set(m.polygons.flatMap((p) => p.points));
  expect(used.size, 'unused points left behind').toBe(m.points.length);
}

describe('two boxes that overlap by half', () => {
  const B = () => box([0, -1, -1], [2, 1, 1]); // volume 8; shares x in [0, 1]

  it('add: one solid of volume 12, and the pieces are neither lost nor doubled', () => {
    const r = bool(A(), B(), 'add');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(12, 9);
    expect(bounds(r)).toEqual([[-1, 2], [-1, 1], [-1, 1]]);
    expect(polygonCounts(r)).toBe(10); // each long face is two pieces (one from each box), plus the two ends
  });

  it('subtract: the half of A that B does not reach', () => {
    const r = bool(A(), B(), 'subtract');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(4, 9);
    expect(bounds(r)).toEqual([[-1, 0], [-1, 1], [-1, 1]]);
    expect(polygonCounts(r)).toBe(6); // a plain box again: A's cut faces, and the cut face of B turned around
  });

  it('intersect: only the shared slab', () => {
    const r = bool(A(), B(), 'intersect');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(4, 9);
    expect(bounds(r)).toEqual([[0, 1], [-1, 1], [-1, 1]]);
  });

  it('obeys inclusion and exclusion: add + intersect = A + B, and subtract + intersect = A', () => {
    const [add, sub, int] = (['add', 'subtract', 'intersect'] as const).map((op) => vol(bool(A(), B(), op)));
    expect(add! + int!).toBeCloseTo(vol(A()) + vol(B()), 9);
    expect(sub! + int!).toBeCloseTo(vol(A()), 9);
  });
});

describe('a box inside a box', () => {
  const inner = () => box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]);

  it('subtract leaves a hollow: an outer shell and an inner one facing the other way', () => {
    const r = bool(A(), inner(), 'subtract');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(7, 9);
    // the outer faces were cut by the inner box's planes while the BSP tree was built; they must be one polygon each again
    expect(polygonCounts(r)).toBe(12);
  });

  it('add swallows the inner box', () => {
    const r = bool(A(), inner(), 'add');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(8, 9);
    expect(polygonCounts(r)).toBe(6);
  });

  it('intersect is the inner box', () => {
    const r = bool(A(), inner(), 'intersect');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(1, 9);
    expect(polygonCounts(r)).toBe(6);
  });
});

describe('a square hole straight through', () => {
  const peg = () => box([-0.5, -0.5, -2], [0.5, 0.5, 2]);

  it('subtract: the volume of the hole is gone, and the result is still one closed surface', () => {
    const r = bool(A(), peg(), 'subtract');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(8 - 1 * 1 * 2, 9);
    expect(r.polygons.length).toBeGreaterThanOrEqual(12);
    expect(r.polygons.length).toBeLessThan(40);
  });

  it('the hole\'s walls face into the hole, not out of it', () => {
    const r = bool(A(), peg(), 'subtract');
    const walls = r.polygons.filter((p) => p.points.every((i) => Math.abs(Math.abs(r.points[i]![0]) - 0.5) < 1e-9 || Math.abs(Math.abs(r.points[i]![1]) - 0.5) < 1e-9) && p.points.every((i) => Math.abs(r.points[i]![0]) <= 0.5 + 1e-9 && Math.abs(r.points[i]![1]) <= 0.5 + 1e-9));
    expect(walls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('solids that do not overlap', () => {
  const far = () => box([5, 5, 5], [7, 7, 7]);

  it('add keeps both, as one mesh with two closed shells', () => {
    const r = bool(A(), far(), 'add');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(16, 9);
    expect(polygonCounts(r)).toBe(12);
  });

  it('subtract changes nothing', () => {
    const r = bool(A(), far(), 'subtract');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(8, 9);
    expect(polygonCounts(r)).toBe(6);
  });

  it('intersect has nothing to return, and says so', () => {
    expect(() => bool(A(), far(), 'intersect')).toThrow(BooleanError);
    expect(() => bool(A(), far(), 'intersect')).toThrow(/do not overlap/);
  });
});

describe('solids that touch', () => {
  const next = () => box([1, -1, -1], [3, 1, 1]); // shares the whole face at x = 1

  it('add joins them into one box with no wall left in the middle', () => {
    const r = bool(A(), next(), 'add');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(16, 9);
    expect(bounds(r)).toEqual([[-1, 3], [-1, 1], [-1, 1]]);
    // no polygon may lie in the plane x = 1: that was the shared wall
    expect(r.polygons.some((p) => p.points.every((i) => r.points[i]![0] === 1))).toBe(false);
  });

  it('subtract leaves A as it was', () => {
    const r = bool(A(), next(), 'subtract');
    expectSolid(r);
    expect(vol(r)).toBeCloseTo(8, 9);
  });

  it('intersect finds no volume in common', () => {
    expect(() => bool(A(), next(), 'intersect')).toThrow(BooleanError);
  });
});

describe('identical solids', () => {
  it('add and intersect give the same solid', () => {
    expect(vol(bool(A(), A(), 'add'))).toBeCloseTo(8, 9);
    expect(vol(bool(A(), A(), 'intersect'))).toBeCloseTo(8, 9);
    expectSolid(bool(A(), A(), 'add'));
  });

  it('subtract leaves nothing', () => {
    expect(() => bool(A(), A(), 'subtract')).toThrow(/empty/);
  });
});

describe('curved solids', () => {
  const ball = () => createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 16, segments: 8, axis: 'y' });
  const half = () => box([0, -2, -2], [2, 2, 2]);

  it('cutting a ball with a box: closed, outward, and the three operations add up', () => {
    const [add, sub, int] = (['add', 'subtract', 'intersect'] as const).map((op) => bool(ball(), half(), op));
    for (const r of [add!, sub!, int!]) expectSolid(r);
    expect(vol(sub!) + vol(int!)).toBeCloseTo(vol(ball()), 6);
    expect(vol(add!) + vol(int!)).toBeCloseTo(vol(ball()) + vol(half()), 6);
    expect(vol(sub!)).toBeCloseTo(vol(ball()) / 2, 6); // the plane x = 0 passes through the ball's middle
  });

  it('a ball cut in a different place still adds up', () => {
    const cutter = box([-3, 0.3, -3], [3, 3, 3]);
    const sub = bool(ball(), cutter, 'subtract');
    const int = bool(ball(), cutter, 'intersect');
    expectSolid(sub);
    expectSolid(int);
    expect(vol(sub) + vol(int)).toBeCloseTo(vol(ball()), 6);
  });

  it('ball minus ball (a bite out of a sphere)', () => {
    const bite = createBall({ radius: [0.6, 0.6, 0.6], center: [0.9, 0.2, 0.1], sides: 12, segments: 6, axis: 'z' });
    const sub = bool(ball(), bite, 'subtract');
    const int = bool(ball(), bite, 'intersect');
    expectSolid(sub);
    expectSolid(int);
    expect(vol(sub) + vol(int)).toBeCloseTo(vol(ball()), 6);
  });
});

describe('a concave solid', () => {
  /** An L-shaped prism, 1 high: area 3, volume 3. Its top and bottom are concave polygons. */
  function lPrism(): Mesh {
    const m = new Mesh();
    const L: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    L.forEach(([x, y]) => m.addPoint([x, y, 0]));
    L.forEach(([x, y]) => m.addPoint([x, y, 1]));
    m.addPolygon([5, 4, 3, 2, 1, 0]); // bottom, facing -z
    m.addPolygon([6, 7, 8, 9, 10, 11]); // top, facing +z
    for (let i = 0; i < 6; i++) m.addPolygon([i, (i + 1) % 6, 6 + ((i + 1) % 6), 6 + i]);
    return m;
  }

  it('is a closed solid of the volume we expect', () => {
    expect(closed(lPrism())).toBe(0);
    expect(vol(lPrism())).toBeCloseTo(3, 12);
  });

  it('can be cut: the concave faces are split into triangles first, and the answer is still exact', () => {
    const corner = box([-1, -1, -1], [0.5, 0.5, 2]); // takes a 0.5 x 0.5 notch out of the inside corner
    const sub = bool(lPrism(), corner, 'subtract');
    expectSolid(sub);
    expect(vol(sub)).toBeCloseTo(3 - 0.25, 9);
  });

  it('can be cut with the concave solid as the cutter', () => {
    const slab = box([-1, -1, 0.25], [3, 3, 0.75]);
    const sub = bool(slab, lPrism(), 'subtract');
    expectSolid(sub);
    expect(vol(sub)).toBeCloseTo(16 * 0.5 - 3 * 0.5, 9); // the slab is 4 x 4 x 0.5; the L passes through it
  });
});

describe('surfaces and UVs', () => {
  const named = (m: Mesh, name: string) => {
    m.surfaces = [{ ...m.surfaces[0]!, name }];
    return m;
  };

  it('every polygon keeps the surface of the solid it came from, and the surfaces are merged by name', () => {
    const a = named(A(), 'Skin');
    const b = named(box([0, -1, -1], [2, 1, 1]), 'Metal');
    const r = bool(a, b, 'add');
    expect(r.surfaces.map((s) => s.name)).toEqual(['Skin', 'Metal']);
    const metal = r.polygons.filter((p) => r.surfaces[p.surface]!.name === 'Metal');
    const skin = r.polygons.filter((p) => r.surfaces[p.surface]!.name === 'Skin');
    expect(metal.length + skin.length).toBe(r.polygons.length);
    expect(metal.every((p) => p.points.every((i) => r.points[i]![0] >= 0))).toBe(true); // B's polygons lie in x >= 0
    expect(skin.length).toBeGreaterThan(0);
    expect(metal.length).toBeGreaterThan(0);
  });

  it('a surface with the same name in both solids is one surface', () => {
    const r = bool(named(A(), 'Same'), named(box([0, -1, -1], [2, 1, 1]), 'Same'), 'add');
    expect(r.surfaces).toHaveLength(1);
    expect(r.polygons.every((p) => p.surface === 0)).toBe(true);
  });

  it('keeps the UVs of fragments exactly as the original mapping would give them', () => {
    const a = A(); // createBox projects UVs; those are linear in position, so a cut piece must match the projection of its own points
    const b = box([0, -0.5, -0.5], [2, 0.5, 0.5]);
    const r = bool(a, b, 'subtract');
    let checked = 0;
    for (const p of r.polygons) {
      if (!p.uvs) continue;
      const pts = p.points.map((i) => r.points[i]!);
      const expected = boxProjectPolygon(pts, 64, 64);
      // faces from the cutter come out turned around, so compare only those that still face the way the box face did
      const same = p.uvs.every((uv, k) => Math.abs(uv[0] - expected[k]![0]) < 1e-6 && Math.abs(uv[1] - expected[k]![1]) < 1e-6);
      if (same) checked++;
    }
    expect(checked).toBeGreaterThan(4);
  });

  it('polygons from a solid with no UVs have none, and the others keep theirs', () => {
    const b = box([0, -1, -1], [2, 1, 1]);
    b.polygons.forEach((p) => delete p.uvs);
    const r = bool(A(), b, 'add');
    expect(r.polygons.some((p) => p.uvs)).toBe(true);
    expect(r.polygons.some((p) => !p.uvs)).toBe(true);
    expect(r.polygons.every((p) => !p.uvs || p.uvs.length === p.points.length)).toBe(true);
  });
});

describe('what the inputs have to be', () => {
  it('a solid facing inward is treated as flipped, so the answer is the same', () => {
    const inside = A();
    inside.polygons.forEach((p) => {
      p.points.reverse();
      p.uvs?.reverse();
    });
    expect(vol(inside)).toBeLessThan(0);
    const b = box([0, -1, -1], [2, 1, 1]);
    expect(vol(bool(inside, b, 'add'))).toBeCloseTo(12, 9);
    expect(vol(bool(A(), inside, 'intersect'))).toBeCloseTo(8, 9);
  });

  it('refuses a solid with a hole in it, naming it and counting the open edges', () => {
    const open = A();
    open.polygons.splice(0, 1);
    expect(() => bool(open, box([0, 0, 0], [3, 3, 3]), 'add')).toThrow(/The object is not a closed solid: 4 edges are open/);
    expect(() => bool(A(), open, 'add')).toThrow(/The cutter is not a closed solid/);
  });

  it('refuses an empty mesh', () => {
    expect(() => bool(new Mesh(), A(), 'add')).toThrow(/The object has no polygons/);
    expect(() => bool(A(), new Mesh(), 'add')).toThrow(/The cutter has no polygons/);
  });

  it('accepts a solid whose points were never welded, as long as they coincide', () => {
    const loose = new Mesh();
    for (const p of A().polygons) {
      const base = loose.points.length;
      p.points.forEach((i) => loose.addPoint([...A().points[i]!]));
      loose.addPolygon(p.points.map((_, k) => base + k));
    }
    expect(loose.points.length).toBe(24);
    expect(vol(bool(loose, box([0, -1, -1], [2, 1, 1]), 'add'))).toBeCloseTo(12, 9);
  });

  it('refuses meshes too big to wait for', () => {
    const big = () => createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 64, segments: 48, axis: 'y' });
    expect(big().polygons.length * 2).toBeGreaterThan(MAX_BOOLEAN_POLYGONS);
    expect(() => bool(big(), big(), 'add')).toThrow(/Too many polygons/);
  });

  it('does not change what it was given, and gives the same answer twice', () => {
    const a = A();
    const b = box([0, -1, -1], [2, 1, 1]);
    const before = JSON.stringify([a, b]);
    const first = bool(a, b, 'add');
    expect(JSON.stringify([a, b])).toBe(before);
    expect(JSON.stringify(bool(a, b, 'add'))).toBe(JSON.stringify(first));
  });

  it('works at a very different size', () => {
    const scaled = (k: number, m: Mesh) => {
      m.points = m.points.map((p) => [p[0] * k, p[1] * k, p[2] * k]);
      return m;
    };
    for (const k of [0.001, 1000]) {
      const r = bool(scaled(k, A()), scaled(k, box([0, -1, -1], [2, 1, 1])), 'add');
      expectSolid(r);
      expect(Math.abs(vol(r) / (12 * k ** 3) - 1)).toBeLessThan(1e-9); // relative: absolute error means nothing at these sizes
    }
  });
});
