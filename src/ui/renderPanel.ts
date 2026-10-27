import { makeDraggable } from './draggable';
import type { Palette } from '@/core';
import { paintPalette } from './paletteView';
import { RETRO_PRESETS, type RetroOptions } from '@/render';

export interface RenderPanel {
  toggle(): void;
  isOpen(): boolean;
  /** Repaint the palette preview after the project palette changed. */
  refresh(): void;
}

type NumericKey = Exclude<keyof RetroOptions, 'usePalette'>;

const SWATCH = 8; // pixels per palette entry in the preview

/** Settings for the retro shaded view. Edits the shared options object; the viewport reads it every frame. */
export function createRenderPanel(
  retro: RetroOptions,
  host: HTMLElement,
  getPalette: () => Palette,
  onToggle: () => void,
): RenderPanel {
  const el = document.createElement('div');
  el.className = 'numeric render';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Retro Render</span><button data-act="close" title="Close">×</button></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Preset</span></div>
      <div class="numeric-tabs">${Object.keys(RETRO_PRESETS).map((n) => `<button data-preset="${n}">${n}</button>`).join('')}</div></div>
    <div class="numeric-group">
      <div class="slider-row"><span class="name">Height</span><input type="range" min="60" max="720" step="30" data-k="resolutionHeight"><output data-o="resolutionHeight"></output></div>
      <label class="choice"><input type="checkbox" data-k="usePalette"> Use project palette</label>
      <div class="slider-row"><span class="name">Colors</span><input type="range" min="2" max="256" step="1" data-k="colorLevels"><output data-o="colorLevels"></output></div>
      <div class="slider-row"><span class="name">Dither</span><input type="range" min="0" max="100" step="5" data-k="dither"><output data-o="dither"></output></div>
    </div>
    <div class="numeric-group"><div class="numeric-heading"><span>Palette</span></div>
      <canvas class="palette" width="${16 * SWATCH}" height="${16 * SWATCH}" title="The project palette: 16 ramps of 16 shades"></canvas></div>
    <div class="hint">Affects the Perspective view in Shaded modes. With the palette off, Colors is levels per channel.</div>`;
  host.appendChild(el);
  makeDraggable(el);

  const inputs = [...el.querySelectorAll<HTMLInputElement>('[data-k]')];
  const swatches = el.querySelector<HTMLCanvasElement>('canvas.palette')!;
  const format: Record<NumericKey, (v: number) => string> = {
    resolutionHeight: (v) => `${v}p`,
    colorLevels: (v) => `${v}`,
    dither: (v) => `${Math.round(v * 100)}%`,
  };

  const show = () => {
    for (const input of inputs) {
      const k = input.dataset.k as keyof RetroOptions;
      if (k === 'usePalette') {
        input.checked = retro.usePalette;
        continue;
      }
      input.value = String(k === 'dither' ? retro[k] * 100 : retro[k]);
      el.querySelector(`[data-o="${k}"]`)!.textContent = format[k](retro[k]);
    }
    el.querySelector<HTMLInputElement>('[data-k="colorLevels"]')!.disabled = retro.usePalette;
    paintPalette(swatches, getPalette(), SWATCH);
  };

  el.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const k = input.dataset.k as keyof RetroOptions | undefined;
    if (!k) return;
    if (k === 'usePalette') retro.usePalette = input.checked;
    else retro[k] = k === 'dither' ? Number(input.value) / 100 : Number(input.value);
    show();
  });
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const preset = target.closest<HTMLElement>('[data-preset]')?.dataset.preset;
    if (preset) {
      Object.assign(retro, RETRO_PRESETS[preset]);
      show();
    } else if (target.closest('[data-act="close"]')) {
      toggle();
    }
  });

  function toggle(): void {
    el.hidden = !el.hidden;
    if (!el.hidden) show();
    onToggle();
  }

  return { toggle, isOpen: () => !el.hidden, refresh: () => !el.hidden && paintPalette(swatches, getPalette(), SWATCH) };
}
