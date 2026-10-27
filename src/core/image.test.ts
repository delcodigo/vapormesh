import { describe, expect, it } from 'vitest';
import { createImage, defaultImages, isValidImageSize } from './image';
import { PALETTE_SIZE } from './palette';

describe('images', () => {
  it('accepts only power-of-two sides from 8 to 256', () => {
    for (const n of [8, 16, 32, 64, 128, 256]) expect(isValidImageSize(n)).toBe(true);
    for (const n of [0, 4, 7, 12, 100, 512, 64.5, NaN]) expect(isValidImageSize(n)).toBe(false);
    expect(() => createImage('x', 100, 64)).toThrow(RangeError);
  });

  it('ships a checkerboard and a UV grid that use real palette indices', () => {
    const images = defaultImages();
    expect(images.map((i) => i.name)).toEqual(['Checker', 'UV Grid']);
    for (const img of images) {
      expect(img.pixels).toHaveLength(img.width * img.height);
      expect(Math.max(...img.pixels)).toBeLessThan(PALETTE_SIZE);
    }
  });

  it('marks the top-left cell of the UV grid so orientation is visible', () => {
    const grid = defaultImages()[1]!;
    expect(grid.pixels[5 * 64 + 5]).toBe(15); // white, inside the top-left cell
    expect(grid.pixels[5 * 64 + 40]).not.toBe(15);
  });
});
