import { extrudeSelection, type ExtrudeAxis, type ExtrudeToolSettings, type ModelerState } from '@/modeler';
import { makeDraggable } from './draggable';

type Kind = 'extrude' | 'bevel';
const TITLES: Record<Kind, string> = { extrude: 'Extrude', bevel: 'Bevel' };
const DIRECTIONS: [ExtrudeAxis, string][] = [
  ['normal', 'Along normals'],
  ['x', 'Along X'],
  ['y', 'Along Y'],
  ['z', 'Along Z'],
];
// A bevel is an extrude with an inset, so it starts with one.
const DEFAULTS: Record<Kind, { distance: string; inset: string; direction: ExtrudeAxis }> = {
  extrude: { distance: '0.25', inset: '0', direction: 'normal' },
  bevel: { distance: '0.1', inset: '0.1', direction: 'normal' },
};

export interface ExtrudePanel {
  /** The inset and direction the drag tool uses; the distance comes from the drag itself. */
  options(kind: Kind): ExtrudeToolSettings;
}

/**
 * The options of the Extrude and Bevel tools, shown while one of them is active. Drag in a view to extrude interactively,
 * or type a distance and press Apply. Each tool remembers its own values.
 */
export function createExtrudePanel(state: ModelerState, host: HTMLElement): ExtrudePanel {
  const el = document.createElement('div');
  el.className = 'numeric extrude';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span data-title></span></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Distance</span></div><div class="numeric-row"><input type="text" data-f="distance" inputmode="decimal" spellcheck="false"></div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Inset</span></div><div class="numeric-row"><input type="text" data-f="inset" inputmode="decimal" spellcheck="false"></div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Direction</span></div><div class="numeric-row"><select data-f="direction">${DIRECTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div></div>
    <div class="hint">Drag in a view to set the distance, along the direction. Or type it and press Apply. Inset shrinks the outline: with a distance it makes a bevel.</div>
    <div class="numeric-actions"><button data-act="apply">Apply</button></div>
    <div class="msg" role="status"></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const distance = q<HTMLInputElement>('[data-f="distance"]');
  const inset = q<HTMLInputElement>('[data-f="inset"]');
  const direction = q<HTMLSelectElement>('[data-f="direction"]');
  const msg = q<HTMLElement>('.msg');
  const values: Record<Kind, { distance: string; inset: string; direction: ExtrudeAxis }> = { extrude: { ...DEFAULTS.extrude }, bevel: { ...DEFAULTS.bevel } };
  let kind: Kind | null = null;

  const number = (input: HTMLInputElement) => {
    const n = input.value.trim() === '' ? NaN : Number(input.value);
    input.classList.toggle('invalid', !Number.isFinite(n));
    return n;
  };
  const say = (text: string, isError = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  el.addEventListener('input', (e) => {
    if (!kind) return;
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const f = t.dataset.f as 'distance' | 'inset' | 'direction' | undefined;
    if (f) (values[kind][f] as string) = t.value;
    if (f !== 'direction') t.classList.remove('invalid');
  });

  const apply = () => {
    if (!kind) return;
    const [d, i] = [number(distance), number(inset)];
    const result = extrudeSelection(state, { distance: d, inset: i, direction: direction.value as ExtrudeAxis }, TITLES[kind] as 'Extrude' | 'Bevel');
    say(result.message, !result.ok);
  };
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act="apply"]')) apply();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).dataset.f) apply();
  });

  // visible exactly while one of the two tools is active
  const sync = () => {
    const next: Kind | null = state.activeTool === 'extrude' || state.activeTool === 'bevel' ? state.activeTool : null;
    if (next !== kind) {
      kind = next;
      say('');
      if (kind) {
        q<HTMLElement>('[data-title]').textContent = TITLES[kind];
        // a value the person typed that is not a number is not worth keeping
        const valid = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));
        if (!valid(values[kind].distance)) values[kind].distance = DEFAULTS[kind].distance;
        if (!valid(values[kind].inset)) values[kind].inset = DEFAULTS[kind].inset;
        distance.value = values[kind].distance;
        inset.value = values[kind].inset;
        direction.value = values[kind].direction;
        distance.classList.remove('invalid');
        inset.classList.remove('invalid');
      }
    }
    el.hidden = kind === null;
  };
  state.subscribe(sync);

  return {
    options(k) {
      const i = Number(values[k].inset);
      return { inset: Number.isFinite(i) ? i : 0, direction: values[k].direction };
    },
  };
}
