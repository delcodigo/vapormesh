import { booleanLayers, type BooleanOp, type ModelerState } from '@/modeler';
import { makeDraggable } from './draggable';

export interface BooleanPanel {
  toggle(): void;
  isOpen(): boolean;
}

const OPERATIONS: [BooleanOp, string][] = [
  ['add', 'Add (union)'],
  ['subtract', 'Subtract'],
  ['intersect', 'Intersect'],
];

/**
 * Combine the solids on two layers into a third. The object goes on one layer, the cutter on another, and the result lands on
 * a third, so both originals are kept. Both must be closed solids.
 */
export function createBooleanPanel(state: ModelerState, host: HTMLElement, onToggle: () => void): BooleanPanel {
  const el = document.createElement('div');
  el.className = 'numeric boolean';
  el.hidden = true;
  const layerSelect = (field: string) => `<select data-f="${field}"></select>`;
  el.innerHTML = `
    <div class="numeric-title"><span>Boolean</span><button data-act="close" title="Close">×</button></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Operation</span></div>
      <div class="numeric-row"><select data-f="operation">${OPERATIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Object (layer)</span></div><div class="numeric-row">${layerSelect('object')}</div></div>
    <div class="numeric-group"><div class="numeric-heading"><span data-f="cutterLabel">Cutter (layer)</span></div><div class="numeric-row">${layerSelect('cutter')}</div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Result goes to layer</span></div><div class="numeric-row">${layerSelect('target')}</div></div>
    <div class="hint">Both must be closed solids facing outward. The originals stay as they are.</div>
    <div class="numeric-actions"><button data-act="apply">Apply</button></div>
    <div class="msg" role="status"></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const operation = q<HTMLSelectElement>('[data-f="operation"]');
  const object = q<HTMLSelectElement>('[data-f="object"]');
  const cutter = q<HTMLSelectElement>('[data-f="cutter"]');
  const target = q<HTMLSelectElement>('[data-f="target"]');
  const msg = q<HTMLElement>('.msg');

  /** "Layer 3 (24 polygons)" or "Layer 4 (empty)", rebuilt when the layers change without losing the choices. */
  const fillLayers = () => {
    for (const select of [object, cutter, target]) {
      const keep = select.value;
      select.replaceChildren(
        ...state.layers.map((mesh, i) => new Option(`Layer ${i + 1} (${mesh.polygons.length === 0 ? 'empty' : `${mesh.polygons.length} polygons`})`, String(i))),
      );
      if (keep !== '') select.value = keep;
    }
  };

  /** Sensible starting choices: the active layer as the object, another used layer as the cutter, the first free layer for the result. */
  const chooseDefaults = () => {
    const used = state.layers.map((m, i) => (m.polygons.length > 0 ? i : -1)).filter((i) => i >= 0);
    const obj = state.layers[state.activeLayer]!.polygons.length > 0 ? state.activeLayer : (used[0] ?? 0);
    const cut = used.find((i) => i !== obj) ?? (obj === 0 ? 1 : 0);
    const free = state.layers.findIndex((m, i) => m.polygons.length === 0 && i !== obj && i !== cut);
    object.value = String(obj);
    cutter.value = String(cut);
    target.value = String(free >= 0 ? free : [0, 1, 2].find((i) => i !== obj && i !== cut) ?? 2);
  };

  const apply = () => {
    const result = booleanLayers(state, {
      object: Number(object.value),
      cutter: Number(cutter.value),
      target: Number(target.value),
      operation: operation.value as BooleanOp,
    });
    msg.textContent = result.message;
    msg.classList.toggle('error', !result.ok);
  };
  operation.addEventListener('change', () => {
    q<HTMLElement>('[data-f="cutterLabel"]').textContent = operation.value === 'subtract' ? 'Cutter, taken away (layer)' : 'Cutter (layer)';
  });
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'apply') apply();
    else if (act === 'close') toggle();
  });

  state.subscribe(() => {
    if (!el.hidden) fillLayers();
  });

  function toggle(): void {
    el.hidden = !el.hidden;
    if (!el.hidden) {
      fillLayers();
      chooseDefaults();
      msg.textContent = '';
    }
    onToggle();
  }
  return { toggle, isOpen: () => !el.hidden };
}
