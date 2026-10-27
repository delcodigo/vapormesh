import { describe, expect, it } from 'vitest';
import { createImage } from '@/core';
import { AddImageCommand, imageUsage, RemoveImageCommand, RenameImageCommand, uniqueImageName, validateImageName } from './images';
import { box } from './primitives';
import { ModelerState } from './state';

const stateWith = () => {
  const s = new ModelerState(box());
  s.mesh.surfaces[0]!.texture = 'Checker';
  return s;
};

describe('image names', () => {
  const s = new ModelerState();

  it('rejects empty, too long and duplicate names, but lets an image keep its own name', () => {
    expect(validateImageName(s.images, '   ')).toMatch(/name/);
    expect(validateImageName(s.images, 'x'.repeat(65))).toMatch(/at most/);
    expect(validateImageName(s.images, 'Checker')).toMatch(/already/);
    expect(validateImageName(s.images, 'Checker', s.images[0])).toBeNull();
    expect(validateImageName(s.images, ' Brick ')).toBeNull();
  });

  it('makes a name unique by numbering', () => {
    expect(uniqueImageName(s.images, 'Brick')).toBe('Brick');
    expect(uniqueImageName(s.images, 'Checker')).toBe('Checker 2');
    s.images.push(createImage('Checker 2', 8, 8));
    expect(uniqueImageName(s.images, 'Checker')).toBe('Checker 3');
    expect(uniqueImageName(s.images, '')).toBe('Image');
  });
});

describe('image commands', () => {
  it('adds an image and undo/redo take it out and put it back', () => {
    const s = new ModelerState();
    const img = createImage('Brick', 16, 16, 40);
    s.execute(new AddImageCommand(s, img));
    expect(s.images.map((i) => i.name)).toEqual(['Checker', 'UV Grid', 'Brick']);
    s.undo();
    expect(s.images.map((i) => i.name)).toEqual(['Checker', 'UV Grid']);
    s.redo();
    expect(s.images[2]).toBe(img);
  });

  it('deletes an image and undo restores it in its old position', () => {
    const s = new ModelerState();
    const [first, second] = s.images;
    s.execute(new RemoveImageCommand(s, first!));
    expect(s.images).toEqual([second]);
    s.undo();
    expect(s.images[0]).toBe(first);
    expect(s.images).toHaveLength(2);
  });

  it('leaves surfaces pointing at a deleted image so undo reconnects them', () => {
    const s = stateWith();
    expect(imageUsage(s, 'Checker')).toBe(1);
    s.execute(new RemoveImageCommand(s, s.images[0]!));
    expect(s.mesh.surfaces[0]!.texture).toBe('Checker');
    expect(s.images.some((i) => i.name === 'Checker')).toBe(false);
  });

  it('renames an image and every surface that uses it, across layers, and undoes both', () => {
    const s = stateWith();
    s.setActiveLayer(3);
    s.mesh.surfaces[0]!.texture = 'Checker';
    s.mesh.surfaces.push({ ...s.mesh.surfaces[0]!, name: 'Other', texture: 'UV Grid' });
    expect(imageUsage(s, 'Checker')).toBe(2);

    s.execute(new RenameImageCommand(s, s.images[0]!, ' Floor '));
    expect(s.images[0]!.name).toBe('Floor');
    expect(s.layers[0]!.surfaces[0]!.texture).toBe('Floor');
    expect(s.layers[3]!.surfaces[0]!.texture).toBe('Floor');
    expect(s.layers[3]!.surfaces[1]!.texture).toBe('UV Grid'); // untouched

    s.undo();
    expect(s.images[0]!.name).toBe('Checker');
    expect(s.layers[0]!.surfaces[0]!.texture).toBe('Checker');
    expect(s.layers[3]!.surfaces[0]!.texture).toBe('Checker');
    s.redo();
    expect(s.layers[3]!.surfaces[0]!.texture).toBe('Floor');
  });

  it('keeps the pixels and size when renaming, and does not touch the original object', () => {
    const s = new ModelerState();
    const original = s.images[1]!;
    s.execute(new RenameImageCommand(s, original, 'Grid'));
    expect(s.images[1]).not.toBe(original);
    expect(s.images[1]!.pixels).toBe(original.pixels);
    expect(original.name).toBe('UV Grid');
  });
});
