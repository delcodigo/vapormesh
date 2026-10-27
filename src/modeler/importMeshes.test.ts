import { describe, expect, it } from 'vitest';
import { box } from './primitives';
import { addMeshesToLayers } from './importMeshes';
import { ModelerState } from './state';
import { LAYER_COUNT } from './state';

const groups = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `g${i}`, mesh: box(1, 1, 1) }));

describe('addMeshesToLayers', () => {
  it('puts each group in its own empty layer, in order, as one undo step', () => {
    const s = new ModelerState();
    const placed = addMeshesToLayers(s, groups(3));
    expect(placed).toEqual({ layers: [0, 1, 2], merged: 0 });
    expect([0, 1, 2].map((i) => s.layers[i]!.polygons.length)).toEqual([6, 6, 6]);
    expect(s.activeLayer).toBe(0);
    s.undo();
    expect(s.layers.every((l) => l.points.length === 0)).toBe(true);
    expect(s.history.canUndo).toBe(false);
    s.redo();
    expect(s.layers[2]!.polygons).toHaveLength(6);
  });

  it('skips layers that are in use and leaves their content alone', () => {
    const s = new ModelerState(box(2, 2, 2)); // layer 0 is taken
    const before = s.layers[0]!.polygons.length;
    expect(addMeshesToLayers(s, groups(2)).layers).toEqual([1, 2]);
    expect(s.layers[0]!.polygons).toHaveLength(before);
    expect(s.activeLayer).toBe(1); // you land on what you imported
    s.undo();
    expect(s.activeLayer).toBe(0);
  });

  it('merges the extra groups into the last layer when there are not enough empty layers', () => {
    const s = new ModelerState();
    const placed = addMeshesToLayers(s, groups(LAYER_COUNT + 2));
    expect(placed.merged).toBe(2);
    expect(placed.layers).toHaveLength(LAYER_COUNT);
    expect(s.layers[LAYER_COUNT - 1]!.polygons).toHaveLength(18); // three groups
    s.undo();
    expect(s.layers.every((l) => l.points.length === 0)).toBe(true);
  });

  it('merges into the active layer when every layer is full', () => {
    const s = new ModelerState();
    s.layers.forEach((l) => l.append(box(1, 1, 1)));
    s.setActiveLayer(4);
    expect(addMeshesToLayers(s, groups(1))).toEqual({ layers: [4], merged: 1 });
    expect(s.layers[4]!.polygons).toHaveLength(12);
  });

  it('does nothing for no groups', () => {
    const s = new ModelerState();
    expect(addMeshesToLayers(s, [])).toEqual({ layers: [], merged: 0 });
    expect(s.history.canUndo).toBe(false);
  });

  it('keeps the imported surfaces as they are in an empty layer, instead of folding them into its default', () => {
    const s = new ModelerState();
    const mesh = box(1, 1, 1);
    Object.assign(mesh.surfaces[0]!, { name: 'Default', colorIndex: 99, smoothing: true, smoothingAngle: 40, doubleSided: true });
    addMeshesToLayers(s, [{ name: 'g', mesh }]);
    expect(s.layers[0]!.surfaces).toEqual(mesh.surfaces);
    expect(s.layers[0]!.surfaces).not.toBe(mesh.surfaces); // a copy: editing the layer must not change the import
    expect(s.layers[0]!.polygons.every((p) => p.surface === 0)).toBe(true);
    s.undo();
    expect(s.layers[0]!.surfaces).toHaveLength(1);
    expect(s.layers[0]!.surfaces[0]).toMatchObject({ name: 'Default', smoothing: false, colorIndex: 12 });
    expect(s.layers[0]!.points).toHaveLength(0);
    s.redo();
    expect(s.layers[0]!.surfaces[0]).toMatchObject({ smoothing: true, colorIndex: 99 });
  });

  it('still merges surfaces by name when the layer already has geometry', () => {
    const s = new ModelerState(box(1, 1, 1));
    const mesh = box(1, 1, 1);
    mesh.surfaces[0]!.name = 'Extra';
    s.layers.forEach((l, i) => i > 0 && l.append(box(1, 1, 1))); // no empty layer left, so it merges into the active one
    addMeshesToLayers(s, [{ name: 'g', mesh }]);
    expect(s.layers[0]!.surfaces.map((x) => x.name)).toEqual(['Default', 'Extra']);
    s.undo();
    expect(s.layers[0]!.surfaces.map((x) => x.name)).toEqual(['Default']);
  });
});
