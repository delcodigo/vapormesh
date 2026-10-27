import { makeDraggable } from './draggable';
import { RETRO_PRESETS, type RetroOptions } from '@/render';

export interface RenderPanel {
  toggle(): void;
  isOpen(): boolean;
}

/** Settings for the retro shaded view. Edits the shared options object; the viewport reads it every frame. */
export function createRenderPanel(retro: RetroOptions, host: HTMLElement, onToggle: () => void): RenderPanel {
  const el = document.createElement('div');
  el.className = 'numeric render';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Retro Render</span><button data-act="close" title="Close">×</button></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Preset</span></div>
      <div class="numeric-tabs">${Object.keys(RETRO_PRESETS).map((n) => `<button data-preset="${n}">${n}</button>`).join('')}</div></div>
    <div class="numeric-group">
      <div class="slider-row"><span class="name">Height</span><input type="range" min="60" max="720" step="30" data-k="resolutionHeight"><output data-o="resolutionHeight"></output></div>
      <div class="slider-row"><span class="name">Colors</span><input type="range" min="2" max="256" step="1" data-k="colorLevels"><output data-o="colorLevels"></output></div>
      <div class="slider-row"><span class="name">Dither</span><input type="range" min="0" max="100" step="5" data-k="dither"><output data-o="dither"></output></div>
    </div>
    <div class="hint">Affects the Perspective view in Shaded modes. Colors are levels per channel.</div>`;
  host.appendChild(el);
  makeDraggable(el);

  const inputs = [...el.querySelectorAll<HTMLInputElement>('[data-k]')];
  const label: Record<keyof RetroOptions, (v: number) => string> = {
    resolutionHeight: (v) => `${v}p`,
    colorLevels: (v) => `${v}`,
    dither: (v) => `${Math.round(v * 100)}%`,
  };

  const show = () => {
    for (const input of inputs) {
      const k = input.dataset.k as keyof RetroOptions;
      input.value = String(k === 'dither' ? retro[k] * 100 : retro[k]);
      el.querySelector(`[data-o="${k}"]`)!.textContent = label[k](retro[k]);
    }
  };

  el.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const k = input.dataset.k as keyof RetroOptions | undefined;
    if (!k) return;
    retro[k] = k === 'dither' ? Number(input.value) / 100 : Number(input.value);
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

  return { toggle, isOpen: () => !el.hidden };
}
