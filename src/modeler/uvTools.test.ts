import { describe, expect, it } from 'vitest';
import { assignAutoUvs, createImage } from '@/core';
import { box } from './primitives';
import { ModelerState } from './state';
import { applyAutoUv } from './uvTools';

describe('applyAutoUv', () => {
  it('gives UVs to a mesh that has none, as one undo step, and undo removes them again', () => {
    const s = new ModelerState(box());
    expect(s.mesh.polygons.every((p) => !p.uvs)).toBe(true);
    expect(applyAutoUv(s)).toBe(true);
    expect(s.mesh.polygons.every((p) => p.uvs?.length === 4)).toBe(true);
    s.undo();
    expect(s.mesh.polygons.every((p) => !('uvs' in p))).toBe(true);
    s.redo();
    expect(s.mesh.polygons[0]!.uvs).toHaveLength(4);
  });

  it('only touches the selected polygons', () => {
    const s = new ModelerState(box());
    s.setMode('polygons');
    s.applySelection([2], 'replace');
    applyAutoUv(s);
    expect(s.mesh.polygons.map((p) => !!p.uvs)).toEqual([false, false, true, false, false, false]);
  });

  it('is a no-op (and records nothing) when the UVs are already the projection', () => {
    const s = new ModelerState(box());
    applyAutoUv(s);
    const steps = s.history.revision;
    expect(applyAutoUv(s)).toBe(false);
    expect(s.history.revision).toBe(steps);
  });

  it("sizes the projection for the surface's texture", () => {
    const s = new ModelerState(box());
    s.images.push(createImage('Big', 128, 128));
    applyAutoUv(s);
    const at64 = s.mesh.polygons[0]!.uvs![1]![0] - s.mesh.polygons[0]!.uvs![0]![0];
    s.mesh.surfaces[0]!.texture = 'Big';
    applyAutoUv(s);
    const at128 = s.mesh.polygons[0]!.uvs![1]![0] - s.mesh.polygons[0]!.uvs![0]![0];
    expect(at128).toBeCloseTo(at64 / 2, 9);
  });

  it('does nothing on an empty layer', () => {
    expect(applyAutoUv(new ModelerState())).toBe(false);
  });
});

describe('project assets in state', () => {
  it('starts with a palette and two images, and loadLayers can replace or reset them', () => {
    const s = new ModelerState();
    expect(s.palette).toHaveLength(768);
    expect(s.images.map((i) => i.name)).toEqual(['Checker', 'UV Grid']);
    const palette = new Uint8Array(768).fill(7);
    s.loadLayers([], 0, { palette, images: [] });
    expect(s.palette).toBe(palette);
    expect(s.images).toEqual([]);
    s.loadLayers([], 0);
    expect(s.images).toHaveLength(2);
  });

  it('gives every new primitive UVs', async () => {
    const { createBall, createBox } = await import('./primitives');
    for (const m of [createBox({ size: [1, 1, 1], center: [0, 0, 0], segments: [2, 1, 1] }), createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 8, segments: 4, axis: 'y' })]) {
      expect(m.polygons.every((p) => p.uvs?.length === p.points.length)).toBe(true);
    }
    const m = box();
    assignAutoUvs(m);
    expect(m.polygons[0]!.uvs).toBeDefined();
  });
});
