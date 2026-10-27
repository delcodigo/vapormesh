/** A palette is 256 RGB triples, flat: [r0, g0, b0, r1, g1, b1, ...], bytes 0..255. Treat as immutable: replace, don't edit. */
export type Palette = Uint8Array;
export const PALETTE_SIZE = 256;

export function paletteColor(p: Palette, index: number): [number, number, number] {
  return [p[index * 3]!, p[index * 3 + 1]!, p[index * 3 + 2]!];
}

// Sixteen ramps of sixteen shades, dark to light, so lighting a texture walks up and down a ramp.
// Ramp 0 is a straight grey scale from true black to true white; the others run from a dark tint, through the hue, to a pale tint.
const RAMP_BASES = [
  0x909090, // grey: unused, ramp 0 is a straight black-to-white scale
  0xff71ce, // pink
  0x01cdfe, // cyan
  0x05ffa1, // mint
  0xb967ff, // purple
  0xfffb96, // cream
  0xe5383b, // red
  0xff9f1c, // orange
  0x3ddc84, // green
  0x3a6df0, // blue
  0x1b9aaa, // teal
  0xd62ed6, // magenta
  0x9c6644, // brown
  0xf2c6a0, // skin
  0x4b3fa0, // indigo
  0x7d8aa6, // slate
];

/** The default vaporwave palette: 16 hues x 16 shades, so `ramp * 16 + shade` indexes it. */
export function defaultPalette(): Palette {
  const out = new Uint8Array(PALETTE_SIZE * 3);
  RAMP_BASES.forEach((base, ramp) => {
    const c = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
    for (let shade = 0; shade < 16; shade++) {
      const t = shade / 15;
      if (ramp === 0) {
        out.fill(Math.round(t * 255), (ramp * 16 + shade) * 3, (ramp * 16 + shade) * 3 + 3);
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const dark = c[k]! * 0.08;
        const value = t < 0.6 ? dark + (c[k]! - dark) * (t / 0.6) : c[k]! + (255 - c[k]!) * 0.85 * ((t - 0.6) / 0.4);
        out[(ramp * 16 + shade) * 3 + k] = Math.round(Math.min(Math.max(value, 0), 255));
      }
    }
  });
  return out;
}

/** A palette entry as 0..1 floats, for shaders. */
export function paletteColor01(p: Palette, index: number): [number, number, number] {
  const [r, g, b] = paletteColor(p, index);
  return [r / 255, g / 255, b / 255];
}

/** Index of the palette entry closest to an RGB colour (0..255 per channel). */
export function nearestIndex(p: Palette, r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const dr = p[i * 3]! - r;
    const dg = p[i * 3 + 1]! - g;
    const db = p[i * 3 + 2]! - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * A size^3 lookup from any RGB colour to its nearest palette colour, as RGBA bytes with red varying fastest.
 * Cell i along an axis stands for the colour i / (size - 1), so the GPU can look colours up directly.
 */
export function buildPaletteLut(p: Palette, size = 32): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  const at = (i: number) => (i / (size - 1)) * 255;
  let o = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = nearestIndex(p, at(x), at(y), at(z)) * 3;
        out[o++] = p[n]!;
        out[o++] = p[n + 1]!;
        out[o++] = p[n + 2]!;
        out[o++] = 255;
      }
    }
  }
  return out;
}
