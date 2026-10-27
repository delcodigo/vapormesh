import { deformSelection, type DeformAxis, type DeformSpec, type DeformToolName, type ModelerState } from '@/modeler';
import { makeDraggable } from './draggable';

const TITLES: Record<DeformToolName, string> = { stretch: 'Stretch', drag: 'Drag', magnet: 'Magnet', bend: 'Bend', twist: 'Twist', taper: 'Taper' };
const HINTS: Record<DeformToolName, string> = {
  stretch: 'Drag in a view to scale it along both of its axes, from the pivot. Or type the factors and press Apply.',
  drag: 'Drag a point in a view to move just that one, selected or not.',
  magnet: 'Press and drag in a view: points within the radius of where you pressed follow, the nearer the more. Ignores the selection.',
  bend: 'Drag sideways to bend the points round a circle. The amount is an angle over the whole length; the direction is where the bend curves to.',
  twist: 'Drag sideways to twist the points about the axis, more the further along it they are from the pivot.',
  taper: 'Drag sideways to shrink (right) or flare (left) the points towards the end of the axis.',
};
const AXES: DeformAxis[] = ['x', 'y', 'z'];

export interface DeformPanel {
  axis(): { axis: DeformAxis; toward: DeformAxis };
  magnetRadius(): number;
}

/** The options of the deformers, shown while one of them is active. Drag in a view, or type values and press Apply. */
export function createDeformPanel(state: ModelerState, host: HTMLElement): DeformPanel {
  const el = document.createElement('div');
  el.className = 'numeric deform';
  el.hidden = true;
  const axisSelect = (f: string) => `<select data-f="${f}">${AXES.map((a) => `<option value="${a}">${a.toUpperCase()}</option>`).join('')}</select>`;
  const field = (f: string, label: string, value: string, tools: DeformToolName[]) =>
    `<div class="numeric-group" data-tools="${tools.join(' ')}"><div class="numeric-heading"><span>${label}</span></div><div class="numeric-row"><input type="text" data-f="${f}" value="${value}" inputmode="decimal" spellcheck="false"></div></div>`;
  el.innerHTML = `
    <div class="numeric-title"><span data-title></span></div>
    <div class="numeric-group" data-tools="bend twist taper"><div class="numeric-heading"><span>Axis</span></div><div class="numeric-row">${axisSelect('axis')}</div></div>
    <div class="numeric-group" data-tools="bend"><div class="numeric-heading"><span>Bend towards</span></div><div class="numeric-row">${axisSelect('toward')}</div></div>
    ${field('fx', 'Factor X', '1', ['stretch'])}${field('fy', 'Factor Y', '1', ['stretch'])}${field('fz', 'Factor Z', '1', ['stretch'])}
    ${field('amount', 'Amount (1 = to a point)', '0.5', ['taper'])}
    ${field('degrees', 'Angle (degrees)', '45', ['twist', 'bend'])}
    ${field('radius', 'Radius', '1', ['magnet'])}
    <div class="hint" data-hint></div>
    <div class="numeric-actions"><button data-act="apply">Apply</button></div>
    <div class="msg" role="status"></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const input = (f: string) => q<HTMLInputElement>(`[data-f="${f}"]`);
  const msg = q<HTMLElement>('.msg');
  q<HTMLSelectElement>('[data-f="toward"]').value = 'x';
  q<HTMLSelectElement>('[data-f="axis"]').value = 'y';
  let tool: DeformToolName | null = null;

  const number = (f: string) => {
    const i = input(f);
    const n = i.value.trim() === '' ? NaN : Number(i.value);
    i.classList.toggle('invalid', !Number.isFinite(n));
    return n;
  };
  const say = (text: string, isError = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };
  const axes = () => ({ axis: q<HTMLSelectElement>('[data-f="axis"]').value as DeformAxis, toward: q<HTMLSelectElement>('[data-f="toward"]').value as DeformAxis });

  const spec = (): DeformSpec | null => {
    const { axis, toward } = axes();
    switch (tool) {
      case 'stretch':
        return { kind: 'stretch', factors: [number('fx'), number('fy'), number('fz')] };
      case 'taper':
        return { kind: 'taper', axis, amount: number('amount') };
      case 'twist':
        return { kind: 'twist', axis, radians: (number('degrees') * Math.PI) / 180 };
      case 'bend':
        return { kind: 'bend', axis, toward, radians: (number('degrees') * Math.PI) / 180 };
      default:
        return null;
    }
  };
  const apply = () => {
    const s = spec();
    if (!s) return;
    const result = deformSelection(state, s);
    say(result.message, !result.ok);
  };
  el.addEventListener('input', (e) => (e.target as HTMLElement).classList.remove('invalid'));
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act="apply"]')) apply();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).dataset.f) apply();
  });

  const sync = () => {
    const names = Object.keys(TITLES) as DeformToolName[];
    const next = names.find((n) => n === state.activeTool) ?? null;
    if (next !== tool) {
      tool = next;
      say('');
      if (tool) {
        q<HTMLElement>('[data-title]').textContent = TITLES[tool];
        q<HTMLElement>('[data-hint]').textContent = HINTS[tool];
        for (const g of el.querySelectorAll<HTMLElement>('[data-tools]')) g.hidden = !g.dataset.tools!.split(' ').includes(tool);
        // Drag has no options and no typed form
        q<HTMLElement>('.numeric-actions').hidden = tool === 'drag' || tool === 'magnet';
      }
    }
    el.hidden = tool === null;
  };
  state.subscribe(sync);

  return {
    axis: axes,
    magnetRadius() {
      const r = Number(input('radius').value);
      return Number.isFinite(r) && r > 0 ? r : 1;
    },
  };
}
