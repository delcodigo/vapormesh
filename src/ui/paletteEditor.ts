import {
  flattenAlpha,
  generatePalette,
  paletteColor,
  PaletteFormatError,
  parsePaletteFile,
  writeAct,
  writeGpl,
  type Palette,
} from '@/core';
import { rampBetween, setEntry, SetPaletteCommand, type ModelerState } from '@/modeler';
import { downloadBlob } from './download';
import { makeDraggable } from './draggable';
import { decodeImageFile } from './imagesPanel';
import { paintPalette, paletteIndexAt } from './paletteView';

const CELL = 14;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const hex = (rgb: number[]) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
const sameBytes = (a: Palette, b: Palette) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface PaletteEditor {
  toggle(): void;
  isOpen(): boolean;
}

/**
 * Edits the project palette. Click an entry to edit its colour; shift-click or drag to select a range and blend it with
 * Ramp. Import and export GIMP (.gpl) and Adobe (.act) palettes, or build one from a picture. Everything that uses a
 * changed entry updates at once, and every change is one undo step.
 */
export function createPaletteEditor(state: ModelerState, host: HTMLElement, onToggle: () => void): PaletteEditor {
  const el = document.createElement('div');
  el.className = 'numeric palette-editor';
  el.hidden = true;
  const channel = (name: string, label: string) =>
    `<div class="slider-row"><span class="name">${label}</span><input type="range" min="0" max="255" step="1" data-f="${name}"><output data-o="${name}"></output></div>`;
  el.innerHTML = `
    <div class="numeric-title"><span>Palette</span><button data-act="close" title="Close">×</button></div>
    <canvas class="palette pick" tabindex="0" title="Click an entry. Shift-click or drag for a range. Arrow keys move."></canvas>
    <div class="pal-info"></div>
    ${channel('r', 'Red')}${channel('g', 'Green')}${channel('b', 'Blue')}
    <div class="numeric-row"><input type="text" data-f="hex" placeholder="#rrggbb" spellcheck="false"><button data-act="ramp" title="Blend the entries between the two ends of the selected range">Ramp</button></div>
    <div class="hint">Shift-click or drag selects a range; Ramp blends between its ends.</div>
    <div class="numeric-heading"><span>Whole palette</span></div>
    <div class="numeric-actions"><button data-act="import">Import…</button><button data-act="fromImage" title="Build a 256-colour palette from a picture">From image…</button></div>
    <label class="choice" title="Rewrite existing images and surface colours to the nearest new colour, instead of letting them take on the new colours"><input type="checkbox" data-f="remap"> Keep the look of existing art</label>
    <div class="numeric-actions"><button data-act="exportGpl">Export .gpl</button><button data-act="exportAct">Export .act</button></div>
    <div class="msg" role="status"></div>
    <input type="file" accept=".gpl,.act" hidden data-f="paletteFile">
    <input type="file" accept="image/png,image/gif,image/jpeg,image/webp" hidden data-f="imageFile">`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const grid = q<HTMLCanvasElement>('canvas.palette');
  const info = q<HTMLElement>('.pal-info');
  const msg = q<HTMLElement>('.msg');
  const sliders = { r: q<HTMLInputElement>('[data-f="r"]'), g: q<HTMLInputElement>('[data-f="g"]'), b: q<HTMLInputElement>('[data-f="b"]') };
  const hexInput = q<HTMLInputElement>('[data-f="hex"]');
  const remapBox = q<HTMLInputElement>('[data-f="remap"]');
  const paletteFile = q<HTMLInputElement>('[data-f="paletteFile"]');
  const imageFile = q<HTMLInputElement>('[data-f="imageFile"]');
  const out = (k: string) => q<HTMLElement>(`[data-o="${k}"]`);

  let anchor = 0;
  let end = 0;
  let dragging = false;
  let committed: Palette = state.palette; // the palette as of the last undo step, for live edits
  let own = false; // true while this panel is the one changing the palette

  const range = () => ({ from: Math.min(anchor, end), to: Math.max(anchor, end), anchor });
  const say = (text: string, isError = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  const show = () => {
    const [r, g, b] = paletteColor(state.palette, anchor);
    const { from, to } = range();
    paintPalette(grid, state.palette, CELL, range());
    sliders.r.value = String(r);
    sliders.g.value = String(g);
    sliders.b.value = String(b);
    out('r').textContent = String(r);
    out('g').textContent = String(g);
    out('b').textContent = String(b);
    if (document.activeElement !== hexInput) hexInput.value = hex([r, g, b]);
    hexInput.classList.remove('invalid');
    info.textContent = `#${anchor}  (${r}, ${g}, ${b})${to > from ? `   ·   range #${from}–#${to}` : ''}`;
  };

  /** Run a change to the palette made by this panel without the panel reacting to its own notification. */
  const mine = (fn: () => void) => {
    own = true;
    try {
      fn();
    } finally {
      own = false;
    }
  };

  // --- the grid ---
  grid.addEventListener('pointerdown', (e) => {
    grid.setPointerCapture(e.pointerId);
    grid.focus();
    const i = paletteIndexAt(grid, e.clientX, e.clientY);
    if (e.shiftKey) end = i;
    else anchor = end = i;
    dragging = true;
    show();
  });
  grid.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    end = paletteIndexAt(grid, e.clientX, e.clientY);
    show();
  });
  const stop = (e: PointerEvent) => {
    dragging = false;
    if (grid.hasPointerCapture(e.pointerId)) grid.releasePointerCapture(e.pointerId);
  };
  grid.addEventListener('pointerup', stop);
  grid.addEventListener('pointercancel', stop);
  grid.addEventListener('keydown', (e) => {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -16, ArrowDown: 16 } as Record<string, number>)[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = Math.min(Math.max((e.shiftKey ? end : anchor) + step, 0), 255);
    if (e.shiftKey) end = next;
    else anchor = end = next;
    show();
  });

  // --- editing one entry: previewed live, one undo step when released ---
  const preview = () => {
    const rgb = [sliders.r, sliders.g, sliders.b].map((s) => Number(s.value)) as [number, number, number];
    mine(() => {
      state.palette = setEntry(state.palette, anchor, rgb);
      state.changed();
    });
    show();
  };
  const commit = () => {
    if (sameBytes(committed, state.palette)) return;
    mine(() => state.record(new SetPaletteCommand(state, 'Edit Color', state.palette, { before: committed })));
    committed = state.palette;
  };
  for (const s of Object.values(sliders)) {
    s.addEventListener('input', preview);
    s.addEventListener('change', commit);
  }
  hexInput.addEventListener('change', () => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hexInput.value.trim());
    hexInput.classList.toggle('invalid', !m);
    if (!m) return say('Type a colour as #rrggbb', true);
    const v = parseInt(m[1]!, 16);
    mine(() => state.execute(new SetPaletteCommand(state, 'Edit Color', setEntry(state.palette, anchor, [(v >> 16) & 255, (v >> 8) & 255, v & 255]))));
    committed = state.palette;
    say('');
    show();
  });
  hexInput.addEventListener('blur', show);

  // --- whole-palette actions ---
  const replace = (label: string, palette: Palette) => {
    mine(() => state.execute(new SetPaletteCommand(state, label, palette, { remap: remapBox.checked })));
    committed = state.palette;
    show();
  };
  const readFile = async (file: File): Promise<ArrayBuffer> => {
    if (file.size > MAX_FILE_BYTES) throw new PaletteFormatError('That file is too large');
    return file.arrayBuffer();
  };
  const fail = (err: unknown) => say(err instanceof Error ? err.message : 'Something went wrong', true);
  const keepNote = () => (remapBox.checked ? ' Existing art was remapped to keep its look.' : '');

  paletteFile.addEventListener('change', async () => {
    const file = paletteFile.files?.[0];
    paletteFile.value = '';
    if (!file) return;
    try {
      const { palette, count } = parsePaletteFile(new Uint8Array(await readFile(file)));
      replace('Import Palette', palette);
      say(`Imported ${count} colours from ${file.name}${count < 256 ? ' (the rest are black)' : ''}.${keepNote()}`);
    } catch (err) {
      fail(err);
    }
  });
  imageFile.addEventListener('change', async () => {
    const file = imageFile.files?.[0];
    imageFile.value = '';
    if (!file) return;
    try {
      const picture = await decodeImageFile(file);
      const { palette, distinct } = generatePalette(flattenAlpha(picture), picture.width, picture.height);
      replace('Palette from Image', palette);
      say(`Built a palette from ${file.name} (${distinct} distinct colours).${keepNote()}`);
    } catch (err) {
      fail(err);
    }
  });

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') toggle();
    else if (act === 'import') paletteFile.click();
    else if (act === 'fromImage') imageFile.click();
    else if (act === 'exportGpl') {
      downloadBlob('palette.gpl', writeGpl(state.palette), 'text/plain');
      say('Exported palette.gpl');
    } else if (act === 'exportAct') {
      downloadBlob('palette.act', writeAct(state.palette));
      say('Exported palette.act');
    } else if (act === 'ramp') {
      const { from, to } = range();
      const next = rampBetween(state.palette, from, to);
      if (sameBytes(next, state.palette)) return say('Select a range of at least three entries, with different ends.', true);
      mine(() => state.execute(new SetPaletteCommand(state, 'Palette Ramp', next)));
      committed = state.palette;
      say(`Blended #${from} to #${to}`);
      show();
    }
  });

  state.subscribe(() => {
    if (el.hidden || own) return;
    committed = state.palette; // an undo, a load, or another panel changed it
    show();
  });

  function toggle(): void {
    el.hidden = !el.hidden;
    if (!el.hidden) {
      committed = state.palette;
      say('');
      show();
    }
    onToggle();
  }

  return { toggle, isOpen: () => !el.hidden };
}
