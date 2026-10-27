/** An indexed-colour image: one palette index per pixel, row 0 at the top. Treat as immutable: replace, don't edit. */
export interface IndexedImage {
  /** Unique within a project; surfaces refer to images by name. */
  name: string;
  width: number;
  height: number;
  pixels: Uint8Array;
}

export const MIN_IMAGE_SIZE = 8;
export const MAX_IMAGE_SIZE = 256;

/** Texture sides are powers of two from 8 to 256. */
export function isValidImageSize(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_IMAGE_SIZE && n <= MAX_IMAGE_SIZE && (n & (n - 1)) === 0;
}

export function createImage(name: string, width: number, height: number, fill = 0): IndexedImage {
  if (!isValidImageSize(width) || !isValidImageSize(height)) {
    throw new RangeError(`Image sides must be powers of two from ${MIN_IMAGE_SIZE} to ${MAX_IMAGE_SIZE}`);
  }
  return { name, width, height, pixels: new Uint8Array(width * height).fill(fill) };
}

/** Palette index for ramp (0..15) and shade (0..15) of the default palette. */
const shade = (ramp: number, level: number) => ramp * 16 + level;

/** Two small images every new project starts with: a checkerboard, and a UV grid whose white cell is top-left. */
export function defaultImages(): IndexedImage[] {
  const checker = createImage('Checker', 64, 64);
  const grid = createImage('UV Grid', 64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      checker.pixels[y * 64 + x] = shade(0, ((x >> 3) + (y >> 3)) % 2 ? 12 : 5);
      const cx = x >> 4;
      const cy = y >> 4;
      const edge = x % 16 === 0 || y % 16 === 0;
      grid.pixels[y * 64 + x] = edge ? shade(0, 2) : cx === 0 && cy === 0 ? shade(0, 15) : shade(1 + ((cy * 4 + cx) % 15), 9);
    }
  }
  return [checker, grid];
}
