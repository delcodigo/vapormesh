import { paletteColor, PALETTE_SIZE, type Palette } from '@/core';

const COLUMNS = 16;

/** Draw the palette as a 16x16 grid of `cell`-pixel swatches, optionally outlining one entry. */
export function paintPalette(canvas: HTMLCanvasElement, palette: Palette, cell: number, selected?: number): void {
  canvas.width = canvas.height = COLUMNS * cell;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const [r, g, b] = paletteColor(palette, i);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect((i % COLUMNS) * cell, Math.floor(i / COLUMNS) * cell, cell, cell);
  }
  if (selected !== undefined) {
    const x = (selected % COLUMNS) * cell;
    const y = Math.floor(selected / COLUMNS) * cell;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(x + 2.5, y + 2.5, cell - 5, cell - 5);
  }
}

/** The palette index under a pointer position on a canvas drawn by `paintPalette`. */
export function paletteIndexAt(canvas: HTMLCanvasElement, clientX: number, clientY: number): number {
  const box = canvas.getBoundingClientRect();
  const col = Math.min(Math.max(Math.floor(((clientX - box.left) / box.width) * COLUMNS), 0), COLUMNS - 1);
  const row = Math.min(Math.max(Math.floor(((clientY - box.top) / box.height) * COLUMNS), 0), COLUMNS - 1);
  return row * COLUMNS + col;
}
