import { axisPlane, knifeSelection, type KnifeOptions, type ModelerState } from '@/modeler';
import { makeDraggable } from './draggable';

export interface KnifePanel {
  /** The options the drag tool uses. */
  options(): KnifeOptions;
}

/**
 * The options of the Knife tool, shown while it is active. Drag a line in a view to cut along it, or type a position and
 * press Slice to cut along an axis plane exactly.
 */
export function createKnifePanel(state: ModelerState, host: HTMLElement): KnifePanel {
  const el = document.createElement('div');
  el.className = 'numeric knife';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Knife</span></div>
    <div class="hint">Drag a line across a view. It cuts the selected polygons, or all of them, along the plane through the line, front to back. Hold Shift while dragging for a straight horizontal or vertical slice.</div>
    <label class="choice" title="The sides stop sharing the points on the cut, so they can be moved apart"><input type="checkbox" data-f="separate"> Separate the sides</label>
    <div class="numeric-heading"><span>Slice at a position</span></div>
    <div class="numeric-row"><select data-f="axis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select><input type="text" data-f="position" value="0" inputmode="decimal" spellcheck="false"></div>
    <div class="numeric-actions"><button data-act="slice">Slice</button></div>
    <div class="msg" role="status"></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const separate = q<HTMLInputElement>('[data-f="separate"]');
  const axis = q<HTMLSelectElement>('[data-f="axis"]');
  const position = q<HTMLInputElement>('[data-f="position"]');
  const msg = q<HTMLElement>('.msg');

  const slice = () => {
    const n = position.value.trim() === '' ? NaN : Number(position.value);
    position.classList.toggle('invalid', !Number.isFinite(n));
    const result = Number.isFinite(n)
      ? knifeSelection(state, axisPlane(axis.value as 'x' | 'y' | 'z', n), { separate: separate.checked })
      : { ok: false, message: 'Type a number for the position' };
    msg.textContent = result.message;
    msg.classList.toggle('error', !result.ok);
  };
  position.addEventListener('input', () => position.classList.remove('invalid'));
  position.addEventListener('keydown', (e) => e.key === 'Enter' && slice());
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act="slice"]')) slice();
  });

  // visible exactly while the knife is the active tool
  state.subscribe(() => {
    const show = state.activeTool === 'knife';
    if (el.hidden && show) msg.textContent = '';
    el.hidden = !show;
  });

  return { options: () => ({ separate: separate.checked }) };
}
