import './style.css';
import { box, ModelerState, type SelectMode } from '@/modeler';
import { MeshView, pickPoint, pickPolygon, Viewport, type ViewKind } from '@/render';

const VIEWS: [ViewKind, string][] = [
  ['perspective', 'Perspective'],
  ['top', 'Top'],
  ['front', 'Front'],
  ['right', 'Right'],
];
const MODES: [SelectMode, string, string][] = [
  ['points', 'Points', '1'],
  ['polygons', 'Polygons', '2'],
];

const state = new ModelerState(box(1, 1, 1));

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="menubar">WebWave 3D &nbsp; | &nbsp; Modeler &nbsp; Layout</div>
  <div class="workspace">
    <div class="toolpanel">
      ${MODES.map(([m, label, key]) => `<button data-mode="${m}">${label} (${key})</button>`).join('')}
    </div>
    <div class="viewports">
      ${VIEWS.map(([, n]) => `<div class="viewport"><canvas></canvas><span class="label">${n}</span></div>`).join('')}
    </div>
  </div>
  <div class="statusbar"></div>`;

const status = app.querySelector<HTMLElement>('.statusbar')!;
const modeButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-mode]')];
modeButtons.forEach((b) => b.addEventListener('click', () => state.setMode(b.dataset.mode as SelectMode)));

state.subscribe(() => {
  const { mesh, mode, selection } = state;
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  const total = mode === 'points' ? mesh.points.length : mesh.polygons.length;
  status.textContent = `${mode}: ${selection.size} / ${total} selected`;
});

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    state.clearSelection();
  }
  for (const [m, , key] of MODES) if (e.key === key) state.setMode(m);
});

const viewports = [...document.querySelectorAll('canvas')].map((c, i) => {
  const vp = new Viewport(c, VIEWS[i]![0]);
  const view = new MeshView(state);
  vp.scene.add(view.group);
  vp.onClick = (x, y, e) => {
    const id =
      state.mode === 'points' ? pickPoint(state.mesh, vp, x, y) : pickPolygon(state.mesh, vp, x, y);
    state.applyPick(id, e.shiftKey ? 'toggle' : 'replace');
  };
  return { vp, view };
});

state.changed();

function frame() {
  for (const { vp, view } of viewports) {
    view.update();
    vp.resize();
    vp.render();
  }
  requestAnimationFrame(frame);
}
frame();
