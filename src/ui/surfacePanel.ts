import { makeDraggable } from './draggable';
import { defaultSurface, type Surface } from '@/core';
import {
  AddSurfaceCommand,
  AssignSurfaceCommand,
  cloneSurface,
  applyAutoUv,
  EditSurfaceCommand,
  type ModelerState,
} from '@/modeler';

const SLIDERS = [
  ['diffuse', 'Diffuse'],
  ['luminosity', 'Luminosity'],
  ['specular', 'Specular'],
  ['glossiness', 'Glossiness'],
] as const;
type SliderKey = (typeof SLIDERS)[number][0];

const hex = (c: [number, number, number]) =>
  '#' + c.map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

export interface SurfacePanel {
  toggle(): void;
  isOpen(): boolean;
}

/**
 * Edits the surfaces of the active layer: colour, diffuse, luminosity, specular, glossiness, smoothing and
 * sidedness. Sliders preview live; the edit becomes one undo step when you let go.
 */
export function createSurfacePanel(state: ModelerState, host: HTMLElement, onToggle: () => void): SurfacePanel {
  const el = document.createElement('div');
  el.className = 'numeric surface';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Surface</span><button data-act="close" title="Close">×</button></div>
    <div class="numeric-group"><select data-f="which"></select></div>
    <div class="numeric-group">
      <div class="slider-row"><span class="name">Color</span><input type="color" data-f="color"></div>
      ${SLIDERS.map(([k, label]) => `<div class="slider-row"><span class="name">${label}</span><input type="range" min="0" max="100" step="1" data-f="${k}"><output data-o="${k}"></output></div>`).join('')}
      <label class="choice"><input type="checkbox" data-f="smoothing"> Smoothing (Gouraud)</label>
      <div class="slider-row"><span class="name">Max angle</span><input type="range" min="0" max="180" step="1" data-f="smoothingAngle"><output data-o="smoothingAngle"></output></div>
      <label class="choice"><input type="checkbox" data-f="doubleSided"> Double sided</label>
    </div>
    <div class="numeric-group">
      <div class="numeric-heading"><span>Texture</span></div>
      <div class="numeric-row"><select data-f="texture"></select><select data-f="wrap" title="What UVs outside 0..1 do"><option value="repeat">Repeat</option><option value="clamp">Clamp</option></select></div>
      <div class="numeric-actions" style="margin-top:4px"><button data-act="autoUv" title="Box-project UVs for the selected polygons (or the whole layer) at a fixed texel density">Auto UV</button></div>
    </div>
    <div class="numeric-group">
      <div class="numeric-heading"><span>New surface</span></div>
      <div class="numeric-row"><input type="text" data-f="newName" placeholder="Name" spellcheck="false"><button data-act="new">New</button></div>
    </div>
    <div class="numeric-actions"><button data-act="assign" title="Give the selected polygons this surface">Assign to selection</button></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const field = <T extends HTMLElement>(name: string) => el.querySelector<T>(`[data-f="${name}"]`)!;
  const which = field<HTMLSelectElement>('which');
  const color = field<HTMLInputElement>('color');
  const smoothing = field<HTMLInputElement>('smoothing');
  const doubleSided = field<HTMLInputElement>('doubleSided');
  const texture = field<HTMLSelectElement>('texture');
  const wrap = field<HTMLSelectElement>('wrap');
  const angle = field<HTMLInputElement>('smoothingAngle');
  const newName = field<HTMLInputElement>('newName');
  const sliders = Object.fromEntries(SLIDERS.map(([k]) => [k, field<HTMLInputElement>(k)])) as Record<SliderKey, HTMLInputElement>;
  const out = (k: string) => el.querySelector<HTMLElement>(`[data-o="${k}"]`)!;

  let index = 0;
  let committed: Surface = defaultSurface();
  let own = false; // true while this panel is the one changing the state
  let followed = -1; // first selected polygon we last followed

  const current = (): Surface | undefined => state.mesh.surfaces[index];

  const showFields = () => {
    const s = current();
    if (!s) return;
    which.innerHTML = state.mesh.surfaces.map((x, i) => `<option value="${i}">${x.name}</option>`).join('');
    which.value = String(index);
    color.value = hex(s.color);
    for (const [k] of SLIDERS) {
      sliders[k].value = String(Math.round(s[k] * 100));
      out(k).textContent = `${Math.round(s[k] * 100)}%`;
    }
    smoothing.checked = s.smoothing;
    angle.value = String(s.smoothingAngle);
    out('smoothingAngle').textContent = `${s.smoothingAngle}°`;
    angle.disabled = !s.smoothing;
    doubleSided.checked = s.doubleSided;
    // an image the surface names but the project no longer has stays listed, so the choice isn't silently lost
    const names = state.images.map((i) => i.name);
    if (s.texture && !names.includes(s.texture)) names.push(s.texture);
    texture.innerHTML =
      '<option value="">(none)</option>' +
      names.map((n) => `<option value="${n}">${state.images.some((i) => i.name === n) ? n : `${n} (missing)`}</option>`).join('');
    texture.value = s.texture ?? '';
    wrap.value = s.wrap;
  };

  /** Re-read the panel's selected surface from the model (after undo, selection or layer changes). */
  const reload = () => {
    const surfaces = state.mesh.surfaces;
    if (!surfaces.length) return;
    const first = state.selectedPolygonIds()[0] ?? -1;
    if (first !== followed) {
      followed = first;
      if (first >= 0) index = state.mesh.polygons[first]!.surface;
    }
    index = Math.min(Math.max(index, 0), surfaces.length - 1);
    committed = cloneSurface(surfaces[index]!);
    showFields();
  };

  const read = (): Surface => ({
    name: committed.name,
    color: fromHex(color.value),
    diffuse: Number(sliders.diffuse.value) / 100,
    luminosity: Number(sliders.luminosity.value) / 100,
    specular: Number(sliders.specular.value) / 100,
    glossiness: Number(sliders.glossiness.value) / 100,
    smoothing: smoothing.checked,
    smoothingAngle: Math.min(Math.max(Number(angle.value) || 0, 0), 180),
    doubleSided: doubleSided.checked,
    texture: texture.value || null,
    wrap: wrap.value === 'clamp' ? 'clamp' : 'repeat',
  });

  const apply = (fn: () => void) => {
    own = true;
    try {
      fn();
    } finally {
      own = false;
    }
  };

  // live preview while a control is being dragged
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (!t.dataset.f || t.dataset.f === 'which' || t.dataset.f === 'newName') return;
    const s = read();
    apply(() => {
      state.mesh.surfaces[index] = s;
      state.changed();
    });
    for (const [k] of SLIDERS) out(k).textContent = `${Math.round(s[k] * 100)}%`;
    out('smoothingAngle').textContent = `${s.smoothingAngle}°`;
    angle.disabled = !s.smoothing;
  });

  // one undo step per committed edit
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.f === 'which') {
      index = Number(which.value);
      reload();
      return;
    }
    if (!t.dataset.f || t.dataset.f === 'newName') return;
    const after = read();
    if (JSON.stringify(after) === JSON.stringify(committed)) return;
    apply(() => state.record(new EditSurfaceCommand(state.mesh, index, committed, after)));
    committed = cloneSurface(after);
  });

  const actions: Record<string, () => void> = {
    close: () => toggle(),
    autoUv: () => apply(() => applyAutoUv(state)),
    assign: () => {
      const ids = state.selectedPolygonIds().filter((p) => state.mesh.polygons[p]!.surface !== index);
      if (ids.length) apply(() => state.execute(new AssignSurfaceCommand(state.mesh, ids, index)));
    },
    new: () => {
      const name = newName.value.trim();
      const taken = state.mesh.surfaces.some((s) => s.name === name);
      newName.classList.toggle('invalid', !name || taken);
      if (!name || taken) return;
      const surface = { ...cloneSurface(read()), name };
      const ids = state.selectedPolygonIds();
      apply(() => {
        state.execute(new AddSurfaceCommand(state.mesh, surface));
        index = state.mesh.surfaces.length - 1;
        if (ids.length) state.execute(new AssignSurfaceCommand(state.mesh, ids, index));
      });
      newName.value = '';
      reload();
    },
  };
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) actions[act]!();
  });
  newName.addEventListener('keydown', (e) => e.key === 'Enter' && actions.new!());

  state.subscribe(() => {
    if (!el.hidden && !own) reload();
  });

  function toggle(): void {
    el.hidden = !el.hidden;
    if (!el.hidden) {
      followed = -1;
      reload();
    }
    onToggle();
  }

  return { toggle, isOpen: () => !el.hidden };
}
