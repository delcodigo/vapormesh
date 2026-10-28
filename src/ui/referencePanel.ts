import type { Viewport } from '@/render';
import { makeDraggable } from './draggable';

const FIELDS = [
  ['x', 'Across'],
  ['y', 'Up'],
  ['width', 'Width'],
] as const;
const fmt = (n: number) => String(Math.round(n * 1e4) / 1e4);

export interface ReferencePanel {
  toggle(): void;
  isOpen(): boolean;
}

/**
 * Puts an image behind one orthographic view as a modeling reference. The image lives in the world, so it pans and zooms with the
 * model; place it with its offset and width. Not saved with the project.
 */
export function createReferencePanel(
  host: HTMLElement,
  views: () => { vp: Viewport; label: string }[],
  onToggle: () => void = () => {},
): ReferencePanel {
  const el = document.createElement('div');
  el.className = 'numeric reference';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Reference image</span><button data-act="close" title="Close">×</button></div>
    <div class="numeric-row"><label>View<select data-view></select></label></div>
    <div class="numeric-actions"><button data-act="load">Load image…</button><button data-act="clear">Clear</button></div>
    <div class="numeric-row">${FIELDS.map(([k, l]) => `<label>${l}<input data-k="${k}" inputmode="decimal" spellcheck="false"></label>`).join('')}</div>
    <div class="numeric-row"><label>Opacity<input type="range" data-opacity min="0.05" max="1" step="0.05"></label><label><input type="checkbox" data-visible> Show</label></div>
    <div class="msg" role="status"></div>
    <input type="file" accept="image/*" hidden>`;
  host.appendChild(el);
  makeDraggable(el);

  const select = el.querySelector<HTMLSelectElement>('[data-view]')!;
  const file = el.querySelector<HTMLInputElement>('input[type="file"]')!;
  const inputs = [...el.querySelectorAll<HTMLInputElement>('input[data-k]')];
  const opacity = el.querySelector<HTMLInputElement>('[data-opacity]')!;
  const visible = el.querySelector<HTMLInputElement>('[data-visible]')!;
  const msg = el.querySelector<HTMLElement>('.msg')!;
  const clearButton = el.querySelector<HTMLButtonElement>('[data-act="clear"]')!;
  const current = () => views()[Number(select.value)]?.vp;

  const show = () => {
    const ref = current()?.getReference() ?? null;
    inputs.forEach((input) => {
      input.disabled = !ref;
      if (input !== document.activeElement) input.value = ref ? fmt(ref[input.dataset.k as 'x' | 'y' | 'width']) : '';
    });
    opacity.disabled = visible.disabled = clearButton.disabled = !ref;
    if (ref) {
      opacity.value = String(ref.opacity);
      visible.checked = ref.visible;
    }
  };
  const fillViews = () => {
    const keep = select.value;
    select.innerHTML = views().map((v, i) => `<option value="${i}">${v.label}</option>`).join('');
    if (keep) select.value = keep;
  };

  select.addEventListener('change', show);
  for (const input of inputs) {
    const commit = () => {
      current()?.updateReference({ [input.dataset.k!]: Number(input.value) });
      show();
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && commit());
  }
  opacity.addEventListener('input', () => current()?.updateReference({ opacity: Number(opacity.value) }));
  visible.addEventListener('change', () => current()?.updateReference({ visible: visible.checked }));
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      await current()?.setReferenceImage(url);
      msg.textContent = '';
    } catch {
      msg.textContent = 'That file could not be read as an image';
    } finally {
      URL.revokeObjectURL(url);
    }
    show();
  });
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') toggle();
    if (act === 'load') file.click();
    if (act === 'clear') {
      current()?.clearReference();
      show();
    }
  });

  function toggle(): void {
    el.hidden = !el.hidden;
    if (!el.hidden) {
      fillViews();
      show();
    }
    onToggle();
  }
  return { toggle, isOpen: () => !el.hidden };
}
