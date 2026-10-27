import { describe, expect, it } from 'vitest';
import { defaultPalette, nearestIndex, paletteColor, PALETTE_SIZE } from './palette';
import { convertToIndexed, flattenAlpha, nearestValidSize, quantize, resample, type RgbaImage } from './quantize';

/** A palette that is all black except index 1, which is white. */
const blackAndWhite = () => {
  const p = new Uint8Array(PALETTE_SIZE * 3);
  p.fill(255, 3, 6);
  return p;
};
const flat = (w: number, h: number, v: number) => new Uint8ClampedArray(w * h * 3).fill(v);
const whiteShare = (idx: Uint8Array) => idx.filter((i) => i === 1).length / idx.length;
const rgba = (w: number, h: number, px: number[]): RgbaImage => ({ width: w, height: h, data: new Uint8ClampedArray(px) });

describe('nearestValidSize', () => {
  it('snaps to the closest power of two on a log scale, within 8..256', () => {
    expect(nearestValidSize(64)).toBe(64);
    expect(nearestValidSize(60)).toBe(64);
    expect(nearestValidSize(100)).toBe(128);
    expect(nearestValidSize(90)).toBe(64);
    expect(nearestValidSize(3)).toBe(8);
    expect(nearestValidSize(5000)).toBe(256);
  });
});

describe('flattenAlpha', () => {
  it('lays transparency over the background and keeps opaque pixels', () => {
    const out = flattenAlpha(rgba(2, 1, [200, 100, 50, 255, 200, 100, 50, 0]));
    expect([...out]).toEqual([200, 100, 50, 0, 0, 0]);
  });

  it('blends partial alpha', () => {
    const out = flattenAlpha(rgba(1, 1, [200, 200, 200, 128]), [0, 0, 100]);
    expect(out[0]).toBeCloseTo(100, 0);
    expect(out[2]).toBeCloseTo(150, 0);
  });
});

describe('resample', () => {
  const src = Uint8ClampedArray.from([0, 0, 0, 100, 100, 100, 200, 200, 200, 40, 40, 40]); // 2x2

  it('averages what a smaller pixel covers', () => {
    expect([...resample(src, 2, 2, 1, 1, 'average')]).toEqual([85, 85, 85]); // (0+100+200+40)/4
  });

  it('nearest takes a single source pixel and enlarging repeats pixels', () => {
    expect([...resample(src, 2, 2, 1, 1, 'nearest')]).toEqual([0, 0, 0]);
    const big = resample(src, 2, 2, 4, 4, 'average');
    expect([...big.slice(0, 6)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(big).toHaveLength(48);
  });

  it('copes with sizes that do not divide evenly', () => {
    const out = resample(flat(5, 3, 90), 5, 3, 2, 2, 'average');
    expect([...out].every((v) => v === 90)).toBe(true);
  });
});

describe('quantize', () => {
  const palette = defaultPalette();

  it.each(['nearest', 'ordered', 'diffusion'] as const)('maps exact palette colours to themselves (%s)', (match) => {
    const picks = [0, 17, 100, 255, 130, 64, 33, 200, 5, 90, 150, 220, 12, 77, 140, 240]; // 4x4
    const rgb = Uint8ClampedArray.from(picks.flatMap((i) => paletteColor(palette, i)));
    const idx = quantize(rgb, 4, 4, palette, match);
    // dithering may not preserve the index when two entries share a colour, but the colour must be the same
    idx.forEach((v, k) => expect(paletteColor(palette, v)).toEqual(paletteColor(palette, picks[k]!)));
  });

  it('nearest turns a flat mid grey into one single colour', () => {
    const idx = quantize(flat(16, 16, 140), 16, 16, blackAndWhite(), 'nearest');
    expect(new Set(idx).size).toBe(1);
  });

  it.each(['ordered', 'diffusion'] as const)('%s dither mixes two colours to approximate a colour between them', (match) => {
    const idx = quantize(flat(32, 32, 128), 32, 32, blackAndWhite(), match);
    const share = whiteShare(idx);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.65);
  });

  it('error diffusion keeps the average of a colour that lies between palette entries; snapping loses it', () => {
    const idx = (match: 'nearest' | 'diffusion') => quantize(flat(32, 32, 100), 32, 32, blackAndWhite(), match);
    const mean = (i: Uint8Array) => (whiteShare(i) * 255);
    expect(mean(idx('nearest'))).toBe(0); // 100 is nearer black, so everything goes black
    expect(Math.abs(mean(idx('diffusion')) - 100)).toBeLessThan(5);
  });

  it('ordered dither leaves pixels that are already palette colours alone, even among dithered ones', () => {
    // palette greys: index 0 = black, index 1 = white; a row of pure white next to a row of mid grey
    const rgb = new Uint8ClampedArray(8 * 2 * 3);
    rgb.fill(255, 0, 24); // first row white
    rgb.fill(128, 24, 48); // second row mid grey
    const idx = quantize(rgb, 8, 2, blackAndWhite(), 'ordered');
    expect([...idx.slice(0, 8)].every((i) => i === 1)).toBe(true);
    expect(new Set(idx.slice(8)).size).toBe(2); // the grey row is dithered
  });

  it('always returns valid palette indices', () => {
    const noisy = Uint8ClampedArray.from({ length: 16 * 16 * 3 }, (_, i) => (i * 97) % 256);
    for (const m of ['nearest', 'ordered', 'diffusion'] as const) {
      expect(Math.max(...quantize(noisy, 16, 16, palette, m))).toBeLessThan(PALETTE_SIZE);
    }
  });

  it('agrees with nearestIndex for a single pixel', () => {
    const idx = quantize(Uint8ClampedArray.from([200, 30, 90]), 1, 1, palette, 'nearest');
    expect(idx[0]).toBe(nearestIndex(palette, 200, 30, 90));
  });
});

describe('convertToIndexed', () => {
  const palette = defaultPalette();

  it('resizes to the requested valid size and names the image', () => {
    const src = rgba(3, 3, Array.from({ length: 9 }, () => [255, 255, 255, 255]).flat());
    const img = convertToIndexed(src, { name: 'White', width: 8, height: 16, palette, resample: 'average', match: 'nearest' });
    expect(img).toMatchObject({ name: 'White', width: 8, height: 16 });
    expect(img.pixels).toHaveLength(8 * 16);
    expect(new Set(img.pixels).size).toBe(1);
    expect(paletteColor(palette, img.pixels[0]!).every((c) => c > 200)).toBe(true);
  });

  it('refuses sizes a texture cannot have', () => {
    const src = rgba(1, 1, [0, 0, 0, 255]);
    expect(() => convertToIndexed(src, { name: 'x', width: 100, height: 64, palette, resample: 'nearest', match: 'nearest' })).toThrow(RangeError);
  });

  it('keeps a picture of the right size exactly as it is', () => {
    const picks = Array.from({ length: 64 }, (_, i) => i * 4);
    const px = picks.flatMap((i) => [...paletteColor(palette, i), 255]);
    const img = convertToIndexed(rgba(8, 8, px), { name: 'Art', width: 8, height: 8, palette, resample: 'nearest', match: 'nearest' });
    img.pixels.forEach((v, k) => expect(paletteColor(palette, v)).toEqual(paletteColor(palette, picks[k]!)));
  });
});
