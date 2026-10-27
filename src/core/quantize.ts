import { MAX_IMAGE_SIZE, MIN_IMAGE_SIZE, isValidImageSize, type IndexedImage } from './image';
import { nearestIndex, type Palette } from './palette';

/** A decoded picture: 4 bytes per pixel (r, g, b, a), row 0 at the top. */
export interface RgbaImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** How to change size: pick the nearest source pixel, or average everything a new pixel covers. */
export type ResampleMethod = 'nearest' | 'average';
/** How to match colours to the palette: snap to the nearest, or dither (ordered pattern, or error diffusion). Colours already in the palette are never changed. */
export type ColorMatch = 'nearest' | 'ordered' | 'diffusion';

/** The 4x4 Bayer matrix the render pass uses too (see retroPass.ts), so imported dither matches the live look. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** How far ordered dither pushes a colour before snapping, in 0..255 units (the render pass uses 0.16 of the range). */
const ORDERED_SPREAD = 0.16 * 255;

/** The valid texture side closest to `n` on a log scale (so 90 becomes 64, 100 becomes 128). */
export function nearestValidSize(n: number): number {
  const exponent = Math.round(Math.log2(Math.min(Math.max(n, MIN_IMAGE_SIZE), MAX_IMAGE_SIZE)));
  return 2 ** exponent;
}

/** Drop the alpha channel by laying the picture over a solid background (there is no transparency yet). */
export function flattenAlpha(src: RgbaImage, background: [number, number, number] = [0, 0, 0]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.width * src.height * 3);
  for (let i = 0; i < src.width * src.height; i++) {
    const a = src.data[i * 4 + 3]! / 255;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = src.data[i * 4 + k]! * a + background[k]! * (1 - a);
  }
  return out;
}

/** Resize packed RGB. Averaging gives cleaner results than nearest when shrinking; both are the same when enlarging. */
export function resample(rgb: ArrayLike<number>, w: number, h: number, nw: number, nh: number, method: ResampleMethod): Uint8ClampedArray {
  const out = new Uint8ClampedArray(nw * nh * 3);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw);
      const y0 = Math.floor((y * h) / nh);
      const x1 = method === 'nearest' ? x0 + 1 : Math.max(x0 + 1, Math.ceil(((x + 1) * w) / nw));
      const y1 = method === 'nearest' ? y0 + 1 : Math.max(y0 + 1, Math.ceil(((y + 1) * h) / nh));
      const sum = [0, 0, 0];
      let n = 0;
      for (let sy = y0; sy < Math.min(y1, h); sy++) {
        for (let sx = x0; sx < Math.min(x1, w); sx++) {
          for (let k = 0; k < 3; k++) sum[k]! += rgb[(sy * w + sx) * 3 + k]!;
          n++;
        }
      }
      for (let k = 0; k < 3; k++) out[(y * nw + x) * 3 + k] = sum[k]! / n;
    }
  }
  return out;
}

/** Palette index for every pixel of packed RGB. */
export function quantize(rgb: ArrayLike<number>, w: number, h: number, palette: Palette, match: ColorMatch): Uint8Array {
  const out = new Uint8Array(w * h);
  const clamp = (v: number) => Math.min(Math.max(v, 0), 255);

  if (match === 'diffusion') {
    // Floyd-Steinberg: each pixel's rounding error is passed on to its unvisited neighbours.
    const work = Float32Array.from({ length: w * h * 3 }, (_, i) => rgb[i]!);
    const spread = (x: number, y: number, err: number[], weight: number) => {
      if (x < 0 || x >= w || y >= h) return;
      for (let k = 0; k < 3; k++) work[(y * w + x) * 3 + k]! += err[k]! * weight;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 3;
        const [r, g, b] = [clamp(work[o]!), clamp(work[o + 1]!), clamp(work[o + 2]!)];
        const index = nearestIndex(palette, r, g, b);
        out[y * w + x] = index;
        const err = [r - palette[index * 3]!, g - palette[index * 3 + 1]!, b - palette[index * 3 + 2]!];
        spread(x + 1, y, err, 7 / 16);
        spread(x - 1, y + 1, err, 3 / 16);
        spread(x, y + 1, err, 5 / 16);
        spread(x + 1, y + 1, err, 1 / 16);
      }
    }
    return out;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const [r, g, b] = [rgb[o]!, rgb[o + 1]!, rgb[o + 2]!];
      const exact = nearestIndex(palette, r, g, b);
      // A colour that is already in the palette is kept as it is: dithering art that is already indexed would only add noise.
      const isExact = palette[exact * 3] === r && palette[exact * 3 + 1] === g && palette[exact * 3 + 2] === b;
      const nudge = match === 'ordered' && !isExact ? ((BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 - 0.5) * ORDERED_SPREAD : 0;
      out[y * w + x] = nudge === 0 ? exact : nearestIndex(palette, clamp(r + nudge), clamp(g + nudge), clamp(b + nudge));
    }
  }
  return out;
}

export interface ConvertOptions {
  name: string;
  /** Output size; each side must be a valid texture size. */
  width: number;
  height: number;
  palette: Palette;
  resample: ResampleMethod;
  match: ColorMatch;
}

/** A decoded picture to an indexed image in the project palette: flatten alpha, resize, then match colours. */
export function convertToIndexed(src: RgbaImage, o: ConvertOptions): IndexedImage {
  if (!isValidImageSize(o.width) || !isValidImageSize(o.height)) {
    throw new RangeError(`Image sides must be powers of two from ${MIN_IMAGE_SIZE} to ${MAX_IMAGE_SIZE}`);
  }
  let rgb: ArrayLike<number> = flattenAlpha(src);
  if (src.width !== o.width || src.height !== o.height) rgb = resample(rgb, src.width, src.height, o.width, o.height, o.resample);
  return { name: o.name, width: o.width, height: o.height, pixels: quantize(rgb, o.width, o.height, o.palette, o.match) };
}
