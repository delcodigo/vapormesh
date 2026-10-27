import { describe, expect, it } from 'vitest';
import {
  AddPrimitiveCommand,
  createPrimitive,
  defaultValues,
  isValidField,
  PRIMITIVES,
} from './create';
import { box } from './primitives';
import { LAYER_COUNT, ModelerState } from './state';

describe('Mesh.append / truncate', () => {
  it('offsets indices, reuses surfaces by name and cuts back cleanly', () => {
    const a = box();
    const b = box();
    b.surfaces = [{ ...b.surfaces[0]!, name: 'Glass' }];
    const before = a.size();
    a.append(b);
    expect(a.points).toHaveLength(16);
    expect(a.polygons[6]!.points).toEqual([8, 9, 11, 10]);
    expect(a.surfaces.map((s) => s.name)).toEqual(['Default', 'Glass']);
    expect(a.polygons[6]!.surface).toBe(1);

    const again = box();
    a.append(again); // 'Default' already exists: no new surface
    expect(a.surfaces).toHaveLength(2);

    a.truncate(before);
    expect(a.size()).toEqual(before);
  });
});

describe('createPrimitive', () => {
  const ball = () => defaultValues('ball');

  it('merges into the active layer, then undo/redo restores and re-applies it', () => {
    const s = new ModelerState(box());
    const baseline = s.mesh.size();
    expect(createPrimitive(s, 'ball', ball(), 'merge')).toBe(0);
    expect(s.mesh.points.length).toBeGreaterThan(baseline.points);
    const merged = s.mesh.size();

    s.undo();
    expect(s.mesh.size()).toEqual(baseline);
    s.redo();
    expect(s.mesh.size()).toEqual(merged);
  });

  it('puts a new-layer create in the first empty layer, switches to it, and undo switches back', () => {
    const s = new ModelerState(box());
    expect(createPrimitive(s, 'cone', defaultValues('cone'), 'layer')).toBe(1);
    expect(s.activeLayer).toBe(1);
    expect(s.layers[0]!.points).toHaveLength(8); // untouched
    expect(s.layers[1]!.points.length).toBeGreaterThan(0);

    s.undo();
    expect(s.activeLayer).toBe(0);
    expect(s.layers[1]!.points).toHaveLength(0);
    s.redo();
    expect(s.activeLayer).toBe(1);
    expect(s.layers[1]!.points.length).toBeGreaterThan(0);
  });

  it('falls back to merging when every layer is in use', () => {
    const s = new ModelerState(box());
    s.layers.forEach((l, i) => i > 0 && l.append(box()));
    expect(s.firstEmptyLayer()).toBeNull();
    expect(createPrimitive(s, 'ball', ball(), 'layer')).toBe(0);
    expect(s.layers).toHaveLength(LAYER_COUNT);
  });

  it('drops selected ids that vanish when a create is undone', () => {
    const s = new ModelerState(box());
    createPrimitive(s, 'ball', ball(), 'merge');
    s.applySelection([0, s.mesh.points.length - 1], 'replace');
    s.undo();
    expect([...s.selection]).toEqual([0]);
  });

  it('keeps selection and history per use: switching layers clears selection only', () => {
    const s = new ModelerState(box());
    s.applySelection([1, 2], 'replace');
    s.setActiveLayer(3);
    expect(s.selection.size).toBe(0);
    s.setActiveLayer(0);
    expect(s.mesh.points).toHaveLength(8);
  });

  it('AddPrimitiveCommand builds its mesh once, so redo is repeatable', () => {
    const s = new ModelerState();
    const cmd = new AddPrimitiveCommand(s, PRIMITIVES.box.build(defaultValues('box')), 0, 'Create Box');
    s.execute(cmd);
    s.undo();
    s.redo();
    s.undo();
    s.redo();
    expect(s.mesh.points).toHaveLength(8);
  });
});

describe('field validation', () => {
  const field = (name: 'ball' | 'box', key: string) => PRIMITIVES[name].fields.find((f) => f.key === key)!;

  it('rejects non-positive sizes, fractional or too-small counts and NaN', () => {
    expect(isValidField(field('box', 'size'), [1, 2, 3])).toBe(true);
    expect(isValidField(field('box', 'size'), [1, 0, 3])).toBe(false);
    expect(isValidField(field('box', 'size'), [1, -1, 3])).toBe(false);
    expect(isValidField(field('box', 'center'), [-5, 0, 2])).toBe(true);
    expect(isValidField(field('box', 'segments'), [1, 1.5, 1])).toBe(false);
    expect(isValidField(field('ball', 'sides'), [2])).toBe(false); // min 3
    expect(isValidField(field('ball', 'sides'), [3])).toBe(true);
    expect(isValidField(field('ball', 'radius'), [NaN, 1, 1])).toBe(false);
    expect(isValidField(field('ball', 'axis'), [3])).toBe(false);
  });
});
