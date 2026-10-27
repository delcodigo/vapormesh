import { PALETTE_SIZE, type Palette } from './palette';

interface Bucket {
  /** Distinct colours in the bucket, packed 0xRRGGBB, with how many pixels had each. */
  colors: number[];
  counts: number[];
}

const channel = (c: number, k: number) => (c >> (16 - 8 * k)) & 255;
const MAX_SAMPLES = 262144;

/**
 * Build a 256-colour palette that represents a picture (packed RGB, 3 bytes per pixel) by median cut: repeatedly split
 * the most populated group of colours along its widest channel, then average each group. A picture that already has
 * 256 colours or fewer keeps exactly those colours. The result is sorted dark to light.
 */
export function generatePalette(rgb: ArrayLike<number>, width: number, height: number): { palette: Palette; distinct: number } {
  const pixels = width * height;
  const step = Math.max(1, Math.ceil(pixels / MAX_SAMPLES));
  const histogram = new Map<number, number>();
  for (let i = 0; i < pixels; i += step) {
    const key = (rgb[i * 3]! << 16) | (rgb[i * 3 + 1]! << 8) | rgb[i * 3 + 2]!;
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const distinct = histogram.size;

  let representatives: number[];
  if (distinct <= PALETTE_SIZE) {
    representatives = [...histogram.keys()];
  } else {
    const first: Bucket = { colors: [...histogram.keys()], counts: [...histogram.values()] };
    const buckets = [first];
    while (buckets.length < PALETTE_SIZE) {
      // the most populated bucket that still has more than one colour
      let target = -1;
      let most = 0;
      buckets.forEach((b, i) => {
        const total = b.counts.reduce((s, n) => s + n, 0);
        if (b.colors.length > 1 && total > most) {
          most = total;
          target = i;
        }
      });
      if (target < 0) break;
      const [a, b] = split(buckets[target]!);
      buckets.splice(target, 1, a, b);
    }
    representatives = buckets.map(average);
  }

  const luminance = (c: number) => 0.299 * channel(c, 0) + 0.587 * channel(c, 1) + 0.114 * channel(c, 2);
  representatives.sort((x, y) => luminance(x) - luminance(y) || x - y);
  const palette = new Uint8Array(PALETTE_SIZE * 3);
  representatives.forEach((c, i) => palette.set([channel(c, 0), channel(c, 1), channel(c, 2)], i * 3));
  return { palette, distinct };
}

/** Cut a bucket in two at the weighted median of its widest channel. */
function split(bucket: Bucket): [Bucket, Bucket] {
  const range = [0, 1, 2].map((k) => {
    const values = bucket.colors.map((c) => channel(c, k));
    return Math.max(...values) - Math.min(...values);
  });
  const k = range.indexOf(Math.max(...range));
  const order = bucket.colors.map((_, i) => i).sort((i, j) => channel(bucket.colors[i]!, k) - channel(bucket.colors[j]!, k));
  const total = bucket.counts.reduce((s, n) => s + n, 0);
  let seen = 0;
  let cut = 1;
  for (let n = 0; n < order.length - 1; n++) {
    seen += bucket.counts[order[n]!]!;
    cut = n + 1;
    if (seen >= total / 2) break;
  }
  const take = (ids: number[]): Bucket => ({ colors: ids.map((i) => bucket.colors[i]!), counts: ids.map((i) => bucket.counts[i]!) });
  return [take(order.slice(0, cut)), take(order.slice(cut))];
}

function average(bucket: Bucket): number {
  const total = bucket.counts.reduce((s, n) => s + n, 0);
  const mean = [0, 1, 2].map((k) => Math.round(bucket.colors.reduce((s, c, i) => s + channel(c, k) * bucket.counts[i]!, 0) / total));
  return (mean[0]! << 16) | (mean[1]! << 8) | mean[2]!;
}
