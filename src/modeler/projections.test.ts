import { describe, expect, it } from 'vitest';
import { boxProjectPolygon, createImage, projectPolygons, type Mesh, type UV } from '@/core';
import { applyAutoUv, applyProjection } from './uvTools';
import { createBall, createBox, createDisc } from './primitives';
import { ModelerState } from './state';

/** Signed area in (u, v). With v pointing down, a polygon seen counter-clockwise from outside comes out negative. */
const area = (uvs: UV[]) => uvs.reduce((s, [u, v], i) => s + (u * uvs[(i + 1) % uvs.length]![1] - uvs[(i + 1) % uvs.length]![0] * v), 0) / 2;
const span = (uvs: UV[], k: 0 | 1) => Math.max(...uvs.map((t) => t[k])) - Math.min(...uvs.map((t) => t[k]));
const all = (m: Mesh) => m.polygons.map((_, i) => i);
const ball = (axis: 'x' | 'y' | 'z') => createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 16, segments: 8, axis });

describe('spherical projection', () => {
  it.each(['x', 'y', 'z'] as const)('wraps a ball with its poles on the %s axis: nothing mirrored, nothing degenerate', (axis) => {
    const m = ball(axis);
    const uvs = projectPolygons(m, all(m), { kind: 'spherical', axis });
    uvs.forEach((poly, i) => {
      expect(area(poly), `polygon ${i} mirrored or flat`).toBeLessThan(-1e-6);
      expect(poly.every(([u, v]) => Number.isFinite(u) && Number.isFinite(v))).toBe(true);
    });
  });

  it('keeps every polygon small across the seam instead of stretching it over the whole texture', () => {
    const m = ball('y');
    for (const poly of projectPolygons(m, all(m), { kind: 'spherical', axis: 'y' })) {
      expect(span(poly, 0)).toBeLessThan(0.5);
      expect(Math.min(...poly.map((t) => t[0]))).toBeGreaterThan(-0.5);
      expect(Math.max(...poly.map((t) => t[0]))).toBeLessThan(1.5);
    }
  });

  it('puts the poles at v = 0 and v = 1, and the equator in the middle', () => {
    const m = ball('y');
    const uvs = projectPolygons(m, all(m), { kind: 'spherical', axis: 'y' });
    const vOf = (point: number) => {
      const poly = m.polygons.findIndex((p) => p.points.includes(point));
      return uvs[poly]![m.polygons[poly]!.points.indexOf(point)]![1];
    };
    expect(vOf(0)).toBeCloseTo(0, 9); // top pole is the first point createBall adds
    expect(vOf(m.points.length - 1)).toBeCloseTo(1, 9);
    const equatorV = m.points.map((_, i) => vOf(i)).filter((v) => Math.abs(v - 0.5) < 1e-6);
    expect(equatorV.length).toBeGreaterThan(0);
  });

  it('gives a pole the u of its neighbours so the fan stays a clean wedge', () => {
    const m = ball('y');
    const uvs = projectPolygons(m, all(m), { kind: 'spherical', axis: 'y' });
    const fan = m.polygons.findIndex((p) => p.points.includes(0));
    const poleCorner = m.polygons[fan]!.points.indexOf(0);
    const others = uvs[fan]!.filter((_, i) => i !== poleCorner);
    expect(uvs[fan]![poleCorner]![0]).toBeCloseTo((others[0]![0] + others[1]![0]) / 2, 9);
  });
});

describe('cylindrical projection', () => {
  const disc = () => createDisc({ radius: 1, height: 2, center: [0, 0, 0], sides: 12, segments: 2, axis: 'y' });
  const sides = (m: Mesh) => all(m).slice(0, 12 * 2); // the caps come last

  it('wraps the side once: not mirrored, v running from the top edge (0) to the bottom edge (1)', () => {
    const m = disc();
    const uvs = projectPolygons(m, sides(m), { kind: 'cylindrical', axis: 'y' });
    uvs.forEach((poly) => {
      expect(area(poly)).toBeLessThan(0);
      expect(span(poly, 0)).toBeLessThan(0.5);
    });
    const vs = new Set(uvs.flat().map((t) => t[1].toFixed(6)));
    expect([...vs].sort()).toEqual(['0.000000', '0.500000', '1.000000']);
  });

  it('frames itself on the polygons it is given, so a single band spans the full height', () => {
    const m = disc();
    const topBand = all(m).slice(0, 12); // the first ring of quads
    const vs = projectPolygons(m, topBand, { kind: 'cylindrical', axis: 'y' }).flat().map((t) => t[1]);
    expect(Math.min(...vs)).toBeCloseTo(0, 9);
    expect(Math.max(...vs)).toBeCloseTo(1, 9);
  });

  it('does not produce NaN for polygons that lie in a plane perpendicular to the axis (the caps)', () => {
    const m = disc();
    const caps = all(m).slice(12 * 2);
    for (const poly of projectPolygons(m, caps, { kind: 'cylindrical', axis: 'y' })) {
      expect(poly.every((t) => t.every(Number.isFinite))).toBe(true);
    }
  });
});

describe('planar projection', () => {
  const box = createBox({ size: [2, 2, 2], center: [0, 0, 0], segments: [1, 1, 1] });
  const faceAt = (axis: 0 | 1 | 2, sign: 1 | -1) =>
    box.polygons.findIndex((p) => p.points.every((i) => box.points[i]![axis] === sign));

  it('reads like the front of a box when seen from the positive side of its axis', () => {
    for (const [axis, name] of [[0, 'x'], [1, 'y'], [2, 'z']] as const) {
      const f = faceAt(axis, 1);
      const [uvs] = projectPolygons(box, [f], { kind: 'planar', axis: name });
      expect(area(uvs!)).toBeLessThan(0);
    }
  });

  it('matches box projection on the face it looks at, and mirrors the opposite face (it only sees one side)', () => {
    const front = faceAt(2, 1);
    const back = faceAt(2, -1);
    const pts = (f: number) => box.polygons[f]!.points.map((i) => box.points[i]!);
    expect(projectPolygons(box, [front], { kind: 'planar', axis: 'z' })[0]).toEqual(boxProjectPolygon(pts(front), 64, 64));
    expect(area(projectPolygons(box, [back], { kind: 'planar', axis: 'z' })[0]!)).toBeGreaterThan(0);
  });

  it('uses the size of each polygon\'s own texture for its density', () => {
    const f = faceAt(2, 1);
    const at = (size: number) => projectPolygons(box, [f], { kind: 'planar', axis: 'z' }, () => [size, size])[0]!;
    expect(span(at(128), 0)).toBeCloseTo(span(at(64), 0) / 2, 9);
  });
});

describe('applyProjection', () => {
  it('projects the selection, or the whole layer when nothing is selected, as one undo step', () => {
    const s = new ModelerState(ball('y'));
    s.setMode('polygons');
    s.applySelection([0, 1, 2], 'replace');
    const before = s.mesh.polygons.map((p) => p.uvs);
    expect(applyProjection(s, { kind: 'spherical', axis: 'y' })).toBe(true);
    expect(s.mesh.polygons.slice(0, 3).every((p, i) => JSON.stringify(p.uvs) !== JSON.stringify(before[i]))).toBe(true);
    expect(s.mesh.polygons[10]!.uvs).toEqual(before[10]); // untouched

    s.clearSelection();
    s.undo();
    expect(s.mesh.polygons.map((p) => p.uvs)).toEqual(before);
    s.redo();
    expect(s.mesh.polygons[0]!.uvs).not.toEqual(before[0]);
  });

  it('names the undo step after the projection, and Auto UV is the box projection', () => {
    const s = new ModelerState(ball('y'));
    applyProjection(s, { kind: 'cylindrical', axis: 'y' });
    expect(s.history.undoLabel).toBe('Cylindrical UV');
    s.undo();
    s.mesh.polygons.forEach((p) => delete p.uvs);
    applyAutoUv(s);
    expect(s.history.undoLabel).toBe('Auto UV');
  });

  it('sizes fixed-density projections for the surface texture', () => {
    const s = new ModelerState(createBox({ size: [1, 1, 1], center: [0, 0, 0], segments: [1, 1, 1] }));
    s.images.push(createImage('Big', 256, 256));
    applyProjection(s, { kind: 'planar', axis: 'z' });
    const small = span(s.mesh.polygons[0]!.uvs!, 0) || span(s.mesh.polygons[4]!.uvs!, 0);
    s.mesh.surfaces[0]!.texture = 'Big';
    applyProjection(s, { kind: 'planar', axis: 'z' });
    const big = span(s.mesh.polygons[0]!.uvs!, 0) || span(s.mesh.polygons[4]!.uvs!, 0);
    expect(big).toBeCloseTo(small / 4, 9);
  });
});
