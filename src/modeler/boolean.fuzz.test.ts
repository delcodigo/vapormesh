import { describe, expect, it } from 'vitest';
import type { Mesh, Vec3 } from '@/core';
import { booleanMeshes, BooleanError, countUnbalancedEdges, meshVolume } from './boolean';
import { createBall, createBox, createCone, createDisc } from './primitives';

/** A small, fast, seedable random generator, so a failure can be reproduced from its number. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random solid. Sizes and positions sit on a quarter-unit grid, so faces often line up exactly with the other solid's. */
function solid(rand: () => number, fine: boolean): { mesh: Mesh; name: string } {
  const q = (lo: number, hi: number) => lo + Math.round(rand() * ((hi - lo) / 0.25)) * 0.25;
  const sides = fine ? 12 : 8;
  const center: Vec3 = [q(-1, 1), q(-1, 1), q(-1, 1)];
  const kind = Math.floor(rand() * 4);
  if (kind === 0) return { name: 'box', mesh: createBox({ size: [q(0.5, 2), q(0.5, 2), q(0.5, 2)], center, segments: [1, 1, 1] }) };
  if (kind === 1) return { name: 'ball', mesh: createBall({ radius: [q(0.5, 1.25), q(0.5, 1.25), q(0.5, 1.25)], center, sides, segments: fine ? 6 : 4, axis: (['x', 'y', 'z'] as const)[Math.floor(rand() * 3)]! }) };
  if (kind === 2) return { name: 'disc', mesh: createDisc({ radius: q(0.5, 1), height: q(0.5, 2), center, sides, segments: 1, axis: (['x', 'y', 'z'] as const)[Math.floor(rand() * 3)]! }) };
  return { name: 'cone', mesh: createCone({ radius: q(0.5, 1), height: q(0.5, 2), center, sides, segments: 2, axis: (['x', 'y', 'z'] as const)[Math.floor(rand() * 3)]! }) };
}

const attempt = (a: Mesh, b: Mesh, op: 'add' | 'subtract' | 'intersect') => {
  try {
    return booleanMeshes(a, b, op);
  } catch (e) {
    if (e instanceof BooleanError && /empty/.test(e.message)) return null; // legitimately nothing left
    throw e;
  }
};

describe('booleans between random solids', () => {
  // Every seed is a different pair of solids; a third use finer meshes. Positions sit on a coarse grid, so faces and edges often
  // coincide or touch exactly, which is where booleans go wrong.
  const CASES = 150;
  // Points are welded within a small tolerance, which moves surfaces by up to that much: volumes agree to about 1e-5, not exactly.
  const RELATIVE = 1e-4;
  for (let seed = 1; seed <= CASES; seed++) {
    it(`seed ${seed}: no holes or cracks, positive volume, and the three operations agree`, () => {
      const rand = random(seed);
      const fine = seed % 3 === 0;
      const [a, b] = [solid(rand, fine), solid(rand, fine)];
      const label = `seed ${seed}: ${a.name} and ${b.name}`;
      const [vA, vB] = [meshVolume(a.mesh), meshVolume(b.mesh)];
      const ops = ['add', 'subtract', 'intersect'] as const;
      const results = ops.map((op) => attempt(a.mesh, b.mesh, op));
      const [add, sub, int] = results as [Mesh | null, Mesh | null, Mesh | null];

      for (const [i, r] of results.entries()) {
        if (!r) continue;
        // balanced, not strictly manifold: two solids touching along a line legitimately share that edge among four polygons
        expect(countUnbalancedEdges(r, 1e-9), `${label} (${ops[i]}): a hole or crack`).toBe(0);
        expect(meshVolume(r), `${label} (${ops[i]}): volume`).toBeGreaterThan(0);
      }
      const volume = (r: Mesh | null) => (r ? meshVolume(r) : 0);
      const tolerance = RELATIVE * Math.max(vA, vB);
      expect(Math.abs(volume(add) + volume(int) - (vA + vB)), `${label}: add + intersect = A + B`).toBeLessThan(tolerance);
      expect(Math.abs(volume(sub) + volume(int) - vA), `${label}: subtract + intersect = A`).toBeLessThan(tolerance);
      expect(volume(add), `${label}: the union is at least as big as either`).toBeGreaterThanOrEqual(Math.max(vA, vB) - tolerance);
      expect(volume(int), `${label}: the intersection fits inside both`).toBeLessThanOrEqual(Math.min(vA, vB) + tolerance);
    });
  }
});
