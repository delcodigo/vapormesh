import { mirrorSelection, type MirrorAxis, type ModelerState } from '@/modeler';
import { makeDraggable } from './draggable';

export interface MirrorPanel {
  toggle(): void;
  isOpen(): boolean;
}

/** Reflect the selected polygons (or the whole layer) across a plane, optionally welding the halves along the seam. */
export function createMirrorPanel(state: ModelerState, host: HTMLElement, onToggle: () => void): MirrorPanel {
  const el = document.createElement('div');
  el.className = 'numeric mirror';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Mirror</span><button data-act="close" title="Close">×</button></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Plane perpendicular to</span></div>
      <div class="numeric-row"><select data-f="axis"><option value="x">X (left / right)</option><option value="y">Y (up / down)</option><option value="z">Z (front / back)</option></select></div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Position</span></div>
      <div class="numeric-row"><input type="text" data-f="position" value="0" inputmode="decimal" spellcheck="false"></div></div>
    <label class="choice" title="Points on the plane are shared, so the halves join. Polygons lying in the plane are not copied."><input type="checkbox" data-f="merge" checked> Join along the seam</label>
    <div class="hint">Mirrors the selected polygons, or the whole layer if none are selected. The copies end up selected.</div>
    <div class="numeric-actions"><button data-act="apply">Mirror</button></div>
    <div class="msg" role="status"></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const axis = q<HTMLSelectElement>('[data-f="axis"]');
  const position = q<HTMLInputElement>('[data-f="position"]');
  const merge = q<HTMLInputElement>('[data-f="merge"]');
  const msg = q<HTMLElement>('.msg');

  const apply = () => {
    const n = position.value.trim() === '' ? NaN : Number(position.value);
    position.classList.toggle('invalid', !Number.isFinite(n));
    const result = mirrorSelection(state, { axis: axis.value as MirrorAxis, position: n, merge: merge.checked });
    msg.textContent = result.message;
    msg.classList.toggle('error', !result.ok);
  };
  position.addEventListener('input', () => position.classList.remove('invalid'));
  position.addEventListener('keydown', (e) => e.key === 'Enter' && apply());
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'apply') apply();
    else if (act === 'close') toggle();
  });

  function toggle(): void {
    el.hidden = !el.hidden;
    if (!el.hidden) msg.textContent = '';
    onToggle();
  }
  return { toggle, isOpen: () => !el.hidden };
}
