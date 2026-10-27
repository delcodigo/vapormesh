import { describe, expect, it } from 'vitest';
import { defaultPalette, paletteColor, type Palette } from '@/core';
import { box } from './primitives';
import { rampBetween, remapTable, setEntry, SetPaletteCommand } from './palette';
import { ModelerState } from './state';

describe('setEntry', () => {
  it('returns a copy with one colour changed, clamped to bytes', () => {
    const p = defaultPalette();
    const next = setEntry(p, 5, [300, -4, 12.6]);
    expect(paletteColor(next, 5)).toEqual([255, 0, 13]);
    expect(paletteColor(p, 5)).not.toEqual([255, 0, 13]); // the original is untouched
    expect(paletteColor(next, 6)).toEqual(paletteColor(p, 6));
  });
});

describe('rampBetween', () => {
  const base = () => {
    const p = new Uint8Array(768);
    p.set([0, 0, 0], 10 * 3);
    p.set([100, 200, 50], 14 * 3);
    return p;
  };

  it('blends the entries between two ends in a straight line and leaves the ends alone', () => {
    const next = rampBetween(base(), 10, 14);
    expect([11, 12, 13].map((i) => paletteColor(next, i))).toEqual([[25, 50, 13], [50, 100, 25], [75, 150, 38]]);
    expect(paletteColor(next, 10)).toEqual([0, 0, 0]);
    expect(paletteColor(next, 14)).toEqual([100, 200, 50]);
    expect(paletteColor(next, 15)).toEqual(paletteColor(base(), 15));
  });

  it('works whichever end was picked first, and does nothing for one or two adjacent entries', () => {
    expect(rampBetween(base(), 14, 10)).toEqual(rampBetween(base(), 10, 14));
    expect(rampBetween(base(), 12, 12)).toEqual(base());
    expect(rampBetween(base(), 10, 11)).toEqual(base());
  });
});

describe('remapTable', () => {
  it('maps each old colour to the nearest colour of the new palette', () => {
    const oldP = new Uint8Array(768);
    oldP.set([250, 10, 10], 0);
    oldP.set([10, 250, 10], 3);
    const newP = new Uint8Array(768);
    newP.set([255, 0, 0], 7 * 3);
    newP.set([0, 255, 0], 9 * 3);
    const table = remapTable(oldP, newP);
    expect(table[0]).toBe(7);
    expect(table[1]).toBe(9);
  });
});

describe('SetPaletteCommand', () => {
  const fresh = () => {
    const s = new ModelerState(box());
    s.mesh.surfaces[0]!.colorIndex = 25; // pink in the default palette
    return s;
  };
  const custom = (): Palette => setEntry(defaultPalette(), 25, [10, 220, 30]); // entry 25 turns green

  it('replaces the palette; images and surfaces keep their indices, so they take the new colour', () => {
    const s = fresh();
    const images = s.images;
    s.execute(new SetPaletteCommand(s, 'Edit Color', custom()));
    expect(paletteColor(s.palette, 25)).toEqual([10, 220, 30]);
    expect(s.mesh.surfaces[0]!.colorIndex).toBe(25);
    expect(s.images).toBe(images);

    s.undo();
    expect(paletteColor(s.palette, 25)).toEqual(paletteColor(defaultPalette(), 25));
    s.redo();
    expect(paletteColor(s.palette, 25)).toEqual([10, 220, 30]);
  });

  it('does not keep a reference to the array it was given', () => {
    const s = fresh();
    const mine = custom();
    s.execute(new SetPaletteCommand(s, 'x', mine));
    mine[75] = 1;
    expect(paletteColor(s.palette, 25)).toEqual([10, 220, 30]);
  });

  it('with remap, rewrites images and surface colours to the nearest new colour, and undo restores them all', () => {
    const s = fresh();
    // the new palette is the old one with the pink swapped for green AND pink moved to entry 200
    const next = setEntry(setEntry(defaultPalette(), 25, [10, 220, 30]), 200, [255, 113, 206]);
    const imagesBefore = s.images;
    const pixelsBefore = [...imagesBefore[0]!.pixels];
    s.execute(new SetPaletteCommand(s, 'Import Palette', next, { remap: true }));
    expect(s.mesh.surfaces[0]!.colorIndex).toBe(200); // still pink
    expect(s.images).not.toBe(imagesBefore);
    expect(s.images[0]!.name).toBe('Checker');

    s.undo();
    expect(s.mesh.surfaces[0]!.colorIndex).toBe(25);
    expect(s.images).toBe(imagesBefore);
    expect([...s.images[0]!.pixels]).toEqual(pixelsBefore);
    s.redo();
    expect(s.mesh.surfaces[0]!.colorIndex).toBe(200);
  });

  it('a remap that changes nothing visible still undoes cleanly', () => {
    const s = fresh();
    s.execute(new SetPaletteCommand(s, 'Same', defaultPalette(), { remap: true }));
    expect(s.mesh.surfaces[0]!.colorIndex).toBe(25);
    s.undo();
    expect(s.history.canUndo).toBe(false);
  });

  it('can take an explicit "before" for edits previewed live', () => {
    const s = fresh();
    const original = s.palette;
    s.palette = custom(); // the live preview already replaced it
    s.record(new SetPaletteCommand(s, 'Edit Color', custom(), { before: original }));
    s.undo();
    expect(s.palette).toBe(original);
  });

  it('refuses anything that is not 256 colours', () => {
    expect(() => new SetPaletteCommand(fresh(), 'x', new Uint8Array(30))).toThrow(RangeError);
  });
});
