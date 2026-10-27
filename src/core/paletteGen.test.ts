import { describe, expect, it } from 'vitest';
import { nearestIndex, paletteColor, PALETTE_SIZE } from './palette';
import { generatePalette } from './paletteGen';

const rgbOf = (colors: [number, number, number][]) => Uint8ClampedArray.from(colors.flat());
const colorsIn = (p: Uint8Array, n: number) => Array.from({ length: n }, (_, i) => paletteColor(p, i).join(','));

/** Average distance from each pixel to its nearest palette colour. */
function error(rgb: ArrayLike<number>, palette: Uint8Array): number {
  let sum = 0;
  const n = rgb.length / 3;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];
    const [pr, pg, pb] = paletteColor(palette, nearestIndex(palette, r, g, b));
    sum += Math.hypot(r - pr, g - pg, b - pb);
  }
  return sum / n;
}

describe('generatePalette', () => {
  it('keeps exactly the colours of a picture that has few', () => {
    const colors: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [10, 20, 30]];
    const { palette, distinct } = generatePalette(rgbOf([...colors, ...colors, colors[0]!]), 9, 1);
    expect(distinct).toBe(4);
    for (const c of colors) expect(colorsIn(palette, PALETTE_SIZE)).toContain(c.join(','));
  });

  it('keeps all 256 colours of a picture that has exactly 256, so nothing is lost', () => {
    const colors = Array.from({ length: 256 }, (_, i): [number, number, number] => [i, (i * 7) % 256, (i * 13) % 256]);
    const { palette, distinct } = generatePalette(rgbOf(colors), 256, 1);
    expect(distinct).toBe(256);
    const have = new Set(colorsIn(palette, 256));
    expect(colors.every((c) => have.has(c.join(',')))).toBe(true);
  });

  it('reduces thousands of colours to 256 that fit the picture far better than an unrelated palette', () => {
    const w = 128;
    const h = 64;
    const rgb = new Uint8ClampedArray(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set([(x * 2) % 256, 40 + y * 3, 255 - x * 2], (y * w + x) * 3);
    const { palette, distinct } = generatePalette(rgb, w, h);
    expect(distinct).toBeGreaterThan(256);
    const fitted = error(rgb, palette);
    const unrelated = new Uint8Array(PALETTE_SIZE * 3);
    for (let i = 0; i < PALETTE_SIZE; i++) unrelated.set([i, i, i], i * 3); // a plain grey scale
    expect(fitted).toBeLessThan(error(rgb, unrelated) / 4);
    expect(fitted).toBeLessThan(10);
  });

  it('is deterministic and sorts dark to light', () => {
    const rgb = Uint8ClampedArray.from({ length: 64 * 64 * 3 }, (_, i) => (i * 2654435761) >>> 24);
    const a = generatePalette(rgb, 64, 64).palette;
    expect(generatePalette(rgb, 64, 64).palette).toEqual(a);
    const lum = (i: number) => { const [r, g, b] = paletteColor(a, i); return 0.299 * r + 0.587 * g + 0.114 * b; };
    for (let i = 1; i < 256; i++) expect(lum(i)).toBeGreaterThanOrEqual(lum(i - 1) - 1e-9);
  });

  it('puts a few colours first, dark to light, and leaves the unused entries black', () => {
    const { palette } = generatePalette(rgbOf([[200, 100, 50], [10, 10, 10]]), 2, 1);
    expect(paletteColor(palette, 0)).toEqual([10, 10, 10]);
    expect(paletteColor(palette, 1)).toEqual([200, 100, 50]);
    expect(colorsIn(palette, PALETTE_SIZE).slice(2).every((c) => c === '0,0,0')).toBe(true);
  });
});
