import type { Vec3 } from '@/core';
import { arraySelection, type ModelerState } from '@/modeler';
import { makeDraggable } from './draggable';

export interface ArrayPanel {
  toggle(): void;
  isOpen(): boolean;
}

const row = (field: string, values: [string, string, string]) =>
  ['X', 'Y', 'Z']
    .map((a, i) => `<label>${a}<input data-f="${field}" data-i="${i}" value="${values[i]}" inputmode="decimal" spellcheck="false"></label>`)
    .join('');

/** Copy the selected polygons (or the whole layer) several times, each copy stepped, turned and scaled from the one before. */
export function createArrayPanel(state: ModelerState, host: HTMLElement, onToggle: () => void): ArrayPanel {
  const el = document.createElement('div');
  el.className = 'numeric array';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Array / Clone</span><button data-act="close" title="Close">×</button></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Copies</span></div><div class="numeric-row"><input data-f="count" value="3" inputmode="numeric" spellcheck="false"></div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Offset per copy</span></div><div class="numeric-row">${row('offset', ['1', '0', '0'])}</div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Turn per copy (deg)</span></div><div class="numeric-row">${row('rotate', ['0', '0', '0'])}</div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Size per copy</span></div><div class="numeric-row">${row('scale', ['1', '1', '1'])}</div></div>
    <div class="hint">Copies the selected polygons, or the whole layer. Each copy steps from the one before, turning and sizing about the pivot. One copy with no offset is a clone.</div>
    <div class="numeric-actions"><button data-act="apply">Apply</button></div>
    <div class="msg" role="status"></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const msg = q<HTMLElement>('.msg');
  const number = (input: HTMLInputElement) => {
    const n = input.value.trim() === '' ? NaN : Number(input.value);
    input.classList.toggle('invalid', !Number.isFinite(n));
    return n;
  };
  const vec = (field: string): Vec3 => [0, 1, 2].map((i) => number(q<HTMLInputElement>(`[data-f="${field}"][data-i="${i}"]`))) as Vec3;

  const apply = () => {
    const result = arraySelection(state, { count: number(q('[data-f="count"]')), offset: vec('offset'), rotate: vec('rotate'), scale: vec('scale') });
    msg.textContent = result.message;
    msg.classList.toggle('error', !result.ok);
  };
  el.addEventListener('input', (e) => (e.target as HTMLElement).classList.remove('invalid'));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) apply();
  });
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
