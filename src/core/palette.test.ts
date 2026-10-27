import { describe, expect, it } from 'vitest';
import { buildPaletteLut, defaultPalette, nearestIndex, paletteColor, PALETTE_SIZE } from './palette';

describe('defaultPalette', () => {
  const p = defaultPalette();

  it('has 256 colours, 16 ramps of 16 shades from dark to light', () => {
    expect(p).toHaveLength(PALETTE_SIZE * 3);
    for (let ramp = 0; ramp < 16; ramp++) {
      const lum = (i: number) => paletteColor(p, ramp * 16 + i).reduce((a, b) => a + b, 0);
      for (let i = 1; i < 16; i++) expect(lum(i), `ramp ${ramp} shade ${i}`).toBeGreaterThanOrEqual(lum(i - 1));
      expect(lum(0)).toBeLessThan(lum(15));
    }
  });

  it('starts at black and the grey ramp ends at white', () => {
    expect(paletteColor(p, 0).every((c) => c < 25)).toBe(true);
    expect(paletteColor(p, 15).every((c) => c > 200)).toBe(true);
  });

  it('is a fresh copy each time, so editing one cannot change another', () => {
    const a = defaultPalette();
    a[0] = 99;
    expect(defaultPalette()[0]).not.toBe(99);
  });
});

describe('nearestIndex and the lookup table', () => {
  const p = defaultPalette();

  it('maps every palette colour to itself', () => {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const [r, g, b] = paletteColor(p, i);
      expect(paletteColor(p, nearestIndex(p, r, g, b))).toEqual([r, g, b]);
    }
  });

  it('builds a table whose cells hold their own nearest palette colour', () => {
    const size = 8;
    const lut = buildPaletteLut(p, size);
    expect(lut).toHaveLength(size ** 3 * 4);
    for (const [x, y, z] of [[0, 0, 0], [7, 7, 7], [3, 1, 6], [5, 5, 0]] as const) {
      const at = (i: number) => (i / (size - 1)) * 255;
      const expected = paletteColor(p, nearestIndex(p, at(x), at(y), at(z)));
      const o = (x + y * size + z * size * size) * 4;
      expect([lut[o], lut[o + 1], lut[o + 2]]).toEqual(expected);
      expect(lut[o + 3]).toBe(255);
    }
  });
});
