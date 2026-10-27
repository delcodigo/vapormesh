import { nearestIndex, paletteColor, PALETTE_SIZE, type IndexedImage, type Palette } from '@/core';
import type { Command } from './history';
import type { ModelerState } from './state';

/** A copy of the palette with one entry changed. */
export function setEntry(palette: Palette, index: number, rgb: [number, number, number]): Palette {
  const next = new Uint8Array(palette);
  next.set(rgb.map((c) => Math.min(Math.max(Math.round(c), 0), 255)), index * 3);
  return next;
}

/** A copy of the palette with the entries between `from` and `to` blended in a straight line between those two colours. */
export function rampBetween(palette: Palette, from: number, to: number): Palette {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const next = new Uint8Array(palette);
  const [a, b] = [paletteColor(palette, lo), paletteColor(palette, hi)];
  for (let i = lo + 1; i < hi; i++) {
    const t = (i - lo) / (hi - lo);
    for (let k = 0; k < 3; k++) next[i * 3 + k] = Math.round(a[k]! + (b[k]! - a[k]!) * t);
  }
  return next;
}

/** For each index of the old palette, the index of the nearest colour in the new one. */
export function remapTable(oldPalette: Palette, newPalette: Palette): Uint8Array {
  const table = new Uint8Array(PALETTE_SIZE);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const [r, g, b] = paletteColor(oldPalette, i);
    table[i] = nearestIndex(newPalette, r, g, b);
  }
  return table;
}

export interface PaletteChangeOptions {
  /**
   * Also rewrite every image's pixels and every surface's colour index through the nearest-colour table, so existing
   * work keeps its look. Without it, indices stay put and the art takes on the new colours (recolours).
   */
  remap?: boolean;
  /** The palette being replaced. Defaults to the current one; pass it when an interactive edit has already changed it. */
  before?: Palette;
}

/**
 * Replace the project palette. Because images and surfaces store palette indices, everything that uses a changed entry
 * updates at once. With `remap`, the images and surface colours are rewritten too, and undo puts all of it back.
 */
export class SetPaletteCommand implements Command {
  readonly projectWide = true;
  private before: Palette;
  private after: Palette;
  private remapped: { before: IndexedImage[]; after: IndexedImage[]; surfaces: [layer: number, surface: number, from: number, to: number][] } | null = null;

  constructor(
    private state: ModelerState,
    readonly label: string,
    after: Palette,
    options: PaletteChangeOptions = {},
  ) {
    if (after.length !== PALETTE_SIZE * 3) throw new RangeError(`A palette has ${PALETTE_SIZE * 3} bytes`);
    this.before = options.before ?? state.palette;
    this.after = new Uint8Array(after);
    if (options.remap) {
      const table = remapTable(this.before, this.after);
      const surfaces: [number, number, number, number][] = [];
      state.layers.forEach((layer, li) =>
        layer.surfaces.forEach((s, si) => {
          if (table[s.colorIndex] !== s.colorIndex) surfaces.push([li, si, s.colorIndex, table[s.colorIndex]!]);
        }),
      );
      this.remapped = {
        before: state.images,
        after: state.images.map((image) => ({ ...image, pixels: image.pixels.map((i) => table[i]!) })),
        surfaces,
      };
    }
  }

  redo(): void {
    this.state.palette = this.after;
    if (this.remapped) {
      this.state.images = this.remapped.after;
      this.setSurfaces(3);
    }
  }

  undo(): void {
    this.state.palette = this.before;
    if (this.remapped) {
      this.state.images = this.remapped.before;
      this.setSurfaces(2);
    }
  }

  /** Surface colours by position (panels replace surface objects, so identity can't be kept). */
  private setSurfaces(which: 2 | 3): void {
    for (const entry of this.remapped!.surfaces) {
      const surface = this.state.layers[entry[0]]?.surfaces[entry[1]];
      if (surface) surface.colorIndex = entry[which];
    }
  }
}
